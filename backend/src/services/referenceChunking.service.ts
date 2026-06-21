/**
 * Reference Chunking Service
 *
 * Splits an extracted reference document into passage-sized, embeddable chunks
 * (~300-500 tokens with overlap), preserving best-effort heading metadata and a
 * traceable source citation on each chunk.
 *
 * No tokenizer dependency: tokens are estimated as ~4 chars/token, a standard
 * heuristic that is good enough for sizing chunks.
 */

import { isJunkLine, isJunkHeading, passesCitationQualityGate } from './referenceQuality.service.js';

const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 400;
const MIN_TOKENS = 120;
const OVERLAP_TOKENS = 60;

const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const MIN_CHARS = MIN_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

export interface RawChunk {
  text: string;
  seq: number;
  token_estimate: number;
  section_heading?: string;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / CHARS_PER_TOKEN));
}

/** Heuristic: a short, title-like line is treated as a section heading. */
function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  // Numbered headings: "3.2 Biodiversity", "Chapter 4", "Section 2:"
  if (/^(chapter|section|part|unit)\b/i.test(trimmed)) return true;
  if (/^\d+(\.\d+)*\s+\S/.test(trimmed)) return true;
  // ALL-CAPS-ish heading with no terminal punctuation
  if (!/[.!?]$/.test(trimmed) && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
    return true;
  }
  return false;
}

/** Split text into paragraph-ish blocks while tracking the latest heading. */
function splitIntoBlocks(text: string): { text: string; heading?: string }[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: { text: string; heading?: string }[] = [];
  let currentHeading: string | undefined;
  let buffer: string[] = [];

  const flush = () => {
    const joined = buffer.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) blocks.push({ text: joined, heading: currentHeading });
    buffer = [];
  };

  for (const line of lines) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    // Issue 2: drop structural noise (bare page numbers, TOC dot-leaders, index
    // fragments, repeated-token artifacts) before it can pollute a chunk.
    if (isJunkLine(line)) {
      continue;
    }
    if (looksLikeHeading(line)) {
      // Don't attach a junk heading; skip noise that merely looks heading-shaped.
      if (isJunkHeading(line)) continue;
      flush();
      currentHeading = line.trim();
      continue;
    }
    buffer.push(line.trim());
  }
  flush();
  return blocks;
}

/**
 * Produce ordered chunks. Greedily packs blocks up to TARGET_CHARS, splitting
 * oversized blocks and carrying a small character overlap between chunks.
 */
export function chunkText(text: string): RawChunk[] {
  const clean = (text || '').trim();
  if (!clean) return [];

  const blocks = splitIntoBlocks(clean);
  const chunks: RawChunk[] = [];
  let seq = 0;

  let buffer = '';
  let heading: string | undefined;

  const pushChunk = (content: string, sectionHeading?: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    chunks.push({
      text: trimmed,
      seq: seq++,
      token_estimate: estimateTokens(trimmed),
      section_heading: sectionHeading,
    });
  };

  for (const block of blocks) {
    // When a heading changes, prefer to start a fresh chunk for clean attribution.
    if (block.heading !== heading && buffer.length >= MIN_CHARS) {
      pushChunk(buffer, heading);
      buffer = '';
    }
    heading = block.heading;

    if (block.text.length > TARGET_CHARS) {
      // Flush whatever is buffered, then hard-split the oversized block.
      if (buffer) {
        pushChunk(buffer, heading);
        buffer = '';
      }
      for (let i = 0; i < block.text.length; i += TARGET_CHARS - OVERLAP_CHARS) {
        pushChunk(block.text.slice(i, i + TARGET_CHARS), heading);
      }
      continue;
    }

    if (buffer.length + block.text.length + 1 > TARGET_CHARS) {
      pushChunk(buffer, heading);
      // Carry overlap from the tail of the previous buffer.
      const overlap = buffer.slice(-OVERLAP_CHARS);
      buffer = `${overlap} ${block.text}`.trim();
    } else {
      buffer = buffer ? `${buffer} ${block.text}` : block.text;
    }
  }

  if (buffer.trim()) pushChunk(buffer, heading);

  // Issue 2: drop any produced chunk whose assembled text is still too thin /
  // junky to stand as a citation. Sequence ids may now have gaps — that is fine,
  // chunk_id only needs to be unique within the document.
  return chunks.filter((c) => passesCitationQualityGate(c.text));
}

/** Build a traceable citation string for a chunk. */
export function buildCitation(
  citationLabel: string,
  docTitle: string,
  sectionHeading?: string
): string {
  const base = (citationLabel || docTitle || 'Reference').trim();
  return sectionHeading ? `${base} — ${sectionHeading}` : base;
}
