import type {
  CLO,
  CloApprovalStatus,
  CloRefinementItem,
  CloRefinementReviewSummary,
  CloRefinementsFile,
  CouncilFeedbackSummary,
  FullCouncilAnalysis,
  SmeRefinementDecision,
  SuggestedCloRefinement,
} from '../models/schemas.js';
import * as fileService from './file.service.js';

const LAYER2_ID = 'layer2-clo-review';

const EMPTY_FEEDBACK: CouncilFeedbackSummary = {};
const EMPTY_ANALYSIS: FullCouncilAnalysis = {};

function pickString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = raw[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function pickObject(raw: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = raw[key];
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

function parseFeedbackSummary(raw: Record<string, unknown>): CouncilFeedbackSummary {
  const nested = pickObject(raw, 'council_feedback_summary');
  if (nested) {
    return {
      strengths: pickString(nested, ['strengths', 'Strengths']),
      risks_limitations: pickString(nested, ['risks_limitations', 'risks', 'Risks']),
      adaptive_readiness_notes: pickString(nested, [
        'adaptive_readiness_notes',
        'adaptive_readiness',
      ]),
      evidence_of_mastery_direction: pickString(nested, [
        'evidence_of_mastery_direction',
        'evidence_of_mastery',
      ]),
      chairman_recommendation: pickString(nested, [
        'chairman_recommendation',
        'chairman_recommendation',
      ]),
    };
  }
  return {
    strengths: pickString(raw, ['strengths', 'Strengths']),
    risks_limitations: pickString(raw, ['risks', 'risks_limitations', 'Risks or limitations']),
    adaptive_readiness_notes: pickString(raw, ['adaptive_readiness_notes', 'role_in_journey']),
    evidence_of_mastery_direction: pickString(raw, [
      'evidence_of_mastery_direction',
      'evidence_of_mastery',
      'Expected evidence of mastery',
    ]),
    chairman_recommendation: pickString(raw, [
      'chairman_recommendation',
      'maestro_interpretation',
      'Maestro interpretation',
      'sme_decision_required',
    ]),
  };
}

function parseFullAnalysis(raw: Record<string, unknown>): FullCouncilAnalysis {
  const nested = pickObject(raw, 'full_council_analysis');
  if (nested) {
    return {
      learning_outcome_quality: pickString(nested, ['learning_outcome_quality']),
      curriculum_coherence: pickString(nested, [
        'curriculum_coherence',
        'relationship_to_other_clos',
      ]),
      adaptive_readiness: pickString(nested, ['adaptive_readiness']),
      assessment_evidence: pickString(nested, ['assessment_evidence']),
      discipline_context: pickString(nested, ['discipline_context']),
      chairman_synthesis: pickString(nested, ['chairman_synthesis']),
      council_disagreement: pickString(nested, ['council_disagreement']),
    };
  }
  const diagnosis = pickString(raw, ['diagnosis', 'Diagnosis']);
  const parts: string[] = [];
  if (diagnosis) parts.push(`Diagnosis: ${diagnosis}`);
  const maestro = pickString(raw, ['maestro_interpretation', 'Maestro interpretation']);
  if (maestro) parts.push(maestro);
  const role = pickString(raw, ['role_in_journey', 'Role in the learning journey']);
  if (role) parts.push(`Role in journey: ${role}`);
  const rel = pickString(raw, ['relationship_to_other_clos', 'Relationship to other CLOs']);
  if (rel) parts.push(`Relationships: ${rel}`);

  return {
    learning_outcome_quality: diagnosis || maestro,
    curriculum_coherence: rel,
    adaptive_readiness: role,
    assessment_evidence: pickString(raw, ['assessment_evidence']),
    discipline_context: pickString(raw, ['discipline_context']),
    chairman_synthesis: maestro,
    council_disagreement: pickString(raw, ['council_disagreement']),
  };
}

function parseRationale(raw: Record<string, unknown>): string[] {
  const arr = raw.refinement_rationale;
  if (Array.isArray(arr)) {
    return arr
      .filter((x): x is string => typeof x === 'string' && !!x.trim())
      .map((s) => s.trim());
  }
  const single = pickString(raw, ['rationale', 'Rationale']);
  if (single) return [single];
  return [];
}

export function normalizeSuggestedRefinement(
  raw: Record<string, unknown>,
  fallbackCloId: string,
  fallbackOfficial: string
): SuggestedCloRefinement {
  const official =
    pickString(raw, ['official_clo', 'original_clo', 'original_CLO', 'Original CLO', 'clo_text']) ||
    fallbackOfficial;
  const aiSuggested =
    pickString(raw, [
      'ai_suggested_refined_clo',
      'suggested_refined_clo',
      'Suggested refined CLO',
      'refined_clo',
    ]) || official;

  return {
    clo_id: pickString(raw, ['clo_id', 'CLO_id', 'id']) || fallbackCloId,
    official_clo: official,
    council_feedback_summary: parseFeedbackSummary(raw),
    full_council_analysis: parseFullAnalysis(raw),
    ai_suggested_refined_clo: aiSuggested,
    refinement_rationale: parseRationale(raw),
  };
}

export function parseLayer2Suggestions(outputJson: unknown, clos: CLO[]): SuggestedCloRefinement[] {
  const data = outputJson as { clos?: unknown[] };
  const rawList = Array.isArray(data?.clos) ? data.clos : [];
  const byId = new Map(clos.map((c) => [c.clo_id, c]));
  const suggestions: SuggestedCloRefinement[] = [];

  rawList.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const raw = entry as Record<string, unknown>;
    const cloId =
      pickString(raw, ['clo_id', 'CLO_id', 'id']) || clos[index]?.clo_id || `CLO-${index + 1}`;
    const contractClo = byId.get(cloId) ?? clos[index];
    suggestions.push(
      normalizeSuggestedRefinement(raw, cloId, contractClo?.clo_text || '')
    );
  });

  clos.forEach((clo) => {
    if (!suggestions.some((s) => s.clo_id === clo.clo_id)) {
      suggestions.push({
        clo_id: clo.clo_id,
        official_clo: clo.clo_text,
        council_feedback_summary: {
          strengths: 'No AI review returned for this CLO.',
        },
        full_council_analysis: EMPTY_ANALYSIS,
        ai_suggested_refined_clo: clo.clo_text,
        refinement_rationale: [],
      });
    }
  });

  return suggestions;
}

function migrateLegacyDecision(raw: string | undefined): SmeRefinementDecision {
  switch (raw) {
    case 'keep_original':
    case 'keep_official':
      return 'keep_official';
    case 'accept_refined':
    case 'accept_ai_refinement':
      return 'accept_ai_refinement';
    case 'custom':
    case 'custom_wording':
      return 'custom_wording';
    default:
      return 'pending';
  }
}

/** Best-effort migration from pre-redesign saved items */
function migrateLegacyItem(raw: Record<string, unknown>, clo: CLO): CloRefinementItem {
  const suggestionShape = normalizeSuggestedRefinement(raw, clo.clo_id, clo.clo_text);
  const legacyDecision = migrateLegacyDecision(
    typeof raw.sme_decision === 'string' ? raw.sme_decision : undefined
  );
  const finalText =
    pickString(raw, ['final_clo_for_adaptive_design', 'refined_clo_text']) ||
    (legacyDecision === 'keep_official'
      ? clo.clo_text
      : pickString(raw, ['suggested_refined_clo', 'ai_suggested_refined_clo']) || clo.clo_text);

  let approvalStatus: CloApprovalStatus = 'pending';
  if (typeof raw.approval_status === 'string') {
    const s = raw.approval_status as CloApprovalStatus;
    if (s === 'approved' || s === 'needs_revision' || s === 'pending') approvalStatus = s;
  } else if (legacyDecision !== 'pending') {
    approvalStatus = 'approved';
  }

  return {
    clo_id: clo.clo_id,
    official_clo: clo.clo_text,
    council_feedback_summary:
      pickObject(raw, 'council_feedback_summary') != null
        ? parseFeedbackSummary(raw)
        : suggestionShape.council_feedback_summary,
    full_council_analysis:
      pickObject(raw, 'full_council_analysis') != null
        ? parseFullAnalysis(raw)
        : suggestionShape.full_council_analysis,
    ai_suggested_refined_clo:
      pickString(raw, ['ai_suggested_refined_clo', 'suggested_refined_clo']) ||
      suggestionShape.ai_suggested_refined_clo,
    refinement_rationale: parseRationale(raw).length
      ? parseRationale(raw)
      : suggestionShape.refinement_rationale,
    sme_decision: legacyDecision,
    final_clo_for_adaptive_design: finalText,
    sme_internal_note: pickString(raw, ['sme_internal_note', 'sme_notes']),
    approval_status: approvalStatus,
  };
}

function suggestionToItem(
  clo: CLO,
  suggestion: SuggestedCloRefinement,
  saved?: CloRefinementItem
): CloRefinementItem {
  if (saved) {
    return {
      ...saved,
      official_clo: clo.clo_text,
      council_feedback_summary: {
        ...suggestion.council_feedback_summary,
        ...Object.fromEntries(
          Object.entries(saved.council_feedback_summary).filter(([, v]) => v?.trim())
        ),
      },
      full_council_analysis: {
        ...suggestion.full_council_analysis,
        ...Object.fromEntries(
          Object.entries(saved.full_council_analysis).filter(([, v]) => v?.trim())
        ),
      },
      ai_suggested_refined_clo: suggestion.ai_suggested_refined_clo,
      refinement_rationale:
        saved.refinement_rationale?.length > 0
          ? saved.refinement_rationale
          : suggestion.refinement_rationale,
    };
  }

  const ai = suggestion.ai_suggested_refined_clo.trim() || clo.clo_text;
  return {
    clo_id: clo.clo_id,
    official_clo: clo.clo_text,
    council_feedback_summary: suggestion.council_feedback_summary,
    full_council_analysis: suggestion.full_council_analysis,
    ai_suggested_refined_clo: ai,
    refinement_rationale: suggestion.refinement_rationale,
    sme_decision: 'pending',
    final_clo_for_adaptive_design: ai,
    sme_internal_note: undefined,
    approval_status: 'pending',
  };
}

function loadSavedItems(courseCode: string, clos: CLO[]): Map<string, CloRefinementItem> {
  const file = fileService.getCloRefinementsFile(courseCode);
  const map = new Map<string, CloRefinementItem>();
  for (const raw of file?.items ?? []) {
    const entry = raw as CloRefinementItem & Record<string, unknown>;
    const clo = clos.find((c) => c.clo_id === entry.clo_id);
    if (!clo) continue;
    if ('final_clo_for_adaptive_design' in entry && entry.council_feedback_summary != null) {
      map.set(clo.clo_id, {
        ...entry,
        official_clo: clo.clo_text,
      });
    } else {
      map.set(clo.clo_id, migrateLegacyItem(entry as Record<string, unknown>, clo));
    }
  }
  return map;
}

function mergeItem(
  clo: CLO,
  saved: CloRefinementItem | undefined,
  suggestion: SuggestedCloRefinement | undefined
): CloRefinementItem {
  if (!suggestion) {
    if (saved) return { ...saved, official_clo: clo.clo_text };
    return {
      clo_id: clo.clo_id,
      official_clo: clo.clo_text,
      council_feedback_summary: EMPTY_FEEDBACK,
      full_council_analysis: EMPTY_ANALYSIS,
      ai_suggested_refined_clo: clo.clo_text,
      refinement_rationale: [],
      sme_decision: 'pending',
      final_clo_for_adaptive_design: clo.clo_text,
      approval_status: 'pending',
    };
  }
  return suggestionToItem(clo, suggestion, saved);
}

export function getCloRefinementContext(courseCode: string): {
  clos: CLO[];
  suggestions: SuggestedCloRefinement[];
  refinements: CloRefinementItem[];
  summary: CloRefinementReviewSummary;
  layer2GeneratedAt?: string;
} {
  const contract = fileService.getCourseContract(courseCode);
  const clos = contract?.course_learning_outcomes ?? [];
  const layer2 = fileService.getStage1LayerState(courseCode, LAYER2_ID);
  const suggestions = layer2?.outputJson
    ? parseLayer2Suggestions(layer2.outputJson, clos)
    : [];
  const savedMap = loadSavedItems(courseCode, clos);
  const suggestionMap = new Map(suggestions.map((s) => [s.clo_id, s]));

  const refinements = clos.map((clo) =>
    mergeItem(clo, savedMap.get(clo.clo_id), suggestionMap.get(clo.clo_id))
  );

  return {
    clos,
    suggestions,
    refinements,
    summary: computeSummary(refinements),
    layer2GeneratedAt: layer2?.generatedAt,
  };
}

export function computeSummary(items: CloRefinementItem[]): CloRefinementReviewSummary {
  let pending_count = 0;
  let approved_count = 0;
  let needs_revision_count = 0;

  for (const item of items) {
    switch (item.approval_status) {
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
    total_clos: items.length,
    pending_count,
    approved_count,
    needs_revision_count,
    all_approved: items.length > 0 && approved_count === items.length,
  };
}

export function saveCloRefinements(
  courseCode: string,
  items: CloRefinementItem[]
): { refinements: CloRefinementItem[]; summary: CloRefinementReviewSummary } {
  const contract = fileService.getCourseContract(courseCode);
  const clos = contract?.course_learning_outcomes ?? [];
  const validIds = new Set(clos.map((c) => c.clo_id));

  const normalized = items
    .filter((i) => validIds.has(i.clo_id))
    .map((item) => {
      const clo = clos.find((c) => c.clo_id === item.clo_id)!;
      return {
        ...item,
        official_clo: clo.clo_text,
        final_clo_for_adaptive_design:
          item.final_clo_for_adaptive_design?.trim() || clo.clo_text,
      };
    });

  const file: CloRefinementsFile = {
    items: normalized,
    updated_at: new Date().toISOString(),
  };
  fileService.saveCloRefinementsFile(courseCode, file);

  return { refinements: normalized, summary: computeSummary(normalized) };
}

export function assertLayer2ReadyForApproval(items: CloRefinementItem[]): void {
  const summary = computeSummary(items);
  if (!summary.all_approved) {
    throw new Error(
      `All CLOs must be approved before approving Layer 2 (${summary.pending_count} pending, ${summary.needs_revision_count} need revision).`
    );
  }
  for (const item of items) {
    if (!item.final_clo_for_adaptive_design?.trim()) {
      throw new Error(`CLO ${item.clo_id} is missing final wording for adaptive design.`);
    }
  }
}

export function applyApprovedRefinementsToContract(courseCode: string): void {
  const file = fileService.getCloRefinementsFile(courseCode);
  if (!file?.items.length) {
    throw new Error('No CLO refinements saved. Review and save refinements before approving.');
  }

  assertLayer2ReadyForApproval(file.items);

  const contract = fileService.getCourseContract(courseCode);
  if (!contract) throw new Error('Course contract not found');

  const decisionMap = new Map(file.items.map((i) => [i.clo_id, i]));

  const updatedClos = contract.course_learning_outcomes.map((clo) => {
    const item = decisionMap.get(clo.clo_id);
    if (!item) return clo;
    const text =
      item.sme_decision === 'keep_official'
        ? item.official_clo
        : item.final_clo_for_adaptive_design.trim();
    return { ...clo, clo_text: text };
  });

  fileService.saveCourseContract(courseCode, {
    ...contract,
    course_learning_outcomes: updatedClos,
  });
}

export function seedRefinementsFromSuggestions(courseCode: string): CloRefinementItem[] {
  const contract = fileService.getCourseContract(courseCode);
  const clos = contract?.course_learning_outcomes ?? [];
  const layer2 = fileService.getStage1LayerState(courseCode, LAYER2_ID);
  const suggestions = layer2?.outputJson
    ? parseLayer2Suggestions(layer2.outputJson, clos)
    : [];
  const savedMap = loadSavedItems(courseCode, clos);

  const items = clos.map((clo) => {
    const s = suggestions.find((x) => x.clo_id === clo.clo_id);
    const saved = savedMap.get(clo.clo_id);
    if (!s) return mergeItem(clo, saved, undefined);
    return mergeItem(clo, saved, s);
  });

  saveCloRefinements(courseCode, items);
  return items;
}
