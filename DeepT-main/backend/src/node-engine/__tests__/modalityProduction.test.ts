import test from 'node:test';
import assert from 'node:assert/strict';
import type { LearningObjectContentSpec } from '../../models/nodeEngine.js';
import { parseTextSegments } from '../../models/nodeEngine.js';
import { projectBlueprintFromNode } from '../nodeBlueprint.service.js';
import { projectContentSpecFromBlueprintObject } from '../contentSpec.service.js';
import {
  projectTextSegmentsFromContentSpec,
  buildEnvelopeFromSpecAndSegments,
} from '../modalityProduction.service.js';
import type { Node } from '../../models/nodeEngine.js';

function minimalNode(overrides: Partial<Node> = {}): Node {
  return {
    node_id: 'node_distinction_1',
    parent_subtopic_id: 'CLO1-ST2',
    clo_ids: ['CLO-1'],
    node_type: 'distinction',
    node_title: 'Distinguish digital pedagogies',
    order: 2,
    is_core: true,
    knowledge_component: 'Separate digital from traditional pedagogies',
    kc_ids: ['kc_distinction_1'],
    mastery_statement: 'Learner distinguishes digital from traditional approaches.',
    why_it_matters: 'Design choices depend on the distinction.',
    assessment_connection: 'Prepares for reflective report.',
    core_academic_message: 'Digital pedagogies leverage connectivity; traditional emphasise presence.',
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
    candidate_misconceptions: [],
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

function approvedExplanationSpec(): LearningObjectContentSpec {
  const node = minimalNode();
  const blueprint = {
    blueprint_id: `bp_${node.node_id}`,
    course_id: 'MDLD602',
    subtopic_id: 'CLO1-ST2',
    node_id: node.node_id,
    node_title: node.node_title,
    objects: projectBlueprintFromNode(node),
    status: 'approved' as const,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  const explanation = blueprint.objects.find((o) => o.node_object_purpose === 'explanation')!;
  const spec = projectContentSpecFromBlueprintObject(node, blueprint, explanation);
  spec.status = 'approved';
  spec.suggested_vehicle = 'video';
  return spec;
}

test('projectTextSegmentsFromContentSpec renders heading and body from spec', () => {
  const spec = approvedExplanationSpec();
  const segments = projectTextSegmentsFromContentSpec(spec);
  assert.ok(segments.some((s) => s.type === 'heading'));
  assert.ok(segments.some((s) => s.type === 'body' && s.text.includes('Digital pedagogies')));
});

test('buildEnvelopeFromSpecAndSegments produces text envelope with fidelity note for video blueprint', () => {
  const spec = approvedExplanationSpec();
  const segments = projectTextSegmentsFromContentSpec(spec);
  const envelope = buildEnvelopeFromSpecAndSegments(spec, segments, {
    model_used: 'test',
    model_selection_source: 'global_default',
    generation_mode: 'single',
    prompt_template_id: 'text_generation_prompt',
    prompt_version: 1,
  });
  assert.equal(envelope.produced_modality, 'text');
  assert.equal(envelope.governance_status, 'recommended_sme_review');
  const ms = envelope.modality_specific as { fidelity_check?: { notes?: string[] } };
  assert.ok(ms.fidelity_check?.notes?.some((n) => n.includes('video')));
});

test('parseTextSegments accepts string citation from LLM output', () => {
  const segments = parseTextSegments(
    [{ type: 'example', text: 'Example text', citation: 'Smith (2024), ch3' }],
    'LLM.segments'
  );
  assert.equal(segments[0].citation?.citation, 'Smith (2024), ch3');
  assert.equal(segments[0].citation?.passage_ref, '');
});
