/**
 * Reference Retrieval Service
 *
 * The query-time half of the reference-grounding capability:
 *  - retrieveReferenceChunks(): scope-filterable top-N vector search
 *  - buildGroundedContext():    formats retrieved passages + citations for prompt injection
 *
 * NOTE: This exposes the capability only. No generator is wired to it yet.
 */

import type { GroundedContext, ReferenceChunk, RetrievedChunk } from '../models/schemas.js';
import * as referenceRepo from '../db/repos/referenceRepo.js';
import { embedQuery } from './embedding.service.js';
import { getStoreForBackend, type RetrieveScope } from './referenceStore.service.js';
import { keywordSearch, type KeywordSearchResult } from './keywordSearch.service.js';

export interface RetrieveOptions {
  scope?: RetrieveScope;
  topN?: number;
  minScore?: number;
}

const DEFAULT_TOP_N = 6;

// Hybrid-fusion weights (semantic-leaning start) + RRF constant.
const SEMANTIC_WEIGHT = 0.6;
const KEYWORD_WEIGHT = 0.4;
const RRF_K = 60;
/** Semantic candidate pool is widened so BM25 can re-rank within it. */
const CANDIDATE_POOL_MULTIPLIER = 5;
const MIN_CANDIDATE_POOL = 30;

/** Min-max normalize a list of raw scores into [0,1] (all → 1 when range is 0). */
function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => 1);
  return values.map((v) => (v - min) / range);
}

export interface HybridFusionInput {
  /** Raw semantic hits (cosine/vector score), highest first is NOT required. */
  semanticHits: { chunk_id: string; score: number }[];
  /** BM25 result over the same candidate set. */
  keyword: KeywordSearchResult;
  /** Resolves chunk ids to full chunks for text/citation/scope. */
  chunkById: Map<string, ReferenceChunk>;
  topN: number;
  minScore?: number;
}

/**
 * PURE fusion of semantic + keyword signals into ranked RetrievedChunk[]. Kept free
 * of embedding/DB side effects so it is deterministically unit-testable.
 *
 * - Normalizes semantic + keyword scores to [0,1] (min-max / max).
 * - final_score = weighted sum of present normalized signals PLUS a reciprocal-rank
 *   fusion term (RRF), which is what carries a chunk when one signal is absent.
 * - match_reason: "semantic+keyword agree" when both fire, else "semantic only" /
 *   "keyword only".
 */
export function fuseHybrid(input: HybridFusionInput): RetrievedChunk[] {
  const { semanticHits, keyword, chunkById, topN, minScore } = input;

  const semScoreById = new Map<string, number>();
  for (const h of semanticHits) semScoreById.set(h.chunk_id, h.score);

  // Normalized semantic scores, by id.
  const semIds = semanticHits.map((h) => h.chunk_id);
  const semNormArr = minMaxNormalize(semanticHits.map((h) => h.score));
  const semNormById = new Map<string, number>();
  semIds.forEach((id, i) => semNormById.set(id, semNormArr[i]));

  // Ranks (1-based) for RRF.
  const semRankById = new Map<string, number>();
  [...semanticHits]
    .map((h) => h.chunk_id)
    .sort((a, b) => (semScoreById.get(b) ?? 0) - (semScoreById.get(a) ?? 0))
    .forEach((id, i) => semRankById.set(id, i + 1));

  // Normalized keyword scores + ranks.
  const maxKw = Math.max(0, ...Array.from(keyword.scores.values()));
  const kwNormById = new Map<string, number>();
  for (const [id, s] of keyword.scores) kwNormById.set(id, maxKw > 0 ? s / maxKw : 0);
  const kwRankById = new Map<string, number>();
  [...keyword.scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([id], i) => kwRankById.set(id, i + 1));

  const candidateIds = new Set<string>([...semScoreById.keys(), ...keyword.scores.keys()]);

  const results: RetrievedChunk[] = [];
  for (const id of candidateIds) {
    const chunk = chunkById.get(id);
    if (!chunk) continue;

    const hasSem = semScoreById.has(id);
    const hasKw = keyword.scores.has(id);
    const semNorm = semNormById.get(id) ?? 0;
    const kwNorm = kwNormById.get(id) ?? 0;

    const weighted =
      (hasSem ? SEMANTIC_WEIGHT * semNorm : 0) + (hasKw ? KEYWORD_WEIGHT * kwNorm : 0);
    const rrf =
      (hasSem ? SEMANTIC_WEIGHT / (RRF_K + (semRankById.get(id) ?? 0)) : 0) +
      (hasKw ? KEYWORD_WEIGHT / (RRF_K + (kwRankById.get(id) ?? 0)) : 0);
    const finalScore = weighted + rrf;

    const matchReason =
      hasSem && hasKw ? 'semantic+keyword agree' : hasSem ? 'semantic only' : 'keyword only';

    results.push({
      chunk_id: chunk.chunk_id,
      doc_id: chunk.doc_id,
      text: chunk.text,
      citation: chunk.citation,
      semantic_score: hasSem ? semNorm : undefined,
      keyword_score: hasKw ? kwNorm : undefined,
      final_score: finalScore,
      score: finalScore,
      match_reason: matchReason,
      clo_ids: chunk.clo_ids,
      subtopic_ids: chunk.subtopic_ids,
    });
  }

  results.sort((a, b) => b.final_score - a.final_score);
  const filtered =
    typeof minScore === 'number' ? results.filter((r) => r.final_score >= minScore) : results;
  return filtered.slice(0, topN);
}

/**
 * Hybrid (semantic + keyword) retrieval. Widens the semantic candidate pool, scores
 * the SAME scope-filtered candidates with BM25, then fuses both signals. This is the
 * single retrieval entry point — buildGroundedContext(WithFallback) call it via
 * retrieveReferenceChunks, so they automatically gain multi-signal ranking while
 * keeping their existing return shapes + scope/fallback semantics.
 */
export async function hybridRetrieve(
  courseCode: string,
  query: string,
  options: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  const { scope, topN = DEFAULT_TOP_N, minScore } = options;

  const docCount = (await referenceRepo.listDocuments(courseCode)).length;
  if (docCount === 0) return [];
  if (!query.trim()) return [];

  const queryVector = await embedQuery(query);
  if (queryVector.length === 0) return [];

  const poolSize = Math.max(topN * CANDIDATE_POOL_MULTIPLIER, MIN_CANDIDATE_POOL);
  const store = getStoreForBackend('postgres');
  const semanticHits = await store.query(courseCode, queryVector, poolSize, scope);

  // Resolve candidates to full chunks (scope already applied by store.query).
  const candidateChunks = await referenceRepo.getChunksByIds(semanticHits.map((h) => h.chunk_id));
  const byId = new Map<string, ReferenceChunk>();
  for (const c of candidateChunks) byId.set(c.chunk_id, c);

  // BM25 over the SAME scope-filtered candidate set.
  const keyword = keywordSearch(
    query,
    candidateChunks.map((c) => ({ chunk_id: c.chunk_id, text: c.text }))
  );

  return fuseHybrid({ semanticHits, keyword, chunkById: byId, topN, minScore });
}

/**
 * Retrieve the most relevant reference passages for a query, optionally scoped
 * to a CLO or subtopic. Returns hits with traceable citations. Backed by hybrid
 * (semantic + keyword) retrieval.
 */
export async function retrieveReferenceChunks(
  courseCode: string,
  query: string,
  options: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
  return hybridRetrieve(courseCode, query, options);
}

/**
 * Build a prompt-ready grounding block from retrieved passages. Other stages can
 * call this to ground generation in actual reference text and attribute sources.
 */
export async function buildGroundedContext(
  courseCode: string,
  query: string,
  options: RetrieveOptions = {}
): Promise<GroundedContext> {
  const chunks = await retrieveReferenceChunks(courseCode, query, options);

  if (chunks.length === 0) {
    return { passages: [], citations: [], promptBlock: '' };
  }

  const passages = chunks.map((c) => ({ text: c.text, citation: c.citation }));
  const citations = Array.from(new Set(chunks.map((c) => c.citation)));

  const lines = chunks.map((c, i) => `[R${i + 1}] (${c.citation}): ${c.text}`);
  const promptBlock = [
    '### Grounding passages from SME-approved references',
    'Base your response on these passages and cite them with their [R#] tags. Do not invent content beyond what they support.',
    '',
    ...lines,
  ].join('\n');

  return { passages, citations, promptBlock };
}

export type GroundingSource = 'scoped_references' | 'course_level_references' | 'model_only';

export interface GroundingWithFallback {
  passages: { text: string; citation: string }[];
  citations: string[];
  promptBlock: string;
  /** Hits returned by the CLO/subtopic-scoped query. */
  scopedCount: number;
  /** Hits returned by the unscoped course-level fallback (0 when scoped already succeeded). */
  courseLevelCount: number;
  source: GroundingSource;
}

/**
 * Grounding with a course-level SAFETY NET: try the CLO/subtopic-scoped query
 * first; if it returns nothing (e.g. before Reference Alignment has tagged the
 * chunks), fall back to an unscoped course-level query so grounding is never
 * silently empty. The net is NOT the real fix — Reference Alignment (Layer 7) is
 * — but it guarantees honest course-level grounding meanwhile, and reports which
 * source actually produced the passages.
 */
export async function buildGroundedContextWithFallback(
  courseCode: string,
  query: string,
  options: RetrieveOptions = {}
): Promise<GroundingWithFallback> {
  const hasScope = Boolean(options.scope?.cloId || options.scope?.subtopicId);

  let scopedCount = 0;
  if (hasScope) {
    const scoped = await retrieveReferenceChunks(courseCode, query, options);
    scopedCount = scoped.length;
    if (scopedCount > 0) {
      const built = contextFromChunks(scoped);
      return { ...built, scopedCount, courseLevelCount: 0, source: 'scoped_references' };
    }
  }

  // Course-level fallback (no scope filter).
  const courseOpts: RetrieveOptions = { topN: options.topN, minScore: options.minScore };
  const courseLevel = await retrieveReferenceChunks(courseCode, query, courseOpts);
  const courseLevelCount = courseLevel.length;
  const built = contextFromChunks(courseLevel);
  return {
    ...built,
    scopedCount,
    courseLevelCount,
    source: courseLevelCount > 0 ? 'course_level_references' : 'model_only',
  };
}

/** Format already-retrieved chunks into passages/citations/promptBlock. */
function contextFromChunks(
  chunks: { text: string; citation: string }[]
): Pick<GroundedContext, 'passages' | 'citations' | 'promptBlock'> {
  if (chunks.length === 0) return { passages: [], citations: [], promptBlock: '' };
  const passages = chunks.map((c) => ({ text: c.text, citation: c.citation }));
  const citations = Array.from(new Set(chunks.map((c) => c.citation)));
  const lines = chunks.map((c, i) => `[R${i + 1}] (${c.citation}): ${c.text}`);
  const promptBlock = [
    '### Grounding passages from SME-approved references',
    'Base your response on these passages and cite them with their [R#] tags. Do not invent content beyond what they support.',
    '',
    ...lines,
  ].join('\n');
  return { passages, citations, promptBlock };
}
