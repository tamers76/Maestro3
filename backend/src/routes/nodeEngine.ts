/**
 * Maestro Node Engine router (Phase 0).
 *
 * Mounted at `/api/node-engine`. Phase 0 exposes:
 * - GET  /status                       engine + legacy-flag + registry summary
 * - GET  /prompt-templates             active version of every template
 * - GET  /prompt-templates/:id         full entry (all immutable versions)
 * - PUT  /prompt-templates/:id         edit -> appends a new version (D3)
 *
 * Node generation/blueprint/validation endpoints arrive in later phases.
 */
import { Router, Request, Response } from 'express';
import {
  getRegistry,
  listActiveTemplates,
  getTemplateEntry,
  updateTemplate,
  getActiveTemplateForVehicle,
} from '../node-engine/promptTemplateRegistry.service.js';
import {
  getConfigs,
  getConfigForVehicle,
  updateConfigForVehicle,
  resolvedModelForVehicle,
  type ModalityGenerationConfigUpdate,
} from '../node-engine/modalityGenerationConfig.service.js';
import { getNodeEngineDefaultModel } from '../config.js';
import {
  getReferenceCoverageConfig,
  updateReferenceCoverageConfig,
} from '../node-engine/referenceCoverageConfig.service.js';
import {
  assertEnum,
  parseVideoSettings,
  VEHICLES,
  GENERATION_MODES,
  NodeEngineValidationError,
  type ModalityGenerationConfig,
  type ReferenceCoverageThresholds,
  type Vehicle,
} from '../models/nodeEngine.js';
import { LEGACY_STAGES_ENABLED } from '../config/featureFlags.js';
import {
  generateNodeSet,
  getNodeSet,
  approveNodeSet,
  AcademicApprovalRequiredError,
} from '../node-engine/nodeGeneration.service.js';
import {
  updateNodeProse,
  regenerateSingleNode,
  reopenNodeSet,
  NodeEditConflictError,
} from '../node-engine/nodeEditing.service.js';
import {
  generateBlueprint,
  getBlueprint,
  updateBlueprint,
  approveBlueprint,
  getBlueprintsForNodes,
  BlueprintNodeNotApprovedError,
  BlueprintValidationError,
} from '../node-engine/nodeBlueprint.service.js';
import {
  generateContentSpecs,
  getContentSpec,
  getContentSpecsForNode,
  updateContentSpec,
  groundContentSpec,
  approveContentSpec,
  getContentSpecsForNodes,
  ContentSpecBlueprintNotApprovedError,
  ContentSpecValidationError,
} from '../node-engine/contentSpec.service.js';
import {
  produceTextObject,
  getProducedObject,
  getProducedObjectsForNodes,
  ContentSpecNotApprovedError,
  TextProductionError,
} from '../node-engine/modalityProduction.service.js';
import {
  produceVideoBriefObject,
  VideoBriefProductionError,
  ContentSpecNotApprovedError as VideoContentSpecNotApprovedError,
} from '../node-engine/videoBriefProduction.service.js';
import {
  produceStructuredVisualObject,
  saveStructuredVisualEdits,
  StructuredVisualProductionError,
  ContentSpecNotApprovedError as StructuredVisualContentSpecNotApprovedError,
} from '../node-engine/structuredVisualProduction.service.js';
import {
  refreshVideoRenderForObject,
  submitVideoRenderForObject,
  VideoRenderError,
} from '../node-engine/videoRenderProduction.service.js';
import {
  resolveStoredProducedVideoPath,
  streamProducedVideoFile,
} from '../node-engine/videoAsset.service.js';
import {
  getHeyGenCatalogStatus,
  listHeyGenAvatarLooks,
  listHeyGenAvatarCharacters,
  listHeyGenAvatarLooksForGroup,
  listHeyGenVoices,
  listHeyGenVideoAgentStyles,
  HeyGenCatalogError,
} from '../node-engine/heygenCatalog.service.js';
import { resolveHeyGenApprovedAvatars } from '../node-engine/heygenApprovedAvatars.service.js';
import {
  getActiveNodeGenerationPrompt,
  updateNodeGenerationPrompt,
} from '../node-engine/nodeGenerationPrompt.service.js';
import { requireRole, courseAccessParamHandler } from '../auth/middleware.js';
import { recordAudit } from '../services/audit.service.js';

const router = Router();

// Node engine is authoring work: admins + professors only. Global config editing is
// further restricted to admins per-route; course-scoped routes are access-checked
// via the :courseCode param handler below.
router.use(requireRole('admin', 'professor'));
router.param('courseCode', courseAccessParamHandler);

// GET /api/node-engine/status
router.get('/status', (_req: Request, res: Response) => {
  try {
    const registry = getRegistry();
    res.json({
      engine: 'maestro-node-engine',
      phase: 0,
      legacy_stages_enabled: LEGACY_STAGES_ENABLED,
      prompt_templates: {
        count: registry.templates.length,
        vehicles: registry.templates.map((t) => t.vehicle),
        updated_at: registry.updated_at,
      },
    });
  } catch (error) {
    console.error('Error fetching node-engine status:', error);
    res.status(500).json({ error: 'Failed to fetch node-engine status' });
  }
});

// GET /api/node-engine/prompt-templates
router.get('/prompt-templates', (_req: Request, res: Response) => {
  try {
    res.json({ templates: listActiveTemplates() });
  } catch (error) {
    console.error('Error listing prompt templates:', error);
    res.status(500).json({ error: 'Failed to list prompt templates' });
  }
});

// GET /api/node-engine/prompt-templates/:id
router.get('/prompt-templates/:id', (req: Request, res: Response) => {
  try {
    const entry = getTemplateEntry(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: `Prompt template not found: ${req.params.id}` });
    }
    res.json(entry);
  } catch (error) {
    console.error('Error fetching prompt template:', error);
    res.status(500).json({ error: 'Failed to fetch prompt template' });
  }
});

// PUT /api/node-engine/prompt-templates/:id — edit appends a new version
router.put('/prompt-templates/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { task_prompt, output_schema_ref, member_system_prompt, chairman_system_prompt, status, last_updated_by, change_note } =
      req.body as Record<string, unknown>;

    if (typeof last_updated_by !== 'string' || !last_updated_by.trim()) {
      return res.status(400).json({ error: 'last_updated_by is required' });
    }
    if (typeof change_note !== 'string' || !change_note.trim()) {
      return res.status(400).json({ error: 'change_note is required' });
    }

    const updated = await updateTemplate(req.params.id, {
      task_prompt: typeof task_prompt === 'string' ? task_prompt : undefined,
      output_schema_ref,
      member_system_prompt: typeof member_system_prompt === 'string' ? member_system_prompt : undefined,
      chairman_system_prompt: typeof chairman_system_prompt === 'string' ? chairman_system_prompt : undefined,
      status: status as never,
      last_updated_by,
      change_note,
    });

    void recordAudit(req, {
      action: 'config.prompt_template_update',
      category: 'settings',
      entityType: 'prompt_template',
      entityId: req.params.id,
      summary: `Updated prompt template "${req.params.id}" (new version)`,
      metadata: { change_note },
    });

    res.json({ message: 'Prompt template updated (new version created)', template: updated });
  } catch (error) {
    if (error instanceof NodeEngineValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error updating prompt template:', error);
    res.status(500).json({ error: 'Failed to update prompt template' });
  }
});

// ===========================================================================
// Modality model/generation config (independent from prompt-template versions).
// Updating model config here NEVER mints a prompt-template version (D3).
// ===========================================================================

/** Hydrate the display-only taskPrompt mirror from the active template body. */
function hydrateTaskPrompt(config: ModalityGenerationConfig): ModalityGenerationConfig {
  const active = getActiveTemplateForVehicle(config.vehicle);
  return { ...config, taskPrompt: active?.task_prompt ?? config.taskPrompt };
}

/**
 * Never ship the raw HeyGen key to the browser. Blank videoSettings.apiKey and
 * surface a boolean hint (apiKeyConfigured) instead, so the UI can show "saved".
 */
function maskVideoApiKey(config: ModalityGenerationConfig): ModalityGenerationConfig {
  const vs = config.videoSettings;
  if (!vs) return config;
  const hasKey = Boolean(vs.apiKey && vs.apiKey.trim());
  return { ...config, videoSettings: { ...vs, apiKey: '', apiKeyConfigured: hasKey } };
}

/** Display-ready config for API responses (task prompt hydrated, secret masked). */
function presentConfig(config: ModalityGenerationConfig): ModalityGenerationConfig {
  return maskVideoApiKey(hydrateTaskPrompt(config));
}

// GET /api/node-engine/modality-config — all configs + global default + resolved per vehicle
router.get('/modality-config', (_req: Request, res: Response) => {
  try {
    const configs = getConfigs().map((config) => ({
      config: presentConfig(config),
      resolved: resolvedModelForVehicle(config.vehicle),
    }));
    res.json({
      global_default_model: getNodeEngineDefaultModel(),
      configs,
    });
  } catch (error) {
    console.error('Error fetching modality config:', error);
    res.status(500).json({ error: 'Failed to fetch modality config' });
  }
});

// GET /api/node-engine/modality-config/:vehicle — one config + resolved model/source
router.get('/modality-config/:vehicle', (req: Request, res: Response) => {
  try {
    const vehicle = assertEnum(VEHICLES, req.params.vehicle, 'vehicle');
    const config = getConfigForVehicle(vehicle);
    if (!config) {
      return res.status(404).json({ error: `No modality config for vehicle: ${vehicle}` });
    }
    res.json({
      global_default_model: getNodeEngineDefaultModel(),
      config: presentConfig(config),
      resolved: resolvedModelForVehicle(vehicle),
    });
  } catch (error) {
    if (error instanceof NodeEngineValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error fetching modality config:', error);
    res.status(500).json({ error: 'Failed to fetch modality config' });
  }
});

// PUT /api/node-engine/modality-config/:vehicle — update model/generation settings only
router.put('/modality-config/:vehicle', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const vehicle: Vehicle = assertEnum(VEHICLES, req.params.vehicle, 'vehicle');
    const body = req.body as Record<string, unknown>;

    const update: ModalityGenerationConfigUpdate = {};
    if (body.mode !== undefined) {
      update.mode = assertEnum(GENERATION_MODES, body.mode, 'mode');
    }
    if (body.singleModel !== undefined) {
      if (typeof body.singleModel !== 'string') {
        throw new NodeEngineValidationError('singleModel must be a string');
      }
      update.singleModel = body.singleModel;
    }
    if (body.councilModels !== undefined) {
      if (!Array.isArray(body.councilModels) || body.councilModels.some((m) => typeof m !== 'string')) {
        throw new NodeEngineValidationError('councilModels must be a string[]');
      }
      update.councilModels = body.councilModels as string[];
    }
    if (body.chairmanModel !== undefined) {
      if (typeof body.chairmanModel !== 'string') {
        throw new NodeEngineValidationError('chairmanModel must be a string');
      }
      update.chairmanModel = body.chairmanModel;
    }
    if (body.defaultTemperature !== undefined) {
      if (typeof body.defaultTemperature !== 'number') {
        throw new NodeEngineValidationError('defaultTemperature must be a number');
      }
      update.defaultTemperature = body.defaultTemperature;
    }
    if (body.defaultMaxTokens !== undefined) {
      if (typeof body.defaultMaxTokens !== 'number') {
        throw new NodeEngineValidationError('defaultMaxTokens must be a number');
      }
      update.defaultMaxTokens = body.defaultMaxTokens;
    }
    if (body.modelSelectionReason !== undefined) {
      if (typeof body.modelSelectionReason !== 'string') {
        throw new NodeEngineValidationError('modelSelectionReason must be a string');
      }
      update.modelSelectionReason = body.modelSelectionReason;
    }
    if (body.productionTarget !== undefined) {
      if (typeof body.productionTarget !== 'string') {
        throw new NodeEngineValidationError('productionTarget must be a string');
      }
      update.productionTarget = body.productionTarget;
    }
    if (body.videoSettings !== undefined) {
      // Enum/shape validation (incl. style_id/brand_kit_id rejection) happens in
      // parseVideoSettings via parseModalityGenerationConfig on save.
      const incoming = parseVideoSettings(body.videoSettings);
      // The GET response masks the saved key (blank + apiKeyConfigured). So a
      // blank apiKey on save means "keep the existing key", not "clear it".
      if (!incoming.apiKey || !incoming.apiKey.trim()) {
        const existingKey = getConfigForVehicle(vehicle)?.videoSettings?.apiKey;
        if (existingKey) incoming.apiKey = existingKey;
        else delete incoming.apiKey;
      }
      update.videoSettings = incoming;
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        throw new NodeEngineValidationError('enabled must be a boolean');
      }
      update.enabled = body.enabled;
    }

    const updated = await updateConfigForVehicle(vehicle, update);
    void recordAudit(req, {
      action: 'config.modality_update',
      category: 'settings',
      entityType: 'modality_config',
      entityId: vehicle,
      summary: `Updated modality config for "${vehicle}"`,
      metadata: { fields: Object.keys(update) },
    });
    res.json({
      message: 'Modality config updated (no prompt-template version created)',
      config: presentConfig(updated),
      resolved: resolvedModelForVehicle(vehicle),
    });
  } catch (error) {
    if (error instanceof NodeEngineValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error updating modality config:', error);
    res.status(500).json({ error: 'Failed to update modality config' });
  }
});

// ===========================================================================
// HeyGen catalog — avatar looks + voices for Video render Settings UI
// ===========================================================================

router.get('/heygen/catalog/status', (req: Request, res: Response) => {
  try {
    const apiKeyRef =
      typeof req.query.api_key_ref === 'string' ? req.query.api_key_ref : undefined;
    res.json(getHeyGenCatalogStatus(apiKeyRef));
  } catch (error) {
    console.error('HeyGen catalog status:', error);
    res.status(500).json({ error: 'Failed to read HeyGen catalog status' });
  }
});

/** Institution-curated allowlist — only these avatars appear in the Video Settings picker. */
router.get('/heygen/approved-avatars', async (req: Request, res: Response) => {
  try {
    const apiKeyRef =
      typeof req.query.api_key_ref === 'string' ? req.query.api_key_ref : undefined;
    const items = await resolveHeyGenApprovedAvatars({ apiKeyRef });
    res.json({ items });
  } catch (error) {
    console.error('HeyGen approved avatars:', error);
    res.status(500).json({ error: 'Failed to load approved HeyGen avatars' });
  }
});

router.get('/heygen/avatars', async (req: Request, res: Response) => {
  try {
    const q = req.query;
    const page = await listHeyGenAvatarLooks({
      apiKeyRef: typeof q.api_key_ref === 'string' ? q.api_key_ref : undefined,
      ownership:
        q.ownership === 'public' || q.ownership === 'private' ? q.ownership : undefined,
      avatar_type:
        q.avatar_type === 'studio_avatar' ||
        q.avatar_type === 'digital_twin' ||
        q.avatar_type === 'photo_avatar'
          ? q.avatar_type
          : undefined,
      group_id: typeof q.group_id === 'string' ? q.group_id : undefined,
      limit: typeof q.limit === 'string' ? Number(q.limit) : undefined,
      token: typeof q.token === 'string' ? q.token : undefined,
    });
    res.json(page);
  } catch (error) {
    if (error instanceof HeyGenCatalogError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('HeyGen avatars:', error);
    res.status(500).json({ error: 'Failed to list HeyGen avatars' });
  }
});

router.get('/heygen/avatar-characters', async (req: Request, res: Response) => {
  try {
    const q = req.query;
    const page = await listHeyGenAvatarCharacters({
      apiKeyRef: typeof q.api_key_ref === 'string' ? q.api_key_ref : undefined,
      ownership:
        q.ownership === 'public' || q.ownership === 'private' ? q.ownership : undefined,
      avatar_type:
        q.avatar_type === 'studio_avatar' ||
        q.avatar_type === 'digital_twin' ||
        q.avatar_type === 'photo_avatar'
          ? q.avatar_type
          : undefined,
      limit: typeof q.limit === 'string' ? Number(q.limit) : undefined,
      token: typeof q.token === 'string' ? q.token : undefined,
    });
    res.json(page);
  } catch (error) {
    if (error instanceof HeyGenCatalogError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('HeyGen avatar characters:', error);
    res.status(500).json({ error: 'Failed to list HeyGen avatar characters' });
  }
});

router.get('/heygen/avatar-characters/:group_id/looks', async (req: Request, res: Response) => {
  try {
    const q = req.query;
    const page = await listHeyGenAvatarLooksForGroup({
      apiKeyRef: typeof q.api_key_ref === 'string' ? q.api_key_ref : undefined,
      group_id: req.params.group_id,
      ownership:
        q.ownership === 'public' || q.ownership === 'private' ? q.ownership : undefined,
      limit: typeof q.limit === 'string' ? Number(q.limit) : undefined,
      token: typeof q.token === 'string' ? q.token : undefined,
    });
    res.json(page);
  } catch (error) {
    if (error instanceof HeyGenCatalogError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('HeyGen avatar character looks:', error);
    res.status(500).json({ error: 'Failed to list HeyGen avatar looks for character' });
  }
});

router.get('/heygen/voices', async (req: Request, res: Response) => {
  try {
    const q = req.query;
    const page = await listHeyGenVoices({
      apiKeyRef: typeof q.api_key_ref === 'string' ? q.api_key_ref : undefined,
      type: q.type === 'public' || q.type === 'private' ? q.type : undefined,
      language: typeof q.language === 'string' ? q.language : undefined,
      gender: typeof q.gender === 'string' ? q.gender : undefined,
      limit: typeof q.limit === 'string' ? Number(q.limit) : undefined,
      token: typeof q.token === 'string' ? q.token : undefined,
    });
    res.json(page);
  } catch (error) {
    if (error instanceof HeyGenCatalogError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('HeyGen voices:', error);
    res.status(500).json({ error: 'Failed to list HeyGen voices' });
  }
});

// GET /api/node-engine/heygen/styles — curated Video Agent visual styles
router.get('/heygen/styles', async (req: Request, res: Response) => {
  try {
    const q = req.query;
    const page = await listHeyGenVideoAgentStyles({
      apiKeyRef: typeof q.api_key_ref === 'string' ? q.api_key_ref : undefined,
      tag: typeof q.tag === 'string' ? q.tag : undefined,
      limit: typeof q.limit === 'string' ? Number(q.limit) : undefined,
      token: typeof q.token === 'string' ? q.token : undefined,
    });
    res.json(page);
  } catch (error) {
    if (error instanceof HeyGenCatalogError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('HeyGen styles:', error);
    res.status(500).json({ error: 'Failed to list HeyGen video agent styles' });
  }
});

// ===========================================================================
// Reference Coverage thresholds (Reference Coverage Check). The numeric
// evidence-gate config lives in its OWN global document and is tuned here
// WITHOUT minting any prompt-template version (the coverage-judgment prompt is
// edited separately via /prompt-templates).
// ===========================================================================

/** Require a finite number within [min, max] (inclusive), else 400. */
function requireNumberInRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new NodeEngineValidationError(`${field} must be a number`);
  }
  if (value < min || value > max) {
    throw new NodeEngineValidationError(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

// GET /api/node-engine/reference-coverage-config — current thresholds document
router.get('/reference-coverage-config', (_req: Request, res: Response) => {
  try {
    res.json({ config: getReferenceCoverageConfig() });
  } catch (error) {
    console.error('Error fetching reference-coverage config:', error);
    res.status(500).json({ error: 'Failed to fetch reference-coverage config' });
  }
});

// PUT /api/node-engine/reference-coverage-config — update the numeric thresholds
router.put('/reference-coverage-config', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Accept either { thresholds: {...} } or the four fields at the top level.
    const raw = (body.thresholds ?? body) as Record<string, unknown>;
    const thresholds: ReferenceCoverageThresholds = {
      topK: Math.round(requireNumberInRange(raw.topK, 'topK', 1, 100)),
      relevanceFloor: requireNumberInRange(raw.relevanceFloor, 'relevanceFloor', 0, 1),
      minPassages: Math.round(requireNumberInRange(raw.minPassages, 'minPassages', 1, 100)),
      distributionMin: Math.round(requireNumberInRange(raw.distributionMin, 'distributionMin', 1, 100)),
    };
    const config = await updateReferenceCoverageConfig(thresholds);
    void recordAudit(req, {
      action: 'config.reference_coverage_update',
      category: 'settings',
      entityType: 'reference_coverage_config',
      summary: 'Updated reference coverage thresholds',
      metadata: { thresholds },
    });
    res.json({
      message: 'Reference coverage thresholds updated (no prompt-template version created)',
      config,
    });
  } catch (error) {
    if (error instanceof NodeEngineValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Error updating reference-coverage config:', error);
    res.status(500).json({ error: 'Failed to update reference-coverage config' });
  }
});

// ===========================================================================
// M7 — Node generation (Step 1/2). Generation produces a DRAFT node-set; a human
// must approve it before downstream (M8) use — no auto-proceed (Level 0-1).
// ===========================================================================

// GET /api/node-engine/node-generation-prompt — the active §2.7 generator prompt
router.get('/node-generation-prompt', (_req: Request, res: Response) => {
  try {
    res.json({ prompt: getActiveNodeGenerationPrompt() });
  } catch (error) {
    console.error('Error fetching node-generation prompt:', error);
    res.status(500).json({ error: 'Failed to fetch node-generation prompt' });
  }
});

// PUT /api/node-engine/node-generation-prompt — edit appends a new version (D3)
router.put('/node-generation-prompt', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { system_prompt, task_prompt, output_schema_ref, last_updated_by, change_note } =
      req.body as Record<string, unknown>;
    if (typeof last_updated_by !== 'string' || !last_updated_by.trim()) {
      return res.status(400).json({ error: 'last_updated_by is required' });
    }
    if (typeof change_note !== 'string' || !change_note.trim()) {
      return res.status(400).json({ error: 'change_note is required' });
    }
    const updated = await updateNodeGenerationPrompt({
      system_prompt: typeof system_prompt === 'string' ? system_prompt : undefined,
      task_prompt: typeof task_prompt === 'string' ? task_prompt : undefined,
      output_schema_ref: typeof output_schema_ref === 'string' ? output_schema_ref : undefined,
      last_updated_by,
      change_note,
    });
    void recordAudit(req, {
      action: 'config.node_generation_prompt_update',
      category: 'settings',
      entityType: 'node_generation_prompt',
      summary: 'Updated node-generation prompt (new version)',
      metadata: { change_note },
    });
    res.json({ message: 'Node-generation prompt updated (new version created)', prompt: updated });
  } catch (error) {
    console.error('Error updating node-generation prompt:', error);
    res.status(500).json({ error: 'Failed to update node-generation prompt' });
  }
});

// POST /api/node-engine/courses/:courseCode/subtopics/:subtopicId/node-set — generate
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/node-set',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const nodeSet = await generateNodeSet(courseCode, subtopicId, {
        ground: body.ground !== false,
        persist: body.persist !== false,
        persistGraph: body.persistGraph === true,
        approvedMisconceptionRegistry: Array.isArray(body.approvedMisconceptionRegistry)
          ? (body.approvedMisconceptionRegistry as never)
          : undefined,
      });
      res.json({ message: 'Node-set generated (draft — requires approval)', node_set: nodeSet });
    } catch (error) {
      console.error('Error generating node-set:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate node-set' });
    }
  }
);

// GET /api/node-engine/courses/:courseCode/subtopics/:subtopicId/node-set — read
router.get('/courses/:courseCode/subtopics/:subtopicId/node-set', async (req: Request, res: Response) => {
  try {
    const { courseCode, subtopicId } = req.params;
    const nodeSet = await getNodeSet(courseCode, subtopicId);
    if (!nodeSet) {
      return res.status(404).json({ error: `No node-set for ${courseCode}/${subtopicId}` });
    }
    res.json({ node_set: nodeSet });
  } catch (error) {
    console.error('Error fetching node-set:', error);
    res.status(500).json({ error: 'Failed to fetch node-set' });
  }
});

// POST /api/node-engine/courses/:courseCode/subtopics/:subtopicId/node-set/approve
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/node-set/approve',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const approver = typeof body.approver === 'string' ? body.approver : '';
      if (!approver.trim()) {
        return res.status(400).json({ error: 'approver is required' });
      }
      const nodeIds = Array.isArray(body.nodeIds)
        ? (body.nodeIds.filter((x) => typeof x === 'string') as string[])
        : undefined;
      const overrideReason = typeof body.overrideReason === 'string' ? body.overrideReason : undefined;
      const nodeSet = await approveNodeSet(courseCode, subtopicId, { approver, nodeIds, overrideReason });
      void recordAudit(req, {
        action: 'node_set.approve',
        category: 'approval',
        entityType: 'node_set',
        entityId: `${courseCode}/${subtopicId}`,
        courseCode,
        summary: `Approved node-set for ${courseCode}/${subtopicId}`,
        metadata: { approver, nodeCount: nodeIds?.length, override: !!overrideReason },
      });
      res.json({ message: 'Node-set approval updated', node_set: nodeSet });
    } catch (error) {
      if (error instanceof AcademicApprovalRequiredError) {
        // 422: caller must attach grounding or supply an override reason.
        return res.status(422).json({ error: error.message, academic_approval_required: true });
      }
      console.error('Error approving node-set:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to approve node-set' });
    }
  }
);

// PATCH /api/node-engine/courses/:courseCode/subtopics/:subtopicId/node-set/nodes/:nodeId
router.patch(
  '/courses/:courseCode/subtopics/:subtopicId/node-set/nodes/:nodeId',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const nodeSet = await updateNodeProse(courseCode, subtopicId, nodeId, {
        knowledge_component: typeof body.knowledge_component === 'string' ? body.knowledge_component : undefined,
        mastery_statement: typeof body.mastery_statement === 'string' ? body.mastery_statement : undefined,
        why_it_matters: typeof body.why_it_matters === 'string' ? body.why_it_matters : undefined,
        assessment_connection:
          typeof body.assessment_connection === 'string' ? body.assessment_connection : undefined,
        candidate_misconceptions: Array.isArray(body.candidate_misconceptions)
          ? (body.candidate_misconceptions as never)
          : undefined,
      });
      res.json({ message: 'Node prose updated', node_set: nodeSet });
    } catch (error) {
      console.error('Error updating node prose:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update node' });
    }
  }
);

// POST /api/node-engine/courses/:courseCode/subtopics/:subtopicId/node-set/nodes/:nodeId/regenerate
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/node-set/nodes/:nodeId/regenerate',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const nodeSet = await regenerateSingleNode(courseCode, subtopicId, nodeId, {
        acknowledgeReplaceEdits: body.acknowledgeReplaceEdits === true,
      });
      res.json({ message: 'Node regenerated', node_set: nodeSet });
    } catch (error) {
      if (error instanceof NodeEditConflictError) {
        return res.status(409).json({
          error: error.message,
          manual_edits_present: true,
        });
      }
      console.error('Error regenerating node:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to regenerate node' });
    }
  }
);

// POST /api/node-engine/courses/:courseCode/subtopics/:subtopicId/node-set/reopen
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/node-set/reopen',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId } = req.params;
      const nodeSet = await reopenNodeSet(courseCode, subtopicId);
      res.json({ message: 'Node-set reopened for review', node_set: nodeSet });
    } catch (error) {
      console.error('Error reopening node-set:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to reopen node-set' });
    }
  }
);

// ===========================================================================
// M8 — Node Experience Blueprint (Level 1). One blueprint per approved node.
// ===========================================================================

// GET /api/node-engine/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/blueprint
router.get(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/blueprint',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId } = req.params;
      const blueprint = await getBlueprint(courseCode, subtopicId, nodeId);
      if (!blueprint) {
        return res.status(404).json({ error: `No blueprint for node "${nodeId}"` });
      }
      res.json({ blueprint });
    } catch (error) {
      console.error('Error fetching blueprint:', error);
      res.status(500).json({ error: 'Failed to fetch blueprint' });
    }
  }
);

// POST /api/node-engine/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/blueprint
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/blueprint',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const blueprint = await generateBlueprint(courseCode, subtopicId, nodeId, {
        persist: body.persist !== false,
      });
      res.json({ message: 'Experience blueprint generated (draft — requires approval)', blueprint });
    } catch (error) {
      if (error instanceof BlueprintNodeNotApprovedError) {
        return res.status(422).json({ error: error.message, node_not_approved: true });
      }
      if (error instanceof BlueprintValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Error generating blueprint:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate blueprint' });
    }
  }
);

// PATCH /api/node-engine/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/blueprint
router.patch(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/blueprint',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const objects = Array.isArray(body.objects) ? (body.objects as never) : [];
      if (objects.length === 0) {
        return res.status(400).json({ error: 'objects[] patch array is required' });
      }
      const blueprint = await updateBlueprint(courseCode, subtopicId, nodeId, objects);
      res.json({ message: 'Blueprint updated', blueprint });
    } catch (error) {
      if (error instanceof BlueprintValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Error updating blueprint:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update blueprint' });
    }
  }
);

// POST /api/node-engine/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/blueprint/approve
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/blueprint/approve',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const approver = typeof body.approver === 'string' ? body.approver : '';
      if (!approver.trim()) {
        return res.status(400).json({ error: 'approver is required' });
      }
      const blueprint = await approveBlueprint(courseCode, subtopicId, nodeId, approver);
      res.json({ message: 'Blueprint approved', blueprint });
    } catch (error) {
      if (error instanceof BlueprintValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Error approving blueprint:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to approve blueprint' });
    }
  }
);

// POST /api/node-engine/courses/:courseCode/blueprints/hydrate — batch read
router.post('/courses/:courseCode/blueprints/hydrate', async (req: Request, res: Response) => {
  try {
    const { courseCode } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const refs = Array.isArray(body.nodes)
      ? (body.nodes as Array<{ subtopicId?: string; nodeId?: string }>)
          .filter((r) => typeof r.subtopicId === 'string' && typeof r.nodeId === 'string')
          .map((r) => ({ subtopicId: r.subtopicId as string, nodeId: r.nodeId as string }))
      : [];
    const blueprints = await getBlueprintsForNodes(courseCode, refs);
    res.json({ blueprints });
  } catch (error) {
    console.error('Error hydrating blueprints:', error);
    res.status(500).json({ error: 'Failed to hydrate blueprints' });
  }
});

// ===========================================================================
// M9 — Learning Object Content Specification (Level 2). One spec per blueprint object.
// ===========================================================================

// GET /api/node-engine/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/content-specs
router.get(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/content-specs',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId } = req.params;
      const specs = await getContentSpecsForNode(courseCode, subtopicId, nodeId);
      res.json({ specs });
    } catch (error) {
      console.error('Error fetching content specs:', error);
      res.status(500).json({ error: 'Failed to fetch content specs' });
    }
  }
);

// GET /api/node-engine/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/content-spec
router.get(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/content-spec',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId, objectId } = req.params;
      const spec = await getContentSpec(courseCode, subtopicId, nodeId, objectId);
      if (!spec) {
        return res.status(404).json({ error: `No content spec for object "${objectId}"` });
      }
      res.json({ spec });
    } catch (error) {
      console.error('Error fetching content spec:', error);
      res.status(500).json({ error: 'Failed to fetch content spec' });
    }
  }
);

// POST /api/node-engine/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/content-specs
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/content-specs',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const objectId = typeof body.object_id === 'string' ? body.object_id : undefined;
      const specs = await generateContentSpecs(courseCode, subtopicId, nodeId, {
        persist: body.persist !== false,
        objectId,
      });
      res.json({
        message: objectId
          ? 'Content spec generated (draft — requires approval)'
          : 'Content specs generated (draft — require approval)',
        specs,
      });
    } catch (error) {
      if (error instanceof ContentSpecBlueprintNotApprovedError) {
        return res.status(422).json({ error: error.message, blueprint_not_approved: true });
      }
      if (error instanceof ContentSpecValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Error generating content specs:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate content specs' });
    }
  }
);

// PATCH /api/node-engine/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/content-spec
router.patch(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/content-spec',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId, objectId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const spec = await updateContentSpec(courseCode, subtopicId, nodeId, objectId, {
        title: typeof body.title === 'string' ? body.title : undefined,
        required_explanation:
          typeof body.required_explanation === 'string' ? body.required_explanation : undefined,
        preservation_rules: Array.isArray(body.preservation_rules)
          ? (body.preservation_rules as string[])
          : undefined,
        grounding_note: typeof body.grounding_note === 'string' ? body.grounding_note : undefined,
      });
      res.json({ message: 'Content spec updated', spec });
    } catch (error) {
      if (error instanceof ContentSpecValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Error updating content spec:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update content spec' });
    }
  }
);

// POST /api/node-engine/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/content-spec/ground
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/content-spec/ground',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId, objectId } = req.params;
      const spec = await groundContentSpec(courseCode, subtopicId, nodeId, objectId);
      res.json({ message: 'Content spec re-grounded from node references', spec });
    } catch (error) {
      if (error instanceof ContentSpecValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Error grounding content spec:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to ground content spec' });
    }
  }
);

// POST /api/node-engine/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/content-spec/approve
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/content-spec/approve',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId, objectId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const approver = typeof body.approver === 'string' ? body.approver : '';
      if (!approver.trim()) {
        return res.status(400).json({ error: 'approver is required' });
      }
      const spec = await approveContentSpec(courseCode, subtopicId, nodeId, objectId, approver);
      res.json({ message: 'Content spec approved', spec });
    } catch (error) {
      if (error instanceof ContentSpecValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Error approving content spec:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to approve content spec' });
    }
  }
);

// POST /api/node-engine/courses/:courseCode/content-specs/hydrate — batch read
router.post('/courses/:courseCode/content-specs/hydrate', async (req: Request, res: Response) => {
  try {
    const { courseCode } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const refs = Array.isArray(body.nodes)
      ? (body.nodes as Array<{ subtopicId?: string; nodeId?: string }>)
          .filter((r) => typeof r.subtopicId === 'string' && typeof r.nodeId === 'string')
          .map((r) => ({ subtopicId: r.subtopicId as string, nodeId: r.nodeId as string }))
      : [];
    const specs = await getContentSpecsForNodes(courseCode, refs);
    res.json({ specs });
  } catch (error) {
    console.error('Error hydrating content specs:', error);
    res.status(500).json({ error: 'Failed to hydrate content specs' });
  }
});

// ===========================================================================
// M10 — Modality Production (Level 3). Phase A: text production only.
// ===========================================================================

// GET /api/node-engine/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/produced
router.get(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/produced',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId, objectId } = req.params;
      const produced = await getProducedObject(courseCode, subtopicId, nodeId, objectId);
      if (!produced) {
        return res.status(404).json({ error: `No produced object for "${objectId}"` });
      }
      res.json({ produced });
    } catch (error) {
      console.error('Error fetching produced object:', error);
      res.status(500).json({ error: 'Failed to fetch produced object' });
    }
  }
);

// POST /api/node-engine/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/produce-text
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/produce-text',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId, objectId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const produced = await produceTextObject(courseCode, subtopicId, nodeId, objectId, {
        persist: body.persist !== false,
        useDeterministicProjection: body.use_deterministic_projection === true,
      });
      res.json({
        message: 'Text learning object produced (recommended SME review before publish)',
        produced,
      });
    } catch (error) {
      if (error instanceof ContentSpecNotApprovedError) {
        return res.status(422).json({ error: error.message, content_spec_not_approved: true });
      }
      if (error instanceof TextProductionError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Error producing text object:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to produce text object' });
    }
  }
);

// POST .../produce-video-brief — Phase B: HeyGen-ready video brief (no render yet)
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/produce-video-brief',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId, objectId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const overrideRaw = body.render_style_override;
      const renderStyleOverride =
        overrideRaw === 'studio_direct' ||
        overrideRaw === 'video_agent_produced' ||
        overrideRaw === 'inherit'
          ? overrideRaw
          : undefined;
      const produced = await produceVideoBriefObject(courseCode, subtopicId, nodeId, objectId, {
        persist: body.persist !== false,
        useDeterministicProjection: body.use_deterministic_projection === true,
        ...(renderStyleOverride ? { renderStyleOverride } : {}),
      });
      res.json({
        message: 'Video brief produced — HeyGen prompt ready (render when API connected)',
        produced,
      });
    } catch (error) {
      if (error instanceof VideoContentSpecNotApprovedError) {
        return res.status(422).json({ error: error.message, content_spec_not_approved: true });
      }
      if (error instanceof VideoBriefProductionError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Error producing video brief:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to produce video brief',
      });
    }
  }
);

// POST .../produce-structured-visual — semantic visual spec (platform renders it)
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/produce-structured-visual',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId, objectId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const smeFeedback = typeof body.sme_feedback === 'string' ? body.sme_feedback : undefined;
      const produced = await produceStructuredVisualObject(courseCode, subtopicId, nodeId, objectId, {
        persist: body.persist !== false,
        useDeterministicProjection: body.use_deterministic_projection === true,
        ...(smeFeedback ? { smeFeedback } : {}),
      });
      res.json({
        message: smeFeedback
          ? 'Structured visual regenerated with SME feedback (recommended SME review before publish)'
          : 'Structured visual produced (recommended SME review before publish)',
        produced,
      });
    } catch (error) {
      if (error instanceof StructuredVisualContentSpecNotApprovedError) {
        return res.status(422).json({ error: error.message, content_spec_not_approved: true });
      }
      if (error instanceof StructuredVisualProductionError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Error producing structured visual:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to produce structured visual',
      });
    }
  }
);

// PUT .../structured-visual — persist SME edits to the governed structured visual JSON
router.put(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/structured-visual',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId, objectId } = req.params;
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!body.visual || typeof body.visual !== 'object') {
        return res.status(400).json({ error: 'Request body must include a "visual" object.' });
      }
      const produced = await saveStructuredVisualEdits(
        courseCode,
        subtopicId,
        nodeId,
        objectId,
        body.visual,
        { approve: body.approve === true }
      );
      res.json({
        message: body.approve === true ? 'Structured visual approved' : 'Structured visual edits saved',
        produced,
      });
    } catch (error) {
      if (error instanceof StructuredVisualProductionError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof NodeEngineValidationError) {
        return res.status(422).json({ error: error.message });
      }
      console.error('Error saving structured visual edits:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to save structured visual edits',
      });
    }
  }
);

// POST .../render-video — Phase C: HeyGen Direct Video (script + settings)
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/render-video',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId, objectId } = req.params;
      const produced = await submitVideoRenderForObject(
        courseCode,
        subtopicId,
        nodeId,
        objectId
      );
      const ms = produced.envelope.modality_specific ?? {};
      res.json({
        message:
          ms.render_mock === true
            ? 'Mock render complete (set HEYGEN_API_KEY + avatar/voice for live HeyGen)'
            : 'HeyGen render submitted — poll refresh until complete',
        produced,
      });
    } catch (error) {
      if (error instanceof VideoRenderError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Error rendering video:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to render video',
      });
    }
  }
);

// POST .../render-video/refresh — poll HeyGen status and update produced object
router.post(
  '/courses/:courseCode/subtopics/:subtopicId/nodes/:nodeId/objects/:objectId/render-video/refresh',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, subtopicId, nodeId, objectId } = req.params;
      const produced = await refreshVideoRenderForObject(
        courseCode,
        subtopicId,
        nodeId,
        objectId
      );
      res.json({ message: 'HeyGen render status refreshed', produced });
    } catch (error) {
      if (error instanceof VideoRenderError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Error refreshing video render:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to refresh video render',
      });
    }
  }
);

// GET .../video — stream Maestro-stored produced video for SME in-app review
router.get(
  '/courses/:courseCode/objects/:objectId/video',
  async (req: Request, res: Response) => {
    try {
      const { courseCode, objectId } = req.params;
      const filePath = resolveStoredProducedVideoPath(courseCode, objectId);
      if (!filePath) {
        return res.status(404).json({
          error: 'Video not ingested into Maestro yet — refresh render status after HeyGen completes.',
        });
      }
      streamProducedVideoFile(filePath, req, res);
    } catch (error) {
      console.error('Error streaming produced video:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to stream video',
      });
    }
  }
);

// POST /api/node-engine/courses/:courseCode/produced-objects/hydrate — batch read by object_id
router.post('/courses/:courseCode/produced-objects/hydrate', async (req: Request, res: Response) => {
  try {
    const { courseCode } = req.params;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const objectIds = Array.isArray(body.object_ids)
      ? (body.object_ids as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];
    const produced = await getProducedObjectsForNodes(courseCode, objectIds);
    res.json({ produced });
  } catch (error) {
    console.error('Error hydrating produced objects:', error);
    res.status(500).json({ error: 'Failed to hydrate produced objects' });
  }
});

export default router;
