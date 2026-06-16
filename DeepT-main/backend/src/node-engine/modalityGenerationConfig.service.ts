/**
 * Modality Generation Config service (Phase 0 model-config addition).
 *
 * Manages the per-vehicle model/generation config stored in its OWN global
 * document (`config/modality-generation-config.json`), mirroring the
 * prompt-template registry pattern (lazy seed + cache). This document is
 * INDEPENDENT of the prompt-template registry: updating model config here never
 * mints a prompt-template version (D3).
 *
 * `resolvedModelForVehicle` applies the binding resolution order:
 *   (1) active PromptTemplate version modelOverride
 *   (2) this modality config (singleModel / council set)
 *   (3) the node-engine global default model  ← always resolves
 */
import {
  parseModalityGenerationConfig,
  resolveGenerationModel,
  NodeEngineValidationError,
  VEHICLES,
  type ModalityGenerationConfig,
  type ModalityGenerationConfigFile,
  type ResolvedGenerationModel,
  type Vehicle,
} from '../models/nodeEngine.js';
import { defaultModalityGenerationConfigs } from '../config/modalityGeneration.defaults.js';
import {
  readModalityGenerationConfig,
  writeModalityGenerationConfig,
} from './store.service.js';
import { getActiveTemplateForVehicle } from './promptTemplateRegistry.service.js';
import { getNodeEngineDefaultModel } from '../config.js';

let cachedConfig: ModalityGenerationConfigFile | null = null;

function buildSeedConfig(): ModalityGenerationConfigFile {
  const configs = defaultModalityGenerationConfigs.map((c) => parseModalityGenerationConfig(c));
  return {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    configs,
  };
}

/** Load the config document, seeding + persisting it on first run. Cached. */
function getConfigFile(): ModalityGenerationConfigFile {
  if (cachedConfig) return cachedConfig;

  const existing = readModalityGenerationConfig();
  if (existing && Array.isArray(existing.configs) && existing.configs.length > 0) {
    cachedConfig = existing;
    return existing;
  }

  const seeded = buildSeedConfig();
  writeModalityGenerationConfig(seeded);
  cachedConfig = seeded;
  return seeded;
}

export function clearModalityConfigCache(): void {
  cachedConfig = null;
}

/** All per-vehicle modality configs. */
export function getConfigs(): ModalityGenerationConfig[] {
  return getConfigFile().configs;
}

/** One vehicle's modality config (undefined if the vehicle is not seeded). */
export function getConfigForVehicle(vehicle: Vehicle): ModalityGenerationConfig | undefined {
  return getConfigFile().configs.find((c) => c.vehicle === vehicle);
}

/** Editable fields on a modality config (id/vehicle/generatorKind are not user-editable). */
export type ModalityGenerationConfigUpdate = Partial<
  Pick<
    ModalityGenerationConfig,
    | 'mode'
    | 'singleModel'
    | 'councilModels'
    | 'chairmanModel'
    | 'defaultTemperature'
    | 'defaultMaxTokens'
    | 'modelSelectionReason'
    | 'productionTarget'
    | 'videoSettings'
    | 'enabled'
  >
>;

/**
 * Update a single vehicle's model/generation config. Saves to its OWN document
 * ONLY — it does NOT touch the prompt-template registry, so no prompt version is
 * minted. Returns the updated, re-validated config.
 */
export function updateConfigForVehicle(
  vehicle: Vehicle,
  update: ModalityGenerationConfigUpdate
): ModalityGenerationConfig {
  const file = getConfigFile();
  const index = file.configs.findIndex((c) => c.vehicle === vehicle);
  if (index === -1) {
    throw new NodeEngineValidationError(`Unknown vehicle for modality config: ${vehicle}`);
  }

  const current = file.configs[index];
  // Re-validate the merged record through the parser (enforces enums/types).
  const merged = parseModalityGenerationConfig({ ...current, ...update });

  file.configs[index] = merged;
  file.updated_at = new Date().toISOString();
  writeModalityGenerationConfig(file);
  cachedConfig = file;
  return merged;
}

/**
 * Resolve the model for a vehicle using the binding order: active template
 * version override → modality config → global default. Step (3) always resolves.
 */
export function resolvedModelForVehicle(vehicle: Vehicle): ResolvedGenerationModel {
  const activeTemplate = getActiveTemplateForVehicle(vehicle) ?? null;
  const modalityConfig = getConfigForVehicle(vehicle) ?? null;
  return resolveGenerationModel({
    templateVersion: activeTemplate,
    modalityConfig,
    globalDefaultModel: getNodeEngineDefaultModel(),
  });
}

/** Convenience: every vehicle + its resolved model/source (for the GET-all route). */
export function getConfigsWithResolution(): {
  globalDefaultModel: string;
  configs: Array<{ config: ModalityGenerationConfig; resolved: ResolvedGenerationModel }>;
} {
  const globalDefaultModel = getNodeEngineDefaultModel();
  const configs = getConfigs().map((config) => ({
    config,
    resolved: resolvedModelForVehicle(config.vehicle),
  }));
  return { globalDefaultModel, configs };
}

/** Exposed for completeness / future callers that iterate the full vehicle set. */
export const ALL_VEHICLES = VEHICLES;
