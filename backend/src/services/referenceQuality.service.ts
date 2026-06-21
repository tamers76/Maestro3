/**
 * Reference Quality Service (Issue 2 — grounding quality).
 *
 * A pure, synchronous, unit-testable passage-quality heuristic shared by:
 *  - chunk creation (referenceChunking.service): drop junk lines/blocks and junk
 *    chunks before embedding/indexing, and avoid junk section headings;
 *  - retrieval (referenceRetrieval.service): a minimum-content CITATION gate so a
 *    thin/fragment passage can never become a citation.
 *
 * The gate is intentionally conservative: a normal academic prose paragraph must
 * pass, and obviously off-topic prose (e.g. "20 percent of students are choosing
 * to take a day off") ALSO passes — off-topic relevance is handled by retrieval
 * scoring, NOT by this junk gate. Only structural noise fails: bare page numbers,
 * roman-numeral page markers, table-of-contents dot-leaders, index entries,
 * repeated-token artifacts ("21 21"), and fragments dominated by digits /
 * punctuation ("(CASTLE) 7", "– 52; CICS").
 *
 * No dependencies, no I/O — keep it deterministic.
 */

// A substantive citation passage must clear all three of these.
const MIN_PASSAGE_CHARS = 40;
const MIN_SUBSTANTIVE_WORDS = 5; // words with >=3 letters
const MIN_ALPHA_RATIO = 0.5; // letters / non-whitespace chars

/** Ratio of unicode letters to non-whitespace characters (0..1). */
export function alphabeticRatio(text: string): number {
  const nonWhitespace = (text || '').replace(/\s+/g, '');
  if (nonWhitespace.length === 0) return 0;
  const letters = (text.match(/\p{L}/gu) || []).length;
  return letters / nonWhitespace.length;
}

/** Count of "real" words — runs of >=3 letters. Digits/short tokens don't count. */
export function substantiveWordCount(text: string): number {
  const words = (text || '').match(/\p{L}{3,}/gu) || [];
  return words.length;
}

/**
 * Minimum number of "page-anchored segments" before a passage is treated as an
 * index / table-of-contents listing. Tuned against the real back-of-book index
 * dump (5 page refs, 3 of which terminate a topic phrase) vs. ordinary academic
 * prose with an occasional number (0 such segments), so it catches the index
 * while leaving prose untouched.
 */
const MIN_INDEX_SEGMENTS = 3;

/** Strip leading/trailing punctuation/symbols from a token (keep inner chars). */
function stripEdgePunct(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
}

/** A whitespace-delimited token that is a bare 1-3 digit page-number (with any
 * surrounding punctuation, e.g. "121;" or "- 19"). 4+ digit numbers (years,
 * large quantities) are deliberately excluded. */
function isPageNumberToken(token: string): boolean {
  return /^\d{1,3}$/.test(stripEdgePunct(token));
}

/** A content word: a token whose core is a run of >=3 unicode letters (so it is a
 * real topic word, not a number, a stop-fragment, or pure punctuation). */
function isContentWordToken(token: string): boolean {
  return /\p{L}{3,}/u.test(stripEdgePunct(token));
}

/** True when `token` is nothing but punctuation/symbols (e.g. a stray "-"). */
function isPunctOnlyToken(token: string): boolean {
  return stripEdgePunct(token).length === 0 && token.length > 0;
}

/**
 * Detect an index / table-of-contents fragment: a back-of-book listing of short
 * topic phrases each anchored to a page number, e.g.
 *
 *   "ive design thinking process 55 Distinctive Schools network 21 diversity:
 *    driving forces for learning - 121; student and family ... program 28 early
 *    college model 19"
 *
 * These score HIGH on hybrid retrieval (lots of on-topic words) yet are pure
 * structural noise, NOT prose — so an absolute relevance floor cannot catch them;
 * this structural detector is the primary lever.
 *
 * Heuristic: count "page-anchored segments" — a bare 1-3 digit page number that
 *  (a) is preceded by a real topic/content word (skipping stray punctuation like a
 *      leading dash), so it is "phrase <number>", NOT part of a number enumeration
 *      ("1, 2, 3") or a clustered year range ("2020, 2021"); AND
 *  (b) terminates that segment — it is immediately followed by a list separator
 *      (`; : , – — -`), the start of the NEXT index term (a capitalized word), or
 *      the end of the passage.
 * Quantifier numbers in prose ("3 groups", "20 percent", "Chapter 2 discusses")
 * are followed by a lowercase content word, so they do NOT terminate a segment and
 * are not counted. A passage with >= MIN_INDEX_SEGMENTS such segments is an index.
 */
export function isIndexListingPassage(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length === 0) return false;

  const tokens = t.split(' ');
  let segments = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!isPageNumberToken(tok)) continue;

    // (a) preceded by a real content word (skip pure-punctuation tokens like "-",
    // but a preceding NUMBER token disqualifies — that is an enumeration/range).
    let prevOk = false;
    for (let j = i - 1; j >= 0; j--) {
      if (isPunctOnlyToken(tokens[j])) continue;
      prevOk = isContentWordToken(tokens[j]) && !isPageNumberToken(tokens[j]);
      break;
    }
    if (!prevOk) continue;

    // (b) terminates the segment: trailing separator on the number token itself,
    // OR end-of-passage, OR the next token starts a new (capitalized) index term,
    // OR the next token is a bare separator.
    const digits = tok.match(/\d{1,3}/);
    const trailing = digits ? tok.slice((digits.index ?? 0) + digits[0].length) : '';
    const next = tokens[i + 1];
    const followerOk =
      /[;:,–—-]/.test(trailing) ||
      next === undefined ||
      /^[;:,–—-]/.test(next) ||
      /^\p{Lu}/u.test(next);
    if (!followerOk) continue;

    segments++;
  }

  return segments >= MIN_INDEX_SEGMENTS;
}

/**
 * A single line that is pure structural noise (safe to drop during chunking).
 * Blank lines return false (they are paragraph separators handled elsewhere).
 */
export function isJunkLine(line: string): boolean {
  const t = (line || '').trim();
  if (t.length === 0) return false;
  // Bare page number on its own line.
  if (/^\d+$/.test(t)) return true;
  // Roman-numeral page marker ("iv", "xii").
  if (/^[ivxlcdm]{1,7}$/i.test(t)) return true;
  // Table-of-contents dot-leader ("Introduction .......... 5").
  if (/\.{3,}\s*\d+\s*$/.test(t)) return true;
  // Repeated-token artifact ("21 21", "p. p.") — the whole line is one token repeated.
  if (/^(\S+)(?:\s+\1)+$/.test(t)) return true;
  // Fragment dominated by digits/punctuation with too few real words
  // ("(CASTLE) 7", "– 52; CICS", "word , word , 12, 45").
  const words = substantiveWordCount(t);
  const alpha = alphabeticRatio(t);
  if (words < 3 && (alpha < 0.5 || /\d/.test(t))) return true;
  return false;
}

/**
 * A heading-like line that is actually noise (so it is not attached as a chunk's
 * section_heading). Lighter than isJunkLine: legitimate short headings such as
 * "Chapter 4" or "3.2 Biodiversity" are KEPT — only headings with no real words
 * (bare numbers, roman numerals, dot-leaders, repeated tokens) are rejected.
 */
export function isJunkHeading(line: string): boolean {
  const t = (line || '').trim();
  if (t.length === 0) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^[ivxlcdm]{1,7}$/i.test(t)) return true;
  if (/\.{3,}\s*\d+\s*$/.test(t)) return true;
  if (/^(\S+)(?:\s+\1)+$/.test(t)) return true;
  if (substantiveWordCount(t) === 0) return true;
  return false;
}

/**
 * Why a passage fails the citation quality gate, or null when it passes. Useful
 * for logging / surfacing a reason to reviewers.
 */
export function citationQualityFailureReason(text: string): string | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length === 0) return 'empty passage';
  if (t.length < MIN_PASSAGE_CHARS) return `too short (${t.length} < ${MIN_PASSAGE_CHARS} chars)`;
  if (isJunkLine(t)) return 'structural noise (page number / TOC / index / repeated-token fragment)';
  if (isIndexListingPassage(t)) return 'index / table-of-contents listing (topic phrases anchored to page numbers)';
  const alpha = alphabeticRatio(t);
  if (alpha < MIN_ALPHA_RATIO) return `low alphabetic-content ratio (${alpha.toFixed(2)})`;
  const words = substantiveWordCount(t);
  if (words < MIN_SUBSTANTIVE_WORDS) return `too few substantive words (${words} < ${MIN_SUBSTANTIVE_WORDS})`;
  return null;
}

/** True when the passage is substantive enough to stand as a citation. */
export function passesCitationQualityGate(text: string): boolean {
  return citationQualityFailureReason(text) === null;
}

/** Inverse of the gate — true when the passage is junk/thin. */
export function isJunkPassage(text: string): boolean {
  return !passesCitationQualityGate(text);
}
