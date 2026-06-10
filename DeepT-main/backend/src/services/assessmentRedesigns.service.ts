import type {
  Assessment,
  AssessmentRedesignItem,
  AssessmentRedesignReviewSummary,
  AssessmentRedesignsFile,
  AiSuggestedRedesign,
  CouncilAssessmentSummary,
  FinalAssessmentForMaestro,
  FullAssessmentCouncilAnalysis,
  OriginalAssessment,
  SuggestedAssessmentRedesign,
} from '../models/schemas.js';
import * as fileService from './file.service.js';

const LAYER3_ID = 'layer3-assessment-redesign';

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

function pickStringArray(raw: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const v = raw[key];
    if (Array.isArray(v)) {
      return v
        .map((x) => (typeof x === 'string' ? x.trim() : typeof x === 'number' ? String(x) : ''))
        .filter((x) => !!x);
    }
    if (typeof v === 'string' && v.trim()) {
      return [v.trim()];
    }
  }
  return [];
}

/**
 * Build the Original Assessment authoritatively from the syllabus snapshot.
 * Never reads title/description from council `raw` output.
 */
function originalFromSnapshot(a: Assessment | undefined): OriginalAssessment {
  return {
    title: a?.name || 'Untitled assessment',
    description: a?.description || '',
    type_or_format: a?.type || '',
    weight: a?.weight != null ? String(a.weight) : '',
  };
}

function parseCouncilSummary(raw: Record<string, unknown>): CouncilAssessmentSummary {
  const nested = pickObject(raw, 'council_summary') ?? raw;
  return {
    what_works_well: pickString(nested, ['what_works_well', 'strengths']),
    what_may_limit_the_assessment: pickString(nested, [
      'what_may_limit_the_assessment',
      'limitations',
      'risks',
    ]),
    why_contribution_redesign_helps: pickString(nested, [
      'why_contribution_redesign_helps',
      'why_redesign_helps',
    ]),
    recommendation: pickString(nested, ['recommendation']),
  };
}

function parseAiRedesign(raw: Record<string, unknown>): AiSuggestedRedesign {
  const nested = pickObject(raw, 'ai_suggested_redesign') ?? raw;
  return {
    redesigned_title: pickString(nested, ['redesigned_title', 'title']) || '',
    redesigned_description: pickString(nested, ['redesigned_description', 'description']) || '',
    contribution_purpose: pickString(nested, ['contribution_purpose']) || '',
    refined_clo_alignment: pickStringArray(nested, ['refined_clo_alignment']),
    fixed_academic_core: pickString(nested, ['fixed_academic_core']) || '',
    personalized_context_variables: pickStringArray(nested, ['personalized_context_variables']),
    required_artifact: pickString(nested, ['required_artifact']) || '',
    output_format_options: pickStringArray(nested, ['output_format_options']),
    suggested_evaluation_criteria: pickStringArray(nested, [
      'suggested_evaluation_criteria',
      'draft_rubric_criteria',
      'rubric_criteria',
    ]),
    readiness_gate_needs: pickStringArray(nested, ['readiness_gate_needs']),
    ai_integrity_features: pickStringArray(nested, ['ai_integrity_features']),
    publication_potential: pickString(nested, ['publication_potential']) || 'private',
  };
}

function parseFullAnalysis(raw: Record<string, unknown>): FullAssessmentCouncilAnalysis {
  const nested = pickObject(raw, 'full_council_analysis') ?? raw;
  return {
    clo_alignment_reasoning: pickString(nested, ['clo_alignment_reasoning']),
    authentic_contribution_reasoning: pickString(nested, ['authentic_contribution_reasoning']),
    personalization_fairness_reasoning: pickString(nested, ['personalization_fairness_reasoning']),
    rubric_validity_reasoning: pickString(nested, ['rubric_validity_reasoning']),
    ai_integrity_reasoning: pickString(nested, ['ai_integrity_reasoning']),
    publication_impact_reasoning: pickString(nested, ['publication_impact_reasoning']),
    council_disagreements: pickString(nested, ['council_disagreements', 'council_disagreement']),
    chairman_synthesis: pickString(nested, ['chairman_synthesis']),
    sme_risks_to_review: pickStringArray(nested, ['sme_risks_to_review', 'risks']),
    sme_questions: pickStringArray(nested, ['sme_questions', 'questions']),
  };
}

function normalizeSuggestedRedesign(
  raw: Record<string, unknown>,
  fallbackId: string,
  fallbackOriginal: Assessment | undefined
): SuggestedAssessmentRedesign {
  return {
    assessment_id: pickString(raw, ['assessment_id', 'id']) || fallbackId,
    original_assessment: originalFromSnapshot(fallbackOriginal),
    council_summary: parseCouncilSummary(raw),
    ai_suggested_redesign: parseAiRedesign(raw),
    full_council_analysis: parseFullAnalysis(raw),
    redesign_rationale: pickStringArray(raw, ['redesign_rationale', 'rationale']),
  };
}

export function parseLayer3Suggestions(
  outputJson: unknown,
  originalAssessments: Assessment[]
): SuggestedAssessmentRedesign[] {
  const data = outputJson as { assessments?: unknown[] };
  const rawList = Array.isArray(data?.assessments) ? data.assessments : [];
  const suggestions: SuggestedAssessmentRedesign[] = [];

  rawList.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const raw = entry as Record<string, unknown>;
    const fallbackId = `A${index + 1}`;
    suggestions.push(normalizeSuggestedRedesign(raw, fallbackId, originalAssessments[index]));
  });

  // Ensure every original assessment has at least a placeholder suggestion
  originalAssessments.forEach((assessment, index) => {
    const id = `A${index + 1}`;
    if (suggestions.some((s) => s.assessment_id === id)) return;
    if (suggestions.some((s) => s.original_assessment.title === assessment.name)) return;
    suggestions.push({
      assessment_id: id,
      original_assessment: originalFromSnapshot(assessment),
      council_summary: {
        what_works_well: 'No AI review returned for this assessment.',
      },
      ai_suggested_redesign: {
        redesigned_title: assessment.name,
        redesigned_description: '',
        contribution_purpose: '',
        refined_clo_alignment: [],
        fixed_academic_core: '',
        personalized_context_variables: [],
        required_artifact: '',
        output_format_options: [],
        suggested_evaluation_criteria: [],
        readiness_gate_needs: [],
        ai_integrity_features: [],
        publication_potential: 'private',
      },
      full_council_analysis: {
        sme_risks_to_review: [],
        sme_questions: [],
      },
      redesign_rationale: [],
    });
  });

  return suggestions;
}

function finalFromRedesign(ai: AiSuggestedRedesign): FinalAssessmentForMaestro {
  return {
    title: ai.redesigned_title,
    description: ai.redesigned_description || ai.contribution_purpose,
    refined_clo_alignment: ai.refined_clo_alignment,
    required_artifact: ai.required_artifact,
    output_format_options: ai.output_format_options,
    fixed_academic_core: ai.fixed_academic_core,
    personalized_context_variables: ai.personalized_context_variables,
    suggested_evaluation_criteria: ai.suggested_evaluation_criteria,
    readiness_gate_needs: ai.readiness_gate_needs,
    ai_integrity_features: ai.ai_integrity_features,
    publication_potential: ai.publication_potential,
  };
}

function finalFromOriginal(original: OriginalAssessment): FinalAssessmentForMaestro {
  return {
    title: original.title,
    description: original.description,
    refined_clo_alignment: [],
    required_artifact: '',
    output_format_options: [],
    fixed_academic_core: '',
    personalized_context_variables: [],
    suggested_evaluation_criteria: [],
    readiness_gate_needs: [],
    ai_integrity_features: [],
    publication_potential: 'private',
  };
}

function suggestionToItem(
  suggestion: SuggestedAssessmentRedesign,
  saved?: AssessmentRedesignItem
): AssessmentRedesignItem {
  if (saved) {
    return {
      ...saved,
      original_assessment: suggestion.original_assessment,
      council_summary: suggestion.council_summary,
      ai_suggested_redesign: suggestion.ai_suggested_redesign,
      full_council_analysis: suggestion.full_council_analysis,
      redesign_rationale:
        saved.redesign_rationale?.length > 0
          ? saved.redesign_rationale
          : suggestion.redesign_rationale,
    };
  }

  return {
    ...suggestion,
    sme_decision: 'pending',
    final_assessment_for_maestro: finalFromRedesign(suggestion.ai_suggested_redesign),
    sme_internal_note: undefined,
    approval_status: 'pending',
  };
}

function isStructuredItem(entry: Record<string, unknown>): boolean {
  return (
    'final_assessment_for_maestro' in entry &&
    'ai_suggested_redesign' in entry &&
    entry.full_council_analysis != null
  );
}

function loadSavedItems(courseCode: string): Map<string, AssessmentRedesignItem> {
  const file = fileService.getAssessmentRedesignsFile(courseCode);
  const map = new Map<string, AssessmentRedesignItem>();
  for (const raw of file?.items ?? []) {
    const entry = raw as AssessmentRedesignItem & Record<string, unknown>;
    if (!entry.assessment_id) continue;
    if (isStructuredItem(entry)) {
      map.set(entry.assessment_id, entry);
    }
  }
  return map;
}

export function getAssessmentRedesignContext(courseCode: string): {
  suggestions: SuggestedAssessmentRedesign[];
  redesigns: AssessmentRedesignItem[];
  summary: AssessmentRedesignReviewSummary;
  layer3GeneratedAt?: string;
} {
  const snapshot = fileService.getExtractedSnapshot(courseCode);
  const originalAssessments = snapshot?.assessments ?? [];
  const layer3 = fileService.getStage1LayerState(courseCode, LAYER3_ID);
  const suggestions = layer3?.outputJson
    ? parseLayer3Suggestions(layer3.outputJson, originalAssessments)
    : [];
  const savedMap = loadSavedItems(courseCode);

  const redesigns = suggestions.map((s) => suggestionToItem(s, savedMap.get(s.assessment_id)));

  return {
    suggestions,
    redesigns,
    summary: computeSummary(redesigns),
    layer3GeneratedAt: layer3?.generatedAt,
  };
}

export function computeSummary(items: AssessmentRedesignItem[]): AssessmentRedesignReviewSummary {
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
    total_assessments: items.length,
    pending_count,
    approved_count,
    needs_revision_count,
    all_approved: items.length > 0 && approved_count === items.length,
  };
}

export function saveAssessmentRedesigns(
  courseCode: string,
  items: AssessmentRedesignItem[]
): { redesigns: AssessmentRedesignItem[]; summary: AssessmentRedesignReviewSummary } {
  const normalized = items.map((item) => ({
    ...item,
    final_assessment_for_maestro:
      item.final_assessment_for_maestro ?? finalFromRedesign(item.ai_suggested_redesign),
  }));

  const file: AssessmentRedesignsFile = {
    items: normalized,
    updated_at: new Date().toISOString(),
  };
  fileService.saveAssessmentRedesignsFile(courseCode, file);

  return { redesigns: normalized, summary: computeSummary(normalized) };
}

export function seedRedesignsFromSuggestions(courseCode: string): AssessmentRedesignItem[] {
  const { redesigns } = getAssessmentRedesignContext(courseCode);
  saveAssessmentRedesigns(courseCode, redesigns);
  return redesigns;
}

export function assertLayer3ReadyForApproval(items: AssessmentRedesignItem[]): void {
  const summary = computeSummary(items);
  if (!summary.all_approved) {
    throw new Error(
      `All assessments must be approved before approving Layer 3 (${summary.pending_count} pending, ${summary.needs_revision_count} need revision).`
    );
  }
  for (const item of items) {
    if (!item.final_assessment_for_maestro?.title?.trim()) {
      throw new Error(`Assessment ${item.assessment_id} is missing a final title.`);
    }
  }
}

export function applyApprovedRedesignsToContract(courseCode: string): void {
  const file = fileService.getAssessmentRedesignsFile(courseCode);
  if (!file?.items.length) {
    throw new Error('No assessment redesigns saved. Review and save before approving.');
  }

  assertLayer3ReadyForApproval(file.items);

  const contract = fileService.getCourseContract(courseCode);
  if (!contract) throw new Error('Course contract not found');

  const summary = file.items
    .map((item) => {
      const f =
        item.sme_decision === 'keep_original'
          ? finalFromOriginal(item.original_assessment)
          : item.final_assessment_for_maestro;
      const clos = f.refined_clo_alignment.length ? ` -> ${f.refined_clo_alignment.join(', ')}` : '';
      const artifact = f.required_artifact ? ` (${f.required_artifact})` : '';
      return `${f.title}${artifact}${clos}`;
    })
    .join('; ');

  fileService.saveCourseContract(courseCode, {
    ...contract,
    assessment_strategy: summary,
  });
}
