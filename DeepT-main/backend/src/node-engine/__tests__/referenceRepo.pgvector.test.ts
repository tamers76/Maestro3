/**
 * pgvector repository retrieval tests (run under RUN_DB_TESTS=1).
 *
 * Validates the core RAG correctness guarantees from the migration plan:
 *  1. Unscoped cosine search ranks the nearest chunk first.
 *  2. SCOPED search (clo_ids @> ...) returns a FULL in-scope topN even when the
 *     in-scope chunks are NOT the global nearest neighbours — the case a naive
 *     post-filter HNSW scan would silently under-return. referenceRepo enables
 *     hnsw.iterative_scan=strict_order + raised ef_search to prevent that.
 *
 * Embeddings are 1536-dim one-hot unit vectors so cosine similarity is exactly 1
 * for the matching basis and 0 otherwise — giving a deterministic ranking.
 */
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import type { ReferenceChunk, ReferenceDocument } from '../../models/schemas.js';
import * as referenceRepo from '../../db/repos/referenceRepo.js';
import { getStoreForBackend } from '../../services/referenceStore.service.js';
import { dbTestsEnabled, setupTestDb, resetTestData, teardownTestDb } from '../../db/testSupport.js';

const dbSkip = dbTestsEnabled ? false : 'requires RUN_DB_TESTS=1';
const DIM = 1536;
const CODE = 'PGVECTEST';

/** 1536-dim one-hot unit vector with a single 1 at `idx`. */
function oneHot(idx: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[idx] = 1;
  return v;
}

function doc(): ReferenceDocument {
  return {
    doc_id: 'd1',
    course_code: CODE,
    title: 'Doc 1',
    source_type: 'textbook_chapter',
    citation_label: 'Doc 1',
    scope: { clo_ids: [], subtopic_ids: [] },
    original_filename: 'd1.pdf',
    mime_type: 'application/pdf',
    uploaded_at: '2026-01-01T00:00:00.000Z',
    char_count: 10,
    chunk_count: 0,
    embedding_model: 'text-embedding-3-small',
    embedding_dimensions: DIM,
  };
}

function chunk(id: string, basis: number, scope?: { cloId?: string }): ReferenceChunk {
  return {
    chunk_id: id,
    doc_id: 'd1',
    course_code: CODE,
    seq: basis,
    text: `chunk ${id}`,
    token_estimate: 2,
    citation: id,
    clo_ids: scope?.cloId ? [scope.cloId] : [],
    subtopic_ids: [],
    embedding: oneHot(basis),
  };
}

before(async () => {
  if (dbTestsEnabled) await setupTestDb();
});
beforeEach(async () => {
  if (dbTestsEnabled) await resetTestData();
});
after(async () => {
  if (dbTestsEnabled) await teardownTestDb();
});

test('searchByVector ranks the nearest chunk first (unscoped)', { skip: dbSkip }, async () => {
  await referenceRepo.saveDocument(doc(), 'text');
  await referenceRepo.upsertChunks([chunk('c0', 0), chunk('c5', 5), chunk('c9', 9)]);

  const hits = await referenceRepo.searchByVector(CODE, oneHot(5), 3);
  assert.equal(hits[0].chunk_id, 'c5', 'exact-basis chunk ranks first');
  assert.ok(hits[0].score > hits[1].score, 'nearest has strictly higher similarity');
});

test('scoped search returns a full in-scope topN even when not the global nearest', { skip: dbSkip }, async () => {
  await referenceRepo.saveDocument(doc(), 'text');

  // 7 untagged chunks crowd the query's neighbourhood (basis 0..6 == query e0).
  const untagged = Array.from({ length: 7 }, (_, i) => chunk(`u${i}`, i));
  // 3 in-scope (CLO-1) chunks live far from the query (basis 100..102).
  const inScope = [
    chunk('s0', 100, { cloId: 'CLO-1' }),
    chunk('s1', 101, { cloId: 'CLO-1' }),
    chunk('s2', 102, { cloId: 'CLO-1' }),
  ];
  await referenceRepo.upsertChunks([...untagged, ...inScope]);

  // Query near the untagged cluster, but scoped to CLO-1. A naive post-filter HNSW
  // would return 0 (the approximate set is all untagged); iterative scan returns all 3.
  const hits = await referenceRepo.searchByVector(CODE, oneHot(0), 3, { cloId: 'CLO-1' });
  assert.equal(hits.length, 3, 'full in-scope topN returned, no silent under-return');
  assert.deepEqual(
    hits.map((h) => h.chunk_id).sort(),
    ['s0', 's1', 's2'],
    'only the in-scope chunks are returned'
  );
});

/**
 * A near-unit vector pointing almost entirely at e0 (the query basis) with a tiny
 * unique perturbation so every untagged row is DISTINCT yet all sit far closer to
 * the query than any in-scope row. `perturbIdx` must avoid index 0 and the in-scope
 * indices.
 */
function nearQuery(perturbIdx: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[0] = 1;
  v[perturbIdx] = 0.02;
  return v;
}

test('scoped search exercises iterative scan: full topN even past the ef_search window', { skip: dbSkip }, async () => {
  await referenceRepo.saveDocument(doc(), 'text');

  // Seed MANY untagged rows clustered at the query (cosine ~0.9998) — comfortably
  // more than hnsw.ef_search (default 200) so the planner uses the HNSW index and
  // its approximate window is saturated by OUT-OF-SCOPE rows. The 3 in-scope rows
  // are orthogonal to the query (cosine 0), i.e. the global FARTHEST. Without
  // hnsw.iterative_scan the post-filter would return 0; with it (set per-query in
  // searchByVector's transaction) the scan continues until the full in-scope topN
  // is found. Indices: untagged perturbations use 10..(10+N-1); in-scope use
  // 1520..1522 — all distinct from each other and from the query basis (0).
  const UNTAGGED = 1400;
  const untagged = Array.from({ length: UNTAGGED }, (_, i) => {
    const c = chunk(`big_u${i}`, 0); // basis 0 set below via nearQuery
    return { ...c, embedding: nearQuery(10 + i) };
  });
  const inScope = [
    { ...chunk('big_s0', 0, { cloId: 'CLO-RARE' }), embedding: oneHot(1520) },
    { ...chunk('big_s1', 0, { cloId: 'CLO-RARE' }), embedding: oneHot(1521) },
    { ...chunk('big_s2', 0, { cloId: 'CLO-RARE' }), embedding: oneHot(1522) },
  ];

  // Insert in batches to keep each statement's bind-parameter count well-bounded.
  const all = [...untagged, ...inScope];
  for (let i = 0; i < all.length; i += 500) {
    await referenceRepo.upsertChunks(all.slice(i, i + 500));
  }

  const hits = await referenceRepo.searchByVector(CODE, oneHot(0), 3, { cloId: 'CLO-RARE' });
  assert.equal(hits.length, 3, 'iterative scan returns the full in-scope topN despite a saturated ANN window');
  assert.deepEqual(
    hits.map((h) => h.chunk_id).sort(),
    ['big_s0', 'big_s1', 'big_s2'],
    'only the rare in-scope chunks are returned'
  );
});

// ---------------------------------------------------------------------------
// Ranking parity (Postgres pgvector vs JsonCosine) + storage round-trip.
// Gate before deleting JsonCosineStore: prove the pgvector ANN ordering matches
// exact in-process cosine over the SAME rows so a backend switch never reorders.
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) so seeded vectors are reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Dense 1536-dim vector with components in [-1, 1] from a seeded PRNG. */
function denseVec(seed: number): number[] {
  const rng = makeRng(seed);
  return Array.from({ length: DIM }, () => rng() * 2 - 1);
}

test('pgvector top-k ordering matches JsonCosine over the same rows (parity gate)', { skip: dbSkip }, async () => {
  await referenceRepo.saveDocument(doc(), 'text');

  // 10 chunks with distinct dense embeddings — tie-free cosine ranking.
  const chunks: ReferenceChunk[] = Array.from({ length: 10 }, (_, i) => ({
    ...chunk(`p${i}`, 0),
    embedding: denseVec(1000 + i),
  }));
  await referenceRepo.upsertChunks(chunks);

  const pg = getStoreForBackend('postgres');
  const json = getStoreForBackend('json');
  const TOPK = 5;

  // 8 deterministic query vectors.
  for (let q = 0; q < 8; q++) {
    const query = denseVec(50_000 + q);
    const [pgHits, jsonHits] = await Promise.all([
      pg.query(CODE, query, TOPK),
      json.query(CODE, query, TOPK),
    ]);
    assert.deepEqual(
      pgHits.map((h) => h.chunk_id),
      jsonHits.map((h) => h.chunk_id),
      `top-${TOPK} ordering matches for query ${q}`
    );
  }
});

test('chunk embedding + scope arrays round-trip through Postgres', { skip: dbSkip }, async () => {
  await referenceRepo.saveDocument(doc(), 'text');

  const embedding = denseVec(777);
  const written: ReferenceChunk = {
    ...chunk('rt0', 0),
    embedding,
    clo_ids: ['CLO-A', 'CLO-B'],
    subtopic_ids: ['ST-1', 'ST-2', 'ST-3'],
  };
  await referenceRepo.upsertChunks([written]);

  const rows = await referenceRepo.getChunksByDoc('d1');
  const got = rows.find((c) => c.chunk_id === 'rt0');
  assert.ok(got, 'chunk read back by doc');

  // vector fromDriver → number[] of the right shape.
  assert.ok(Array.isArray(got!.embedding), 'embedding is an array');
  assert.equal(got!.embedding.length, DIM, 'embedding keeps its dimensionality');
  assert.equal(typeof got!.embedding[0], 'number', 'embedding components are numbers');
  // float4 storage → assert values round-trip within tolerance.
  for (let i = 0; i < DIM; i += 137) {
    assert.ok(Math.abs(got!.embedding[i] - embedding[i]) < 1e-5, `component ${i} round-trips`);
  }

  // text[] columns → string arrays preserved in order.
  assert.deepEqual(got!.clo_ids, ['CLO-A', 'CLO-B'], 'clo_ids round-trip');
  assert.deepEqual(got!.subtopic_ids, ['ST-1', 'ST-2', 'ST-3'], 'subtopic_ids round-trip');
});
