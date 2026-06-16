/**
 * Stage 1 → V1 adapter tests (run with: npm test).
 *
 * Two halves, mirroring phase0.test.ts patterns (node:test via tsx):
 * 1. The new parse* validators round-trip and reject invalid enums.
 * 2. The read-only adapter runs against the real, fully-approved MDLD602
 *    artifacts — asserting subtopic count, ID pass-through (CLO1-ST1, CLO-1,
 *    frozen A1), preserved grounding context, all-approved gating, and that
 *    the run is deterministic and writes NOTHING (artifacts untouched).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readdirSync } from 'fs';
import { join } from 'path';

import {
  parseCourseAcademicContract,
  parseCLO,
  parseAssessment,
  parseSubtopic,
  NodeEngineValidationError,
  type CourseAcademicContract,
  type CLO,
  type Assessment,
  type Subtopic,
} from '../../models/nodeEngine.js';
import {
  buildV1Contract,
  buildV1CLOs,
  buildV1Assessments,
  buildV1Subtopics,
  buildV1ContractBundle,
} from '../stage1Adapter.service.js';

const COURSE = 'MDLD602';
const STAGE1_DIR = join(process.cwd(), '..', 'data', 'courses', COURSE, 'stage1');

// ===========================================================================
// 1. parse* validators — round-trip + enum rejection
// ===========================================================================

function sampleContract(): CourseAcademicContract {
  return {
    course_id: 'MDLD602',
    title: 'Leadership of Innovative Curriculum Design and Instruction',
    level: 'postgraduate',
    clo_ids: ['CLO-1', 'CLO-2'],
    assessment_ids: ['A1', 'A2'],
    status: 'approved',
    source_doc_ref: 'extracted/snapshot.json',
    program_id: 'MDLD',
    notes: 'projected',
  };
}

function sampleCLO(): CLO {
  return {
    clo_id: 'CLO-1',
    course_id: 'MDLD602',
    statement: 'Critically analyse multiple contemporary frameworks...',
    status: 'approved',
    bloom_level: 'Analyze',
    aligned_assessment_ids: ['A1'],
    rationale: 'Added specificity\nClarified scope',
  };
}

function sampleAssessment(): Assessment {
  return {
    assessment_id: 'A1',
    course_id: 'MDLD602',
    label: 'A1',
    type: 'Critique',
    status: 'approved',
    weighting: '15%',
    clo_ids: ['CLO-1'],
    milestone_pack_id: 'mp_A1',
  };
}

function sampleSubtopic(): Subtopic {
  return {
    subtopic_id: 'CLO1-ST1',
    course_id: 'MDLD602',
    clo_ids: ['CLO-1'],
    title: 'Contemporary Curriculum Framework Foundations',
    order: 0,
    status: 'approved',
    description: 'Master the theoretical underpinnings...',
    purpose: 'Master the theoretical underpinnings...',
    expected_learning: 'Identify core theoretical principles...',
    learning_function: 'foundational',
    assessment_connection: ['A1'],
    cross_clo_links: [{ linked_clo_id: 'CLO-2', reason: 'supports methodology' }],
    possible_node_families: ['concept', 'judgment'],
    source_evidence: ['refined_clo', 'assessment', 'syllabus'],
    cognitive_level: 'Analyze',
    node_ids: [],
  };
}

test('parseCourseAcademicContract round-trips through parse + JSON', () => {
  const original = sampleContract();
  assert.deepEqual(parseCourseAcademicContract(JSON.parse(JSON.stringify(original))), original);
});

test('parseCLO round-trips through parse + JSON', () => {
  const original = sampleCLO();
  assert.deepEqual(parseCLO(JSON.parse(JSON.stringify(original))), original);
});

test('parseAssessment round-trips through parse + JSON', () => {
  const original = sampleAssessment();
  assert.deepEqual(parseAssessment(JSON.parse(JSON.stringify(original))), original);
});

test('parseSubtopic round-trips through parse + JSON', () => {
  const original = sampleSubtopic();
  assert.deepEqual(parseSubtopic(JSON.parse(JSON.stringify(original))), original);
});

test('parse* validators reject invalid enum values', () => {
  assert.throws(
    () => parseCourseAcademicContract({ ...sampleContract(), status: 'published' }),
    NodeEngineValidationError
  );
  assert.throws(() => parseCLO({ ...sampleCLO(), status: 'bogus' }), NodeEngineValidationError);
  assert.throws(
    () => parseAssessment({ ...sampleAssessment(), status: 'pending' }),
    NodeEngineValidationError
  );
  assert.throws(
    () => parseSubtopic({ ...sampleSubtopic(), status: 'pending' }),
    NodeEngineValidationError
  );
});

test('parse* validators reject missing required fields', () => {
  const { clo_id, ...noId } = sampleCLO();
  assert.throws(() => parseCLO(noId), NodeEngineValidationError);
  const { order, ...noOrder } = sampleSubtopic();
  assert.throws(() => parseSubtopic(noOrder), NodeEngineValidationError);
});

// ===========================================================================
// 2. Adapter against the real, all-approved MDLD602 artifacts
// ===========================================================================

test('buildV1Subtopics: 19 approved subtopics with preserved grounding + IDs', () => {
  const subtopics = buildV1Subtopics(COURSE);
  assert.equal(subtopics.length, 19, 'MDLD602 has 19 subtopics');

  // ID pass-through + order derivation.
  const first = subtopics[0];
  assert.equal(first.subtopic_id, 'CLO1-ST1');
  assert.equal(first.order, 0);
  assert.equal(subtopics[subtopics.length - 1].order, 18);
  assert.deepEqual(first.clo_ids, ['CLO-1']);
  assert.equal(first.course_id, COURSE);
  assert.equal(first.title, 'Contemporary Curriculum Framework Foundations');

  // Preserved grounding context (the reason we read the rich Layer 6 file).
  assert.ok(first.purpose.length > 0, 'purpose preserved');
  assert.ok(first.expected_learning.length > 0, 'expected_learning preserved');
  assert.equal(first.learning_function, 'foundational');
  assert.deepEqual(first.assessment_connection, ['A1']);
  assert.ok(first.source_evidence.length > 0, 'source_evidence preserved');
  assert.ok(first.cross_clo_links.length > 0, 'cross_clo_links preserved');
  assert.equal(first.cross_clo_links[0].linked_clo_id, 'CLO-2');

  // `_node` suffix stripped so families line up with NODE_TYPES.
  assert.deepEqual(first.possible_node_families, ['concept', 'judgment']);

  // cognitive_level derived from the parent CLO bloom level; node_ids empty (M7).
  assert.equal(first.cognitive_level, 'Analyze');
  assert.deepEqual(first.node_ids, []);

  // All-approved gating holds at the subtopic level.
  assert.ok(
    subtopics.every((s) => s.status === 'approved'),
    'every MDLD602 subtopic is approved'
  );
});

test('buildV1CLOs: 5 CLOs with refined statements, rationale, reverse-indexed assessments', () => {
  const clos = buildV1CLOs(COURSE);
  assert.equal(clos.length, 5);

  const clo1 = clos.find((c) => c.clo_id === 'CLO-1')!;
  assert.ok(clo1, 'CLO-1 present (ID pass-through)');
  assert.equal(clo1.course_id, COURSE);
  assert.equal(clo1.status, 'approved');
  assert.equal(clo1.bloom_level, 'Analyze');
  assert.ok(clo1.statement.length > 0);
  assert.ok((clo1.rationale ?? '').length > 0, 'refinement rationale joined');
  assert.deepEqual(clo1.aligned_assessment_ids, ['A1'], 'reverse-indexed from assessments');

  // CLO-4 is fed by A4 (the final project aligns to CLO-4 and CLO-5).
  const clo4 = clos.find((c) => c.clo_id === 'CLO-4')!;
  assert.ok(clo4.aligned_assessment_ids.includes('A4'));
});

test('buildV1Assessments: 4 assessments with frozen positional IDs + approved weights', () => {
  const assessments = buildV1Assessments(COURSE);
  assert.equal(assessments.length, 4);

  const a1 = assessments[0];
  assert.equal(a1.assessment_id, 'A1', 'frozen positional id');
  assert.equal(a1.label, 'A1');
  assert.equal(a1.course_id, COURSE);
  assert.equal(a1.status, 'approved');
  assert.equal(a1.weighting, '15%', 'approved weight carried verbatim');
  assert.deepEqual(a1.clo_ids, ['CLO-1'], 'parsed from refined_clo_alignment');

  // A4 aligns to both CLO-5 and CLO-4 (order preserved from the alignment).
  const a4 = assessments[3];
  assert.equal(a4.assessment_id, 'A4');
  assert.equal(a4.weighting, '40%');
  assert.deepEqual(a4.clo_ids, ['CLO-5', 'CLO-4']);
});

test('buildV1Contract: root contract with flattened ids + approved gating', () => {
  const contract = buildV1Contract(COURSE);
  assert.equal(contract.course_id, COURSE);
  assert.ok(contract.title.length > 0);
  assert.equal(contract.level, 'postgraduate');
  assert.deepEqual(contract.clo_ids, ['CLO-1', 'CLO-2', 'CLO-3', 'CLO-4', 'CLO-5']);
  assert.deepEqual(contract.assessment_ids, ['A1', 'A2', 'A3', 'A4']);
  // Every upstream Stage 1 layer is approved → contract is approved.
  assert.equal(contract.status, 'approved');
});

test('buildV1ContractBundle is deterministic and read-only (no artifact writes)', () => {
  const fileMtimesBefore = readdirSync(STAGE1_DIR).map((f) => [
    f,
    statSync(join(STAGE1_DIR, f)).mtimeMs,
  ]);

  const a = buildV1ContractBundle(COURSE);
  const b = buildV1ContractBundle(COURSE);
  assert.deepEqual(a, b, 'projection is deterministic across repeated runs');

  // No new files and no modified files in the Stage 1 directory.
  const fileMtimesAfter = readdirSync(STAGE1_DIR).map((f) => [
    f,
    statSync(join(STAGE1_DIR, f)).mtimeMs,
  ]);
  assert.deepEqual(fileMtimesAfter, fileMtimesBefore, 'Stage 1 artifacts untouched');
});
