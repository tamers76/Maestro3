import type {
  ArchitectureSubtopic,
  BloomLevel,
  CloTopics,
  SubtopicArchitectureCourseSummary,
  SubtopicArchitectureFile,
  SubtopicArchitectureReviewSummary,
  SubtopicCloSection,
  SubtopicCrossCloLink,
  SubtopicEffort,
  SubtopicLearningFunction,
  SubtopicRecommendation,
  TopicItem,
} from '../models/schemas.js';
import * as fileService from './file.service.js';
import * as referenceRepo from '../db/repos/referenceRepo.js';
import * as artifactRepo from '../db/repos/artifactRepo.js';
import { retrieveReferenceChunks } from './referenceRetrieval.service.js';
import { getCloRefinementContext } from './cloRefinements.service.js';
import { getWeightingRubricContext } from './weightingRubric.service.js';

const LAYER6_ID = 'layer6-subtopic-architecture';

// ----------------------------------------------------------------------------
// Generic raw-JSON pickers (mirror integrityReview.service.ts)
// ----------------------------------------------------------------------------

function pickString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

function pickObject(raw: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = raw[key];
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

function pickArray(raw: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const v = raw[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function pickStringArray(raw: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const v = raw[key];
    if (Array.isArray(v)) {
      return v.map((e) => (typeof e === 'string' ? e.trim() : '')).filter((e): e is string => !!e);
    }
    if (typeof v === 'string' && v.trim()) return [v.trim()];
  }
  return [];
}

// ----------------------------------------------------------------------------
// Enum normalizers
// ----------------------------------------------------------------------------

function normalizeLearningFunction(value: unknown): SubtopicLearningFunction {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (v.includes('assessment')) return 'assessment_preparation';
    if (v.includes('bridge')) return 'bridge';
    if (v.includes('integrat')) return 'integrative';
    if (v.includes('appl')) return 'applied';
    if (v.includes('found')) return 'foundational';
  }
  return 'foundational';
}

function normalizeEffort(value: unknown): SubtopicEffort {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v.includes('high') || v.includes('advanced')) return 'high';
    if (v.includes('low') || v.includes('basic') || v.includes('begin')) return 'low';
    if (v.includes('moderate') || v.includes('medium') || v.includes('intermediate')) return 'moderate';
  }
  return 'moderate';
}

function normalizeRecommendation(value: unknown): SubtopicRecommendation {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v.includes('merge')) return 'merge';
    if (v.includes('split')) return 'split';
    if (v.includes('move')) return 'move';
    if (v.includes('remove') || v.includes('delete')) return 'remove';
    if (v.includes('keep')) return 'keep';
  }
  return 'keep';
}

function normalizeCrossLinks(value: unknown): SubtopicCrossCloLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((e) => {
      if (typeof e === 'string') return { linked_clo_id: e.trim(), reason: '' };
      if (e && typeof e === 'object') {
        const r = e as Record<string, unknown>;
        return {
          linked_clo_id: pickString(r, ['linked_clo_id', 'clo_id', 'id']) || '',
          reason: pickString(r, ['reason', 'why']) || '',
        };
      }
      return { linked_clo_id: '', reason: '' };
    })
    .filter((l) => l.linked_clo_id);
}

// ----------------------------------------------------------------------------
// Parse AI output (supports new clo_sections shape + legacy clo_subtopics shape)
// ----------------------------------------------------------------------------

interface ParsedSection {
  clo_id: string;
  refined_clo?: string;
  related_assessments?: string[];
  clo_learning_journey_summary?: string;
  subtopics: Partial<ArchitectureSubtopic>[];
}

interface ParsedArchitecture {
  course: Partial<SubtopicArchitectureCourseSummary>;
  sectionsById: Map<string, ParsedSection>;
}

function mapRawSubtopic(raw: Record<string, unknown>): Partial<ArchitectureSubtopic> {
  return {
    subtopic_id: pickString(raw, ['subtopic_id', 'id']),
    proposed_subtopic: pickString(raw, ['proposed_subtopic', 'subtopic_title', 'title']),
    purpose: pickString(raw, ['purpose', 'subtopic_description', 'description']),
    clo_alignment: pickString(raw, ['clo_alignment']),
    assessment_connection: pickStringArray(raw, ['assessment_connection', 'assessment_alignment']),
    learning_function: normalizeLearningFunction(raw.learning_function),
    expected_learning: pickString(raw, ['expected_learning', 'learning_objective']),
    possible_node_families: pickStringArray(raw, ['possible_node_families', 'node_families']),
    cross_clo_links: normalizeCrossLinks(raw.cross_clo_links ?? raw.cross_clo_connections),
    adaptive_value: pickString(raw, ['adaptive_value']),
    estimated_learning_effort: normalizeEffort(raw.estimated_learning_effort ?? raw.content_complexity),
    source_evidence: pickStringArray(raw, ['source_evidence']),
    recommendation: normalizeRecommendation(raw.recommendation),
  };
}

function parseAiArchitecture(outputJson: unknown): ParsedArchitecture {
  const root = (outputJson && typeof outputJson === 'object' ? outputJson : {}) as Record<
    string,
    unknown
  >;

  const archRoot = pickObject(root, 'self_paced_subtopic_architecture') ?? root;
  const courseRaw = pickObject(archRoot, 'course_summary') ?? {};

  const course: Partial<SubtopicArchitectureCourseSummary> = {
    course_title: pickString(courseRaw, ['course_title', 'title']),
    architecture_summary: pickString(courseRaw, ['architecture_summary', 'summary']),
    source_evidence_note: pickString(courseRaw, ['source_evidence_note']),
    full_report:
      pickString(courseRaw, ['full_report']) ||
      pickString(root, ['report_markdown', 'full_report']),
  };

  const sectionsById = new Map<string, ParsedSection>();

  // New shape: clo_sections[].subtopics[]
  const sectionsRaw = pickArray(archRoot, ['clo_sections']);
  // Legacy shape: clo_subtopics[].topics[]
  const legacyRaw = pickArray(archRoot, ['clo_subtopics']).length
    ? pickArray(archRoot, ['clo_subtopics'])
    : pickArray(root, ['clo_subtopics']);

  const source = sectionsRaw.length ? sectionsRaw : legacyRaw;

  source
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .forEach((rawSection, si) => {
      const cloId = pickString(rawSection, ['clo_id', 'id']) || `CLO-${si + 1}`;
      const subtopicsRaw = pickArray(rawSection, ['subtopics', 'topics']);
      const subtopics = subtopicsRaw
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map(mapRawSubtopic)
        .filter((s) => s.proposed_subtopic);

      sectionsById.set(cloId, {
        clo_id: cloId,
        refined_clo: pickString(rawSection, ['refined_clo', 'clo_text']),
        related_assessments: pickStringArray(rawSection, ['related_assessments']),
        clo_learning_journey_summary: pickString(rawSection, [
          'clo_learning_journey_summary',
          'learning_journey_summary',
          'journey_summary',
        ]),
        subtopics,
      });
    });

  return { course, sectionsById };
}

// ----------------------------------------------------------------------------
// Authoritative refs from Layer 2 (refined CLOs) + Layer 4 (assessments) + readings
// ----------------------------------------------------------------------------

interface CloRef {
  clo_id: string;
  refined_clo: string;
  bloom_level: BloomLevel;
  related_assessments: string[];
  reference_readings: string[];
}

// How many passages to pull per CLO when sourcing readings from the uploaded
// reference, and how many distinct chapter/section citations to keep from them.
const UPLOADED_READINGS_TOP_N = 10;
const MAX_UPLOADED_READINGS_PER_CLO = 6;

// Cache (per course) for readings derived from the uploaded reference, so we only
// pay the per-CLO embedding/similarity cost when the reference set actually
// changes — not on every Layer 6 context load (approve/save/summary all hit it).
const LAYER6_READINGS_CACHE = 'layer6-readings-cache';

interface Layer6ReadingsCache {
  /** Fingerprint of the uploaded reference set; recompute when it changes. */
  refsSignature: string;
  /** clo_id -> distinct chapter/section citations from the uploaded reference. */
  readingsByClo: Record<string, string[]>;
}

/**
 * Distinct chapter/section citations from the UPLOADED reference passages that
 * best match a refined CLO. At Layer 6 generation time the chunks are not yet
 * CLO-tagged (Reference Alignment runs after Layer 6 approval), so we match by
 * unscoped course-level similarity rather than relying on clo_ids tags. Returns
 * an empty list when nothing is uploaded or no passage matches — the caller then
 * falls back to the deep-research web pool.
 */
async function readingsFromUploadedReferences(
  courseCode: string,
  refinedClo: string
): Promise<string[]> {
  if (!refinedClo.trim()) return [];
  const hits = await retrieveReferenceChunks(courseCode, refinedClo, {
    topN: UPLOADED_READINGS_TOP_N,
  });
  const seen = new Set<string>();
  const readings: string[] = [];
  for (const hit of hits) {
    const citation = hit.citation?.trim();
    if (!citation || seen.has(citation)) continue;
    seen.add(citation);
    readings.push(citation);
    if (readings.length >= MAX_UPLOADED_READINGS_PER_CLO) break;
  }
  return readings;
}

/**
 * Resolve uploaded-reference readings for every CLO, cached by a fingerprint of
 * the uploaded reference set. On a cache hit (signature unchanged) this is a
 * single DB read with zero embedding calls; otherwise it recomputes once and
 * persists the result. Returns an empty map when the course has no references.
 */
async function resolveUploadedReadings(
  courseCode: string,
  refinedByClo: Map<string, string>
): Promise<Map<string, string[]>> {
  const docs = await referenceRepo.listDocuments(courseCode);
  if (docs.length === 0) return new Map();

  // Signature changes when a doc is added/removed or re-ingested (chunk count shifts).
  const refsSignature = docs
    .map((d) => `${d.doc_id}:${d.chunk_count ?? 0}`)
    .sort()
    .join('|');

  const cached = await artifactRepo.get<Layer6ReadingsCache>(courseCode, LAYER6_READINGS_CACHE);
  if (cached && cached.refsSignature === refsSignature) {
    return new Map(Object.entries(cached.readingsByClo));
  }

  // Cache miss: recompute once (one similarity query per CLO) and persist.
  const readingsByClo: Record<string, string[]> = {};
  for (const [cloId, refinedClo] of refinedByClo) {
    const readings = await readingsFromUploadedReferences(courseCode, refinedClo);
    if (readings.length) readingsByClo[cloId] = readings;
  }

  await artifactRepo.save(courseCode, LAYER6_READINGS_CACHE, {
    refsSignature,
    readingsByClo,
  } satisfies Layer6ReadingsCache);

  return new Map(Object.entries(readingsByClo));
}

async function buildCloRefs(courseCode: string): Promise<CloRef[]> {
  const { clos, refinements } = await getCloRefinementContext(courseCode);
  const bloomByClo = new Map(clos.map((c) => [c.clo_id, c.bloom_level]));

  // Assessments → which refined CLOs they align to (from Layer 4 / Layer 3 finals).
  const weighting = await getWeightingRubricContext(courseCode);
  const assessmentAlignments = weighting.assessment_structure_reviews.map((r) => ({
    assessment_id: r.assessment_id,
    alignment: (r.final_assessment_from_layer_3.refined_clo_alignment ?? []).join(' ').toLowerCase(),
  }));

  // Deep-research readings pool keyed by CLO — the FALLBACK used when the course
  // has no uploaded reference (or an uploaded passage doesn't match a CLO).
  const snapshot = await fileService.getExtractedSnapshot(courseCode);
  const webReadingsByClo = new Map<string, string[]>();
  for (const group of snapshot?.suggested_clo_topics?.topics_by_clo ?? []) {
    const readings = group.topics
      .map((t) => (typeof t.readings === 'string' ? t.readings.trim() : ''))
      .filter((r): r is string => !!r);
    if (readings.length) webReadingsByClo.set(group.clo_id, readings);
  }

  // Refined CLO wording per CLO (used both as the similarity query and the output).
  const refinedByClo = new Map<string, string>();
  for (const r of refinements) {
    const refined =
      r.sme_decision === 'keep_official' ? r.official_clo : r.final_clo_for_adaptive_design;
    refinedByClo.set(r.clo_id, refined || r.official_clo);
  }

  // Single source of truth: when the course has an uploaded reference, source the
  // readings pool from that file's own chapter/section citations (cached). When a
  // CLO has no uploaded match, fall back to the deep-research web pool below.
  const uploadedReadingsByClo = await resolveUploadedReadings(courseCode, refinedByClo);

  return refinements.map((r) => {
    const refinedClo = refinedByClo.get(r.clo_id) ?? r.official_clo;
    const idLower = r.clo_id.toLowerCase();
    const related = assessmentAlignments
      .filter((a) => a.alignment.includes(idLower))
      .map((a) => a.assessment_id);

    const uploaded = uploadedReadingsByClo.get(r.clo_id) ?? [];
    return {
      clo_id: r.clo_id,
      refined_clo: refinedClo,
      bloom_level: bloomByClo.get(r.clo_id) ?? 'Understand',
      related_assessments: related,
      reference_readings: uploaded.length ? uploaded : webReadingsByClo.get(r.clo_id) ?? [],
    };
  });
}

// ----------------------------------------------------------------------------
// Materialize a full subtopic from a partial (AI or saved) + defaults
// ----------------------------------------------------------------------------

function materializeSubtopic(
  cloId: string,
  index: number,
  partial: Partial<ArchitectureSubtopic>
): ArchitectureSubtopic {
  return {
    subtopic_id: partial.subtopic_id || `${cloId}-ST${index + 1}`,
    proposed_subtopic: partial.proposed_subtopic || '',
    purpose: partial.purpose || '',
    clo_alignment: partial.clo_alignment || '',
    assessment_connection: partial.assessment_connection ?? [],
    learning_function: partial.learning_function ?? 'foundational',
    expected_learning: partial.expected_learning || '',
    possible_node_families: partial.possible_node_families ?? [],
    cross_clo_links: partial.cross_clo_links ?? [],
    adaptive_value: partial.adaptive_value || '',
    estimated_learning_effort: partial.estimated_learning_effort ?? 'moderate',
    source_evidence: partial.source_evidence ?? [],
    recommendation: partial.recommendation ?? 'keep',
    sme_decision: partial.sme_decision ?? 'pending',
    sme_internal_note: partial.sme_internal_note,
    approval_status: partial.approval_status ?? 'pending',
  };
}

// ----------------------------------------------------------------------------
// Read context (merge AI suggestions + authoritative refs + saved SME state)
// ----------------------------------------------------------------------------

export interface SubtopicArchitectureContext {
  course_summary: SubtopicArchitectureCourseSummary;
  clo_sections: SubtopicCloSection[];
  summary: SubtopicArchitectureReviewSummary;
  layer6GeneratedAt?: string;
}

export async function getSubtopicArchitectureContext(
  courseCode: string
): Promise<SubtopicArchitectureContext> {
  const refs = await buildCloRefs(courseCode);
  const refByClo = new Map(refs.map((r) => [r.clo_id, r]));

  const layer6 = await fileService.getStage1LayerState(courseCode, LAYER6_ID);
  const ai = parseAiArchitecture(layer6?.outputJson);

  const saved = await fileService.getSubtopicArchitectureFile(courseCode);
  const savedSectionByClo = new Map<string, SubtopicCloSection>();
  for (const s of saved?.clo_sections ?? []) {
    if (s.clo_id) savedSectionByClo.set(s.clo_id, s);
  }

  const clo_sections: SubtopicCloSection[] = refs.map((ref) => {
    const savedSection = savedSectionByClo.get(ref.clo_id);
    const aiSection = ai.sectionsById.get(ref.clo_id);

    // Subtopics: saved SME working copy wins; otherwise AI suggestions; otherwise empty.
    const subtopicsSource: Partial<ArchitectureSubtopic>[] = savedSection
      ? savedSection.subtopics
      : aiSection?.subtopics ?? [];

    const subtopics = subtopicsSource.map((s, i) => materializeSubtopic(ref.clo_id, i, s));

    return {
      clo_id: ref.clo_id,
      // Authoritative wording/links always refreshed from upstream layers.
      refined_clo: ref.refined_clo,
      bloom_level: ref.bloom_level,
      related_assessments: ref.related_assessments.length
        ? ref.related_assessments
        : aiSection?.related_assessments ?? [],
      clo_learning_journey_summary:
        savedSection?.clo_learning_journey_summary ||
        aiSection?.clo_learning_journey_summary ||
        '',
      reference_readings: ref.reference_readings,
      subtopics,
    };
  });

  const total_subtopics = clo_sections.reduce((sum, s) => sum + s.subtopics.length, 0);
  const savedCourse = saved?.course_summary;
  const snapshot = await fileService.getExtractedSnapshot(courseCode);

  const course_summary: SubtopicArchitectureCourseSummary = {
    course_title:
      savedCourse?.course_title || ai.course.course_title || snapshot?.title || courseCode,
    total_refined_clos: clo_sections.length,
    total_subtopics,
    architecture_summary:
      savedCourse?.architecture_summary || ai.course.architecture_summary || '',
    source_evidence_note:
      savedCourse?.source_evidence_note ||
      ai.course.source_evidence_note ||
      'The weekly plan is used as source evidence only, not copied as the self-paced structure.',
    full_report: savedCourse?.full_report || ai.course.full_report || '',
  };

  return {
    course_summary,
    clo_sections,
    summary: computeSubtopicSummary(clo_sections),
    layer6GeneratedAt: layer6?.generatedAt,
  };
}

// ----------------------------------------------------------------------------
// Summary + validation
// ----------------------------------------------------------------------------

export function computeSubtopicSummary(
  sections: SubtopicCloSection[]
): SubtopicArchitectureReviewSummary {
  let pending_count = 0;
  let approved_count = 0;
  let needs_revision_count = 0;
  let total_subtopics = 0;

  for (const section of sections) {
    for (const s of section.subtopics) {
      total_subtopics++;
      switch (s.approval_status) {
        case 'approved':
          approved_count++;
          break;
        case 'needs_revision':
          needs_revision_count++;
          break;
        default:
          pending_count++;
      }
    }
  }

  return {
    total_clos: sections.length,
    total_subtopics,
    pending_count,
    approved_count,
    needs_revision_count,
    all_approved: total_subtopics > 0 && approved_count === total_subtopics,
  };
}

// ----------------------------------------------------------------------------
// Save (whole SME working file)
// ----------------------------------------------------------------------------

export async function saveSubtopicArchitecture(
  courseCode: string,
  payload: {
    course_summary: SubtopicArchitectureCourseSummary;
    clo_sections: SubtopicCloSection[];
  }
): Promise<{
  course_summary: SubtopicArchitectureCourseSummary;
  clo_sections: SubtopicCloSection[];
  summary: SubtopicArchitectureReviewSummary;
}> {
  const clo_sections = payload.clo_sections ?? [];
  const total_subtopics = clo_sections.reduce((sum, s) => sum + s.subtopics.length, 0);

  const course_summary: SubtopicArchitectureCourseSummary = {
    ...payload.course_summary,
    total_refined_clos: clo_sections.length,
    total_subtopics,
  };

  const file: SubtopicArchitectureFile = {
    course_summary,
    clo_sections,
    updated_at: new Date().toISOString(),
  };
  await fileService.saveSubtopicArchitectureFile(courseCode, file);

  return {
    course_summary,
    clo_sections,
    summary: computeSubtopicSummary(clo_sections),
  };
}

export async function seedSubtopicArchitectureFromOutput(
  courseCode: string
): Promise<SubtopicArchitectureContext> {
  const ctx = await getSubtopicArchitectureContext(courseCode);
  await saveSubtopicArchitecture(courseCode, {
    course_summary: ctx.course_summary,
    clo_sections: ctx.clo_sections,
  });
  return ctx;
}

export async function assertLayer6ReadyForApproval(courseCode: string): Promise<void> {
  const { summary } = await getSubtopicArchitectureContext(courseCode);
  if (summary.total_subtopics === 0) {
    throw new Error('No subtopics to approve. Run Layer 6 first.');
  }
  if (!summary.all_approved) {
    throw new Error(
      `Every subtopic must be approved before approving Layer 6 (${summary.pending_count} pending, ${summary.needs_revision_count} need revision).`
    );
  }
}

// ----------------------------------------------------------------------------
// Project the approved rich architecture down to thin clo_topics for Stage 2
// ----------------------------------------------------------------------------

export async function buildCloTopicsFromArchitecture(
  courseCode: string
): Promise<CloTopics | null> {
  const saved = await fileService.getSubtopicArchitectureFile(courseCode);
  if (!saved?.clo_sections?.length) return null;

  const cloTopics: CloTopics = saved.clo_sections
    .map((section) => {
      const topics: TopicItem[] = section.subtopics
        // Skip subtopics the SME marked for removal.
        .filter((s) => s.recommendation !== 'remove')
        .map((s, i) => ({
          topic_id: s.subtopic_id || `${section.clo_id}-ST${i + 1}`,
          title: s.proposed_subtopic,
          description: s.purpose || s.expected_learning || '',
          readings: section.reference_readings[i] ?? '',
          rationale: s.adaptive_value || s.clo_alignment || undefined,
        }))
        .filter((t) => t.title);
      return { clo_id: section.clo_id, topics };
    })
    .filter((g) => g.topics.length > 0);

  return cloTopics.length ? cloTopics : null;
}
