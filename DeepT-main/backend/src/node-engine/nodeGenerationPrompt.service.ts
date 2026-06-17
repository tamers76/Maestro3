/**
 * Node-Set Generation prompt accessor (M7).
 *
 * Mirrors the node-engine "seed defaults + accessor" convention used by the
 * prompt-template registry and the modality-generation config: the prompt body
 * is seeded once from `nodeGenerationPrompt.defaults.ts` and persisted to
 * `config/node-generation-prompt.json`, with an in-memory cache. Editing appends
 * a new immutable version and moves the active pointer (same D3 contract as the
 * vehicle prompt-template registry), so a published version is never mutated.
 *
 * It is kept SEPARATE from the vehicle prompt-template registry because node
 * generation is not a producible vehicle (text/video/interactive/…) and so must
 * not be validated against, or pollute, the VEHICLES-keyed registry.
 */
import { defaultNodeGenerationPrompt, type NodeGenerationPromptSeed } from '../config/nodeGenerationPrompt.defaults.js';
import { readNodeGenerationPromptFile, writeNodeGenerationPromptFile } from './store.service.js';

export interface NodeGenerationPromptFile {
  schema_version: 1;
  updated_at: string;
  active_version: number;
  versions: NodeGenerationPromptSeed[];
}

let cached: NodeGenerationPromptFile | null = null;

function buildSeedFile(): NodeGenerationPromptFile {
  return {
    schema_version: 1,
    updated_at: defaultNodeGenerationPrompt.last_updated_at,
    active_version: defaultNodeGenerationPrompt.version,
    versions: [defaultNodeGenerationPrompt],
  };
}

/**
 * Load the prompt document. READ-ONLY: it never writes on read (the persisted
 * file is only created when an edit is made via updateNodeGenerationPrompt), so
 * generation has no filesystem side effects. Falls back to the in-code seed.
 */
function getFile(): NodeGenerationPromptFile {
  if (cached) return cached;
  return buildSeedFile();
}

/** Hydrate the cache from Postgres at startup (no write on read; seed is in-code). */
export async function hydrateNodeGenerationPrompt(): Promise<NodeGenerationPromptFile> {
  const existing = await readNodeGenerationPromptFile();
  if (existing && Array.isArray(existing.versions) && existing.versions.length > 0) {
    cached = existing;
    return existing;
  }
  const seeded = buildSeedFile();
  cached = seeded;
  return seeded;
}

export function clearNodeGenerationPromptCache(): void {
  cached = null;
}

/** The active node-generation prompt (the persisted active version, else the seed). */
export function getActiveNodeGenerationPrompt(): NodeGenerationPromptSeed {
  const file = getFile();
  return file.versions.find((v) => v.version === file.active_version) ?? defaultNodeGenerationPrompt;
}

export interface UpdateNodeGenerationPromptInput {
  system_prompt?: string;
  task_prompt?: string;
  output_schema_ref?: string;
  last_updated_by: string;
  change_note: string;
}

/** Edit by appending a NEW immutable version and moving the active pointer (D3). */
export async function updateNodeGenerationPrompt(input: UpdateNodeGenerationPromptInput): Promise<NodeGenerationPromptSeed> {
  const file = getFile();
  const current = file.versions.find((v) => v.version === file.active_version) ?? defaultNodeGenerationPrompt;
  const nextVersion = Math.max(...file.versions.map((v) => v.version)) + 1;
  const newVersion: NodeGenerationPromptSeed = {
    ...current,
    version: nextVersion,
    system_prompt: input.system_prompt ?? current.system_prompt,
    task_prompt: input.task_prompt ?? current.task_prompt,
    output_schema_ref: input.output_schema_ref ?? current.output_schema_ref,
    last_updated_by: input.last_updated_by,
    last_updated_at: new Date().toISOString(),
    change_note: input.change_note,
  };
  file.versions.push(newVersion);
  file.active_version = nextVersion;
  file.updated_at = new Date().toISOString();
  await writeNodeGenerationPromptFile(file);
  cached = file;
  return newVersion;
}
