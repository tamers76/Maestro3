/**
 * Node Engine persistence layer.
 *
 * Mirrors the conventions of `services/file.service.ts`:
 * - global documents (the prompt-template registry) live under `config/`
 *   alongside `settings.json`;
 * - per-course node-engine artifacts live under
 *   `data/courses/<code>/node-engine/` (artifacts only — the relational web is
 *   written to Neo4j under new labels in later phases per D1).
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import type {
  PromptTemplateRegistryFile,
  ModalityGenerationConfigFile,
} from '../models/nodeEngine.js';
import type { NodeGenerationPromptFile } from './nodeGenerationPrompt.service.js';

const CONFIG_DIR = join(process.cwd(), '..', 'config');
const DATA_DIR = join(process.cwd(), '..', 'data', 'courses');

const PROMPT_TEMPLATES_PATH = join(CONFIG_DIR, 'prompt-templates.json');
const MODALITY_GENERATION_CONFIG_PATH = join(CONFIG_DIR, 'modality-generation-config.json');
const NODE_GENERATION_PROMPT_PATH = join(CONFIG_DIR, 'node-generation-prompt.json');

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

// ============== Prompt Template Registry (global document) ==============

export function readPromptTemplateRegistry(): PromptTemplateRegistryFile | null {
  if (!existsSync(PROMPT_TEMPLATES_PATH)) return null;
  try {
    return JSON.parse(readFileSync(PROMPT_TEMPLATES_PATH, 'utf-8')) as PromptTemplateRegistryFile;
  } catch (error) {
    console.error('[NodeEngine] Failed to read prompt-template registry:', error);
    return null;
  }
}

export function writePromptTemplateRegistry(registry: PromptTemplateRegistryFile): void {
  ensureDir(CONFIG_DIR);
  writeFileSync(PROMPT_TEMPLATES_PATH, JSON.stringify(registry, null, 2), 'utf-8');
}

// ============== Modality Generation Config (global document) ==============
// Stored separately from prompt-templates.json so editing per-vehicle model
// config NEVER mutates a prompt-template version (D3).

export function readModalityGenerationConfig(): ModalityGenerationConfigFile | null {
  if (!existsSync(MODALITY_GENERATION_CONFIG_PATH)) return null;
  try {
    return JSON.parse(
      readFileSync(MODALITY_GENERATION_CONFIG_PATH, 'utf-8')
    ) as ModalityGenerationConfigFile;
  } catch (error) {
    console.error('[NodeEngine] Failed to read modality-generation config:', error);
    return null;
  }
}

export function writeModalityGenerationConfig(file: ModalityGenerationConfigFile): void {
  ensureDir(CONFIG_DIR);
  writeFileSync(MODALITY_GENERATION_CONFIG_PATH, JSON.stringify(file, null, 2), 'utf-8');
}

// ============== Node-Set Generation prompt (global document) ==============

export function readNodeGenerationPromptFile(): NodeGenerationPromptFile | null {
  if (!existsSync(NODE_GENERATION_PROMPT_PATH)) return null;
  try {
    return JSON.parse(readFileSync(NODE_GENERATION_PROMPT_PATH, 'utf-8')) as NodeGenerationPromptFile;
  } catch (error) {
    console.error('[NodeEngine] Failed to read node-generation prompt file:', error);
    return null;
  }
}

export function writeNodeGenerationPromptFile(file: NodeGenerationPromptFile): void {
  ensureDir(CONFIG_DIR);
  writeFileSync(NODE_GENERATION_PROMPT_PATH, JSON.stringify(file, null, 2), 'utf-8');
}

// ============== Per-course node-engine artifacts ==============

function getNodeEngineDir(courseCode: string): string {
  return join(DATA_DIR, courseCode, 'node-engine');
}

/** Save an arbitrary node-engine artifact JSON for a course. */
export function saveCourseArtifact(courseCode: string, fileName: string, data: unknown): void {
  const dir = getNodeEngineDir(courseCode);
  ensureDir(dir);
  writeFileSync(join(dir, fileName), JSON.stringify(data, null, 2), 'utf-8');
}

/** Read a previously saved node-engine artifact JSON for a course. */
export function getCourseArtifact<T = unknown>(courseCode: string, fileName: string): T | null {
  const path = join(getNodeEngineDir(courseCode), fileName);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch (error) {
    console.error(`[NodeEngine] Failed to read artifact ${fileName} for ${courseCode}:`, error);
    return null;
  }
}

/** Whether a per-course node-engine artifact exists. */
export function hasCourseArtifact(courseCode: string, fileName: string): boolean {
  return existsSync(join(getNodeEngineDir(courseCode), fileName));
}

// ============== M7 node-set artifacts (per subtopic) ==============
//
// Per the D1 storage split, the relational web (Node / KnowledgeComponent /
// EvidenceMap) is written to Neo4j; the JSON file store holds the produced
// node-set ARTIFACT so M7 output is reviewable/replayable without a live DB.

/** Stable artifact filename for one subtopic's generated node-set. */
export function nodeSetFileName(subtopicId: string): string {
  return `nodeset_${subtopicId}.json`;
}

export function saveNodeSetArtifact(courseCode: string, subtopicId: string, data: unknown): void {
  saveCourseArtifact(courseCode, nodeSetFileName(subtopicId), data);
}

export function getNodeSetArtifact<T = unknown>(courseCode: string, subtopicId: string): T | null {
  return getCourseArtifact<T>(courseCode, nodeSetFileName(subtopicId));
}
