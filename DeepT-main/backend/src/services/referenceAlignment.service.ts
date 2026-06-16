/**
 * Reference Alignment — Course Architect "Layer 7" (the real grounding fix).
 *
 * Reference chunks are ingested with EMPTY scope tags (`clo_ids: []`,
 * `subtopic_ids: []`), so M7's CLO/subtopic-scoped retrieval matches nothing and
 * grounding comes back empty. This service tags chunks to CLOs/subtopics so
 * scoped retrieval returns real passages.
 *
 * It is a CAUTIOUS, REVIEWABLE, ON-DEMAND SME step — never automatic:
 *  - `proposeAlignment` embeds per-CLO and per-subtopic query text and cosine-
 *    compares against the chunks' already-persisted embeddings (no re-embedding
 *    of the textbook), proposing tags only above a cautious threshold; everything
 *    below stays course-level (untagged). It writes a reviewable mapping artifact.
 *  - `updateAlignmentMapping` lets an SME promote / demote-to-course-level /
 *    reassign a chunk before approval.
 *  - `approveAlignment` writes the approved scope tags back into the chunks,
 *    re-indexes them, and updates the manifest doc scopes.
 *
 * Scope guards: keeps the existing OpenAI `text-embedding-3-small` embeddings;
 * "Layer 7 / Reference Alignment" is user-facing display only; Course Architect
 * Layers 1-6 logic is untouched.
 */
import type { ReferenceChunk } from '../models/schemas.js';
import * as fileService from './file.service.js';
import { embedTexts } from './embedding.service.js';
import { resolveStoreForIndexing } from './referenceStore.service.js';
import { buildV1ContractBundle } from '../node-engine/stage1Adapter.service.js';
import { saveCourseArtifact, getCourseArtifact } from '../node-engine/store.service.js';

const ARTIFACT_FILE = 'reference-alignment.json';

/** Cautious default: a chunk is proposed for a subtopic/CLO only when cosine
 * similarity meets this. Below it, the chunk stays course-level (untagged) so the
 * safety net still grounds, and we avoid confidently-wrong scoping. */
export const DEFAULT_ALIGNMENT_THRESHOLD = 0.34;

// ===========================================================================
// Types
// ===========================================================================

export interface AlignmentCandidate {
  id: string;
  label: string;
  score: number;
}

/** One reviewable chunk → CLO/subtopic mapping. `decided_*` is the current
 * decision (starts from the proposal; SME edits move it). */
export interface AlignmentChunkMapping {
  chunk_id: string;
  doc_id: string;
  citation: string;
  text_preview: string;
  /** Ranked subtopic candidates with confidence (best first). */
  subtopic_candidates: AlignmentCandidate[];
  /** Ranked CLO candidates with confidence (best first). */
  clo_candidates: AlignmentCandidate[];
  /** Top similarity seen for this chunk (review signal). */
  confidence: number;
  /** Current decision (what `approveAlignment` will write). */
  decided_subtopic_ids: string[];
  decided_clo_ids: string[];
  /** True when the SME has edited this mapping away from the proposal. */
  edited?: boolean;
}

export type AlignmentStatus =
  | 'locked' // Layer 6 subtopics not approved yet
  | 'no_references' // no reference docs uploaded
  | 'available' // ready to propose
  | 'proposed' // proposal generated, awaiting review/approval
  | 'approved'; // tags written + re-indexed

export interface ReferenceAlignmentArtifact {
  course_code: string;
  status: AlignmentStatus;
  threshold: number;
  embedding_model: string;
  embedding_dimensions: number;
  subtopic_count: number;
  reference_doc_count: number;
  chunk_count: number;
  /** Chunks with at least one proposed/decided tag. */
  tagged_chunk_count: number;
  generated_at?: string;
  approved_at?: string;
  approved_by?: string;
  mappings: AlignmentChunkMapping[];
  lock_reason?: string;
}

export interface AlignmentStateSummary {
  status: AlignmentStatus;
  lock_reason?: string;
  subtopic_count: number;
  reference_doc_count: number;
  chunk_count: number;
  tagged_chunk_count: number;
  threshold: number;
  generated_at?: string;
  approved_at?: string;
  approved_by?: string;
}

// ===========================================================================
// Helpers
// ===========================================================================

function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function subtopicQueryText(s: {
  title: string;
  purpose: string;
  expected_learning: string;
  assessment_connection: string[];
}): string {
  return [s.title, s.purpose, s.expected_learning, (s.assessment_connection ?? []).join(' ')]
    .filter(Boolean)
    .join('. ')
    .trim();
}

/** Resolve the live dependency/status for Layer 7 without generating anything. */
export function getAlignmentState(courseCode: string): AlignmentStateSummary {
  const bundle = buildV1ContractBundle(courseCode);
  const approvedSubtopics = bundle.subtopics.filter((s) => s.status === 'approved');
  const manifest = fileService.getReferenceManifest(courseCode);
  const referenceDocCount = manifest?.documents.length ?? 0;
  const chunkCount = fileService.getAllReferenceChunks(courseCode).length;
  const existing = getCourseArtifact<ReferenceAlignmentArtifact>(courseCode, ARTIFACT_FILE);

  let status: AlignmentStatus;
  let lock_reason: string | undefined;
  if (approvedSubtopics.length === 0) {
    status = 'locked';
    lock_reason = 'Approve subtopics first (Course Architect Layer 6) before aligning references.';
  } else if (referenceDocCount === 0 || chunkCount === 0) {
    status = 'no_references';
    lock_reason =
      'No references uploaded — node generation will be model-only and not academically approvable. Upload references to enable grounding.';
  } else if (existing?.status === 'approved') {
    status = 'approved';
  } else if (existing?.status === 'proposed') {
    status = 'proposed';
  } else {
    status = 'available';
  }

  return {
    status,
    lock_reason,
    subtopic_count: approvedSubtopics.length,
    reference_doc_count: referenceDocCount,
    chunk_count: chunkCount,
    tagged_chunk_count: existing?.tagged_chunk_count ?? 0,
    threshold: existing?.threshold ?? DEFAULT_ALIGNMENT_THRESHOLD,
    generated_at: existing?.generated_at,
    approved_at: existing?.approved_at,
    approved_by: existing?.approved_by,
  };
}

// ===========================================================================
// Propose
// ===========================================================================

export interface ProposeAlignmentOptions {
  /** Cautious similarity threshold (default DEFAULT_ALIGNMENT_THRESHOLD). */
  threshold?: number;
  /** Max candidates to surface per chunk for SME review (default 3). */
  maxCandidates?: number;
}

/**
 * Build a CAUTIOUS, reviewable chunk → CLO/subtopic mapping by cosine-comparing
 * the chunks' persisted embeddings against freshly-embedded CLO/subtopic query
 * text. Proposes a tag only when score >= threshold; low-confidence chunks stay
 * course-level (untagged). Writes + returns the reviewable artifact. Never writes
 * scope tags to the chunks — that only happens on approve.
 */
export async function proposeAlignment(
  courseCode: string,
  options: ProposeAlignmentOptions = {}
): Promise<ReferenceAlignmentArtifact> {
  const threshold = options.threshold ?? DEFAULT_ALIGNMENT_THRESHOLD;
  const maxCandidates = options.maxCandidates ?? 3;

  const state = getAlignmentState(courseCode);
  if (state.status === 'locked' || state.status === 'no_references') {
    const artifact: ReferenceAlignmentArtifact = {
      course_code: courseCode,
      status: state.status,
      threshold,
      embedding_model: '',
      embedding_dimensions: 0,
      subtopic_count: state.subtopic_count,
      reference_doc_count: state.reference_doc_count,
      chunk_count: state.chunk_count,
      tagged_chunk_count: 0,
      mappings: [],
      lock_reason: state.lock_reason,
    };
    saveCourseArtifact(courseCode, ARTIFACT_FILE, artifact);
    return artifact;
  }

  const bundle = buildV1ContractBundle(courseCode);
  const subtopics = bundle.subtopics.filter((s) => s.status === 'approved');
  const clos = bundle.clos;
  const chunks = fileService.getAllReferenceChunks(courseCode);

  // Embed CLO + subtopic query text (the only new embedding work — chunks already
  // carry persisted embeddings).
  const subtopicTexts = subtopics.map((s) => subtopicQueryText(s));
  const cloTexts = clos.map((c) => c.statement);
  const { vectors: subtopicVectors, model, dimensions } = await embedTexts([...subtopicTexts, ...cloTexts]);
  const stVecs = subtopicVectors.slice(0, subtopics.length);
  const cloVecs = subtopicVectors.slice(subtopics.length);

  const mappings: AlignmentChunkMapping[] = chunks.map((chunk) => {
    const subtopicScores = subtopics
      .map((s, i) => ({ id: s.subtopic_id, label: s.title, score: cosine(chunk.embedding, stVecs[i] ?? []) }))
      .sort((a, b) => b.score - a.score);
    const cloScores = clos
      .map((c, i) => ({ id: c.clo_id, label: c.statement.slice(0, 60), score: cosine(chunk.embedding, cloVecs[i] ?? []) }))
      .sort((a, b) => b.score - a.score);

    const decidedSubtopics = subtopicScores.filter((s) => s.score >= threshold).map((s) => s.id);
    // CLO tags inherit from the chosen subtopics' CLOs, plus any directly-strong CLO.
    const inheritedCloIds = new Set<string>();
    for (const stId of decidedSubtopics) {
      const st = subtopics.find((s) => s.subtopic_id === stId);
      for (const cloId of st?.clo_ids ?? []) inheritedCloIds.add(cloId);
    }
    for (const c of cloScores) if (c.score >= threshold) inheritedCloIds.add(c.id);

    const topScore = Math.max(subtopicScores[0]?.score ?? 0, cloScores[0]?.score ?? 0);

    return {
      chunk_id: chunk.chunk_id,
      doc_id: chunk.doc_id,
      citation: chunk.citation,
      text_preview: chunk.text.slice(0, 200),
      subtopic_candidates: subtopicScores.slice(0, maxCandidates).map((s) => ({ ...s, score: round(s.score) })),
      clo_candidates: cloScores.slice(0, maxCandidates).map((c) => ({ ...c, score: round(c.score) })),
      confidence: round(topScore),
      decided_subtopic_ids: decidedSubtopics,
      decided_clo_ids: [...inheritedCloIds],
    };
  });

  const taggedChunkCount = mappings.filter((m) => m.decided_subtopic_ids.length > 0 || m.decided_clo_ids.length > 0).length;

  const artifact: ReferenceAlignmentArtifact = {
    course_code: courseCode,
    status: 'proposed',
    threshold,
    embedding_model: model,
    embedding_dimensions: dimensions,
    subtopic_count: subtopics.length,
    reference_doc_count: state.reference_doc_count,
    chunk_count: chunks.length,
    tagged_chunk_count: taggedChunkCount,
    generated_at: new Date().toISOString(),
    mappings,
  };
  saveCourseArtifact(courseCode, ARTIFACT_FILE, artifact);
  return artifact;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Read the current alignment proposal artifact (null when none generated). */
export function getAlignmentProposal(courseCode: string): ReferenceAlignmentArtifact | null {
  return getCourseArtifact<ReferenceAlignmentArtifact>(courseCode, ARTIFACT_FILE);
}

// ===========================================================================
// Update (SME review)
// ===========================================================================

export interface AlignmentMappingEdit {
  chunk_id: string;
  /** New decided subtopic ids (replaces). Empty array demotes to course-level. */
  subtopic_ids: string[];
  /** New decided CLO ids (replaces). When omitted, CLOs are inherited from subtopics. */
  clo_ids?: string[];
}

/**
 * Apply SME edits to the proposal (promote / demote-to-course-level / reassign).
 * Does NOT touch the chunks — only the reviewable artifact. Approval is separate.
 */
export function updateAlignmentMapping(
  courseCode: string,
  edits: AlignmentMappingEdit[]
): ReferenceAlignmentArtifact {
  const artifact = getAlignmentProposal(courseCode);
  if (!artifact) {
    throw new Error(`No alignment proposal for course "${courseCode}". Run propose first.`);
  }
  const byChunk = new Map(artifact.mappings.map((m) => [m.chunk_id, m]));

  // Build the V1 bundle lazily — only when an edit needs CLO inheritance.
  const needsInheritance = edits.some((e) => !e.clo_ids);
  const subtopicCloIndex = new Map<string, string[]>();
  if (needsInheritance) {
    for (const s of buildV1ContractBundle(courseCode).subtopics) subtopicCloIndex.set(s.subtopic_id, s.clo_ids);
  }

  for (const edit of edits) {
    const mapping = byChunk.get(edit.chunk_id);
    if (!mapping) continue;
    mapping.decided_subtopic_ids = [...new Set(edit.subtopic_ids)];
    if (edit.clo_ids) {
      mapping.decided_clo_ids = [...new Set(edit.clo_ids)];
    } else {
      // Inherit CLOs from the chosen subtopics.
      const inherited = new Set<string>();
      for (const stId of mapping.decided_subtopic_ids) {
        for (const cloId of subtopicCloIndex.get(stId) ?? []) inherited.add(cloId);
      }
      mapping.decided_clo_ids = [...inherited];
    }
    mapping.edited = true;
  }

  artifact.tagged_chunk_count = artifact.mappings.filter(
    (m) => m.decided_subtopic_ids.length > 0 || m.decided_clo_ids.length > 0
  ).length;
  artifact.status = 'proposed';
  saveCourseArtifact(courseCode, ARTIFACT_FILE, artifact);
  return artifact;
}

// ===========================================================================
// Approve (write tags + re-index + manifest)
// ===========================================================================

export interface ApproveAlignmentInput {
  approver: string;
}

/**
 * Write the decided scope tags back into the chunks, re-index them, and update
 * each manifest doc's scope. After this, M7's CLO/subtopic-scoped retrieval
 * returns real passages.
 */
export async function approveAlignment(
  courseCode: string,
  input: ApproveAlignmentInput
): Promise<ReferenceAlignmentArtifact> {
  const artifact = getAlignmentProposal(courseCode);
  if (!artifact) {
    throw new Error(`No alignment proposal for course "${courseCode}". Run propose first.`);
  }
  if (artifact.mappings.length === 0) {
    throw new Error(`Alignment proposal for "${courseCode}" has no mappings to approve.`);
  }

  const decisionByChunk = new Map(artifact.mappings.map((m) => [m.chunk_id, m]));

  const manifest = fileService.getReferenceManifest(courseCode);
  const docIds = manifest ? manifest.documents.map((d) => d.doc_id) : [];

  const updatedAcrossDocs: ReferenceChunk[] = [];
  let dimensions = artifact.embedding_dimensions;

  for (const docId of docIds) {
    const chunks = fileService.getReferenceChunks(courseCode, docId);
    if (chunks.length === 0) continue;

    const docCloIds = new Set<string>();
    const docSubtopicIds = new Set<string>();

    for (const chunk of chunks) {
      const decision = decisionByChunk.get(chunk.chunk_id);
      // Chunks not in the proposal keep their existing tags (defensive).
      chunk.clo_ids = decision ? [...decision.decided_clo_ids] : chunk.clo_ids;
      chunk.subtopic_ids = decision ? [...decision.decided_subtopic_ids] : chunk.subtopic_ids;
      for (const id of chunk.clo_ids) docCloIds.add(id);
      for (const id of chunk.subtopic_ids) docSubtopicIds.add(id);
      if (chunk.embedding.length > 0) dimensions = chunk.embedding.length;
    }

    fileService.saveReferenceChunks(courseCode, docId, chunks);
    updatedAcrossDocs.push(...chunks);

    // Roll the doc-level scope summary up into the manifest.
    if (manifest) {
      const doc = manifest.documents.find((d) => d.doc_id === docId);
      if (doc) {
        doc.scope = { clo_ids: [...docCloIds], subtopic_ids: [...docSubtopicIds] };
      }
    }
  }

  // Re-index. JSON backend reads chunks live (no-op); Neo4j upserts the new tags.
  if (updatedAcrossDocs.length > 0 && dimensions > 0) {
    const store = await resolveStoreForIndexing(dimensions);
    await store.indexChunks(updatedAcrossDocs);
  }

  if (manifest) {
    manifest.updated_at = new Date().toISOString();
    fileService.saveReferenceManifest(courseCode, manifest);
  }

  artifact.status = 'approved';
  artifact.approved_at = new Date().toISOString();
  artifact.approved_by = input.approver;
  artifact.tagged_chunk_count = artifact.mappings.filter(
    (m) => m.decided_subtopic_ids.length > 0 || m.decided_clo_ids.length > 0
  ).length;
  saveCourseArtifact(courseCode, ARTIFACT_FILE, artifact);
  return artifact;
}
