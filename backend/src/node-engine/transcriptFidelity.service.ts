/**
 * Transcript fidelity check for the Video Agent (moderate) path.
 *
 * The approved narration.full_script remains the canonical transcript. After a
 * render completes we may capture HeyGen's rendered subtitle text; this helper
 * flags academic drift (new numbers, quotes, or capitalized terms) so an SME
 * reviews before sign-off. It NEVER rewrites the approved transcript.
 */

export type TranscriptFidelity = 'matched' | 'minor_drift' | 'needs_review';

export interface TranscriptFidelityResult {
  fidelity: TranscriptFidelity;
  notes: string[];
}

function normalize(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalize(text)
      .replace(/[^a-z0-9%$. ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

/** Extract numbers (incl. percentages / currency) as drift-sensitive tokens. */
function extractNumbers(text: string): string[] {
  return (text.match(/\$?\d+(?:[.,]\d+)?%?/g) ?? []).map((n) => n.replace(/[.,]$/, ''));
}

/** Extract quoted strings (single or double quotes). */
function extractQuotes(text: string): string[] {
  return (text.match(/"[^"]{3,}"|'[^']{3,}'/g) ?? []).map((q) => normalize(q));
}

export function checkTranscriptFidelity(
  approvedScript: string,
  renderedTranscript: string | undefined
): TranscriptFidelityResult {
  if (!renderedTranscript || !renderedTranscript.trim()) {
    // No rendered transcript captured — nothing to compare; treat as matched.
    return { fidelity: 'matched', notes: [] };
  }

  const approvedNorm = normalize(approvedScript);
  const renderedNorm = normalize(renderedTranscript);
  if (approvedNorm === renderedNorm) {
    return { fidelity: 'matched', notes: [] };
  }

  const notes: string[] = [];

  const approvedNumbers = new Set(extractNumbers(approvedScript));
  const newNumbers = extractNumbers(renderedTranscript).filter((n) => !approvedNumbers.has(n));
  if (newNumbers.length > 0) {
    notes.push(`Rendered transcript adds numbers not in the approved script: ${[...new Set(newNumbers)].join(', ')}.`);
  }

  const approvedQuotes = new Set(extractQuotes(approvedScript));
  const newQuotes = extractQuotes(renderedTranscript).filter((q) => !approvedQuotes.has(q));
  if (newQuotes.length > 0) {
    notes.push(`Rendered transcript adds quotations not in the approved script (${newQuotes.length}).`);
  }

  // Word-level additions (tokens present in rendered but not approved).
  const approvedTokens = tokenize(approvedScript);
  const renderedTokens = tokenize(renderedTranscript);
  let addedTokens = 0;
  for (const t of renderedTokens) {
    if (!approvedTokens.has(t)) addedTokens += 1;
  }
  const addedRatio = renderedTokens.size > 0 ? addedTokens / renderedTokens.size : 0;

  if (newNumbers.length > 0 || newQuotes.length > 0 || addedRatio > 0.25) {
    return {
      fidelity: 'needs_review',
      notes:
        notes.length > 0
          ? notes
          : [`Rendered transcript differs substantially (${Math.round(addedRatio * 100)}% new words).`],
    };
  }

  return {
    fidelity: 'minor_drift',
    notes: [`Rendered transcript has minor wording differences (${Math.round(addedRatio * 100)}% new words).`],
  };
}
