/**
 * Reference Vector Store
 *
 * One interface, two backends:
 *  - Neo4jVectorStore: uses the native vector index (db.index.vector.queryNodes)
 *  - JsonCosineStore:   in-process cosine over chunks persisted in JSON
 *
 * indexChunks() probes Neo4j vector-index support at the embedding's dimensions
 * and auto-falls back to JSON when unavailable. Embeddings are always persisted
 * to JSON by the ingestion layer, so switching backends never requires re-embedding.
 */

import type { ReferenceChunk, RetrievedChunk } from '../models/schemas.js';
import * as fileService from './file.service.js';
import * as neo4j from './neo4j.service.js';

export type VectorBackend = 'neo4j' | 'json';

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
// Cosine helpers (used by the JSON backend + as the Neo4j fallback path)
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

// ---------------------------------------------------------------------------
// JSON cosine backend
// ---------------------------------------------------------------------------

class JsonCosineStore implements ReferenceVectorStore {
  backend: VectorBackend = 'json';

  async indexChunks(_chunks: ReferenceChunk[]): Promise<VectorBackend> {
    // Chunks (incl. embeddings) are persisted to JSON by the ingestion layer;
    // nothing else to do for this backend.
    return 'json';
  }

  async query(
    courseCode: string,
    queryVector: number[],
    topN: number,
    scope?: RetrieveScope
  ): Promise<{ chunk_id: string; score: number }[]> {
    const chunks = fileService.getAllReferenceChunks(courseCode);
    return chunks
      .filter((c) => matchesScope(c, scope))
      .map((c) => ({ chunk_id: c.chunk_id, score: cosineSimilarity(queryVector, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  async deleteDoc(_courseCode: string, _docId: string): Promise<void> {
    // JSON chunk files are removed by the ingestion layer (file.service).
  }
}

// ---------------------------------------------------------------------------
// Neo4j vector-index backend
// ---------------------------------------------------------------------------

class Neo4jVectorStore implements ReferenceVectorStore {
  backend: VectorBackend = 'neo4j';

  async indexChunks(chunks: ReferenceChunk[]): Promise<VectorBackend> {
    await neo4j.upsertReferenceChunks(chunks);
    return 'neo4j';
  }

  async query(
    courseCode: string,
    queryVector: number[],
    topN: number,
    scope?: RetrieveScope
  ): Promise<{ chunk_id: string; score: number }[]> {
    return neo4j.queryReferenceChunks(courseCode, queryVector, topN, scope);
  }

  async deleteDoc(courseCode: string, docId: string): Promise<void> {
    await neo4j.deleteReferenceChunksByDoc(courseCode, docId);
  }
}

const jsonStore = new JsonCosineStore();
const neo4jStore = new Neo4jVectorStore();

/**
 * Choose the store for INDEXING. Prefers Neo4j when connected and a vector index
 * is usable at the given embedding dimensions; otherwise falls back to JSON.
 */
export async function resolveStoreForIndexing(dimensions: number): Promise<ReferenceVectorStore> {
  if (neo4j.isNeo4jConnected()) {
    const ok = await neo4j.ensureReferenceVectorIndex(dimensions);
    if (ok) return neo4jStore;
  }
  return jsonStore;
}

/** Get the store matching the backend recorded in a course's manifest. */
export function getStoreForBackend(backend: VectorBackend): ReferenceVectorStore {
  return backend === 'neo4j' ? neo4jStore : jsonStore;
}
