/**
 * M10 Phase B — Video brief production (HeyGen prompt ready; render deferred).
 */
import {
  parseGeneratedObjectEnvelope,
  parseProducedObjectRecord,
  type GeneratedObjectEnvelope,
  type GenerationMode,
  type LearningObjectContentSpec,
  type ProducedObjectRecord,
} from '../models/nodeEngine.js';
import {
  VIDEO_BRIEF_OUTPUT_CONTRACT,
  countScriptWords,
  finalizeVideoBrief,
  parseVideoBriefContent,
  resolveScriptWordBudget,
  type VideoBriefContent,
} from './videoBrief.types.js';
import {
  resolveEffectiveRenderStyle,
  DEFAULT_TARGET_DURATION_SECONDS,
  type RenderStyleOverride,
} from './videoAgentPrompt.service.js';
import { getConfigForVehicle } from './modalityGenerationConfig.service.js';
import type { VideoSettings } from '../models/nodeEngine.js';
import {
  ContentSpecNotApprovedError,
  type TextProductionAudit,
  type TextProductionExecutor,
} from './modalityProduction.service.js';
import { getContentSpec } from './contentSpec.service.js';
import { getProducedObjectArtifact, saveProducedObjectArtifact } from './store.service.js';
import { getActiveTemplateForVehicle } from './promptTemplateRegistry.service.js';
import { resolvedModelForVehicle } from './modalityGenerationConfig.service.js';
import { callModel, collectCouncilResponses, synthesizeWithChairmanModel, type AIMessage } from '../services/council.service.js';
import { parseAIJson } from '../services/ai.service.js';

export class VideoBriefProductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoBriefProductionError';
  }
}

export { ContentSpecNotApprovedError };

function getVideoSettings(): VideoSettings | undefined {
  return getConfigForVehicle('video')?.videoSettings;
}

function buildVideoProductionMessages(
  spec: LearningObjectContentSpec,
  taskPrompt: string,
  renderContext: {
    render_style: 'studio_direct' | 'video_agent_produced';
    target_duration_seconds: number;
    word_budget: number;
    target_audience: string;
  }
): AIMessage[] {
  const userPayload = {
    content_spec: spec,
    render_style: renderContext.render_style,
    target_duration_seconds: renderContext.target_duration_seconds,
    word_budget: renderContext.word_budget,
    target_audience: renderContext.target_audience,
    output_contract: VIDEO_BRIEF_OUTPUT_CONTRACT,
  };
  return [
    { role: 'system', content: taskPrompt },
    {
      role: 'user',
      content: `Produce a PRODUCTION-READY video brief for the following APPROVED content specification. The effective render_style is "${renderContext.render_style}".\n\n${JSON.stringify(userPayload, null, 2)}`,
    },
  ];
}

function deriveTargetAudience(spec: LearningObjectContentSpec): string {
  return `Learners studying ${spec.title}`;
}

function extractVideoBriefFromLlmPayload(payload: unknown): VideoBriefContent {
  if (payload === null || payload === undefined) {
    throw new VideoBriefProductionError('LLM returned empty JSON.');
  }
  const obj = typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  if (!obj) {
    throw new VideoBriefProductionError('LLM response was not a JSON object.');
  }
  if (obj.content && typeof obj.content === 'object') {
    return parseVideoBriefContent({ content: obj.content });
  }
  return parseVideoBriefContent(obj);
}

export interface ProjectVideoBriefOptions {
  renderStyle?: 'studio_direct' | 'video_agent_produced';
  settings?: VideoSettings;
}

/** Deterministic brief for tests — no LLM. Defaults to studio_direct for back-compat. */
export function projectVideoBriefFromContentSpec(
  spec: LearningObjectContentSpec,
  options: ProjectVideoBriefOptions = {}
): VideoBriefContent {
  const renderStyle = options.renderStyle ?? 'studio_direct';
  const script = [
    spec.title.trim(),
    '',
    spec.required_explanation.trim(),
    ...(spec.examples.length > 0
      ? ['', 'Example:', spec.examples.map((e) => e.content).join(' ')]
      : []),
  ]
    .filter(Boolean)
    .join('\n');

  const notes: string[] = [];
  if (spec.grounding_strength === 'weak') {
    notes.push('Source grounding is weak — SME review recommended before HeyGen render.');
  }

  const brief: VideoBriefContent = {
    academic_coverage: {
      core_message: spec.required_explanation.slice(0, 500),
      required_explanation: spec.required_explanation,
      must_not_omit: [spec.title, spec.required_explanation.slice(0, 200)],
      must_not_add: ['Content not in the approved content specification'],
    },
    narration: {
      video_title: spec.title,
      opening_line: `In this segment, we focus on ${spec.title}.`,
      full_script: script,
      closing_summary: `You have covered the core ideas for ${spec.title}.`,
      approximate_duration_minutes: spec.node_object_purpose === 'orientation' ? 3 : 8,
    },
    narrative_flow: [
      { beat_order: 1, label: 'Opening', purpose: 'Orient the learner' },
      { beat_order: 2, label: 'Core explanation', purpose: 'Deliver approved academic content' },
      { beat_order: 3, label: 'Close', purpose: 'Summarize key takeaway' },
    ],
    tone: 'Warm, professional, encouraging, clear — suitable for higher-education learners.',
    visual_direction:
      'Avatar presents narration; use side panels or cutaways for examples; keep avatar unobstructed.',
    what_to_avoid: [
      'Do not place graphics on the avatar face or body',
      'Do not invent academic content beyond the spec',
      'No marketing tone or decorative animations',
    ],
    avatar_visibility_rules: {
      keep_avatar_unobstructed: true,
      supporting_graphics_placement: 'side_panel',
      caption_safe_zone: 'Do not cover face or upper body',
    },
    transcript: script,
    heygen_prompt_payload: {
      prompt: '',
      recommended_mode: 'generate',
      settings_controlled_outside_prompt: [
        'avatar_id',
        'voice_id',
        'engine',
        'resolution',
        'aspect_ratio',
        'output_format',
        'callback_url',
      ],
    },
    grounding_strength: spec.grounding_strength,
    fidelity_check: { status: notes.length === 0 ? 'passed' : 'needs_review', notes },
    video_render_style: renderStyle,
  };

  if (renderStyle === 'video_agent_produced') {
    brief.agent_production = projectAgentProductionFromScript(spec, script);
  }

  return finalizeVideoBrief(brief, options.settings);
}

/**
 * Deterministic agent_production projection — splits the script into sections so
 * the concatenation equals full_script (passes the verbatim guardrail). Used by
 * tests and as a fallback; the LLM normally produces richer sections.
 */
function projectAgentProductionFromScript(
  spec: LearningObjectContentSpec,
  script: string
): VideoBriefContent['agent_production'] {
  const paragraphs = script
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  // Keep the verbatim invariant: section narrations joined by ' ' must equal the
  // normalized full_script. We split on existing lines so no words are added/lost.
  const chunks = paragraphs.length >= 3 ? paragraphs : [script.trim()];
  const sections = chunks.map((narration, i) => ({
    section_number: i + 1,
    title: i === 0 ? 'Introduction' : i === chunks.length - 1 ? 'Summary' : `Part ${i + 1}`,
    duration_seconds: Math.round(DEFAULT_TARGET_DURATION_SECONDS / chunks.length),
    narration,
    visual_description:
      'Full-screen animated scene illustrating the narration with motion graphics and a relevant metaphor; cut to the presenter for emphasis.',
  }));
  return {
    learning_objective: spec.required_explanation.slice(0, 300),
    target_audience: deriveTargetAudience(spec),
    sections,
    production_notes:
      'Produced explainer style: vivid motion graphics and metaphors per scene; presenter opens and closes on camera with voice-over scenes in between. Illustrate only approved content — no invented facts.',
    critical_on_screen_text: [],
  };
}

function buildVideoEnvelope(
  spec: LearningObjectContentSpec,
  brief: VideoBriefContent,
  audit: TextProductionAudit,
  renderStyleMeta?: {
    effectiveStyle: 'studio_direct' | 'video_agent_produced';
    override?: RenderStyleOverride;
    wordBudget?: number;
  }
): GeneratedObjectEnvelope {
  const envelope: GeneratedObjectEnvelope = {
    object_id: spec.object_id,
    object_family: spec.object_family,
    parent_node_id: spec.parent_node_id,
    parent_milestone_pack_id: spec.parent_milestone_pack_id ?? null,
    kc_ids: [...spec.kc_ids],
    node_object_purpose: spec.node_object_purpose,
    milestone_support_purpose: spec.milestone_support_purpose,
    produced_modality: 'video',
    content_pattern: spec.content_pattern,
    addresses_misconceptions: [...spec.addresses_misconception_ids],
    grounding_references: spec.grounding_references.map((c) => ({ ...c })),
    grounding_strength: spec.grounding_strength,
    estimated_effort_minutes: Math.max(
      1,
      Math.ceil(
        (brief.narration.script_word_count ?? countScriptWords(brief.narration.full_script)) / 140
      )
    ),
    accessibility: {
      alt_text: brief.narration.video_title,
      text_equivalent_ref: `transcript:${spec.object_id}`,
    },
    version: '1.0.0',
    is_live_version: true,
    governance_status: 'recommended_sme_review',
    asset_ref: `data/courses/${spec.course_id}/node-engine/produced_${spec.object_id}.json`,
    modality_specific: {
      video_brief: brief,
      heygen_prompt: brief.heygen_prompt_payload.prompt,
      heygen_recommended_mode: brief.heygen_prompt_payload.recommended_mode,
      transcript: brief.transcript,
      script_word_count: brief.narration.script_word_count,
      ...(renderStyleMeta?.wordBudget ? { script_word_budget: renderStyleMeta.wordBudget } : {}),
      render_status: 'brief_ready',
      video_render_style:
        renderStyleMeta?.effectiveStyle ?? brief.video_render_style ?? 'studio_direct',
      ...(renderStyleMeta?.override && renderStyleMeta.override !== 'inherit'
        ? { video_render_style_override: renderStyleMeta.override }
        : {}),
      ...(brief.agent_production ? { agent_production: brief.agent_production } : {}),
      content_spec_id: spec.content_spec_id,
      prompt_template_id: audit.prompt_template_id,
      prompt_version: audit.prompt_version,
      generation_mode: audit.generation_mode,
    },
    model_used: audit.model_used,
    model_selection_source: 'global_default',
    ...(audit.model_selection_reason ? { model_selection_reason: audit.model_selection_reason } : {}),
  };
  if (spec.is_primary_evidence_check) {
    envelope.is_primary_evidence_check = true;
    envelope.updates_learner_model = false;
    envelope.feeds_routing = false;
  }
  return envelope;
}

export function buildVideoProductionExecutor(maxTokens = 12000): {
  executor: TextProductionExecutor;
  audit: TextProductionAudit;
} {
  const template = getActiveTemplateForVehicle('video');
  if (!template?.task_prompt) {
    throw new VideoBriefProductionError('No active video brief prompt template.');
  }
  const resolved = resolvedModelForVehicle('video');
  const audit: TextProductionAudit = {
    model_used: resolved.model,
    model_selection_source: resolved.source,
    generation_mode: resolved.mode as GenerationMode,
    prompt_template_id: template.prompt_template_id,
    prompt_version: template.version,
    ...(resolved.reason ? { model_selection_reason: resolved.reason } : {}),
  };

  const executor: TextProductionExecutor = async (messages) => {
    if (resolved.mode === 'council' && resolved.councilModels && resolved.councilModels.length > 1) {
      const responses = await collectCouncilResponses(messages, resolved.councilModels, {
        maxTokens,
        jsonMode: true,
      });
      const chairman = resolved.chairmanModel ?? resolved.model;
      return synthesizeWithChairmanModel(messages, responses, chairman, { maxTokens, jsonMode: true });
    }
    return callModel(messages, resolved.model, { maxTokens, jsonMode: true });
  };

  return { executor, audit };
}

export interface ProduceVideoBriefOptions {
  persist?: boolean;
  executor?: TextProductionExecutor;
  useDeterministicProjection?: boolean;
  maxTokens?: number;
  /** Per-object render-style override (Layer 4). "inherit" uses the settings default. */
  renderStyleOverride?: RenderStyleOverride;
}

export async function produceVideoBriefObject(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  objectId: string,
  options: ProduceVideoBriefOptions = {}
): Promise<ProducedObjectRecord> {
  const { persist = true, useDeterministicProjection = false, maxTokens = 12000 } = options;
  const spec = await getContentSpec(courseCode, subtopicId, nodeId, objectId);
  if (!spec) {
    throw new VideoBriefProductionError(
      `No content spec for object "${objectId}" — generate and approve first.`
    );
  }
  if (spec.status !== 'approved') {
    throw new ContentSpecNotApprovedError(objectId);
  }
  if (spec.suggested_vehicle !== 'video') {
    throw new VideoBriefProductionError(
      `Object "${objectId}" has suggested_vehicle "${spec.suggested_vehicle}" — use text production or change the blueprint/spec to video.`
    );
  }

  const videoSettings = getVideoSettings();
  const effectiveStyle = resolveEffectiveRenderStyle(videoSettings, options.renderStyleOverride);
  const targetDuration =
    videoSettings?.target_duration_seconds && videoSettings.target_duration_seconds > 0
      ? videoSettings.target_duration_seconds
      : DEFAULT_TARGET_DURATION_SECONDS;
  const wordBudget = resolveScriptWordBudget(videoSettings?.target_duration_seconds);

  let brief: VideoBriefContent;
  let audit: TextProductionAudit;

  if (useDeterministicProjection) {
    brief = projectVideoBriefFromContentSpec(spec, {
      renderStyle: effectiveStyle,
      settings: videoSettings,
    });
    audit = {
      model_used: 'deterministic_projection',
      model_selection_source: 'global_default',
      generation_mode: 'single',
      prompt_template_id: 'video_brief_generation_prompt',
      prompt_version: 1,
      model_selection_reason: 'Deterministic test projection (no LLM).',
    };
  } else {
    const template = getActiveTemplateForVehicle('video');
    if (!template?.task_prompt) {
      throw new VideoBriefProductionError('Active video template has no task_prompt.');
    }
    const built = options.executor
      ? {
          executor: options.executor,
          audit: buildVideoProductionExecutor(maxTokens).audit,
        }
      : buildVideoProductionExecutor(maxTokens);
    audit = built.audit;
    const messages = buildVideoProductionMessages(spec, template.task_prompt, {
      render_style: effectiveStyle,
      target_duration_seconds: targetDuration,
      word_budget: wordBudget,
      target_audience: deriveTargetAudience(spec),
    });
    const raw = await built.executor(messages);
    const parsed = parseAIJson<unknown>(raw);
    brief = extractVideoBriefFromLlmPayload(parsed);
    brief.video_render_style = effectiveStyle;
    brief = finalizeVideoBrief(brief, videoSettings);
  }

  const envelope = buildVideoEnvelope(spec, brief, audit, {
    effectiveStyle,
    override: options.renderStyleOverride,
    wordBudget,
  });
  const validatedEnvelope = parseGeneratedObjectEnvelope(JSON.parse(JSON.stringify(envelope)));

  const record: ProducedObjectRecord = {
    object_id: spec.object_id,
    content_spec_id: spec.content_spec_id,
    node_id: spec.node_id,
    subtopic_id: subtopicId,
    course_id: spec.course_id,
    blueprint_suggested_vehicle: spec.suggested_vehicle,
    produced_modality: 'video',
    envelope: validatedEnvelope,
    prompt_template_id: audit.prompt_template_id,
    prompt_version: audit.prompt_version,
    generation_mode: audit.generation_mode,
    produced_at: new Date().toISOString(),
  };

  const validated = parseProducedObjectRecord(JSON.parse(JSON.stringify(record)));
  if (persist) {
    await saveProducedObjectArtifact(courseCode, objectId, validated);
  }
  return validated;
}

export async function getProducedVideoBrief(
  courseCode: string,
  _subtopicId: string,
  _nodeId: string,
  objectId: string
): Promise<ProducedObjectRecord | null> {
  const raw = await getProducedObjectArtifact(courseCode, objectId);
  if (!raw) return null;
  return parseProducedObjectRecord(raw);
}
