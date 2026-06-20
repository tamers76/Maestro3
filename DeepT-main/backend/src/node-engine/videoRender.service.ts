/**
 * Video render orchestration — HeyGen Direct Video when API key is set, mock otherwise.
 */
import type { VideoSettings } from '../models/nodeEngine.js';
import {
  getAvatarRotationPool,
  resolveVideoAvatarForObject,
} from './videoAvatarRotation.service.js';
import {
  VIDEO_SCRIPT_MAX_WORDS,
  countScriptWords,
  resolveScriptWordBudget,
} from './videoBrief.types.js';
import {
  getHeyGenVideoStatus,
  resolveHeyGenApiKey,
  submitHeyGenVideo,
} from './heygenVideoRenderer.service.js';
import {
  agentStatusToRenderStatus,
  getHeyGenVideoAgentSession,
  submitHeyGenVideoAgent,
} from './heygenVideoAgentRenderer.service.js';
import { mockRenderVideo, type VideoRenderStatus } from './mocks/mockVideoRenderer.service.js';

export type RenderPath = 'direct_video' | 'video_agent';

export class VideoRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoRenderError';
  }
}

export interface VideoRenderOutcome {
  video_id: string;
  status: VideoRenderStatus;
  video_url: string;
  transcript: string;
  duration_seconds?: number;
  provider: 'heygen';
  failure_message?: string;
  /** True when HEYGEN_API_KEY (or apiKeyRef) is absent and mock renderer was used. */
  mock?: boolean;
  /** Which HeyGen API path produced this outcome. */
  render_path?: RenderPath;
  /** Video Agent session id (agent path only); needed to resume polling. */
  session_id?: string;
}

export function assertScriptWithinWordLimit(script: string, budget = VIDEO_SCRIPT_MAX_WORDS): void {
  const words = countScriptWords(script);
  if (words > budget) {
    throw new VideoRenderError(
      `Script has ${words} words — exceeds the ${budget}-word budget. Shorten the brief or raise the target duration before render.`
    );
  }
}

export function assertVideoSettingsReady(settings: VideoSettings): void {
  const pool = getAvatarRotationPool(settings);
  const avatarId = settings.avatar_id?.trim() || pool[0]?.id?.trim();
  if (!avatarId) {
    throw new VideoRenderError(
      'Set avatar look(s) in Settings → Video modality before HeyGen render.'
    );
  }
  if (!settings.voice_id?.trim() && !pool.some((e) => e.default_voice_id?.trim())) {
    throw new VideoRenderError('Set voice_id in Settings → Video modality before HeyGen render.');
  }
}

export { resolveVideoAvatarForObject };

function isAgentPath(renderStyle?: 'studio_direct' | 'video_agent_produced'): boolean {
  return renderStyle === 'video_agent_produced';
}

export async function executeVideoRender(input: {
  script: string;
  title: string;
  videoSettings: VideoSettings;
  objectId?: string;
  /** Effective render style. Defaults to studio_direct when omitted (back-compat). */
  renderStyle?: 'studio_direct' | 'video_agent_produced';
  /** Compiled HeyGen Video Agent prompt (required for the agent path). */
  agentPrompt?: string;
}): Promise<VideoRenderOutcome> {
  const { script, title, videoSettings, objectId, renderStyle, agentPrompt } = input;
  assertScriptWithinWordLimit(script, resolveScriptWordBudget(videoSettings.target_duration_seconds));

  const resolvedSettings = objectId
    ? resolveVideoAvatarForObject(videoSettings, objectId)
    : videoSettings;

  const agent = isAgentPath(renderStyle);
  const apiKey = resolveHeyGenApiKey(resolvedSettings.apiKeyRef);

  if (!apiKey) {
    const mock = mockRenderVideo({
      script,
      videoSettings: resolvedSettings,
      duration_seconds: Math.ceil(countScriptWords(script) / 140) * 60,
    });
    return {
      ...mock,
      mock: true,
      render_path: agent ? 'video_agent' : 'direct_video',
      ...(agent ? { session_id: `mock_session_${mock.video_id}` } : {}),
    };
  }

  assertVideoSettingsReady(resolvedSettings);

  if (agent) {
    const prompt = agentPrompt?.trim();
    if (!prompt) {
      throw new VideoRenderError('Video Agent render requires a compiled prompt (regenerate the brief).');
    }
    const submitted = await submitHeyGenVideoAgent(apiKey, prompt, resolvedSettings);
    return {
      video_id: submitted.video_id ?? '',
      status: agentStatusToRenderStatus(submitted.status),
      video_url: '',
      transcript: script,
      provider: 'heygen',
      mock: false,
      render_path: 'video_agent',
      session_id: submitted.session_id,
    };
  }

  const submitted = await submitHeyGenVideo(apiKey, script, title, resolvedSettings);
  return {
    video_id: submitted.video_id,
    status: submitted.status,
    video_url: submitted.video_url ?? '',
    transcript: script,
    provider: 'heygen',
    mock: false,
    render_path: 'direct_video',
  };
}

export async function refreshHeyGenVideoRender(input: {
  videoId?: string;
  sessionId?: string;
  script: string;
  videoSettings: VideoSettings;
  renderPath?: RenderPath;
}): Promise<VideoRenderOutcome> {
  const apiKey = resolveHeyGenApiKey(input.videoSettings.apiKeyRef);
  if (!apiKey) {
    throw new VideoRenderError('HeyGen API key not configured — cannot poll render status.');
  }

  // Video Agent path: resolve the video_id from the session first, then poll the video.
  if (input.renderPath === 'video_agent') {
    let videoId = input.videoId;
    let sessionFailure: string | undefined;
    if (input.sessionId) {
      const session = await getHeyGenVideoAgentSession(apiKey, input.sessionId);
      if (session.status === 'failed') {
        return {
          video_id: videoId ?? '',
          status: 'failed',
          video_url: '',
          transcript: input.script,
          provider: 'heygen',
          failure_message: session.failure_message,
          mock: false,
          render_path: 'video_agent',
          session_id: input.sessionId,
        };
      }
      if (session.video_id) videoId = session.video_id;
      sessionFailure = session.failure_message;
      // Agent still planning/generating and no video yet — report in-progress.
      if (!videoId) {
        return {
          video_id: '',
          status: agentStatusToRenderStatus(session.status),
          video_url: '',
          transcript: input.script,
          provider: 'heygen',
          ...(sessionFailure ? { failure_message: sessionFailure } : {}),
          mock: false,
          render_path: 'video_agent',
          session_id: input.sessionId,
        };
      }
    }
    if (!videoId) {
      throw new VideoRenderError('Video Agent render has no session or video id to poll.');
    }
    const status = await getHeyGenVideoStatus(apiKey, videoId);
    return {
      video_id: videoId,
      status: status.status,
      video_url: status.video_url ?? '',
      transcript: input.script,
      provider: 'heygen',
      failure_message: status.failure_message,
      duration_seconds: status.duration_seconds,
      mock: false,
      render_path: 'video_agent',
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
    };
  }

  if (!input.videoId) {
    throw new VideoRenderError('Direct Video render has no video id to poll.');
  }
  const status = await getHeyGenVideoStatus(apiKey, input.videoId);
  return {
    video_id: input.videoId,
    status: status.status,
    video_url: status.video_url ?? '',
    transcript: input.script,
    provider: 'heygen',
    failure_message: status.failure_message,
    duration_seconds: status.duration_seconds,
    mock: false,
    render_path: 'direct_video',
  };
}

export function mapRenderStatusToEnvelope(
  status: VideoRenderStatus
): 'render_pending' | 'render_complete' | 'render_failed' {
  if (status === 'completed') return 'render_complete';
  if (status === 'failed') return 'render_failed';
  return 'render_pending';
}
