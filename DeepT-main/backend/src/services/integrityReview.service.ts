import type {
  AiUseAllowedStatus,
  AiUseDisclosureField,
  AiUseFrameworkItem,
  AssessmentIntegrityReview,
  ContextVerificationItem,
  CourseLevelIntegritySummary,
  IntegrityFinalAssessmentRef,
  IntegrityReviewFile,
  IntegrityReviewReviewSummary,
  LearnerOwnershipEvidenceItem,
  OwnershipRequiredStatus,
  OwnershipUseStatus,
  PassiveAiRiskLevel,
  PassiveAiRiskSummary,
  ReflectionDefenseRequirement,
} from '../models/schemas.js';
import * as fileService from './file.service.js';
import { getWeightingRubricContext } from './weightingRubric.service.js';

const LAYER5_ID = 'layer5-integrity-ai';

// ----------------------------------------------------------------------------
// Generic raw-JSON pickers (mirror weightingRubric.service.ts)
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
  return pickArray(raw, keys)
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v): v is string => !!v);
}

function pickBool(raw: Record<string, unknown>, keys: string[], fallback = false): boolean {
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true' || s === 'yes' || s === 'required') return true;
      if (s === 'false' || s === 'no') return false;
    }
  }
  return fallback;
}

// ----------------------------------------------------------------------------
// Enum normalizers
// ----------------------------------------------------------------------------

function normalizeAllowedStatus(value: unknown): AiUseAllowedStatus {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (v.includes('not') || v.includes('unaccept') || v.includes('prohibit')) return 'not_acceptable';
    if (v.includes('caution')) return 'allowed_with_caution';
    if (v.includes('allow')) return 'allowed';
  }
  return 'allowed';
}

function normalizeRiskLevel(value: unknown): PassiveAiRiskLevel {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (v.includes('very') && v.includes('low')) return 'very_low';
    if (v === 'high' || v.includes('high')) return 'high';
    if (v === 'medium' || v.includes('med')) return 'medium';
    if (v === 'low' || v.includes('low')) return 'low';
  }
  return 'medium';
}

function normalizeRequiredStatus(value: unknown): OwnershipRequiredStatus {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (v.includes('not')) return 'not_required';
    if (v.includes('optional')) return 'optional';
    if (v.includes('require')) return 'required';
  }
  return 'required';
}

function normalizeUseStatus(value: unknown): OwnershipUseStatus {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (v.includes('integrity')) return 'integrity_evidence';
    if (v.includes('support')) return 'support_only';
    if (v.includes('grade')) return 'graded';
  }
  return 'support_only';
}

const VALID_REFLECTION: ReflectionDefenseRequirement[] = [
  'none',
  'written_reflection',
  'video_audio_explanation',
  'oral_defense_if_flagged',
  'sme_review_for_publication',
];

function normalizeReflection(value: unknown): ReflectionDefenseRequirement {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const exact = VALID_REFLECTION.find((r) => r === v);
    if (exact) return exact;
    if (v.includes('oral') || v.includes('defense') || v.includes('defence')) return 'oral_defense_if_flagged';
    if (v.includes('video') || v.includes('audio')) return 'video_audio_explanation';
    if (v.includes('publication') || v.includes('sme')) return 'sme_review_for_publication';
    if (v.includes('reflect') || v.includes('written')) return 'written_reflection';
    if (v.includes('none') || v.includes('no')) return 'none';
  }
  return 'written_reflection';
}

// ----------------------------------------------------------------------------
// Defaults (from Layer 5 spec) used when the AI omits a section
// ----------------------------------------------------------------------------

const DEFAULT_AI_USE_FRAMEWORK: AiUseFrameworkItem[] = [
  {
    ai_use_category: 'Research organization',
    meaning: 'AI helps organize sources or summarize themes',
    allowed_status: 'allowed',
    disclosure_required: true,
  },
  {
    ai_use_category: 'Brainstorming',
    meaning: 'AI helps generate possible ideas or criteria',
    allowed_status: 'allowed',
    disclosure_required: true,
  },
  {
    ai_use_category: 'Draft clarity support',
    meaning: 'AI helps improve wording or structure',
    allowed_status: 'allowed',
    disclosure_required: true,
  },
  {
    ai_use_category: 'Data pattern support',
    meaning: 'AI helps identify possible patterns for learner review',
    allowed_status: 'allowed_with_caution',
    disclosure_required: true,
  },
  {
    ai_use_category: 'Professional judgment replacement',
    meaning: 'AI makes final decisions for the learner',
    allowed_status: 'not_acceptable',
    disclosure_required: true,
  },
  {
    ai_use_category: 'Generic full submission',
    meaning: 'AI produces the assessment with little learner input',
    allowed_status: 'not_acceptable',
    disclosure_required: true,
  },
  {
    ai_use_category: 'Context invention',
    meaning: 'AI invents stakeholder/context details',
    allowed_status: 'not_acceptable',
    disclosure_required: true,
  },
];

const DEFAULT_OWNERSHIP_EVIDENCE: LearnerOwnershipEvidenceItem[] = [
  {
    evidence_item: 'Assessment context profile',
    purpose: 'Anchors work in a real or realistic setting',
    required_status: 'required',
    use_status: 'support_only',
  },
  {
    evidence_item: 'Problem statement',
    purpose: 'Shows learner-defined challenge',
    required_status: 'required',
    use_status: 'graded',
  },
  {
    evidence_item: 'Decision log',
    purpose: 'Shows choices and rationale',
    required_status: 'required',
    use_status: 'integrity_evidence',
  },
  {
    evidence_item: 'AI-use disclosure',
    purpose: 'Shows transparent AI use',
    required_status: 'required',
    use_status: 'integrity_evidence',
  },
  {
    evidence_item: 'Draft checkpoint',
    purpose: 'Shows process development',
    required_status: 'optional',
    use_status: 'support_only',
  },
  {
    evidence_item: 'Final reflection',
    purpose: 'Shows learner ownership and learning',
    required_status: 'required',
    use_status: 'graded',
  },
  {
    evidence_item: 'Evidence appendix',
    purpose: 'Shows sources, data, observations',
    required_status: 'required',
    use_status: 'graded',
  },
];

const DEFAULT_DISCLOSURE_FIELDS: AiUseDisclosureField[] = [
  { field: 'What did AI help with?', learner_must_explain: 'Brainstorming, structure, synthesis, editing, comparison, etc.' },
  { field: 'What AI output did you use?', learner_must_explain: 'Specific ideas, categories, wording, comparisons, etc.' },
  { field: 'What did you reject?', learner_must_explain: 'AI suggestions not used' },
  { field: 'Why did you reject it?', learner_must_explain: 'Context, accuracy, ethics, relevance, quality' },
  { field: 'What did you personally decide?', learner_must_explain: 'Final judgment, criteria, recommendation, design choices' },
  { field: 'How did you verify accuracy?', learner_must_explain: 'Sources, observations, data, stakeholder input' },
];

const DEFAULT_CONTEXT_VERIFICATION: ContextVerificationItem[] = [
  { check_item: 'Learner context is specific enough', required: true },
  { check_item: 'Stakeholder group is identified', required: true },
  { check_item: 'Constraints are named', required: true },
  { check_item: 'Institutional setting is realistic', required: true },
  { check_item: 'No confidential information is exposed', required: true },
  { check_item: 'Ethical/privacy risks are addressed', required: true },
];

// ----------------------------------------------------------------------------
// Parse AI (single-model) output for Layer 5
// ----------------------------------------------------------------------------

interface ParsedAiIntegrity {
  course: Partial<CourseLevelIntegritySummary>;
  reviewsById: Map<string, Partial<AssessmentIntegrityReview>>;
}

function parseAiIntegrity(outputJson: unknown): ParsedAiIntegrity {
  const root = (outputJson && typeof outputJson === 'object' ? outputJson : {}) as Record<
    string,
    unknown
  >;

  const courseRaw =
    pickObject(root, 'course_level_integrity_summary') ?? pickObject(root, 'course_summary') ?? {};

  const frameworkRaw = pickArray(courseRaw, ['ai_use_framework']).length
    ? pickArray(courseRaw, ['ai_use_framework'])
    : pickArray(root, ['ai_use_framework']);
  const ai_use_framework: AiUseFrameworkItem[] = frameworkRaw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      ai_use_category: pickString(e, ['ai_use_category', 'category']) || '',
      meaning: pickString(e, ['meaning', 'description']) || '',
      allowed_status: normalizeAllowedStatus(e.allowed_status ?? e.allowed),
      disclosure_required: pickBool(e, ['disclosure_required', 'disclosure'], true),
    }))
    .filter((e) => e.ai_use_category);

  const course: Partial<CourseLevelIntegritySummary> = {
    overall_integrity_position: pickString(courseRaw, ['overall_integrity_position', 'overall_position']),
    main_strengths: pickStringArray(courseRaw, ['main_strengths', 'strengths']),
    main_risks: pickStringArray(courseRaw, ['main_risks', 'risks']),
    sme_attention_points: pickStringArray(courseRaw, ['sme_attention_points', 'sme_attention', 'attention_points']),
    ai_use_framework: ai_use_framework.length ? ai_use_framework : undefined,
    full_integrity_report:
      pickString(courseRaw, ['full_integrity_report']) ||
      pickString(root, ['full_integrity_report', 'report_markdown']),
  };

  const list = pickArray(root, ['assessment_integrity_reviews', 'assessments', 'reviews']);
  const reviewsById = new Map<string, Partial<AssessmentIntegrityReview>>();

  list
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .forEach((raw, index) => {
      const id = pickString(raw, ['assessment_id', 'id']) || `A${index + 1}`;

      const riskRaw = pickObject(raw, 'passive_ai_risk_summary') ?? pickObject(raw, 'passive_ai_risk') ?? {};
      const passive_ai_risk_summary: PassiveAiRiskSummary = {
        risk_level: normalizeRiskLevel(riskRaw.risk_level ?? raw.passive_ai_risk ?? raw.risk_level),
        why_passive_ai_could_happen: pickString(riskRaw, ['why_passive_ai_could_happen', 'why_could_happen']) || '',
        why_assessment_resists_passive_ai:
          pickString(riskRaw, ['why_assessment_resists_passive_ai', 'why_resists']) || '',
        what_must_be_protected: pickStringArray(riskRaw, ['what_must_be_protected', 'protect']),
      };

      const ownershipRaw = pickArray(raw, ['learner_ownership_evidence', 'ownership_evidence']);
      const learner_ownership_evidence: LearnerOwnershipEvidenceItem[] = ownershipRaw
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => ({
          evidence_item: pickString(r, ['evidence_item', 'item', 'name']) || '',
          purpose: pickString(r, ['purpose']) || '',
          required_status: normalizeRequiredStatus(r.required_status ?? r.required),
          use_status: normalizeUseStatus(r.use_status ?? r.used_for_grading ?? r.use),
        }))
        .filter((r) => r.evidence_item);

      const disclosureRaw = pickArray(raw, ['ai_use_disclosure_requirements', 'ai_use_disclosure']);
      const ai_use_disclosure_requirements: AiUseDisclosureField[] = disclosureRaw
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => ({
          field: pickString(r, ['field', 'disclosure_field']) || '',
          learner_must_explain: pickString(r, ['learner_must_explain', 'explain', 'meaning']) || '',
        }))
        .filter((r) => r.field);

      const contextRaw = pickArray(raw, ['context_verification_requirements', 'context_verification']);
      const context_verification_requirements: ContextVerificationItem[] = contextRaw
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => ({
          check_item: pickString(r, ['check_item', 'item', 'check']) || '',
          required: pickBool(r, ['required'], true),
        }))
        .filter((r) => r.check_item);

      // Allow simple string arrays for context verification as a fallback.
      const contextStrings =
        context_verification_requirements.length === 0
          ? pickStringArray(raw, ['context_verification_requirements', 'context_verification']).map((s) => ({
              check_item: s,
              required: true,
            }))
          : context_verification_requirements;

      reviewsById.set(id, {
        passive_ai_risk_summary,
        learner_ownership_evidence,
        ai_use_disclosure_requirements,
        context_verification_requirements: contextStrings,
        reflection_or_defense_requirement: normalizeReflection(
          raw.reflection_or_defense_requirement ?? raw.reflection_requirement ?? raw.defense_requirement
        ),
        integrity_flags: pickStringArray(raw, ['integrity_flags', 'flags']),
      });
    });

  return { course, reviewsById };
}

// ----------------------------------------------------------------------------
// Build authoritative final-assessment references from Layer 3 + Layer 4
// ----------------------------------------------------------------------------

function buildFinalRefs(courseCode: string): Map<string, IntegrityFinalAssessmentRef> {
  const refs = new Map<string, IntegrityFinalAssessmentRef>();
  const weighting = getWeightingRubricContext(courseCode);

  for (const review of weighting.assessment_structure_reviews) {
    const final = review.final_assessment_from_layer_3;
    const rubricSummary = review.ai_assisted_analytic_rubric
      .map((c) => c.rubric_criterion)
      .filter((c) => !!c);
    refs.set(review.assessment_id, {
      title: final.title,
      required_artifact: final.required_artifact,
      refined_clo_alignment: final.refined_clo_alignment ?? [],
      selected_weight: review.selected_weight_from_step_1,
      rubric_summary: rubricSummary.length ? rubricSummary : final.suggested_evaluation_criteria ?? [],
    });
  }

  return refs;
}

function emptyReview(
  assessmentId: string,
  finalRef: IntegrityFinalAssessmentRef,
  ai?: Partial<AssessmentIntegrityReview>
): AssessmentIntegrityReview {
  return {
    assessment_id: assessmentId,
    final_assessment_reference: finalRef,
    passive_ai_risk_summary:
      ai?.passive_ai_risk_summary ?? {
        risk_level: 'medium',
        why_passive_ai_could_happen: '',
        why_assessment_resists_passive_ai: '',
        what_must_be_protected: [],
      },
    learner_ownership_evidence:
      ai?.learner_ownership_evidence && ai.learner_ownership_evidence.length
        ? ai.learner_ownership_evidence
        : DEFAULT_OWNERSHIP_EVIDENCE.map((e) => ({ ...e })),
    ai_use_disclosure_requirements:
      ai?.ai_use_disclosure_requirements && ai.ai_use_disclosure_requirements.length
        ? ai.ai_use_disclosure_requirements
        : DEFAULT_DISCLOSURE_FIELDS.map((e) => ({ ...e })),
    context_verification_requirements:
      ai?.context_verification_requirements && ai.context_verification_requirements.length
        ? ai.context_verification_requirements
        : DEFAULT_CONTEXT_VERIFICATION.map((e) => ({ ...e })),
    reflection_or_defense_requirement: ai?.reflection_or_defense_requirement ?? 'written_reflection',
    integrity_flags: ai?.integrity_flags ?? [],
    sme_decision: 'pending',
    sme_internal_note: undefined,
    approval_status: 'pending',
  };
}

// ----------------------------------------------------------------------------
// Read context (merge AI suggestions + Layer 3/4 refs + saved SME state)
// ----------------------------------------------------------------------------

export interface IntegrityReviewContext {
  course_level_integrity_summary: CourseLevelIntegritySummary;
  assessment_integrity_reviews: AssessmentIntegrityReview[];
  summary: IntegrityReviewReviewSummary;
  layer5GeneratedAt?: string;
}


export function getIntegrityReviewContext(courseCode: string): IntegrityReviewContext {
  const finalRefs = buildFinalRefs(courseCode);

  const layer5 = fileService.getStage1LayerState(courseCode, LAYER5_ID);
  const ai = parseAiIntegrity(layer5?.outputJson);

  const saved = fileService.getIntegrityReviewFile(courseCode);
  const savedReviewById = new Map<string, AssessmentIntegrityReview>();
  for (const r of saved?.assessment_integrity_reviews ?? []) {
    if (r.assessment_id) savedReviewById.set(r.assessment_id, r);
  }

  const reviews: AssessmentIntegrityReview[] = [];
  for (const [id, finalRef] of finalRefs) {
    const savedReview = savedReviewById.get(id);
    if (savedReview) {
      reviews.push({
        ...savedReview,
        // Authoritative reference always refreshed from Layer 3 / Layer 4.
        final_assessment_reference: finalRef,
      });
    } else {
      reviews.push(emptyReview(id, finalRef, ai.reviewsById.get(id)));
    }
  }

  const savedCourse = saved?.course_level_integrity_summary;
  const course_level_integrity_summary: CourseLevelIntegritySummary = {
    overall_integrity_position:
      savedCourse?.overall_integrity_position || ai.course.overall_integrity_position || '',
    main_strengths:
      savedCourse?.main_strengths?.length ? savedCourse.main_strengths : ai.course.main_strengths ?? [],
    main_risks: savedCourse?.main_risks?.length ? savedCourse.main_risks : ai.course.main_risks ?? [],
    sme_attention_points:
      savedCourse?.sme_attention_points?.length
        ? savedCourse.sme_attention_points
        : ai.course.sme_attention_points ?? [],
    ai_use_framework:
      savedCourse?.ai_use_framework?.length
        ? savedCourse.ai_use_framework
        : ai.course.ai_use_framework?.length
          ? ai.course.ai_use_framework
          : DEFAULT_AI_USE_FRAMEWORK.map((e) => ({ ...e })),
    full_integrity_report:
      savedCourse?.full_integrity_report || ai.course.full_integrity_report || '',
  };

  return {
    course_level_integrity_summary,
    assessment_integrity_reviews: reviews,
    summary: computeIntegritySummary(reviews),
    layer5GeneratedAt: layer5?.generatedAt,
  };
}

// ----------------------------------------------------------------------------
// Summary + validation
// ----------------------------------------------------------------------------

export function computeIntegritySummary(
  reviews: AssessmentIntegrityReview[]
): IntegrityReviewReviewSummary {
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

  return {
    total_assessments: reviews.length,
    pending_count,
    approved_count,
    needs_revision_count,
    all_approved: reviews.length > 0 && approved_count === reviews.length,
  };
}

// ----------------------------------------------------------------------------
// Save (whole SME working file)
// ----------------------------------------------------------------------------

export function saveIntegrityReview(
  courseCode: string,
  payload: {
    course_level_integrity_summary: CourseLevelIntegritySummary;
    assessment_integrity_reviews: AssessmentIntegrityReview[];
  }
): {
  course_level_integrity_summary: CourseLevelIntegritySummary;
  assessment_integrity_reviews: AssessmentIntegrityReview[];
  summary: IntegrityReviewReviewSummary;
} {
  const course = payload.course_level_integrity_summary;
  const reviews = payload.assessment_integrity_reviews ?? [];

  const file: IntegrityReviewFile = {
    course_level_integrity_summary: course,
    assessment_integrity_reviews: reviews,
    updated_at: new Date().toISOString(),
  };
  fileService.saveIntegrityReviewFile(courseCode, file);

  return {
    course_level_integrity_summary: course,
    assessment_integrity_reviews: reviews,
    summary: computeIntegritySummary(reviews),
  };
}

export function seedIntegrityFromOutput(courseCode: string): IntegrityReviewContext {
  const ctx = getIntegrityReviewContext(courseCode);
  saveIntegrityReview(courseCode, {
    course_level_integrity_summary: ctx.course_level_integrity_summary,
    assessment_integrity_reviews: ctx.assessment_integrity_reviews,
  });
  return ctx;
}

export function assertLayer5ReadyForApproval(courseCode: string): void {
  const { summary } = getIntegrityReviewContext(courseCode);
  if (summary.total_assessments === 0) {
    throw new Error('No assessment integrity reviews to approve. Run Layer 5 first.');
  }
  if (!summary.all_approved) {
    throw new Error(
      `Every assessment integrity design must be approved before approving Layer 5 (${summary.pending_count} pending, ${summary.needs_revision_count} need revision).`
    );
  }
}

/** Compact authoritative summary for downstream layers (order > 5). */
export function buildApprovedIntegrityContext(courseCode: string): string {
  const saved = fileService.getIntegrityReviewFile(courseCode);
  if (!saved) return '';
  const reviews = saved.assessment_integrity_reviews ?? [];
  if (!reviews.length) return '';

  const lines = reviews
    .map((r) => {
      const ownership = r.learner_ownership_evidence
        .filter((e) => e.required_status === 'required')
        .map((e) => e.evidence_item)
        .join(', ');
      return (
        `- ${r.assessment_id} — ${r.final_assessment_reference.title}\n` +
        `    Passive AI risk: ${r.passive_ai_risk_summary.risk_level}\n` +
        `    Required ownership evidence: ${ownership || 'n/a'}\n` +
        `    Reflection/defense: ${r.reflection_or_defense_requirement}`
      );
    })
    .join('\n');

  return (
    `### SME-APPROVED ASSESSMENT INTEGRITY REQUIREMENTS (AUTHORITATIVE)\n` +
    `These approved integrity and active-AI-use requirements must be preserved downstream.\n\n${lines}`
  );
}
