/**
 * Reference-grounding fix tests (run with: npm test).
 *
 * node:test via tsx — hermetic (no live embedding provider, no DB):
 *  1. Schema: NodeSet grounding-transparency fields round-trip through parseNodeSet.
 *  2. Academic-approval guard: blocks ungrounded approval, permits with an override
 *     reason (recorded) or when a node carries citations.
 *  3. Reference Alignment (Layer 7): dependency state, SME edit (promote / demote /
 *     reassign + CLO inheritance), and approve (writes scope tags + manifest).
 *
 * The cosine PROPOSE step needs a live embedding call, so it is exercised manually
 * (Settings → RAG health + the propose UI), not here; these tests cover the
 * deterministic logic against synthetic, self-cleaning fixtures + the real MDLD602
 * artifacts (read-only).
 */
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { parseNodeSet, type NodeSet } from '../../models/nodeEngine.js';
import {
  approveNodeSet,
  isNodeSetAcademicallyReady,
  AcademicApprovalRequiredError,
} from '../nodeGeneration.service.js';
import { saveNodeSetArtifact } from '../store.service.js';
import { saveCourseArtifact } from '../store.service.js';
import {
  getAlignmentState,
  getAlignmentProposal,
  updateAlignmentMapping,
  approveAlignment,
  DEFAULT_ALIGNMENT_THRESHOLD,
  computeAlignmentStaleness,
  type ReferenceAlignmentArtifact,
} from '../../services/referenceAlignment.service.js';
import * as referenceRepo from '../../db/repos/referenceRepo.js';
import type { ReferenceChunk, ReferenceDocument } from '../../models/schemas.js';
import { dbTestsEnabled, setupTestDb, resetTestData, teardownTestDb } from '../../db/testSupport.js';

const SUBTOPIC = 'CLO1-ST2';

// These exercise Postgres-backed stores (node-sets, alignment artifacts, reference
// docs/chunks), so they run only under RUN_DB_TESTS=1. The schema round-trip and
// the pure academic-readiness checks stay DB-free.
const dbSkip = dbTestsEnabled ? false : 'requires RUN_DB_TESTS=1';
// getAlignmentState reads a pre-seeded MDLD602 course (no source data in the repo).
const seededSkip =
  dbTestsEnabled && process.env.RUN_SEEDED_TESTS === '1'
    ? false
    : 'requires RUN_DB_TESTS=1 + RUN_SEEDED_TESTS=1 (pre-seeded MDLD602)';

before(async () => {
  if (dbTestsEnabled) await setupTestDb();
});
beforeEach(async () => {
  if (dbTestsEnabled) await resetTestData();
});
after(async () => {
  if (dbTestsEnabled) await teardownTestDb();
});

// ---------------------------------------------------------------------------
// A minimal, schema-valid node-set (one node) for guard/schema tests.
// ---------------------------------------------------------------------------
function minimalNodeSet(overrides: Partial<NodeSet> = {}): NodeSet {
  const base = {
    node_set_id: `nodeset_${SUBTOPIC}`,
    course_id: 'TST',
    subtopic_id: SUBTOPIC,
    clo_ids: ['CLO-1'],
    prepares_for_assessment_ids: [],
    generator_divergence_notes: [],
    status: 'draft',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    nodes: [
      {
        node_id: 'node_1',
        parent_subtopic_id: SUBTOPIC,
        clo_ids: ['CLO-1'],
        node_type: 'concept',
        node_title: 'Node 1',
        order: 0,
        is_core: true,
        knowledge_component: 'kc',
        kc_ids: ['kc_node_1'],
        mastery_statement: 'm',
        why_it_matters: 'w',
        assessment_connection: '',
        core_academic_message: 'msg',
        evidence_map: [],
        captured_signals: ['response'],
        prerequisite_node_ids: [],
        dependent_node_ids: [],
        cross_clo_links: [],
        primary_evidence_check_requirement: {
          evidence_check_id: 'ec_node_node_1_primary',
          must_capture_signals: ['response'],
          preferred_evidence_mode: 'explain',
          diagnostic_bands: ['secure'],
        },
        misconception_slots: 'pending',
        candidate_misconceptions: [],
        misconception_bindings: [],
        grounding_references: [],
        risk_classification: ['standard'],
        status: 'draft',
      },
    ],
    ...overrides,
  };
  return parseNodeSet(JSON.parse(JSON.stringify(base)));
}

// ===========================================================================
// 1. Schema round-trip
// ===========================================================================

test('parseNodeSet round-trips grounding_summary + academic override fields', () => {
  const ns = minimalNodeSet({
    grounding_summary: {
      retrieval_called: true,
      scoped_chunk_count: 0,
      course_level_chunk_count: 3,
      citations_count: 2,
      grounding_source: 'course_level_references',
      grounding_note: 'used the course-level safety net',
      academic_ready: true,
    },
    academic_override_reason: 'reviewed manually',
    academic_override_by: 'sme@test',
  } as Partial<NodeSet>);

  assert.equal(ns.grounding_summary?.grounding_source, 'course_level_references');
  assert.equal(ns.grounding_summary?.citations_count, 2);
  assert.equal(ns.grounding_summary?.academic_ready, true);
  assert.equal(ns.academic_override_reason, 'reviewed manually');
});

test('parseNodeSet defaults an invalid grounding_source to model_only', () => {
  const ns = minimalNodeSet({
    // @ts-expect-error intentionally invalid enum for the parse test
    grounding_summary: { grounding_source: 'nonsense', citations_count: 0 },
  });
  assert.equal(ns.grounding_summary?.grounding_source, 'model_only');
});

// ===========================================================================
// 2. Academic-approval guard
// ===========================================================================

test('isNodeSetAcademicallyReady: summary flag, then node citations fallback', () => {
  assert.equal(isNodeSetAcademicallyReady(minimalNodeSet()), false);

  const ready = minimalNodeSet({
    grounding_summary: {
      retrieval_called: true,
      scoped_chunk_count: 2,
      course_level_chunk_count: 0,
      citations_count: 2,
      grounding_source: 'scoped_references',
      grounding_note: '',
      academic_ready: true,
    },
  } as Partial<NodeSet>);
  assert.equal(isNodeSetAcademicallyReady(ready), true);

  // No summary, but a node carries a citation → ready via fallback.
  const node = minimalNodeSet().nodes[0];
  const citedNode = { ...node, grounding_references: [{ citation: 'Smith 2020', passage_ref: 'R1' }] };
  const cited = minimalNodeSet({ nodes: [citedNode] } as Partial<NodeSet>);
  assert.equal(isNodeSetAcademicallyReady(cited), true);
});

test('approveNodeSet blocks ungrounded approval, then permits with an override reason', { skip: dbSkip }, async () => {
  await saveNodeSetArtifact('GUARDTEST', SUBTOPIC, minimalNodeSet());

  await assert.rejects(
    () => approveNodeSet('GUARDTEST', SUBTOPIC, { approver: 'sme@test' }),
    AcademicApprovalRequiredError
  );

  const approved = await approveNodeSet('GUARDTEST', SUBTOPIC, {
    approver: 'sme@test',
    overrideReason: 'no references for this course yet',
  });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.academic_override_reason, 'no references for this course yet');
  assert.equal(approved.academic_override_by, 'sme@test');
});

test('approveNodeSet permits without override when nodes carry citations', { skip: dbSkip }, async () => {
  const node = minimalNodeSet().nodes[0];
  const cited = minimalNodeSet({
    nodes: [{ ...node, grounding_references: [{ citation: 'Ref A', passage_ref: 'R1' }] }],
  } as Partial<NodeSet>);
  await saveNodeSetArtifact('GUARDTEST2', SUBTOPIC, cited);

  const approved = await approveNodeSet('GUARDTEST2', SUBTOPIC, { approver: 'sme@test' });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.academic_override_reason, undefined);
});

// ===========================================================================
// 3. Reference Alignment (Layer 7)
// ===========================================================================

test('computeAlignmentStaleness flags corpus changes after approval', () => {
  const stale = computeAlignmentStaleness({
    artifactStatus: 'approved',
    approved_at: '2026-01-01T00:00:00.000Z',
    corpus_updated_at: '2026-06-01T00:00:00.000Z',
    approved_chunk_count: 100,
    current_chunk_count: 100,
    approved_doc_count: 2,
    current_doc_count: 2,
  });
  assert.equal(stale.is_stale, true);
  assert.ok(stale.stale_reason?.includes('New or updated references'));

  const fresh = computeAlignmentStaleness({
    artifactStatus: 'approved',
    approved_at: '2026-06-02T00:00:00.000Z',
    corpus_updated_at: '2026-06-01T00:00:00.000Z',
    approved_chunk_count: 100,
    current_chunk_count: 100,
    approved_doc_count: 2,
    current_doc_count: 2,
  });
  assert.equal(fresh.is_stale, false);
});

test('computeAlignmentStaleness flags new uploads after a proposed preview', () => {
  const stale = computeAlignmentStaleness({
    artifactStatus: 'proposed',
    proposal_generated_at: '2026-01-01T00:00:00.000Z',
    corpus_updated_at: '2026-06-01T00:00:00.000Z',
    current_chunk_count: 10,
    current_doc_count: 1,
  });
  assert.equal(stale.is_stale, true);
});

test('getAlignmentState reports dependency counts for MDLD602 (read-only)', { skip: seededSkip }, async () => {
  const state = await getAlignmentState('MDLD602');
  assert.ok(state.reference_doc_count > 0, 'MDLD602 has reference docs');
  assert.ok(state.chunk_count > 0, 'MDLD602 has reference chunks');
  assert.equal(state.threshold, DEFAULT_ALIGNMENT_THRESHOLD);
  assert.ok(['locked', 'available', 'proposed', 'approved'].includes(state.status));
  assert.equal(typeof state.active_tagged_chunk_count, 'number');
  assert.equal(typeof state.is_stale, 'boolean');
  assert.equal(typeof state.node_gen_ready, 'boolean');
  assert.equal(typeof state.pending_activation, 'boolean');
});

test('updateAlignmentMapping promotes / reassigns and inherits CLOs only when asked', { skip: dbSkip }, async () => {
  const artifact: ReferenceAlignmentArtifact = {
    course_code: 'ALIGNEDIT',
    status: 'proposed',
    threshold: DEFAULT_ALIGNMENT_THRESHOLD,
    embedding_model: 'text-embedding-3-small',
    embedding_dimensions: 1536,
    subtopic_count: 1,
    reference_doc_count: 1,
    chunk_count: 1,
    tagged_chunk_count: 0,
    mappings: [
      {
        chunk_id: 'c1',
        doc_id: 'd1',
        citation: 'Doc 1',
        text_preview: 'text',
        subtopic_candidates: [{ id: 'ST-A', label: 'A', score: 0.4 }],
        clo_candidates: [],
        confidence: 0.4,
        decided_subtopic_ids: [],
        decided_clo_ids: [],
      },
    ],
  };
  await saveCourseArtifact('ALIGNEDIT', 'reference-alignment.json', artifact);

  // Promote with explicit CLO ids → no V1 bundle needed (temp course has none).
  const updated = await updateAlignmentMapping('ALIGNEDIT', [
    { chunk_id: 'c1', subtopic_ids: ['ST-A'], clo_ids: ['CLO-9'] },
  ]);
  assert.deepEqual(updated.mappings[0].decided_subtopic_ids, ['ST-A']);
  assert.deepEqual(updated.mappings[0].decided_clo_ids, ['CLO-9']);
  assert.equal(updated.mappings[0].edited, true);
  assert.equal(updated.tagged_chunk_count, 1);

  // Demote to course-level (no tag).
  const demoted = await updateAlignmentMapping('ALIGNEDIT', [{ chunk_id: 'c1', subtopic_ids: [], clo_ids: [] }]);
  assert.deepEqual(demoted.mappings[0].decided_subtopic_ids, []);
  assert.equal(demoted.tagged_chunk_count, 0);
});

test('approveAlignment writes scope tags into chunks + document, then re-indexes', { skip: dbSkip }, async () => {
  const CODE = 'ALIGNAPPROVE';

  const doc: ReferenceDocument = {
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
    chunk_count: 2,
    embedding_model: 'text-embedding-3-small',
    embedding_dimensions: 1536,
  };
  await referenceRepo.saveDocument(doc, 'doc text');

  // Empty embeddings: this test asserts scope-tag propagation, not vector search,
  // so we avoid inserting non-1536-dim vectors into the embedding column.
  const chunks: ReferenceChunk[] = [
    {
      chunk_id: 'c1', doc_id: 'd1', course_code: CODE, seq: 0, text: 'a', token_estimate: 1,
      citation: 'Doc 1 p1', clo_ids: [], subtopic_ids: [], embedding: [],
    },
    {
      chunk_id: 'c2', doc_id: 'd1', course_code: CODE, seq: 1, text: 'b', token_estimate: 1,
      citation: 'Doc 1 p2', clo_ids: [], subtopic_ids: [], embedding: [],
    },
  ];
  await referenceRepo.upsertChunks(chunks);

  const artifact: ReferenceAlignmentArtifact = {
    course_code: CODE,
    status: 'proposed',
    threshold: DEFAULT_ALIGNMENT_THRESHOLD,
    embedding_model: 'text-embedding-3-small',
    embedding_dimensions: 1536,
    subtopic_count: 1,
    reference_doc_count: 1,
    chunk_count: 2,
    tagged_chunk_count: 1,
    mappings: [
      {
        chunk_id: 'c1', doc_id: 'd1', citation: 'Doc 1 p1', text_preview: 'a',
        subtopic_candidates: [], clo_candidates: [], confidence: 0.5,
        decided_subtopic_ids: ['ST-A'], decided_clo_ids: ['CLO-1'],
      },
      {
        chunk_id: 'c2', doc_id: 'd1', citation: 'Doc 1 p2', text_preview: 'b',
        subtopic_candidates: [], clo_candidates: [], confidence: 0.1,
        decided_subtopic_ids: [], decided_clo_ids: [],
      },
    ],
  };
  await saveCourseArtifact(CODE, 'reference-alignment.json', artifact);

  await approveAlignment(CODE, { approver: 'sme@test' });

  const written = await referenceRepo.getChunksByDoc('d1');
  const c1 = written.find((c) => c.chunk_id === 'c1')!;
  const c2 = written.find((c) => c.chunk_id === 'c2')!;
  assert.deepEqual(c1.subtopic_ids, ['ST-A']);
  assert.deepEqual(c1.clo_ids, ['CLO-1']);
  assert.deepEqual(c2.subtopic_ids, [], 'low-confidence chunk stays course-level');

  const storedDoc = await referenceRepo.getDocument('d1');
  assert.ok(storedDoc?.scope.subtopic_ids?.includes('ST-A'));

  const approved = await getAlignmentProposal(CODE);
  assert.equal(approved?.status, 'approved');
  assert.equal(approved?.approved_by, 'sme@test');
});
