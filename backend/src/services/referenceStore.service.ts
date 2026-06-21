/**
 * Reference Vector Store — Postgres/pgvector is THE backend.
 *
 * `PostgresVectorStore` persists/queries chunk embeddings in the `reference_chunks`
 * table (vector(1536) + HNSW). Retrieval runs a single scoped pgvector query with
 * iterative-scan enabled (see referenceRepo.searchByVector). BM25 fusion stays in
 * app code (referenceRetrieval.fuseHybrid).
 *
 * The Neo4j vector backend has been retired. `JsonCosineStore` remains only as a
 * dependency-light fallback/test shim doing in-process cosine over the SAME
 * Postgres rows (so switching backends never requires re-embedding).
 */

import type { ReferenceChunk } from '../models/schemas.js';
import * as referenceRepo from '../db/repos/referenceRepo.js';

export type VectorBackend = 'postgres' | 'neo4j' | 'json';

export interface RetrieveScope {
  cloId?: string;
  subtopicId?: string;
}

export interface ReferenceVectorStore {
  backend: VectorBackend;
  /** Persist + index a document's chunks. Returns the backend actually used. */
  indexChunks(chunks: ReferenceChunk[]): Promise<VectorBackend>;
  query(
    courseCode: string,
    queryVector: number[],
    topN: number,
    scope?: RetrieveScope
  ): Promise<{ chunk_id: string; score: number }[]>;
  deleteDoc(courseCode: string, docId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Postgres / pgvector backend (default)
// ---------------------------------------------------------------------------

class PostgresVectorStore implements ReferenceVectorStore {
  backend: VectorBackend = 'postgres';

  async indexChunks(chunks: ReferenceChunk[]): Promise<VectorBackend> {
    if (chunks.length > 0) {
      await referenceRepo.upsertChunks(chunks);
      await referenceRepo.ensureVectorIndex();
    }
    return 'postgres';
  }

  async query(
    courseCode: string,
    queryVector: number[],
    topN: number,
    scope?: RetrieveScope
  ): Promise<{ chunk_id: string; score: number }[]> {
    return referenceRepo.searchByVector(courseCode, queryVector, topN, scope);
  }

  async deleteDoc(courseCode: string, docId: string): Promise<void> {
    await referenceRepo.deleteChunksByDoc(courseCode, docId);
  }
}

// ---------------------------------------------------------------------------
// JSON cosine fallback (test/parity shim) — reads the SAME Postgres rows
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function matchesScope(chunk: ReferenceChunk, scope?: RetrieveScope): boolean {
  if (!scope) return true;
  if (scope.cloId && !chunk.clo_ids.includes(scope.cloId)) return false;
  if (scope.subtopicId && !chunk.subtopic_ids.includes(scope.subtopicId)) return false;
  return true;
}

class JsonCosineStore implements ReferenceVectorStore {
  backend: VectorBackend = 'json';

  async indexChunks(_chunks: ReferenceChunk[]): Promise<VectorBackend> {
    // Embeddings already persisted to Postgres by the ingestion layer.
    return 'json';
  }

  async query(
    courseCode: string,
    queryVector: number[],
    topN: number,
    scope?: RetrieveScope
  ): Promise<{ chunk_id: string; score: number }[]> {
    const chunks = await referenceRepo.getAllChunks(courseCode);
    return chunks
      .filter((c) => matchesScope(c, scope))
      .map((c) => ({ chunk_id: c.chunk_id, score: cosineSimilarity(queryVector, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  async deleteDoc(courseCode: string, docId: string): Promise<void> {
    await referenceRepo.deleteChunksByDoc(courseCode, docId);
  }
}

const postgresStore = new PostgresVectorStore();
const jsonStore = new JsonCosineStore();

/** The store used for INDEXING. Postgres/pgvector is the only real backend now. */
export async function resolveStoreForIndexing(_dimensions: number): Promise<ReferenceVectorStore> {
  return postgresStore;
}

/** Get the store matching a manifest backend. Legacy 'neo4j' maps to Postgres. */
export function getStoreForBackend(backend: VectorBackend): ReferenceVectorStore {
  return backend === 'json' ? jsonStore : postgresStore;
}
