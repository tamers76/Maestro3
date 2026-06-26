import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHeyGenSubmitBody, mapHeyGenStatus } from '../heygenVideoRenderer.service.js';
import {
  assertScriptWithinWordLimit,
  assertVideoSettingsReady,
  VideoRenderError,
  executeVideoRender,
} from '../videoRender.service.js';
import {
  VIDEO_SCRIPT_MAX_WORDS,
  countScriptWords,
  finalizeVideoBrief,
} from '../videoBrief.types.js';
import { projectVideoBriefFromContentSpec } from '../videoBriefProduction.service.js';
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
    examples: [],
    non_examples: [],
    preservation_rules: [],
    addresses_misconception_ids: [],
    grounding_references: [],
    grounding_strength: 'moderate',
    status: 'approved',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

test('countScriptWords and 420-word cap fidelity', () => {
  const brief = projectVideoBriefFromContentSpec(sampleVideoSpec());
  const finalized = finalizeVideoBrief(brief);
  assert.ok(finalized.narration.script_word_count);
  assert.ok(finalized.narration.script_word_count! <= VIDEO_SCRIPT_MAX_WORDS);
  assert.ok(!finalized.heygen_prompt_payload.prompt.includes('-minute'));
  assert.ok(finalized.heygen_prompt_payload.prompt.includes(`${VIDEO_SCRIPT_MAX_WORDS}`));
});

test('finalizeVideoBrief flags scripts over 420 words', () => {
  const brief = projectVideoBriefFromContentSpec(sampleVideoSpec());
  const longScript = Array.from({ length: 450 }, (_, i) => `word${i}`).join(' ');
  brief.narration.full_script = longScript;
  const finalized = finalizeVideoBrief(brief);
  assert.equal(finalized.narration.script_word_count, 450);
  assert.equal(finalized.fidelity_check?.status, 'needs_review');
  assert.ok(finalized.fidelity_check?.notes.some((n) => n.includes('450 words')));
});

test('assertScriptWithinWordLimit blocks render over cap', () => {
  const long = Array.from({ length: 421 }, (_, i) => `w${i}`).join(' ');
  assert.throws(() => assertScriptWithinWordLimit(long), VideoRenderError);
});

test('buildHeyGenSubmitBody maps avatar_v engine', () => {
  const body = buildHeyGenSubmitBody('Hello script.', 'Title', {
    provider: 'heygen',
    avatar_id: 'av1',
    voice_id: 'vo1',
    engine: 'avatar_v',
    resolution: '1080p',
  });
  assert.equal(body.type, 'avatar');
  assert.deepEqual(body.engine, { type: 'avatar_v' });
  assert.equal(body.script, 'Hello script.');
});

test('mapHeyGenStatus normalizes terminal states', () => {
  assert.equal(mapHeyGenStatus('completed'), 'completed');
  assert.equal(mapHeyGenStatus('failed'), 'failed');
  assert.equal(mapHeyGenStatus('processing'), 'processing');
});

test('executeVideoRender uses mock when API key absent', async () => {
  const prev = process.env.HEYGEN_API_KEY;
  delete process.env.HEYGEN_API_KEY;
  try {
    const outcome = await executeVideoRender({
      script: 'Short approved narration for the learner.',
      title: 'Test video',
      videoSettings: { provider: 'heygen' },
    });
    assert.equal(outcome.mock, true);
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.transcript, 'Short approved narration for the learner.');
    assert.ok(outcome.video_url.includes('mock.heygen.local'));
  } finally {
    if (prev !== undefined) process.env.HEYGEN_API_KEY = prev;
  }
});

test('assertVideoSettingsReady accepts avatar_rotation_pool without top-level avatar_id', () => {
  assert.doesNotThrow(() =>
    assertVideoSettingsReady({
      provider: 'heygen',
      voice_id: 'voice_main',
      avatar_rotation_pool: [{ id: 'look_a', name: 'Look A' }],
    })
  );
});

test('executeVideoRender resolves avatar from rotation pool per objectId', async () => {
  const prev = process.env.HEYGEN_API_KEY;
  process.env.HEYGEN_API_KEY = 'test-key-should-not-call-api';
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(
      JSON.stringify({ data: { video_id: 'vid_test', status: 'pending' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;
  try {
    await executeVideoRender({
      script: 'Rotation pool narration.',
      title: 'Rotation test',
      objectId: 'obj_video_alpha',
      videoSettings: {
        provider: 'heygen',
        voice_id: 'voice_main',
        avatar_rotation_pool: [
          { id: 'look_a', name: 'Look A', default_voice_id: 'voice_a' },
          { id: 'look_b', name: 'Look B' },
        ],
      },
    });
    assert.ok(capturedBody);
    const body = capturedBody as Record<string, unknown>;
    assert.ok(['look_a', 'look_b'].includes(String(body.avatar_id)));
    assert.equal(body.voice_id, body.avatar_id === 'look_a' ? 'voice_a' : 'voice_main');
  } finally {
    globalThis.fetch = originalFetch;
    if (prev !== undefined) process.env.HEYGEN_API_KEY = prev;
    else delete process.env.HEYGEN_API_KEY;
  }
});
