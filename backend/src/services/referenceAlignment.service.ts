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
import * as referenceRepo from '../db/repos/referenceRepo.js';
import { embedTexts } from './embedding.service.js';
import { resolveStoreForIndexing } from './referenceStore.service.js';
import { buildV1ContractBundle } from '../node-engine/stage1Adapter.service.js';
import { saveCourseArtifact, getCourseArtifact } from '../node-engine/store.service.js';

const ARTIFACT_FILE = 'reference-alignment.json';

/** Cautious default: a chunk is proposed for a subtopic/CLO only when cosine
 * similarity meets this. Below it, the chunk stays course-level (untagged) so the
 * safety net still grounds, and we avoid confidently-wrong scoping. */
export const DEFAULT_ALIGNMENT_THRESHOLD = 0.34;

/** Default threshold for auto-propose / SME re-propose on multi-source corpora. */
export const DEFAULT_PROPOSE_ALIGNMENT_THRESHOLD = 0.42;

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
  /** @deprecated Prefer active_tagged_chunk_count — kept for backward compatibility (= active). */
  tagged_chunk_count: number;
  /** Scope tags actually written in the DB — what node generation uses today. */
  active_tagged_chunk_count: number;
  /** Tags in the current proposal artifact (preview only until approved). */
  proposed_tagged_chunk_count?: number;
  threshold: number;
  generated_at?: string;
  approved_at?: string;
  approved_by?: string;
  /** Latest reference document upload time in the corpus. */
  corpus_updated_at?: string;
  /** Corpus changed since last approval — must re-propose and re-approve. */
  is_stale: boolean;
  stale_reason?: string;
  /** Proposal exists but tags are not yet written to the DB. */
  pending_activation: boolean;
  /** Safe to run node generation (approved + not stale). */
  node_gen_ready: boolean;
  /** Per-source active vs preview tag counts for SME spot-checks. */
  per_document_tag_summary?: AlignmentDocTagSummary[];
}

export interface AlignmentDocTagSummary {
  doc_id: string;
  title: string;
  active_tagged_chunks: number;
  proposed_tagged_chunks?: number;
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

/** Count chunks with scope tags actually persisted in the DB. */
export async function countActiveTaggedChunks(courseCode: string): Promise<number> {
  const chunks = await referenceRepo.getAllChunks(courseCode);
  return chunks.filter((c) => c.subtopic_ids.length > 0 || c.clo_ids.length > 0).length;
}

/** Roll active DB tags and optional proposal preview up by source document. */
export async function buildPerDocumentTagSummary(
  courseCode: string,
  documents: Awaited<ReturnType<typeof referenceRepo.listDocuments>>,
  proposal?: ReferenceAlignmentArtifact | null
): Promise<AlignmentDocTagSummary[]> {
  const chunks = await referenceRepo.getAllChunks(courseCode);
  const activeByDoc = new Map<string, number>();
  for (const chunk of chunks) {
    if (chunk.subtopic_ids.length > 0 || chunk.clo_ids.length > 0) {
      activeByDoc.set(chunk.doc_id, (activeByDoc.get(chunk.doc_id) ?? 0) + 1);
    }
  }

  const proposedByDoc = new Map<string, number>();
  if (proposal?.status === 'proposed') {
    for (const mapping of proposal.mappings) {
      if (mapping.decided_subtopic_ids.length > 0 || mapping.decided_clo_ids.length > 0) {
        proposedByDoc.set(mapping.doc_id, (proposedByDoc.get(mapping.doc_id) ?? 0) + 1);
      }
    }
  }

  return documents.map((doc) => ({
    doc_id: doc.doc_id,
    title: doc.title || doc.citation_label || doc.original_filename,
    active_tagged_chunks: activeByDoc.get(doc.doc_id) ?? 0,
    proposed_tagged_chunks:
      proposal?.status === 'proposed' ? (proposedByDoc.get(doc.doc_id) ?? 0) : undefined,
  }));
}

export interface AlignmentStalenessInput {
  artifactStatus?: AlignmentStatus;
  approved_at?: string;
  proposal_generated_at?: string;
  corpus_updated_at?: string;
  approved_chunk_count?: number;
  current_chunk_count: number;
  approved_doc_count?: number;
  current_doc_count: number;
}

/**
 * Pure staleness check: alignment tags are out of date relative to the live corpus
 * or an unapproved proposal preview.
 */
export function computeAlignmentStaleness(input: AlignmentStalenessInput): {
  is_stale: boolean;
  stale_reason?: string;
} {
  const {
    artifactStatus,
    approved_at,
    proposal_generated_at,
    corpus_updated_at,
    approved_chunk_count,
    current_chunk_count,
    approved_doc_count,
    current_doc_count,
  } = input;

  if (artifactStatus === 'approved') {
    if (approved_at && corpus_updated_at && corpus_updated_at > approved_at) {
      return {
        is_stale: true,
        stale_reason:
          'New or updated references were added after the last alignment approval. Preview tag changes and activate them again.',
      };
    }
    if (
      typeof approved_chunk_count === 'number' &&
      approved_chunk_count > 0 &&
      approved_chunk_count !== current_chunk_count
    ) {
      return {
        is_stale: true,
        stale_reason:
          'The reference corpus size changed since alignment was approved. Preview tag changes and activate them again.',
      };
    }
    if (
      typeof approved_doc_count === 'number' &&
      approved_doc_count > 0 &&
      approved_doc_count !== current_doc_count
    ) {
      return {
        is_stale: true,
        stale_reason:
          'Reference documents changed since alignment was approved. Preview tag changes and activate them again.',
      };
    }
    return { is_stale: false };
  }

  if (artifactStatus === 'proposed') {
    if (proposal_generated_at && corpus_updated_at && corpus_updated_at > proposal_generated_at) {
      return {
        is_stale: true,
        stale_reason:
          'New references were added after this preview was generated. Preview tag changes again before activating.',
      };
    }
    return { is_stale: false };
  }

  return { is_stale: false };
}

/** Resolve the live dependency/status for Layer 7 without generating anything. */
export async function getAlignmentState(courseCode: string): Promise<AlignmentStateSummary> {
  const bundle = await buildV1ContractBundle(courseCode);
  const approvedSubtopics = bundle.subtopics.filter((s) => s.status === 'approved');
  const documents = await referenceRepo.listDocuments(courseCode);
  const referenceDocCount = documents.length;
  const chunkCount = await referenceRepo.countChunks(courseCode);
  const activeTaggedChunkCount = await countActiveTaggedChunks(courseCode);
  const existing = await getCourseArtifact<ReferenceAlignmentArtifact>(courseCode, ARTIFACT_FILE);

  const corpusUpdatedAt =
    documents.length > 0
      ? documents.reduce((max, d) => (d.uploaded_at > max ? d.uploaded_at : max), documents[0].uploaded_at)
      : undefined;

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

  const { is_stale, stale_reason } = computeAlignmentStaleness({
    artifactStatus: existing?.status,
    approved_at: existing?.approved_at,
    proposal_generated_at: existing?.generated_at,
    corpus_updated_at: corpusUpdatedAt,
    approved_chunk_count: existing?.chunk_count,
    current_chunk_count: chunkCount,
    approved_doc_count: existing?.reference_doc_count,
    current_doc_count: referenceDocCount,
  });

  const pending_activation = status === 'proposed';
  const node_gen_ready = status === 'approved' && !is_stale && activeTaggedChunkCount > 0;
  const per_document_tag_summary = await buildPerDocumentTagSummary(courseCode, documents, existing);

  return {
    status,
    lock_reason,
    subtopic_count: approvedSubtopics.length,
    reference_doc_count: referenceDocCount,
    chunk_count: chunkCount,
    tagged_chunk_count: activeTaggedChunkCount,
    active_tagged_chunk_count: activeTaggedChunkCount,
    proposed_tagged_chunk_count:
      existing?.status === 'proposed' ? existing.tagged_chunk_count : undefined,
    threshold: existing?.threshold ?? DEFAULT_ALIGNMENT_THRESHOLD,
    generated_at: existing?.generated_at,
    approved_at: existing?.approved_at,
    approved_by: existing?.approved_by,
    corpus_updated_at: corpusUpdatedAt,
    is_stale,
    stale_reason,
    pending_activation,
    node_gen_ready,
    per_document_tag_summary,
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

  const state = await getAlignmentState(courseCode);
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
    await saveCourseArtifact(courseCode, ARTIFACT_FILE, artifact);
    return artifact;
  }

  const bundle = await buildV1ContractBundle(courseCode);
  const subtopics = bundle.subtopics.filter((s) => s.status === 'approved');
  const clos = bundle.clos;
  const chunks = await referenceRepo.getAllChunks(courseCode);

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
  await saveCourseArtifact(courseCode, ARTIFACT_FILE, artifact);
  return artifact;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Read the current alignment proposal artifact (null when none generated). */
export async function getAlignmentProposal(courseCode: string): Promise<ReferenceAlignmentArtifact | null> {
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
export async function updateAlignmentMapping(
  courseCode: string,
  edits: AlignmentMappingEdit[]
): Promise<ReferenceAlignmentArtifact> {
  const artifact = await getAlignmentProposal(courseCode);
  if (!artifact) {
    throw new Error(`No alignment proposal for course "${courseCode}". Run propose first.`);
  }
  const byChunk = new Map(artifact.mappings.map((m) => [m.chunk_id, m]));

  // Build the V1 bundle lazily — only when an edit needs CLO inheritance.
  const needsInheritance = edits.some((e) => !e.clo_ids);
  const subtopicCloIndex = new Map<string, string[]>();
  if (needsInheritance) {
    for (const s of (await buildV1ContractBundle(courseCode)).subtopics) subtopicCloIndex.set(s.subtopic_id, s.clo_ids);
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
  await saveCourseArtifact(courseCode, ARTIFACT_FILE, artifact);
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
  const artifact = await getAlignmentProposal(courseCode);
  if (!artifact) {
    throw new Error(`No alignment proposal for course "${courseCode}". Run propose first.`);
  }
  if (artifact.mappings.length === 0) {
    throw new Error(`Alignment proposal for "${courseCode}" has no mappings to approve.`);
  }

  const decisionByChunk = new Map(artifact.mappings.map((m) => [m.chunk_id, m]));

  const documents = await referenceRepo.listDocuments(courseCode);

  const updatedAcrossDocs: ReferenceChunk[] = [];
  let dimensions = artifact.embedding_dimensions;

  for (const doc of documents) {
    const docId = doc.doc_id;
    const chunks = await referenceRepo.getChunksByDoc(docId);
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

    await referenceRepo.upsertChunks(chunks);
    updatedAcrossDocs.push(...chunks);

    // Roll the doc-level scope summary up into the document metadata.
    doc.scope = { clo_ids: [...docCloIds], subtopic_ids: [...docSubtopicIds] };
    await referenceRepo.saveDocument(doc);
  }

  // Re-index the updated tags into pgvector (ensures the HNSW index too).
  if (updatedAcrossDocs.length > 0 && dimensions > 0) {
    const store = await resolveStoreForIndexing(dimensions);
    await store.indexChunks(updatedAcrossDocs);
  }

  artifact.status = 'approved';
  artifact.approved_at = new Date().toISOString();
  artifact.approved_by = input.approver;
  artifact.tagged_chunk_count = artifact.mappings.filter(
    (m) => m.decided_subtopic_ids.length > 0 || m.decided_clo_ids.length > 0
  ).length;
  await saveCourseArtifact(courseCode, ARTIFACT_FILE, artifact);
  return artifact;
}
