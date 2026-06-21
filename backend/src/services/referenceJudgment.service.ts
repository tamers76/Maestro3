/**
 * Shared passage-teaching judgment for Reference Coverage and Node Engine grounding.
 * Both paths judge ONLY from supplied passages (temp 0, fail-soft conservative).
 */
import type { AIMessage } from './council.service.js';
import { callModel } from './council.service.js';
import { parseAIJson } from './ai.service.js';
import { getContextHeaderModel } from '../config.js';
import { getActiveVersion } from '../node-engine/promptTemplateRegistry.service.js';
import {
  REFERENCE_COVERAGE_JUDGMENT_PROMPT_ID,
  REFERENCE_GROUNDING_JUDGMENT_PROMPT_ID,
} from '../config/promptTemplates.defaults.js';

export type CoverageVerdict = 'covered' | 'partial' | 'none';

/** Coerce an arbitrary parsed value into a valid verdict (defaults to 'none'). */
export function normalizeVerdict(value: unknown): CoverageVerdict {
  return value === 'covered' || value === 'partial' || value === 'none' ? value : 'none';
}

export interface JudgmentPassage {
  citation: string;
  text_preview: string;
}

export interface PassageJudgmentResult {
  supporting_indices: number[];
  rationale: string;
  gaps: string[];
  /** Coverage path only. */
  verdict?: CoverageVerdict;
  /** Node-grounding path: at least one passage teaches the target. */
  teaches: boolean;
}

export function buildJudgmentUserPrompt(
  targetLabel: string,
  targetStatement: string,
  passages: JudgmentPassage[]
): string {
  const passageBlock =
    passages.length === 0
      ? '(no passages retrieved from the reference corpus)'
      : passages
          .map((p, i) => `[${i}] (${p.citation}): ${p.text_preview}`)
          .join('\n\n');
  return [
    `${targetLabel}:\n${targetStatement}`,
    '',
    'RETRIEVED PASSAGES (judge ONLY from these — do not use outside knowledge):',
    passageBlock,
  ].join('\n');
}

function parseSupportingIndices(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0)
    : [];
}

function parseGaps(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((g): g is string => typeof g === 'string') : [];
}

/**
 * Run a versioned judgment prompt over retrieved passages. Fail-soft: returns
 * conservative "does not teach" / coverage "none" on any error.
 */
export async function runPassageJudgment(opts: {
  promptTemplateId: string;
  fallbackSystemPrompt: string;
  targetLabel: string;
  targetStatement: string;
  passages: JudgmentPassage[];
  /** When true, parse a coverage verdict field from the model JSON. */
  parseCoverageVerdict?: boolean;
}): Promise<PassageJudgmentResult> {
  const template = getActiveVersion(opts.promptTemplateId);
  const systemPrompt = template?.task_prompt?.trim() || opts.fallbackSystemPrompt;
  const messages: AIMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: buildJudgmentUserPrompt(opts.targetLabel, opts.targetStatement, opts.passages),
    },
  ];

  const failSoft = (rationale: string): PassageJudgmentResult => ({
    supporting_indices: [],
    rationale,
    gaps: [],
    verdict: opts.parseCoverageVerdict ? 'none' : undefined,
    teaches: false,
  });

  try {
    const raw = await callModel(messages, getContextHeaderModel(), { jsonMode: true, temperature: 0 });
    const parsed = parseAIJson<{
      verdict?: unknown;
      teaches_kc?: unknown;
      rationale?: unknown;
      supporting_passage_indices?: unknown;
      gaps?: unknown;
    }>(raw);
    const supporting_indices = parseSupportingIndices(parsed.supporting_passage_indices);
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale : '';
    const gaps = parseGaps(parsed.gaps);
    const teachesExplicit = parsed.teaches_kc === true;
    const teaches = teachesExplicit || supporting_indices.length > 0;
    return {
      supporting_indices,
      rationale,
      gaps,
      verdict: opts.parseCoverageVerdict ? normalizeVerdict(parsed.verdict) : undefined,
      teaches,
    };
  } catch (error) {
    console.warn(
      `[referenceJudgment] judgment failed (${opts.promptTemplateId}); fail-soft conservative. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return failSoft(
      opts.parseCoverageVerdict
        ? 'Coverage judgment could not be completed; treated conservatively as not covered.'
        : 'Grounding judgment could not be completed; treated conservatively as not teaching this knowledge component.'
    );
  }
}

/** Layer-3 coverage judgment (CLO-level). */
export async function judgeCoveragePassages(
  cloStatement: string,
  passages: JudgmentPassage[]
): Promise<{
  verdict: CoverageVerdict;
  rationale: string;
  supportingIndices: number[];
  gaps: string[];
}> {
  const result = await runPassageJudgment({
    promptTemplateId: REFERENCE_COVERAGE_JUDGMENT_PROMPT_ID,
    fallbackSystemPrompt:
      'You are a strict reference-coverage judge. Judge ONLY from the provided passages. Return JSON {"verdict","rationale","supporting_passage_indices","gaps"}.',
    targetLabel: 'COURSE LEARNING OUTCOME',
    targetStatement: cloStatement,
    passages,
    parseCoverageVerdict: true,
  });
  return {
    verdict: result.verdict ?? 'none',
    rationale: result.rationale,
    supportingIndices: result.supporting_indices,
    gaps: result.gaps,
  };
}

/** Node-level grounding judgment (KC-grained). */
export async function judgeNodeGroundingPassages(
  knowledgeComponent: string,
  subtopicContext: string,
  passages: JudgmentPassage[]
): Promise<PassageJudgmentResult> {
  const targetStatement = [knowledgeComponent, '', `Subtopic context: ${subtopicContext}`].join('\n');
  return runPassageJudgment({
    promptTemplateId: REFERENCE_GROUNDING_JUDGMENT_PROMPT_ID,
    fallbackSystemPrompt:
      'You are a strict reference-grounding judge. Decide whether the passages TEACH the knowledge component. Return JSON {"teaches_kc","rationale","supporting_passage_indices","gaps"}.',
    targetLabel: 'KNOWLEDGE COMPONENT',
    targetStatement,
    passages,
  });
}
