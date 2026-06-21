/**
 * Default prompt seed for CONTEXTUAL-EMBEDDING headers (Reference Anchoring V1.0).
 *
 * Each reference chunk is embedded as `header + "\n---\n" + rawText`, where the
 * header is a short, model-generated sentence that situates the passage inside its
 * source (title, best-effort chapter/section, what the passage is about, and the
 * role it plays). This "contextual retrieval" technique materially improves recall
 * because each chunk's vector now carries the document-level context the raw passage
 * alone omits.
 *
 * The model is asked for the HEADER TEXT ONLY (no preamble, no quotes, no markdown),
 * kept to ~50-100 tokens. This module follows the same "defaults constant" convention
 * as the other node-engine / reference config seeds.
 */

export const CONTEXT_HEADER_SYSTEM_PROMPT = `You are a retrieval-context annotator. Given a short passage from a single source document, you write ONE compact context header (about 50-100 tokens) that situates the passage so it can be found by semantic search. The header must state, as best you can infer: the source title, the chapter/section it likely belongs to, what the passage is about, and the role it plays in the source (e.g. defines a term, gives an example, argues a claim, summarizes evidence). Output ONLY the header text — plain prose, no preamble, no quotes, no markdown, no bullet points, no labels.`;

export interface ContextHeaderPromptInput {
  docTitle: string;
  sectionHeading?: string;
  text: string;
}

/** Build the user message for the context-header model call. */
export function buildContextHeaderUserPrompt({
  docTitle,
  sectionHeading,
  text,
}: ContextHeaderPromptInput): string {
  const sectionLine = sectionHeading?.trim()
    ? `Best-effort section/heading: ${sectionHeading.trim()}`
    : 'Best-effort section/heading: (unknown — infer from the passage)';
  return [
    `Source document title: ${docTitle}`,
    sectionLine,
    '',
    'Passage:',
    '"""',
    text,
    '"""',
    '',
    'Write the context header now (one short paragraph, ~50-100 tokens, header text only).',
  ].join('\n');
}

/**
 * Deterministic minimal header used when the model call fails, so ingestion /
 * backfill NEVER hard-fails on a single chunk. It still carries the document-level
 * signal (title + section) that contextual embeddings depend on.
 */
export function buildFallbackContextHeader({
  docTitle,
  sectionHeading,
}: Pick<ContextHeaderPromptInput, 'docTitle' | 'sectionHeading'>): string {
  const section = sectionHeading?.trim();
  return section
    ? `From "${docTitle}", section "${section}". This passage is part of that source.`
    : `From "${docTitle}". This passage is part of that source.`;
}
