import type {
  Assessment,
  AnalyticRubricCriterion,
  AssessmentProgressionItem,
  AssessmentRedesignItem,
  AssessmentStructureReview,
  CourseLevelWeightingSummary,
  Layer4FinalAssessmentRef,
  ProcessEvidenceItem,
  ProcessEvidenceStatus,
  WeightChangeType,
  WeightEntry,
  WeightingRubricFile,
  WeightingRubricReviewSummary,
} from '../models/schemas.js';
import * as fileService from './file.service.js';
import { getAssessmentRedesignContext } from './assessmentRedesigns.service.js';

const LAYER4_ID = 'layer4-weighting-rubric';

// ----------------------------------------------------------------------------
// Generic raw-JSON pickers (mirror assessmentRedesigns.service.ts)
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

// ----------------------------------------------------------------------------
// Percentage helpers
// ----------------------------------------------------------------------------

/** Parse a weight string/number ("25%", "25", 25) into a number; 0 when unknown. */
function parsePct(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.replace(/[^0-9.\-]/g, '');
    const n = Number.parseFloat(match);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function formatPct(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2)}%`;
}

function changeType(selected: number, current: number): WeightChangeType {
  if (selected > current) return 'increased';
  if (selected < current) return 'decreased';
  return 'no_change';
}

const VALID_EVIDENCE_STATUSES: ProcessEvidenceStatus[] = [
  'required',
  'graded',
  'integrity_evidence_only',
  'optional',
  'not_required',
];

function normalizeEvidenceStatus(value: unknown): ProcessEvidenceStatus {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const match = VALID_EVIDENCE_STATUSES.find((s) => s === v);
    if (match) return match;
    if (v.includes('integrity')) return 'integrity_evidence_only';
    if (v.includes('grade')) return 'graded';
    if (v.includes('optional')) return 'optional';
    if (v.includes('not')) return 'not_required';
  }
  return 'required';
}

// ----------------------------------------------------------------------------
// Parse AI (council) output for Layer 4
// ----------------------------------------------------------------------------

interface ParsedAiWeighting {
  weighting_rationale: string;
  progression: AssessmentProgressionItem[];
  proposedById: Map<string, number>;
}

interface ParsedAiReview {
  ai_assisted_analytic_rubric: AnalyticRubricCriterion[];
  process_evidence_requirements: ProcessEvidenceItem[];
  ai_use_disclosure_rule: string;
  revision_policy: string;
  grading_policy: string;
}

function parseRubricRow(raw: Record<string, unknown>): AnalyticRubricCriterion {
  return {
    rubric_criterion: pickString(raw, ['rubric_criterion', 'criterion', 'name']) || '',
    criterion_weight: pickString(raw, ['criterion_weight', 'weight']) || '',
    exceeds_standard: pickString(raw, ['exceeds_standard', 'exceeds']) || '',
    meets_standard: pickString(raw, ['meets_standard', 'meets']) || '',
    developing: pickString(raw, ['developing']) || '',
    not_yet_evident: pickString(raw, ['not_yet_evident', 'not_evident', 'beginning']) || '',
    evidence_required: pickString(raw, ['evidence_required', 'evidence']) || '',
    ai_scoring_guidance: pickString(raw, ['ai_scoring_guidance', 'scoring_guidance']) || '',
  };
}

function parseAiWeighting(outputJson: unknown): ParsedAiWeighting {
  const root = (outputJson && typeof outputJson === 'object' ? outputJson : {}) as Record<
    string,
    unknown
  >;
  const cw =
    pickObject(root, 'course_level_weighting') ??
    pickObject(root, 'course_level_weighting_summary') ??
    root;

  const progressionRaw = pickArray(cw, [
    'assessment_progression_overview',
    'progression_overview',
    'progression',
  ]);
  const progression: AssessmentProgressionItem[] = progressionRaw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      assessment_id: pickString(e, ['assessment_id', 'id']) || '',
      role_in_progression:
        pickString(e, ['role_in_progression', 'role', 'phase', 'description']) || '',
    }))
    .filter((e) => e.assessment_id || e.role_in_progression);

  const proposedById = new Map<string, number>();
  const weightsRaw = pickArray(cw, ['weights', 'weight_table']);
  weightsRaw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .forEach((e) => {
      const id = pickString(e, ['assessment_id', 'id']);
      if (!id) return;
      const proposed = pickString(e, ['proposed_weight', 'proposed']);
      if (proposed != null) proposedById.set(id, parsePct(proposed));
    });

  return {
    weighting_rationale:
      pickString(cw, ['weighting_rationale', 'rationale']) ||
      pickString(root, ['weighting_rationale']) ||
      '',
    progression,
    proposedById,
  };
}

function parseAiReviews(outputJson: unknown): Map<string, ParsedAiReview> {
  const root = (outputJson && typeof outputJson === 'object' ? outputJson : {}) as Record<
    string,
    unknown
  >;
  const list = pickArray(root, ['assessments', 'assessment_structure_reviews', 'reviews']);
  const map = new Map<string, ParsedAiReview>();

  list
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .forEach((raw, index) => {
      const id = pickString(raw, ['assessment_id', 'id']) || `A${index + 1}`;

      const rubricRaw = pickArray(raw, [
        'ai_assisted_analytic_rubric',
        'analytic_rubric',
        'rubric',
      ]);
      const rubric = rubricRaw
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map(parseRubricRow);

      const evidenceRaw = pickArray(raw, [
        'process_evidence_requirements',
        'process_evidence',
      ]);
      const evidence: ProcessEvidenceItem[] = evidenceRaw
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => ({
          evidence_item: pickString(r, ['evidence_item', 'item', 'name']) || '',
          status: normalizeEvidenceStatus(r.status),
        }))
        .filter((r) => r.evidence_item);

      map.set(id, {
        ai_assisted_analytic_rubric: rubric,
        process_evidence_requirements: evidence,
        ai_use_disclosure_rule: pickString(raw, ['ai_use_disclosure_rule', 'ai_use_disclosure']) || '',
        revision_policy: pickString(raw, ['revision_policy']) || '',
        grading_policy: pickString(raw, ['grading_policy']) || '',
      });
    });

  return map;
}

// ----------------------------------------------------------------------------
// Build authoritative inputs from Layer 3 approved finals + snapshot weights
// ----------------------------------------------------------------------------

function finalRefFromRedesign(item: AssessmentRedesignItem): Layer4FinalAssessmentRef {
  if (item.sme_decision === 'keep_original') {
    return {
      title: item.original_assessment.title,
      description: item.original_assessment.description,
      required_artifact: '',
      refined_clo_alignment: [],
      suggested_evaluation_criteria: [],
    };
  }
  const f = item.final_assessment_for_maestro;
  return {
    title: f?.title || item.original_assessment.title,
    description: f?.description || '',
    required_artifact: f?.required_artifact || '',
    refined_clo_alignment: f?.refined_clo_alignment ?? [],
    suggested_evaluation_criteria: f?.suggested_evaluation_criteria ?? [],
  };
}

function currentWeightForItem(
  item: AssessmentRedesignItem,
  snapshotAssessments: Assessment[],
  index: number
): number {
  const fromOriginal = parsePct(item.original_assessment.weight);
  if (fromOriginal > 0) return fromOriginal;
  const snap = snapshotAssessments[index];
  return snap ? parsePct(snap.weight) : 0;
}

const DEFAULT_AI_DISCLOSURE_RULE =
  'Required for all redesigned contribution assessments. Used primarily for integrity and reflection, not as a standalone grade unless SME approves.';
const DEFAULT_REVISION_POLICY = 'One revision allowed before final grade.';
const DEFAULT_GRADING_POLICY =
  'Graded against the analytic rubric below; criterion weights sum to 100% of the assessment grade.';

function emptyReview(
  assessmentId: string,
  finalRef: Layer4FinalAssessmentRef,
  selectedWeight: number,
  ai?: ParsedAiReview
): AssessmentStructureReview {
  return {
    assessment_id: assessmentId,
    selected_weight_from_step_1: formatPct(selectedWeight),
    final_assessment_from_layer_3: finalRef,
    ai_assisted_analytic_rubric: ai?.ai_assisted_analytic_rubric ?? [],
    rubric_decision: 'pending',
    process_evidence_requirements: ai?.process_evidence_requirements ?? [],
    ai_use_disclosure_rule: ai?.ai_use_disclosure_rule || DEFAULT_AI_DISCLOSURE_RULE,
    revision_policy: ai?.revision_policy || DEFAULT_REVISION_POLICY,
    grading_policy: ai?.grading_policy || DEFAULT_GRADING_POLICY,
    assessment_structure_decision: 'pending',
    sme_internal_note: undefined,
    approval_status: 'pending',
  };
}

// ----------------------------------------------------------------------------
// Read context (merge AI suggestions + Layer 3 finals + saved SME state)
// ----------------------------------------------------------------------------

export interface WeightingRubricContext {
  course_level_weighting_summary: CourseLevelWeightingSummary;
  assessment_structure_reviews: AssessmentStructureReview[];
  full_assessment_structure_report?: string;
  summary: WeightingRubricReviewSummary;
  layer4GeneratedAt?: string;
}

export async function getWeightingRubricContext(courseCode: string): Promise<WeightingRubricContext> {
  const snapshot = await fileService.getExtractedSnapshot(courseCode);
  const snapshotAssessments = snapshot?.assessments ?? [];
  const { redesigns } = await getAssessmentRedesignContext(courseCode);

  const layer4 = await fileService.getStage1LayerState(courseCode, LAYER4_ID);
  const aiWeighting = parseAiWeighting(layer4?.outputJson);
  const aiReviews = parseAiReviews(layer4?.outputJson);
  const fullReport =
    layer4?.outputJson && typeof layer4.outputJson === 'object'
      ? pickString(layer4.outputJson as Record<string, unknown>, [
          'full_assessment_structure_report',
          'report_markdown',
        ])
      : undefined;

  const saved = await fileService.getWeightingRubricFile(courseCode);
  const savedWeightById = new Map<string, WeightEntry>();
  for (const w of saved?.course_level_weighting_summary?.weights ?? []) {
    if (w.assessment_id) savedWeightById.set(w.assessment_id, w);
  }
  const savedReviewById = new Map<string, AssessmentStructureReview>();
  for (const r of saved?.assessment_structure_reviews ?? []) {
    if (r.assessment_id) savedReviewById.set(r.assessment_id, r);
  }

  const weightDecision = saved?.course_level_weighting_summary?.weight_decision ?? 'pending';
  const step1Approved = saved?.course_level_weighting_summary?.step_1_approved ?? false;
  const approvedAt = saved?.course_level_weighting_summary?.approved_at ?? null;
  const progressionById = new Map<string, string>();
  for (const p of aiWeighting.progression) {
    if (p.assessment_id) progressionById.set(p.assessment_id, p.role_in_progression);
  }
  const savedProgression = saved?.course_level_weighting_summary?.assessment_progression_overview;

  // Build per-assessment weights + reviews keyed off the Layer 3 redesigns.
  const weights: WeightEntry[] = [];
  const reviews: AssessmentStructureReview[] = [];

  redesigns.forEach((item, index) => {
    const id = item.assessment_id || `A${index + 1}`;
    const current = currentWeightForItem(item, snapshotAssessments, index);
    const proposed = aiWeighting.proposedById.has(id)
      ? (aiWeighting.proposedById.get(id) as number)
      : current;

    let selected: number;
    const savedWeight = savedWeightById.get(id);
    if (savedWeight) {
      selected = parsePct(savedWeight.selected_weight);
    } else if (weightDecision === 'approve_proposed') {
      selected = proposed;
    } else if (weightDecision === 'keep_current') {
      selected = current;
    } else {
      selected = current;
    }

    weights.push({
      assessment_id: id,
      current_weight: formatPct(current),
      proposed_weight: formatPct(proposed),
      selected_weight: formatPct(selected),
      approved_weight: step1Approved ? formatPct(selected) : null,
      change_type: changeType(selected, current),
    });

    const finalRef = finalRefFromRedesign(item);
    const savedReview = savedReviewById.get(id);
    if (savedReview) {
      reviews.push({
        ...savedReview,
        // Authoritative reference always refreshed from Layer 3 / Step 1.
        selected_weight_from_step_1: formatPct(selected),
        final_assessment_from_layer_3: finalRef,
      });
    } else {
      reviews.push(emptyReview(id, finalRef, selected, aiReviews.get(id)));
    }
  });

  const currentTotal = weights.reduce((sum, w) => sum + parsePct(w.current_weight), 0);
  const proposedTotal = weights.reduce((sum, w) => sum + parsePct(w.proposed_weight), 0);
  const selectedTotal = weights.reduce((sum, w) => sum + parsePct(w.selected_weight), 0);

  const courseLevel: CourseLevelWeightingSummary = {
    current_total_weight: formatPct(currentTotal),
    proposed_total_weight: formatPct(proposedTotal),
    selected_total_weight: formatPct(selectedTotal),
    weight_decision: weightDecision,
    step_1_approved: step1Approved,
    weights_valid: Math.round(selectedTotal) === 100,
    approved_at: approvedAt,
    weighting_rationale:
      saved?.course_level_weighting_summary?.weighting_rationale || aiWeighting.weighting_rationale,
    assessment_progression_overview:
      savedProgression && savedProgression.length
        ? savedProgression
        : weights.map((w) => ({
            assessment_id: w.assessment_id,
            role_in_progression: progressionById.get(w.assessment_id) || '',
          })),
    weights,
  };

  return {
    course_level_weighting_summary: courseLevel,
    assessment_structure_reviews: reviews,
    full_assessment_structure_report: saved?.full_assessment_structure_report || fullReport,
    summary: computeSummary(courseLevel, reviews),
    layer4GeneratedAt: layer4?.generatedAt,
  };
}

// ----------------------------------------------------------------------------
// Summary + validation
// ----------------------------------------------------------------------------

export function computeSummary(
  courseLevel: CourseLevelWeightingSummary,
  reviews: AssessmentStructureReview[]
): WeightingRubricReviewSummary {
  let pending_count = 0;
  let approved_count = 0;
  let needs_revision_count = 0;

  for (const r of reviews) {
    switch (r.approval_status) {
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

  const selectedTotal = courseLevel.weights.reduce(
    (sum, w) => sum + parsePct(w.selected_weight),
    0
  );
  const weights_balanced = Math.round(selectedTotal) === 100;
  // Selecting a weight option is not approval — Step 1 unlocks only after the SME
  // explicitly confirms the structure (step_1_approved) and the total is 100%.
  const weighting_decided = courseLevel.step_1_approved && weights_balanced;

  return {
    total_assessments: reviews.length,
    pending_count,
    approved_count,
    needs_revision_count,
    all_approved:
      reviews.length > 0 &&
      approved_count === reviews.length &&
      weighting_decided,
    weighting_decided,
    assessment_cards_unlocked: weighting_decided,
    selected_weight_total: Math.round(selectedTotal * 100) / 100,
    weights_balanced,
  };
}

export function rubricWeightTotal(rubric: AnalyticRubricCriterion[]): number {
  return rubric.reduce((sum, r) => sum + parsePct(r.criterion_weight), 0);
}

// ----------------------------------------------------------------------------
// Save (whole SME working file)
// ----------------------------------------------------------------------------

export async function saveWeightingRubric(
  courseCode: string,
  payload: {
    course_level_weighting_summary: CourseLevelWeightingSummary;
    assessment_structure_reviews: AssessmentStructureReview[];
    full_assessment_structure_report?: string;
  }
): Promise<{
  course_level_weighting_summary: CourseLevelWeightingSummary;
  assessment_structure_reviews: AssessmentStructureReview[];
  summary: WeightingRubricReviewSummary;
}> {
  const incoming = payload.course_level_weighting_summary;
  const selectedTotalRaw = (incoming?.weights ?? []).reduce(
    (s, w) => s + parsePct(w.selected_weight),
    0
  );
  const weightsValid = Math.round(selectedTotalRaw) === 100;
  // Step 1 can only be approved when the selected weights total 100%.
  const step1Approved = Boolean(incoming?.step_1_approved) && weightsValid;

  // Recompute totals/change types so persisted data stays internally consistent.
  const weights = (incoming?.weights ?? []).map((w) => {
    const current = parsePct(w.current_weight);
    const selected = parsePct(w.selected_weight);
    return {
      ...w,
      current_weight: formatPct(current),
      proposed_weight: formatPct(parsePct(w.proposed_weight)),
      selected_weight: formatPct(selected),
      approved_weight: step1Approved ? formatPct(selected) : null,
      change_type: changeType(selected, current),
    };
  });

  const courseLevel: CourseLevelWeightingSummary = {
    ...incoming,
    step_1_approved: step1Approved,
    weights_valid: weightsValid,
    approved_at: step1Approved
      ? incoming?.approved_at || new Date().toISOString()
      : null,
    weights,
    current_total_weight: formatPct(weights.reduce((s, w) => s + parsePct(w.current_weight), 0)),
    proposed_total_weight: formatPct(weights.reduce((s, w) => s + parsePct(w.proposed_weight), 0)),
    selected_total_weight: formatPct(weights.reduce((s, w) => s + parsePct(w.selected_weight), 0)),
  };

  const selectedById = new Map<string, number>();
  weights.forEach((w) => selectedById.set(w.assessment_id, parsePct(w.selected_weight)));

  const reviews = (payload.assessment_structure_reviews ?? []).map((r) => ({
    ...r,
    selected_weight_from_step_1: selectedById.has(r.assessment_id)
      ? formatPct(selectedById.get(r.assessment_id) as number)
      : r.selected_weight_from_step_1,
  }));

  const file: WeightingRubricFile = {
    course_level_weighting_summary: courseLevel,
    assessment_structure_reviews: reviews,
    full_assessment_structure_report: payload.full_assessment_structure_report,
    updated_at: new Date().toISOString(),
  };
  await fileService.saveWeightingRubricFile(courseCode, file);

  return {
    course_level_weighting_summary: courseLevel,
    assessment_structure_reviews: reviews,
    summary: computeSummary(courseLevel, reviews),
  };
}

export async function seedWeightingRubricFromOutput(courseCode: string): Promise<WeightingRubricContext> {
  const ctx = await getWeightingRubricContext(courseCode);
  await saveWeightingRubric(courseCode, {
    course_level_weighting_summary: ctx.course_level_weighting_summary,
    assessment_structure_reviews: ctx.assessment_structure_reviews,
    full_assessment_structure_report: ctx.full_assessment_structure_report,
  });
  return ctx;
}

export async function assertLayer4ReadyForApproval(courseCode: string): Promise<void> {
  const ctx = await getWeightingRubricContext(courseCode);
  const { summary, course_level_weighting_summary, assessment_structure_reviews } = ctx;

  if (course_level_weighting_summary.weight_decision === 'pending') {
    throw new Error('Course-level weighting decision must be completed before approving Layer 4.');
  }
  if (!course_level_weighting_summary.step_1_approved) {
    throw new Error('Approve the weight structure (Step 1) before approving Layer 4.');
  }
  if (!summary.weights_balanced) {
    throw new Error(
      `Assessment weights must total 100% before approving Layer 4 (currently ${summary.selected_weight_total}%).`
    );
  }
  if (!summary.all_approved) {
    throw new Error(
      `Every assessment structure must be approved before approving Layer 4 (${summary.pending_count} pending, ${summary.needs_revision_count} need revision).`
    );
  }
  for (const r of assessment_structure_reviews) {
    if (!r.ai_assisted_analytic_rubric.length) {
      throw new Error(`Assessment ${r.assessment_id} is missing a rubric.`);
    }
    const total = rubricWeightTotal(r.ai_assisted_analytic_rubric);
    if (Math.round(total) !== 100) {
      throw new Error(
        `Rubric criterion weights for ${r.assessment_id} must total 100% (currently ${
          Math.round(total * 100) / 100
        }%).`
      );
    }
  }
}

/** Compact authoritative summary for downstream layers (order > 4). */
export async function buildApprovedWeightingRubricContext(courseCode: string): Promise<string> {
  const saved = await fileService.getWeightingRubricFile(courseCode);
  if (!saved) return '';
  const { course_level_weighting_summary: cw, assessment_structure_reviews: reviews } = saved;
  const weightLines = cw.weights
    .map((w) => `- ${w.assessment_id}: selected ${w.selected_weight} (was ${w.current_weight})`)
    .join('\n');
  const rubricLines = reviews
    .map((r) => {
      const crit = r.ai_assisted_analytic_rubric
        .map((c) => `${c.rubric_criterion} (${c.criterion_weight})`)
        .join(', ');
      return `- ${r.assessment_id} — ${r.final_assessment_from_layer_3.title}\n    Rubric: ${
        crit || 'n/a'
      }\n    Revision policy: ${r.revision_policy || 'n/a'}`;
    })
    .join('\n');
  return (
    `### SME-APPROVED ASSESSMENT WEIGHTS & RUBRICS (AUTHORITATIVE)\n` +
    `These approved weights and analytic rubrics are the grading source of truth.\n\n` +
    `Selected weights:\n${weightLines}\n\nRubrics:\n${rubricLines}`
  );
}
