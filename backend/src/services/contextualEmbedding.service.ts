/**
 * Contextual Embedding Service (Reference Anchoring V1.0)
 *
 * Implements "contextual retrieval": before embedding, each chunk gets a short,
 * model-generated context header (source title, best-effort section, what the
 * passage is about, its role) prepended to the raw text. The ENRICHED text
 * (`header + "\n---\n" + rawText`) is what gets embedded; the chunk's `text` stays
 * raw for display/citation.
 *
 * Header generation is:
 *  - CHEAP: uses getContextHeaderModel() (a gpt-4o-mini-class model), not the
 *    node-engine generation model.
 *  - CACHED by content_hash: a chunk whose stored content_hash still matches its
 *    raw text (and already carries a header) is a cache hit and is NOT regenerated.
 *  - BATCHED with bounded concurrency (~5) so a large backfill (~784 chunks) does
 *    not fan out unboundedly.
 *  - FAIL-SOFT: any model error falls back to a deterministic minimal header so
 *    ingestion / backfill never hard-fails on a single chunk.
 */

import { createHash } from 'node:crypto';
import type { ReferenceChunk } from '../models/schemas.js';
import { callModel, type AIMessage } from './council.service.js';
import { getContextHeaderModel } from '../config.js';
import {
  CONTEXT_HEADER_SYSTEM_PROMPT,
  buildContextHeaderUserPrompt,
  buildFallbackContextHeader,
} from '../config/contextHeader.defaults.js';

/** Separator placed between the context header and the raw passage in embedded input. */
export const CONTEXT_SEPARATOR = '\n---\n';

/** Bounded concurrency for header generation during batch backfill. */
const DEFAULT_CONCURRENCY = 5;

/** Stable sha256 (hex) of the raw text — used as the header/re-embed cache key. */
export function computeContentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Compose the embedded input from a header and the raw passage text. */
export function buildEnrichedText(header: string, text: string): string {
  return `${header}${CONTEXT_SEPARATOR}${text}`;
}

export interface GenerateContextHeaderInput {
  docTitle: string;
  sectionHeading?: string;
  text: string;
}

/**
 * Generate a single context header via one cheap model call. On ANY error, returns
 * a deterministic minimal header (so callers never have to handle a throw).
 */
export async function generateContextHeader({
  docTitle,
  sectionHeading,
  text,
}: GenerateContextHeaderInput): Promise<string> {
  const messages: AIMessage[] = [
    { role: 'system', content: CONTEXT_HEADER_SYSTEM_PROMPT },
    { role: 'user', content: buildContextHeaderUserPrompt({ docTitle, sectionHeading, text }) },
  ];
  try {
    const raw = await callModel(messages, getContextHeaderModel(), { maxTokens: 256 });
    const header = (raw || '').trim();
    if (!header) {
      return buildFallbackContextHeader({ docTitle, sectionHeading });
    }
    return header;
  } catch (error) {
    console.warn(
      `[contextualEmbedding] header generation failed; using fallback. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return buildFallbackContextHeader({ docTitle, sectionHeading });
  }
}

export interface ChunkHeaderInput {
  /** A stable key (e.g. chunk_id) so results can be correlated back to the chunk. */
  key: string;
  docTitle: string;
  sectionHeading?: string;
  /** Raw passage text. */
  text: string;
  /** Existing stored content_hash (if any) — used for cache-hit detection. */
  existingContentHash?: string;
  /** Existing stored context_header (if any) — reused verbatim on a cache hit. */
  existingHeader?: string;
}

export interface ChunkHeaderResult {
  key: string;
  /** Current content hash of the raw text. */
  contentHash: string;
  /** The header to use (either freshly generated or reused from cache). */
  header: string;
  /** True when an existing header was reused (no LLM call was made). */
  cacheHit: boolean;
}

/**
 * Generate headers for a batch of chunks with bounded concurrency, skipping any
 * chunk whose stored content_hash still matches its raw text AND already carries a
 * header (a cache hit → zero LLM cost). Returns one result per input, in input
 * order, each reporting whether it was a cache hit (for cost reporting).
 */
export async function generateContextHeadersForChunks(
  inputs: ChunkHeaderInput[],
  options: {
    concurrency?: number;
    /**
     * Header generator override (defaults to generateContextHeader). Exposed so
     * tests can inject a counting fake and assert that cache hits do NOT call it;
     * production never passes this.
     */
    generateHeader?: (input: GenerateContextHeaderInput) => Promise<string>;
    /**
     * Optional progress reporter, called after each chunk is resolved (cache hit
     * or freshly generated) so callers can surface live header-generation progress.
     */
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<ChunkHeaderResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const generate = options.generateHeader ?? generateContextHeader;
  const results: ChunkHeaderResult[] = new Array(inputs.length);
  const onProgress = options.onProgress;

  let next = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= inputs.length) return;
      const input = inputs[i];
      const contentHash = computeContentHash(input.text);
      const isCacheHit =
        !!input.existingHeader &&
        !!input.existingContentHash &&
        input.existingContentHash === contentHash;

      if (isCacheHit) {
        results[i] = { key: input.key, contentHash, header: input.existingHeader!, cacheHit: true };
        onProgress?.(++done, inputs.length);
        continue;
      }

      const header = await generate({
        docTitle: input.docTitle,
        sectionHeading: input.sectionHeading,
        text: input.text,
      });
      results[i] = { key: input.key, contentHash, header, cacheHit: false };
      onProgress?.(++done, inputs.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Convenience: map a stored chunk to the batch header-input shape. */
export function chunkToHeaderInput(chunk: ReferenceChunk, docTitle: string): ChunkHeaderInput {
  return {
    key: chunk.chunk_id,
    docTitle,
    sectionHeading: chunk.section_heading,
    text: chunk.text,
    existingContentHash: chunk.content_hash,
    existingHeader: chunk.context_header,
  };
}
