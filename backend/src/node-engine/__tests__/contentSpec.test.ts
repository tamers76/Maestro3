import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from '../../models/nodeEngine.js';
import { projectBlueprintFromNode } from '../nodeBlueprint.service.js';
import {
  projectContentSpecFromBlueprintObject,
  validateContentSpec,
  ContentSpecValidationError,
} from '../contentSpec.service.js';

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
    evidence_map: [
      {
        criterion_id: 'crit_1',
        criterion_name: 'Separates description from evaluation',
        solo_descriptors: {
          surface: '',
          multi_element: '',
          relational: '',
          extended_abstract: '',
        },
        critical: true,
      },
    ],
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
        suggested_trap: 'Treating praise as evaluation',
      },
    ],
    misconception_bindings: [],
    grounding_references: [{ citation: 'Smith (2024)', passage_ref: 'ch3:p12' }],
    grounding_strength: 'strong',
    risk_classification: ['standard'],
    review_priority: 'can_proceed',
    review_reasons: [],
    status: 'approved',
    ...overrides,
  };
}

function minimalBlueprint(node: Node) {
  const objects = projectBlueprintFromNode(node);
  return {
    blueprint_id: `bp_${node.node_id}`,
    course_id: 'MDLD602',
    subtopic_id: 'CLO1-ST2',
    node_id: node.node_id,
    node_title: node.node_title,
    objects,
    status: 'approved' as const,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

test('projectContentSpecFromBlueprintObject produces required_explanation and preservation_rules', () => {
  const node = minimalNode();
  const blueprint = minimalBlueprint(node);
  const explanation = blueprint.objects.find((o) => o.node_object_purpose === 'explanation')!;
  const spec = projectContentSpecFromBlueprintObject(node, blueprint, explanation);
  assert.ok(spec.required_explanation.includes('Description reports'));
  assert.ok(spec.preservation_rules.length >= 2);
  assert.equal(spec.grounding_strength, 'strong');
  assert.equal(spec.content_spec_id, `spec_${explanation.object_id}`);
  validateContentSpec(spec, node, explanation);
});

test('primary evidence check spec includes evidence_check_spec', () => {
  const node = minimalNode();
  const blueprint = minimalBlueprint(node);
  const ec = blueprint.objects.find((o) => o.is_primary_evidence_check)!;
  const spec = projectContentSpecFromBlueprintObject(node, blueprint, ec);
  assert.ok(spec.evidence_check_spec);
  assert.equal(spec.evidence_check_spec!.no_feedback_before_submission, true);
  assert.ok(spec.evidence_check_spec!.evidence_criteria_summary.includes('Separates description'));
  validateContentSpec(spec, node, ec);
});

test('weak grounding flagged when node has no citations', () => {
  const node = minimalNode({ grounding_references: [], grounding_strength: undefined });
  const blueprint = minimalBlueprint(node);
  const obj = blueprint.objects[0];
  const spec = projectContentSpecFromBlueprintObject(node, blueprint, obj);
  assert.equal(spec.grounding_strength, 'weak');
  assert.ok(spec.grounding_note);
});

test('remediation spec targets misconception and includes examples', () => {
  const node = minimalNode();
  const blueprint = minimalBlueprint(node);
  const remediation = blueprint.objects.find((o) => o.node_object_purpose === 'remediation')!;
  const spec = projectContentSpecFromBlueprintObject(node, blueprint, remediation);
  assert.equal(spec.targets_misconception_id, 'cand_1');
  assert.ok(spec.required_explanation.includes('Description and evaluation'));
  assert.ok(spec.examples.some((e) => e.label === 'Likely trap'));
  validateContentSpec(spec, node, remediation);
});

test('validateContentSpec rejects missing required_explanation', () => {
  const node = minimalNode();
  const blueprint = minimalBlueprint(node);
  const obj = blueprint.objects[0];
  const spec = projectContentSpecFromBlueprintObject(node, blueprint, obj);
  spec.required_explanation = '   ';
  assert.throws(
    () => validateContentSpec(spec, node, obj),
    (err: unknown) => err instanceof ContentSpecValidationError
  );
});

test('golden distinction node yields content specs for every blueprint object', () => {
  const node = minimalNode();
  const blueprint = minimalBlueprint(node);
  assert.equal(blueprint.objects.length, 6);
  for (const obj of blueprint.objects) {
    const spec = projectContentSpecFromBlueprintObject(node, blueprint, obj);
    validateContentSpec(spec, node, obj);
    assert.equal(spec.object_id, obj.object_id);
  }
});
