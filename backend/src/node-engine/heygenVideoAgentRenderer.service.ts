/**
 * HeyGen Video Agent API client (POST /v3/video-agents + GET /v3/video-agents/{id}).
 *
 * Unlike Direct Video, the agent receives ONE compiled prompt (structured scenes
 * live inside it) and composes scenes/graphics itself. avatar/voice/style come
 * from VideoSettings. The agent runs as a session; once it begins rendering a
 * video_id appears and the final asset is polled via GET /v3/videos/{video_id}.
 */
import type { VideoSettings } from '../models/nodeEngine.js';
import type { VideoRenderStatus } from './mocks/mockVideoRenderer.service.js';
import {
  heygenErrorMessage,
  heygenHeaders,
  parseHeyGenData,
} from './heygenVideoRenderer.service.js';
import { resolveVideoAvatarForObject } from './videoAvatarRotation.service.js';

const HEYGEN_API_BASE = 'https://api.heygen.com';

/** Normalized agent lifecycle (session-level, before/while video renders). */
export type VideoAgentSessionStatus =
  | 'thinking'
  | 'generating'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'waiting_for_input';

export function mapAgentSessionStatus(raw: unknown): VideoAgentSessionStatus {
  const s = String(raw ?? 'pending').toLowerCase();
  if (s.includes('wait')) return 'waiting_for_input';
  if (s === 'thinking' || s === 'planning' || s === 'storyboard') return 'thinking';
  if (s === 'generating' || s === 'rendering' || s === 'running') return 'generating';
  if (s === 'completed' || s === 'complete' || s === 'success' || s === 'done') return 'completed';
  if (s === 'failed' || s === 'fail' || s === 'error') return 'failed';
  if (s === 'processing') return 'processing';
  return 'pending';
}

/** Map a session status to the Direct-Video VideoRenderStatus vocabulary. */
export function agentStatusToRenderStatus(status: VideoAgentSessionStatus): VideoRenderStatus {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'pending') return 'pending';
  // thinking / generating / processing / waiting_for_input all map to in-progress.
  return 'processing';
}

export function buildVideoAgentSubmitBody(
  prompt: string,
  settings: VideoSettings
): Record<string, unknown> {
  const body: Record<string, unknown> = { prompt, mode: 'generate' };
  if (settings.avatar_id?.trim()) body.avatar_id = settings.avatar_id.trim();
  if (settings.voice_id?.trim()) body.voice_id = settings.voice_id.trim();
  if (settings.style_id?.trim()) body.style_id = settings.style_id.trim();
  if (settings.orientation) body.orientation = settings.orientation;
  if (settings.callback_url?.trim()) body.callback_url = settings.callback_url.trim();
  return body;
}

export async function submitHeyGenVideoAgent(
  apiKey: string,
  prompt: string,
  settings: VideoSettings
): Promise<{ session_id: string; status: VideoAgentSessionStatus; video_id?: string }> {
  const response = await fetch(`${HEYGEN_API_BASE}/v3/video-agents`, {
    method: 'POST',
    headers: heygenHeaders(apiKey),
    cache: 'no-store',
    body: JSON.stringify(buildVideoAgentSubmitBody(prompt, settings)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(heygenErrorMessage(payload, `HeyGen agent submit failed (${response.status})`));
  }
  const data = parseHeyGenData(payload);
  const session_id = String(data.session_id ?? '');
  if (!session_id) throw new Error('HeyGen agent response missing session_id');
  return {
    session_id,
    status: mapAgentSessionStatus(data.status),
    video_id: typeof data.video_id === 'string' ? data.video_id : undefined,
  };
}

export async function getHeyGenVideoAgentSession(
  apiKey: string,
  sessionId: string
): Promise<{
  status: VideoAgentSessionStatus;
  progress?: number;
  video_id?: string;
  failure_message?: string;
}> {
  const response = await fetch(
    `${HEYGEN_API_BASE}/v3/video-agents/${encodeURIComponent(sessionId)}`,
    { method: 'GET', headers: heygenHeaders(apiKey), cache: 'no-store' }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(heygenErrorMessage(payload, `HeyGen agent session failed (${response.status})`));
  }
  const data = parseHeyGenData(payload);
  const status = mapAgentSessionStatus(data.status);
  return {
    status,
    progress: typeof data.progress === 'number' ? data.progress : undefined,
    video_id: typeof data.video_id === 'string' ? data.video_id : undefined,
    failure_message:
      status === 'failed'
        ? String(data.failure_message ?? data.message ?? 'HeyGen agent session failed')
        : undefined,
  };
}

export { resolveVideoAvatarForObject };
