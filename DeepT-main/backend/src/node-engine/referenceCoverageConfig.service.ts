/**
 * Reference Coverage Config service (Reference Coverage Check).
 *
 * Manages the numeric evidence-gate thresholds stored in their OWN global
 * document (`config/reference-coverage-config.json` → app_config key
 * `reference_coverage_config`). Mirrors the cached-sync-getter + async-hydrate +
 * versioned-doc pattern of `modalityGenerationConfig.service.ts`: a sync getter
 * reads a cache that is hydrated from Postgres at boot (seeding + persisting on
 * first run), with a deterministic in-code seed fallback so the getter never
 * returns empty.
 *
 * This document is INDEPENDENT of the coverage-judgment prompt and of every
 * generation config — tuning thresholds here never mints a prompt version.
 */
import {
  parseReferenceCoverageConfig,
  type ReferenceCoverageConfigFile,
  type ReferenceCoverageThresholds,
} from '../models/nodeEngine.js';
import { defaultReferenceCoverageThresholds } from '../config/referenceCoverage.defaults.js';
import {
  readReferenceCoverageConfig,
  writeReferenceCoverageConfig,
} from './store.service.js';

let cachedConfig: ReferenceCoverageConfigFile | null = null;

function buildSeedConfig(): ReferenceCoverageConfigFile {
  return parseReferenceCoverageConfig({
    schema_version: 1,
    updated_at: new Date().toISOString(),
    thresholds: { ...defaultReferenceCoverageThresholds },
  });
}

/** Hydrate the cache from Postgres at startup, seeding + persisting on first run. */
export async function hydrateReferenceCoverageConfig(): Promise<ReferenceCoverageConfigFile> {
  const existing = await readReferenceCoverageConfig();
  if (existing && existing.thresholds) {
    const validated = parseReferenceCoverageConfig(existing);
    cachedConfig = validated;
    return validated;
  }
  const seeded = buildSeedConfig();
  await writeReferenceCoverageConfig(seeded);
  cachedConfig = seeded;
  return seeded;
}

/** The config document (cache-backed, synchronous). Falls back to the in-code seed. */
function getConfigFile(): ReferenceCoverageConfigFile {
  if (cachedConfig) return cachedConfig;
  const seeded = buildSeedConfig();
  cachedConfig = seeded;
  return seeded;
}

export function clearReferenceCoverageConfigCache(): void {
  cachedConfig = null;
}

/** The current coverage evidence-gate thresholds (sync, cache-backed). */
export function getReferenceCoverageThresholds(): ReferenceCoverageThresholds {
  return getConfigFile().thresholds;
}

/** The full coverage-config document (thresholds + version + updated_at). */
export function getReferenceCoverageConfig(): ReferenceCoverageConfigFile {
  return getConfigFile();
}

/**
 * Persist new evidence-gate thresholds, bumping `updated_at` and refreshing the
 * sync cache (so `getReferenceCoverageThresholds()` reflects the change at once).
 * Validation of numeric shape is done by `parseReferenceCoverageConfig`; callers
 * (the route) enforce the sensible operating ranges before calling this.
 */
export async function updateReferenceCoverageConfig(
  thresholds: ReferenceCoverageThresholds
): Promise<ReferenceCoverageConfigFile> {
  const file = parseReferenceCoverageConfig({
    schema_version: 1,
    updated_at: new Date().toISOString(),
    thresholds,
  });
  await writeReferenceCoverageConfig(file);
  cachedConfig = file;
  return file;
}
