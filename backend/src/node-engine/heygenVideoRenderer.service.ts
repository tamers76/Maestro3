/**
 * HeyGen Direct Video API client (POST /v3/videos + GET /v3/videos/{id}).
 * Avatar/voice/engine come from VideoSettings — never from the script.
 */
import type { VideoSettings } from '../models/nodeEngine.js';
import type { VideoRenderStatus } from './mocks/mockVideoRenderer.service.js';

const HEYGEN_API_BASE = 'https://api.heygen.com';

export function resolveHeyGenApiKey(apiKeyRef?: string): string | null {
  const ref = apiKeyRef?.trim() || 'HEYGEN_API_KEY';
  const key = process.env[ref]?.trim();
  return key || null;
}

export function heygenHeaders(apiKey: string): HeadersInit {
  return {
    'X-Api-Key': apiKey,
    'Content-Type': 'application/json',
  };
}

export function parseHeyGenData(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) return {};
  const root = payload as Record<string, unknown>;
  const data = root.data;
  if (typeof data === 'object' && data !== null) return data as Record<string, unknown>;
  return root;
}

export function heygenErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null) return fallback;
  const root = payload as Record<string, unknown>;
  if (typeof root.message === 'string' && root.message.trim()) return root.message;
  if (typeof root.error === 'string' && root.error.trim()) return root.error;
  if (typeof root.error === 'object' && root.error !== null) {
    const err = root.error as Record<string, unknown>;
    if (typeof err.message === 'string') return err.message;
  }
  return fallback;
}

export function mapHeyGenStatus(raw: unknown): VideoRenderStatus {
  const s = String(raw ?? 'pending').toLowerCase();
  if (s === 'completed' || s === 'complete' || s === 'success') return 'completed';
  if (s === 'failed' || s === 'fail' || s === 'error') return 'failed';
  if (s === 'processing' || s === 'running') return 'processing';
  return 'pending';
}

export function buildHeyGenSubmitBody(
  script: string,
  title: string,
  settings: VideoSettings
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    type: 'avatar',
    avatar_id: settings.avatar_id,
    voice_id: settings.voice_id,
    script,
    title: title.slice(0, 200),
    resolution: settings.resolution ?? '1080p',
    aspect_ratio: settings.aspect_ratio ?? 'auto',
  };
  if (settings.callback_url) body.callback_url = settings.callback_url;
  if (settings.output_format) body.output_format = settings.output_format;
  if (settings.motion_prompt) body.motion_prompt = settings.motion_prompt;
  if (settings.remove_background !== undefined) body.remove_background = settings.remove_background;
  if (settings.background) body.background = settings.background;
  if (settings.voice_settings && Object.keys(settings.voice_settings).length > 0) {
    body.voice = { voice_id: settings.voice_id, ...settings.voice_settings };
  }
  if (settings.engine === 'avatar_v') {
    body.engine = { type: 'avatar_v' };
  }
  return body;
}

export async function submitHeyGenVideo(
  apiKey: string,
  script: string,
  title: string,
  settings: VideoSettings
): Promise<{ video_id: string; status: VideoRenderStatus; video_url?: string }> {
  const response = await fetch(`${HEYGEN_API_BASE}/v3/videos`, {
    method: 'POST',
    headers: heygenHeaders(apiKey),
    body: JSON.stringify(buildHeyGenSubmitBody(script, title, settings)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(heygenErrorMessage(payload, `HeyGen submit failed (${response.status})`));
  }
  const data = parseHeyGenData(payload);
  const video_id = String(data.video_id ?? '');
  if (!video_id) throw new Error('HeyGen response missing video_id');
  return {
    video_id,
    status: mapHeyGenStatus(data.status),
    video_url: typeof data.video_url === 'string' ? data.video_url : undefined,
  };
}

export async function getHeyGenVideoStatus(
  apiKey: string,
  videoId: string
): Promise<{
  status: VideoRenderStatus;
  video_url?: string;
  failure_message?: string;
  duration_seconds?: number;
}> {
  const response = await fetch(`${HEYGEN_API_BASE}/v3/videos/${encodeURIComponent(videoId)}`, {
    method: 'GET',
    headers: heygenHeaders(apiKey),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(heygenErrorMessage(payload, `HeyGen status failed (${response.status})`));
  }
  const data = parseHeyGenData(payload);
  const status = mapHeyGenStatus(data.status);
  return {
    status,
    video_url: typeof data.video_url === 'string' ? data.video_url : undefined,
    failure_message:
      status === 'failed'
        ? String(data.error ?? data.failure_message ?? data.message ?? 'HeyGen render failed')
        : undefined,
    duration_seconds:
      typeof data.duration === 'number'
        ? data.duration
        : typeof data.duration_seconds === 'number'
          ? data.duration_seconds
          : undefined,
  };
}
