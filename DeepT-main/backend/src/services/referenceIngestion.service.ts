/**
 * Reference Ingestion Service
 *
 * Orchestrates SME-initiated, per-course ingestion of a reference document:
 *   extract text -> persist -> chunk -> embed -> index (Neo4j or JSON) -> manifest.
 *
 * This is additive and never touches the existing citation-string pipeline.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  ReferenceChunk,
  ReferenceDocument,
  ReferenceManifest,
  ReferenceScope,
  ReferenceSourceType,
} from '../models/schemas.js';
import * as fileService from './file.service.js';
import { extractTextFromBuffer } from './extraction.service.js';
import { chunkText, buildCitation } from './referenceChunking.service.js';
import { embedTexts } from './embedding.service.js';
import { resolveStoreForIndexing, getStoreForBackend } from './referenceStore.service.js';
import {
  generateContextHeadersForChunks,
  buildEnrichedText,
  chunkToHeaderInput,
  type ChunkHeaderInput,
} from './contextualEmbedding.service.js';

export interface IngestReferenceParams {
  courseCode: string;
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  title?: string;
  sourceType?: ReferenceSourceType;
  citationLabel?: string;
  scope?: ReferenceScope;
}

function emptyManifest(courseCode: string): ReferenceManifest {
  return { course_code: courseCode, documents: [], vector_backend: 'json', updated_at: new Date().toISOString() };
}

export async function ingestReferenceDocument(
  params: IngestReferenceParams
): Promise<ReferenceDocument> {
  const {
    courseCode,
    buffer,
    originalFilename,
    mimeType,
    title,
    sourceType = 'other',
    citationLabel,
    scope = {},
  } = params;

  const text = (await extractTextFromBuffer(buffer, mimeType, originalFilename))?.trim();
  if (!text) {
    throw new Error('No extractable text found in the uploaded reference file.');
  }

  const docId = uuidv4();
  const docTitle = (title || originalFilename).trim();
  const label = (citationLabel || docTitle).trim();
  const cloIds = scope.clo_ids ?? [];
  const subtopicIds = scope.subtopic_ids ?? [];

  const rawChunks = chunkText(text);
  if (rawChunks.length === 0) {
    throw new Error('Reference file produced no chunks after extraction.');
  }

  // Contextual embeddings (V1.0): generate a per-chunk context header, then embed
  // the ENRICHED text (header + sep + raw). No existing cache on a fresh upload, so
  // every chunk generates a header. `text` itself stays raw for display/citation.
  const headerInputs: ChunkHeaderInput[] = rawChunks.map((raw) => ({
    key: String(raw.seq),
    docTitle,
    sectionHeading: raw.section_heading,
    text: raw.text,
  }));
  const headerResults = await generateContextHeadersForChunks(headerInputs);

  const enrichedTexts = rawChunks.map((raw, i) =>
    buildEnrichedText(headerResults[i].header, raw.text)
  );
  const { vectors, model, dimensions } = await embedTexts(enrichedTexts);

  const chunks: ReferenceChunk[] = rawChunks.map((raw, i) => ({
    chunk_id: `${docId}-C${raw.seq}`,
    doc_id: docId,
    course_code: courseCode,
    seq: raw.seq,
    text: raw.text,
    token_estimate: raw.token_estimate,
    section_heading: raw.section_heading,
    context_header: headerResults[i].header,
    content_hash: headerResults[i].contentHash,
    citation: buildCitation(label, docTitle, raw.section_heading),
    clo_ids: cloIds,
    subtopic_ids: subtopicIds,
    embedding: vectors[i] ?? [],
  }));

  // Persist text + chunks (embeddings included) to disk first.
  fileService.saveReferenceDocText(courseCode, docId, text);
  fileService.saveReferenceChunks(courseCode, docId, chunks);

  // Index into the best available backend (Neo4j vector index, else JSON cosine).
  const store = await resolveStoreForIndexing(dimensions);
  const backend = await store.indexChunks(chunks);

  const doc: ReferenceDocument = {
    doc_id: docId,
    course_code: courseCode,
    title: docTitle,
    source_type: sourceType,
    citation_label: label,
    scope: { clo_ids: cloIds, subtopic_ids: subtopicIds },
    original_filename: originalFilename,
    mime_type: mimeType,
    uploaded_at: new Date().toISOString(),
    char_count: text.length,
    chunk_count: chunks.length,
    embedding_model: model,
    embedding_dimensions: dimensions,
    contextual_embeddings: true,
  };

  const manifest = fileService.getReferenceManifest(courseCode) ?? emptyManifest(courseCode);
  manifest.documents.push(doc);
  manifest.vector_backend = backend;
  manifest.updated_at = new Date().toISOString();
  fileService.saveReferenceManifest(courseCode, manifest);

  return doc;
}

export interface IngestReferenceFromUrlParams {
  courseCode: string;
  url: string;
  title?: string;
  sourceType?: ReferenceSourceType;
  citationLabel?: string;
  scope?: ReferenceScope;
}

const UPLOAD_FALLBACK_MSG =
  "Couldn't retrieve this link (it may require login or be protected, or is not a PDF). Please download the file and upload it instead.";

/**
 * Ingest a reference from a directly-downloadable PDF URL (SME-initiated).
 * Only PDFs are supported; anything else (HTML, paywalled, auth-required, errors)
 * fails with a clear instruction to upload the file instead.
 */
export async function ingestReferenceFromUrl(
  params: IngestReferenceFromUrlParams
): Promise<ReferenceDocument> {
  const { courseCode, url, title, sourceType = 'other', citationLabel, scope } = params;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) links are supported.');
  }

  let response: Response;
  try {
    response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
  } catch {
    throw new Error(UPLOAD_FALLBACK_MSG);
  }
  if (!response.ok) {
    throw new Error(UPLOAD_FALLBACK_MSG);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const looksLikePdf =
    contentType.includes('application/pdf') || parsed.pathname.toLowerCase().endsWith('.pdf');
  if (!looksLikePdf) {
    throw new Error(UPLOAD_FALLBACK_MSG);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const filename = decodeURIComponent(parsed.pathname.split('/').pop() || 'reference.pdf');

  return ingestReferenceDocument({
    courseCode,
    buffer,
    originalFilename: filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`,
    mimeType: 'application/pdf',
    title,
    sourceType,
    citationLabel,
    scope,
  });
}

export function listReferenceDocuments(courseCode: string): ReferenceDocument[] {
  return fileService.getReferenceManifest(courseCode)?.documents ?? [];
}

export async function deleteReferenceDocument(courseCode: string, docId: string): Promise<boolean> {
  const manifest = fileService.getReferenceManifest(courseCode);
  if (!manifest) return false;
  const exists = manifest.documents.some((d) => d.doc_id === docId);
  if (!exists) return false;

  // Remove from whichever backend indexed it, then delete files + manifest entry.
  await getStoreForBackend(manifest.vector_backend).deleteDoc(courseCode, docId);
  fileService.deleteReferenceDocFiles(courseCode, docId);

  manifest.documents = manifest.documents.filter((d) => d.doc_id !== docId);
  manifest.updated_at = new Date().toISOString();
  fileService.saveReferenceManifest(courseCode, manifest);
  return true;
}

export interface ReembedContextualResult {
  docs: number;
  chunks: number;
  headersGenerated: number;
  cacheHits: number;
  reembedded: number;
  model: string;
  dimensions: number;
  elapsedMs: number;
}

/**
 * Explicit, per-course "re-embed with context" action (Reference Anchoring V1.0).
 *
 * For every existing chunk across all docs:
 *  - generate a context header ONLY on a cache-miss (content_hash differs/absent or
 *    no stored header); cache-hits reuse the stored header with zero LLM cost,
 *  - re-embed the ENRICHED text (header + sep + raw) ONLY for chunks that changed
 *    (cache-miss) — unchanged chunks keep their existing embedding,
 *  - persist updated chunks per doc, re-index, and flag doc.contextual_embeddings.
 *
 * IDEMPOTENT: a second run with no content changes makes ZERO header LLM calls and
 * ZERO re-embeds (headersGenerated === 0, reembedded === 0).
 */
export async function reembedCourseWithContext(
  courseCode: string
): Promise<ReembedContextualResult> {
  const startedAt = Date.now();
  const manifest = fileService.getReferenceManifest(courseCode);
  if (!manifest || manifest.documents.length === 0) {
    return {
      docs: 0,
      chunks: 0,
      headersGenerated: 0,
      cacheHits: 0,
      reembedded: 0,
      model: '',
      dimensions: 0,
      elapsedMs: Date.now() - startedAt,
    };
  }

  let totalChunks = 0;
  let headersGenerated = 0;
  let cacheHits = 0;
  let reembedded = 0;
  let model = '';
  let dimensions = 0;

  const allUpdatedChunks: ReferenceChunk[] = [];

  for (const doc of manifest.documents) {
    const chunks = fileService.getReferenceChunks(courseCode, doc.doc_id);
    if (chunks.length === 0) continue;
    totalChunks += chunks.length;

    // 1. Headers (cache-aware): only cache-misses hit the LLM.
    const headerInputs = chunks.map((c) => chunkToHeaderInput(c, doc.title));
    const headerResults = await generateContextHeadersForChunks(headerInputs);

    // 2. Determine which chunks actually changed (need re-embed).
    const changedIdx: number[] = [];
    headerResults.forEach((r, i) => {
      if (r.cacheHit) {
        cacheHits += 1;
      } else {
        headersGenerated += 1;
        changedIdx.push(i);
      }
    });

    // 3. Re-embed only the changed chunks (unchanged keep their embedding).
    if (changedIdx.length > 0) {
      const enriched = changedIdx.map((i) =>
        buildEnrichedText(headerResults[i].header, chunks[i].text)
      );
      const embedResult = await embedTexts(enriched);
      model = embedResult.model;
      dimensions = embedResult.dimensions;
      changedIdx.forEach((i, j) => {
        chunks[i].context_header = headerResults[i].header;
        chunks[i].content_hash = headerResults[i].contentHash;
        chunks[i].embedding = embedResult.vectors[j] ?? chunks[i].embedding;
      });
      reembedded += changedIdx.length;
    } else {
      // Even with no re-embeds, backfill header/hash metadata if missing.
      headerResults.forEach((r, i) => {
        chunks[i].context_header = r.header;
        chunks[i].content_hash = r.contentHash;
      });
    }

    fileService.saveReferenceChunks(courseCode, doc.doc_id, chunks);
    allUpdatedChunks.push(...chunks);
    doc.contextual_embeddings = true;
  }

  // Re-index all chunks once (JSON backend is a no-op; Neo4j upserts vectors).
  if (allUpdatedChunks.length > 0) {
    const indexDims = dimensions || manifest.documents[0]?.embedding_dimensions || 0;
    const store = await resolveStoreForIndexing(indexDims);
    const backend = await store.indexChunks(allUpdatedChunks);
    manifest.vector_backend = backend;
  }

  if (!model) model = manifest.documents[0]?.embedding_model ?? '';
  if (!dimensions) dimensions = manifest.documents[0]?.embedding_dimensions ?? 0;

  manifest.updated_at = new Date().toISOString();
  fileService.saveReferenceManifest(courseCode, manifest);

  return {
    docs: manifest.documents.length,
    chunks: totalChunks,
    headersGenerated,
    cacheHits,
    reembedded,
    model,
    dimensions,
    elapsedMs: Date.now() - startedAt,
  };
}
