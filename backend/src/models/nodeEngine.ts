/**
 * Maestro Node Engine — M1 Schema & Enum Core.
 *
 * Single source of truth for every node-engine enum and the V1 contract shapes
 * (Build Spec Steps 1-9; field lists from the Phase 0 Handoff Pack Parts 2-3).
 * Kept separate from the legacy `schemas.ts` so the legacy `LearningNode`/
 * `Topic`/`Subtopic` types are never touched. No runtime validation library is
 * present in this repo, so enums are `const` arrays + union types and each
 * contract type gets a hand-rolled `parse*` helper backed by `assertEnum`.
 *
 * Storage split (D1): the relational web (Node, KnowledgeComponent, EvidenceMap,
 * MilestoneAssessmentPack) belongs in Neo4j under NEW labels in later phases;
 * produced artifacts (envelopes, validation results, blueprints, content specs,
 * prompt templates) live in the JSON file store. Phase 0 only persists the
 * prompt-template registry (a document), so no graph writes happen yet.
 */

// ===========================================================================
// Canonical enums (D4) — do not redefine these string unions anywhere else.
// ===========================================================================

/** Governance state stored on an object. Only Step 9 may set the terminal
 * `rejected` value (D6). */
export const GOVERNANCE_STATUSES = [
  'auto_proceed',
  'recommended_sme_review',
  'needs_sme_review',
  'sme_approved',
  'needs_revision',
  'regenerate',
  'rejected',
] as const;
export type GovernanceStatus = (typeof GOVERNANCE_STATUSES)[number];

/** Step 9 validator decision. Kept separate from GovernanceStatus; a `reject`
 * decision maps to GovernanceStatus `rejected` (D6). */
export const GOVERNANCE_DECISIONS = [
  'auto_proceed',
  'recommended_sme_review',
  'needs_sme_review',
  'needs_revision',
  'regenerate',
  'reject',
] as const;
export type GovernanceDecision = (typeof GOVERNANCE_DECISIONS)[number];

/** Maps a Step 9 governance decision to the terminal object governance status. */
export function governanceStatusFromDecision(decision: GovernanceDecision): GovernanceStatus {
  return decision === 'reject' ? 'rejected' : decision;
}

/** The eleven authoritative node types (Build Spec §1.2). */
export const NODE_TYPES = [
  'concept',
  'distinction',
  'misconception',
  'procedure',
  'judgment',
  'application',
  'integration',
  'reflection',
  'threshold',
  'bridge',
  'assessment_preparation',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Produced modality / vehicle (§8.6/§8.7). Same value space; `Vehicle` is an
 * alias used at design layers, `ProducedModality` at the produced-asset layer. */
export const PRODUCED_MODALITIES = [
  'text',
  'structured_visual',
  'pictorial_visual',
  'video',
  'interactive',
  'simulation',
  'learning_anchor',
] as const;
export type ProducedModality = (typeof PRODUCED_MODALITIES)[number];
export const VEHICLES = PRODUCED_MODALITIES;
export type Vehicle = ProducedModality;

/** Content pattern (§8.6) — recorded separately from modality; `none` is valid. */
export const CONTENT_PATTERNS = [
  'none',
  'scenario',
  'case',
  'comparison',
  'worked_example',
  'challenge_prompt',
  'mini_artifact',
] as const;
export type ContentPattern = (typeof CONTENT_PATTERNS)[number];

export const OBJECT_FAMILIES = ['node_learning_object', 'milestone_support_object'] as const;
export type ObjectFamily = (typeof OBJECT_FAMILIES)[number];

/** Purpose of a node learning object (§8.6). */
export const NODE_OBJECT_PURPOSES = [
  'orientation',
  'explanation',
  'worked_example',
  'practice',
  'evidence_check',
  'remediation',
  'enrichment',
  'reflection',
  'bridge',
  'assessment_connection',
] as const;
export type NodeObjectPurpose = (typeof NODE_OBJECT_PURPOSES)[number];

/** Purpose of a milestone support object (§8.6). */
export const MILESTONE_SUPPORT_PURPOSES = [
  'assessment_brief',
  'rubric_decoder',
  'artifact_checklist',
  'example_structure',
  'ai_use_rules',
  'ai_use_acknowledgement',
  'disclosure_form',
  'decision_log',
  'readiness_checklist',
  'blocking_reason_message',
  'unlock_message',
] as const;
export type MilestoneSupportPurpose = (typeof MILESTONE_SUPPORT_PURPOSES)[number];

export const DIAGNOSTIC_BANDS = ['secure', 'fragile', 'knowledge_gap', 'misconception'] as const;
export type DiagnosticBand = (typeof DIAGNOSTIC_BANDS)[number];

export const CAPTURE_SIGNALS = ['response', 'reasoning', 'confidence', 'process'] as const;
export type CaptureSignal = (typeof CAPTURE_SIGNALS)[number];

export const GROUNDING_STRENGTHS = ['strong', 'moderate', 'weak'] as const;
export type GroundingStrength = (typeof GROUNDING_STRENGTHS)[number];

/** Where a node-set's grounding passages actually came from (retrieval transparency).
 * `scoped_references` = CLO/subtopic-tagged hits (the Reference-Alignment goal);
 * `course_level_references` = unscoped course-level safety-net hits;
 * `model_only` = no reference passages at all (not academically approvable). */
export const GROUNDING_SOURCES = ['scoped_references', 'course_level_references', 'model_only'] as const;
export type GroundingSourceKind = (typeof GROUNDING_SOURCES)[number];

export const VALIDATION_STATUSES = ['passed', 'passed_with_warnings', 'failed'] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const CHECK_STATUSES = ['passed', 'warning', 'failed', 'not_applicable'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const REVIEW_PRIORITIES = ['standard', 'recommended', 'required', 'urgent'] as const;
export type ReviewPriority = (typeof REVIEW_PRIORITIES)[number];

/** M7 review-by-exception triage bucket (Issue 1). A `must_review` node needs SME
 * judgment before approval; a `can_proceed` node is visible/openable but not
 * gating. Distinct from the Step 9 ValidationResult `ReviewPriority` vocabulary. */
export const NODE_REVIEW_PRIORITIES = ['must_review', 'can_proceed'] as const;
export type NodeReviewPriority = (typeof NODE_REVIEW_PRIORITIES)[number];

/** V1 uses `course_only`; the wider scope vocabulary is reserved for later. */
export const REUSE_SCOPES = [
  'course_only',
  'program_library',
  'organization_library',
  'global_library',
] as const;
export type ReuseScope = (typeof REUSE_SCOPES)[number];

export const GENERATION_MODES = ['single', 'council'] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const MISCONCEPTION_SEVERITIES = ['low', 'medium', 'high'] as const;
export type MisconceptionSeverity = (typeof MISCONCEPTION_SEVERITIES)[number];

export const SUBMISSION_BLOCK_STATES = ['confirmed', 'suspected', 'never'] as const;
export type SubmissionBlockState = (typeof SUBMISSION_BLOCK_STATES)[number];

/**
 * M7 Clarification 1 — `preferred_evidence_mode` is the KIND of evidence a node
 * needs (a RESPONSE-mode), NOT a delivery vehicle/modality. The delivery vehicle
 * (text/interactive/...) is decided later in M8/M10; M7 only states what kind of
 * evidence the node requires. Never use modality values (interactive|text|...)
 * here.
 */
export const PREFERRED_EVIDENCE_MODES = [
  'explain',
  'classify_and_justify',
  'select_and_justify',
  'apply_to_case',
  'artifact_fragment',
  'simulation_decision',
  'reflection_response',
] as const;
export type PreferredEvidenceMode = (typeof PREFERRED_EVIDENCE_MODES)[number];

/**
 * M7 Clarification 2 — a node declares whether its misconception slots are still
 * `pending` (M7 proposed candidates; Step 3 must approve/populate the library and
 * final bindings) or `populated` (an approved registry binding already exists).
 */
export const MISCONCEPTION_SLOT_STATES = ['pending', 'populated'] as const;
export type MisconceptionSlotState = (typeof MISCONCEPTION_SLOT_STATES)[number];

/** Node risk-classification vocabulary (Build Spec §1.5). A node may carry more
 * than one trigger; govern at the highest. `high_risk` is provisional until the
 * Step 3 misconception library `severity` is known. */
export const RISK_CLASSIFICATIONS = ['standard', 'critical', 'bridge', 'high_risk'] as const;
export type RiskClassification = (typeof RISK_CLASSIFICATIONS)[number];

/** The four SOLO depth bands an `evidence_map` criterion is described at (§1.3). */
export const SOLO_BANDS = ['surface', 'multi_element', 'relational', 'extended_abstract'] as const;
export type SoloBand = (typeof SOLO_BANDS)[number];

/** Lifecycle status shared by node-engine review objects. */
export const NODE_ENGINE_STATUSES = [
  'draft',
  'needs_review',
  'approved',
  'needs_revision',
] as const;
export type NodeEngineStatus = (typeof NODE_ENGINE_STATUSES)[number];

/** Prompt-template lifecycle. `reserved` marks deferred vehicles (simulation). */
export const PROMPT_TEMPLATE_STATUSES = ['draft', 'approved', 'archived', 'reserved'] as const;
export type PromptTemplateStatus = (typeof PROMPT_TEMPLATE_STATUSES)[number];

export const GENERATOR_KINDS = ['chat', 'image', 'video'] as const;
export type GeneratorKind = (typeof GENERATOR_KINDS)[number];

/** Which layer a generation model was resolved from (audit trail, §model-config).
 * Binding precedence: prompt_template_override > modality_config > global_default. */
export const MODEL_SELECTION_SOURCES = [
  'global_default',
  'modality_config',
  'prompt_template_override',
] as const;
export type ModelSelectionSource = (typeof MODEL_SELECTION_SOURCES)[number];

// ---------------------------------------------------------------------------
// HeyGen v3 video render settings (bounded fields). Mirrors the CURRENT
// POST https://api.heygen.com/v3/videos body (researched 2026-04); the legacy
// /v3/video-agents + style_id/brand_kit_id flow is intentionally NOT modelled.
// Branding/templating is a separate v2 Template-API concern and is deferred.
// ---------------------------------------------------------------------------
export const VIDEO_ENGINES = ['avatar_iv', 'avatar_v'] as const;
export type VideoEngine = (typeof VIDEO_ENGINES)[number];

export const VIDEO_RESOLUTIONS = ['4k', '1080p', '720p'] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export const VIDEO_ASPECT_RATIOS = ['auto', '16:9', '9:16', '4:5', '5:4', '1:1'] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export const VIDEO_OUTPUT_FORMATS = ['mp4', 'webm'] as const;
export type VideoOutputFormat = (typeof VIDEO_OUTPUT_FORMATS)[number];

/**
 * Render style for HeyGen video objects:
 * - `studio_direct`        — POST /v3/videos (avatar + voice + verbatim script), talking head.
 * - `video_agent_produced` — POST /v3/video-agents (structured section prompt; scenes + graphics).
 */
export const VIDEO_RENDER_STYLES = ['studio_direct', 'video_agent_produced'] as const;
export type VideoRenderStyle = (typeof VIDEO_RENDER_STYLES)[number];

/** Narration fidelity for the Video Agent path (academic guardrails). */
export const NARRATION_FIDELITIES = ['strict', 'moderate'] as const;
export type NarrationFidelity = (typeof NARRATION_FIDELITIES)[number];

export const VIDEO_ORIENTATIONS = ['landscape', 'portrait'] as const;
export type VideoOrientation = (typeof VIDEO_ORIENTATIONS)[number];

/** Fixed Step 9 risk-flag vocabulary (§9.16, incl. `validator_uncertainty`). */
export const RISK_FLAGS = [
  'weak_grounding',
  'unsupported_claim',
  'assessment_facing',
  'evidence_check_failure',
  'routing_risk',
  'accessibility_risk',
  'council_disagreement',
  'new_template_candidate',
  'privacy_boundary_risk',
  'validator_uncertainty',
] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];

/** Keyed Step 9 checks (§9.16). */
export const VALIDATION_CHECK_NAMES = [
  'grounding',
  'preservation_rules',
  'object_purpose',
  'kc_misconception_alignment',
  'modality_specific',
  'evidence_check_integrity',
  'learner_model_write_safety',
  'routing_safety',
  'accessibility',
  'governance',
] as const;
export type ValidationCheckName = (typeof VALIDATION_CHECK_NAMES)[number];

// ===========================================================================
// Validation helpers (no zod) — assertEnum + small field guards.
// ===========================================================================

export class NodeEngineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeEngineValidationError';
  }
}

export function isEnumMember<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export function assertEnum<T extends string>(
  allowed: readonly T[],
  value: unknown,
  fieldName: string
): T {
  if (!isEnumMember(allowed, value)) {
    throw new NodeEngineValidationError(
      `Invalid value for "${fieldName}": ${JSON.stringify(value)}. Expected one of: ${allowed.join(', ')}`
    );
  }
  return value;
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NodeEngineValidationError(`Expected an object for ${context}, received ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

function requireString(obj: Record<string, unknown>, field: string, context: string): string {
  const v = obj[field];
  if (typeof v !== 'string' || v.length === 0) {
    throw new NodeEngineValidationError(`Missing/invalid string "${field}" in ${context}`);
  }
  return v;
}

function optionalString(obj: Record<string, unknown>, field: string): string | undefined {
  const v = obj[field];
  return typeof v === 'string' ? v : undefined;
}

function optionalNumber(obj: Record<string, unknown>, field: string): number | undefined {
  const v = obj[field];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function optionalStringArray(obj: Record<string, unknown>, field: string): string[] | undefined {
  const v = obj[field];
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}

function requireStringArray(obj: Record<string, unknown>, field: string, context: string): string[] {
  const v = obj[field];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new NodeEngineValidationError(`Missing/invalid string[] "${field}" in ${context}`);
  }
  return v as string[];
}

function requireBoolean(obj: Record<string, unknown>, field: string, context: string): boolean {
  const v = obj[field];
  if (typeof v !== 'boolean') {
    throw new NodeEngineValidationError(`Missing/invalid boolean "${field}" in ${context}`);
  }
  return v;
}

function requireInteger(obj: Record<string, unknown>, field: string, context: string): number {
  const v = obj[field];
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new NodeEngineValidationError(`Missing/invalid integer "${field}" in ${context}`);
  }
  return v;
}

// ===========================================================================
// M2 — Prompt template registry (§8.14)
// ===========================================================================

export interface Citation {
  citation: string;
  passage_ref: string;
}

/** One immutable prompt-template version. `(prompt_template_id, version)` is a
 * never-mutated record once published (D3). */
export interface PromptTemplate {
  prompt_template_id: string;
  prompt_template_name: string;
  vehicle: Vehicle;
  version: number;
  status: PromptTemplateStatus;
  generator_kind: GeneratorKind;
  /** The verbatim §8.14 task prompt. Empty for reserved/deferred vehicles. */
  task_prompt: string;
  /** The §8.14 output schema (object or named ref). */
  output_schema_ref: unknown;
  /** Optional council framing; task_prompt is shared across modes. */
  member_system_prompt?: string;
  chairman_system_prompt?: string;
  // ---------------------------------------------------------------------------
  // Optional per-VERSION model pin (set when a version is authored). These are
  // version-level, NOT a separate edit path: they are part of the immutable
  // version record and only change when a new version is minted. They are the
  // highest-precedence input to resolveGenerationModel(). Model config that
  // lives in ModalityGenerationConfig is stored/versioned INDEPENDENTLY of this.
  // ---------------------------------------------------------------------------
  modelOverride?: string;
  temperatureOverride?: number;
  maxTokensOverride?: number;
  modelSelectionReason?: string;
  // Audit fields
  last_updated_by: string;
  last_updated_at: string;
  change_note: string;
}

/** Registry entry: append-only version history + an active-version pointer. */
export interface PromptTemplateRegistryEntry {
  prompt_template_id: string;
  vehicle: Vehicle;
  active_version: number;
  versions: PromptTemplate[];
}

export interface PromptTemplateRegistryFile {
  schema_version: 1;
  updated_at: string;
  templates: PromptTemplateRegistryEntry[];
}

/** Optional per-voice tuning passed through to HeyGen v3 (POST /v3/videos). */
export interface VideoVoiceSettings {
  speed?: number;
  pitch?: number;
  locale?: string;
}

/**
 * HeyGen v3 video render settings. Mirrors the CURRENT POST /v3/videos body
 * shape EXACTLY (researched 2026-04). These are SETTINGS, never chosen by the
 * brief prompt: the video_brief_generation_prompt produces only the script and
 * lists avatar/voice/engine/render IDs under settings_controlled_outside_prompt.
 *
 * Intentionally OMITS style_id / brand_kit_id — branding/templating is a
 * separate v2 Template-API concern and is deferred entirely (do not add here).
 */
/** Snapshot of an institution-approved HeyGen avatar look. */
export interface AvatarLibraryEntry {
  id: string;
  name: string;
  preview_image_url?: string | null;
  avatar_type?: string | null;
  default_voice_id?: string | null;
  supported_api_engines?: string[];
  group_id?: string | null;
  character_name?: string | null;
}

/** @deprecated Use AvatarLibraryEntry */
export type FavoriteAvatarRef = AvatarLibraryEntry;

/**
 * Brand kit for the Video Agent path — configured inline in Maestro Settings.
 * Compiled into the agent prompt only when `enabled` is true.
 */
export interface VideoBrandKit {
  enabled: boolean;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  mediaTypeGuidance?: string;
}

/** Operator-editable directives compiled into the Video Agent prompt. */
export interface VideoAgentPromptTemplates {
  /** Fidelity framing (moderate vs strict) — overrides the built-in default. */
  scriptFramingDirective?: string;
  /** Default visual-style block used only when no `style_id` is selected. */
  defaultStyleBlock?: string;
}

export interface VideoSettings {
  provider: 'heygen';
  /** Reference to the API key (env/setting NAME), NEVER the key value itself. */
  apiKeyRef?: string;
  /** From GET /v3/avatars/looks (mocked in V1). */
  avatar_id?: string;
  /** From GET /v3/voices; prefer the avatar's default_voice_id. */
  voice_id?: string;
  /** HBMSU Avatar Library — configured looks available in the picker. */
  approved_avatars?: AvatarLibraryEntry[];
  /** Looks to rotate across course video objects (stable per object_id). */
  avatar_rotation_pool?: AvatarLibraryEntry[];
  /** @deprecated Migrated to approved_avatars on read. */
  favorite_avatars?: AvatarLibraryEntry[];
  engine?: VideoEngine;
  resolution?: VideoResolution;
  aspect_ratio?: VideoAspectRatio;
  voice_settings?: VideoVoiceSettings;
  background?: Record<string, unknown>;
  remove_background?: boolean;
  /** Natural-language body/gesture control. */
  motion_prompt?: string;
  output_format?: VideoOutputFormat;
  /** Webhook called on completion. */
  callback_url?: string;
  /** Course-wide default render style (per-object override happens in Layer 4). */
  video_render_style?: VideoRenderStyle;
  /** Narration fidelity for the Video Agent path. */
  narration_fidelity?: NarrationFidelity;
  /** HeyGen Video Agent curated visual style (GET /v3/video-agents/styles). */
  style_id?: string;
  orientation?: VideoOrientation;
  /** Target runtime hint for the agent (seconds). */
  target_duration_seconds?: number;
  brand_kit?: VideoBrandKit;
  agent_prompt_templates?: VideoAgentPromptTemplates;
}

/**
 * Per-vehicle generation/model config. Stored in its OWN global document
 * (config/modality-generation-config.json) so editing model settings NEVER
 * mints a new prompt-template version. `taskPrompt` here MIRRORS the active
 * template's prompt for display/wiring only — the authoritative prompt body
 * still lives in the PromptTemplate registry (D3).
 */
export interface ModalityGenerationConfig {
  id: string;
  vehicle: Vehicle;
  generatorKind: GeneratorKind;
  mode: GenerationMode;
  /** Mirror of the active template's prompt (display/wiring only — not authoritative). */
  taskPrompt: string;
  singleModel?: string;
  councilModels?: string[];
  chairmanModel?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  modelSelectionReason?: string;
  productionTarget?: string;
  /** HeyGen v3 render settings — only meaningful for the `video` vehicle. */
  videoSettings?: VideoSettings;
  enabled: boolean;
}

/** The own global document holding every per-vehicle model config. */
export interface ModalityGenerationConfigFile {
  schema_version: 1;
  updated_at: string;
  configs: ModalityGenerationConfig[];
}

// ===========================================================================
// Reference Coverage thresholds (Reference Coverage Check — read-only measurement)
// ===========================================================================

/**
 * Numeric thresholds that drive the per-CLO coverage evidence gate. Stored in
 * their OWN global document so an operator can tune them without touching the
 * coverage-judgment prompt or any generation config.
 *
 * - `topK`           — passages retrieved per CLO (hybrid retrieval cap).
 * - `relevanceFloor` — fused final_score a passage must meet to "count" as
 *                      supporting evidence (Layer 2 floor).
 * - `minPassages`    — minimum supporting passages to clear the evidence gate.
 * - `distributionMin`— minimum distinct documents among supporting passages
 *                      (forbids a single source masquerading as broad coverage).
 */
export interface ReferenceCoverageThresholds {
  topK: number;
  relevanceFloor: number;
  minPassages: number;
  distributionMin: number;
}

/** The own global document holding the reference-coverage thresholds. */
export interface ReferenceCoverageConfigFile {
  schema_version: 1;
  updated_at: string;
  thresholds: ReferenceCoverageThresholds;
}

function requirePositiveNumber(obj: Record<string, unknown>, field: string, context: string): number {
  const v = obj[field];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new NodeEngineValidationError(`Missing/invalid non-negative number "${field}" in ${context}`);
  }
  return v;
}

/** Typed accessor for the reference-coverage thresholds document. */
export function parseReferenceCoverageConfig(input: unknown): ReferenceCoverageConfigFile {
  const obj = asRecord(input, 'ReferenceCoverageConfigFile');
  const thresholdsRaw = asRecord(obj.thresholds ?? {}, 'ReferenceCoverageConfigFile.thresholds');
  const thresholds: ReferenceCoverageThresholds = {
    topK: requirePositiveNumber(thresholdsRaw, 'topK', 'ReferenceCoverageThresholds'),
    relevanceFloor: requirePositiveNumber(thresholdsRaw, 'relevanceFloor', 'ReferenceCoverageThresholds'),
    minPassages: requirePositiveNumber(thresholdsRaw, 'minPassages', 'ReferenceCoverageThresholds'),
    distributionMin: requirePositiveNumber(thresholdsRaw, 'distributionMin', 'ReferenceCoverageThresholds'),
  };
  return {
    schema_version: 1,
    updated_at: optionalString(obj, 'updated_at') ?? new Date().toISOString(),
    thresholds,
  };
}

export function parsePromptTemplate(input: unknown): PromptTemplate {
  const obj = asRecord(input, 'PromptTemplate');
  const status = assertEnum(PROMPT_TEMPLATE_STATUSES, obj.status, 'PromptTemplate.status');
  const template: PromptTemplate = {
    prompt_template_id: requireString(obj, 'prompt_template_id', 'PromptTemplate'),
    prompt_template_name: requireString(obj, 'prompt_template_name', 'PromptTemplate'),
    vehicle: assertEnum(VEHICLES, obj.vehicle, 'PromptTemplate.vehicle'),
    version: requireInteger(obj, 'version', 'PromptTemplate'),
    status,
    generator_kind: assertEnum(GENERATOR_KINDS, obj.generator_kind, 'PromptTemplate.generator_kind'),
    // Reserved/deferred vehicles may carry an empty task_prompt.
    task_prompt: status === 'reserved'
      ? (optionalString(obj, 'task_prompt') ?? '')
      : requireString(obj, 'task_prompt', 'PromptTemplate'),
    output_schema_ref: obj.output_schema_ref ?? null,
    member_system_prompt: optionalString(obj, 'member_system_prompt'),
    chairman_system_prompt: optionalString(obj, 'chairman_system_prompt'),
    last_updated_by: requireString(obj, 'last_updated_by', 'PromptTemplate'),
    last_updated_at: requireString(obj, 'last_updated_at', 'PromptTemplate'),
    change_note: optionalString(obj, 'change_note') ?? '',
  };
  // Carry the optional per-version model pin through only when present.
  const modelOverride = optionalString(obj, 'modelOverride');
  if (modelOverride !== undefined) template.modelOverride = modelOverride;
  const temperatureOverride = optionalNumber(obj, 'temperatureOverride');
  if (temperatureOverride !== undefined) template.temperatureOverride = temperatureOverride;
  const maxTokensOverride = optionalNumber(obj, 'maxTokensOverride');
  if (maxTokensOverride !== undefined) template.maxTokensOverride = maxTokensOverride;
  const reason = optionalString(obj, 'modelSelectionReason');
  if (reason !== undefined) template.modelSelectionReason = reason;
  if (template.version < 1) {
    throw new NodeEngineValidationError('PromptTemplate.version must be a positive integer');
  }
  return template;
}

/** Typed accessor for a ModalityGenerationConfig (own global document entry). */
export function parseModalityGenerationConfig(input: unknown): ModalityGenerationConfig {
  const obj = asRecord(input, 'ModalityGenerationConfig');
  const config: ModalityGenerationConfig = {
    id: requireString(obj, 'id', 'ModalityGenerationConfig'),
    vehicle: assertEnum(VEHICLES, obj.vehicle, 'ModalityGenerationConfig.vehicle'),
    generatorKind: assertEnum(GENERATOR_KINDS, obj.generatorKind, 'ModalityGenerationConfig.generatorKind'),
    mode: assertEnum(GENERATION_MODES, obj.mode, 'ModalityGenerationConfig.mode'),
    taskPrompt: optionalString(obj, 'taskPrompt') ?? '',
    enabled: requireBoolean(obj, 'enabled', 'ModalityGenerationConfig'),
  };
  const singleModel = optionalString(obj, 'singleModel');
  if (singleModel !== undefined) config.singleModel = singleModel;
  const councilModels = optionalStringArray(obj, 'councilModels');
  if (councilModels !== undefined) config.councilModels = councilModels;
  const chairmanModel = optionalString(obj, 'chairmanModel');
  if (chairmanModel !== undefined) config.chairmanModel = chairmanModel;
  const defaultTemperature = optionalNumber(obj, 'defaultTemperature');
  if (defaultTemperature !== undefined) config.defaultTemperature = defaultTemperature;
  const defaultMaxTokens = optionalNumber(obj, 'defaultMaxTokens');
  if (defaultMaxTokens !== undefined) config.defaultMaxTokens = defaultMaxTokens;
  const modelSelectionReason = optionalString(obj, 'modelSelectionReason');
  if (modelSelectionReason !== undefined) config.modelSelectionReason = modelSelectionReason;
  const productionTarget = optionalString(obj, 'productionTarget');
  if (productionTarget !== undefined) config.productionTarget = productionTarget;
  if (obj.videoSettings !== undefined && obj.videoSettings !== null) {
    config.videoSettings = parseVideoSettings(obj.videoSettings);
  }
  return config;
}

/**
 * Validate HeyGen v3 videoSettings. Every field is optional EXCEPT `provider`
 * (which must be "heygen"); bounded fields are enum-validated only when present.
 * Rejects style_id / brand_kit_id — those are deferred v2 Template-API concerns.
 */
export function parseVideoSettings(input: unknown): VideoSettings {
  const obj = asRecord(input, 'VideoSettings');
  if (obj.provider !== 'heygen') {
    throw new NodeEngineValidationError(
      `Invalid value for "VideoSettings.provider": ${JSON.stringify(obj.provider)}. Expected "heygen"`
    );
  }
  // `brand_kit_id` (HeyGen workspace template ID) remains a deferred v2 concern.
  // `style_id` + inline `brand_kit` ARE supported for the Video Agent path.
  if ('brand_kit_id' in obj) {
    throw new NodeEngineValidationError(
      'VideoSettings must not include brand_kit_id (deferred v2 Template-API concern); use inline brand_kit instead'
    );
  }
  const settings: VideoSettings = { provider: 'heygen' };

  const apiKeyRef = optionalString(obj, 'apiKeyRef');
  if (apiKeyRef !== undefined) settings.apiKeyRef = apiKeyRef;
  const avatarId = optionalString(obj, 'avatar_id');
  if (avatarId !== undefined) settings.avatar_id = avatarId;
  const voiceId = optionalString(obj, 'voice_id');
  if (voiceId !== undefined) settings.voice_id = voiceId;
  if (obj.engine !== undefined) {
    settings.engine = assertEnum(VIDEO_ENGINES, obj.engine, 'VideoSettings.engine');
  }
  if (obj.resolution !== undefined) {
    settings.resolution = assertEnum(VIDEO_RESOLUTIONS, obj.resolution, 'VideoSettings.resolution');
  }
  if (obj.aspect_ratio !== undefined) {
    settings.aspect_ratio = assertEnum(VIDEO_ASPECT_RATIOS, obj.aspect_ratio, 'VideoSettings.aspect_ratio');
  }
  if (obj.output_format !== undefined) {
    settings.output_format = assertEnum(VIDEO_OUTPUT_FORMATS, obj.output_format, 'VideoSettings.output_format');
  }
  if (obj.voice_settings !== undefined && obj.voice_settings !== null) {
    const vs = asRecord(obj.voice_settings, 'VideoSettings.voice_settings');
    const voiceSettings: VideoVoiceSettings = {};
    const speed = optionalNumber(vs, 'speed');
    if (speed !== undefined) voiceSettings.speed = speed;
    const pitch = optionalNumber(vs, 'pitch');
    if (pitch !== undefined) voiceSettings.pitch = pitch;
    const locale = optionalString(vs, 'locale');
    if (locale !== undefined) voiceSettings.locale = locale;
    settings.voice_settings = voiceSettings;
  }
  if (obj.background !== undefined && obj.background !== null) {
    settings.background = asRecord(obj.background, 'VideoSettings.background');
  }
  if (typeof obj.remove_background === 'boolean') {
    settings.remove_background = obj.remove_background;
  }
  const motionPrompt = optionalString(obj, 'motion_prompt');
  if (motionPrompt !== undefined) settings.motion_prompt = motionPrompt;
  const callbackUrl = optionalString(obj, 'callback_url');
  if (callbackUrl !== undefined) settings.callback_url = callbackUrl;
  if (obj.favorite_avatars !== undefined && obj.favorite_avatars !== null) {
    if (!Array.isArray(obj.favorite_avatars)) {
      throw new NodeEngineValidationError('VideoSettings.favorite_avatars must be an array');
    }
    settings.favorite_avatars = parseAvatarLibraryEntries(obj.favorite_avatars, 'VideoSettings.favorite_avatars');
  }
  if (obj.approved_avatars !== undefined && obj.approved_avatars !== null) {
    if (!Array.isArray(obj.approved_avatars)) {
      throw new NodeEngineValidationError('VideoSettings.approved_avatars must be an array');
    }
    settings.approved_avatars = parseAvatarLibraryEntries(obj.approved_avatars, 'VideoSettings.approved_avatars');
  } else if (settings.favorite_avatars?.length) {
    settings.approved_avatars = settings.favorite_avatars;
  }
  if (obj.avatar_rotation_pool !== undefined && obj.avatar_rotation_pool !== null) {
    if (!Array.isArray(obj.avatar_rotation_pool)) {
      throw new NodeEngineValidationError('VideoSettings.avatar_rotation_pool must be an array');
    }
    settings.avatar_rotation_pool = normalizeAvatarRotationPool(
      parseAvatarLibraryEntries(obj.avatar_rotation_pool, 'VideoSettings.avatar_rotation_pool')
    );
  }
  if (obj.video_render_style !== undefined) {
    settings.video_render_style = assertEnum(
      VIDEO_RENDER_STYLES,
      obj.video_render_style,
      'VideoSettings.video_render_style'
    );
  }
  if (obj.narration_fidelity !== undefined) {
    settings.narration_fidelity = assertEnum(
      NARRATION_FIDELITIES,
      obj.narration_fidelity,
      'VideoSettings.narration_fidelity'
    );
  }
  const styleId = optionalString(obj, 'style_id');
  if (styleId !== undefined) settings.style_id = styleId;
  if (obj.orientation !== undefined) {
    settings.orientation = assertEnum(
      VIDEO_ORIENTATIONS,
      obj.orientation,
      'VideoSettings.orientation'
    );
  }
  const targetDuration = optionalNumber(obj, 'target_duration_seconds');
  if (targetDuration !== undefined) settings.target_duration_seconds = targetDuration;
  if (obj.brand_kit !== undefined && obj.brand_kit !== null) {
    settings.brand_kit = parseVideoBrandKit(obj.brand_kit);
  }
  if (obj.agent_prompt_templates !== undefined && obj.agent_prompt_templates !== null) {
    const tpl = asRecord(obj.agent_prompt_templates, 'VideoSettings.agent_prompt_templates');
    const templates: VideoAgentPromptTemplates = {};
    const framing = optionalString(tpl, 'scriptFramingDirective');
    if (framing !== undefined) templates.scriptFramingDirective = framing;
    const styleBlock = optionalString(tpl, 'defaultStyleBlock');
    if (styleBlock !== undefined) templates.defaultStyleBlock = styleBlock;
    settings.agent_prompt_templates = templates;
  }

  return settings;
}

function parseVideoBrandKit(input: unknown): VideoBrandKit {
  const obj = asRecord(input, 'VideoSettings.brand_kit');
  const brandKit: VideoBrandKit = { enabled: obj.enabled === true };
  const primary = optionalString(obj, 'primaryColor');
  if (primary !== undefined) brandKit.primaryColor = primary;
  const secondary = optionalString(obj, 'secondaryColor');
  if (secondary !== undefined) brandKit.secondaryColor = secondary;
  const accent = optionalString(obj, 'accentColor');
  if (accent !== undefined) brandKit.accentColor = accent;
  const fontFamily = optionalString(obj, 'fontFamily');
  if (fontFamily !== undefined) brandKit.fontFamily = fontFamily;
  const mediaGuidance = optionalString(obj, 'mediaTypeGuidance');
  if (mediaGuidance !== undefined) brandKit.mediaTypeGuidance = mediaGuidance;
  return brandKit;
}

/** Rotation pool must be one character only — drop stray looks from other avatars. */
function normalizeAvatarRotationPool(entries: AvatarLibraryEntry[]): AvatarLibraryEntry[] {
  if (entries.length <= 1) return entries;
  const key = entries[0].group_id ?? entries[0].character_name ?? entries[0].id;
  const filtered = entries.filter(
    (entry) => (entry.group_id ?? entry.character_name ?? entry.id) === key
  );
  if (filtered.length !== entries.length) {
    throw new NodeEngineValidationError(
      'VideoSettings.avatar_rotation_pool must contain looks from a single avatar character only'
    );
  }
  return filtered;
}

function parseAvatarLibraryEntries(input: unknown[], context: string): AvatarLibraryEntry[] {
  return input.map((raw, index) => {
    const item = asRecord(raw, `${context}[${index}]`);
    const id = optionalString(item, 'id');
    const name = optionalString(item, 'name');
    if (!id || !name) {
      throw new NodeEngineValidationError(`${context}[${index}] requires non-empty "id" and "name"`);
    }
    const ref: AvatarLibraryEntry = { id, name };
    const preview = optionalString(item, 'preview_image_url');
    if (preview !== undefined) ref.preview_image_url = preview;
    const avatarType = optionalString(item, 'avatar_type');
    if (avatarType !== undefined) ref.avatar_type = avatarType;
    const defaultVoiceId = optionalString(item, 'default_voice_id');
    if (defaultVoiceId !== undefined) ref.default_voice_id = defaultVoiceId;
    if (Array.isArray(item.supported_api_engines)) {
      ref.supported_api_engines = (item.supported_api_engines as unknown[]).filter(
        (x): x is string => typeof x === 'string'
      );
    }
    const groupId = optionalString(item, 'group_id');
    if (groupId !== undefined) ref.group_id = groupId;
    const characterName = optionalString(item, 'character_name');
    if (characterName !== undefined) ref.character_name = characterName;
    return ref;
  });
}

// ===========================================================================
// Binding model-resolution helper (pure). Precedence (D-model-config):
//   (1) PromptTemplate version modelOverride (if defined)
//   (2) ModalityGenerationConfig.singleModel / council set (if defined)
//   (3) global/system default model  ← ALWAYS resolves
// ===========================================================================

export interface ResolveGenerationModelInput {
  /** The active immutable PromptTemplate version (its modelOverride wins, if set). */
  templateVersion?: Pick<
    PromptTemplate,
    'modelOverride' | 'temperatureOverride' | 'maxTokensOverride' | 'modelSelectionReason'
  > | null;
  /** The per-vehicle modality/model config (mode + models + tuning). */
  modalityConfig?: ModalityGenerationConfig | null;
  /** The global/system default model. Required — step (3) must always resolve. */
  globalDefaultModel: string;
}

export interface ResolvedGenerationModel {
  model: string;
  source: ModelSelectionSource;
  reason?: string;
  mode: GenerationMode;
  councilModels?: string[];
  chairmanModel?: string;
  temperature?: number;
  maxTokens?: number;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Resolve which model a generator should use for a vehicle. Pure function: no
 * I/O, callers pass the active template version, the modality config, and the
 * global default. Step (3) always resolves so callers never get an empty model.
 */
export function resolveGenerationModel(input: ResolveGenerationModelInput): ResolvedGenerationModel {
  const { templateVersion, modalityConfig, globalDefaultModel } = input;
  const mode: GenerationMode = modalityConfig?.mode ?? 'single';
  const councilModels =
    mode === 'council'
      ? (modalityConfig?.councilModels ?? []).filter(nonEmpty)
      : undefined;
  const chairmanCandidate =
    mode === 'council' && nonEmpty(modalityConfig?.chairmanModel) ? modalityConfig!.chairmanModel : undefined;
  const temperature = modalityConfig?.defaultTemperature;
  const maxTokens = modalityConfig?.defaultMaxTokens;

  // (1) Prompt-template version override — highest precedence.
  if (templateVersion && nonEmpty(templateVersion.modelOverride)) {
    return {
      model: templateVersion.modelOverride,
      source: 'prompt_template_override',
      reason: templateVersion.modelSelectionReason ?? modalityConfig?.modelSelectionReason,
      mode,
      councilModels: councilModels && councilModels.length > 0 ? councilModels : undefined,
      chairmanModel: mode === 'council' ? (chairmanCandidate ?? templateVersion.modelOverride) : undefined,
      temperature: templateVersion.temperatureOverride ?? temperature,
      maxTokens: templateVersion.maxTokensOverride ?? maxTokens,
    };
  }

  // (2) Modality config.
  if (modalityConfig) {
    if (mode === 'council' && councilModels && councilModels.length > 0) {
      return {
        model: chairmanCandidate ?? councilModels[0],
        source: 'modality_config',
        reason: modalityConfig.modelSelectionReason,
        mode,
        councilModels,
        chairmanModel: chairmanCandidate ?? globalDefaultModel,
        temperature,
        maxTokens,
      };
    }
    if (nonEmpty(modalityConfig.singleModel)) {
      return {
        model: modalityConfig.singleModel,
        source: 'modality_config',
        reason: modalityConfig.modelSelectionReason,
        mode: 'single',
        temperature,
        maxTokens,
      };
    }
  }

  // (3) Global/system default — always resolves.
  return {
    model: globalDefaultModel,
    source: 'global_default',
    mode,
    councilModels: councilModels && councilModels.length > 0 ? councilModels : undefined,
    chairmanModel: mode === 'council' ? (chairmanCandidate ?? globalDefaultModel) : undefined,
    temperature,
    maxTokens,
  };
}

// ===========================================================================
// M10 — Text learning object payload (§8.8 / text_generation_prompt)
// ===========================================================================

export const TEXT_SEGMENT_TYPES = [
  'heading',
  'subheading',
  'body',
  'key_term',
  'definition',
  'example',
  'non_example',
  'list',
  'step',
  'annotation',
  'note',
  'callout',
  'quotation',
  'table',
  'formula',
  'summary',
] as const;
export type TextSegmentType = (typeof TEXT_SEGMENT_TYPES)[number];

export interface TextSegment {
  type: TextSegmentType;
  text: string;
  citation?: Citation;
  items?: string[];
  columns?: string[];
  rows?: string[][];
}

export interface TextFidelityCheck {
  status: 'passed' | 'needs_review';
  notes: string[];
}

/** Persisted M10 artifact wrapping the §8.6 envelope + production audit. */
export interface ProducedObjectRecord {
  object_id: string;
  content_spec_id: string;
  node_id: string;
  subtopic_id: string;
  course_id: string;
  /** Blueprint vehicle hint — production may render as text equivalent (Phase A). */
  blueprint_suggested_vehicle: Vehicle;
  produced_modality: ProducedModality;
  envelope: GeneratedObjectEnvelope;
  prompt_template_id: string;
  prompt_version: number;
  generation_mode: GenerationMode;
  produced_at: string;
}

function parseCitationField(value: unknown, context: string): Citation | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    return { citation: value, passage_ref: '' };
  }
  const cit = asRecord(value, context);
  return {
    citation: typeof cit.citation === 'string' ? cit.citation : '',
    passage_ref: typeof cit.passage_ref === 'string' ? cit.passage_ref : '',
  };
}

function parseTextSegment(input: unknown, context: string): TextSegment {
  const obj = asRecord(input, context);
  const segment: TextSegment = {
    type: assertEnum(TEXT_SEGMENT_TYPES, obj.type, `${context}.type`),
    text: optionalString(obj, 'text') ?? '',
  };
  const citation = parseCitationField(obj.citation, `${context}.citation`);
  if (citation) segment.citation = citation;
  if (Array.isArray(obj.items)) {
    segment.items = obj.items.filter((x): x is string => typeof x === 'string');
  }
  if (Array.isArray(obj.columns)) {
    segment.columns = obj.columns.filter((x): x is string => typeof x === 'string');
  }
  if (Array.isArray(obj.rows)) {
    segment.rows = obj.rows
      .filter((row) => Array.isArray(row))
      .map((row) => (row as unknown[]).filter((x): x is string => typeof x === 'string'));
  }
  return segment;
}

export function parseTextSegments(value: unknown, context = 'TextSegment[]'): TextSegment[] {
  if (!Array.isArray(value)) {
    throw new NodeEngineValidationError(`Expected TextSegment[] in ${context}`);
  }
  return value.map((entry, i) => parseTextSegment(entry, `${context}[${i}]`));
}

export function parseProducedObjectRecord(input: unknown): ProducedObjectRecord {
  const obj = asRecord(input, 'ProducedObjectRecord');
  return {
    object_id: requireString(obj, 'object_id', 'ProducedObjectRecord'),
    content_spec_id: requireString(obj, 'content_spec_id', 'ProducedObjectRecord'),
    node_id: requireString(obj, 'node_id', 'ProducedObjectRecord'),
    subtopic_id: requireString(obj, 'subtopic_id', 'ProducedObjectRecord'),
    course_id: requireString(obj, 'course_id', 'ProducedObjectRecord'),
    blueprint_suggested_vehicle: assertEnum(
      VEHICLES,
      obj.blueprint_suggested_vehicle,
      'ProducedObjectRecord.blueprint_suggested_vehicle'
    ),
    produced_modality: assertEnum(
      PRODUCED_MODALITIES,
      obj.produced_modality,
      'ProducedObjectRecord.produced_modality'
    ),
    envelope: parseGeneratedObjectEnvelope(obj.envelope),
    prompt_template_id: requireString(obj, 'prompt_template_id', 'ProducedObjectRecord'),
    prompt_version:
      typeof obj.prompt_version === 'number' && Number.isFinite(obj.prompt_version)
        ? obj.prompt_version
        : 1,
    generation_mode: assertEnum(GENERATION_MODES, obj.generation_mode, 'ProducedObjectRecord.generation_mode'),
    produced_at: optionalString(obj, 'produced_at') ?? new Date(0).toISOString(),
  };
}

// ===========================================================================
// M1 — Common metadata envelope (§8.6)
// ===========================================================================

export interface Accessibility {
  alt_text: string | null;
  text_equivalent_ref: string | null;
}

export interface GeneratedObjectEnvelope {
  object_id: string;
  object_family: ObjectFamily;
  parent_node_id: string | null;
  parent_milestone_pack_id: string | null;
  kc_ids: string[];
  node_object_purpose: NodeObjectPurpose | null;
  milestone_support_purpose: MilestoneSupportPurpose | null;
  produced_modality: ProducedModality;
  content_pattern: ContentPattern;
  addresses_misconceptions: string[];
  grounding_references: Citation[];
  grounding_strength: GroundingStrength;
  estimated_effort_minutes: number;
  accessibility: Accessibility;
  /** Object version + the live pointer used for reassembly (§8.6). */
  version: string;
  is_live_version: boolean;
  governance_status: GovernanceStatus;
  asset_ref: string;
  modality_specific: Record<string, unknown>;
  // --- Official Evidence Check extension (set only on ec_node_<id>_primary) ---
  is_primary_evidence_check?: boolean;
  updates_learner_model?: boolean;
  feeds_routing?: boolean;
  can_feed_milestone_readiness_gate?: boolean;
  lms_tracking_key?: string;
  // --- Model-selection audit (optional; populated at generation time in M7+) ---
  model_used?: string;
  model_selection_source?: ModelSelectionSource;
  model_selection_reason?: string;
  council_models_used?: string[];
  chairman_model_used?: string;
}

/** A node learning object is just an envelope whose family is node. */
export type NodeLearningObject = GeneratedObjectEnvelope & {
  object_family: 'node_learning_object';
};

/** A milestone support object is an envelope whose family is milestone. */
export type MilestoneSupportObject = GeneratedObjectEnvelope & {
  object_family: 'milestone_support_object';
};

function parseCitations(value: unknown, context: string): Citation[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new NodeEngineValidationError(`Expected Citation[] in ${context}`);
  }
  return value.map((entry, i) => {
    const obj = asRecord(entry, `${context}.grounding_references[${i}]`);
    return {
      citation: typeof obj.citation === 'string' ? obj.citation : '',
      passage_ref: typeof obj.passage_ref === 'string' ? obj.passage_ref : '',
    };
  });
}

export function parseGeneratedObjectEnvelope(input: unknown): GeneratedObjectEnvelope {
  const obj = asRecord(input, 'GeneratedObjectEnvelope');
  const accessibilityRaw = asRecord(obj.accessibility ?? {}, 'GeneratedObjectEnvelope.accessibility');

  const envelope: GeneratedObjectEnvelope = {
    object_id: requireString(obj, 'object_id', 'GeneratedObjectEnvelope'),
    object_family: assertEnum(OBJECT_FAMILIES, obj.object_family, 'GeneratedObjectEnvelope.object_family'),
    parent_node_id: typeof obj.parent_node_id === 'string' ? obj.parent_node_id : null,
    parent_milestone_pack_id:
      typeof obj.parent_milestone_pack_id === 'string' ? obj.parent_milestone_pack_id : null,
    kc_ids: requireStringArray(obj, 'kc_ids', 'GeneratedObjectEnvelope'),
    node_object_purpose:
      obj.node_object_purpose == null
        ? null
        : assertEnum(NODE_OBJECT_PURPOSES, obj.node_object_purpose, 'GeneratedObjectEnvelope.node_object_purpose'),
    milestone_support_purpose:
      obj.milestone_support_purpose == null
        ? null
        : assertEnum(
            MILESTONE_SUPPORT_PURPOSES,
            obj.milestone_support_purpose,
            'GeneratedObjectEnvelope.milestone_support_purpose'
          ),
    produced_modality: assertEnum(PRODUCED_MODALITIES, obj.produced_modality, 'GeneratedObjectEnvelope.produced_modality'),
    content_pattern: assertEnum(CONTENT_PATTERNS, obj.content_pattern, 'GeneratedObjectEnvelope.content_pattern'),
    addresses_misconceptions: Array.isArray(obj.addresses_misconceptions)
      ? (obj.addresses_misconceptions.filter((x) => typeof x === 'string') as string[])
      : [],
    grounding_references: parseCitations(obj.grounding_references, 'GeneratedObjectEnvelope'),
    grounding_strength: assertEnum(GROUNDING_STRENGTHS, obj.grounding_strength, 'GeneratedObjectEnvelope.grounding_strength'),
    estimated_effort_minutes:
      typeof obj.estimated_effort_minutes === 'number' ? obj.estimated_effort_minutes : 0,
    accessibility: {
      alt_text: typeof accessibilityRaw.alt_text === 'string' ? accessibilityRaw.alt_text : null,
      text_equivalent_ref:
        typeof accessibilityRaw.text_equivalent_ref === 'string' ? accessibilityRaw.text_equivalent_ref : null,
    },
    version: requireString(obj, 'version', 'GeneratedObjectEnvelope'),
    is_live_version: requireBoolean(obj, 'is_live_version', 'GeneratedObjectEnvelope'),
    governance_status: assertEnum(GOVERNANCE_STATUSES, obj.governance_status, 'GeneratedObjectEnvelope.governance_status'),
    asset_ref: requireString(obj, 'asset_ref', 'GeneratedObjectEnvelope'),
    modality_specific:
      typeof obj.modality_specific === 'object' && obj.modality_specific !== null
        ? (obj.modality_specific as Record<string, unknown>)
        : {},
  };

  if (typeof obj.is_primary_evidence_check === 'boolean') {
    envelope.is_primary_evidence_check = obj.is_primary_evidence_check;
  }
  if (typeof obj.updates_learner_model === 'boolean') {
    envelope.updates_learner_model = obj.updates_learner_model;
  }
  if (typeof obj.feeds_routing === 'boolean') envelope.feeds_routing = obj.feeds_routing;
  if (typeof obj.can_feed_milestone_readiness_gate === 'boolean') {
    envelope.can_feed_milestone_readiness_gate = obj.can_feed_milestone_readiness_gate;
  }
  if (typeof obj.lms_tracking_key === 'string') envelope.lms_tracking_key = obj.lms_tracking_key;

  // Model-selection audit (optional — only validate when present).
  if (typeof obj.model_used === 'string') envelope.model_used = obj.model_used;
  if (obj.model_selection_source != null) {
    envelope.model_selection_source = assertEnum(
      MODEL_SELECTION_SOURCES,
      obj.model_selection_source,
      'GeneratedObjectEnvelope.model_selection_source'
    );
  }
  if (typeof obj.model_selection_reason === 'string') {
    envelope.model_selection_reason = obj.model_selection_reason;
  }
  if (Array.isArray(obj.council_models_used)) {
    envelope.council_models_used = obj.council_models_used.filter((x): x is string => typeof x === 'string');
  }
  if (typeof obj.chairman_model_used === 'string') {
    envelope.chairman_model_used = obj.chairman_model_used;
  }

  return envelope;
}

// ===========================================================================
// M11 — Step 9 ValidationResult (§9.16)
// ===========================================================================

export interface ValidationCheck {
  tier: number | string;
  status: CheckStatus;
  findings: string[];
}

export type ValidationChecks = Record<ValidationCheckName, ValidationCheck>;

export interface ValidationAuditRefs {
  content_spec_id: string;
  prompt_template_id: string;
  prompt_version: string;
  generation_mode: GenerationMode;
  generated_object_version: string;
  validation_version: string;
}

export interface ValidationResult {
  validation_id: string;
  validated_object_id: string;
  object_version: string;
  validation_timestamp: string;
  validation_status: ValidationStatus;
  governance_decision: GovernanceDecision;
  review_priority: ReviewPriority;
  checks: ValidationChecks;
  risk_flags: RiskFlag[];
  required_actions: string[];
  can_publish: boolean;
  can_route_to_learner: boolean;
  can_write_to_learner_model: boolean;
  sme_review_required: boolean;
  admin_review_required: boolean;
  developer_review_required: boolean;
  qa_review_required: boolean;
  audit_refs: ValidationAuditRefs;
}

export function parseValidationResult(input: unknown): ValidationResult {
  const obj = asRecord(input, 'ValidationResult');
  const checksRaw = asRecord(obj.checks ?? {}, 'ValidationResult.checks');

  const checks = {} as ValidationChecks;
  for (const name of VALIDATION_CHECK_NAMES) {
    const entry = asRecord(checksRaw[name] ?? {}, `ValidationResult.checks.${name}`);
    checks[name] = {
      tier: typeof entry.tier === 'number' || typeof entry.tier === 'string' ? entry.tier : 1,
      status: assertEnum(CHECK_STATUSES, entry.status, `ValidationResult.checks.${name}.status`),
      findings: Array.isArray(entry.findings)
        ? (entry.findings.filter((x) => typeof x === 'string') as string[])
        : [],
    };
  }

  const riskFlags = Array.isArray(obj.risk_flags)
    ? (obj.risk_flags.filter((x): x is RiskFlag => isEnumMember(RISK_FLAGS, x)))
    : [];

  const auditRaw = asRecord(obj.audit_refs ?? {}, 'ValidationResult.audit_refs');

  return {
    validation_id: requireString(obj, 'validation_id', 'ValidationResult'),
    validated_object_id: requireString(obj, 'validated_object_id', 'ValidationResult'),
    object_version: requireString(obj, 'object_version', 'ValidationResult'),
    validation_timestamp: requireString(obj, 'validation_timestamp', 'ValidationResult'),
    validation_status: assertEnum(VALIDATION_STATUSES, obj.validation_status, 'ValidationResult.validation_status'),
    governance_decision: assertEnum(GOVERNANCE_DECISIONS, obj.governance_decision, 'ValidationResult.governance_decision'),
    review_priority: assertEnum(REVIEW_PRIORITIES, obj.review_priority, 'ValidationResult.review_priority'),
    checks,
    risk_flags: riskFlags,
    required_actions: Array.isArray(obj.required_actions)
      ? (obj.required_actions.filter((x) => typeof x === 'string') as string[])
      : [],
    can_publish: requireBoolean(obj, 'can_publish', 'ValidationResult'),
    can_route_to_learner: requireBoolean(obj, 'can_route_to_learner', 'ValidationResult'),
    can_write_to_learner_model: requireBoolean(obj, 'can_write_to_learner_model', 'ValidationResult'),
    sme_review_required: requireBoolean(obj, 'sme_review_required', 'ValidationResult'),
    admin_review_required: requireBoolean(obj, 'admin_review_required', 'ValidationResult'),
    developer_review_required: requireBoolean(obj, 'developer_review_required', 'ValidationResult'),
    qa_review_required: requireBoolean(obj, 'qa_review_required', 'ValidationResult'),
    audit_refs: {
      content_spec_id: typeof auditRaw.content_spec_id === 'string' ? auditRaw.content_spec_id : '',
      prompt_template_id: typeof auditRaw.prompt_template_id === 'string' ? auditRaw.prompt_template_id : '',
      prompt_version: typeof auditRaw.prompt_version === 'string' ? auditRaw.prompt_version : '',
      generation_mode: isEnumMember(GENERATION_MODES, auditRaw.generation_mode)
        ? auditRaw.generation_mode
        : 'single',
      generated_object_version:
        typeof auditRaw.generated_object_version === 'string' ? auditRaw.generated_object_version : '',
      validation_version: typeof auditRaw.validation_version === 'string' ? auditRaw.validation_version : '',
    },
  };
}

// ===========================================================================
// M7 — Step 1 node object (Build Spec §1.3 clusters A + B) + node-set.
//
// Reconciled with the M7 Build Contract + its three clarifications:
//  (1) primary_evidence_check_requirement.preferred_evidence_mode uses the
//      response-mode union (PreferredEvidenceMode), NOT a modality.
//  (2) misconceptions are PROPOSED by M7 (candidate_misconceptions) with
//      misconception_slots = "pending" unless an approved registry binding
//      already exists (misconception_bindings + misconception_slots="populated").
//  (3) M7 produces NODE objects (knowledge_component, mastery_statement,
//      why_it_matters, assessment_connection, first-pass evidence_map, and the
//      mandatory primary_evidence_check_requirement). Full Level-2 content
//      (required_explanation, examples, preservation_rules, ...) is M9, not M7;
//      `core_academic_message`/`node_learning_intent` stays a brief draft only.
// ===========================================================================

/** Mandatory authoring-time primary Evidence Check requirement (every node).
 * Its stable id is born here as `ec_node_<node_id>_primary`. This is the
 * authoring requirement, NOT the learner-facing Evidence Check (Step 4 finalizes
 * it diagnostically; Step 8/M10 produces the object). The contract names the id
 * field `evidence_check_object_id`; the repo's canonical field is
 * `evidence_check_id` — they are the same value. */
export interface PrimaryEvidenceCheckRequirement {
  evidence_check_id: string;
  must_capture_signals: CaptureSignal[];
  /** Clarification 1: response-mode, never a delivery vehicle/modality. */
  preferred_evidence_mode: PreferredEvidenceMode;
  diagnostic_bands: DiagnosticBand[];
}

/** An APPROVED misconception binding referenced from the governed registry. Only
 * usable when an approved registry entry already exists (Clarification 2). */
export interface MisconceptionBinding {
  misconception_id: string;
  statement: string;
  severity: MisconceptionSeverity;
  trap: string;
  expected_error_pattern: string;
  confirming_probe: string;
  blocks_submission_if_state: SubmissionBlockState;
  clearance_rule: string;
}

/** Alias used at the M7 boundary to make the "approved" requirement explicit. */
export type ApprovedMisconceptionBinding = MisconceptionBinding;

/** A misconception PROPOSED by M7 (Clarification 2). It is NOT a binding: Step 3
 * approves/populates the governed library and the node's final bindings. Carries
 * just enough for SME visibility (statement + reason), plus optional hints. */
export interface CandidateMisconception {
  /** A proposed, NOT-yet-approved id (Step 3 may rename/merge). */
  candidate_misconception_id: string;
  statement: string;
  reason: string;
  severity?: MisconceptionSeverity;
  suggested_trap?: string;
}

/** A first-pass `evidence_map` criterion described at the four SOLO depth bands
 * (§1.3). Drafted in M7; refined at Step 4 (Evidence Check). */
export interface EvidenceMapCriterion {
  criterion_id: string;
  criterion_name: string;
  solo_descriptors: Record<SoloBand, string>;
  critical: boolean;
}

/** A node's cross-CLO link (the bridge target / preserved grounding). */
export interface NodeCrossCloLink {
  clo_id: string;
  reason: string;
}

export interface Node {
  // --- Identity & placement ---
  node_id: string;
  parent_subtopic_id: string;
  parent_clo_id?: string;
  /** All inherited CLO ids (the subtopic's clo_ids). */
  clo_ids: string[];
  course_id?: string;
  node_type: NodeType;
  node_title: string;
  /** Position in the within-subtopic prerequisite chain. */
  order: number;
  cognitive_level?: string;
  prepares_for_assessment_id?: string | null;
  is_core: boolean;
  // --- Diagnostic core (Cluster A + first-pass Cluster B) ---
  knowledge_component: string;
  kc_ids: string[];
  mastery_statement: string;
  why_it_matters: string;
  /** Which summative artifact this node prepares for (free text, §1.3). */
  assessment_connection: string;
  /** Brief DRAFT-only node-level message (Clarification 3). NOT the M9 content. */
  core_academic_message: string;
  /** Optional alias/rename of the brief draft message (Clarification 3). */
  node_learning_intent?: string;
  evidence_map: EvidenceMapCriterion[];
  captured_signals: CaptureSignal[];
  // --- Prerequisite graph (within + across subtopics) ---
  prerequisite_node_ids: string[];
  dependent_node_ids: string[];
  cross_clo_links: NodeCrossCloLink[];
  // --- Mandatory primary Evidence Check requirement (every node) ---
  primary_evidence_check_requirement: PrimaryEvidenceCheckRequirement;
  // --- Misconceptions (Clarification 2) ---
  misconception_slots: MisconceptionSlotState;
  candidate_misconceptions: CandidateMisconception[];
  misconception_bindings: MisconceptionBinding[];
  // --- Governance & grounding ---
  grounding_references: Citation[];
  grounding_strength?: GroundingStrength;
  risk_classification: RiskClassification[];
  generator_divergence_note?: string;
  grain_justification?: string;
  // --- Review-by-exception triage (Issue 1) ---
  /** Whether the SME must review this node (must_review) or may skip it
   * (can_proceed). Defaults to `can_proceed` when parsing older artifacts. */
  review_priority: NodeReviewPriority;
  /** Human-readable reasons a node landed in `must_review` (empty for can_proceed). */
  review_reasons: string[];
  /** True when an SME has manually edited prose fields (blocks silent regenerate). */
  sme_edited?: boolean;
  sme_edited_at?: string;
  status: NodeEngineStatus;
}

const DEFAULT_CAPTURED_SIGNALS: CaptureSignal[] = ['response', 'reasoning', 'confidence'];

function parseEvidenceMap(value: unknown, context: string): EvidenceMapCriterion[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, i) => {
    const c = asRecord(entry, `${context}.evidence_map[${i}]`);
    const soloRaw = asRecord(c.solo_descriptors ?? {}, `${context}.evidence_map[${i}].solo_descriptors`);
    const solo_descriptors = {} as Record<SoloBand, string>;
    for (const band of SOLO_BANDS) {
      solo_descriptors[band] = typeof soloRaw[band] === 'string' ? (soloRaw[band] as string) : '';
    }
    return {
      criterion_id: optionalString(c, 'criterion_id') ?? `crit_${i + 1}`,
      criterion_name: optionalString(c, 'criterion_name') ?? '',
      solo_descriptors,
      critical: typeof c.critical === 'boolean' ? c.critical : false,
    };
  });
}

function parseCandidateMisconceptions(value: unknown, context: string): CandidateMisconception[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, i) => {
    const m = asRecord(entry, `${context}.candidate_misconceptions[${i}]`);
    const candidate: CandidateMisconception = {
      candidate_misconception_id:
        optionalString(m, 'candidate_misconception_id') ?? optionalString(m, 'misconception_id') ?? `candidate_${i + 1}`,
      statement: optionalString(m, 'statement') ?? '',
      reason: optionalString(m, 'reason') ?? '',
    };
    if (isEnumMember(MISCONCEPTION_SEVERITIES, m.severity)) candidate.severity = m.severity;
    const suggestedTrap = optionalString(m, 'suggested_trap');
    if (suggestedTrap !== undefined) candidate.suggested_trap = suggestedTrap;
    return candidate;
  });
}

function parseMisconceptionBindings(value: unknown, context: string): MisconceptionBinding[] {
  if (!Array.isArray(value)) return [];
  return value.map((b, i) => {
    const mb = asRecord(b, `${context}.misconception_bindings[${i}]`);
    return {
      misconception_id: requireString(mb, 'misconception_id', `${context}.misconception_bindings[${i}]`),
      statement: optionalString(mb, 'statement') ?? '',
      severity: assertEnum(MISCONCEPTION_SEVERITIES, mb.severity, `${context}.misconception_bindings[${i}].severity`),
      trap: optionalString(mb, 'trap') ?? '',
      expected_error_pattern: optionalString(mb, 'expected_error_pattern') ?? '',
      confirming_probe: optionalString(mb, 'confirming_probe') ?? '',
      blocks_submission_if_state: assertEnum(
        SUBMISSION_BLOCK_STATES,
        mb.blocks_submission_if_state,
        `${context}.misconception_bindings[${i}].blocks_submission_if_state`
      ),
      clearance_rule: optionalString(mb, 'clearance_rule') ?? '',
    };
  });
}

function parseNodeCrossCloLinks(value: unknown): NodeCrossCloLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null))
    .filter((entry): entry is Record<string, unknown> => entry !== null)
    .map((link) => ({
      // Accept either {clo_id} (node form) or {linked_clo_id} (subtopic form).
      clo_id: optionalString(link, 'clo_id') ?? optionalString(link, 'linked_clo_id') ?? '',
      reason: optionalString(link, 'reason') ?? '',
    }))
    .filter((link) => link.clo_id.length > 0);
}

export function parseNode(input: unknown): Node {
  const obj = asRecord(input, 'Node');
  const ecRaw = asRecord(obj.primary_evidence_check_requirement ?? {}, 'Node.primary_evidence_check_requirement');

  const mustCapture = Array.isArray(ecRaw.must_capture_signals)
    ? ecRaw.must_capture_signals.map((s, i) =>
        assertEnum(CAPTURE_SIGNALS, s, `Node.primary_evidence_check_requirement.must_capture_signals[${i}]`)
      )
    : [...DEFAULT_CAPTURED_SIGNALS];
  const bands = Array.isArray(ecRaw.diagnostic_bands)
    ? ecRaw.diagnostic_bands.map((b, i) =>
        assertEnum(DIAGNOSTIC_BANDS, b, `Node.primary_evidence_check_requirement.diagnostic_bands[${i}]`)
      )
    : [...DIAGNOSTIC_BANDS];

  const bindings = parseMisconceptionBindings(obj.misconception_bindings, 'Node');
  const candidates = parseCandidateMisconceptions(obj.candidate_misconceptions, 'Node');
  // Default the slot state from the data: populated only when an approved binding
  // is present; otherwise pending (Clarification 2).
  const misconceptionSlots: MisconceptionSlotState = isEnumMember(MISCONCEPTION_SLOT_STATES, obj.misconception_slots)
    ? obj.misconception_slots
    : bindings.length > 0
      ? 'populated'
      : 'pending';

  const capturedSignals = Array.isArray(obj.captured_signals)
    ? obj.captured_signals.map((s, i) => assertEnum(CAPTURE_SIGNALS, s, `Node.captured_signals[${i}]`))
    : [...DEFAULT_CAPTURED_SIGNALS];

  const riskClassification = Array.isArray(obj.risk_classification)
    ? obj.risk_classification
        .filter((r): r is RiskClassification => isEnumMember(RISK_CLASSIFICATIONS, r))
    : [];

  const node: Node = {
    node_id: requireString(obj, 'node_id', 'Node'),
    parent_subtopic_id: requireString(obj, 'parent_subtopic_id', 'Node'),
    clo_ids: optionalStringArray(obj, 'clo_ids') ?? [],
    node_type: assertEnum(NODE_TYPES, obj.node_type, 'Node.node_type'),
    node_title: requireString(obj, 'node_title', 'Node'),
    order: typeof obj.order === 'number' && Number.isFinite(obj.order) ? obj.order : 0,
    is_core: typeof obj.is_core === 'boolean' ? obj.is_core : false,
    knowledge_component: requireString(obj, 'knowledge_component', 'Node'),
    kc_ids: requireStringArray(obj, 'kc_ids', 'Node'),
    mastery_statement: optionalString(obj, 'mastery_statement') ?? '',
    why_it_matters: optionalString(obj, 'why_it_matters') ?? '',
    assessment_connection: optionalString(obj, 'assessment_connection') ?? '',
    core_academic_message: requireString(obj, 'core_academic_message', 'Node'),
    evidence_map: parseEvidenceMap(obj.evidence_map, 'Node'),
    captured_signals: capturedSignals.length > 0 ? capturedSignals : [...DEFAULT_CAPTURED_SIGNALS],
    prerequisite_node_ids: optionalStringArray(obj, 'prerequisite_node_ids') ?? [],
    dependent_node_ids: optionalStringArray(obj, 'dependent_node_ids') ?? [],
    cross_clo_links: parseNodeCrossCloLinks(obj.cross_clo_links),
    prepares_for_assessment_id:
      typeof obj.prepares_for_assessment_id === 'string' ? obj.prepares_for_assessment_id : null,
    primary_evidence_check_requirement: {
      evidence_check_id: requireString(ecRaw, 'evidence_check_id', 'Node.primary_evidence_check_requirement'),
      must_capture_signals: mustCapture.length > 0 ? mustCapture : [...DEFAULT_CAPTURED_SIGNALS],
      preferred_evidence_mode: assertEnum(
        PREFERRED_EVIDENCE_MODES,
        ecRaw.preferred_evidence_mode,
        'Node.primary_evidence_check_requirement.preferred_evidence_mode'
      ),
      diagnostic_bands: bands.length > 0 ? bands : [...DIAGNOSTIC_BANDS],
    },
    misconception_slots: misconceptionSlots,
    candidate_misconceptions: candidates,
    misconception_bindings: bindings,
    grounding_references: parseCitations(obj.grounding_references, 'Node'),
    risk_classification: riskClassification,
    // Default to can_proceed/[] for backward compat with artifacts written before
    // review-by-exception triage existed (Issue 1).
    review_priority: isEnumMember(NODE_REVIEW_PRIORITIES, obj.review_priority)
      ? obj.review_priority
      : 'can_proceed',
    review_reasons: optionalStringArray(obj, 'review_reasons') ?? [],
    status: assertEnum(NODE_ENGINE_STATUSES, obj.status, 'Node.status'),
  };

  const parentCloId = optionalString(obj, 'parent_clo_id');
  if (parentCloId !== undefined) node.parent_clo_id = parentCloId;
  const courseId = optionalString(obj, 'course_id');
  if (courseId !== undefined) node.course_id = courseId;
  const cognitive = optionalString(obj, 'cognitive_level');
  if (cognitive !== undefined) node.cognitive_level = cognitive;
  const learningIntent = optionalString(obj, 'node_learning_intent');
  if (learningIntent !== undefined) node.node_learning_intent = learningIntent;
  if (isEnumMember(GROUNDING_STRENGTHS, obj.grounding_strength)) {
    node.grounding_strength = obj.grounding_strength;
  }
  const divergence = optionalString(obj, 'generator_divergence_note');
  if (divergence !== undefined) node.generator_divergence_note = divergence;
  const grain = optionalString(obj, 'grain_justification');
  if (grain !== undefined) node.grain_justification = grain;
  if (typeof obj.sme_edited === 'boolean') node.sme_edited = obj.sme_edited;
  const smeEditedAt = optionalString(obj, 'sme_edited_at');
  if (smeEditedAt !== undefined) node.sme_edited_at = smeEditedAt;

  return node;
}

/** Retrieval transparency summary for a node-set (Workstream 4). Makes the
 * grounding situation visible and auditable so empty grounding can never again
 * silently masquerade as "weak grounding". */
export interface NodeSetGroundingSummary {
  /** Whether retrieval was attempted at all (vs grounding turned off). */
  retrieval_called: boolean;
  /** Hits returned by CLO/subtopic-scoped queries (summed across nodes + prompt). */
  scoped_chunk_count: number;
  /** Hits returned by the unscoped course-level fallback. */
  course_level_chunk_count: number;
  /** Distinct citations attached across the set. */
  citations_count: number;
  /** Dominant source of the grounding actually used. */
  grounding_source: GroundingSourceKind;
  /** Human-readable explanation shown in the Node Set Report. */
  grounding_note: string;
  /** True only when real reference passages back the set (>=1 citation, not model_only). */
  academic_ready: boolean;
}

/** A governed M7 node-set: 4-7 nodes generated from ONE approved V1 Subtopic.
 * Every node enters at `status: draft`; a human approval step (Level 0-1) moves
 * the set to `approved` before downstream (M8) use — no auto-proceed. */
export interface NodeSet {
  node_set_id: string;
  course_id: string;
  subtopic_id: string;
  clo_ids: string[];
  /** Frozen assessment ids this subtopic's nodes prepare for (if any). */
  prepares_for_assessment_ids: string[];
  nodes: Node[];
  /** Required when the node count is adjusted outside the 4-7 grain band. */
  grain_justification?: string;
  generator_divergence_notes: string[];
  status: NodeEngineStatus;
  /** Retrieval transparency (Workstream 4). */
  grounding_summary?: NodeSetGroundingSummary;
  // Model-selection audit (binding resolution order, §model-config).
  model_used?: string;
  model_selection_source?: ModelSelectionSource;
  model_selection_reason?: string;
  generation_mode?: GenerationMode;
  prompt_template_id?: string;
  prompt_version?: number;
  created_at: string;
  updated_at: string;
  approved_by?: string;
  approved_at?: string;
  /** Recorded when an SME approves a set WITHOUT reference grounding (override). */
  academic_override_reason?: string;
  academic_override_by?: string;
}

function parseGroundingSummary(value: unknown): NodeSetGroundingSummary | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const g = value as Record<string, unknown>;
  const source: GroundingSourceKind = isEnumMember(GROUNDING_SOURCES, g.grounding_source)
    ? g.grounding_source
    : 'model_only';
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    retrieval_called: g.retrieval_called === true,
    scoped_chunk_count: num(g.scoped_chunk_count),
    course_level_chunk_count: num(g.course_level_chunk_count),
    citations_count: num(g.citations_count),
    grounding_source: source,
    grounding_note: typeof g.grounding_note === 'string' ? g.grounding_note : '',
    academic_ready: g.academic_ready === true,
  };
}

export function parseNodeSet(input: unknown): NodeSet {
  const obj = asRecord(input, 'NodeSet');
  const nodes = Array.isArray(obj.nodes) ? obj.nodes.map((n) => parseNode(n)) : [];

  const nodeSet: NodeSet = {
    node_set_id: requireString(obj, 'node_set_id', 'NodeSet'),
    course_id: requireString(obj, 'course_id', 'NodeSet'),
    subtopic_id: requireString(obj, 'subtopic_id', 'NodeSet'),
    clo_ids: optionalStringArray(obj, 'clo_ids') ?? [],
    prepares_for_assessment_ids: optionalStringArray(obj, 'prepares_for_assessment_ids') ?? [],
    nodes,
    generator_divergence_notes: optionalStringArray(obj, 'generator_divergence_notes') ?? [],
    status: assertEnum(NODE_ENGINE_STATUSES, obj.status, 'NodeSet.status'),
    created_at: optionalString(obj, 'created_at') ?? new Date(0).toISOString(),
    updated_at: optionalString(obj, 'updated_at') ?? new Date(0).toISOString(),
  };

  const grain = optionalString(obj, 'grain_justification');
  if (grain !== undefined) nodeSet.grain_justification = grain;
  const modelUsed = optionalString(obj, 'model_used');
  if (modelUsed !== undefined) nodeSet.model_used = modelUsed;
  if (isEnumMember(MODEL_SELECTION_SOURCES, obj.model_selection_source)) {
    nodeSet.model_selection_source = obj.model_selection_source;
  }
  const modelReason = optionalString(obj, 'model_selection_reason');
  if (modelReason !== undefined) nodeSet.model_selection_reason = modelReason;
  if (isEnumMember(GENERATION_MODES, obj.generation_mode)) nodeSet.generation_mode = obj.generation_mode;
  const promptId = optionalString(obj, 'prompt_template_id');
  if (promptId !== undefined) nodeSet.prompt_template_id = promptId;
  const promptVersion = optionalNumber(obj, 'prompt_version');
  if (promptVersion !== undefined) nodeSet.prompt_version = promptVersion;
  const approvedBy = optionalString(obj, 'approved_by');
  if (approvedBy !== undefined) nodeSet.approved_by = approvedBy;
  const approvedAt = optionalString(obj, 'approved_at');
  if (approvedAt !== undefined) nodeSet.approved_at = approvedAt;
  const groundingSummary = parseGroundingSummary(obj.grounding_summary);
  if (groundingSummary !== undefined) nodeSet.grounding_summary = groundingSummary;
  const overrideReason = optionalString(obj, 'academic_override_reason');
  if (overrideReason !== undefined) nodeSet.academic_override_reason = overrideReason;
  const overrideBy = optionalString(obj, 'academic_override_by');
  if (overrideBy !== undefined) nodeSet.academic_override_by = overrideBy;

  return nodeSet;
}

// ===========================================================================
// V1-minimum supporting shapes (filled out in later phases M5/M8-M10/M12).
// Defined here so the schema namespace is complete and importable now.
// ===========================================================================

export interface KnowledgeComponent {
  kc_id: string;
  parent_node_id: string;
  statement: string;
}

export interface EvidenceMap {
  evidence_check_id: string;
  node_id: string;
  must_capture_signals: CaptureSignal[];
  diagnostic_bands: DiagnosticBand[];
}

export interface MilestoneAssessmentPack {
  milestone_pack_id: string;
  parent_assessment_id: string;
  title: string;
  support_object_ids: string[];
  status: NodeEngineStatus;
}

// ===========================================================================
// M8 — Node Experience Blueprint (Level 1, Build Spec §8.0).
// A governed object sequence (purposes + suggested vehicles) per approved node.
// The mandatory primary Evidence Check object is flagged explicitly.
// ===========================================================================

/** One Level-1 blueprint row — not yet a produced envelope (that is M10). */
export interface BlueprintObject {
  object_id: string;
  object_family: ObjectFamily;
  sequence_order: number;
  parent_node_id: string;
  parent_milestone_pack_id?: string | null;
  kc_ids: string[];
  node_object_purpose: NodeObjectPurpose | null;
  milestone_support_purpose: MilestoneSupportPurpose | null;
  suggested_vehicle: Vehicle;
  content_pattern: ContentPattern;
  is_primary_evidence_check: boolean;
  title: string;
  design_rationale: string;
  estimated_effort_minutes: number;
  addresses_misconception_ids: string[];
  /** When this object is designed to surface/correct one specific misconception. */
  targets_misconception_id?: string | null;
}

/** Persisted M8 artifact for one approved node. */
export interface NodeExperienceBlueprint {
  blueprint_id: string;
  course_id: string;
  subtopic_id: string;
  node_id: string;
  node_title: string;
  objects: BlueprintObject[];
  status: NodeEngineStatus;
  created_at: string;
  updated_at: string;
  approved_by?: string;
  approved_at?: string;
}

function parseBlueprintObject(input: unknown, context: string): BlueprintObject {
  const obj = asRecord(input, context);
  const family = assertEnum(OBJECT_FAMILIES, obj.object_family, `${context}.object_family`);
  const parsed: BlueprintObject = {
    object_id: requireString(obj, 'object_id', context),
    object_family: family,
    sequence_order: typeof obj.sequence_order === 'number' && Number.isFinite(obj.sequence_order)
      ? obj.sequence_order
      : 0,
    parent_node_id: requireString(obj, 'parent_node_id', context),
    parent_milestone_pack_id:
      typeof obj.parent_milestone_pack_id === 'string' ? obj.parent_milestone_pack_id : null,
    kc_ids: optionalStringArray(obj, 'kc_ids') ?? [],
    node_object_purpose:
      obj.node_object_purpose == null
        ? null
        : assertEnum(NODE_OBJECT_PURPOSES, obj.node_object_purpose, `${context}.node_object_purpose`),
    milestone_support_purpose:
      obj.milestone_support_purpose == null
        ? null
        : assertEnum(
            MILESTONE_SUPPORT_PURPOSES,
            obj.milestone_support_purpose,
            `${context}.milestone_support_purpose`
          ),
    suggested_vehicle: assertEnum(VEHICLES, obj.suggested_vehicle, `${context}.suggested_vehicle`),
    content_pattern: isEnumMember(CONTENT_PATTERNS, obj.content_pattern)
      ? obj.content_pattern
      : 'none',
    is_primary_evidence_check: obj.is_primary_evidence_check === true,
    title: optionalString(obj, 'title') ?? '',
    design_rationale: optionalString(obj, 'design_rationale') ?? '',
    estimated_effort_minutes:
      typeof obj.estimated_effort_minutes === 'number' && Number.isFinite(obj.estimated_effort_minutes)
        ? obj.estimated_effort_minutes
        : 0,
    addresses_misconception_ids: optionalStringArray(obj, 'addresses_misconception_ids') ?? [],
  };
  const targetsMisconceptionId = optionalString(obj, 'targets_misconception_id');
  if (targetsMisconceptionId !== undefined) {
    parsed.targets_misconception_id = targetsMisconceptionId;
  } else if (obj.targets_misconception_id === null) {
    parsed.targets_misconception_id = null;
  }
  return parsed;
}

export function parseNodeExperienceBlueprint(input: unknown): NodeExperienceBlueprint {
  const obj = asRecord(input, 'NodeExperienceBlueprint');
  const objects = Array.isArray(obj.objects)
    ? obj.objects.map((entry, i) => parseBlueprintObject(entry, `NodeExperienceBlueprint.objects[${i}]`))
    : [];
  const blueprint: NodeExperienceBlueprint = {
    blueprint_id: requireString(obj, 'blueprint_id', 'NodeExperienceBlueprint'),
    course_id: requireString(obj, 'course_id', 'NodeExperienceBlueprint'),
    subtopic_id: requireString(obj, 'subtopic_id', 'NodeExperienceBlueprint'),
    node_id: requireString(obj, 'node_id', 'NodeExperienceBlueprint'),
    node_title: optionalString(obj, 'node_title') ?? '',
    objects,
    status: assertEnum(NODE_ENGINE_STATUSES, obj.status, 'NodeExperienceBlueprint.status'),
    created_at: optionalString(obj, 'created_at') ?? new Date(0).toISOString(),
    updated_at: optionalString(obj, 'updated_at') ?? new Date(0).toISOString(),
  };
  const approvedBy = optionalString(obj, 'approved_by');
  if (approvedBy !== undefined) blueprint.approved_by = approvedBy;
  const approvedAt = optionalString(obj, 'approved_at');
  if (approvedAt !== undefined) blueprint.approved_at = approvedAt;
  return blueprint;
}

// ===========================================================================
// M9 — Learning Object Content Specification (Level 2, Build Spec §8.1).
// Academic source-of-truth per blueprint object — preservation_rules + grounding.
// ===========================================================================

export interface ContentSpecExample {
  label: string;
  content: string;
  citation?: Citation;
}

export interface ContentSpecNonExample {
  label: string;
  content: string;
  why_not: string;
}

/** Purpose-specific EC contract when node_object_purpose = evidence_check. */
export interface EvidenceCheckContentSpec {
  learner_task: string;
  response_prompt: string;
  reasoning_prompt: string;
  confidence_prompt: string;
  evidence_criteria_summary: string;
  misconception_trap?: string;
  no_feedback_before_submission: boolean;
  preferred_evidence_mode: PreferredEvidenceMode;
  must_capture_signals: CaptureSignal[];
}

/** One Level-2 content spec — not yet a produced envelope (that is M10). */
export interface LearningObjectContentSpec {
  content_spec_id: string;
  object_id: string;
  blueprint_id: string;
  course_id: string;
  subtopic_id: string;
  node_id: string;
  object_family: ObjectFamily;
  node_object_purpose: NodeObjectPurpose | null;
  milestone_support_purpose: MilestoneSupportPurpose | null;
  content_pattern: ContentPattern;
  suggested_vehicle: Vehicle;
  is_primary_evidence_check: boolean;
  parent_node_id: string;
  parent_milestone_pack_id?: string | null;
  kc_ids: string[];
  title: string;
  required_explanation: string;
  examples: ContentSpecExample[];
  non_examples: ContentSpecNonExample[];
  preservation_rules: string[];
  addresses_misconception_ids: string[];
  targets_misconception_id?: string | null;
  grounding_references: Citation[];
  grounding_strength: GroundingStrength;
  grounding_note?: string;
  evidence_check_spec?: EvidenceCheckContentSpec;
  status: NodeEngineStatus;
  created_at: string;
  updated_at: string;
  approved_by?: string;
  approved_at?: string;
}

/** Persisted bundle of content specs for one node's blueprint objects. */
export interface NodeContentSpecsBundle {
  bundle_id: string;
  course_id: string;
  subtopic_id: string;
  node_id: string;
  specs: LearningObjectContentSpec[];
  updated_at: string;
}

function parseContentSpecExample(input: unknown, context: string): ContentSpecExample {
  const obj = asRecord(input, context);
  const example: ContentSpecExample = {
    label: optionalString(obj, 'label') ?? '',
    content: optionalString(obj, 'content') ?? '',
  };
  if (obj.citation !== undefined && obj.citation !== null) {
    const cit = asRecord(obj.citation, `${context}.citation`);
    example.citation = {
      citation: typeof cit.citation === 'string' ? cit.citation : '',
      passage_ref: typeof cit.passage_ref === 'string' ? cit.passage_ref : '',
    };
  }
  return example;
}

function parseContentSpecNonExample(input: unknown, context: string): ContentSpecNonExample {
  const obj = asRecord(input, context);
  return {
    label: optionalString(obj, 'label') ?? '',
    content: optionalString(obj, 'content') ?? '',
    why_not: optionalString(obj, 'why_not') ?? '',
  };
}

function parseEvidenceCheckContentSpec(input: unknown, context: string): EvidenceCheckContentSpec {
  const obj = asRecord(input, context);
  const mustCapture = Array.isArray(obj.must_capture_signals)
    ? obj.must_capture_signals.map((s, i) =>
        assertEnum(CAPTURE_SIGNALS, s, `${context}.must_capture_signals[${i}]`)
      )
    : [...DEFAULT_CAPTURED_SIGNALS];
  return {
    learner_task: optionalString(obj, 'learner_task') ?? '',
    response_prompt: optionalString(obj, 'response_prompt') ?? '',
    reasoning_prompt: optionalString(obj, 'reasoning_prompt') ?? '',
    confidence_prompt: optionalString(obj, 'confidence_prompt') ?? '',
    evidence_criteria_summary: optionalString(obj, 'evidence_criteria_summary') ?? '',
    no_feedback_before_submission: obj.no_feedback_before_submission !== false,
    preferred_evidence_mode: assertEnum(
      PREFERRED_EVIDENCE_MODES,
      obj.preferred_evidence_mode,
      `${context}.preferred_evidence_mode`
    ),
    must_capture_signals: mustCapture,
    ...(optionalString(obj, 'misconception_trap')
      ? { misconception_trap: optionalString(obj, 'misconception_trap') }
      : {}),
  };
}

export function parseLearningObjectContentSpec(input: unknown): LearningObjectContentSpec {
  const obj = asRecord(input, 'LearningObjectContentSpec');
  const spec: LearningObjectContentSpec = {
    content_spec_id: requireString(obj, 'content_spec_id', 'LearningObjectContentSpec'),
    object_id: requireString(obj, 'object_id', 'LearningObjectContentSpec'),
    blueprint_id: requireString(obj, 'blueprint_id', 'LearningObjectContentSpec'),
    course_id: requireString(obj, 'course_id', 'LearningObjectContentSpec'),
    subtopic_id: requireString(obj, 'subtopic_id', 'LearningObjectContentSpec'),
    node_id: requireString(obj, 'node_id', 'LearningObjectContentSpec'),
    object_family: assertEnum(OBJECT_FAMILIES, obj.object_family, 'LearningObjectContentSpec.object_family'),
    node_object_purpose:
      obj.node_object_purpose == null
        ? null
        : assertEnum(NODE_OBJECT_PURPOSES, obj.node_object_purpose, 'LearningObjectContentSpec.node_object_purpose'),
    milestone_support_purpose:
      obj.milestone_support_purpose == null
        ? null
        : assertEnum(
            MILESTONE_SUPPORT_PURPOSES,
            obj.milestone_support_purpose,
            'LearningObjectContentSpec.milestone_support_purpose'
          ),
    content_pattern: isEnumMember(CONTENT_PATTERNS, obj.content_pattern)
      ? obj.content_pattern
      : 'none',
    suggested_vehicle: assertEnum(VEHICLES, obj.suggested_vehicle, 'LearningObjectContentSpec.suggested_vehicle'),
    is_primary_evidence_check: obj.is_primary_evidence_check === true,
    parent_node_id: requireString(obj, 'parent_node_id', 'LearningObjectContentSpec'),
    parent_milestone_pack_id:
      typeof obj.parent_milestone_pack_id === 'string' ? obj.parent_milestone_pack_id : null,
    kc_ids: optionalStringArray(obj, 'kc_ids') ?? [],
    title: optionalString(obj, 'title') ?? '',
    required_explanation: requireString(obj, 'required_explanation', 'LearningObjectContentSpec'),
    examples: Array.isArray(obj.examples)
      ? obj.examples.map((e, i) => parseContentSpecExample(e, `LearningObjectContentSpec.examples[${i}]`))
      : [],
    non_examples: Array.isArray(obj.non_examples)
      ? obj.non_examples.map((e, i) => parseContentSpecNonExample(e, `LearningObjectContentSpec.non_examples[${i}]`))
      : [],
    preservation_rules: optionalStringArray(obj, 'preservation_rules') ?? [],
    addresses_misconception_ids: optionalStringArray(obj, 'addresses_misconception_ids') ?? [],
    grounding_references: parseCitations(obj.grounding_references, 'LearningObjectContentSpec'),
    grounding_strength: assertEnum(
      GROUNDING_STRENGTHS,
      obj.grounding_strength,
      'LearningObjectContentSpec.grounding_strength'
    ),
    status: assertEnum(NODE_ENGINE_STATUSES, obj.status, 'LearningObjectContentSpec.status'),
    created_at: optionalString(obj, 'created_at') ?? new Date(0).toISOString(),
    updated_at: optionalString(obj, 'updated_at') ?? new Date(0).toISOString(),
  };
  const targetsMisconceptionId = optionalString(obj, 'targets_misconception_id');
  if (targetsMisconceptionId !== undefined) {
    spec.targets_misconception_id = targetsMisconceptionId;
  } else if (obj.targets_misconception_id === null) {
    spec.targets_misconception_id = null;
  }
  const groundingNote = optionalString(obj, 'grounding_note');
  if (groundingNote !== undefined) spec.grounding_note = groundingNote;
  const approvedBy = optionalString(obj, 'approved_by');
  if (approvedBy !== undefined) spec.approved_by = approvedBy;
  const approvedAt = optionalString(obj, 'approved_at');
  if (approvedAt !== undefined) spec.approved_at = approvedAt;
  if (obj.evidence_check_spec !== undefined && obj.evidence_check_spec !== null) {
    spec.evidence_check_spec = parseEvidenceCheckContentSpec(
      obj.evidence_check_spec,
      'LearningObjectContentSpec.evidence_check_spec'
    );
  }
  return spec;
}

export function parseNodeContentSpecsBundle(input: unknown): NodeContentSpecsBundle {
  const obj = asRecord(input, 'NodeContentSpecsBundle');
  return {
    bundle_id: requireString(obj, 'bundle_id', 'NodeContentSpecsBundle'),
    course_id: requireString(obj, 'course_id', 'NodeContentSpecsBundle'),
    subtopic_id: requireString(obj, 'subtopic_id', 'NodeContentSpecsBundle'),
    node_id: requireString(obj, 'node_id', 'NodeContentSpecsBundle'),
    specs: Array.isArray(obj.specs)
      ? obj.specs.map((s, i) => parseLearningObjectContentSpec(s))
      : [],
    updated_at: optionalString(obj, 'updated_at') ?? new Date(0).toISOString(),
  };
}

export interface InteractiveTemplateProfile {
  template_id: string;
  template_name: string;
  version: number;
  status: PromptTemplateStatus;
  learning_purpose: string;
  reuse_scope: ReuseScope;
}

export interface InteractiveInstance {
  template_id: string;
  template_version: number;
  template_form_values: Record<string, unknown>;
  evidence_check_role: 'not_evidence_check' | 'official_evidence_check' | 'supporting_practice';
}

export interface NewTemplateCandidate {
  template_name: string;
  learning_purpose: string;
  why_existing_templates_do_not_fit: string;
  suggested_reuse_scope: ReuseScope;
}

// ===========================================================================
// M1 — V1 academic-contract shapes (Build-Readiness §3).
//
// These are the FORWARD V1 shapes the node engine consumes. Stage 1 persists
// ID-compatible but field-divergent legacy shapes (CLO.clo_text, the SME
// working files, the positional A-ids, the rich SubtopicCloSection). The
// read-only `stage1Adapter.service` projects the approved Stage 1 artifacts
// INTO these shapes — nothing here is ever written back to Stage 1 or to the
// legacy node graph. Enums follow the existing `const`-array + union + parse*
// convention (no zod). Statuses are kept per-entity to match §3 exactly.
// ===========================================================================

/** CourseAcademicContract.status (§3: draft|approved). */
export const CONTRACT_STATUSES = ['draft', 'approved'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** CLO.status (§3: draft|refined|approved). */
export const CLO_STATUSES = ['draft', 'refined', 'approved'] as const;
export type CloStatus = (typeof CLO_STATUSES)[number];

/** Assessment.status — projected from the legacy approval_status vocabulary. */
export const ASSESSMENT_STATUSES = ['draft', 'approved', 'needs_revision'] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

/** Subtopic.status — projected from the legacy approval_status vocabulary. */
export const SUBTOPIC_STATUSES = ['draft', 'approved', 'needs_revision'] as const;
export type SubtopicStatus = (typeof SUBTOPIC_STATUSES)[number];

/** Root of the course (§3). Owns CLOs and Assessments. */
export interface CourseAcademicContract {
  course_id: string;
  title: string;
  level: string;
  clo_ids: string[];
  assessment_ids: string[];
  status: ContractStatus;
  source_doc_ref?: string;
  program_id?: string;
  notes?: string;
}

/** Course Learning Outcome (§3) — the V1 forward shape, not legacy schemas.CLO. */
export interface CLO {
  clo_id: string;
  course_id: string;
  /** Post-approval refined CLO text. */
  statement: string;
  status: CloStatus;
  bloom_level?: string;
  aligned_assessment_ids: string[];
  rationale?: string;
}

/** Assessment (§3). `assessment_id`/`label` are the frozen positional A-ids. */
export interface Assessment {
  assessment_id: string;
  course_id: string;
  label: string;
  type: string;
  status: AssessmentStatus;
  /** Approved weight string carried verbatim (e.g. "15%"); absent until approved. */
  weighting?: string;
  clo_ids: string[];
  redesign_notes?: string;
  milestone_pack_id?: string;
}

/** A connection from this subtopic to another refined CLO (preserved grounding). */
export interface SubtopicCrossCloLink {
  linked_clo_id: string;
  reason: string;
}

/**
 * Subtopic (§3) plus the rich grounding context preserved from the Layer 6
 * architecture (NEVER from the lossy `clo_topics` projection). `node_ids` is
 * empty here and filled by M7 node generation.
 */
export interface Subtopic {
  subtopic_id: string;
  course_id: string;
  clo_ids: string[];
  title: string;
  order: number;
  status: SubtopicStatus;
  description: string;
  // Preserved grounding context (the reason we read the rich Layer 6 file):
  purpose: string;
  expected_learning: string;
  learning_function: string;
  assessment_connection: string[];
  cross_clo_links: SubtopicCrossCloLink[];
  possible_node_families: string[];
  source_evidence: string[];
  cognitive_level?: string;
  node_ids: string[];
}

export function parseCourseAcademicContract(input: unknown): CourseAcademicContract {
  const obj = asRecord(input, 'CourseAcademicContract');
  const contract: CourseAcademicContract = {
    course_id: requireString(obj, 'course_id', 'CourseAcademicContract'),
    title: requireString(obj, 'title', 'CourseAcademicContract'),
    level: requireString(obj, 'level', 'CourseAcademicContract'),
    clo_ids: requireStringArray(obj, 'clo_ids', 'CourseAcademicContract'),
    assessment_ids: requireStringArray(obj, 'assessment_ids', 'CourseAcademicContract'),
    status: assertEnum(CONTRACT_STATUSES, obj.status, 'CourseAcademicContract.status'),
  };
  const sourceDocRef = optionalString(obj, 'source_doc_ref');
  if (sourceDocRef !== undefined) contract.source_doc_ref = sourceDocRef;
  const programId = optionalString(obj, 'program_id');
  if (programId !== undefined) contract.program_id = programId;
  const notes = optionalString(obj, 'notes');
  if (notes !== undefined) contract.notes = notes;
  return contract;
}

export function parseCLO(input: unknown): CLO {
  const obj = asRecord(input, 'CLO');
  const clo: CLO = {
    clo_id: requireString(obj, 'clo_id', 'CLO'),
    course_id: requireString(obj, 'course_id', 'CLO'),
    statement: requireString(obj, 'statement', 'CLO'),
    status: assertEnum(CLO_STATUSES, obj.status, 'CLO.status'),
    aligned_assessment_ids: optionalStringArray(obj, 'aligned_assessment_ids') ?? [],
  };
  const bloom = optionalString(obj, 'bloom_level');
  if (bloom !== undefined) clo.bloom_level = bloom;
  const rationale = optionalString(obj, 'rationale');
  if (rationale !== undefined) clo.rationale = rationale;
  return clo;
}

export function parseAssessment(input: unknown): Assessment {
  const obj = asRecord(input, 'Assessment');
  const assessment: Assessment = {
    assessment_id: requireString(obj, 'assessment_id', 'Assessment'),
    course_id: requireString(obj, 'course_id', 'Assessment'),
    label: requireString(obj, 'label', 'Assessment'),
    type: requireString(obj, 'type', 'Assessment'),
    status: assertEnum(ASSESSMENT_STATUSES, obj.status, 'Assessment.status'),
    clo_ids: optionalStringArray(obj, 'clo_ids') ?? [],
  };
  const weighting = optionalString(obj, 'weighting');
  if (weighting !== undefined) assessment.weighting = weighting;
  const redesignNotes = optionalString(obj, 'redesign_notes');
  if (redesignNotes !== undefined) assessment.redesign_notes = redesignNotes;
  const milestonePackId = optionalString(obj, 'milestone_pack_id');
  if (milestonePackId !== undefined) assessment.milestone_pack_id = milestonePackId;
  return assessment;
}

export function parseSubtopic(input: unknown): Subtopic {
  const obj = asRecord(input, 'Subtopic');
  const crossRaw = Array.isArray(obj.cross_clo_links) ? obj.cross_clo_links : [];
  const cross_clo_links: SubtopicCrossCloLink[] = crossRaw.map((entry, i) => {
    const link = asRecord(entry, `Subtopic.cross_clo_links[${i}]`);
    return {
      linked_clo_id: requireString(link, 'linked_clo_id', `Subtopic.cross_clo_links[${i}]`),
      reason: optionalString(link, 'reason') ?? '',
    };
  });
  const subtopic: Subtopic = {
    subtopic_id: requireString(obj, 'subtopic_id', 'Subtopic'),
    course_id: requireString(obj, 'course_id', 'Subtopic'),
    clo_ids: requireStringArray(obj, 'clo_ids', 'Subtopic'),
    title: requireString(obj, 'title', 'Subtopic'),
    order: requireInteger(obj, 'order', 'Subtopic'),
    status: assertEnum(SUBTOPIC_STATUSES, obj.status, 'Subtopic.status'),
    description: optionalString(obj, 'description') ?? '',
    purpose: optionalString(obj, 'purpose') ?? '',
    expected_learning: optionalString(obj, 'expected_learning') ?? '',
    learning_function: optionalString(obj, 'learning_function') ?? '',
    assessment_connection: optionalStringArray(obj, 'assessment_connection') ?? [],
    cross_clo_links,
    possible_node_families: optionalStringArray(obj, 'possible_node_families') ?? [],
    source_evidence: optionalStringArray(obj, 'source_evidence') ?? [],
    node_ids: optionalStringArray(obj, 'node_ids') ?? [],
  };
  const cognitive = optionalString(obj, 'cognitive_level');
  if (cognitive !== undefined) subtopic.cognitive_level = cognitive;
  return subtopic;
}
