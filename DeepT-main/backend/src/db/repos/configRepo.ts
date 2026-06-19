/**
 * Singleton config-document repository over `app_config` (replaces config/*.json
 * for app_settings, prompt templates, modality generation config, node generation
 * prompt). Each document is stored under a stable string key.
 */
import { eq, sql } from 'drizzle-orm';
import { appConfig } from '../schema/artifacts.js';
import { exec, type Executor } from './_exec.js';

export const CONFIG_KEYS = {
  appSettings: 'app_settings',
  promptTemplates: 'prompt_templates',
  modalityGenerationConfig: 'modality_generation_config',
  nodeGenerationPrompt: 'node_generation_prompt',
  referenceCoverageConfig: 'reference_coverage_config',
} as const;

export async function get<T = unknown>(key: string, tx?: Executor): Promise<T | null> {
  const rows = await exec(tx).select({ data: appConfig.data }).from(appConfig).where(eq(appConfig.key, key)).limit(1);
  return (rows[0]?.data as T) ?? null;
}

export async function set(key: string, data: unknown, tx?: Executor): Promise<void> {
  await exec(tx)
    .insert(appConfig)
    .values({ key, data: data as object, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appConfig.key, set: { data: sql`excluded.data`, updatedAt: new Date() } });
}
