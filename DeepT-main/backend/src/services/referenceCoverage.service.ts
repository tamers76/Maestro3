/**
 * Reference Coverage Service (Reference Coverage Check — Phase A).
 *
 * A READ-ONLY, per-CLO MEASUREMENT of how well the uploaded reference corpus
 * teaches each APPROVED CLO. It is NOT Reference Alignment: it writes NO scope
 * tags anywhere — it only persists a coverage REPORT artifact
 * (`reference-coverage.json`) and reuses the existing embeddings + hybrid
 * retrieval.
 *
 * LOCKED band logic — the Layer-3 model judgment is AUTHORITATIVE for the band;
 * similarity % and distribution are SUPPORTING signals only. Judgment can
 * CONFIRM or DOWNGRADE, never UPGRADE past the evidence:
 *  - An EVIDENCE GATE sets the ceiling. If retrieval fails the min-passages /
 *    relevance floor / distribution minimum, the band is CAPPED at
 *    "not_covered" even if judgment is positive (forbids
 *    model-knowledge-as-grounding).
 *  - A CLO reaches "well_covered" / "partial" only when BOTH real supporting
 *    passages exist AND judgment confirms they teach the CLO.
 *  - Judgment downgrades freely (off-topic book with ~0.95 similarity but
 *    verdict "none" -> not_covered). Judgment never upgrades.
 */
import type { RetrievedChunk } from '../models/schemas.js';
import * as referenceRepo from '../db/repos/referenceRepo.js';
import { hybridRetrieveDetailed } from './referenceRetrieval.service.js';
import { buildV1ContractBundle } from '../node-engine/stage1Adapter.service.js';
import { saveCourseArtifact, getCourseArtifact } from '../node-engine/store.service.js';
import { getReferenceCoverageThresholds } from '../node-engine/referenceCoverageConfig.service.js';
import {
  judgeCoveragePassages,
  type CoverageVerdict,
} from './referenceJudgment.service.js';
import { callModel, type AIMessage } from './council.service.js';
import { parseAIJson } from './ai.service.js';
import { getContextHeaderModel } from '../config.js';
import type { ReferenceCoverageThresholds } from '../models/nodeEngine.js';

export type { CoverageVerdict };
export { normalizeVerdict } from './referenceJudgment.service.js';

const ARTIFACT_FILE = 'reference-coverage.json';
/** Snapshot of the report that existed BEFORE the latest recompute (delta source). */
const PREV_ARTIFACT_FILE = 'reference-coverage.prev.json';

// ===========================================================================
// Types
// ===========================================================================

/** Final per-CLO coverage band. */
export type CoverageBand = 'well_covered' | 'partial' | 'not_covered';

export type CoverageStatus =
  | 'locked' // no approved CLOs yet (approve Layer 2 first)
  | 'no_references' // no reference docs/chunks uploaded
  | 'available' // ready to compute
  | 'computed'; // a report has been generated

/** Layer 1 (similarity) + Layer 2 (distribution) signals for one CLO. */
export interface CoverageSignals {
  /** Top fused final_score among retrieved passages (0 when none). */
  top_score: number;
  /** Median fused final_score among retrieved passages (0 when none). */
  median_score: number;
  /** Quality-passing passages retrieved for the CLO. */
  retrieved_count: number;
  /** Retrieved passages at/above the relevance floor (the supporting evidence). */
  supporting_count: number;
  /** Distinct source documents among the supporting passages. */
  distinct_sources: number;
}

/** A retrieved supporting passage carried into the report for SME inspection. */
export interface CoveragePassage {
  chunk_id: string;
  doc_id: string;
  citation: string;
  text_preview: string;
  score: number;
}

/** Per-document strength when rolling supporting passages up by source. */
export type CoverageDocStrength = 'strong' | 'partial';

/** One reference document that supports a CLO (rolled up from supporting passages). */
export interface CoverageDocRef {
  doc_id: string;
  /** Human document title (joined from the reference repo). */
  title: string;
  strength: CoverageDocStrength;
}

export interface CoverageCloResult {
  clo_id: string;
  statement: string;
  /** Short 2-4 word human label for the CLO (LLM-generated; statement-derived fallback). */
  short_label: string;
  band: CoverageBand;
  /** Integer percentage derived from the top similarity signal (0-100). */
  coverage_pct: number;
  /** The Layer-3 verdict, or null when the evidence gate failed (no judgment run). */
  verdict: CoverageVerdict | null;
  evidence_gate_passed: boolean;
  signals: CoverageSignals;
  /** Band rationale (judgment rationale, or the evidence-gate reason when capped). */
  rationale: string;
  supporting_passages: CoveragePassage[];
  /** Supporting documents rolled up from supporting passages (strong-first). */
  covered_by: CoverageDocRef[];
  /** Aspects of the CLO the corpus fails to teach (from judgment + gate). */
  gaps: string[];
}

export interface CoverageSummary {
  total_clos: number;
  well_covered: number;
  partial: number;
  not_covered: number;
}

export interface ReferenceCoverageReport {
  course_code: string;
  status: CoverageStatus;
  thresholds: ReferenceCoverageThresholds;
  reference_doc_count: number;
  chunk_count: number;
  summary: CoverageSummary;
  clos: CoverageCloResult[];
  generated_at?: string;
  lock_reason?: string;
}

export interface CoverageStateSummary {
  status: CoverageStatus;
  lock_reason?: string;
  approved_clo_count: number;
  reference_doc_count: number;
  chunk_count: number;
  thresholds: ReferenceCoverageThresholds;
  summary?: CoverageSummary;
  generated_at?: string;
}

/** Direction a CLO's band moved between two coverage reports. */
export type CoverageDirection = 'improved' | 'regressed' | 'unchanged';

/** Per-CLO band change between the PRIOR report and the freshly-computed one. */
export interface CoverageDeltaEntry {
  clo_id: string;
  /** Band in the prior report, or null when the CLO is new (no prior row). */
  from_band: CoverageBand | null;
  to_band: CoverageBand;
  direction: CoverageDirection;
}

/** The before/after diff returned alongside a recompute (null when no prior). */
export interface CoverageDelta {
  entries: CoverageDeltaEntry[];
  improved: number;
  regressed: number;
  unchanged: number;
}

// ===========================================================================
// Pure helpers (DB-free, unit-testable)
// ===========================================================================

/** Top + median fused final_score over a ranked passage list (0/0 when empty). */
export function scoreStats(chunks: Pick<RetrievedChunk, 'final_score'>[]): {
  top: number;
  median: number;
} {
  if (chunks.length === 0) return { top: 0, median: 0 };
  const scores = chunks.map((c) => c.final_score).sort((a, b) => b - a);
  const top = scores[0];
  const mid = Math.floor(scores.length / 2);
  const median = scores.length % 2 === 0 ? (scores[mid - 1] + scores[mid]) / 2 : scores[mid];
  return { top, median };
}

export interface EvidenceGateInput {
  /** Supporting passages (at/above the relevance floor). */
  supporting_count: number;
  /** Distinct source documents among the supporting passages. */
  distinct_sources: number;
  thresholds: Pick<ReferenceCoverageThresholds, 'minPassages' | 'distributionMin'>;
}

/**
 * The EVIDENCE GATE — the ceiling on the band. It passes ONLY when enough
 * supporting passages exist AND they are spread across enough distinct sources.
 * A failing gate caps the band at "not_covered" regardless of judgment.
 */
export function evidenceGatePasses(input: EvidenceGateInput): boolean {
  return (
    input.supporting_count >= input.thresholds.minPassages &&
    input.distinct_sources >= input.thresholds.distributionMin
  );
}

export interface BandResolutionInput {
  /** Whether the evidence gate passed (the ceiling). */
  evidence_gate_passed: boolean;
  /**
   * The Layer-3 verdict. Only meaningful when the gate passed; when the gate
   * failed the band is capped regardless, so this may be null.
   */
  verdict: CoverageVerdict | null;
}

/**
 * Resolve the final band per the LOCKED rule. Judgment is authoritative but
 * bounded by the evidence ceiling:
 *  - gate FAIL  -> not_covered (capped; judgment cannot upgrade)
 *  - gate PASS  -> map verdict: covered->well_covered, partial->partial, none->not_covered
 */
export function resolveCoverageBand(input: BandResolutionInput): CoverageBand {
  if (!input.evidence_gate_passed) return 'not_covered';
  switch (input.verdict) {
    case 'covered':
      return 'well_covered';
    case 'partial':
      return 'partial';
    default:
      return 'not_covered';
  }
}

/**
 * Band ordering for improvement comparison (locked rule):
 * not_covered < partial < well_covered.
 */
export function bandRank(band: CoverageBand): number {
  return band === 'well_covered' ? 2 : band === 'partial' ? 1 : 0;
}

/** Direction a CLO moved when its band changes from `from` to `to`. */
export function bandDirection(from: CoverageBand, to: CoverageBand): CoverageDirection {
  const f = bandRank(from);
  const t = bandRank(to);
  if (t > f) return 'improved';
  if (t < f) return 'regressed';
  return 'unchanged';
}

/**
 * Pure before/after diff between a prior set of per-CLO bands and the new set.
 * New CLOs (no prior row) are reported with from_band=null and counted as
 * unchanged (there is nothing to compare them against). DB-free + unit-testable.
 */
export function computeCoverageDelta(
  prev: { clo_id: string; band: CoverageBand }[],
  next: { clo_id: string; band: CoverageBand }[]
): CoverageDelta {
  const prevByCloId = new Map(prev.map((c) => [c.clo_id, c.band]));
  const entries: CoverageDeltaEntry[] = [];
  let improved = 0;
  let regressed = 0;
  let unchanged = 0;
  for (const clo of next) {
    const from = prevByCloId.get(clo.clo_id) ?? null;
    if (from === null) {
      entries.push({ clo_id: clo.clo_id, from_band: null, to_band: clo.band, direction: 'unchanged' });
      unchanged += 1;
      continue;
    }
    const direction = bandDirection(from, clo.band);
    entries.push({ clo_id: clo.clo_id, from_band: from, to_band: clo.band, direction });
    if (direction === 'improved') improved += 1;
    else if (direction === 'regressed') regressed += 1;
    else unchanged += 1;
  }
  return { entries, improved, regressed, unchanged };
}

/** Build the Layer-3 judgment user prompt from ONLY the retrieved passages. */
export function buildCoverageJudgmentUserPrompt(cloStatement: string, passages: CoveragePassage[]): string {
  const passageBlock =
    passages.length === 0
      ? '(no passages retrieved from the reference corpus)'
      : passages
          .map((p, i) => `[${i}] (${p.citation}): ${p.text_preview}`)
          .join('\n\n');
  return [
    `COURSE LEARNING OUTCOME:\n${cloStatement}`,
    '',
    'RETRIEVED PASSAGES (judge ONLY from these — do not use outside knowledge):',
    passageBlock,
  ].join('\n');
}

/**
 * Margin above the configurable relevance floor a document's BEST passage must
 * clear to count as "strong" support (vs "partial"). Kept relative to the floor
 * so tuning the floor moves the strong threshold with it. With the default floor
 * (0.18) this lands at ~0.33, in line with the codebase's strong-grounding score
 * floor (STRONG_MIN_TOP_SCORE = 0.35 in nodeGeneration.service).
 */
export const STRONG_SCORE_MARGIN = 0.15;

/**
 * Statement-derived fallback label: the first ~4 words of the CLO statement. Used
 * whenever the batched short-label model call fails or omits a CLO.
 */
export function fallbackShortLabel(statement: string): string {
  const words = statement.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  return words.join(' ') || 'Untitled CLO';
}

/** Clamp an arbitrary number to an integer percentage in [0, 100]. */
export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Roll supporting passages up by source document, joining a human title and a
 * per-document strength. A document is "strong" when its BEST passage score is
 * comfortably above the relevance floor (floor + STRONG_SCORE_MARGIN), else
 * "partial". Sorted strong-first (then by title for stable ordering). Returns an
 * empty array when there are no supporting passages.
 */
export function rollupCoveredBy(
  passages: CoveragePassage[],
  titleFor: (docId: string) => string,
  relevanceFloor: number
): CoverageDocRef[] {
  const strongThreshold = relevanceFloor + STRONG_SCORE_MARGIN;
  const bestByDoc = new Map<string, number>();
  for (const p of passages) {
    const current = bestByDoc.get(p.doc_id);
    if (current === undefined || p.score > current) bestByDoc.set(p.doc_id, p.score);
  }
  const refs: CoverageDocRef[] = [];
  for (const [doc_id, best] of bestByDoc) {
    refs.push({
      doc_id,
      title: titleFor(doc_id),
      strength: best >= strongThreshold ? 'strong' : 'partial',
    });
  }
  refs.sort((a, b) => {
    if (a.strength !== b.strength) return a.strength === 'strong' ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  return refs;
}

/** Build the batched short-label user prompt over ALL approved CLOs (one call). */
export function buildShortLabelUserPrompt(clos: { clo_id: string; statement: string }[]): string {
  return [
    'For each Course Learning Outcome (CLO) below, write a concise 2-4 word human label',
    '(e.g. "Analyze frameworks", "Digital integration"). No trailing punctuation.',
    'Return ONLY a JSON object mapping each clo_id to its label, e.g.',
    '{"CLO-1":"Analyze frameworks","CLO-2":"Digital integration"}.',
    '',
    'CLOs:',
    JSON.stringify(
      clos.map((c) => ({ clo_id: c.clo_id, statement: c.statement })),
      null,
      2
    ),
  ].join('\n');
}

// ===========================================================================
// State
// ===========================================================================

/** Resolve the live coverage state/dependencies without computing anything. */
export async function getCoverageState(courseCode: string): Promise<CoverageStateSummary> {
  const thresholds = getReferenceCoverageThresholds();
  const bundle = await buildV1ContractBundle(courseCode);
  const approvedClos = bundle.clos.filter((c) => c.status === 'approved');
  const referenceDocCount = (await referenceRepo.listDocuments(courseCode)).length;
  const chunkCount = await referenceRepo.countChunks(courseCode);
  const existing = await getCourseArtifact<ReferenceCoverageReport>(courseCode, ARTIFACT_FILE);

  let status: CoverageStatus;
  let lock_reason: string | undefined;
  if (approvedClos.length === 0) {
    status = 'locked';
    lock_reason = 'Approve CLO Refinement (Course Architect Layer 2) before measuring reference coverage.';
  } else if (referenceDocCount === 0 || chunkCount === 0) {
    status = 'no_references';
    lock_reason =
      'No references uploaded — coverage cannot be measured. Upload reference material to measure how well the corpus teaches each CLO.';
  } else if (existing && Array.isArray(existing.clos)) {
    status = 'computed';
  } else {
    status = 'available';
  }

  return {
    status,
    lock_reason,
    approved_clo_count: approvedClos.length,
    reference_doc_count: referenceDocCount,
    chunk_count: chunkCount,
    thresholds,
    summary: existing?.summary,
    generated_at: existing?.generated_at,
  };
}

/** Read the current coverage report artifact (null when none computed). */
export async function getCoverageReport(courseCode: string): Promise<ReferenceCoverageReport | null> {
  return getCourseArtifact<ReferenceCoverageReport>(courseCode, ARTIFACT_FILE);
}

// ===========================================================================
// Compute
// ===========================================================================

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function toPassage(chunk: RetrievedChunk): CoveragePassage {
  return {
    chunk_id: chunk.chunk_id,
    doc_id: chunk.doc_id,
    citation: chunk.citation,
    text_preview: chunk.text.length > 280 ? `${chunk.text.slice(0, 280)}…` : chunk.text,
    score: round(chunk.final_score),
  };
}

/**
 * Generate a short 2-4 word label for EVERY approved CLO in ONE batched cheap-LLM
 * call (single round-trip). INDEPENDENT of the evidence gate / judgment so labels
 * exist even on not_covered rows. Fail-soft: any error (or a missing/blank label)
 * falls back to the first ~4 words of the statement, so this never blocks compute.
 */
async function generateCloShortLabels(
  clos: { clo_id: string; statement: string }[]
): Promise<Record<string, string>> {
  const fallbacks: Record<string, string> = {};
  for (const c of clos) fallbacks[c.clo_id] = fallbackShortLabel(c.statement);
  if (clos.length === 0) return fallbacks;

  const messages: AIMessage[] = [
    {
      role: 'system',
      content:
        'You write concise 2-4 word labels for course learning outcomes. Return strict JSON only — an object mapping each clo_id to its label.',
    },
    { role: 'user', content: buildShortLabelUserPrompt(clos) },
  ];

  try {
    const raw = await callModel(messages, getContextHeaderModel(), { jsonMode: true });
    const parsed = parseAIJson<Record<string, unknown>>(raw);
    const labels: Record<string, string> = {};
    for (const c of clos) {
      const value = parsed?.[c.clo_id];
      labels[c.clo_id] =
        typeof value === 'string' && value.trim() ? value.trim() : fallbacks[c.clo_id];
    }
    return labels;
  } catch (error) {
    console.warn(
      `[referenceCoverage] short-label generation failed; using statement-derived fallbacks. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return fallbacks;
  }
}

/** Measure one approved CLO against the corpus (read-only). */
async function measureClo(
  courseCode: string,
  clo: { clo_id: string; statement: string },
  thresholds: ReferenceCoverageThresholds,
  shortLabel: string,
  titleFor: (docId: string) => string
): Promise<CoverageCloResult> {
  // READ-ONLY hybrid retrieval pointed at the CLO statement. No scope filter:
  // coverage measures the WHOLE corpus, independent of any alignment tags. The
  // citation quality gate is already applied inside hybridRetrieveDetailed.
  const retrieval = await hybridRetrieveDetailed(courseCode, clo.statement, { topN: thresholds.topK });
  const chunks = retrieval.chunks;

  const stats = scoreStats(chunks);
  const supportingChunks = chunks.filter((c) => c.final_score >= thresholds.relevanceFloor);
  const supportingPassages = supportingChunks.map(toPassage);
  const distinctSources = new Set(supportingChunks.map((c) => c.doc_id)).size;

  const signals: CoverageSignals = {
    top_score: round(stats.top),
    median_score: round(stats.median),
    retrieved_count: chunks.length,
    supporting_count: supportingChunks.length,
    distinct_sources: distinctSources,
  };

  const coverage_pct = clampPercent(Math.round(signals.top_score * 100));
  const covered_by = rollupCoveredBy(supportingPassages, titleFor, thresholds.relevanceFloor);

  const gatePassed = evidenceGatePasses({
    supporting_count: supportingChunks.length,
    distinct_sources: distinctSources,
    thresholds,
  });

  // Gate FAIL -> capped not_covered, no judgment call (judgment can't upgrade).
  if (!gatePassed) {
    return {
      clo_id: clo.clo_id,
      statement: clo.statement,
      short_label: shortLabel,
      band: 'not_covered',
      coverage_pct,
      verdict: null,
      evidence_gate_passed: false,
      signals,
      rationale: `Evidence gate not met: ${supportingChunks.length} supporting passage(s) across ${distinctSources} source(s) (need >= ${thresholds.minPassages} passage(s) across >= ${thresholds.distributionMin} source(s)). The corpus does not yet teach this CLO.`,
      supporting_passages: supportingPassages,
      covered_by,
      gaps: ['Insufficient on-topic reference material in the corpus.'],
    };
  }

  // Gate PASS -> authoritative Layer-3 judgment over ONLY the supporting passages.
  const judgment = await judgeCoveragePassages(
    clo.statement,
    supportingPassages.map((p) => ({ citation: p.citation, text_preview: p.text_preview }))
  );
  const band = resolveCoverageBand({ evidence_gate_passed: true, verdict: judgment.verdict });

  // Highlight the passages the judge said genuinely teach the CLO (when given).
  const highlighted =
    judgment.supportingIndices.length > 0
      ? judgment.supportingIndices
          .filter((i) => i >= 0 && i < supportingPassages.length)
          .map((i) => supportingPassages[i])
      : supportingPassages;

  return {
    clo_id: clo.clo_id,
    statement: clo.statement,
    short_label: shortLabel,
    band,
    coverage_pct,
    verdict: judgment.verdict,
    evidence_gate_passed: true,
    signals,
    rationale:
      judgment.rationale ||
      (band === 'well_covered'
        ? 'Supporting passages substantively teach this CLO.'
        : band === 'partial'
          ? 'Supporting passages partially teach this CLO.'
          : 'Supporting passages do not teach this CLO despite topical similarity.'),
    supporting_passages: highlighted.length > 0 ? highlighted : supportingPassages,
    covered_by,
    gaps: judgment.gaps,
  };
}

/**
 * Compute (or recompute) the read-only coverage report for a course and persist
 * it. Writes NO scope tags — only the `reference-coverage.json` artifact.
 */
export async function computeCoverage(courseCode: string): Promise<ReferenceCoverageReport> {
  const thresholds = getReferenceCoverageThresholds();
  const state = await getCoverageState(courseCode);

  if (state.status === 'locked' || state.status === 'no_references') {
    const report: ReferenceCoverageReport = {
      course_code: courseCode,
      status: state.status,
      thresholds,
      reference_doc_count: state.reference_doc_count,
      chunk_count: state.chunk_count,
      summary: { total_clos: state.approved_clo_count, well_covered: 0, partial: 0, not_covered: 0 },
      clos: [],
      lock_reason: state.lock_reason,
    };
    await saveCourseArtifact(courseCode, ARTIFACT_FILE, report);
    return report;
  }

  const bundle = await buildV1ContractBundle(courseCode);
  const approvedClos = bundle.clos.filter((c) => c.status === 'approved');

  // Human document titles for the "Covered by" rollup (joined by doc_id).
  const documents = await referenceRepo.listDocuments(courseCode);
  const titleById = new Map(documents.map((d) => [d.doc_id, d.title]));
  const titleFor = (docId: string): string => titleById.get(docId) ?? docId;

  // ONE batched cheap-LLM call for all short labels, BEFORE per-CLO measurement,
  // so labels exist even on rows where judgment is skipped by the evidence gate.
  const shortLabels = await generateCloShortLabels(
    approvedClos.map((c) => ({ clo_id: c.clo_id, statement: c.statement }))
  );

  const clos: CoverageCloResult[] = [];
  for (const clo of approvedClos) {
    clos.push(
      await measureClo(
        courseCode,
        { clo_id: clo.clo_id, statement: clo.statement },
        thresholds,
        shortLabels[clo.clo_id] ?? fallbackShortLabel(clo.statement),
        titleFor
      )
    );
  }

  const summary: CoverageSummary = {
    total_clos: clos.length,
    well_covered: clos.filter((c) => c.band === 'well_covered').length,
    partial: clos.filter((c) => c.band === 'partial').length,
    not_covered: clos.filter((c) => c.band === 'not_covered').length,
  };

  const report: ReferenceCoverageReport = {
    course_code: courseCode,
    status: 'computed',
    thresholds,
    reference_doc_count: state.reference_doc_count,
    chunk_count: state.chunk_count,
    summary,
    clos,
    generated_at: new Date().toISOString(),
  };
  await saveCourseArtifact(courseCode, ARTIFACT_FILE, report);
  return report;
}

/**
 * Recompute coverage AND diff it against the report that existed beforehand.
 * Reads the prior report BEFORE `computeCoverage` overwrites it, snapshots that
 * prior into the `reference-coverage.prev.json` artifact (audit/replay), and
 * returns the new report plus a per-CLO `delta`. The delta is null when there
 * was no prior computed report to compare against (first measurement). This is
 * the action behind the "Re-run coverage" / upload-re-check loop.
 */
export async function recomputeCoverageWithDelta(
  courseCode: string
): Promise<{ report: ReferenceCoverageReport; delta: CoverageDelta | null }> {
  const prior = await getCourseArtifact<ReferenceCoverageReport>(courseCode, ARTIFACT_FILE);
  const report = await computeCoverage(courseCode);

  const priorClos = prior && Array.isArray(prior.clos) ? prior.clos : [];
  if (priorClos.length > 0) {
    // Preserve the prior report as a revertible/auditable snapshot.
    await saveCourseArtifact(courseCode, PREV_ARTIFACT_FILE, prior);
  }

  const delta =
    priorClos.length > 0
      ? computeCoverageDelta(
          priorClos.map((c) => ({ clo_id: c.clo_id, band: c.band })),
          report.clos.map((c) => ({ clo_id: c.clo_id, band: c.band }))
        )
      : null;

  return { report, delta };
}
