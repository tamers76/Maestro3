/**
 * Phase 0 lightweight smoke tests (run with: npm test).
 *
 * Uses node:test via tsx (no test framework is installed). Covers:
 * - schema round-trip (envelope + validation result)
 * - golden node fixture parse
 * - enum rejection
 * - prompt-template registry version bump (never mutates a published version)
 * - legacy stages parked by default
 *
 * The registry test writes/reads the real config/prompt-templates.json (the
 * production seed path) and restores it afterwards so the repo stays clean.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';

import {
  assertEnum,
  NODE_TYPES,
  NodeEngineValidationError,
  parseNode,
  parseGeneratedObjectEnvelope,
  parseValidationResult,
  parseModalityGenerationConfig,
  parseVideoSettings,
  resolveGenerationModel,
  governanceStatusFromDecision,
  type GeneratedObjectEnvelope,
  type ModalityGenerationConfig,
  type ValidationResult,
} from '../../models/nodeEngine.js';
import { mockRenderVideo } from '../mocks/mockVideoRenderer.service.js';
import { defaultModalityGenerationConfigs } from '../../config/modalityGeneration.defaults.js';
import { isLegacyStage, LEGACY_STAGES_ENABLED } from '../../config/featureFlags.js';
import {
  getRegistry,
  getActiveVersion,
  getTemplateVersion,
  getTemplateEntry,
  updateTemplate,
  clearRegistryCache,
} from '../promptTemplateRegistry.service.js';
import {
  updateConfigForVehicle,
  clearModalityConfigCache,
} from '../modalityGenerationConfig.service.js';
import { mergeIntakeConfig } from '../../services/council.service.js';
import { migrateIntakeLayerFromStage1 } from '../../config.js';
import { defaultStage1Layers } from '../../config/stage1Layers.defaults.js';
import type { StageModelConfig, Stage1LayerConfig } from '../../models/schemas.js';

// Tests run with cwd = backend/ (npm test), so resolve fixtures from there.
const FIXTURES_DIR = join(process.cwd(), 'src', 'node-engine', '__fixtures__');
const REGISTRY_PATH = join(process.cwd(), '..', 'config', 'prompt-templates.json');
const MODALITY_CONFIG_PATH = join(process.cwd(), '..', 'config', 'modality-generation-config.json');

function sampleEnvelope(): GeneratedObjectEnvelope {
  return {
    object_id: 'obj_text_1',
    object_family: 'node_learning_object',
    parent_node_id: 'node_critical-eval_1',
    parent_milestone_pack_id: null,
    kc_ids: ['kc_evidence_strength'],
    node_object_purpose: 'explanation',
    milestone_support_purpose: null,
    produced_modality: 'text',
    content_pattern: 'comparison',
    addresses_misconceptions: ['misc_authority_equals_truth'],
    grounding_references: [{ citation: 'Smith 2020, p.12', passage_ref: 'chunk_42' }],
    grounding_strength: 'strong',
    estimated_effort_minutes: 6,
    accessibility: { alt_text: null, text_equivalent_ref: null },
    version: '1.0.0',
    is_live_version: true,
    governance_status: 'sme_approved',
    asset_ref: 'data/courses/X/node-engine/obj_text_1.json',
    modality_specific: { segments: [] },
  };
}

function sampleValidationResult(): ValidationResult {
  const baseCheck = { tier: 1, status: 'passed' as const, findings: [] };
  return {
    validation_id: 'val_1',
    validated_object_id: 'obj_text_1',
    object_version: '1.0.0',
    validation_timestamp: '2026-01-01T00:00:00.000Z',
    validation_status: 'passed',
    governance_decision: 'auto_proceed',
    review_priority: 'standard',
    checks: {
      grounding: baseCheck,
      preservation_rules: baseCheck,
      object_purpose: baseCheck,
      kc_misconception_alignment: baseCheck,
      modality_specific: baseCheck,
      evidence_check_integrity: { tier: 1, status: 'not_applicable', findings: [] },
      learner_model_write_safety: baseCheck,
      routing_safety: baseCheck,
      accessibility: baseCheck,
      governance: baseCheck,
    },
    risk_flags: [],
    required_actions: [],
    can_publish: true,
    can_route_to_learner: true,
    can_write_to_learner_model: false,
    sme_review_required: false,
    admin_review_required: false,
    developer_review_required: false,
    qa_review_required: false,
    audit_refs: {
      content_spec_id: 'spec_1',
      prompt_template_id: 'text_generation_prompt',
      prompt_version: '1',
      generation_mode: 'single',
      generated_object_version: '1.0.0',
      validation_version: '1',
    },
  };
}

test('GeneratedObjectEnvelope round-trips through parse + JSON', () => {
  const original = sampleEnvelope();
  const roundTripped = parseGeneratedObjectEnvelope(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(roundTripped, original);
});

test('ValidationResult round-trips with keyed checks', () => {
  const original = sampleValidationResult();
  const roundTripped = parseValidationResult(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(roundTripped, original);
  assert.equal(roundTripped.checks.evidence_check_integrity.status, 'not_applicable');
});

test('golden node fixture parses against the Node schema', () => {
  const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, 'node_critical-eval_1.json'), 'utf-8'));
  const node = parseNode(raw);
  assert.equal(node.node_id, 'node_critical-eval_1');
  assert.equal(node.node_type, 'judgment');
  assert.equal(node.primary_evidence_check_requirement.preferred_evidence_mode, 'select_and_justify');
  assert.deepEqual(node.primary_evidence_check_requirement.must_capture_signals, [
    'response',
    'reasoning',
    'confidence',
  ]);
  assert.equal(node.misconception_bindings[0].severity, 'high');
});

test('assertEnum rejects an invalid enum value', () => {
  assert.throws(() => assertEnum(NODE_TYPES, 'not_a_real_type', 'node_type'), NodeEngineValidationError);
  assert.throws(() => parseNode({ ...sampleNodeRaw(), node_type: 'bogus' }), NodeEngineValidationError);
});

test('governance decision reject maps to terminal rejected status', () => {
  assert.equal(governanceStatusFromDecision('reject'), 'rejected');
  assert.equal(governanceStatusFromDecision('auto_proceed'), 'auto_proceed');
});

test('prompt-template registry seeds all vehicles and bumps versions immutably', () => {
  const hadRegistryBefore = existsSync(REGISTRY_PATH);
  const registrySnapshot = hadRegistryBefore ? readFileSync(REGISTRY_PATH, 'utf-8') : null;
  try {
    clearRegistryCache();
    const registry = getRegistry();
    assert.ok(registry.templates.length >= 7, 'expected six active templates + simulation placeholder');

    // State-independent: capture the current active version then assert a bump.
    const startActive = getActiveVersion('text_generation_prompt');
    assert.ok(startActive);
    const startVersion = startActive!.version;
    const startPrompt = startActive!.task_prompt;

    const bumped = updateTemplate('text_generation_prompt', {
      task_prompt: startPrompt + '\n\n[edited in test]',
      last_updated_by: 'test',
      change_note: 'version bump test',
    });
    assert.equal(bumped.version, startVersion + 1);

    // Active pointer moved...
    assert.equal(getActiveVersion('text_generation_prompt')!.version, startVersion + 1);
    // ...but the previously-published version is preserved unchanged.
    const priorStillThere = getTemplateVersion('text_generation_prompt', startVersion);
    assert.ok(priorStillThere);
    assert.equal(priorStillThere!.task_prompt, startPrompt);
  } finally {
    // Restore repo state: put the original file back, or drop a test-created one.
    if (registrySnapshot !== null) {
      writeFileSync(REGISTRY_PATH, registrySnapshot, 'utf-8');
    } else if (existsSync(REGISTRY_PATH)) {
      rmSync(REGISTRY_PATH, { force: true });
    }
    clearRegistryCache();
  }
});

// ===========================================================================
// Stage 1 intake config resolution: layer1-intake is source of truth, with
// stageConfigs.stage1 as the per-field fallback (drives runStage1 / form / mapping).
// ===========================================================================

function sampleStage1Config(overrides: Partial<StageModelConfig> = {}): StageModelConfig {
  return {
    mode: 'single',
    singleModel: 'stage1-model',
    councilModels: ['stage1-a', 'stage1-b'],
    chairmanModel: 'stage1-chair',
    memberSystemPrompt: 'stage1 member',
    chairmanSystemPrompt: 'stage1 chairman',
    taskPrompt: 'stage1 extraction',
    taskPrompt2: 'stage1 clo analysis',
    ...overrides,
  };
}

test('mergeIntakeConfig: prefers populated layer1-intake fields over stage1', () => {
  const stage1 = sampleStage1Config();
  const layer: StageModelConfig = {
    mode: 'council',
    singleModel: 'intake-model',
    councilModels: ['intake-a', 'intake-b'],
    chairmanModel: 'intake-chair',
    memberSystemPrompt: 'intake member',
    chairmanSystemPrompt: 'intake chairman',
    taskPrompt: 'intake extraction',
    taskPrompt2: 'intake clo analysis',
  };
  const merged = mergeIntakeConfig(layer, stage1);
  assert.equal(merged.mode, 'council');
  assert.equal(merged.singleModel, 'intake-model');
  assert.deepEqual(merged.councilModels, ['intake-a', 'intake-b']);
  assert.equal(merged.chairmanModel, 'intake-chair');
  assert.equal(merged.taskPrompt, 'intake extraction');
  assert.equal(merged.taskPrompt2, 'intake clo analysis');
});

test('mergeIntakeConfig: falls back to stage1 for each empty layer field', () => {
  const stage1 = sampleStage1Config();
  // Layer has empty model + prompts → everything resolves from stage1.
  const layer: StageModelConfig = {
    mode: 'single',
    singleModel: '   ',
    councilModels: [],
    chairmanModel: '',
    taskPrompt: '',
    taskPrompt2: undefined,
  };
  const merged = mergeIntakeConfig(layer, stage1);
  assert.equal(merged.singleModel, 'stage1-model');
  assert.deepEqual(merged.councilModels, ['stage1-a', 'stage1-b']);
  assert.equal(merged.chairmanModel, 'stage1-chair');
  assert.equal(merged.taskPrompt, 'stage1 extraction');
  assert.equal(merged.taskPrompt2, 'stage1 clo analysis');
});

test('mergeIntakeConfig: returns stage1 verbatim when no layer config exists', () => {
  const stage1 = sampleStage1Config();
  assert.deepEqual(mergeIntakeConfig(undefined, stage1), stage1);
});

test('migrateIntakeLayerFromStage1: seeds legacy intake layer from stage1 (preserves picked model), idempotent', () => {
  const stage1 = sampleStage1Config({ singleModel: 'gpt-4o', chairmanModel: 'gpt-4o' });
  // Legacy intake layer: the old "Maestro Course Intake AI" placeholder + a stale
  // model that never drove the real extraction call, and no taskPrompt2.
  const legacyLayer: Stage1LayerConfig = {
    ...(defaultStage1Layers.find((l) => l.id === 'layer1-intake') as Stage1LayerConfig),
    singleModel: 'anthropic/claude-sonnet-4',
    chairmanModel: 'anthropic/claude-sonnet-4',
    taskPrompt: 'You are Maestro Course Intake AI.\n\nExtract the academic structure...',
    taskPrompt2: undefined,
  };

  const [migrated] = migrateIntakeLayerFromStage1([legacyLayer], stage1);
  // Picked model preserved, extraction prompt seeded, CLO analysis backfilled.
  assert.equal(migrated.singleModel, 'gpt-4o');
  assert.equal(migrated.chairmanModel, 'gpt-4o');
  assert.equal(migrated.taskPrompt, stage1.taskPrompt);
  assert.equal(migrated.taskPrompt2, stage1.taskPrompt2);
  assert.equal((migrated.taskPrompt ?? '').startsWith('You are Maestro Course Intake AI'), false);

  // Idempotent: re-running makes no further changes.
  const [again] = migrateIntakeLayerFromStage1([migrated], stage1);
  assert.deepEqual(again, migrated);
});

test('migrateIntakeLayerFromStage1: leaves an already intake-wired layer untouched', () => {
  const stage1 = sampleStage1Config();
  const intakeLayer: Stage1LayerConfig = {
    ...(defaultStage1Layers.find((l) => l.id === 'layer1-intake') as Stage1LayerConfig),
    singleModel: 'custom/intake-model',
    taskPrompt: 'You are an expert curriculum analyst. Analyze...',
    taskPrompt2: 'Existing CLO analysis prompt',
  };
  const [result] = migrateIntakeLayerFromStage1([intakeLayer], stage1);
  assert.equal(result.singleModel, 'custom/intake-model');
  assert.equal(result.taskPrompt, intakeLayer.taskPrompt);
  assert.equal(result.taskPrompt2, intakeLayer.taskPrompt2);
});

test('legacy Stages 2-5 are parked by default', () => {
  assert.equal(LEGACY_STAGES_ENABLED, false);
  assert.equal(isLegacyStage(2), true);
  assert.equal(isLegacyStage(5), true);
  assert.equal(isLegacyStage(1), false);
});

function sampleNodeRaw(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, 'node_critical-eval_1.json'), 'utf-8'));
}

// ===========================================================================
// Model-config addition: resolution order, prompt-version invariance, audit.
// ===========================================================================

function sampleModalityConfig(overrides: Partial<ModalityGenerationConfig> = {}): ModalityGenerationConfig {
  return {
    id: 'modality_text',
    vehicle: 'text',
    generatorKind: 'chat',
    mode: 'single',
    taskPrompt: '',
    enabled: true,
    ...overrides,
  };
}

test('resolveGenerationModel: prompt-template version override wins over everything', () => {
  const resolved = resolveGenerationModel({
    templateVersion: { modelOverride: 'override-model', modelSelectionReason: 'pinned at version time' },
    modalityConfig: sampleModalityConfig({ singleModel: 'modality-model' }),
    globalDefaultModel: 'global-model',
  });
  assert.equal(resolved.model, 'override-model');
  assert.equal(resolved.source, 'prompt_template_override');
  assert.equal(resolved.reason, 'pinned at version time');
});

test('resolveGenerationModel: modality config wins when no version override', () => {
  const resolved = resolveGenerationModel({
    templateVersion: { modelSelectionReason: 'no override here' },
    modalityConfig: sampleModalityConfig({ singleModel: 'modality-model', modelSelectionReason: 'chosen for text' }),
    globalDefaultModel: 'global-model',
  });
  assert.equal(resolved.model, 'modality-model');
  assert.equal(resolved.source, 'modality_config');
  assert.equal(resolved.reason, 'chosen for text');
});

test('resolveGenerationModel: falls back to global default (step 3 always resolves)', () => {
  // No override, no modality singleModel -> global default.
  const resolved = resolveGenerationModel({
    templateVersion: null,
    modalityConfig: sampleModalityConfig({ singleModel: undefined }),
    globalDefaultModel: 'global-model',
  });
  assert.equal(resolved.model, 'global-model');
  assert.equal(resolved.source, 'global_default');

  // Even with no template and no modality config at all, step 3 resolves.
  const bare = resolveGenerationModel({ globalDefaultModel: 'global-model' });
  assert.equal(bare.model, 'global-model');
  assert.equal(bare.source, 'global_default');
});

test('resolveGenerationModel: council mode returns council members + chairman from modality config', () => {
  const resolved = resolveGenerationModel({
    templateVersion: null,
    modalityConfig: sampleModalityConfig({
      mode: 'council',
      councilModels: ['member-a', 'member-b'],
      chairmanModel: 'chair-x',
    }),
    globalDefaultModel: 'global-model',
  });
  assert.equal(resolved.mode, 'council');
  assert.equal(resolved.source, 'modality_config');
  assert.deepEqual(resolved.councilModels, ['member-a', 'member-b']);
  assert.equal(resolved.chairmanModel, 'chair-x');
});

test('updating modality config does NOT change the prompt-template active_version', () => {
  const hadRegistry = existsSync(REGISTRY_PATH);
  const registrySnapshot = hadRegistry ? readFileSync(REGISTRY_PATH, 'utf-8') : null;
  const hadModality = existsSync(MODALITY_CONFIG_PATH);
  const modalitySnapshot = hadModality ? readFileSync(MODALITY_CONFIG_PATH, 'utf-8') : null;
  try {
    clearRegistryCache();
    clearModalityConfigCache();

    // Capture the text template's active version pointer BEFORE the model edit.
    getRegistry();
    const entryBefore = getTemplateEntry('text_generation_prompt');
    assert.ok(entryBefore);
    const activeBefore = entryBefore!.active_version;
    const versionsBefore = entryBefore!.versions.length;

    // Edit the modality (model) config for the 'text' vehicle.
    const updated = updateConfigForVehicle('text', { singleModel: 'some-pinned-model' });
    assert.equal(updated.singleModel, 'some-pinned-model');

    // The prompt-template registry must be untouched: same active version, same count.
    const entryAfter = getTemplateEntry('text_generation_prompt');
    assert.ok(entryAfter);
    assert.equal(entryAfter!.active_version, activeBefore, 'active_version must not change');
    assert.equal(entryAfter!.versions.length, versionsBefore, 'no new prompt version minted');
  } finally {
    if (registrySnapshot !== null) writeFileSync(REGISTRY_PATH, registrySnapshot, 'utf-8');
    else if (existsSync(REGISTRY_PATH)) rmSync(REGISTRY_PATH, { force: true });
    if (modalitySnapshot !== null) writeFileSync(MODALITY_CONFIG_PATH, modalitySnapshot, 'utf-8');
    else if (existsSync(MODALITY_CONFIG_PATH)) rmSync(MODALITY_CONFIG_PATH, { force: true });
    clearRegistryCache();
    clearModalityConfigCache();
  }
});

test('envelope audit fields parse when present and are omitted when absent', () => {
  // Present: model-selection audit fields round-trip.
  const withAudit = {
    ...sampleEnvelope(),
    model_used: 'global-model',
    model_selection_source: 'global_default' as const,
    model_selection_reason: 'fallback',
    council_models_used: ['a', 'b'],
    chairman_model_used: 'chair',
  };
  const parsed = parseGeneratedObjectEnvelope(JSON.parse(JSON.stringify(withAudit)));
  assert.equal(parsed.model_used, 'global-model');
  assert.equal(parsed.model_selection_source, 'global_default');
  assert.equal(parsed.model_selection_reason, 'fallback');
  assert.deepEqual(parsed.council_models_used, ['a', 'b']);
  assert.equal(parsed.chairman_model_used, 'chair');

  // Absent: none of the audit keys appear on the parsed object.
  const bare = parseGeneratedObjectEnvelope(JSON.parse(JSON.stringify(sampleEnvelope())));
  assert.equal('model_used' in bare, false);
  assert.equal('model_selection_source' in bare, false);
  assert.equal('council_models_used' in bare, false);

  // Invalid source value is rejected.
  assert.throws(
    () => parseGeneratedObjectEnvelope({ ...sampleEnvelope(), model_selection_source: 'bogus_source' }),
    NodeEngineValidationError
  );
});

// ===========================================================================
// Video modality: HeyGen v3 videoSettings schema + MockVideoRenderer contract.
// ===========================================================================

test('videoSettings parses valid HeyGen v3 settings through the modality config', () => {
  const parsed = parseModalityGenerationConfig({
    ...sampleModalityConfig({
      id: 'modality_video',
      vehicle: 'video',
      generatorKind: 'video',
    }),
    videoSettings: {
      provider: 'heygen',
      apiKeyRef: 'HEYGEN_API_KEY',
      avatar_id: 'avatar_123',
      voice_id: 'voice_456',
      engine: 'avatar_iv',
      resolution: '1080p',
      aspect_ratio: '16:9',
      output_format: 'mp4',
      remove_background: false,
      motion_prompt: 'gentle hand gestures',
      voice_settings: { speed: 1.0, pitch: 0, locale: 'en-US' },
      callback_url: 'https://example.com/hook',
    },
  });
  assert.ok(parsed.videoSettings);
  assert.equal(parsed.videoSettings!.provider, 'heygen');
  assert.equal(parsed.videoSettings!.engine, 'avatar_iv');
  assert.equal(parsed.videoSettings!.resolution, '1080p');
  assert.equal(parsed.videoSettings!.voice_settings?.locale, 'en-US');
});

test('videoSettings rejects an invalid enum value (resolution "8k")', () => {
  assert.throws(
    () => parseVideoSettings({ provider: 'heygen', resolution: '8k' }),
    NodeEngineValidationError
  );
  // ...and a non-heygen provider.
  assert.throws(() => parseVideoSettings({ provider: 'synthesia' }), NodeEngineValidationError);
});

test('videoSettings rejects style_id / brand_kit_id (deferred v2 Template API)', () => {
  assert.throws(
    () => parseVideoSettings({ provider: 'heygen', style_id: 'x' }),
    NodeEngineValidationError
  );
  assert.throws(
    () => parseVideoSettings({ provider: 'heygen', brand_kit_id: 'y' }),
    NodeEngineValidationError
  );
});

test('MockVideoRenderer returns completed with transcript === submitted script + a video_url', () => {
  const script = 'Welcome. Today we explore evidence strength and why authority is not truth.';
  const result = mockRenderVideo({
    script,
    videoSettings: { provider: 'heygen', engine: 'avatar_iv', resolution: '1080p', output_format: 'mp4' },
    duration_seconds: 90,
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.transcript, script, 'submitted script is the authoritative transcript, verbatim');
  assert.ok(result.video_url.length > 0, 'completed result carries a (mock presigned) video_url');
  assert.equal(result.provider, 'heygen');
  assert.equal(result.mock, true);
  assert.equal(result.duration_seconds, 90);
});

test('no style_id / brand_kit_id anywhere in the seeded video config', () => {
  const videoSeed = defaultModalityGenerationConfigs.find((c) => c.vehicle === 'video');
  assert.ok(videoSeed);
  const serialized = JSON.stringify(videoSeed);
  assert.equal(serialized.includes('style_id'), false);
  assert.equal(serialized.includes('brand_kit_id'), false);
  assert.equal(videoSeed!.videoSettings?.provider, 'heygen');
  assert.equal(videoSeed!.videoSettings?.engine, 'avatar_iv');
});
