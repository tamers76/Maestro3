/**
 * Node Review Triage (Issue 1 — review by exception).
 *
 * Derives a per-node `review_priority` ('must_review' | 'can_proceed') and the
 * `review_reasons` that explain it, from signals the node ALREADY carries plus a
 * little node-set context. Pure + synchronous so it is unit-testable and can be
 * mirrored client-side for older artifacts.
 *
 * A node is `must_review` if ANY of the agreed rules fire (see deriveNodeReviewTriage);
 * otherwise it is `can_proceed`. `can_proceed` nodes are still fully visible and
 * openable — triage only changes what is FLAGGED, never what is hidden, and never
 * gates approval on its own (the academic-approval guard is unchanged).
 */
import type {
  Assessment,
  GroundingSourceKind,
  Node,
  NodeReviewPriority,
} from '../models/nodeEngine.js';

export interface NodeReviewTriageContext {
  /** The node-set's dominant grounding source (rule 4 — fallback grounding). */
  groundingSource?: GroundingSourceKind;
  /** Assessments referenced by the node-set, keyed by assessment_id (rule 6). */
  assessmentsById?: Map<string, Pick<Assessment, 'assessment_id' | 'type' | 'label' | 'weighting'>>;
}

export interface NodeReviewTriageResult {
  review_priority: NodeReviewPriority;
  review_reasons: string[];
}

/**
 * Best-effort summative detection. `Assessment.type` is a free string (projected
 * from the legacy `type_or_format`), so we use a documented heuristic:
 *  - type or label/title contains "summative" / "final" / "exam"; OR
 *  - a non-trivial approved weighting (>= 30%).
 * If neither holds we return false (and rule 6 does NOT fire) — we never flag a
 * node on summative-ness we cannot establish.
 */
const NON_TRIVIAL_WEIGHTING_PERCENT = 30;

export function assessmentLooksSummative(
  assessment: Pick<Assessment, 'type' | 'label' | 'weighting'> | undefined
): boolean {
  if (!assessment) return false;
  const text = `${assessment.type ?? ''} ${assessment.label ?? ''}`.toLowerCase();
  if (/\b(summative|final|exam)\b/.test(text)) return true;
  if (assessment.weighting) {
    const pct = parseFloat(String(assessment.weighting).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(pct) && pct >= NON_TRIVIAL_WEIGHTING_PERCENT) return true;
  }
  return false;
}

/**
 * Derive the review-by-exception triage for one node. Rules (exactly the agreed
 * set — note `evidence_map[].critical` and generic "pending misconceptions" are
 * deliberately NOT triggers; they caused the original over-flagging):
 *
 *  1. Assessment-blocking misconception (binding blocks submission if confirmed).
 *  2. High-severity misconception on an assessment-facing node.
 *  3. High-severity candidate misconception (anywhere).
 *  4. Weak / fallback / thin grounding.
 *  5. Generator uncertainty on a high-stakes node.
 *  6. Prepares for a SUMMATIVE assessment (best-effort).
 */
export function deriveNodeReviewTriage(
  node: Node,
  context: NodeReviewTriageContext = {}
): NodeReviewTriageResult {
  const reasons: string[] = [];
  const assessmentFacing = Boolean(node.prepares_for_assessment_id);

  // 1. Assessment-blocking misconception.
  if (node.misconception_bindings.some((b) => b.blocks_submission_if_state === 'confirmed')) {
    reasons.push('Assessment-blocking misconception');
  }

  // 2. High-severity misconception on an assessment-facing node.
  if (
    assessmentFacing &&
    (node.candidate_misconceptions.some((c) => c.severity === 'high') ||
      node.misconception_bindings.some((b) => b.severity === 'high'))
  ) {
    reasons.push('High-severity misconception on assessment node');
  }

  // 3. High-severity candidate misconception (anywhere).
  if (node.candidate_misconceptions.some((c) => c.severity === 'high')) {
    reasons.push('High-severity misconception');
  }

  // 4. Weak / fallback / thin grounding. A weak grounding_strength already folds
  // in "scoped but all citations failed the quality gate" (Issue 2, rule D).
  if (node.grounding_strength === 'weak' || context.groundingSource === 'course_level_references') {
    reasons.push('Weak or thin grounding');
  }

  // 5. Generator uncertainty on a high-stakes node.
  if (
    node.generator_divergence_note &&
    (node.risk_classification.includes('critical') || assessmentFacing)
  ) {
    reasons.push('Generator uncertainty on high-stakes node');
  }

  // 6. Prepares for a summative assessment (best-effort; is_core dropped per decision).
  if (node.prepares_for_assessment_id) {
    const assessment = context.assessmentsById?.get(node.prepares_for_assessment_id);
    if (assessmentLooksSummative(assessment)) {
      reasons.push('Prepares for a summative assessment');
    }
  }

  const uniqueReasons = Array.from(new Set(reasons));
  return {
    review_priority: uniqueReasons.length > 0 ? 'must_review' : 'can_proceed',
    review_reasons: uniqueReasons,
  };
}
