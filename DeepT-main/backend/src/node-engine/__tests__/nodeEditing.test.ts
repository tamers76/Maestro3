import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from '../../models/nodeEngine.js';
import { EDITED_REOPEN_REASON, markNodeReopenedAfterEdit } from '../nodeEditing.service.js';

function minimalNode(overrides: Partial<Node> = {}): Node {
  return {
    node_id: 'node_1',
    parent_subtopic_id: 'ST1',
    clo_ids: ['CLO-1'],
    node_type: 'concept',
    node_title: 'Node 1',
    order: 0,
    is_core: true,
    knowledge_component: 'kc',
    kc_ids: ['kc_1'],
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
    review_priority: 'can_proceed',
    review_reasons: [],
    status: 'approved',
    ...overrides,
  };
}

test('markNodeReopenedAfterEdit revokes approval and prepends edit reason', () => {
  const node = minimalNode({
    review_priority: 'can_proceed',
    review_reasons: ['Weak or thin grounding'],
  });
  markNodeReopenedAfterEdit(node);
  assert.equal(node.status, 'needs_revision');
  assert.equal(node.review_priority, 'must_review');
  assert.equal(node.sme_edited, true);
  assert.ok(node.sme_edited_at);
  assert.equal(node.review_reasons[0], EDITED_REOPEN_REASON);
  assert.ok(node.review_reasons.includes('Weak or thin grounding'));
});

test('markNodeReopenedAfterEdit dedupes repeated edit reason', () => {
  const node = minimalNode({
    review_reasons: [EDITED_REOPEN_REASON, 'High-severity misconception'],
  });
  markNodeReopenedAfterEdit(node);
  assert.equal(node.review_reasons.filter((r: string) => r === EDITED_REOPEN_REASON).length, 1);
  assert.ok(node.review_reasons.includes('High-severity misconception'));
});
