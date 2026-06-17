/**
 * Stage 1 → V1 adapter (Option B — thin, READ-ONLY projector).
 *
 * Stage 1 emits legacy, field-divergent (but ID-compatible) shapes and persists
 * approved artifacts under data/courses/<code>/. This module reads ONLY those
 * approved artifacts (via the existing context services + file.service) and
 * projects them into the forward V1 contract shapes defined in
 * `models/nodeEngine.ts` (CourseAcademicContract, CLO, Assessment, Subtopic).
 *
 * Guarantees (V1 guard rails):
 * - It WRITES NOTHING — no Stage 1 file, no legacy node graph, no node-engine
 *   artifact is ever touched. Every public function is a pure read+project.
 * - It NEVER reads the lossy `clo_topics` projection in extracted/snapshot.json;
 *   the rich Layer 6 subtopic architecture file is the entry point, so the
 *   grounding context (purpose / expected_learning / learning_function /
 *   assessment_connection / cross_clo_links / possible_node_families /
 *   source_evidence) is preserved for M7 node generation.
 *
 * The projections are deterministic: repeated calls on unchanged artifacts
 * return identical bundles.
 */
import {
  parseAssessment,
  parseCLO,
  parseCourseAcademicContract,
  parseSubtopic,
  type Assessment,
  type AssessmentStatus,
  type CLO,
  type CloStatus,
  type ContractStatus,
  type CourseAcademicContract,
  type Subtopic,
  type SubtopicStatus,
} from '../models/nodeEngine.js';
import type { CloApprovalStatus } from '../models/schemas.js';
import * as fileService from '../services/file.service.js';
import { getCloRefinementContext } from '../services/cloRefinements.service.js';
import { getAssessmentRedesignContext } from '../services/assessmentRedesigns.service.js';
import { getWeightingRubricContext } from '../services/weightingRubric.service.js';

export interface V1ContractBundle {
  contract: CourseAcademicContract;
  clos: CLO[];
  assessments: Assessment[];
  subtopics: Subtopic[];
}

// ---------------------------------------------------------------------------
// Status projections (legacy approval_status → forward V1 status enums).
// ---------------------------------------------------------------------------

function mapCloStatus(status: CloApprovalStatus | undefined): CloStatus {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'needs_revision':
      return 'refined';
    default:
      return 'draft';
  }
}

function mapAssessmentStatus(status: CloApprovalStatus | undefined): AssessmentStatus {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'needs_revision':
      return 'needs_revision';
    default:
      return 'draft';
  }
}

function mapSubtopicStatus(status: CloApprovalStatus | undefined): SubtopicStatus {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'needs_revision':
      return 'needs_revision';
    default:
      return 'draft';
  }
}

// ---------------------------------------------------------------------------
// Small deterministic helpers.
// ---------------------------------------------------------------------------

/** Strip the legacy `_node` suffix so families line up with NODE_TYPES. */
function stripNodeSuffix(family: string): string {
  return family.replace(/_node$/i, '');
}

/**
 * Parse the free-text `refined_clo_alignment` entries (e.g. "CLO-1: …") into
 * normalized clo_ids ("CLO-1"). Insertion order is preserved and duplicates
 * are dropped, so A4's ["CLO-5: …", "CLO-4: …"] becomes ["CLO-5", "CLO-4"].
 */
function parseCloIdsFromAlignment(alignment: string[]): string[] {
  const ids: string[] = [];
  const re = /CLO[-_\s]?(\d+)/gi;
  for (const entry of alignment) {
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(entry)) !== null) {
      const id = `CLO-${match[1]}`;
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** Postgraduate is the only level the syllabus signals; default to it. */
async function deriveLevel(courseCode: string): Promise<string> {
  const snapshot = await fileService.getExtractedSnapshot(courseCode);
  const haystack = `${snapshot?.raw_text ?? ''} ${snapshot?.description ?? ''}`.toLowerCase();
  if (haystack.includes('postgraduate') || haystack.includes('graduate')) return 'postgraduate';
  if (haystack.includes('undergraduate')) return 'undergraduate';
  return 'postgraduate';
}

// ---------------------------------------------------------------------------
// Public API — each builder is a pure read + project (no writes anywhere).
// ---------------------------------------------------------------------------

/**
 * V1 Assessments. The positional `A${index+1}` id is FROZEN once into both
 * `assessment_id` and `label`; weighting comes from the approved Layer 4 weight
 * table; clo_ids are parsed from the Layer 3 final refined alignment.
 */
export async function buildV1Assessments(courseCode: string): Promise<Assessment[]> {
  const { redesigns } = await getAssessmentRedesignContext(courseCode);
  const weighting = await getWeightingRubricContext(courseCode);
  const snapshot = await fileService.getExtractedSnapshot(courseCode);
  const snapshotAssessments = snapshot?.assessments ?? [];

  const approvedWeightById = new Map<string, string>();
  for (const w of weighting.course_level_weighting_summary.weights) {
    if (w.assessment_id && w.approved_weight) {
      approvedWeightById.set(w.assessment_id, w.approved_weight);
    }
  }

  return redesigns.map((item, index) => {
    const assessmentId = `A${index + 1}`;
    const finalRef =
      item.sme_decision === 'keep_original' ? null : item.final_assessment_for_maestro;
    const cloIds = parseCloIdsFromAlignment(finalRef?.refined_clo_alignment ?? []);
    const type =
      item.original_assessment.type_or_format || snapshotAssessments[index]?.type || 'assessment';
    const approvedWeight = approvedWeightById.get(assessmentId);

    return parseAssessment({
      assessment_id: assessmentId,
      course_id: courseCode,
      label: assessmentId,
      type,
      status: mapAssessmentStatus(item.approval_status),
      ...(approvedWeight !== undefined ? { weighting: approvedWeight } : {}),
      clo_ids: cloIds,
    });
  });
}

/**
 * V1 CLOs. `statement` is the post-approval refined text; `aligned_assessment_ids`
 * is a reverse index from the projected assessments; `rationale` joins the
 * refinement rationale lines.
 */
export async function buildV1CLOs(courseCode: string): Promise<CLO[]> {
  const { clos, refinements } = await getCloRefinementContext(courseCode);
  const refByClo = new Map(refinements.map((r) => [r.clo_id, r]));

  // Reverse-index assessment alignment so each CLO lists the assessments it feeds.
  const assessments = await buildV1Assessments(courseCode);
  const assessmentsByClo = new Map<string, string[]>();
  for (const a of assessments) {
    for (const cloId of a.clo_ids) {
      const list = assessmentsByClo.get(cloId) ?? [];
      list.push(a.assessment_id);
      assessmentsByClo.set(cloId, list);
    }
  }

  return clos.map((clo) => {
    const r = refByClo.get(clo.clo_id);
    const statement =
      (r
        ? r.sme_decision === 'keep_official'
          ? r.official_clo
          : r.final_clo_for_adaptive_design
        : clo.clo_text) || clo.clo_text;
    const rationale = (r?.refinement_rationale ?? []).filter((s) => s.trim()).join('\n');

    return parseCLO({
      clo_id: clo.clo_id,
      course_id: courseCode,
      statement,
      status: mapCloStatus(r?.approval_status),
      bloom_level: clo.bloom_level,
      aligned_assessment_ids: assessmentsByClo.get(clo.clo_id) ?? [],
      ...(rationale ? { rationale } : {}),
    });
  });
}

/**
 * V1 Subtopics — projected from the RICH Layer 6 architecture file. `order` is
 * a global index across CLO sections; `clo_ids` is the parent section's CLO;
 * `cognitive_level` is the parent CLO's Bloom level; the grounding context is
 * preserved verbatim (node families have their `_node` suffix stripped).
 */
export async function buildV1Subtopics(courseCode: string): Promise<Subtopic[]> {
  const archFile = await fileService.getSubtopicArchitectureFile(courseCode);
  if (!archFile?.clo_sections?.length) return [];

  const subtopics: Subtopic[] = [];
  let order = 0;

  for (const section of archFile.clo_sections) {
    for (const st of section.subtopics ?? []) {
      subtopics.push(
        parseSubtopic({
          subtopic_id: st.subtopic_id,
          course_id: courseCode,
          clo_ids: [section.clo_id],
          title: st.proposed_subtopic,
          order,
          status: mapSubtopicStatus(st.approval_status),
          description: st.purpose || st.expected_learning || '',
          purpose: st.purpose || '',
          expected_learning: st.expected_learning || '',
          learning_function: st.learning_function || '',
          assessment_connection: st.assessment_connection ?? [],
          cross_clo_links: (st.cross_clo_links ?? []).map((l) => ({
            linked_clo_id: l.linked_clo_id,
            reason: l.reason,
          })),
          possible_node_families: (st.possible_node_families ?? []).map(stripNodeSuffix),
          source_evidence: st.source_evidence ?? [],
          cognitive_level: section.bloom_level,
          node_ids: [],
        })
      );
      order++;
    }
  }

  return subtopics;
}

/**
 * Contract status is `approved` only when EVERY upstream Stage 1 layer is fully
 * approved (CLO refinement, assessment redesign, weighting/rubric, and all
 * Layer 6 subtopics). This honours the no-auto-proceed gate.
 */
async function deriveContractStatus(courseCode: string): Promise<ContractStatus> {
  const cloApproved = (await getCloRefinementContext(courseCode)).summary.all_approved;
  const assessApproved = (await getAssessmentRedesignContext(courseCode)).summary.all_approved;
  const weightingApproved = (await getWeightingRubricContext(courseCode)).summary.all_approved;

  const archFile = await fileService.getSubtopicArchitectureFile(courseCode);
  const allSubtopics = (archFile?.clo_sections ?? []).flatMap((s) => s.subtopics ?? []);
  const subtopicsApproved =
    allSubtopics.length > 0 && allSubtopics.every((s) => s.approval_status === 'approved');

  return cloApproved && assessApproved && weightingApproved && subtopicsApproved
    ? 'approved'
    : 'draft';
}

/** V1 CourseAcademicContract — the root of the projected course. */
export async function buildV1Contract(courseCode: string): Promise<CourseAcademicContract> {
  const contract = await fileService.getCourseContract(courseCode);
  if (!contract) {
    throw new Error(`No approved course contract found for "${courseCode}"`);
  }
  const snapshot = await fileService.getExtractedSnapshot(courseCode);
  const assessments = await buildV1Assessments(courseCode);

  return parseCourseAcademicContract({
    course_id: contract.course_code,
    title: snapshot?.title || contract.course_code,
    level: await deriveLevel(courseCode),
    clo_ids: contract.course_learning_outcomes.map((c) => c.clo_id),
    assessment_ids: assessments.map((a) => a.assessment_id),
    status: await deriveContractStatus(courseCode),
  });
}

/** Aggregate projection: the whole V1 contract bundle for a course code. */
export async function buildV1ContractBundle(courseCode: string): Promise<V1ContractBundle> {
  const [contract, clos, assessments, subtopics] = await Promise.all([
    buildV1Contract(courseCode),
    buildV1CLOs(courseCode),
    buildV1Assessments(courseCode),
    buildV1Subtopics(courseCode),
  ]);
  return { contract, clos, assessments, subtopics };
}
