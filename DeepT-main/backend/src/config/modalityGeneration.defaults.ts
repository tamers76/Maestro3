/**
 * Default seed for the per-vehicle Modality Generation config (Phase 0 model-config addition).
 *
 * One ModalityGenerationConfig per V1 vehicle (7 entries; simulation reserved &
 * disabled). These are CONFIGURABLE defaults — they intentionally leave
 * `singleModel` UNDEFINED so each vehicle falls back to the node-engine global
 * default model (resolveGenerationModel step 3) until an operator pins one. No
 * model name is hard-coded into a generation service; the recommended V1 model
 * INTENT is encoded as human-readable text in `modelSelectionReason` /
 * `productionTarget` so it is auditable and editable in the UI.
 *
 * `taskPrompt` is left empty here — it MIRRORS the active prompt-template body
 * for display only and is hydrated from the registry at read time. Editing model
 * config in this document never mints a prompt-template version (D3).
 */
import type { ModalityGenerationConfig } from '../models/nodeEngine.js';
import { heygenApprovedAvatarsDefaults } from '../config/heygenApprovedAvatars.defaults.js';

export const defaultModalityGenerationConfigs: ModalityGenerationConfig[] = [
  {
    id: 'modality_text',
    vehicle: 'text',
    generatorKind: 'chat',
    mode: 'single',
    taskPrompt: '',
    enabled: true,
    modelSelectionReason:
      'Falls back to the system default chat/reasoning model. Configurable per deployment.',
    productionTarget: 'System default chat/reasoning model (text rendering).',
  },
  {
    id: 'modality_structured_visual',
    vehicle: 'structured_visual',
    generatorKind: 'chat',
    mode: 'single',
    taskPrompt: '',
    enabled: true,
    modelSelectionReason:
      'Prefer a model strong at structured JSON / semantic organization. Configurable; defaults to global default.',
    productionTarget: 'Model strong at structured JSON / semantic organization.',
  },
  {
    id: 'modality_pictorial_visual',
    vehicle: 'pictorial_visual',
    generatorKind: 'image',
    mode: 'single',
    taskPrompt: '',
    enabled: true,
    modelSelectionReason:
      'A chat model writes the image brief (real image generation is MOCKED in V1). Configurable; defaults to global default.',
    productionTarget: 'Chat model that writes the image brief (image gen mocked).',
  },
  {
    id: 'modality_video',
    vehicle: 'video',
    generatorKind: 'video',
    mode: 'single',
    taskPrompt: '',
    enabled: true,
    modelSelectionReason:
      'Prefer a model strong at narration / brief writing (HeyGen production is MOCKED in V1). Configurable; defaults to global default.',
    productionTarget: 'Model strong at narration / brief writing (HeyGen mocked).',
    // HeyGen v3 render-settings placeholder (POST /v3/videos shape). Real render
    // is MOCKED in V1; avatar_id/voice_id come from the HeyGen account (mocked),
    // so they are left undefined. apiKeyRef names the env/setting holding the key
    // — never the key value. No style_id/brand_kit_id (deferred v2 Template API).
    videoSettings: {
      provider: 'heygen',
      apiKeyRef: 'HEYGEN_API_KEY',
      engine: 'avatar_iv',
      resolution: '1080p',
      aspect_ratio: 'auto',
      output_format: 'mp4',
      remove_background: false,
      approved_avatars: heygenApprovedAvatarsDefaults,
      // Video Agent (Produced) is the course-wide default; Layer 4 can override per object.
      video_render_style: 'video_agent_produced',
      narration_fidelity: 'moderate',
      orientation: 'landscape',
      target_duration_seconds: 180,
      brand_kit: {
        enabled: false,
        primaryColor: '#1E40AF',
        secondaryColor: '#0F172A',
        accentColor: '#38BDF8',
        fontFamily: 'Inter',
        mediaTypeGuidance:
          'Use motion graphics for data, structure, and key terms. Use stock or AI visuals only for context that supports the approved narration — never to introduce new facts.',
      },
    },
  },
  {
    id: 'modality_interactive',
    vehicle: 'interactive',
    generatorKind: 'chat',
    mode: 'single',
    taskPrompt: '',
    enabled: true,
    modelSelectionReason:
      'Use the strongest reasoning model available. Configurable; defaults to global default.',
    productionTarget: 'Strongest reasoning model available.',
  },
  {
    id: 'modality_learning_anchor',
    vehicle: 'learning_anchor',
    generatorKind: 'chat',
    mode: 'single',
    taskPrompt: '',
    enabled: true,
    modelSelectionReason:
      'Prefer a model strong at safe, bounded learner-facing tone. Configurable; defaults to global default.',
    productionTarget: 'Model strong at safe, bounded learner-facing tone.',
  },
  {
    // Reserved/deferred per §8.14 — disabled in V1 so the document covers every vehicle.
    id: 'modality_simulation',
    vehicle: 'simulation',
    generatorKind: 'chat',
    mode: 'single',
    taskPrompt: '',
    enabled: false,
    modelSelectionReason: 'Reserved/deferred in V1. Not activated.',
    productionTarget: 'Reserved/deferred (simulation not activated in V1).',
  },
];
