/**
 * Reference Source Suggestion Service (Reference Coverage Check — Phase C).
 *
 * AI PROPOSES, SME APPROVES. For ONE weak/uncovered approved CLO, propose a
 * small list of high-quality CANDIDATE sources (title + url + why + source_type)
 * that would teach the components the existing corpus fails to cover.
 *
 * GUARDRAILS (enforced here):
 *  - READ-ONLY w.r.t. coverage and the corpus: this writes NO scope tags and
 *    NEVER ingests anything. Ingestion only happens later, on explicit SME
 *    approval, through the EXISTING upload/link ingest path.
 *  - REUSE-EXISTING: the existing corpus document titles are passed into the
 *    prompt AND used to filter the model's output, so already-uploaded sources
 *    are never re-proposed.
 *  - REUSE INFRA: the grounded web-search call reuses the deep-research
 *    `responses` API path (`callResponsesAPI`) and the versioned prompt registry
 *    (`reference_source_suggestion_prompt`).
 *  - FAIL-SOFT: any model/parse/config error returns an empty list plus a
 *    human-readable `reason` — it never throws a 500 to the route when avoidable.
 *
 * Latest suggestions are cached per CLO via `saveCourseArtifact`
 * (`reference-source-suggestions.json`) so they persist for the session.
 */
import { getSettings } from '../config.js';
import * as referenceRepo from '../db/repos/referenceRepo.js';
import { buildV1ContractBundle } from '../node-engine/stage1Adapter.service.js';
import { saveCourseArtifact, getCourseArtifact } from '../node-engine/store.service.js';
import { getActiveVersion } from '../node-engine/promptTemplateRegistry.service.js';
import { REFERENCE_SOURCE_SUGGESTION_PROMPT_ID } from '../config/promptTemplates.defaults.js';
import { callResponsesAPI, extractCitations } from './openai_deep_research.service.js';
import { parseAIJson } from './ai.service.js';
import { getCoverageReport, type CoverageCloResult } from './referenceCoverage.service.js';
import type { ReferenceSourceType } from '../models/schemas.js';

const ARTIFACT_FILE = 'reference-source-suggestions.json';
const SUGGESTION_MODEL = 'gpt-4o';

// ===========================================================================
// Types
// ===========================================================================

/** One AI-proposed candidate source for a weak/uncovered CLO. */
export interface CoverageSourceSuggestion {
  title: string;
  url: string;
  /** ONE sentence tying this source to the specific gap it closes. */
  why: string;
  source_type: ReferenceSourceType;
}

/** Result of a per-CLO suggestion run (cached + returned to the route). */
export interface CloSourceSuggestions {
  clo_id: string;
  suggestions: CoverageSourceSuggestion[];
  /** Set when the list is empty for an explainable reason (fail-soft / no-op). */
  reason?: string;
  generated_at: string;
}

/** The cached artifact: latest suggestions keyed by clo_id. */
interface SourceSuggestionsArtifact {
  course_code: string;
  by_clo: Record<string, CloSourceSuggestions>;
  updated_at: string;
}

// ===========================================================================
// Pure helpers (DB-free, model-free, unit-testable)
// ===========================================================================

/** Coerce arbitrary input into a valid reference source type (default 'other'). */
export function coerceSourceType(value: unknown): ReferenceSourceType {
  return value === 'textbook_chapter' || value === 'paper' || value === 'other' ? value : 'other';
}

/**
 * Normalize a title for duplicate matching: lowercase, strip punctuation, and
 * collapse whitespace. Used to compare a proposed title against the existing
 * corpus titles (the "reuse-existing" guardrail) tolerant of minor formatting.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse the model's raw output into a clean suggestion list. Accepts either a
 * bare JSON array or a `{ "suggestions": [...] }` wrapper. Drops malformed
 * entries (missing/blank title or url) and trims fields. Pure + total: any
 * unparseable input yields an empty array (never throws).
 */
export function parseSuggestions(raw: string): CoverageSourceSuggestion[] {
  let parsed: unknown;
  try {
    parsed = parseAIJson<unknown>(raw);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { suggestions?: unknown })?.suggestions)
      ? (parsed as { suggestions: unknown[] }).suggestions
      : [];
  const out: CoverageSourceSuggestion[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    const url = typeof rec.url === 'string' ? rec.url.trim() : '';
    const why = typeof rec.why === 'string' ? rec.why.trim() : '';
    if (!title || !url) continue;
    out.push({ title, url, why, source_type: coerceSourceType(rec.source_type) });
  }
  return out;
}

/**
 * Drop suggestions whose title matches an existing corpus title (the
 * "reuse-existing" guardrail), and de-duplicate by normalized title within the
 * proposed list. Pure + unit-testable.
 */
export function filterOutExisting(
  suggestions: CoverageSourceSuggestion[],
  existingTitles: string[]
): CoverageSourceSuggestion[] {
  const seen = new Set(existingTitles.map(normalizeTitle).filter(Boolean));
  const out: CoverageSourceSuggestion[] = [];
  for (const s of suggestions) {
    const key = normalizeTitle(s.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Build the user prompt: CLO + gap/rationale + existing corpus titles. */
export function buildSuggestionUserPrompt(input: {
  cloId: string;
  shortLabel: string;
  statement: string;
  rationale: string;
  gaps: string[];
  existingTitles: string[];
}): string {
  const gapBlock =
    input.gaps.length > 0
      ? input.gaps.map((g, i) => `  ${i + 1}. ${g}`).join('\n')
      : '  (no specific gaps listed — propose sources for the CLO as a whole)';
  const titlesBlock =
    input.existingTitles.length > 0
      ? input.existingTitles.map((t, i) => `  ${i + 1}. ${t}`).join('\n')
      : '  (no sources uploaded yet)';
  return [
    `COURSE LEARNING OUTCOME (${input.cloId} — ${input.shortLabel}):`,
    input.statement,
    '',
    'COVERAGE GAP (what the existing corpus fails to teach for this CLO):',
    input.rationale ? input.rationale : '(no rationale recorded)',
    '',
    'MISSING COMPONENTS:',
    gapBlock,
    '',
    'EXISTING CORPUS SOURCE TITLES (do NOT re-propose these):',
    titlesBlock,
    '',
    'Propose 3-5 candidate sources that would teach the missing components, as a',
    'strict JSON array of { title, url, why, source_type }. Return [] if you',
    'cannot responsibly propose any new source.',
  ].join('\n');
}

// ===========================================================================
// Cache (per-course artifact)
// ===========================================================================

async function readArtifact(courseCode: string): Promise<SourceSuggestionsArtifact | null> {
  return getCourseArtifact<SourceSuggestionsArtifact>(courseCode, ARTIFACT_FILE);
}

async function writeCloSuggestions(courseCode: string, entry: CloSourceSuggestions): Promise<void> {
  const existing = (await readArtifact(courseCode)) ?? {
    course_code: courseCode,
    by_clo: {},
    updated_at: new Date().toISOString(),
  };
  existing.by_clo[entry.clo_id] = entry;
  existing.updated_at = new Date().toISOString();
  await saveCourseArtifact(courseCode, ARTIFACT_FILE, existing);
}

// ===========================================================================
// Main entry point
// ===========================================================================

function makeEmpty(cloId: string, reason: string): CloSourceSuggestions {
  return { clo_id: cloId, suggestions: [], reason, generated_at: new Date().toISOString() };
}

/**
 * Propose candidate sources for ONE approved CLO. Loads the CLO + its coverage
 * gap (rationale/gaps) + existing corpus titles, runs the grounded web-search
 * model via the active source-suggestion prompt, parses + filters, caches, and
 * returns. Fail-soft: returns an empty list with a `reason` instead of throwing
 * whenever possible. Never ingests anything.
 */
export async function suggestSourcesForClo(
  courseCode: string,
  cloId: string
): Promise<CloSourceSuggestions> {
  // 1. Resolve the approved CLO.
  const bundle = await buildV1ContractBundle(courseCode);
  const clo = bundle.clos.find((c) => c.clo_id === cloId && c.status === 'approved');
  if (!clo) {
    return makeEmpty(cloId, `No approved CLO "${cloId}" found for ${courseCode}.`);
  }

  // 2. Pull the coverage gap (rationale + gaps + short label) from the report.
  const report = await getCoverageReport(courseCode);
  const cov: CoverageCloResult | undefined = report?.clos?.find((c) => c.clo_id === cloId);
  const rationale = cov?.rationale ?? '';
  const gaps = Array.isArray(cov?.gaps) ? cov!.gaps : [];
  const shortLabel = cov?.short_label?.trim() || clo.statement.split(/\s+/).slice(0, 4).join(' ');

  // 3. Existing corpus titles (the reuse-existing guardrail input).
  const documents = await referenceRepo.listDocuments(courseCode);
  const existingTitles = documents.map((d) => d.title).filter((t): t is string => !!t && !!t.trim());

  // 4. Require an OpenAI key for the grounded web-search path (fail-soft).
  const settings = getSettings();
  if (!settings.openai?.apiKey) {
    return makeEmpty(
      cloId,
      'AI source suggestions require an OpenAI API key (used for grounded web search). Add one in Settings to enable this.'
    );
  }

  // 5. Build the prompt from the active versioned template + the CLO context.
  const template = getActiveVersion(REFERENCE_SOURCE_SUGGESTION_PROMPT_ID);
  const systemPrompt = template?.task_prompt?.trim()
    ? template.task_prompt
    : 'You propose candidate reference sources for a course learning outcome. Return a strict JSON array of {title,url,why,source_type}. Do not re-propose existing corpus titles. Proposals only — never ingested without SME approval.';
  const userPrompt = buildSuggestionUserPrompt({
    cloId,
    shortLabel,
    statement: clo.statement,
    rationale,
    gaps,
    existingTitles,
  });

  // 6. Call the grounded web-search responses path (reused from deep research).
  let rawText = '';
  let webCitations: Array<{ title: string; url: string }> = [];
  try {
    const apiResponse = await callResponsesAPI(`${systemPrompt}\n\n${userPrompt}`, SUGGESTION_MODEL);
    rawText = apiResponse.output_text ?? '';
    webCitations = extractCitations(apiResponse.output);
  } catch (error) {
    console.warn(
      `[referenceSourceSuggestion] web-search call failed for ${courseCode}/${cloId}; returning empty (fail-soft). ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return makeEmpty(
      cloId,
      'Could not reach the AI web-search service. No sources were proposed — try again shortly.'
    );
  }

  // 7. Parse + apply the reuse-existing guardrail.
  let suggestions = filterOutExisting(parseSuggestions(rawText), existingTitles);

  // Fallback: if the model gave web citations but no parseable JSON list, surface
  // those grounded citations (still proposals, still filtered against the corpus).
  if (suggestions.length === 0 && webCitations.length > 0) {
    const fromCitations: CoverageSourceSuggestion[] = webCitations
      .filter((c) => c.title && c.url)
      .map((c) => ({
        title: c.title,
        url: c.url,
        why: 'Surfaced by AI web search as relevant to this CLO — verify before adding.',
        source_type: 'other' as ReferenceSourceType,
      }));
    suggestions = filterOutExisting(fromCitations, existingTitles).slice(0, 5);
  }

  const result: CloSourceSuggestions = {
    clo_id: cloId,
    suggestions,
    reason:
      suggestions.length === 0
        ? 'The AI did not propose any new sources for this CLO (none found, or all matched existing corpus titles).'
        : undefined,
    generated_at: new Date().toISOString(),
  };

  // 8. Cache the latest suggestions for the session (best-effort).
  try {
    await writeCloSuggestions(courseCode, result);
  } catch (error) {
    console.warn(
      `[referenceSourceSuggestion] failed to cache suggestions for ${courseCode}/${cloId}. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return result;
}
