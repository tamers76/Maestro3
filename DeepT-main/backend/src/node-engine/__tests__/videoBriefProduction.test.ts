import assert from 'node:assert/strict';
import test from 'node:test';
import { projectVideoBriefFromContentSpec } from '../videoBriefProduction.service.js';
import { parseVideoBriefContent, finalizeVideoBrief } from '../videoBrief.types.js';
import type { LearningObjectContentSpec } from '../../models/nodeEngine.js';

function sampleVideoSpec(): LearningObjectContentSpec {
  return {
    content_spec_id: 'spec_obj_test_explanation',
    object_id: 'obj_test_explanation',
    blueprint_id: 'bp_test',
    course_id: 'TEST',
    subtopic_id: 'ST1',
    node_id: 'node_test',
    object_family: 'node_learning_object',
    node_object_purpose: 'explanation',
    milestone_support_purpose: null,
    content_pattern: 'none',
    suggested_vehicle: 'video',
    is_primary_evidence_check: false,
    parent_node_id: 'node_test',
    parent_milestone_pack_id: null,
    kc_ids: ['kc_test'],
    title: 'Explain evidence strength',
    required_explanation: 'Learners must distinguish correlation from causation when evaluating claims.',
    examples: [{ label: 'Example', content: 'Ice cream sales and drowning both rise in summer.' }],
    non_examples: [],
    preservation_rules: ['Do not invent studies not in the spec.'],
    addresses_misconception_ids: [],
    grounding_references: [],
    grounding_strength: 'moderate',
    status: 'approved',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

test('projectVideoBriefFromContentSpec produces heygen prompt + transcript', () => {
  const brief = projectVideoBriefFromContentSpec(sampleVideoSpec());
  assert.equal(brief.narration.video_title, 'Explain evidence strength');
  assert.ok(brief.heygen_prompt_payload.prompt.length > 50);
  assert.ok(brief.heygen_prompt_payload.prompt.includes(brief.narration.full_script));
  assert.equal(brief.transcript, brief.narration.full_script);
  assert.equal(brief.heygen_prompt_payload.recommended_mode, 'generate');
  parseVideoBriefContent({ content: brief });
});

test('finalizeVideoBrief inlines full_script into heygen prompt', () => {
  const brief = projectVideoBriefFromContentSpec(sampleVideoSpec());
  brief.heygen_prompt_payload.prompt =
    'Create a video.\n\nNarration script:\n[Full script as provided in narration.full_script]';
  const finalized = finalizeVideoBrief(brief);
  assert.ok(!finalized.heygen_prompt_payload.prompt.includes('[Full script'));
  assert.ok(finalized.heygen_prompt_payload.prompt.includes(brief.narration.full_script));
});

test('parseVideoBriefContent requires heygen_prompt_payload.prompt', () => {
  const brief = projectVideoBriefFromContentSpec(sampleVideoSpec());
  assert.throws(() => parseVideoBriefContent({ content: { ...brief, heygen_prompt_payload: {} } }));
});
