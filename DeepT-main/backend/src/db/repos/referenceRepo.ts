/**
 * Reference (RAG) repository: documents + chunks + pgvector scoped search.
 *
 * Retrieval uses a single SQL query: pgvector cosine (`<=>`) ordered, scoped by
 * course + optional clo/subtopic array containment. Because an HNSW index applies
 * the scope filter AFTER the approximate search, we enable iterative scans
 * (`hnsw.iterative_scan = strict_order`) and raise `hnsw.ef_search` per query so a
 * selective scope filter still returns a full in-scope topN (no silent
 * under-return). BM25 fusion stays in app code (see referenceRetrieval).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ReferenceChunk, ReferenceDocument } from '../../models/schemas.js';
import { referenceDocuments, referenceChunks } from '../schema/references.js';
import { getDb, getPool } from '../client.js';
import { buildVectorIndex, hasVectorIndex } from '../bootstrap.js';
import { exec, type Executor } from './_exec.js';

export interface RetrieveScope {
  cloId?: string;
  subtopicId?: string;
}

const EF_SEARCH = Number(process.env.HNSW_EF_SEARCH || 200);

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

// ---- Documents ----

export async function saveDocument(doc: ReferenceDocument, docText?: string, tx?: Executor): Promise<void> {
  // When docText is omitted (e.g. metadata-only re-embed update), preserve the
  // existing stored text instead of overwriting it with null.
  const set: Record<string, unknown> = { courseCode: sql`excluded.course_code`, data: sql`excluded.data` };
  if (docText !== undefined) set.docText = sql`excluded.doc_text`;
  await exec(tx)
    .insert(referenceDocuments)
    .values({ docId: doc.doc_id, courseCode: doc.course_code, docText: docText ?? null, data: doc })
    .onConflictDoUpdate({ target: referenceDocuments.docId, set });
}

export async function getDocument(docId: string, tx?: Executor): Promise<ReferenceDocument | null> {
  const rows = await exec(tx).select({ data: referenceDocuments.data }).from(referenceDocuments).where(eq(referenceDocuments.docId, docId)).limit(1);
  return rows[0]?.data ?? null;
}

export async function listDocuments(courseCode: string, tx?: Executor): Promise<ReferenceDocument[]> {
  const rows = await exec(tx).select({ data: referenceDocuments.data }).from(referenceDocuments).where(eq(referenceDocuments.courseCode, courseCode)).orderBy(referenceDocuments.createdAt);
  return rows.map((r) => r.data);
}

export async function getDocText(docId: string, tx?: Executor): Promise<string | null> {
  const rows = await exec(tx).select({ docText: referenceDocuments.docText }).from(referenceDocuments).where(eq(referenceDocuments.docId, docId)).limit(1);
  return rows[0]?.docText ?? null;
}

export async function deleteDocument(docId: string, tx?: Executor): Promise<void> {
  const db = exec(tx);
  await db.delete(referenceChunks).where(eq(referenceChunks.docId, docId));
  await db.delete(referenceDocuments).where(eq(referenceDocuments.docId, docId));
}

// ---- Chunks ----

// Drizzle `.select()` returns rows keyed by the SCHEMA PROPERTY names (camelCase),
// not the snake_case DB columns, so map from those.
function rowToChunk(r: Record<string, unknown>): ReferenceChunk {
  return {
    chunk_id: r.chunkId as string,
    doc_id: r.docId as string,
    course_code: r.courseCode as string,
    seq: Number(r.seq ?? 0),
    text: r.text as string,
    token_estimate: Number(r.tokenEstimate ?? 0),
    section_heading: (r.sectionHeading as string) || undefined,
    context_header: (r.contextHeader as string) || undefined,
    content_hash: (r.contentHash as string) || undefined,
    citation: (r.citation as string) ?? '',
    clo_ids: (r.cloIds as string[]) ?? [],
    subtopic_ids: (r.subtopicIds as string[]) ?? [],
    embedding: [],
  };
}

export async function upsertChunks(chunks: ReferenceChunk[], tx?: Executor): Promise<void> {
  if (chunks.length === 0) return;
  const db = exec(tx);
  await db
    .insert(referenceChunks)
    .values(
      chunks.map((c) => ({
        chunkId: c.chunk_id,
        docId: c.doc_id,
        courseCode: c.course_code,
        seq: c.seq,
        text: c.text,
        citation: c.citation ?? '',
        sectionHeading: c.section_heading ?? null,
        contextHeader: c.context_header ?? null,
        contentHash: c.content_hash ?? null,
        tokenEstimate: c.token_estimate ?? null,
        cloIds: c.clo_ids ?? [],
        subtopicIds: c.subtopic_ids ?? [],
        embedding: c.embedding && c.embedding.length > 0 ? c.embedding : null,
      }))
    )
    .onConflictDoUpdate({
      target: referenceChunks.chunkId,
      set: {
        docId: sql`excluded.doc_id`,
        courseCode: sql`excluded.course_code`,
        seq: sql`excluded.seq`,
        text: sql`excluded.text`,
        citation: sql`excluded.citation`,
        sectionHeading: sql`excluded.section_heading`,
        contextHeader: sql`excluded.context_header`,
        contentHash: sql`excluded.content_hash`,
        tokenEstimate: sql`excluded.token_estimate`,
        cloIds: sql`excluded.clo_ids`,
        subtopicIds: sql`excluded.subtopic_ids`,
        embedding: sql`excluded.embedding`,
      },
    });
}

export async function getChunksByDoc(docId: string, tx?: Executor): Promise<ReferenceChunk[]> {
  const rows = await exec(tx).select().from(referenceChunks).where(eq(referenceChunks.docId, docId)).orderBy(referenceChunks.seq);
  return rows.map((r) => ({ ...rowToChunk(r as Record<string, unknown>), embedding: (r.embedding as number[]) ?? [] }));
}

export async function getAllChunks(courseCode: string, tx?: Executor): Promise<ReferenceChunk[]> {
  const rows = await exec(tx).select().from(referenceChunks).where(eq(referenceChunks.courseCode, courseCode)).orderBy(referenceChunks.docId, referenceChunks.seq);
  return rows.map((r) => ({ ...rowToChunk(r as Record<string, unknown>), embedding: (r.embedding as number[]) ?? [] }));
}

export async function getChunksByIds(ids: string[], tx?: Executor): Promise<ReferenceChunk[]> {
  if (ids.length === 0) return [];
  const rows = await exec(tx).select().from(referenceChunks).where(inArray(referenceChunks.chunkId, ids));
  return rows.map((r) => ({ ...rowToChunk(r as Record<string, unknown>), embedding: (r.embedding as number[]) ?? [] }));
}

export async function deleteChunksByDoc(courseCode: string, docId: string, tx?: Executor): Promise<void> {
  await exec(tx).delete(referenceChunks).where(and(eq(referenceChunks.courseCode, courseCode), eq(referenceChunks.docId, docId)));
}

export async function deleteAllChunks(courseCode: string, tx?: Executor): Promise<void> {
  await exec(tx).delete(referenceChunks).where(eq(referenceChunks.courseCode, courseCode));
}

export async function countChunks(courseCode: string, tx?: Executor): Promise<number> {
  const rows = await exec(tx)
    .select({ n: sql<number>`count(*)::int` })
    .from(referenceChunks)
    .where(eq(referenceChunks.courseCode, courseCode));
  return Number(rows[0]?.n ?? 0);
}

/**
 * Ensure the HNSW cosine index exists (idempotent). For incremental uploads this
 * builds it once on first use; a from-scratch mass re-ingest should instead defer
 * to the `db:build-vector-index` script AFTER loading all rows.
 */
export async function ensureVectorIndex(): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  if (!(await hasVectorIndex(pool))) await buildVectorIndex(pool);
}

/**
 * Scoped pgvector cosine search. Returns chunk_id + cosine similarity (1 - distance),
 * highest first. Runs inside a transaction so the iterative-scan / ef_search GUCs
 * apply to the query and a selective scope filter still yields a full topN.
 */
export async function searchByVector(
  courseCode: string,
  queryVector: number[],
  topN: number,
  scope?: RetrieveScope
): Promise<{ chunk_id: string; score: number }[]> {
  if (queryVector.length === 0) return [];
  const vec = toVectorLiteral(queryVector);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = strict_order`);
    await tx.execute(sql.raw(`SET LOCAL hnsw.ef_search = ${Math.max(1, Math.floor(EF_SEARCH))}`));

    const conds = [sql`course_code = ${courseCode}`, sql`embedding IS NOT NULL`];
    if (scope?.cloId) conds.push(sql`clo_ids @> ARRAY[${scope.cloId}]::text[]`);
    if (scope?.subtopicId) conds.push(sql`subtopic_ids @> ARRAY[${scope.subtopicId}]::text[]`);
    let whereSql = conds[0];
    for (let i = 1; i < conds.length; i++) whereSql = sql`${whereSql} AND ${conds[i]}`;

    const result = await tx.execute(sql`
      SELECT chunk_id, 1 - (embedding <=> ${vec}::vector) AS score
      FROM reference_chunks
      WHERE ${whereSql}
      ORDER BY embedding <=> ${vec}::vector
      LIMIT ${topN}
    `);
    const rows = (result as unknown as { rows: Array<{ chunk_id: string; score: number }> }).rows ?? [];
    return rows.map((r) => ({ chunk_id: r.chunk_id, score: Number(r.score) }));
  });
}
