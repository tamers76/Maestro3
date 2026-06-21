/**
 * Embedding Service
 *
 * Provider-aware text embeddings for reference-grounding (RAG).
 * Mirrors the provider pattern used by council.service.ts (OpenAI / Ollama).
 * The active model + dimensions come from settings.embedding and are switchable.
 */

import { getSettings } from '../config.js';
import type { EmbeddingSettings } from '../models/schemas.js';

// OpenAI allows many inputs per request; keep batches modest to stay under limits.
const OPENAI_BATCH_SIZE = 96;
const OLLAMA_TIMEOUT_MS = 120000;

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  dimensions: number;
}

export function getEmbeddingConfig(): EmbeddingSettings {
  return getSettings().embedding;
}

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

async function embedOpenAIBatch(inputs: string[], model: string): Promise<number[][]> {
  const settings = getSettings();
  if (!settings.openai.apiKey?.trim()) {
    throw new Error(
      'OpenAI API key is not configured. Add OPENAI_API_KEY (or set embedding.provider to "ollama").'
    );
  }

  const response = await fetch(`${settings.openai.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.openai.apiKey}`,
    },
    body: JSON.stringify({ model, input: inputs }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI embeddings error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as OpenAIEmbeddingResponse;
  // Preserve input order using the returned index.
  return data.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

interface OllamaEmbeddingResponse {
  embedding?: number[];
  embeddings?: number[][];
}

async function embedOllamaSingle(input: string, model: string): Promise<number[]> {
  const settings = getSettings();
  let response: Response;
  try {
    response = await fetch(`${settings.ollama.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: input }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
  } catch (fetchError) {
    if (fetchError instanceof Error && fetchError.message.includes('fetch failed')) {
      throw new Error(
        `Cannot connect to Ollama at ${settings.ollama.baseUrl}. Is Ollama running? Try: ollama serve`
      );
    }
    throw fetchError;
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama embeddings error: ${response.status} - ${error}`);
  }

  const data = (await response.json()) as OllamaEmbeddingResponse;
  const vector = data.embedding ?? data.embeddings?.[0];
  if (!vector || vector.length === 0) {
    throw new Error(`Ollama returned an empty embedding for model ${model}`);
  }
  return vector;
}

/**
 * Embed a batch of texts. Returns one vector per input, in input order.
 *
 * `onProgress(done, total)` (optional) is invoked after each provider batch/item
 * so callers can surface live embedding progress.
 */
export async function embedTexts(
  texts: string[],
  onProgress?: (done: number, total: number) => void
): Promise<EmbeddingResult> {
  const config = getEmbeddingConfig();
  if (texts.length === 0) {
    return { vectors: [], model: config.model, dimensions: config.dimensions };
  }

  const vectors: number[][] = [];

  if (config.provider === 'openai') {
    for (let i = 0; i < texts.length; i += OPENAI_BATCH_SIZE) {
      const batch = texts.slice(i, i + OPENAI_BATCH_SIZE);
      vectors.push(...(await embedOpenAIBatch(batch, config.model)));
      onProgress?.(Math.min(vectors.length, texts.length), texts.length);
    }
  } else {
    // Ollama embeds one prompt per request.
    for (const text of texts) {
      vectors.push(await embedOllamaSingle(text, config.model));
      onProgress?.(vectors.length, texts.length);
    }
  }

  const actualDims = vectors[0]?.length ?? config.dimensions;
  if (actualDims !== config.dimensions) {
    console.warn(
      `[embedding] Configured dimensions (${config.dimensions}) != actual (${actualDims}) for model ${config.model}. Using actual.`
    );
  }

  return { vectors, model: config.model, dimensions: actualDims };
}

/** Embed a single query string. */
export async function embedQuery(text: string): Promise<number[]> {
  const { vectors } = await embedTexts([text]);
  return vectors[0] ?? [];
}

export interface EmbeddingHealth {
  ok: boolean;
  provider: EmbeddingSettings['provider'];
  model: string;
  configuredDimensions: number;
  /** The dimensionality actually returned by a live probe (0 when the probe failed). */
  liveDimensions: number;
  /** True when the provider's API key/endpoint is present in config (does not guarantee validity). */
  providerConfigured: boolean;
  error?: string;
  checkedAt: string;
}

/**
 * Live embedding health probe. Runs a tiny real embed so the silent-failure mode
 * (provider down / key missing → empty grounding) becomes visible instead of
 * masquerading as "weak grounding". Never throws — failures are reported in `ok`/`error`.
 */
export async function checkEmbeddingHealth(): Promise<EmbeddingHealth> {
  const config = getEmbeddingConfig();
  const settings = getSettings();
  const providerConfigured =
    config.provider === 'ollama' ? Boolean(settings.ollama?.baseUrl) : Boolean(settings.openai?.apiKey?.trim());

  const base: Omit<EmbeddingHealth, 'ok' | 'liveDimensions' | 'error'> = {
    provider: config.provider,
    model: config.model,
    configuredDimensions: config.dimensions,
    providerConfigured,
    checkedAt: new Date().toISOString(),
  };

  try {
    const vector = await embedQuery('Maestro embedding health probe.');
    if (vector.length === 0) {
      return { ...base, ok: false, liveDimensions: 0, error: 'Provider returned an empty embedding.' };
    }
    return { ...base, ok: true, liveDimensions: vector.length };
  } catch (error) {
    return {
      ...base,
      ok: false,
      liveDimensions: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
