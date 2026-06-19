import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from '../../models/nodeEngine.js';
import {
  projectBlueprintFromNode,
  validateBlueprintObjects,
  BlueprintValidationError,
} from '../nodeBlueprint.service.js';

function minimalNode(overrides: Partial<Node> = {}): Node {
  return {
    node_id: 'node_distinction_1',
    parent_subtopic_id: 'ST1',
    clo_ids: ['CLO-1'],
    node_type: 'distinction',
    node_title: 'Distinguish description from critical evaluation',
    order: 1,
    is_core: true,
    knowledge_component: 'Separate descriptive summary from evaluative judgment',
    kc_ids: ['kc_distinction_1'],
    mastery_statement: 'Learner distinguishes description from evaluation.',
    why_it_matters: 'Summative work requires both.',
    assessment_connection: 'Prepares for A2 critical report.',
    core_academic_message: 'Description reports; evaluation judges.',
    evidence_map: [],
    captured_signals: ['response', 'reasoning'],
    prerequisite_node_ids: [],
    dependent_node_ids: [],
    cross_clo_links: [],
    primary_evidence_check_requirement: {
      evidence_check_id: 'ec_node_node_distinction_1_primary',
      must_capture_signals: ['response', 'reasoning', 'confidence'],
      preferred_evidence_mode: 'classify_and_justify',
      diagnostic_bands: ['secure', 'fragile', 'knowledge_gap', 'misconception'],
    },
    misconception_slots: 'pending',
    candidate_misconceptions: [
      {
        candidate_misconception_id: 'cand_1',
        statement: 'Description and evaluation are the same',
        reason: 'Common conflation in early drafts',
      },
    ],
    misconception_bindings: [],
    grounding_references: [],
    risk_classification: ['standard'],
    review_priority: 'can_proceed',
    review_reasons: [],
    status: 'approved',
    ...overrides,
  };
}

test('projectBlueprintFromNode includes mandatory primary evidence check', () => {
  const node = minimalNode();
  const objects = projectBlueprintFromNode(node);
  const primary = objects.filter((o) => o.is_primary_evidence_check);
  assert.equal(primary.length, 1);
  assert.equal(primary[0].object_id, 'ec_node_node_distinction_1_primary');
  assert.equal(primary[0].node_object_purpose, 'evidence_check');
  assert.equal(primary[0].suggested_vehicle, 'interactive');
  validateBlueprintObjects(objects, node);
});

test('projectBlueprintFromNode assigns purpose and vehicle on every object', () => {
  const node = minimalNode();
  const objects = projectBlueprintFromNode(node);
  assert.ok(objects.length >= 4);
  for (const obj of objects) {
    assert.ok(obj.suggested_vehicle);
    if (obj.object_family === 'node_learning_object') {
      assert.ok(obj.node_object_purpose);
    }
  }
});

test('validateBlueprintObjects rejects missing primary EC', () => {
  const node = minimalNode();
  const objects = projectBlueprintFromNode(node).map((o) =>
    o.is_primary_evidence_check ? { ...o, is_primary_evidence_check: false } : o
  );
  assert.throws(
    () => validateBlueprintObjects(objects, node),
    (err: unknown) => err instanceof BlueprintValidationError
  );
});

test('misconception nodes include remediation object', () => {
  const node = minimalNode({ node_type: 'misconception' });
  const objects = projectBlueprintFromNode(node);
  assert.ok(objects.some((o) => o.node_object_purpose === 'remediation'));
});
