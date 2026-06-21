/**
 * Structured Visual production (Level 3) — turns an approved content spec into a
 * semantic visual specification that the platform renders. No external API.
 */
import {
  parseGeneratedObjectEnvelope,
  parseProducedObjectRecord,
  type ContentPattern,
  type GeneratedObjectEnvelope,
  type GenerationMode,
  type LearningObjectContentSpec,
  type ProducedObjectRecord,
} from '../models/nodeEngine.js';
import {
  STRUCTURED_VISUAL_OUTPUT_CONTRACT,
  finalizeStructuredVisual,
  parseStructuredVisualContent,
  type SemanticElement,
  type StructuredVisualContent,
  type StructuredVisualType,
} from './structuredVisual.types.js';
import {
  ContentSpecNotApprovedError,
  type TextProductionAudit,
  type TextProductionExecutor,
} from './modalityProduction.service.js';
import { getContentSpec } from './contentSpec.service.js';
import { getProducedObjectArtifact, saveProducedObjectArtifact } from './store.service.js';
import { getActiveTemplateForVehicle } from './promptTemplateRegistry.service.js';
import { resolvedModelForVehicle } from './modalityGenerationConfig.service.js';
import {
  callModel,
  collectCouncilResponses,
  synthesizeWithChairmanModel,
  type AIMessage,
} from '../services/council.service.js';
import { parseAIJson } from '../services/ai.service.js';

export class StructuredVisualProductionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StructuredVisualProductionError';
  }
}

export { ContentSpecNotApprovedError };

/** Map content pattern → a sensible default visual_type for the deterministic path. */
function defaultVisualType(pattern: ContentPattern): StructuredVisualType {
  switch (pattern) {
    case 'comparison':
      return 'comparison_table';
    case 'worked_example':
      return 'annotated_example';
    case 'scenario':
    case 'case':
      return 'process_map';
    default:
      return 'concept_map';
  }
}

function buildStructuredVisualMessages(
  spec: LearningObjectContentSpec,
  taskPrompt: string
): AIMessage[] {
  const userPayload = {
    content_spec: spec,
    output_contract: STRUCTURED_VISUAL_OUTPUT_CONTRACT,
  };
  return [
    { role: 'system', content: taskPrompt },
    {
      role: 'user',
      content: `Produce a SEMANTIC VISUAL SPECIFICATION for the following APPROVED content specification. Display academic content faithfully; do NOT invent it.\n\n${JSON.stringify(
        userPayload,
        null,
        2
      )}`,
    },
  ];
}

/** Deterministic structured visual for tests — no LLM. */
export function projectStructuredVisualFromContentSpec(
  spec: LearningObjectContentSpec
): StructuredVisualContent {
  const elements: SemanticElement[] = [];

  elements.push({
    element_id: 'concept_core',
    element_type: 'concept',
    label: spec.title,
    description: spec.required_explanation.slice(0, 400),
    ...(spec.grounding_references[0]?.citation
      ? { citation: spec.grounding_references[0].citation }
      : {}),
    importance: 'primary',
  });

  spec.examples.forEach((ex, i) => {
    elements.push({
      element_id: `example_${i + 1}`,
      element_type: 'example',
      label: ex.label || `Example ${i + 1}`,
      description: ex.content,
      ...(ex.citation?.citation ? { citation: ex.citation.citation } : {}),
    });
  });

  spec.non_examples.forEach((nx, i) => {
    elements.push({
      element_id: `non_example_${i + 1}`,
      element_type: 'non_example',
      label: nx.label || `Non-example ${i + 1}`,
      description: `${nx.content} — ${nx.why_not}`,
    });
  });

  const relationships = elements
    .filter((e) => e.element_type === 'example')
    .map((e) => ({
      from_element_id: e.element_id,
      to_element_id: 'concept_core',
      relationship_type: 'exemplifies' as const,
    }));

  const content: StructuredVisualContent = {
    visual_type: defaultVisualType(spec.content_pattern),
    title: spec.title,
    semantic_elements: elements,
    relationships,
    annotations: [],
    layout_intent: 'Lead with the core concept, then show how each example maps to it.',
    reading_order: elements.map((e) => e.element_id),
    alt_text: `Structured visual for ${spec.title}`,
    text_equivalent: spec.required_explanation,
    grounding_strength: spec.grounding_strength,
    rendering_route: 'platform_native',
  };

  return finalizeStructuredVisual(content);
}

function extractStructuredVisualFromLlmPayload(payload: unknown): StructuredVisualContent {
  if (payload === null || payload === undefined) {
    throw new StructuredVisualProductionError('LLM returned empty JSON.');
  }
  const obj = typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  if (!obj) {
    throw new StructuredVisualProductionError('LLM response was not a JSON object.');
  }
  if (obj.content && typeof obj.content === 'object') {
    return parseStructuredVisualContent({ content: obj.content });
  }
  return parseStructuredVisualContent(obj);
}

function buildStructuredVisualEnvelope(
  spec: LearningObjectContentSpec,
  content: StructuredVisualContent,
  audit: TextProductionAudit
): GeneratedObjectEnvelope {
  const envelope: GeneratedObjectEnvelope = {
    object_id: spec.object_id,
    object_family: spec.object_family,
    parent_node_id: spec.parent_node_id,
    parent_milestone_pack_id: spec.parent_milestone_pack_id ?? null,
    kc_ids: [...spec.kc_ids],
    node_object_purpose: spec.node_object_purpose,
    milestone_support_purpose: spec.milestone_support_purpose,
    produced_modality: 'structured_visual',
    content_pattern: spec.content_pattern,
    addresses_misconceptions: [...spec.addresses_misconception_ids],
    grounding_references: spec.grounding_references.map((c) => ({ ...c })),
    grounding_strength: spec.grounding_strength,
    estimated_effort_minutes: Math.max(
      2,
      Math.min(15, content.semantic_elements.length * 2)
    ),
    accessibility: {
      alt_text: content.alt_text,
      text_equivalent_ref: `text_equivalent:${spec.object_id}`,
    },
    version: '1.0.0',
    is_live_version: true,
    governance_status: 'recommended_sme_review',
    asset_ref: `data/courses/${spec.course_id}/node-engine/produced_${spec.object_id}.json`,
    modality_specific: {
      structured_visual: content,
      visual_type: content.visual_type,
      text_equivalent: content.text_equivalent,
      rendering_route: content.rendering_route,
      fidelity_check: content.fidelity_check,
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
    envelope.updates_learner_model = content.evidence_check_role === 'evidence_collection_visual';
    envelope.feeds_routing = content.evidence_check_role === 'evidence_collection_visual';
  }
  return envelope;
}

export function buildStructuredVisualExecutor(maxTokens = 10000): {
  executor: TextProductionExecutor;
  audit: TextProductionAudit;
} {
  const template = getActiveTemplateForVehicle('structured_visual');
  if (!template?.task_prompt) {
    throw new StructuredVisualProductionError('No active structured visual prompt template.');
  }
  const resolved = resolvedModelForVehicle('structured_visual');
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

export interface ProduceStructuredVisualOptions {
  persist?: boolean;
  executor?: TextProductionExecutor;
  useDeterministicProjection?: boolean;
  maxTokens?: number;
}

export async function produceStructuredVisualObject(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  objectId: string,
  options: ProduceStructuredVisualOptions = {}
): Promise<ProducedObjectRecord> {
  const { persist = true, useDeterministicProjection = false, maxTokens = 10000 } = options;
  const spec = await getContentSpec(courseCode, subtopicId, nodeId, objectId);
  if (!spec) {
    throw new StructuredVisualProductionError(
      `No content spec for object "${objectId}" — generate and approve first.`
    );
  }
  if (spec.status !== 'approved') {
    throw new ContentSpecNotApprovedError(objectId);
  }
  if (spec.suggested_vehicle !== 'structured_visual') {
    throw new StructuredVisualProductionError(
      `Object "${objectId}" has suggested_vehicle "${spec.suggested_vehicle}" — use the matching producer or change the blueprint/spec to structured_visual.`
    );
  }

  let content: StructuredVisualContent;
  let audit: TextProductionAudit;

  if (useDeterministicProjection) {
    content = projectStructuredVisualFromContentSpec(spec);
    audit = {
      model_used: 'deterministic_projection',
      model_selection_source: 'global_default',
      generation_mode: 'single',
      prompt_template_id: 'structured_visual_generation_prompt',
      prompt_version: 1,
      model_selection_reason: 'Deterministic test projection (no LLM).',
    };
  } else {
    const template = getActiveTemplateForVehicle('structured_visual');
    if (!template?.task_prompt) {
      throw new StructuredVisualProductionError('Active structured visual template has no task_prompt.');
    }
    const built = options.executor
      ? { executor: options.executor, audit: buildStructuredVisualExecutor(maxTokens).audit }
      : buildStructuredVisualExecutor(maxTokens);
    audit = built.audit;
    const messages = buildStructuredVisualMessages(spec, template.task_prompt);
    const raw = await built.executor(messages);
    const parsed = parseAIJson<unknown>(raw);
    content = finalizeStructuredVisual(extractStructuredVisualFromLlmPayload(parsed));
  }

  const envelope = buildStructuredVisualEnvelope(spec, content, audit);
  const validatedEnvelope = parseGeneratedObjectEnvelope(JSON.parse(JSON.stringify(envelope)));

  const record: ProducedObjectRecord = {
    object_id: spec.object_id,
    content_spec_id: spec.content_spec_id,
    node_id: spec.node_id,
    subtopic_id: subtopicId,
    course_id: spec.course_id,
    blueprint_suggested_vehicle: spec.suggested_vehicle,
    produced_modality: 'structured_visual',
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

export async function getProducedStructuredVisual(
  courseCode: string,
  _subtopicId: string,
  _nodeId: string,
  objectId: string
): Promise<ProducedObjectRecord | null> {
  const raw = await getProducedObjectArtifact(courseCode, objectId);
  if (!raw) return null;
  return parseProducedObjectRecord(raw);
}
