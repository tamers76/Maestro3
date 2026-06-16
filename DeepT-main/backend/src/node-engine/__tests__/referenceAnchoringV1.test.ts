/**
 * Reference Anchoring V1.0 tests (run with: npm test).
 *
 * node:test via tsx — hermetic (no live embedding provider, no DB, no OpenAI):
 *  1. BM25 keyword search: an exact-term chunk outranks a thematically-similar one.
 *  2. Hybrid fusion (pure fuseHybrid): match_reason is correct and a both-signal
 *     chunk ranks above single-signal chunks.
 *  3. Contextual embeddings: buildEnrichedText shape + the batch helper does NOT
 *     regenerate a header when content_hash matches (injected counting fake).
 *  4. Dedup: two near-identical docs form ONE group with a deterministic canonical;
 *     an unrelated doc is not grouped.
 *  5. Backfill idempotency: reembedCourseWithContext over already-contextualized
 *     chunks makes 0 header calls / 0 re-embeds (no live deps exercised).
 *
 * All filesystem tests use self-cleaning temp courses (mirrors withTempCourse in
 * referenceGrounding.test.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

import type { ReferenceChunk, ReferenceDocument, ReferenceManifest } from '../../models/schemas.js';
import { keywordSearch } from '../../services/keywordSearch.service.js';
import { fuseHybrid } from '../../services/referenceRetrieval.service.js';
import {
  buildEnrichedText,
  computeContentHash,
  generateContextHeadersForChunks,
  CONTEXT_SEPARATOR,
} from '../../services/contextualEmbedding.service.js';
import { detectDuplicateDocuments } from '../../services/referenceDedup.service.js';
import { reembedCourseWithContext } from '../../services/referenceIngestion.service.js';
import * as fileService from '../../services/file.service.js';

const DATA_DIR = join(process.cwd(), '..', 'data', 'courses');

function withTempCourse(code: string, fn: () => void | Promise<void>): void | Promise<void> {
  const dir = join(DATA_DIR, code);
  const cleanup = () => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
  } catch (error) {
    cleanup();
    throw error;
  }
}

function makeChunk(overrides: Partial<ReferenceChunk> & Pick<ReferenceChunk, 'chunk_id' | 'doc_id' | 'text'>): ReferenceChunk {
  return {
    course_code: 'TMP',
    seq: 0,
    token_estimate: overrides.text.length,
    citation: 'Doc — passage',
    clo_ids: [],
    subtopic_ids: [],
    embedding: [0.1, 0.2, 0.3],
    ...overrides,
  };
}

function makeDoc(overrides: Partial<ReferenceDocument> & Pick<ReferenceDocument, 'doc_id'>): ReferenceDocument {
  return {
    course_code: 'TMP',
    title: 'Doc',
    source_type: 'textbook_chapter',
    citation_label: 'Doc',
    scope: { clo_ids: [], subtopic_ids: [] },
    original_filename: 'doc.pdf',
    mime_type: 'application/pdf',
    uploaded_at: '2026-01-01T00:00:00.000Z',
    char_count: 100,
    chunk_count: 2,
    embedding_model: 'text-embedding-3-small',
    embedding_dimensions: 3,
    ...overrides,
  };
}

// ===========================================================================
// 1. BM25 keyword search
// ===========================================================================

test('BM25: a chunk with the exact query term outranks a thematically-similar one', () => {
  const candidates = [
    {
      chunk_id: 'exact',
      text: 'The mitochondria is the powerhouse of the cell and synthesizes ATP for energy.',
    },
    {
      chunk_id: 'thematic',
      text: 'Cellular energy production occurs through a variety of biological structures and processes.',
    },
  ];

  const { scores, matchedTerms } = keywordSearch('mitochondria ATP', candidates);

  assert.ok(scores.has('exact'), 'exact-term chunk is scored');
  assert.ok(
    (scores.get('exact') ?? 0) > (scores.get('thematic') ?? 0),
    'exact-term chunk outranks the thematically-similar chunk'
  );
  assert.deepEqual(matchedTerms.get('exact')?.sort(), ['atp', 'mitochondria']);
});

// ===========================================================================
// 2. Hybrid fusion (pure)
// ===========================================================================

test('fuseHybrid: match_reason is correct and the both-signal chunk ranks first', () => {
  const chunkById = new Map<string, ReferenceChunk>([
    ['both', makeChunk({ chunk_id: 'both', doc_id: 'd', text: 'both signals fire here' })],
    ['semOnly', makeChunk({ chunk_id: 'semOnly', doc_id: 'd', text: 'semantic only passage' })],
    ['kwOnly', makeChunk({ chunk_id: 'kwOnly', doc_id: 'd', text: 'keyword only passage' })],
  ]);

  const semanticHits = [
    { chunk_id: 'both', score: 0.92 },
    { chunk_id: 'semOnly', score: 0.81 },
  ];
  const keyword = {
    scores: new Map<string, number>([
      ['both', 6.0],
      ['kwOnly', 4.5],
    ]),
    matchedTerms: new Map<string, string[]>([
      ['both', ['x']],
      ['kwOnly', ['x']],
    ]),
  };

  const results = fuseHybrid({ semanticHits, keyword, chunkById, topN: 10 });
  const byId = new Map(results.map((r) => [r.chunk_id, r]));

  assert.equal(byId.get('both')?.match_reason, 'semantic+keyword agree');
  assert.equal(byId.get('semOnly')?.match_reason, 'semantic only');
  assert.equal(byId.get('kwOnly')?.match_reason, 'keyword only');

  assert.equal(results[0].chunk_id, 'both', 'both-signal chunk ranks above single-signal chunks');
  // Back-compat: score mirrors final_score for existing callers.
  assert.equal(results[0].score, results[0].final_score);
});

// ===========================================================================
// 3. Contextual embeddings
// ===========================================================================

test('buildEnrichedText === header + "\\n---\\n" + text', () => {
  assert.equal(buildEnrichedText('HEADER', 'TEXT'), `HEADER${CONTEXT_SEPARATOR}TEXT`);
  assert.equal(buildEnrichedText('HEADER', 'TEXT'), 'HEADER\n---\nTEXT');
});

test('batch header helper does NOT regenerate when content_hash matches (cache hit)', async () => {
  const text = 'A reference passage about adaptive leadership in schools.';
  const hash = computeContentHash(text);

  let calls = 0;
  const fake = async () => {
    calls += 1;
    return 'FRESH HEADER';
  };

  // Cache hit: existing hash matches + a stored header is present → no generation.
  const hit = await generateContextHeadersForChunks(
    [{ key: 'a', docTitle: 'Doc', text, existingContentHash: hash, existingHeader: 'CACHED HEADER' }],
    { generateHeader: fake }
  );
  assert.equal(hit[0].cacheHit, true);
  assert.equal(hit[0].header, 'CACHED HEADER');
  assert.equal(calls, 0, 'no LLM call on a cache hit');

  // Cache miss: stored hash differs → regenerate once.
  const miss = await generateContextHeadersForChunks(
    [{ key: 'b', docTitle: 'Doc', text, existingContentHash: 'stale', existingHeader: 'CACHED HEADER' }],
    { generateHeader: fake }
  );
  assert.equal(miss[0].cacheHit, false);
  assert.equal(miss[0].header, 'FRESH HEADER');
  assert.equal(miss[0].contentHash, hash);
  assert.equal(calls, 1, 'exactly one LLM call on a cache miss');
});

// ===========================================================================
// 4. Dedup (detect + report only)
// ===========================================================================

test('detectDuplicateDocuments groups near-identical docs with a deterministic canonical', () => {
  const CODE = 'DEDUPTEST';
  withTempCourse(CODE, () => {
    const dupTextA = 'Adaptive leadership requires distributing authority across the school.';
    const dupTextB = 'Deeper learning is supported by coherent instructional systems.';

    const docA = makeDoc({
      doc_id: 'docA',
      course_code: CODE,
      uploaded_at: '2026-06-12T10:00:00.000Z',
      char_count: 120,
      chunk_count: 2,
    });
    const docB = makeDoc({
      doc_id: 'docB',
      course_code: CODE,
      uploaded_at: '2026-06-12T11:00:00.000Z',
      char_count: 120,
      chunk_count: 2,
    });
    const docC = makeDoc({
      doc_id: 'docC',
      course_code: CODE,
      uploaded_at: '2026-06-12T12:00:00.000Z',
      char_count: 5000,
      chunk_count: 2,
    });

    const manifest: ReferenceManifest = {
      course_code: CODE,
      documents: [docA, docB, docC],
      vector_backend: 'json',
      updated_at: '2026-06-12T12:00:00.000Z',
    };
    fileService.saveReferenceManifest(CODE, manifest);

    fileService.saveReferenceChunks(CODE, 'docA', [
      makeChunk({ chunk_id: 'a0', doc_id: 'docA', course_code: CODE, text: dupTextA }),
      makeChunk({ chunk_id: 'a1', doc_id: 'docA', course_code: CODE, text: dupTextB }),
    ]);
    // docB carries the SAME content (a re-upload) with slightly different whitespace.
    fileService.saveReferenceChunks(CODE, 'docB', [
      makeChunk({ chunk_id: 'b0', doc_id: 'docB', course_code: CODE, text: `  ${dupTextA}  ` }),
      makeChunk({ chunk_id: 'b1', doc_id: 'docB', course_code: CODE, text: dupTextB }),
    ]);
    fileService.saveReferenceChunks(CODE, 'docC', [
      makeChunk({ chunk_id: 'c0', doc_id: 'docC', course_code: CODE, text: 'A completely unrelated discussion of marine biology.' }),
      makeChunk({ chunk_id: 'c1', doc_id: 'docC', course_code: CODE, text: 'Coral reefs host diverse ecosystems in warm shallow seas.' }),
    ]);

    const report = detectDuplicateDocuments(CODE);
    assert.equal(report.duplicate_group_count, 1, 'exactly one duplicate group');

    const group = report.groups[0];
    assert.deepEqual(group.doc_ids.sort(), ['docA', 'docB']);
    assert.ok(!group.doc_ids.includes('docC'), 'unrelated doc is not grouped');
    // Equal chunk_count → earlier uploaded_at wins → docA.
    assert.equal(group.suggested_canonical_doc_id, 'docA');
    assert.ok(group.similarity >= 0.9, 'high similarity reported');
  });
});

// ===========================================================================
// 5. Backfill idempotency
// ===========================================================================

test('reembedCourseWithContext is idempotent: 0 header calls / 0 re-embeds when nothing changed', async () => {
  const CODE = 'REEMBEDIDEM';
  await withTempCourse(CODE, async () => {
    const t0 = 'Foundational concept passage for the course.';
    const t1 = 'An applied example that builds on the foundation.';

    const manifest: ReferenceManifest = {
      course_code: CODE,
      documents: [makeDoc({ doc_id: 'd1', course_code: CODE, chunk_count: 2, contextual_embeddings: true })],
      vector_backend: 'json',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    fileService.saveReferenceManifest(CODE, manifest);

    // Pre-seed as already-contextualized: header present + content_hash matches text.
    fileService.saveReferenceChunks(CODE, 'd1', [
      makeChunk({
        chunk_id: 'd1-C0', doc_id: 'd1', course_code: CODE, seq: 0, text: t0,
        context_header: 'Existing header 0', content_hash: computeContentHash(t0),
      }),
      makeChunk({
        chunk_id: 'd1-C1', doc_id: 'd1', course_code: CODE, seq: 1, text: t1,
        context_header: 'Existing header 1', content_hash: computeContentHash(t1),
      }),
    ]);

    const first = await reembedCourseWithContext(CODE);
    assert.equal(first.docs, 1);
    assert.equal(first.chunks, 2);
    assert.equal(first.headersGenerated, 0, 'no header LLM calls when cache is warm');
    assert.equal(first.reembedded, 0, 'no re-embeds when nothing changed');
    assert.equal(first.cacheHits, 2);

    // Second run is likewise a no-op.
    const second = await reembedCourseWithContext(CODE);
    assert.equal(second.headersGenerated, 0);
    assert.equal(second.reembedded, 0);
  });
});
