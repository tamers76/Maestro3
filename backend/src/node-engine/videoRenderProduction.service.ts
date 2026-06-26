/**
 * Layer 4 Phase C — submit / refresh HeyGen render for a produced video brief.
 */
import { parseProducedObjectRecord, type ProducedObjectRecord } from '../models/nodeEngine.js';
import { getConfigForVehicle } from './modalityGenerationConfig.service.js';
import { saveProducedObjectArtifact } from './store.service.js';
import { getProducedVideoBrief } from './videoBriefProduction.service.js';
import { ingestProducedVideoFromHeyGen } from './videoAsset.service.js';
import { checkTranscriptFidelity } from './transcriptFidelity.service.js';
import {
  VideoRenderError,
  executeVideoRender,
  mapRenderStatusToEnvelope,
  refreshHeyGenVideoRender,
} from './videoRender.service.js';

export { VideoRenderError };

function extractScriptAndTitle(produced: ProducedObjectRecord): {
  script: string;
  title: string;
  renderStyle: 'studio_direct' | 'video_agent_produced';
  agentPrompt: string;
} {
  const ms = (produced.envelope.modality_specific ?? {}) as Record<string, unknown>;
  const videoBrief = ms.video_brief as Record<string, unknown> | undefined;
  const narration = videoBrief?.narration as Record<string, unknown> | undefined;
  const heygenPromptPayload = videoBrief?.heygen_prompt_payload as Record<string, unknown> | undefined;
  const script = String(
    ms.transcript ?? narration?.full_script ?? ''
  ).trim();
  if (!script) {
    throw new VideoRenderError('Video brief has no transcript/script.');
  }
  const title = String(
    narration?.video_title ??
      produced.envelope.accessibility?.alt_text ??
      produced.object_id
  );
  const renderStyle =
    ms.video_render_style === 'video_agent_produced' ||
    ms.video_render_style === 'studio_direct'
      ? ms.video_render_style
      : videoBrief?.video_render_style === 'video_agent_produced'
        ? 'video_agent_produced'
        : 'studio_direct';
  const agentPrompt = String(
    ms.heygen_prompt ?? heygenPromptPayload?.prompt ?? ''
  );
  return { script, title, renderStyle, agentPrompt };
}

async function applyRenderOutcome(
  produced: ProducedObjectRecord,
  courseCode: string,
  outcome: Awaited<ReturnType<typeof executeVideoRender>>
): Promise<ProducedObjectRecord> {
  const ms = (produced.envelope.modality_specific ?? {}) as Record<string, unknown>;
  const {
    render_status: _renderStatus,
    heygen_video_id: _heygenVideoId,
    heygen_session_id: _heygenSessionId,
    video_url: _videoUrl,
    heygen_source_url: _heygenSourceUrl,
    render_provider: _renderProvider,
    render_path: _renderPath,
    render_mock: _renderMock,
    render_failure_message: _renderFailureMessage,
    last_render_at: _lastRenderAt,
    rendered_transcript: _renderedTranscript,
    transcript_fidelity: _transcriptFidelity,
    maestro_video_asset_id: _assetId,
    maestro_video_stored: _stored,
    maestro_video_bytes: _bytes,
    maestro_video_ingested_at: _ingestedAt,
    maestro_video_ingest_error: _ingestError,
    ...briefFields
  } = ms;

  const renderStatus = mapRenderStatusToEnvelope(outcome.status);
  let ingestFields: Record<string, unknown> = {};
  let fidelityFields: Record<string, unknown> = {};

  if (renderStatus === 'render_complete' && outcome.video_url) {
    const ingest = await ingestProducedVideoFromHeyGen({
      courseCode,
      objectId: produced.object_id,
      heygenVideoId: outcome.video_id,
      sourceUrl: outcome.video_url,
      mock: outcome.mock,
    });
    ingestFields = {
      maestro_video_asset_id: ingest.maestro_video_asset_id,
      maestro_video_stored: ingest.maestro_video_stored,
      ...(ingest.maestro_video_bytes !== undefined
        ? { maestro_video_bytes: ingest.maestro_video_bytes }
        : {}),
      ...(ingest.maestro_video_ingested_at
        ? { maestro_video_ingested_at: ingest.maestro_video_ingested_at }
        : {}),
      ...(ingest.maestro_video_ingest_error
        ? { maestro_video_ingest_error: ingest.maestro_video_ingest_error }
        : {}),
    };

    // Moderate-fidelity guardrail: approved full_script stays canonical; compare
    // the rendered transcript (when captured) and flag academic drift for SME.
    const approvedScript = String(
      ms.transcript ?? (ms.video_brief as { narration?: { full_script?: string } } | undefined)?.narration?.full_script ?? ''
    );
    const renderedTranscript = outcome.transcript;
    const { fidelity, notes } = checkTranscriptFidelity(approvedScript, renderedTranscript);
    fidelityFields = {
      ...(renderedTranscript ? { rendered_transcript: renderedTranscript } : {}),
      transcript_fidelity: fidelity,
      ...(notes.length > 0 ? { transcript_fidelity_notes: notes } : {}),
    };
  }

  const updated: ProducedObjectRecord = {
    ...produced,
    envelope: {
      ...produced.envelope,
      modality_specific: {
        ...briefFields,
        render_status: renderStatus,
        heygen_video_id: outcome.video_id,
        ...(outcome.session_id ? { heygen_session_id: outcome.session_id } : {}),
        ...(outcome.render_path ? { render_path: outcome.render_path } : {}),
        ...(outcome.video_url ? { heygen_source_url: outcome.video_url } : {}),
        render_provider: outcome.provider,
        render_mock: outcome.mock ?? false,
        ...(outcome.failure_message ? { render_failure_message: outcome.failure_message } : {}),
        last_render_at: new Date().toISOString(),
        ...ingestFields,
        ...fidelityFields,
      },
    },
  };
  return parseProducedObjectRecord(JSON.parse(JSON.stringify(updated)));
}

export async function submitVideoRenderForObject(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  objectId: string
): Promise<ProducedObjectRecord> {
  const produced = await getProducedVideoBrief(courseCode, subtopicId, nodeId, objectId);
  if (!produced || produced.produced_modality !== 'video') {
    throw new VideoRenderError('Produce a video brief first.');
  }

  const { script, title, renderStyle, agentPrompt } = extractScriptAndTitle(produced);
  const videoSettings = getConfigForVehicle('video')?.videoSettings ?? { provider: 'heygen' };
  const outcome = await executeVideoRender({
    script,
    title,
    videoSettings,
    objectId,
    renderStyle,
    ...(renderStyle === 'video_agent_produced' ? { agentPrompt } : {}),
  });
  const validated = await applyRenderOutcome(produced, courseCode, outcome);
  await saveProducedObjectArtifact(courseCode, objectId, validated);
  return validated;
}

export async function refreshVideoRenderForObject(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  objectId: string
): Promise<ProducedObjectRecord> {
  const produced = await getProducedVideoBrief(courseCode, subtopicId, nodeId, objectId);
  if (!produced || produced.produced_modality !== 'video') {
    throw new VideoRenderError('No produced video object.');
  }

  const ms = produced.envelope.modality_specific ?? {};
  const videoId = typeof ms.heygen_video_id === 'string' ? ms.heygen_video_id : '';
  const sessionId = typeof ms.heygen_session_id === 'string' ? ms.heygen_session_id : '';
  const renderPath: 'direct_video' | 'video_agent' =
    ms.render_path === 'video_agent' ? 'video_agent' : 'direct_video';

  // Agent renders may have only a session id before a video id is assigned.
  if (renderPath === 'video_agent') {
    if (!videoId && !sessionId) {
      throw new VideoRenderError('No HeyGen session/video id — submit render first.');
    }
  } else if (!videoId) {
    throw new VideoRenderError('No HeyGen video_id — submit render first.');
  }

  const { script } = extractScriptAndTitle(produced);
  const videoSettings = getConfigForVehicle('video')?.videoSettings ?? { provider: 'heygen' };
  const outcome = await refreshHeyGenVideoRender({
    ...(videoId ? { videoId } : {}),
    ...(sessionId ? { sessionId } : {}),
    script,
    videoSettings,
    renderPath,
  });
  const validated = await applyRenderOutcome(produced, courseCode, outcome);
  await saveProducedObjectArtifact(courseCode, objectId, validated);
  return validated;
}
