/**
 * In-process BM25 keyword search (Reference Anchoring V1.0).
 *
 * The semantic vector search alone misses passages that match on EXACT terms
 * (acronyms, proper nouns, jargon) that the embedding smooths over. This adds a
 * dependency-free lexical signal: classic Okapi BM25 over the candidate chunks'
 * RAW `text`, with IDF computed across the supplied candidate corpus.
 *
 * No new npm dependency — tokenization + BM25 are implemented here.
 */

import type { ReferenceChunk } from '../models/schemas.js';

// Standard Okapi BM25 parameters.
const K1 = 1.5;
const B = 0.75;
/** Drop tokens shorter than this (very short / noise tokens). */
const MIN_TOKEN_LEN = 2;

export interface KeywordCandidate {
  chunk_id: string;
  text: string;
}

export interface KeywordSearchResult {
  /** chunk_id -> raw BM25 score (>= 0; only chunks with a match are present). */
  scores: Map<string, number>;
  /** chunk_id -> the query terms that actually matched in that chunk. */
  matchedTerms: Map<string, string[]>;
}

/** Lowercase, split on non-alphanumeric, drop very short tokens. */
export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN_LEN);
}

/**
 * Score a query against a candidate chunk set with BM25. Returns a score map plus
 * the matched query terms per chunk (used to explain match_reason). IDF is computed
 * over the supplied candidates (the corpus being ranked).
 */
export function keywordSearch(query: string, candidates: KeywordCandidate[]): KeywordSearchResult {
  const scores = new Map<string, number>();
  const matchedTerms = new Map<string, string[]>();

  const queryTerms = Array.from(new Set(tokenize(query)));
  if (queryTerms.length === 0 || candidates.length === 0) {
    return { scores, matchedTerms };
  }

  // Per-doc term frequencies + lengths.
  const docTokens = candidates.map((c) => tokenize(c.text));
  const docLengths = docTokens.map((toks) => toks.length);
  const avgdl = docLengths.reduce((a, b) => a + b, 0) / (docLengths.length || 1) || 1;
  const N = candidates.length;

  const termFreqs: Map<string, number>[] = docTokens.map((toks) => {
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });

  // Document frequency per query term (over the candidate corpus).
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const tf of termFreqs) if (tf.has(term)) count += 1;
    df.set(term, count);
  }

  // IDF with the standard BM25 (+0.5 smoothing); clamp to >= 0 so common terms
  // (present in > half the corpus) never produce negative scores.
  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const n = df.get(term) ?? 0;
    idf.set(term, Math.max(0, Math.log(1 + (N - n + 0.5) / (n + 0.5))));
  }

  candidates.forEach((c, i) => {
    const tf = termFreqs[i];
    const len = docLengths[i];
    let score = 0;
    const matched: string[] = [];
    for (const term of queryTerms) {
      const f = tf.get(term) ?? 0;
      if (f === 0) continue;
      matched.push(term);
      const numerator = f * (K1 + 1);
      const denominator = f + K1 * (1 - B + (B * len) / avgdl);
      score += (idf.get(term) ?? 0) * (numerator / denominator);
    }
    if (matched.length > 0) {
      scores.set(c.chunk_id, score);
      matchedTerms.set(c.chunk_id, matched);
    }
  });

  return { scores, matchedTerms };
}

/** Convenience overload: score directly against ReferenceChunk[]. */
export function keywordSearchChunks(query: string, chunks: ReferenceChunk[]): KeywordSearchResult {
  return keywordSearch(
    query,
    chunks.map((c) => ({ chunk_id: c.chunk_id, text: c.text }))
  );
}
