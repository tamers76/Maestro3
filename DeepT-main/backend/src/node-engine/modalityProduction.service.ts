/**
 * M10 — Modality Production service (Level 3, Build Spec §8.2–§8.14).
 *
 * Phase A: TEXT production only. Transforms an approved Level-2 content spec into
 * a produced GeneratedObjectEnvelope with typed text segments.
 *
 * Blueprint may suggest video/interactive/etc.; Phase A always renders TEXT as the
 * text-equivalent (renderer obeys the spec, not the blueprint vehicle).
 */
import {
  parseGeneratedObjectEnvelope,
  parseProducedObjectRecord,
  parseTextSegments,
  type GeneratedObjectEnvelope,
  type GenerationMode,
  type LearningObjectContentSpec,
  type ProducedObjectRecord,
  type TextFidelityCheck,
  type TextSegment,
} from '../models/nodeEngine.js';
import { getContentSpec } from './contentSpec.service.js';
import { getProducedObjectArtifact, saveProducedObjectArtifact } from './store.service.js';
import { getActiveTemplateForVehicle } from './promptTemplateRegistry.service.js';
import { resolvedModelForVehicle } from './modalityGenerationConfig.service.js';
import { getNodeEngineDefaultModel } from '../config.js';
import {
  callModel,
  collectCouncilResponses,
  synthesizeWithChairmanModel,
  type AIMessage,
} from '../services/council.service.js';
import { parseAIJson } from '../services/ai.service.js';

// ===========================================================================
// Public errors
// ===========================================================================

export class ContentSpecNotApprovedError extends Error {
  constructor(objectId: string) {
    super(`Content spec for object "${objectId}" must be approved before production.`);
    this.name = 'ContentSpecNotApprovedError';
  }
}

export class TextProductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TextProductionError';
  }
}

// ===========================================================================
// Executor + deterministic projection (test / golden path)
// ===========================================================================

export type TextProductionExecutor = (messages: AIMessage[]) => Promise<string>;

export interface TextProductionAudit {
  model_used: string;
  model_selection_source: string;
  generation_mode: GenerationMode;
  prompt_template_id: string;
  prompt_version: number;
  model_selection_reason?: string;
}

/** Deterministic renderer for tests — no LLM. */
export function projectTextSegmentsFromContentSpec(spec: LearningObjectContentSpec): TextSegment[] {
  const segments: TextSegment[] = [];
  if (spec.title.trim()) {
    segments.push({ type: 'heading', text: spec.title });
  }
  segments.push({ type: 'body', text: spec.required_explanation });
  for (const ex of spec.examples) {
    segments.push({
      type: 'example',
      text: ex.label ? `${ex.label}: ${ex.content}` : ex.content,
      ...(ex.citation ? { citation: ex.citation } : {}),
    });
  }
  for (const nx of spec.non_examples) {
    segments.push({
      type: 'non_example',
      text: `${nx.label}: ${nx.content} — ${nx.why_not}`,
    });
  }
  if (spec.evidence_check_spec) {
    segments.push({ type: 'subheading', text: 'Evidence check' });
    segments.push({ type: 'body', text: spec.evidence_check_spec.learner_task });
    segments.push({ type: 'body', text: spec.evidence_check_spec.response_prompt });
    segments.push({ type: 'body', text: spec.evidence_check_spec.reasoning_prompt });
  }
  if (segments.length === 0) {
    segments.push({ type: 'body', text: spec.required_explanation || spec.title });
  }
  return segments;
}

function computeFidelityCheck(
  spec: LearningObjectContentSpec,
  segments: TextSegment[]
): TextFidelityCheck {
  const notes: string[] = [];
  const bodyText = segments
    .filter((s) => s.type === 'body' || s.type === 'definition')
    .map((s) => s.text)
    .join(' ');
  if (!bodyText.trim()) {
    notes.push('No body text segments were produced.');
  }
  if (spec.grounding_strength === 'weak') {
    notes.push('Source grounding is weak — SME review recommended before publish.');
  }
  if (spec.suggested_vehicle !== 'text') {
    notes.push(
      `Produced as text equivalent; blueprint suggested vehicle was "${spec.suggested_vehicle}".`
    );
  }
  return { status: notes.length === 0 ? 'passed' : 'needs_review', notes };
}

export function buildEnvelopeFromSpecAndSegments(
  spec: LearningObjectContentSpec,
  segments: TextSegment[],
  audit: TextProductionAudit
): GeneratedObjectEnvelope {
  const fidelity = computeFidelityCheck(spec, segments);
  const envelope: GeneratedObjectEnvelope = {
    object_id: spec.object_id,
    object_family: spec.object_family,
    parent_node_id: spec.parent_node_id,
    parent_milestone_pack_id: spec.parent_milestone_pack_id ?? null,
    kc_ids: [...spec.kc_ids],
    node_object_purpose: spec.node_object_purpose,
    milestone_support_purpose: spec.milestone_support_purpose,
    produced_modality: 'text',
    content_pattern: spec.content_pattern,
    addresses_misconceptions: [...spec.addresses_misconception_ids],
    grounding_references: spec.grounding_references.map((c) => ({ ...c })),
    grounding_strength: spec.grounding_strength,
    estimated_effort_minutes: 8,
    accessibility: { alt_text: null, text_equivalent_ref: null },
    version: '1.0.0',
    is_live_version: true,
    governance_status: 'recommended_sme_review',
    asset_ref: `data/courses/${spec.course_id}/node-engine/produced_${spec.object_id}.json`,
    modality_specific: {
      segments,
      fidelity_check: fidelity,
      content_spec_id: spec.content_spec_id,
      prompt_template_id: audit.prompt_template_id,
      prompt_version: audit.prompt_version,
      generation_mode: audit.generation_mode,
      ...(spec.suggested_vehicle !== 'text'
        ? { production_note: `Text equivalent of blueprint vehicle "${spec.suggested_vehicle}".` }
        : {}),
    },
    model_used: audit.model_used,
    model_selection_source: 'global_default' as const,
    ...(audit.model_selection_reason ? { model_selection_reason: audit.model_selection_reason } : {}),
  };
  if (spec.is_primary_evidence_check) {
    envelope.is_primary_evidence_check = true;
    envelope.updates_learner_model = true;
    envelope.feeds_routing = true;
  }
  return envelope;
}

function extractSegmentsFromLlmPayload(payload: unknown): TextSegment[] {
  if (payload === null || payload === undefined) {
    throw new TextProductionError('LLM returned empty JSON.');
  }
  const obj = typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  if (!obj) {
    throw new TextProductionError('LLM response was not a JSON object.');
  }
  const content = obj.content;
  if (content && typeof content === 'object' && content !== null) {
    const contentObj = content as Record<string, unknown>;
    if (Array.isArray(contentObj.segments)) {
      return parseTextSegments(contentObj.segments, 'LLM.content.segments');
    }
  }
  if (Array.isArray(obj.segments)) {
    return parseTextSegments(obj.segments, 'LLM.segments');
  }
  throw new TextProductionError('LLM JSON did not include content.segments or segments[].');
}

export function buildTextProductionExecutor(maxTokens = 8000): {
  executor: TextProductionExecutor;
  audit: TextProductionAudit;
} {
  const template = getActiveTemplateForVehicle('text');
  if (!template) {
    throw new TextProductionError('No active text production prompt template.');
  }
  const resolved = resolvedModelForVehicle('text');
  const audit: TextProductionAudit = {
    model_used: resolved.model,
    model_selection_source: resolved.source,
    generation_mode: resolved.mode,
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

function buildProductionMessages(spec: LearningObjectContentSpec, taskPrompt: string): AIMessage[] {
  const userPayload = {
    content_spec: spec,
    output_contract: {
      format: 'JSON object only',
      required_shape: {
        content: {
          segments: [
            {
              type: 'heading|subheading|body|example|...',
              text: 'string',
            },
          ],
        },
      },
    },
  };
  return [
    { role: 'system', content: taskPrompt },
    {
      role: 'user',
      content: `Render the following APPROVED content specification as a text learning object.\n\n${JSON.stringify(userPayload, null, 2)}`,
    },
  ];
}

// ===========================================================================
// Persistence + orchestration
// ===========================================================================

async function requireApprovedContentSpec(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  objectId: string
): Promise<LearningObjectContentSpec> {
  const spec = await getContentSpec(courseCode, subtopicId, nodeId, objectId);
  if (!spec) {
    throw new TextProductionError(`No content spec for object "${objectId}" — generate and approve first.`);
  }
  if (spec.status !== 'approved') {
    throw new ContentSpecNotApprovedError(objectId);
  }
  return spec;
}

export async function getProducedObject(
  courseCode: string,
  _subtopicId: string,
  _nodeId: string,
  objectId: string
): Promise<ProducedObjectRecord | null> {
  const raw = await getProducedObjectArtifact(courseCode, objectId);
  if (!raw) return null;
  return parseProducedObjectRecord(raw);
}

export interface ProduceTextObjectOptions {
  persist?: boolean;
  executor?: TextProductionExecutor;
  /** Skip LLM — use deterministic segment projection (tests). */
  useDeterministicProjection?: boolean;
  maxTokens?: number;
}

export async function produceTextObject(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  objectId: string,
  options: ProduceTextObjectOptions = {}
): Promise<ProducedObjectRecord> {
  const { persist = true, useDeterministicProjection = false, maxTokens = 8000 } = options;
  const spec = await requireApprovedContentSpec(courseCode, subtopicId, nodeId, objectId);

  let segments: TextSegment[];
  let audit: TextProductionAudit;

  if (useDeterministicProjection) {
    segments = projectTextSegmentsFromContentSpec(spec);
    audit = {
      model_used: 'deterministic_projection',
      model_selection_source: 'global_default',
      generation_mode: 'single',
      prompt_template_id: 'text_generation_prompt',
      prompt_version: 1,
      model_selection_reason: 'Deterministic test projection (no LLM).',
    };
  } else {
    const template = getActiveTemplateForVehicle('text');
    if (!template?.task_prompt) {
      throw new TextProductionError('Active text template has no task_prompt.');
    }
    const built = options.executor
      ? {
          executor: options.executor,
          audit: buildTextProductionExecutor(maxTokens).audit,
        }
      : buildTextProductionExecutor(maxTokens);
    audit = built.audit;
    const messages = buildProductionMessages(spec, template.task_prompt);
    const raw = await built.executor(messages);
    const parsed = parseAIJson<unknown>(raw);
    segments = extractSegmentsFromLlmPayload(parsed);
  }

  const envelope = buildEnvelopeFromSpecAndSegments(spec, segments, audit);
  const validatedEnvelope = parseGeneratedObjectEnvelope(JSON.parse(JSON.stringify(envelope)));

  const record: ProducedObjectRecord = {
    object_id: spec.object_id,
    content_spec_id: spec.content_spec_id,
    node_id: spec.node_id,
    subtopic_id: subtopicId,
    course_id: spec.course_id,
    blueprint_suggested_vehicle: spec.suggested_vehicle,
    produced_modality: 'text',
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

export async function getProducedObjectsForNodes(
  courseCode: string,
  objectIds: string[]
): Promise<Record<string, ProducedObjectRecord | null>> {
  const entries = await Promise.all(
    objectIds.map(async (objectId) => {
      const raw = await getProducedObjectArtifact(courseCode, objectId);
      return [objectId, raw ? parseProducedObjectRecord(raw) : null] as const;
    })
  );
  return Object.fromEntries(entries);
}
