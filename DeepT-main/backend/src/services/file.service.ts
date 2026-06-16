import { 
  existsSync, 
  mkdirSync, 
  writeFileSync, 
  readFileSync, 
  readdirSync,
  rmSync
} from 'fs';
import { join } from 'path';
import type { 
  ExtractedSnapshot, 
  CourseContract, 
  Stage3Snapshot,
  Stage3IncompleteReport,
  Stage4Checkpoint, 
  Stage4ErrorEntry, 
  CourseConfirmations,
  Stage1LayersFile,
  Stage1LayerState,
  Stage1LayerStatus,
  CloRefinementsFile,
  AssessmentRedesignsFile,
  WeightingRubricFile,
  IntegrityReviewFile,
  SubtopicArchitectureFile,
  Stage4NodeContent,
  WorkloadMap,
  CourseRubric,
  Stage4ContentPack,
  ModalityPlan,
  NodeInstructionalPackage,
  DiagnosticAssessment,
  LLMInteractiveAssessmentSpec,
  NodeRemediationPack,
  VisualAssetSpec,
  VideoProductionPackage,
  SummativeAssessmentPack,
  CourseBook,
  EnhancedWorkloadMap,
  Stage4ValidationReport,
  AdaptiveCourseModel,
  Stage5AValidationReport,
  ReferenceManifest,
  ReferenceChunk
} from '../models/schemas.js';

const DATA_DIR = join(process.cwd(), '..', 'data', 'courses');

// Ensure directory exists
function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

// Get course directory path
function getCourseDir(courseCode: string): string {
  return join(DATA_DIR, courseCode);
}

// ============== Directory Management ==============

export function initCourseDirectories(courseCode: string): void {
  const courseDir = getCourseDir(courseCode);
  ensureDir(join(courseDir, 'extracted'));
  ensureDir(join(courseDir, 'contract'));
  ensureDir(join(courseDir, 'nodes'));
  ensureDir(join(courseDir, 'compiled'));
  ensureDir(join(courseDir, 'stage3'));
  ensureDir(join(courseDir, 'stage1'));
  ensureDir(join(courseDir, 'references'));
}

export function deleteCourseDirectory(courseCode: string): void {
  const courseDir = getCourseDir(courseCode);
  if (existsSync(courseDir)) {
    rmSync(courseDir, { recursive: true, force: true });
  }
}

// ============== Extracted Data ==============

export function saveExtractedSnapshot(courseCode: string, snapshot: ExtractedSnapshot): void {
  const path = join(getCourseDir(courseCode), 'extracted', 'snapshot.json');
  ensureDir(join(getCourseDir(courseCode), 'extracted'));
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf-8');
}

export function getExtractedSnapshot(courseCode: string): ExtractedSnapshot | null {
  const path = join(getCourseDir(courseCode), 'extracted', 'snapshot.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as ExtractedSnapshot;
}

// ============== Course Contract ==============

export function saveCourseContract(courseCode: string, contract: CourseContract): void {
  const path = join(getCourseDir(courseCode), 'contract', 'course_contract.json');
  ensureDir(join(getCourseDir(courseCode), 'contract'));
  writeFileSync(path, JSON.stringify(contract, null, 2), 'utf-8');
}

export function getCourseContract(courseCode: string): CourseContract | null {
  const path = join(getCourseDir(courseCode), 'contract', 'course_contract.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as CourseContract;
}

// ============== Stage 3 Snapshot ==============

export function saveStage3Snapshot(courseCode: string, snapshot: Stage3Snapshot): void {
  const dir = join(getCourseDir(courseCode), 'stage3');
  ensureDir(dir);
  const path = join(dir, 'stage3_snapshot.json');
  writeFileSync(path, JSON.stringify(snapshot, null, 2), 'utf-8');
}

export function getStage3Snapshot(courseCode: string): Stage3Snapshot | null {
  const path = join(getCourseDir(courseCode), 'stage3', 'stage3_snapshot.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Stage3Snapshot;
  } catch (error) {
    console.error('Error reading Stage 3 snapshot:', error);
    return null;
  }
}

// ============== Stage 3 Incomplete Report ==============

export function saveStage3IncompleteReport(courseCode: string, report: Stage3IncompleteReport): void {
  const dir = join(getCourseDir(courseCode), 'stage3');
  ensureDir(dir);
  const path = join(dir, 'stage3_incomplete_report.json');
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf-8');
}

export function getStage3IncompleteReport(courseCode: string): Stage3IncompleteReport | null {
  const path = join(getCourseDir(courseCode), 'stage3', 'stage3_incomplete_report.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Stage3IncompleteReport;
  } catch (error) {
    console.error('Error reading Stage 3 incomplete report:', error);
    return null;
  }
}

// ============== Node Content (Markdown) ==============

export function saveNodeContent(courseCode: string, nodeId: string, content: string): string {
  const dir = join(getCourseDir(courseCode), 'nodes');
  ensureDir(dir);
  const path = join(dir, `${nodeId}.md`);
  writeFileSync(path, content, 'utf-8');
  return path;
}

export function getNodeContent(courseCode: string, nodeId: string): string | null {
  const path = join(getCourseDir(courseCode), 'nodes', `${nodeId}.md`);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

export function getAllNodeContents(courseCode: string): Map<string, string> {
  const dir = join(getCourseDir(courseCode), 'nodes');
  const contents = new Map<string, string>();
  
  if (!existsSync(dir)) return contents;
  
  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const nodeId = file.replace('.md', '');
    const content = readFileSync(join(dir, file), 'utf-8');
    contents.set(nodeId, content);
  }
  
  return contents;
}

export function deleteNodeContents(courseCode: string): void {
  const dir = join(getCourseDir(courseCode), 'nodes');
  if (existsSync(dir)) {
    const files = readdirSync(dir);
    for (const file of files) {
      rmSync(join(dir, file));
    }
  }
}

// Check if a specific node content file exists
export function nodeContentExists(courseCode: string, nodeId: string): boolean {
  const path = join(getCourseDir(courseCode), 'nodes', `${nodeId}.md`);
  return existsSync(path);
}

// Get list of node IDs that have content files
export function getExistingNodeIds(courseCode: string): string[] {
  const dir = join(getCourseDir(courseCode), 'nodes');
  if (!existsSync(dir)) return [];
  
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));
}

// ============== Stage 4 Checkpoint ==============

export function saveStage4Checkpoint(courseCode: string, checkpoint: Stage4Checkpoint): void {
  const path = join(getCourseDir(courseCode), 'stage4_checkpoint.json');
  ensureDir(getCourseDir(courseCode));
  writeFileSync(path, JSON.stringify(checkpoint, null, 2), 'utf-8');
}

export function getStage4Checkpoint(courseCode: string): Stage4Checkpoint | null {
  const path = join(getCourseDir(courseCode), 'stage4_checkpoint.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Stage4Checkpoint;
  } catch (error) {
    console.error('Error reading Stage 4 checkpoint:', error);
    return null;
  }
}

export function deleteStage4Checkpoint(courseCode: string): void {
  const path = join(getCourseDir(courseCode), 'stage4_checkpoint.json');
  if (existsSync(path)) {
    rmSync(path);
  }
}

// ============== Stage 4 Error Logging ==============

function getStage4ErrorLogPath(courseCode: string): string {
  return join(getCourseDir(courseCode), 'logs', 'stage4_errors.json');
}

export function appendStage4ErrorLog(courseCode: string, error: Stage4ErrorEntry): void {
  const logDir = join(getCourseDir(courseCode), 'logs');
  ensureDir(logDir);
  
  const path = getStage4ErrorLogPath(courseCode);
  let errors: Stage4ErrorEntry[] = [];
  
  // Load existing errors if file exists
  if (existsSync(path)) {
    try {
      errors = JSON.parse(readFileSync(path, 'utf-8')) as Stage4ErrorEntry[];
    } catch {
      // If file is corrupted, start fresh
      errors = [];
    }
  }
  
  // Append new error
  errors.push(error);
  writeFileSync(path, JSON.stringify(errors, null, 2), 'utf-8');
}

export function getStage4ErrorLog(courseCode: string): Stage4ErrorEntry[] {
  const path = getStage4ErrorLogPath(courseCode);
  if (!existsSync(path)) return [];
  
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Stage4ErrorEntry[];
  } catch (error) {
    console.error('Error reading Stage 4 error log:', error);
    return [];
  }
}

export function clearStage4ErrorLog(courseCode: string): void {
  const path = getStage4ErrorLogPath(courseCode);
  if (existsSync(path)) {
    rmSync(path);
  }
}

// ============== Compiled Output ==============

export function saveCompiledPDF(courseCode: string, pdfBuffer: Buffer): string {
  const dir = join(getCourseDir(courseCode), 'compiled');
  ensureDir(dir);
  const path = join(dir, `${courseCode}.pdf`);
  writeFileSync(path, pdfBuffer);
  return path;
}

export function getCompiledPDFPath(courseCode: string): string | null {
  const path = join(getCourseDir(courseCode), 'compiled', `${courseCode}.pdf`);
  if (!existsSync(path)) return null;
  return path;
}

export function getCompiledPDF(courseCode: string): Buffer | null {
  const path = getCompiledPDFPath(courseCode);
  if (!path) return null;
  return readFileSync(path);
}

// ============== Compiled Documents (Multi-doc PDF + DOCX) ==============

export type CompiledDocType = 'main-course' | 'content' | 'video-scripts' | 'assessments' | 'combined';
export type CompiledDocFormat = 'pdf' | 'docx';

function compiledDocFilename(courseCode: string, docType: CompiledDocType, format: CompiledDocFormat): string {
  return `${courseCode}-${docType}.${format}`;
}

export function saveCompiledDocument(courseCode: string, docType: CompiledDocType, format: CompiledDocFormat, buffer: Buffer): string {
  const dir = join(getCourseDir(courseCode), 'compiled');
  ensureDir(dir);
  const filePath = join(dir, compiledDocFilename(courseCode, docType, format));
  writeFileSync(filePath, buffer);
  return filePath;
}

export function getCompiledDocumentPath(courseCode: string, docType: CompiledDocType, format: CompiledDocFormat): string | null {
  const filePath = join(getCourseDir(courseCode), 'compiled', compiledDocFilename(courseCode, docType, format));
  if (!existsSync(filePath)) return null;
  return filePath;
}

export function getCompiledDocument(courseCode: string, docType: CompiledDocType, format: CompiledDocFormat): Buffer | null {
  const filePath = getCompiledDocumentPath(courseCode, docType, format);
  if (!filePath) return null;
  return readFileSync(filePath);
}

/** List all compiled documents for a course */
export function listCompiledDocuments(courseCode: string): { docType: CompiledDocType; format: CompiledDocFormat; path: string }[] {
  const dir = join(getCourseDir(courseCode), 'compiled');
  if (!existsSync(dir)) return [];
  const docTypes: CompiledDocType[] = ['main-course', 'content', 'video-scripts', 'assessments', 'combined'];
  const formats: CompiledDocFormat[] = ['pdf', 'docx'];
  const results: { docType: CompiledDocType; format: CompiledDocFormat; path: string }[] = [];
  for (const dt of docTypes) {
    for (const fmt of formats) {
      const filePath = join(dir, compiledDocFilename(courseCode, dt, fmt));
      if (existsSync(filePath)) {
        results.push({ docType: dt, format: fmt, path: filePath });
      }
    }
  }
  return results;
}

// ============== Upload Handling ==============

export function saveUploadedFile(courseCode: string, filename: string, buffer: Buffer): string {
  const dir = join(getCourseDir(courseCode), 'extracted');
  ensureDir(dir);
  const path = join(dir, filename);
  writeFileSync(path, buffer);
  return path;
}

export function getUploadedFilePath(courseCode: string, filename: string): string | null {
  const path = join(getCourseDir(courseCode), 'extracted', filename);
  if (!existsSync(path)) return null;
  return path;
}

// ============== Reference Materials (RAG grounding) ==============

function getReferencesDir(courseCode: string): string {
  return join(getCourseDir(courseCode), 'references');
}

export function getReferenceManifest(courseCode: string): ReferenceManifest | null {
  const path = join(getReferencesDir(courseCode), 'manifest.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ReferenceManifest;
  } catch (error) {
    console.error('Error reading reference manifest:', error);
    return null;
  }
}

export function saveReferenceManifest(courseCode: string, manifest: ReferenceManifest): void {
  const dir = getReferencesDir(courseCode);
  ensureDir(dir);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
}

export function saveReferenceDocText(courseCode: string, docId: string, text: string): void {
  const dir = getReferencesDir(courseCode);
  ensureDir(dir);
  writeFileSync(join(dir, `${docId}.txt`), text, 'utf-8');
}

export function getReferenceDocText(courseCode: string, docId: string): string | null {
  const path = join(getReferencesDir(courseCode), `${docId}.txt`);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

export function saveReferenceChunks(courseCode: string, docId: string, chunks: ReferenceChunk[]): void {
  const dir = getReferencesDir(courseCode);
  ensureDir(dir);
  writeFileSync(join(dir, `${docId}.chunks.json`), JSON.stringify(chunks, null, 2), 'utf-8');
}

export function getReferenceChunks(courseCode: string, docId: string): ReferenceChunk[] {
  const path = join(getReferencesDir(courseCode), `${docId}.chunks.json`);
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ReferenceChunk[];
  } catch (error) {
    console.error(`Error reading reference chunks for ${docId}:`, error);
    return [];
  }
}

export function getAllReferenceChunks(courseCode: string): ReferenceChunk[] {
  const dir = getReferencesDir(courseCode);
  if (!existsSync(dir)) return [];
  const all: ReferenceChunk[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.chunks.json'))) {
    try {
      all.push(...(JSON.parse(readFileSync(join(dir, file), 'utf-8')) as ReferenceChunk[]));
    } catch (error) {
      console.error(`Error reading reference chunks file ${file}:`, error);
    }
  }
  return all;
}

export function deleteReferenceDocFiles(courseCode: string, docId: string): void {
  const dir = getReferencesDir(courseCode);
  for (const suffix of ['.txt', '.chunks.json']) {
    const path = join(dir, `${docId}${suffix}`);
    if (existsSync(path)) rmSync(path);
  }
}

// ============== Course Confirmations ==============

export function getConfirmations(courseCode: string): CourseConfirmations | null {
  const path = join(getCourseDir(courseCode), 'confirmations.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CourseConfirmations;
  } catch (error) {
    console.error('Error reading confirmations:', error);
    return null;
  }
}

export function saveConfirmations(courseCode: string, confirmations: CourseConfirmations): void {
  const path = join(getCourseDir(courseCode), 'confirmations.json');
  ensureDir(getCourseDir(courseCode));
  writeFileSync(path, JSON.stringify(confirmations, null, 2), 'utf-8');
}

export function updateConfirmations(courseCode: string, updates: Partial<CourseConfirmations>): CourseConfirmations {
  const existing = getConfirmations(courseCode) || {};
  const updated = { ...existing, ...updates };
  saveConfirmations(courseCode, updated);
  return updated;
}

export function clearConfirmations(courseCode: string): void {
  const path = join(getCourseDir(courseCode), 'confirmations.json');
  if (existsSync(path)) {
    rmSync(path);
  }
}

// ============== Stage 1 Internal Layers ==============

function getStage1LayersPath(courseCode: string): string {
  return join(getCourseDir(courseCode), 'stage1', 'layers.json');
}

export function getStage1LayersFile(courseCode: string): Stage1LayersFile | null {
  const path = getStage1LayersPath(courseCode);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Stage1LayersFile;
  } catch (error) {
    console.error('Error reading Stage 1 layers file:', error);
    return null;
  }
}

export function saveStage1LayersFile(courseCode: string, file: Stage1LayersFile): void {
  const dir = join(getCourseDir(courseCode), 'stage1');
  ensureDir(dir);
  writeFileSync(getStage1LayersPath(courseCode), JSON.stringify(file, null, 2), 'utf-8');
}

export function getStage1LayerState(courseCode: string, layerId: string): Stage1LayerState | null {
  const file = getStage1LayersFile(courseCode);
  return file?.layers.find((l) => l.layerId === layerId) ?? null;
}

export function updateStage1LayerState(
  courseCode: string,
  layerId: string,
  updates: Partial<Stage1LayerState>
): Stage1LayerState {
  const existing = getStage1LayersFile(courseCode);
  const layers = existing?.layers ?? [];
  const index = layers.findIndex((l) => l.layerId === layerId);
  const current: Stage1LayerState =
    index >= 0
      ? layers[index]
      : { layerId, status: 'not_started' as Stage1LayerStatus };

  const updated: Stage1LayerState = { ...current, ...updates, layerId };
  if (index >= 0) {
    layers[index] = updated;
  } else {
    layers.push(updated);
  }

  saveStage1LayersFile(courseCode, {
    layers,
    updatedAt: new Date().toISOString(),
  });
  return updated;
}

function getCloRefinementsPath(courseCode: string): string {
  return join(getCourseDir(courseCode), 'stage1', 'clo-refinements.json');
}

export function getCloRefinementsFile(courseCode: string): CloRefinementsFile | null {
  const path = getCloRefinementsPath(courseCode);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CloRefinementsFile;
  } catch (error) {
    console.error('Error reading CLO refinements file:', error);
    return null;
  }
}

export function saveCloRefinementsFile(courseCode: string, file: CloRefinementsFile): void {
  const dir = join(getCourseDir(courseCode), 'stage1');
  ensureDir(dir);
  writeFileSync(getCloRefinementsPath(courseCode), JSON.stringify(file, null, 2), 'utf-8');
}

function getAssessmentRedesignsPath(courseCode: string): string {
  return join(getCourseDir(courseCode), 'stage1', 'assessment-redesigns.json');
}

export function getAssessmentRedesignsFile(courseCode: string): AssessmentRedesignsFile | null {
  const path = getAssessmentRedesignsPath(courseCode);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as AssessmentRedesignsFile;
  } catch (error) {
    console.error('Error reading assessment redesigns file:', error);
    return null;
  }
}

export function saveAssessmentRedesignsFile(courseCode: string, file: AssessmentRedesignsFile): void {
  const dir = join(getCourseDir(courseCode), 'stage1');
  ensureDir(dir);
  writeFileSync(getAssessmentRedesignsPath(courseCode), JSON.stringify(file, null, 2), 'utf-8');
}

function getWeightingRubricPath(courseCode: string): string {
  return join(getCourseDir(courseCode), 'stage1', 'weighting-rubric.json');
}

export function getWeightingRubricFile(courseCode: string): WeightingRubricFile | null {
  const path = getWeightingRubricPath(courseCode);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as WeightingRubricFile;
  } catch (error) {
    console.error('Error reading weighting rubric file:', error);
    return null;
  }
}

export function saveWeightingRubricFile(courseCode: string, file: WeightingRubricFile): void {
  const dir = join(getCourseDir(courseCode), 'stage1');
  ensureDir(dir);
  writeFileSync(getWeightingRubricPath(courseCode), JSON.stringify(file, null, 2), 'utf-8');
}

function getIntegrityReviewPath(courseCode: string): string {
  return join(getCourseDir(courseCode), 'stage1', 'integrity-review.json');
}

export function getIntegrityReviewFile(courseCode: string): IntegrityReviewFile | null {
  const path = getIntegrityReviewPath(courseCode);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as IntegrityReviewFile;
  } catch (error) {
    console.error('Error reading integrity review file:', error);
    return null;
  }
}

export function saveIntegrityReviewFile(courseCode: string, file: IntegrityReviewFile): void {
  const dir = join(getCourseDir(courseCode), 'stage1');
  ensureDir(dir);
  writeFileSync(getIntegrityReviewPath(courseCode), JSON.stringify(file, null, 2), 'utf-8');
}

function getSubtopicArchitecturePath(courseCode: string): string {
  return join(getCourseDir(courseCode), 'stage1', 'subtopic-architecture.json');
}

export function getSubtopicArchitectureFile(courseCode: string): SubtopicArchitectureFile | null {
  const path = getSubtopicArchitecturePath(courseCode);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SubtopicArchitectureFile;
  } catch (error) {
    console.error('Error reading subtopic architecture file:', error);
    return null;
  }
}

export function saveSubtopicArchitectureFile(
  courseCode: string,
  file: SubtopicArchitectureFile
): void {
  const dir = join(getCourseDir(courseCode), 'stage1');
  ensureDir(dir);
  writeFileSync(getSubtopicArchitecturePath(courseCode), JSON.stringify(file, null, 2), 'utf-8');
}

// ============================================================================
// STAGE 4 ENHANCED CONTENT MANAGEMENT
// ============================================================================

/**
 * Get Stage 4 directory path
 */
function getStage4Dir(courseCode: string): string {
  return join(getCourseDir(courseCode), 'stage4');
}

/**
 * Get Stage 4 node content directory path
 */
function getStage4NodesDir(courseCode: string): string {
  return join(getStage4Dir(courseCode), 'nodes');
}

/**
 * Get Stage 4 course-level directory path
 */
function getStage4CourseDir(courseCode: string): string {
  return join(getStage4Dir(courseCode), 'course');
}

/**
 * Initialize Stage 4 directories
 */
export function initStage4Directories(courseCode: string): void {
  ensureDir(getStage4NodesDir(courseCode));
  ensureDir(getStage4CourseDir(courseCode));
}

/**
 * Delete all Stage 4 content for a course
 */
export function deleteStage4Content(courseCode: string): void {
  const stage4Dir = getStage4Dir(courseCode);
  if (existsSync(stage4Dir)) {
    rmSync(stage4Dir, { recursive: true, force: true });
  }
  // Also clear the old nodes directory for backward compatibility
  deleteNodeContents(courseCode);
}

// ============== Stage 4 Node Content ==============

/**
 * Get path for a node's content pack
 */
export function getStage4NodeContentPath(courseCode: string, nodeId: string): string {
  return join(getStage4NodesDir(courseCode), nodeId, 'content.json');
}

/**
 * Save Stage 4 node content pack
 */
export function saveStage4NodeContent(courseCode: string, nodeId: string, content: Stage4NodeContent): void {
  const nodeDir = join(getStage4NodesDir(courseCode), nodeId);
  ensureDir(nodeDir);
  
  // Save main content pack
  writeFileSync(
    join(nodeDir, 'content.json'),
    JSON.stringify(content, null, 2),
    'utf-8'
  );
  
  // Also save instructional content as markdown for easy reading
  writeFileSync(
    join(nodeDir, 'content.md'),
    content.instructional_content,
    'utf-8'
  );
  
  // Save video script separately if present
  if (content.video_script) {
    writeFileSync(
      join(nodeDir, 'video_script.json'),
      JSON.stringify(content.video_script, null, 2),
      'utf-8'
    );
  }
  
  // Save assessments separately
  if (content.assessments.length > 0) {
    writeFileSync(
      join(nodeDir, 'assessments.json'),
      JSON.stringify(content.assessments, null, 2),
      'utf-8'
    );
  }
  
  // Save visual prompts separately
  if (content.visual_prompts.length > 0) {
    writeFileSync(
      join(nodeDir, 'visual_prompts.json'),
      JSON.stringify(content.visual_prompts, null, 2),
      'utf-8'
    );
  }
}

/**
 * Get Stage 4 node content pack
 */
export function getStage4NodeContent(courseCode: string, nodeId: string): Stage4NodeContent | null {
  const path = join(getStage4NodesDir(courseCode), nodeId, 'content.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Stage4NodeContent;
  } catch (error) {
    console.error(`Error reading Stage 4 content for ${nodeId}:`, error);
    return null;
  }
}

/**
 * Get Stage 4 node instructional content (markdown)
 */
export function getStage4NodeInstructionalContent(courseCode: string, nodeId: string): string | null {
  const path = join(getStage4NodesDir(courseCode), nodeId, 'content.md');
  if (!existsSync(path)) {
    // Fall back to content pack
    const contentPack = getStage4NodeContent(courseCode, nodeId);
    return contentPack?.instructional_content || null;
  }
  return readFileSync(path, 'utf-8');
}

/**
 * Get list of node IDs that have Stage 4 content
 */
export function getExistingStage4NodeIds(courseCode: string): string[] {
  const nodesDir = getStage4NodesDir(courseCode);
  if (!existsSync(nodesDir)) return [];
  
  return readdirSync(nodesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .filter(dirent => existsSync(join(nodesDir, dirent.name, 'content.json')))
    .map(dirent => dirent.name);
}

/**
 * Check if a node has Stage 4 content
 */
export function stage4NodeContentExists(courseCode: string, nodeId: string): boolean {
  const path = join(getStage4NodesDir(courseCode), nodeId, 'content.json');
  return existsSync(path);
}

/**
 * Get all Stage 4 instructional content as a Map (for Stage 5 assembly)
 */
export function getAllStage4InstructionalContents(courseCode: string): Map<string, string> {
  const contents = new Map<string, string>();
  const nodeIds = getExistingStage4NodeIds(courseCode);
  
  for (const nodeId of nodeIds) {
    const content = getStage4NodeInstructionalContent(courseCode, nodeId);
    if (content) {
      contents.set(nodeId, content);
    }
  }
  
  return contents;
}

// ============== Stage 4 Workload Map ==============

/**
 * Save Stage 4 workload map
 */
export function saveStage4WorkloadMap(courseCode: string, workloadMap: WorkloadMap): void {
  const courseDir = getStage4CourseDir(courseCode);
  ensureDir(courseDir);
  writeFileSync(
    join(courseDir, 'workload_map.json'),
    JSON.stringify(workloadMap, null, 2),
    'utf-8'
  );
}

/**
 * Get Stage 4 workload map
 */
export function getStage4WorkloadMap(courseCode: string): WorkloadMap | null {
  const path = join(getStage4CourseDir(courseCode), 'workload_map.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as WorkloadMap;
  } catch (error) {
    console.error('Error reading workload map:', error);
    return null;
  }
}

// ============== Stage 4 Course Rubric ==============

/**
 * Save Stage 4 course rubric
 */
export function saveStage4Rubric(courseCode: string, rubric: CourseRubric): void {
  const courseDir = getStage4CourseDir(courseCode);
  ensureDir(courseDir);
  
  // Save rubric JSON
  writeFileSync(
    join(courseDir, 'rubric.json'),
    JSON.stringify(rubric, null, 2),
    'utf-8'
  );
  
  // Also save marking guide as markdown
  writeFileSync(
    join(courseDir, 'marking_guide.md'),
    rubric.marking_guide,
    'utf-8'
  );
}

/**
 * Get Stage 4 course rubric
 */
export function getStage4Rubric(courseCode: string): CourseRubric | null {
  const path = join(getStage4CourseDir(courseCode), 'rubric.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as CourseRubric;
  } catch (error) {
    console.error('Error reading rubric:', error);
    return null;
  }
}

// ============== Stage 4 Learner Instructions ==============

/**
 * Save Stage 4 learner instructions
 */
export function saveStage4LearnerInstructions(courseCode: string, instructions: string): void {
  const courseDir = getStage4CourseDir(courseCode);
  ensureDir(courseDir);
  writeFileSync(
    join(courseDir, 'learner_instructions.md'),
    instructions,
    'utf-8'
  );
}

/**
 * Get Stage 4 learner instructions
 */
export function getStage4LearnerInstructions(courseCode: string): string | null {
  const path = join(getStage4CourseDir(courseCode), 'learner_instructions.md');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

// ============== Stage 4 Content Pack Summary ==============

/**
 * Save Stage 4 content pack summary
 */
export function saveStage4ContentPackSummary(courseCode: string, summary: Stage4ContentPack): void {
  const courseDir = getStage4CourseDir(courseCode);
  ensureDir(courseDir);
  writeFileSync(
    join(courseDir, 'content_pack_summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8'
  );
}

/**
 * Get Stage 4 content pack summary
 */
export function getStage4ContentPackSummary(courseCode: string): Stage4ContentPack | null {
  const path = join(getStage4CourseDir(courseCode), 'content_pack_summary.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Stage4ContentPack;
  } catch (error) {
    console.error('Error reading content pack summary:', error);
    return null;
  }
}

// ============================================================================
// STAGE 4 ENHANCED ARTIFACTS — Steps A–G Persistence
// ============================================================================

// ============== Step A: Modality Plan ==============

export function saveStage4ModalityPlan(courseCode: string, nodeId: string, plan: ModalityPlan): void {
  const nodeDir = join(getStage4NodesDir(courseCode), nodeId);
  ensureDir(nodeDir);
  writeFileSync(join(nodeDir, 'modality_plan.json'), JSON.stringify(plan, null, 2), 'utf-8');
}

export function getStage4ModalityPlan(courseCode: string, nodeId: string): ModalityPlan | null {
  const path = join(getStage4NodesDir(courseCode), nodeId, 'modality_plan.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as ModalityPlan; }
  catch { return null; }
}

// ============== Step B: Instructional Package ==============

export function saveStage4InstructionalPackage(courseCode: string, nodeId: string, pkg: NodeInstructionalPackage): void {
  const nodeDir = join(getStage4NodesDir(courseCode), nodeId);
  ensureDir(nodeDir);
  writeFileSync(join(nodeDir, 'instructional_package.json'), JSON.stringify(pkg, null, 2), 'utf-8');
  // Also save the core explanation as markdown for easy reading
  writeFileSync(join(nodeDir, 'instructional_package.md'), pkg.core_explanation, 'utf-8');
}

export function getStage4InstructionalPackage(courseCode: string, nodeId: string): NodeInstructionalPackage | null {
  const path = join(getStage4NodesDir(courseCode), nodeId, 'instructional_package.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as NodeInstructionalPackage; }
  catch { return null; }
}

// ============== Step C Layer 1: Diagnostic Assessment ==============

export function saveStage4DiagnosticAssessment(courseCode: string, nodeId: string, assessment: DiagnosticAssessment): void {
  const nodeDir = join(getStage4NodesDir(courseCode), nodeId);
  ensureDir(nodeDir);
  writeFileSync(join(nodeDir, 'diagnostic_assessment.json'), JSON.stringify(assessment, null, 2), 'utf-8');
}

export function getStage4DiagnosticAssessment(courseCode: string, nodeId: string): DiagnosticAssessment | null {
  const path = join(getStage4NodesDir(courseCode), nodeId, 'diagnostic_assessment.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as DiagnosticAssessment; }
  catch { return null; }
}

// ============== Step C Layer 2: LLM-Interactive Spec ==============

export function saveStage4LLMInteractiveSpec(courseCode: string, nodeId: string, spec: LLMInteractiveAssessmentSpec): void {
  const nodeDir = join(getStage4NodesDir(courseCode), nodeId);
  ensureDir(nodeDir);
  writeFileSync(join(nodeDir, 'llm_interactive_assessment_spec.json'), JSON.stringify(spec, null, 2), 'utf-8');
}

export function getStage4LLMInteractiveSpec(courseCode: string, nodeId: string): LLMInteractiveAssessmentSpec | null {
  const path = join(getStage4NodesDir(courseCode), nodeId, 'llm_interactive_assessment_spec.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as LLMInteractiveAssessmentSpec; }
  catch { return null; }
}

// ============== Step C Layer 3: Summative Assessments ==============

export function saveStage4SummativeAssessments(courseCode: string, pack: SummativeAssessmentPack): void {
  const courseDir = getStage4CourseDir(courseCode);
  const summativeDir = join(courseDir, 'summative_assessments');
  ensureDir(summativeDir);
  
  // Save the pack summary
  writeFileSync(join(summativeDir, 'summative_pack.json'), JSON.stringify(pack, null, 2), 'utf-8');
  
  // Save each artifact separately
  for (const artifact of pack.artifacts) {
    writeFileSync(
      join(summativeDir, `${artifact.artifact_id}.json`),
      JSON.stringify(artifact, null, 2),
      'utf-8'
    );
  }
}

export function getStage4SummativeAssessments(courseCode: string): SummativeAssessmentPack | null {
  const path = join(getStage4CourseDir(courseCode), 'summative_assessments', 'summative_pack.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as SummativeAssessmentPack; }
  catch { return null; }
}

// ============== Step D: Remediation Assets ==============

export function saveStage4RemediationPack(courseCode: string, nodeId: string, pack: NodeRemediationPack): void {
  const nodeDir = join(getStage4NodesDir(courseCode), nodeId);
  ensureDir(nodeDir);
  writeFileSync(join(nodeDir, 'remediation_assets.json'), JSON.stringify(pack, null, 2), 'utf-8');
}

export function getStage4RemediationPack(courseCode: string, nodeId: string): NodeRemediationPack | null {
  const path = join(getStage4NodesDir(courseCode), nodeId, 'remediation_assets.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as NodeRemediationPack; }
  catch { return null; }
}

// ============== Step E: Visual Asset Specs ==============

export function saveStage4VisualAssetSpecs(courseCode: string, nodeId: string, specs: VisualAssetSpec[]): void {
  const nodeDir = join(getStage4NodesDir(courseCode), nodeId);
  ensureDir(nodeDir);
  writeFileSync(join(nodeDir, 'visual_asset_specs.json'), JSON.stringify(specs, null, 2), 'utf-8');
}

export function getStage4VisualAssetSpecs(courseCode: string, nodeId: string): VisualAssetSpec[] | null {
  const path = join(getStage4NodesDir(courseCode), nodeId, 'visual_asset_specs.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as VisualAssetSpec[]; }
  catch { return null; }
}

// ============== Step E: Video Production Package ==============

export function saveStage4VideoProductionPackage(courseCode: string, nodeId: string, pkg: VideoProductionPackage): void {
  const nodeDir = join(getStage4NodesDir(courseCode), nodeId);
  ensureDir(nodeDir);
  writeFileSync(join(nodeDir, 'video_production_package.json'), JSON.stringify(pkg, null, 2), 'utf-8');
}

export function getStage4VideoProductionPackage(courseCode: string, nodeId: string): VideoProductionPackage | null {
  const path = join(getStage4NodesDir(courseCode), nodeId, 'video_production_package.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as VideoProductionPackage; }
  catch { return null; }
}

// ============== Step F: Course Book ==============

export function saveStage4CourseBook(courseCode: string, book: CourseBook, markdown: string): void {
  const courseDir = getStage4CourseDir(courseCode);
  ensureDir(courseDir);
  writeFileSync(join(courseDir, 'course_book.json'), JSON.stringify(book, null, 2), 'utf-8');
  writeFileSync(join(courseDir, 'course_book.md'), markdown, 'utf-8');
}

export function getStage4CourseBook(courseCode: string): CourseBook | null {
  const path = join(getStage4CourseDir(courseCode), 'course_book.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as CourseBook; }
  catch { return null; }
}

export function getStage4CourseBookMarkdown(courseCode: string): string | null {
  const path = join(getStage4CourseDir(courseCode), 'course_book.md');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

// ============== Step G: Validation Report ==============

export function saveStage4ValidationReport(courseCode: string, report: Stage4ValidationReport): void {
  const courseDir = getStage4CourseDir(courseCode);
  ensureDir(courseDir);
  writeFileSync(join(courseDir, 'validation_report.json'), JSON.stringify(report, null, 2), 'utf-8');
}

export function getStage4ValidationReport(courseCode: string): Stage4ValidationReport | null {
  const path = join(getStage4CourseDir(courseCode), 'validation_report.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as Stage4ValidationReport; }
  catch { return null; }
}

// ============== Stage 4 Combined Exports (enhanced) ==============

/**
 * Export all Stage 4 content as a ZIP-ready structure
 */
export function getAllStage4Content(courseCode: string): {
  nodes: Map<string, Stage4NodeContent>;
  workloadMap: WorkloadMap | null;
  rubric: CourseRubric | null;
  learnerInstructions: string | null;
  summary: Stage4ContentPack | null;
  courseBook: CourseBook | null;
  summativeAssessments: SummativeAssessmentPack | null;
  validationReport: Stage4ValidationReport | null;
} {
  const nodeIds = getExistingStage4NodeIds(courseCode);
  const nodes = new Map<string, Stage4NodeContent>();
  
  for (const nodeId of nodeIds) {
    const content = getStage4NodeContent(courseCode, nodeId);
    if (content) {
      nodes.set(nodeId, content);
    }
  }
  
  return {
    nodes,
    workloadMap: getStage4WorkloadMap(courseCode),
    rubric: getStage4Rubric(courseCode),
    learnerInstructions: getStage4LearnerInstructions(courseCode),
    summary: getStage4ContentPackSummary(courseCode),
    courseBook: getStage4CourseBook(courseCode),
    summativeAssessments: getStage4SummativeAssessments(courseCode),
    validationReport: getStage4ValidationReport(courseCode)
  };
}

// ============================================================================
// STAGE 5A — Structural Assembly & Adaptive Logic Validation Persistence
// ============================================================================

function getStage5aDir(courseCode: string): string {
  return join(getCourseDir(courseCode), 'stage5a');
}

// ============== Adaptive Course Model ==============

export function saveStage5aAdaptiveModel(courseCode: string, model: AdaptiveCourseModel): void {
  const dir = getStage5aDir(courseCode);
  ensureDir(dir);
  writeFileSync(join(dir, 'adaptive_model.json'), JSON.stringify(model, null, 2), 'utf-8');
}

export function getStage5aAdaptiveModel(courseCode: string): AdaptiveCourseModel | null {
  const path = join(getStage5aDir(courseCode), 'adaptive_model.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as AdaptiveCourseModel; }
  catch { return null; }
}

// ============== Validation Report (JSON) ==============

export function saveStage5aValidationReport(courseCode: string, report: Stage5AValidationReport): void {
  const dir = getStage5aDir(courseCode);
  ensureDir(dir);
  writeFileSync(join(dir, 'validation_report.json'), JSON.stringify(report, null, 2), 'utf-8');
}

export function getStage5aValidationReport(courseCode: string): Stage5AValidationReport | null {
  const path = join(getStage5aDir(courseCode), 'validation_report.json');
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')) as Stage5AValidationReport; }
  catch { return null; }
}

// ============== Validation Report (Markdown) ==============

export function saveStage5aReportMarkdown(courseCode: string, markdown: string): void {
  const dir = getStage5aDir(courseCode);
  ensureDir(dir);
  writeFileSync(join(dir, 'validation_report.md'), markdown, 'utf-8');
}

export function getStage5aReportMarkdown(courseCode: string): string | null {
  const path = join(getStage5aDir(courseCode), 'validation_report.md');
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

// ============== Delete Stage 5A outputs ==============

export function deleteStage5aContent(courseCode: string): void {
  const dir = getStage5aDir(courseCode);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}
