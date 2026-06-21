/**
 * Course artifact storage — Postgres-backed.
 *
 * JSON artifacts (Stage 1-5 outputs, confirmations, checkpoints, error logs,
 * node content) live in the `stage_artifacts` JSONB table via `artifactRepo`.
 * Binaries (compiled PDF/DOCX, uploaded source files) stay on the filesystem and
 * are catalogued in `blob_files` via `blobRepo`.
 *
 * All data accessors are async (Postgres). A few filesystem helpers
 * (`initCourseDirectories`, binary path resolvers) stay sync.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
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
  Stage4ValidationReport,
  AdaptiveCourseModel,
  Stage5AValidationReport,
} from '../models/schemas.js';
import * as artifactRepo from '../db/repos/artifactRepo.js';
import * as blobRepo from '../db/repos/blobRepo.js';

const DATA_DIR = join(process.cwd(), '..', 'data', 'courses');

/** Artifact-type keys for the `stage_artifacts` table (stable identifiers). */
const T = {
  extracted: 'extracted_snapshot',
  contract: 'course_contract',
  stage3: 'stage3_snapshot',
  stage3Incomplete: 'stage3_incomplete_report',
  stage4Checkpoint: 'stage4_checkpoint',
  stage4ErrorLog: 'stage4_error_log',
  confirmations: 'confirmations',
  stage1Layers: 'stage1_layers',
  cloRefinements: 'clo_refinements',
  assessmentRedesigns: 'assessment_redesigns',
  weightingRubric: 'weighting_rubric',
  integrityReview: 'integrity_review',
  subtopicArchitecture: 'subtopic_architecture',
  // per-node
  nodeContentMd: 'node_content_md',
  stage4NodeContent: 'stage4_node_content',
  stage4ModalityPlan: 'stage4_modality_plan',
  stage4InstructionalPackage: 'stage4_instructional_package',
  stage4DiagnosticAssessment: 'stage4_diagnostic_assessment',
  stage4LLMInteractiveSpec: 'stage4_llm_interactive_spec',
  stage4RemediationPack: 'stage4_remediation_pack',
  stage4VisualAssetSpecs: 'stage4_visual_asset_specs',
  stage4VideoProductionPackage: 'stage4_video_production_package',
  // course-level stage 4
  stage4WorkloadMap: 'stage4_workload_map',
  stage4Rubric: 'stage4_rubric',
  stage4LearnerInstructions: 'stage4_learner_instructions',
  stage4ContentPackSummary: 'stage4_content_pack_summary',
  stage4SummativeAssessments: 'stage4_summative_assessments',
  stage4CourseBook: 'stage4_course_book',
  stage4CourseBookMd: 'stage4_course_book_md',
  stage4ValidationReport: 'stage4_validation_report',
  // stage 5a
  stage5aAdaptiveModel: 'stage5a_adaptive_model',
  stage5aValidationReport: 'stage5a_validation_report',
  stage5aReportMd: 'stage5a_report_md',
} as const;

// ============== Filesystem helpers (binaries only) ==============

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function getCourseDir(courseCode: string): string {
  return join(DATA_DIR, courseCode);
}

// ============== Directory Management ==============

/** Create on-disk directories used for BINARIES (compiled docs, uploads). */
export function initCourseDirectories(courseCode: string): void {
  const courseDir = getCourseDir(courseCode);
  ensureDir(join(courseDir, 'extracted'));
  ensureDir(join(courseDir, 'compiled'));
  ensureDir(join(courseDir, 'media', 'video'));
}

/** Remove all course artifacts (Postgres), blob metadata, and on-disk binaries. */
export async function deleteCourseDirectory(courseCode: string): Promise<void> {
  await artifactRepo.removeByCourse(courseCode);
  await blobRepo.removeByCourse(courseCode);
  const courseDir = getCourseDir(courseCode);
  if (existsSync(courseDir)) rmSync(courseDir, { recursive: true, force: true });
}

// ============== Extracted Data ==============

export async function saveExtractedSnapshot(courseCode: string, snapshot: ExtractedSnapshot): Promise<void> {
  await artifactRepo.save(courseCode, T.extracted, snapshot, { stage: 'intake' });
}

export async function getExtractedSnapshot(courseCode: string): Promise<ExtractedSnapshot | null> {
  return artifactRepo.get<ExtractedSnapshot>(courseCode, T.extracted);
}

// ============== Course Contract ==============

export async function saveCourseContract(courseCode: string, contract: CourseContract): Promise<void> {
  await artifactRepo.save(courseCode, T.contract, contract, { stage: 'stage1' });
}

export async function getCourseContract(courseCode: string): Promise<CourseContract | null> {
  return artifactRepo.get<CourseContract>(courseCode, T.contract);
}

// ============== Stage 3 Snapshot ==============

export async function saveStage3Snapshot(courseCode: string, snapshot: Stage3Snapshot): Promise<void> {
  await artifactRepo.save(courseCode, T.stage3, snapshot, { stage: 'stage3' });
}

export async function getStage3Snapshot(courseCode: string): Promise<Stage3Snapshot | null> {
  return artifactRepo.get<Stage3Snapshot>(courseCode, T.stage3);
}

// ============== Stage 3 Incomplete Report ==============

export async function saveStage3IncompleteReport(courseCode: string, report: Stage3IncompleteReport): Promise<void> {
  await artifactRepo.save(courseCode, T.stage3Incomplete, report, { stage: 'stage3' });
}

export async function getStage3IncompleteReport(courseCode: string): Promise<Stage3IncompleteReport | null> {
  return artifactRepo.get<Stage3IncompleteReport>(courseCode, T.stage3Incomplete);
}

// ============== Node Content (Markdown) ==============

export async function saveNodeContent(courseCode: string, nodeId: string, content: string): Promise<string> {
  await artifactRepo.save(courseCode, T.nodeContentMd, { content }, { stage: 'stage4', nodeId });
  return `${courseCode}/nodes/${nodeId}.md`;
}

export async function getNodeContent(courseCode: string, nodeId: string): Promise<string | null> {
  const row = await artifactRepo.get<{ content: string }>(courseCode, T.nodeContentMd, nodeId);
  return row?.content ?? null;
}

export async function getAllNodeContents(courseCode: string): Promise<Map<string, string>> {
  const rows = await artifactRepo.getAllByType<{ content: string }>(courseCode, T.nodeContentMd);
  const contents = new Map<string, string>();
  for (const r of rows) if (r.nodeId) contents.set(r.nodeId, r.data?.content ?? '');
  return contents;
}

export async function deleteNodeContents(courseCode: string): Promise<void> {
  await artifactRepo.removeByType(courseCode, T.nodeContentMd);
}

export async function nodeContentExists(courseCode: string, nodeId: string): Promise<boolean> {
  return artifactRepo.has(courseCode, T.nodeContentMd, nodeId);
}

export async function getExistingNodeIds(courseCode: string): Promise<string[]> {
  return artifactRepo.listNodeIds(courseCode, T.nodeContentMd);
}

// ============== Stage 4 Checkpoint ==============

export async function saveStage4Checkpoint(courseCode: string, checkpoint: Stage4Checkpoint): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4Checkpoint, checkpoint, { stage: 'stage4' });
}

export async function getStage4Checkpoint(courseCode: string): Promise<Stage4Checkpoint | null> {
  return artifactRepo.get<Stage4Checkpoint>(courseCode, T.stage4Checkpoint);
}

export async function deleteStage4Checkpoint(courseCode: string): Promise<void> {
  await artifactRepo.remove(courseCode, T.stage4Checkpoint);
}

// ============== Stage 4 Error Logging ==============

export async function appendStage4ErrorLog(courseCode: string, error: Stage4ErrorEntry): Promise<void> {
  const errors = (await artifactRepo.get<Stage4ErrorEntry[]>(courseCode, T.stage4ErrorLog)) ?? [];
  errors.push(error);
  await artifactRepo.save(courseCode, T.stage4ErrorLog, errors, { stage: 'stage4' });
}

export async function getStage4ErrorLog(courseCode: string): Promise<Stage4ErrorEntry[]> {
  return (await artifactRepo.get<Stage4ErrorEntry[]>(courseCode, T.stage4ErrorLog)) ?? [];
}

export async function clearStage4ErrorLog(courseCode: string): Promise<void> {
  await artifactRepo.remove(courseCode, T.stage4ErrorLog);
}

// ============== Compiled Output (binaries on disk) ==============

export function saveCompiledPDF(courseCode: string, pdfBuffer: Buffer): string {
  const dir = join(getCourseDir(courseCode), 'compiled');
  ensureDir(dir);
  const path = join(dir, `${courseCode}.pdf`);
  writeFileSync(path, pdfBuffer);
  void blobRepo.record({ courseCode, kind: 'compiled', docType: 'legacy', format: 'pdf', path, bytes: pdfBuffer.length });
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
  void blobRepo.record({ courseCode, kind: 'compiled', docType, format, path: filePath, bytes: buffer.length });
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

export function listCompiledDocuments(courseCode: string): { docType: CompiledDocType; format: CompiledDocFormat; path: string }[] {
  const docTypes: CompiledDocType[] = ['main-course', 'content', 'video-scripts', 'assessments', 'combined'];
  const formats: CompiledDocFormat[] = ['pdf', 'docx'];
  const results: { docType: CompiledDocType; format: CompiledDocFormat; path: string }[] = [];
  for (const dt of docTypes) {
    for (const fmt of formats) {
      const filePath = join(getCourseDir(courseCode), 'compiled', compiledDocFilename(courseCode, dt, fmt));
      if (existsSync(filePath)) results.push({ docType: dt, format: fmt, path: filePath });
    }
  }
  return results;
}

// ============== Upload Handling (binaries on disk) ==============

export function saveUploadedFile(courseCode: string, filename: string, buffer: Buffer): string {
  const dir = join(getCourseDir(courseCode), 'extracted');
  ensureDir(dir);
  const path = join(dir, filename);
  writeFileSync(path, buffer);
  void blobRepo.record({ courseCode, kind: 'upload', docType: filename, format: null, path, bytes: buffer.length });
  return path;
}

export function getUploadedFilePath(courseCode: string, filename: string): string | null {
  const path = join(getCourseDir(courseCode), 'extracted', filename);
  if (!existsSync(path)) return null;
  return path;
}

// ============== Course Confirmations ==============

export async function getConfirmations(courseCode: string): Promise<CourseConfirmations | null> {
  return artifactRepo.get<CourseConfirmations>(courseCode, T.confirmations);
}

export async function saveConfirmations(courseCode: string, confirmations: CourseConfirmations): Promise<void> {
  await artifactRepo.save(courseCode, T.confirmations, confirmations, { stage: 'stage1' });
}

export async function updateConfirmations(courseCode: string, updates: Partial<CourseConfirmations>): Promise<CourseConfirmations> {
  const existing = (await getConfirmations(courseCode)) || {};
  const updated = { ...existing, ...updates };
  await saveConfirmations(courseCode, updated);
  return updated;
}

export async function clearConfirmations(courseCode: string): Promise<void> {
  await artifactRepo.remove(courseCode, T.confirmations);
}

// ============== Stage 1 Internal Layers ==============

export async function getStage1LayersFile(courseCode: string): Promise<Stage1LayersFile | null> {
  return artifactRepo.get<Stage1LayersFile>(courseCode, T.stage1Layers);
}

export async function saveStage1LayersFile(courseCode: string, file: Stage1LayersFile): Promise<void> {
  await artifactRepo.save(courseCode, T.stage1Layers, file, { stage: 'stage1' });
}

export async function getStage1LayerState(courseCode: string, layerId: string): Promise<Stage1LayerState | null> {
  const file = await getStage1LayersFile(courseCode);
  return file?.layers.find((l) => l.layerId === layerId) ?? null;
}

export async function updateStage1LayerState(
  courseCode: string,
  layerId: string,
  updates: Partial<Stage1LayerState>
): Promise<Stage1LayerState> {
  const existing = await getStage1LayersFile(courseCode);
  const layers = existing?.layers ?? [];
  const index = layers.findIndex((l) => l.layerId === layerId);
  const current: Stage1LayerState =
    index >= 0 ? layers[index] : { layerId, status: 'not_started' as Stage1LayerStatus };

  const updated: Stage1LayerState = { ...current, ...updates, layerId };
  if (index >= 0) layers[index] = updated;
  else layers.push(updated);

  await saveStage1LayersFile(courseCode, { layers, updatedAt: new Date().toISOString() });
  return updated;
}

export async function getCloRefinementsFile(courseCode: string): Promise<CloRefinementsFile | null> {
  return artifactRepo.get<CloRefinementsFile>(courseCode, T.cloRefinements);
}

export async function saveCloRefinementsFile(courseCode: string, file: CloRefinementsFile): Promise<void> {
  await artifactRepo.save(courseCode, T.cloRefinements, file, { stage: 'stage1' });
}

export async function getAssessmentRedesignsFile(courseCode: string): Promise<AssessmentRedesignsFile | null> {
  return artifactRepo.get<AssessmentRedesignsFile>(courseCode, T.assessmentRedesigns);
}

export async function saveAssessmentRedesignsFile(courseCode: string, file: AssessmentRedesignsFile): Promise<void> {
  await artifactRepo.save(courseCode, T.assessmentRedesigns, file, { stage: 'stage1' });
}

export async function getWeightingRubricFile(courseCode: string): Promise<WeightingRubricFile | null> {
  return artifactRepo.get<WeightingRubricFile>(courseCode, T.weightingRubric);
}

export async function saveWeightingRubricFile(courseCode: string, file: WeightingRubricFile): Promise<void> {
  await artifactRepo.save(courseCode, T.weightingRubric, file, { stage: 'stage1' });
}

export async function getIntegrityReviewFile(courseCode: string): Promise<IntegrityReviewFile | null> {
  return artifactRepo.get<IntegrityReviewFile>(courseCode, T.integrityReview);
}

export async function saveIntegrityReviewFile(courseCode: string, file: IntegrityReviewFile): Promise<void> {
  await artifactRepo.save(courseCode, T.integrityReview, file, { stage: 'stage1' });
}

export async function getSubtopicArchitectureFile(courseCode: string): Promise<SubtopicArchitectureFile | null> {
  return artifactRepo.get<SubtopicArchitectureFile>(courseCode, T.subtopicArchitecture);
}

export async function saveSubtopicArchitectureFile(courseCode: string, file: SubtopicArchitectureFile): Promise<void> {
  await artifactRepo.save(courseCode, T.subtopicArchitecture, file, { stage: 'stage1' });
}

// ============================================================================
// STAGE 4 ENHANCED CONTENT MANAGEMENT
// ============================================================================

/** No-op: Stage 4 artifacts now live in Postgres (kept for call-site compatibility). */
export function initStage4Directories(_courseCode: string): void {
  /* no filesystem layout needed for JSONB-backed artifacts */
}

/** Delete all Stage 4 content for a course. */
export async function deleteStage4Content(courseCode: string): Promise<void> {
  await Promise.all([
    artifactRepo.removeByType(courseCode, T.stage4NodeContent),
    artifactRepo.removeByType(courseCode, T.stage4ModalityPlan),
    artifactRepo.removeByType(courseCode, T.stage4InstructionalPackage),
    artifactRepo.removeByType(courseCode, T.stage4DiagnosticAssessment),
    artifactRepo.removeByType(courseCode, T.stage4LLMInteractiveSpec),
    artifactRepo.removeByType(courseCode, T.stage4RemediationPack),
    artifactRepo.removeByType(courseCode, T.stage4VisualAssetSpecs),
    artifactRepo.removeByType(courseCode, T.stage4VideoProductionPackage),
    artifactRepo.removeByType(courseCode, T.stage4WorkloadMap),
    artifactRepo.removeByType(courseCode, T.stage4Rubric),
    artifactRepo.removeByType(courseCode, T.stage4LearnerInstructions),
    artifactRepo.removeByType(courseCode, T.stage4ContentPackSummary),
    artifactRepo.removeByType(courseCode, T.stage4SummativeAssessments),
    artifactRepo.removeByType(courseCode, T.stage4CourseBook),
    artifactRepo.removeByType(courseCode, T.stage4CourseBookMd),
    artifactRepo.removeByType(courseCode, T.stage4ValidationReport),
  ]);
  await deleteNodeContents(courseCode);
}

// ============== Stage 4 Node Content ==============

/** Conceptual key for a node's content pack (no longer a filesystem path). */
export function getStage4NodeContentPath(courseCode: string, nodeId: string): string {
  return `${courseCode}/stage4/nodes/${nodeId}/content.json`;
}

export async function saveStage4NodeContent(courseCode: string, nodeId: string, content: Stage4NodeContent): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4NodeContent, content, { stage: 'stage4', nodeId });
}

export async function getStage4NodeContent(courseCode: string, nodeId: string): Promise<Stage4NodeContent | null> {
  return artifactRepo.get<Stage4NodeContent>(courseCode, T.stage4NodeContent, nodeId);
}

export async function getStage4NodeInstructionalContent(courseCode: string, nodeId: string): Promise<string | null> {
  const pack = await getStage4NodeContent(courseCode, nodeId);
  return pack?.instructional_content || null;
}

export async function getExistingStage4NodeIds(courseCode: string): Promise<string[]> {
  return artifactRepo.listNodeIds(courseCode, T.stage4NodeContent);
}

export async function stage4NodeContentExists(courseCode: string, nodeId: string): Promise<boolean> {
  return artifactRepo.has(courseCode, T.stage4NodeContent, nodeId);
}

export async function getAllStage4InstructionalContents(courseCode: string): Promise<Map<string, string>> {
  const rows = await artifactRepo.getAllByType<Stage4NodeContent>(courseCode, T.stage4NodeContent);
  const contents = new Map<string, string>();
  for (const r of rows) if (r.nodeId && r.data?.instructional_content) contents.set(r.nodeId, r.data.instructional_content);
  return contents;
}

// ============== Stage 4 Workload Map ==============

export async function saveStage4WorkloadMap(courseCode: string, workloadMap: WorkloadMap): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4WorkloadMap, workloadMap, { stage: 'stage4' });
}

export async function getStage4WorkloadMap(courseCode: string): Promise<WorkloadMap | null> {
  return artifactRepo.get<WorkloadMap>(courseCode, T.stage4WorkloadMap);
}

// ============== Stage 4 Course Rubric ==============

export async function saveStage4Rubric(courseCode: string, rubric: CourseRubric): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4Rubric, rubric, { stage: 'stage4' });
}

export async function getStage4Rubric(courseCode: string): Promise<CourseRubric | null> {
  return artifactRepo.get<CourseRubric>(courseCode, T.stage4Rubric);
}

// ============== Stage 4 Learner Instructions ==============

export async function saveStage4LearnerInstructions(courseCode: string, instructions: string): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4LearnerInstructions, { instructions }, { stage: 'stage4' });
}

export async function getStage4LearnerInstructions(courseCode: string): Promise<string | null> {
  const row = await artifactRepo.get<{ instructions: string }>(courseCode, T.stage4LearnerInstructions);
  return row?.instructions ?? null;
}

// ============== Stage 4 Content Pack Summary ==============

export async function saveStage4ContentPackSummary(courseCode: string, summary: Stage4ContentPack): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4ContentPackSummary, summary, { stage: 'stage4' });
}

export async function getStage4ContentPackSummary(courseCode: string): Promise<Stage4ContentPack | null> {
  return artifactRepo.get<Stage4ContentPack>(courseCode, T.stage4ContentPackSummary);
}

// ============================================================================
// STAGE 4 ENHANCED ARTIFACTS — Steps A–G Persistence
// ============================================================================

export async function saveStage4ModalityPlan(courseCode: string, nodeId: string, plan: ModalityPlan): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4ModalityPlan, plan, { stage: 'stage4', nodeId });
}

export async function getStage4ModalityPlan(courseCode: string, nodeId: string): Promise<ModalityPlan | null> {
  return artifactRepo.get<ModalityPlan>(courseCode, T.stage4ModalityPlan, nodeId);
}

export async function saveStage4InstructionalPackage(courseCode: string, nodeId: string, pkg: NodeInstructionalPackage): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4InstructionalPackage, pkg, { stage: 'stage4', nodeId });
}

export async function getStage4InstructionalPackage(courseCode: string, nodeId: string): Promise<NodeInstructionalPackage | null> {
  return artifactRepo.get<NodeInstructionalPackage>(courseCode, T.stage4InstructionalPackage, nodeId);
}

export async function saveStage4DiagnosticAssessment(courseCode: string, nodeId: string, assessment: DiagnosticAssessment): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4DiagnosticAssessment, assessment, { stage: 'stage4', nodeId });
}

export async function getStage4DiagnosticAssessment(courseCode: string, nodeId: string): Promise<DiagnosticAssessment | null> {
  return artifactRepo.get<DiagnosticAssessment>(courseCode, T.stage4DiagnosticAssessment, nodeId);
}

export async function saveStage4LLMInteractiveSpec(courseCode: string, nodeId: string, spec: LLMInteractiveAssessmentSpec): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4LLMInteractiveSpec, spec, { stage: 'stage4', nodeId });
}

export async function getStage4LLMInteractiveSpec(courseCode: string, nodeId: string): Promise<LLMInteractiveAssessmentSpec | null> {
  return artifactRepo.get<LLMInteractiveAssessmentSpec>(courseCode, T.stage4LLMInteractiveSpec, nodeId);
}

export async function saveStage4SummativeAssessments(courseCode: string, pack: SummativeAssessmentPack): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4SummativeAssessments, pack, { stage: 'stage4' });
}

export async function getStage4SummativeAssessments(courseCode: string): Promise<SummativeAssessmentPack | null> {
  return artifactRepo.get<SummativeAssessmentPack>(courseCode, T.stage4SummativeAssessments);
}

export async function saveStage4RemediationPack(courseCode: string, nodeId: string, pack: NodeRemediationPack): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4RemediationPack, pack, { stage: 'stage4', nodeId });
}

export async function getStage4RemediationPack(courseCode: string, nodeId: string): Promise<NodeRemediationPack | null> {
  return artifactRepo.get<NodeRemediationPack>(courseCode, T.stage4RemediationPack, nodeId);
}

export async function saveStage4VisualAssetSpecs(courseCode: string, nodeId: string, specs: VisualAssetSpec[]): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4VisualAssetSpecs, specs, { stage: 'stage4', nodeId });
}

export async function getStage4VisualAssetSpecs(courseCode: string, nodeId: string): Promise<VisualAssetSpec[] | null> {
  return artifactRepo.get<VisualAssetSpec[]>(courseCode, T.stage4VisualAssetSpecs, nodeId);
}

export async function saveStage4VideoProductionPackage(courseCode: string, nodeId: string, pkg: VideoProductionPackage): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4VideoProductionPackage, pkg, { stage: 'stage4', nodeId });
}

export async function getStage4VideoProductionPackage(courseCode: string, nodeId: string): Promise<VideoProductionPackage | null> {
  return artifactRepo.get<VideoProductionPackage>(courseCode, T.stage4VideoProductionPackage, nodeId);
}

// ============== Step F: Course Book ==============

export async function saveStage4CourseBook(courseCode: string, book: CourseBook, markdown: string): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4CourseBook, book, { stage: 'stage4' });
  await artifactRepo.save(courseCode, T.stage4CourseBookMd, { markdown }, { stage: 'stage4' });
}

export async function getStage4CourseBook(courseCode: string): Promise<CourseBook | null> {
  return artifactRepo.get<CourseBook>(courseCode, T.stage4CourseBook);
}

export async function getStage4CourseBookMarkdown(courseCode: string): Promise<string | null> {
  const row = await artifactRepo.get<{ markdown: string }>(courseCode, T.stage4CourseBookMd);
  return row?.markdown ?? null;
}

// ============== Step G: Validation Report ==============

export async function saveStage4ValidationReport(courseCode: string, report: Stage4ValidationReport): Promise<void> {
  await artifactRepo.save(courseCode, T.stage4ValidationReport, report, { stage: 'stage4' });
}

export async function getStage4ValidationReport(courseCode: string): Promise<Stage4ValidationReport | null> {
  return artifactRepo.get<Stage4ValidationReport>(courseCode, T.stage4ValidationReport);
}

// ============== Stage 4 Combined Exports (enhanced) ==============

export async function getAllStage4Content(courseCode: string): Promise<{
  nodes: Map<string, Stage4NodeContent>;
  workloadMap: WorkloadMap | null;
  rubric: CourseRubric | null;
  learnerInstructions: string | null;
  summary: Stage4ContentPack | null;
  courseBook: CourseBook | null;
  summativeAssessments: SummativeAssessmentPack | null;
  validationReport: Stage4ValidationReport | null;
}> {
  const nodeRows = await artifactRepo.getAllByType<Stage4NodeContent>(courseCode, T.stage4NodeContent);
  const nodes = new Map<string, Stage4NodeContent>();
  for (const r of nodeRows) if (r.nodeId && r.data) nodes.set(r.nodeId, r.data);

  const [workloadMap, rubric, learnerInstructions, summary, courseBook, summativeAssessments, validationReport] =
    await Promise.all([
      getStage4WorkloadMap(courseCode),
      getStage4Rubric(courseCode),
      getStage4LearnerInstructions(courseCode),
      getStage4ContentPackSummary(courseCode),
      getStage4CourseBook(courseCode),
      getStage4SummativeAssessments(courseCode),
      getStage4ValidationReport(courseCode),
    ]);

  return { nodes, workloadMap, rubric, learnerInstructions, summary, courseBook, summativeAssessments, validationReport };
}

// ============================================================================
// STAGE 5A — Structural Assembly & Adaptive Logic Validation Persistence
// ============================================================================

export async function saveStage5aAdaptiveModel(courseCode: string, model: AdaptiveCourseModel): Promise<void> {
  await artifactRepo.save(courseCode, T.stage5aAdaptiveModel, model, { stage: 'stage5a' });
}

export async function getStage5aAdaptiveModel(courseCode: string): Promise<AdaptiveCourseModel | null> {
  return artifactRepo.get<AdaptiveCourseModel>(courseCode, T.stage5aAdaptiveModel);
}

export async function saveStage5aValidationReport(courseCode: string, report: Stage5AValidationReport): Promise<void> {
  await artifactRepo.save(courseCode, T.stage5aValidationReport, report, { stage: 'stage5a' });
}

export async function getStage5aValidationReport(courseCode: string): Promise<Stage5AValidationReport | null> {
  return artifactRepo.get<Stage5AValidationReport>(courseCode, T.stage5aValidationReport);
}

export async function saveStage5aReportMarkdown(courseCode: string, markdown: string): Promise<void> {
  await artifactRepo.save(courseCode, T.stage5aReportMd, { markdown }, { stage: 'stage5a' });
}

export async function getStage5aReportMarkdown(courseCode: string): Promise<string | null> {
  const row = await artifactRepo.get<{ markdown: string }>(courseCode, T.stage5aReportMd);
  return row?.markdown ?? null;
}

export async function deleteStage5aContent(courseCode: string): Promise<void> {
  await Promise.all([
    artifactRepo.remove(courseCode, T.stage5aAdaptiveModel),
    artifactRepo.remove(courseCode, T.stage5aValidationReport),
    artifactRepo.remove(courseCode, T.stage5aReportMd),
  ]);
}
