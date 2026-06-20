/**
 * Mock Video Renderer (Phase 0 — HeyGen v3, MOCKED).
 *
 * This is a stand-in for the real HeyGen render executor. It keeps the REAL
 * contract shape so the live executor drops in later with NO schema change.
 *
 * REAL LIFECYCLE (modelled here for drop-in parity; the mock short-circuits it):
 *   1. POST https://api.heygen.com/v3/videos { script, ...videoSettings }
 *      → returns a video_id, status starts at "pending".
 *   2. Status transitions: pending → processing → completed | failed.
 *   3. On "completed": `video_url` is a presigned download link (expires).
 *      On "failed": read `failure_message`.
 *   4. Terminal state is delivered EITHER via webhook events
 *      (avatar_video.success / avatar_video.fail) or the configured
 *      `callback_url`, OR by polling GET /v3/videos/{video_id} with backoff.
 *
 * THREE INVARIANTS (must hold for the real executor too):
 *   (a) The brief prompt produces ONLY the script — it never chooses
 *       avatar/voice/engine/render IDs. Those come exclusively from
 *       videoSettings (the video_brief_generation_prompt already lists them
 *       under settings_controlled_outside_prompt).
 *   (b) The submitted script IS the authoritative transcript — stored verbatim,
 *       with no approximation/summarization caveat.
 *   (c) No style_id / brand_kit_id — branding/templating is a deferred v2
 *       Template-API concern and is not part of this contract.
 */
import type { VideoSettings } from '../../models/nodeEngine.js';

/** Real HeyGen render lifecycle states (terminal: completed | failed). */
export type VideoRenderStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Input to the renderer: the produced brief's script + resolved render settings. */
export interface VideoRenderInput {
  /** The script the video_brief_generation_prompt produced (authoritative transcript). */
  script: string;
  /** Resolved HeyGen v3 render settings (avatar/voice/engine/etc. live here only). */
  videoSettings: VideoSettings;
  /** Optional approximate duration hint from the brief, if available. */
  duration_seconds?: number;
}

/**
 * The shape the REAL executor would also return. The mock fills it synchronously
 * with a terminal "completed" result; the live executor would resolve it after
 * the async lifecycle (webhook/callback/polling) reaches a terminal state.
 */
export interface VideoRenderResult {
  video_id: string;
  status: VideoRenderStatus;
  /** Presigned download link on success; empty until completed. */
  video_url: string;
  /** Authoritative transcript = the submitted script, verbatim. */
  transcript: string;
  duration_seconds?: number;
  provider: 'heygen';
  /** Populated only when status === "failed" (mirrors the real fail payload). */
  failure_message?: string;
  /** Always true when the mock renderer was used; omitted for live HeyGen renders. */
  mock?: true;
}

let mockCounter = 0;

/**
 * Mock render: returns a fake COMPLETED result mirroring the real terminal
 * success. Makes NO network calls. The submitted script is stored verbatim as
 * the transcript. Avatar/voice/engine/render IDs are taken ONLY from
 * videoSettings — never inferred from the script.
 */
export function mockRenderVideo(input: VideoRenderInput): VideoRenderResult {
  const { script, videoSettings, duration_seconds } = input;
  const videoId = `mock_video_${Date.now()}_${++mockCounter}`;
  const ext = videoSettings.output_format ?? 'mp4';

  return {
    video_id: videoId,
    status: 'completed',
    // Presigned-style fake URL (no real asset; mirrors the real download link shape).
    video_url: `https://mock.heygen.local/videos/${videoId}/download.${ext}?mock=1`,
    transcript: script,
    duration_seconds,
    provider: 'heygen',
    mock: true,
  };
}
