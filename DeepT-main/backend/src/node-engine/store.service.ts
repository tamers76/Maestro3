/**
 * Node Engine persistence layer — Postgres-backed.
 *
 * - Global config documents (prompt-template registry, modality-generation
 *   config, node-generation prompt) live in `app_config` via `configRepo`.
 * - Per-course node-engine artifacts (alignment proposals, generated node-sets)
 *   live in `stage_artifacts` via `artifactRepo`, keyed by the artifact filename.
 *
 * All accessors are async (Postgres). The relational web (Node / KnowledgeComponent
 * / EvidenceMap) is projected to Neo4j separately; this store holds reviewable
 * JSON artifacts so M7 output is replayable without a live graph DB.
 */
import type {
  PromptTemplateRegistryFile,
  ModalityGenerationConfigFile,
  ReferenceCoverageConfigFile,
} from '../models/nodeEngine.js';
import type { NodeGenerationPromptFile } from './nodeGenerationPrompt.service.js';
import * as configRepo from '../db/repos/configRepo.js';
import * as artifactRepo from '../db/repos/artifactRepo.js';

const NODE_ENGINE_ARTIFACT_STAGE = 'node-engine';

// ============== Prompt Template Registry (global document) ==============

export async function readPromptTemplateRegistry(): Promise<PromptTemplateRegistryFile | null> {
  return configRepo.get<PromptTemplateRegistryFile>(configRepo.CONFIG_KEYS.promptTemplates);
}

export async function writePromptTemplateRegistry(registry: PromptTemplateRegistryFile): Promise<void> {
  await configRepo.set(configRepo.CONFIG_KEYS.promptTemplates, registry);
}

// ============== Modality Generation Config (global document) ==============

export async function readModalityGenerationConfig(): Promise<ModalityGenerationConfigFile | null> {
  return configRepo.get<ModalityGenerationConfigFile>(configRepo.CONFIG_KEYS.modalityGenerationConfig);
}

export async function writeModalityGenerationConfig(file: ModalityGenerationConfigFile): Promise<void> {
  await configRepo.set(configRepo.CONFIG_KEYS.modalityGenerationConfig, file);
}

// ============== Reference Coverage thresholds (global document) ==============

export async function readReferenceCoverageConfig(): Promise<ReferenceCoverageConfigFile | null> {
  return configRepo.get<ReferenceCoverageConfigFile>(configRepo.CONFIG_KEYS.referenceCoverageConfig);
}

export async function writeReferenceCoverageConfig(file: ReferenceCoverageConfigFile): Promise<void> {
  await configRepo.set(configRepo.CONFIG_KEYS.referenceCoverageConfig, file);
}

// ============== Node-Set Generation prompt (global document) ==============

export async function readNodeGenerationPromptFile(): Promise<NodeGenerationPromptFile | null> {
  return configRepo.get<NodeGenerationPromptFile>(configRepo.CONFIG_KEYS.nodeGenerationPrompt);
}

export async function writeNodeGenerationPromptFile(file: NodeGenerationPromptFile): Promise<void> {
  await configRepo.set(configRepo.CONFIG_KEYS.nodeGenerationPrompt, file);
}

// ============== Per-course node-engine artifacts ==============

/** Normalize an artifact filename into a stable artifact-type key. */
function artifactType(fileName: string): string {
  return `node_engine:${fileName}`;
}

/** Save an arbitrary node-engine artifact JSON for a course. */
export async function saveCourseArtifact(courseCode: string, fileName: string, data: unknown): Promise<void> {
  await artifactRepo.save(courseCode, artifactType(fileName), data, { stage: NODE_ENGINE_ARTIFACT_STAGE });
}

/** Read a previously saved node-engine artifact JSON for a course. */
export async function getCourseArtifact<T = unknown>(courseCode: string, fileName: string): Promise<T | null> {
  return artifactRepo.get<T>(courseCode, artifactType(fileName));
}

/** Whether a per-course node-engine artifact exists. */
export async function hasCourseArtifact(courseCode: string, fileName: string): Promise<boolean> {
  return artifactRepo.has(courseCode, artifactType(fileName));
}

// ============== M7 node-set artifacts (per subtopic) ==============

/** Stable artifact filename for one subtopic's generated node-set. */
export function nodeSetFileName(subtopicId: string): string {
  return `nodeset_${subtopicId}.json`;
}

export async function saveNodeSetArtifact(courseCode: string, subtopicId: string, data: unknown): Promise<void> {
  await saveCourseArtifact(courseCode, nodeSetFileName(subtopicId), data);
}

export async function getNodeSetArtifact<T = unknown>(courseCode: string, subtopicId: string): Promise<T | null> {
  return getCourseArtifact<T>(courseCode, nodeSetFileName(subtopicId));
}
