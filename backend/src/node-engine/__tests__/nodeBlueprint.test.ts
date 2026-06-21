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

test('golden distinction node gets full object sequence when node fields warrant it', () => {
  const node = minimalNode();
  const objects = projectBlueprintFromNode(node);
  const purposes = objects.map((o) => o.node_object_purpose);
  assert.ok(purposes.includes('orientation'));
  assert.ok(purposes.includes('explanation'));
  assert.ok(purposes.includes('remediation'));
  assert.ok(purposes.includes('practice'));
  assert.ok(purposes.includes('assessment_connection'));
  assert.ok(purposes.includes('evidence_check'));
  assert.equal(objects.length, 6);
});

test('projectBlueprintFromNode assigns modality-aware vehicles across the sequence', () => {
  const node = minimalNode();
  const byPurpose = Object.fromEntries(
    projectBlueprintFromNode(node).map((o) => [o.node_object_purpose, o])
  );
  assert.equal(byPurpose.explanation.suggested_vehicle, 'video');
  assert.equal(byPurpose.remediation.suggested_vehicle, 'interactive');
  assert.equal(byPurpose.practice.suggested_vehicle, 'interactive');
  assert.equal(byPurpose.evidence_check.suggested_vehicle, 'interactive');
});

test('procedure nodes use video for worked examples', () => {
  const node = minimalNode({
    node_type: 'procedure',
    candidate_misconceptions: [],
    assessment_connection: '',
  });
  const worked = projectBlueprintFromNode(node).find((o) => o.node_object_purpose === 'worked_example');
  assert.ok(worked);
  assert.equal(worked!.suggested_vehicle, 'video');
});

test('practice uses simulation when primary EC mode is simulation_decision', () => {
  const node = minimalNode({
    primary_evidence_check_requirement: {
      ...minimalNode().primary_evidence_check_requirement,
      preferred_evidence_mode: 'simulation_decision',
    },
  });
  const practice = projectBlueprintFromNode(node).find((o) => o.node_object_purpose === 'practice');
  assert.ok(practice);
  assert.equal(practice!.suggested_vehicle, 'simulation');
});

test('integration nodes suggest structured_visual for explanation', () => {
  const node = minimalNode({
    node_type: 'integration',
    candidate_misconceptions: [],
    assessment_connection: '',
  });
  const explanation = projectBlueprintFromNode(node).find((o) => o.node_object_purpose === 'explanation');
  assert.ok(explanation);
  assert.equal(explanation!.suggested_vehicle, 'structured_visual');
});

test('remediation sets targets_misconception_id only when a misconception exists', () => {
  const node = minimalNode();
  const remediation = projectBlueprintFromNode(node).find((o) => o.node_object_purpose === 'remediation');
  assert.ok(remediation);
  assert.equal(remediation!.targets_misconception_id, 'cand_1');
  const noMisc = minimalNode({ candidate_misconceptions: [], misconception_bindings: [], node_type: 'concept' });
  const objects = projectBlueprintFromNode(noMisc);
  assert.ok(!objects.some((o) => o.node_object_purpose === 'remediation'));
  for (const obj of objects) {
    assert.equal(obj.targets_misconception_id, undefined);
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
