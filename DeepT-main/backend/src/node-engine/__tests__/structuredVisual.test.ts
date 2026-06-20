import assert from 'node:assert/strict';
import test from 'node:test';
import { projectStructuredVisualFromContentSpec } from '../structuredVisualProduction.service.js';
import {
  finalizeStructuredVisual,
  parseStructuredVisualContent,
  type StructuredVisualContent,
} from '../structuredVisual.types.js';
import type { ContentPattern, LearningObjectContentSpec } from '../../models/nodeEngine.js';

function sampleSpec(overrides: Partial<LearningObjectContentSpec> = {}): LearningObjectContentSpec {
  return {
    content_spec_id: 'spec_obj_sv',
    object_id: 'obj_sv',
    blueprint_id: 'bp_test',
    course_id: 'TEST',
    subtopic_id: 'ST1',
    node_id: 'node_test',
    object_family: 'node_learning_object',
    node_object_purpose: 'explanation',
    milestone_support_purpose: null,
    content_pattern: 'comparison',
    suggested_vehicle: 'structured_visual',
    is_primary_evidence_check: false,
    parent_node_id: 'node_test',
    parent_milestone_pack_id: null,
    kc_ids: ['kc_test'],
    title: 'Correlation vs causation',
    required_explanation:
      'Correlation describes a statistical association; causation requires a mechanism and controlled evidence.',
    examples: [{ label: 'Association', content: 'Ice cream sales and drowning both rise in summer.' }],
    non_examples: [
      { label: 'Causal claim', content: 'Ice cream causes drowning.', why_not: 'A confounder (heat) drives both.' },
    ],
    preservation_rules: ['Do not invent studies not in the spec.'],
    addresses_misconception_ids: [],
    grounding_references: [{ citation: 'Smith 2020', passage_ref: 'p.12' }],
    grounding_strength: 'moderate',
    status: 'approved',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

test('projectStructuredVisualFromContentSpec produces a parseable comparison visual', () => {
  const content = projectStructuredVisualFromContentSpec(sampleSpec());
  assert.equal(content.visual_type, 'comparison_table');
  assert.equal(content.title, 'Correlation vs causation');
  assert.ok(content.semantic_elements.length >= 2);
  assert.equal(content.text_equivalent, sampleSpec().required_explanation);
  // reading_order covers every element
  assert.equal(content.reading_order.length, content.semantic_elements.length);
  // example relates to the core concept
  assert.ok(content.relationships.some((r) => r.relationship_type === 'exemplifies'));
  // round-trips through the parser
  parseStructuredVisualContent({ content });
});

test('visual_type follows the content_pattern', () => {
  const patterns: Array<[ContentPattern, string]> = [
    ['comparison', 'comparison_table'],
    ['worked_example', 'annotated_example'],
    ['scenario', 'process_map'],
    ['none', 'concept_map'],
  ];
  for (const [pattern, expected] of patterns) {
    const content = projectStructuredVisualFromContentSpec(sampleSpec({ content_pattern: pattern }));
    assert.equal(content.visual_type, expected, `pattern ${pattern}`);
  }
});

test('parseStructuredVisualContent requires elements, alt_text, text_equivalent', () => {
  const base = projectStructuredVisualFromContentSpec(sampleSpec());
  assert.throws(() => parseStructuredVisualContent({ content: { ...base, semantic_elements: [] } }));
  assert.throws(() => parseStructuredVisualContent({ content: { ...base, alt_text: '' } }));
  assert.throws(() => parseStructuredVisualContent({ content: { ...base, text_equivalent: '' } }));
});

test('parser drops relationships/annotations referencing unknown element ids', () => {
  const base = projectStructuredVisualFromContentSpec(sampleSpec());
  const withDangling = {
    ...base,
    relationships: [
      ...base.relationships,
      { from_element_id: 'ghost', to_element_id: 'concept_core', relationship_type: 'supports' },
    ],
    annotations: [
      { annotation_id: 'a1', target_element_id: 'ghost', annotation_type: 'warning', text: 'n/a' },
    ],
  };
  const parsed = parseStructuredVisualContent({ content: withDangling });
  assert.ok(parsed.relationships.every((r) => r.from_element_id !== 'ghost'));
  assert.equal(parsed.annotations.length, 0);
});

test('finalizeStructuredVisual flags missing citations on academic elements', () => {
  const content: StructuredVisualContent = {
    visual_type: 'criteria_matrix',
    title: 'Rubric criteria',
    semantic_elements: [
      { element_id: 'c1', element_type: 'criterion', label: 'Clarity' },
      { element_id: 'c2', element_type: 'rubric_level', label: 'Excellent' },
    ],
    relationships: [],
    annotations: [],
    layout_intent: 'grid',
    reading_order: [],
    alt_text: 'Rubric',
    text_equivalent: 'A rubric with criteria and levels.',
    grounding_strength: 'moderate',
    rendering_route: 'platform_native',
  };
  const finalized = finalizeStructuredVisual(content);
  assert.equal(finalized.fidelity_check?.status, 'needs_review');
  assert.ok(finalized.fidelity_check?.notes.some((n) => n.includes('citation')));
  // reading_order is backfilled to cover every element
  assert.deepEqual(finalized.reading_order, ['c1', 'c2']);
});

test('finalizeStructuredVisual flags weak grounding', () => {
  const content = projectStructuredVisualFromContentSpec(sampleSpec({ grounding_strength: 'weak' }));
  assert.equal(content.fidelity_check?.status, 'needs_review');
  assert.ok(content.fidelity_check?.notes.some((n) => n.toLowerCase().includes('grounding')));
});
