import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildVideoAgentSubmitBody,
  mapAgentSessionStatus,
  agentStatusToRenderStatus,
} from '../heygenVideoAgentRenderer.service.js';
import { executeVideoRender } from '../videoRender.service.js';
import { checkTranscriptFidelity } from '../transcriptFidelity.service.js';
import type { VideoSettings } from '../../models/nodeEngine.js';

function agentSettings(): VideoSettings {
  return {
    provider: 'heygen',
    video_render_style: 'video_agent_produced',
    avatar_id: 'look_1',
    voice_id: 'voice_1',
    style_id: 'style_noir',
    orientation: 'landscape',
  };
}

test('buildVideoAgentSubmitBody includes prompt + settings, omits empty', () => {
  const body = buildVideoAgentSubmitBody('Compiled prompt here', agentSettings());
  assert.equal(body.prompt, 'Compiled prompt here');
  assert.equal(body.mode, 'generate');
  assert.equal(body.avatar_id, 'look_1');
  assert.equal(body.voice_id, 'voice_1');
  assert.equal(body.style_id, 'style_noir');
  assert.equal(body.orientation, 'landscape');
  const bare = buildVideoAgentSubmitBody('p', { provider: 'heygen' });
  assert.ok(!('avatar_id' in bare));
  assert.ok(!('style_id' in bare));
});

test('mapAgentSessionStatus normalizes session states', () => {
  assert.equal(mapAgentSessionStatus('thinking'), 'thinking');
  assert.equal(mapAgentSessionStatus('waiting_for_input'), 'waiting_for_input');
  assert.equal(mapAgentSessionStatus('success'), 'completed');
  assert.equal(mapAgentSessionStatus('error'), 'failed');
  assert.equal(mapAgentSessionStatus('generating'), 'generating');
});

test('agentStatusToRenderStatus maps to render vocabulary', () => {
  assert.equal(agentStatusToRenderStatus('completed'), 'completed');
  assert.equal(agentStatusToRenderStatus('failed'), 'failed');
  assert.equal(agentStatusToRenderStatus('thinking'), 'processing');
  assert.equal(agentStatusToRenderStatus('pending'), 'pending');
});

test('executeVideoRender (agent path, no API key) returns mock with session + video_agent path', async () => {
  const outcome = await executeVideoRender({
    script: 'Hello world this is the approved script.',
    title: 'Test',
    videoSettings: agentSettings(),
    renderStyle: 'video_agent_produced',
    agentPrompt: 'Compiled agent prompt',
  });
  assert.equal(outcome.render_path, 'video_agent');
  assert.equal(outcome.mock, true);
  assert.ok(outcome.session_id && outcome.session_id.startsWith('mock_session_'));
  assert.equal(outcome.status, 'completed');
});

test('executeVideoRender (direct path) reports direct_video path', async () => {
  const outcome = await executeVideoRender({
    script: 'Hello world.',
    title: 'Test',
    videoSettings: { provider: 'heygen', video_render_style: 'studio_direct', avatar_id: 'a', voice_id: 'v' },
    renderStyle: 'studio_direct',
  });
  assert.equal(outcome.render_path, 'direct_video');
});

test('checkTranscriptFidelity: identical script matches', () => {
  const res = checkTranscriptFidelity('The green economy balances prosperity.', 'The green economy balances prosperity.');
  assert.equal(res.fidelity, 'matched');
});

test('checkTranscriptFidelity: added number triggers needs_review', () => {
  const res = checkTranscriptFidelity(
    'The green economy balances prosperity and sustainability.',
    'The green economy balances prosperity and sustainability by 73% over time.'
  );
  assert.equal(res.fidelity, 'needs_review');
  assert.ok(res.notes.some((n) => n.includes('73')));
});

test('checkTranscriptFidelity: empty rendered transcript is matched (nothing to compare)', () => {
  const res = checkTranscriptFidelity('Approved script.', undefined);
  assert.equal(res.fidelity, 'matched');
});
