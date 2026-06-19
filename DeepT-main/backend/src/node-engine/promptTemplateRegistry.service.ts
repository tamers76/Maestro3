/**
 * Prompt Template Registry service (M2 / §8.14).
 *
 * Versioning contract (D3):
 * - each `(prompt_template_id, version)` is an immutable record;
 * - a registry entry keeps an append-only `versions[]` plus an `active_version`
 *   pointer; editing a template appends a NEW version and moves the pointer —
 *   it never mutates a published version;
 * - only `approved` versions are selectable as active for production.
 *
 * The registry is seeded once from `promptTemplates.defaults.ts` (mirroring how
 * `settings.json` is seeded) and persisted to `config/prompt-templates.json`.
 */
import {
  parsePromptTemplate,
  NodeEngineValidationError,
  type PromptTemplate,
  type PromptTemplateRegistryEntry,
  type PromptTemplateRegistryFile,
  type Vehicle,
} from '../models/nodeEngine.js';
import { defaultPromptTemplates } from '../config/promptTemplates.defaults.js';
import { readPromptTemplateRegistry, writePromptTemplateRegistry } from './store.service.js';

let cachedRegistry: PromptTemplateRegistryFile | null = null;

function buildSeedRegistry(): PromptTemplateRegistryFile {
  const templates: PromptTemplateRegistryEntry[] = defaultPromptTemplates.map((tpl) => {
    const validated = parsePromptTemplate(tpl);
    return {
      prompt_template_id: validated.prompt_template_id,
      vehicle: validated.vehicle,
      active_version: validated.version,
      versions: [validated],
    };
  });
  return {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    templates,
  };
}

/**
 * Hydrate the in-memory cache from Postgres at startup, seeding + persisting on
 * first run. Call once during boot; the sync getters below read the cache.
 */
export async function hydrateRegistry(): Promise<PromptTemplateRegistryFile> {
  const existing = await readPromptTemplateRegistry();
  if (existing && Array.isArray(existing.templates) && existing.templates.length > 0) {
    // Append-only top-up: a seed template added AFTER this DB was first seeded
    // (e.g. a newly-introduced vehicle/judgment prompt) must still appear. We add
    // ONLY ids that are missing — existing entries and their immutable version
    // history are never mutated, so this is safe to run on every boot.
    const present = new Set(existing.templates.map((t) => t.prompt_template_id));
    const missing = defaultPromptTemplates.filter((tpl) => !present.has(tpl.prompt_template_id));
    if (missing.length > 0) {
      for (const tpl of missing) {
        const validated = parsePromptTemplate(tpl);
        existing.templates.push({
          prompt_template_id: validated.prompt_template_id,
          vehicle: validated.vehicle,
          active_version: validated.version,
          versions: [validated],
        });
      }
      existing.updated_at = new Date().toISOString();
      await writePromptTemplateRegistry(existing);
    }
    cachedRegistry = existing;
    return existing;
  }
  const seeded = buildSeedRegistry();
  await writePromptTemplateRegistry(seeded);
  cachedRegistry = seeded;
  return seeded;
}

/**
 * The registry (cache-backed, synchronous). Falls back to the in-code seed if the
 * cache has not been hydrated yet (deterministic; persistence happens via hydrate
 * at boot or via updateTemplate).
 */
export function getRegistry(): PromptTemplateRegistryFile {
  if (cachedRegistry) return cachedRegistry;
  const seeded = buildSeedRegistry();
  cachedRegistry = seeded;
  return seeded;
}

export function clearRegistryCache(): void {
  cachedRegistry = null;
}

function findEntry(registry: PromptTemplateRegistryFile, templateId: string): PromptTemplateRegistryEntry | undefined {
  return registry.templates.find((t) => t.prompt_template_id === templateId);
}

/** List the active version of every template. */
export function listActiveTemplates(): PromptTemplate[] {
  const registry = getRegistry();
  return registry.templates
    .map((entry) => getActiveVersion(entry.prompt_template_id))
    .filter((t): t is PromptTemplate => t !== undefined);
}

/** Full registry entry (all versions + active pointer) for one template. */
export function getTemplateEntry(templateId: string): PromptTemplateRegistryEntry | undefined {
  return findEntry(getRegistry(), templateId);
}

/** A specific immutable version of a template. */
export function getTemplateVersion(templateId: string, version: number): PromptTemplate | undefined {
  const entry = getTemplateEntry(templateId);
  return entry?.versions.find((v) => v.version === version);
}

/** The active version of a template (by id). */
export function getActiveVersion(templateId: string): PromptTemplate | undefined {
  const entry = getTemplateEntry(templateId);
  if (!entry) return undefined;
  return entry.versions.find((v) => v.version === entry.active_version);
}

/** The active template for a given vehicle (the production lookup). */
export function getActiveTemplateForVehicle(vehicle: Vehicle): PromptTemplate | undefined {
  const registry = getRegistry();
  const entry = registry.templates.find((t) => t.vehicle === vehicle);
  return entry ? getActiveVersion(entry.prompt_template_id) : undefined;
}

export interface UpdateTemplateInput {
  task_prompt?: string;
  output_schema_ref?: unknown;
  member_system_prompt?: string;
  chairman_system_prompt?: string;
  status?: PromptTemplate['status'];
  last_updated_by: string;
  change_note: string;
}

/**
 * Edit a template by appending a NEW immutable version (current active + 1) and
 * moving the active pointer to it. The previous version is preserved untouched.
 */
export async function updateTemplate(templateId: string, input: UpdateTemplateInput): Promise<PromptTemplate> {
  const registry = getRegistry();
  const entry = findEntry(registry, templateId);
  if (!entry) {
    throw new NodeEngineValidationError(`Unknown prompt_template_id: ${templateId}`);
  }

  const current = entry.versions.find((v) => v.version === entry.active_version);
  if (!current) {
    throw new NodeEngineValidationError(`Active version missing for template: ${templateId}`);
  }

  const nextVersion = Math.max(...entry.versions.map((v) => v.version)) + 1;
  const newVersion = parsePromptTemplate({
    ...current,
    version: nextVersion,
    task_prompt: input.task_prompt ?? current.task_prompt,
    output_schema_ref: input.output_schema_ref ?? current.output_schema_ref,
    member_system_prompt: input.member_system_prompt ?? current.member_system_prompt,
    chairman_system_prompt: input.chairman_system_prompt ?? current.chairman_system_prompt,
    status: input.status ?? current.status,
    last_updated_by: input.last_updated_by,
    last_updated_at: new Date().toISOString(),
    change_note: input.change_note,
  });

  // Append (never mutate) and move the active pointer.
  entry.versions.push(newVersion);
  entry.active_version = newVersion.version;
  registry.updated_at = new Date().toISOString();

  await writePromptTemplateRegistry(registry);
  cachedRegistry = registry;
  return newVersion;
}
