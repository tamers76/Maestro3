/**
 * Review-by-exception triage tests (Issue 1). Run with: npm test.
 *
 * Pure + hermetic: covers each must_review rule and a clean can_proceed node.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseNode, type Assessment, type Node } from '../../models/nodeEngine.js';
import {
  deriveNodeReviewTriage,
  assessmentLooksSummative,
  type NodeReviewTriageContext,
} from '../nodeReviewTriage.service.js';

/** A clean, schema-valid, can_proceed-by-default node with overrides applied. */
function makeNode(overrides: Partial<Node> = {}): Node {
  const base = {
    node_id: 'node_1',
    parent_subtopic_id: 'CLO1-ST2',
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
    grounding_strength: 'strong',
    risk_classification: ['standard'],
    status: 'draft',
  };
  return parseNode({ ...JSON.parse(JSON.stringify(base)), ...JSON.parse(JSON.stringify(overrides)) });
}

const blockingBinding = {
  misconception_id: 'm1',
  statement: 's',
  severity: 'high' as const,
  trap: 't',
  expected_error_pattern: 'e',
  confirming_probe: 'p',
  blocks_submission_if_state: 'confirmed' as const,
  clearance_rule: 'r',
};

// ===========================================================================
// can_proceed baseline
// ===========================================================================

test('a clean, strongly-grounded node is can_proceed with no reasons', () => {
  const triage = deriveNodeReviewTriage(makeNode());
  assert.equal(triage.review_priority, 'can_proceed');
  assert.deepEqual(triage.review_reasons, []);
})

// ===========================================================================
// must_review rules (each in isolation)
// ===========================================================================

test('rule 1: assessment-blocking misconception → must_review', () => {
  const triage = deriveNodeReviewTriage(makeNode({ misconception_bindings: [blockingBinding] }))
  assert.equal(triage.review_priority, 'must_review')
  assert.ok(triage.review_reasons.includes('Assessment-blocking misconception'))
})

test('rule 2: high-severity misconception on an assessment-facing node', () => {
  const node = makeNode({
    prepares_for_assessment_id: 'A1',
    candidate_misconceptions: [
      { candidate_misconception_id: 'c1', statement: 's', reason: 'r', severity: 'high' },
    ],
  })
  const triage = deriveNodeReviewTriage(node)
  assert.equal(triage.review_priority, 'must_review')
  assert.ok(triage.review_reasons.includes('High-severity misconception on assessment node'))
})

test('rule 3: high-severity candidate misconception (no assessment) → must_review', () => {
  const node = makeNode({
    candidate_misconceptions: [
      { candidate_misconception_id: 'c1', statement: 's', reason: 'r', severity: 'high' },
    ],
  })
  const triage = deriveNodeReviewTriage(node)
  assert.equal(triage.review_priority, 'must_review')
  assert.ok(triage.review_reasons.includes('High-severity misconception'))
})

test('rule 4: weak grounding → must_review', () => {
  const triage = deriveNodeReviewTriage(makeNode({ grounding_strength: 'weak' }))
  assert.ok(triage.review_reasons.includes('Weak or thin grounding'))
  assert.equal(triage.review_priority, 'must_review')
})

test('rule 4: course-level (fallback) node-set grounding source → must_review', () => {
  const ctx: NodeReviewTriageContext = { groundingSource: 'course_level_references' }
  const triage = deriveNodeReviewTriage(makeNode(), ctx)
  assert.ok(triage.review_reasons.includes('Weak or thin grounding'))
})

test('rule 5: generator uncertainty on a high-stakes (critical) node', () => {
  const node = makeNode({
    generator_divergence_note: 'chose distinction over judgment',
    risk_classification: ['critical'],
  })
  const triage = deriveNodeReviewTriage(node)
  assert.ok(triage.review_reasons.includes('Generator uncertainty on high-stakes node'))
})

test('rule 5 does NOT fire for a divergence note on a standard, non-assessment node', () => {
  const node = makeNode({ generator_divergence_note: 'minor note' })
  const triage = deriveNodeReviewTriage(node)
  assert.equal(triage.review_priority, 'can_proceed')
})

test('rule 6: prepares for a summative assessment → must_review', () => {
  const assessment: Assessment = {
    assessment_id: 'A1',
    course_id: 'TST',
    label: 'A1',
    type: 'Final Summative Exam',
    status: 'approved',
    clo_ids: ['CLO-1'],
  }
  const ctx: NodeReviewTriageContext = {
    assessmentsById: new Map([['A1', assessment]]),
  }
  const triage = deriveNodeReviewTriage(makeNode({ prepares_for_assessment_id: 'A1' }), ctx)
  assert.ok(triage.review_reasons.includes('Prepares for a summative assessment'))
})

test('rule 6 does NOT fire when summative-ness cannot be established', () => {
  const assessment: Assessment = {
    assessment_id: 'A1',
    course_id: 'TST',
    label: 'A1',
    type: 'reflective journal',
    status: 'approved',
    clo_ids: ['CLO-1'],
  }
  const ctx: NodeReviewTriageContext = { assessmentsById: new Map([['A1', assessment]]) }
  const triage = deriveNodeReviewTriage(makeNode({ prepares_for_assessment_id: 'A1' }), ctx)
  assert.equal(triage.review_priority, 'can_proceed')
})

test('assessmentLooksSummative heuristic: keywords + non-trivial weighting', () => {
  assert.equal(assessmentLooksSummative({ type: 'Final Exam', label: 'A1' }), true)
  assert.equal(assessmentLooksSummative({ type: 'essay', label: 'A1', weighting: '40%' }), true)
  assert.equal(assessmentLooksSummative({ type: 'quiz', label: 'A1', weighting: '5%' }), false)
  assert.equal(assessmentLooksSummative({ type: 'quiz', label: 'A1' }), false)
  assert.equal(assessmentLooksSummative(undefined), false)
})

test('reasons dedupe and multiple rules can stack', () => {
  const node = makeNode({
    prepares_for_assessment_id: 'A1',
    grounding_strength: 'weak',
    misconception_bindings: [blockingBinding],
    candidate_misconceptions: [
      { candidate_misconception_id: 'c1', statement: 's', reason: 'r', severity: 'high' },
    ],
  })
  const triage = deriveNodeReviewTriage(node)
  assert.equal(triage.review_priority, 'must_review')
  // distinct reasons, no duplicates
  assert.equal(new Set(triage.review_reasons).size, triage.review_reasons.length)
  assert.ok(triage.review_reasons.length >= 3)
})
