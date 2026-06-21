/**
 * Reference Ingestion Service
 *
 * Orchestrates SME-initiated, per-course ingestion of a reference document:
 *   extract text -> persist -> chunk -> embed -> index (Neo4j or JSON) -> manifest.
 *
 * This is additive and never touches the existing citation-string pipeline.
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
  LibraryBook,
  ReferenceChunk,
  ReferenceDocument,
  ReferenceScope,
  ReferenceSourceType,
} from '../models/schemas.js';
import * as referenceRepo from '../db/repos/referenceRepo.js';
import * as libraryRepo from '../db/repos/libraryRepo.js';
import { enrichBook } from './libraryEnrichment.service.js';
import { saveSourceFile } from './libraryStorage.service.js';
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
import type { IngestionReporter } from './ingestionProgress.service.js';

const noopReporter: IngestionReporter = () => {};

/**
 * Enrich a freshly-created library candidate (cover + description + metadata) in the
 * background so a professor's uploaded book shows a picture and summary even before
 * an admin approves it. Fully non-fatal and guarded against racing an admin action:
 * the enriched result is only saved if the book is still a `candidate`.
 */
function enrichCandidateInBackground(bookId: string): void {
  void (async () => {
    try {
      const book = await libraryRepo.getBook(bookId);
      if (!book || book.status !== 'candidate') return;
      const enriched = await enrichBook(book);
      const current = await libraryRepo.getBook(bookId);
      if (!current || current.status !== 'candidate') return; // admin acted meanwhile
      await libraryRepo.saveBook({ ...enriched, status: 'candidate' });
    } catch (err) {
      console.error('[library] background candidate enrichment failed (non-fatal):', err);
    }
  })();
}

export interface IngestReferenceParams {
  courseCode: string;
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  title?: string;
  sourceType?: ReferenceSourceType;
  citationLabel?: string;
  scope?: ReferenceScope;
  /** Optional live-progress reporter (no-op when omitted). */
  onProgress?: IngestionReporter;
  /** User id of the uploader (threaded into the library candidate record). */
  uploadedBy?: string;
  /**
   * When true, skip registering a digital-library candidate. Set by the library
   * service when re-ingesting an already-cataloged book into another course (the
   * usage is recorded separately there) to avoid a redundant candidate.
   */
  skipLibraryCandidate?: boolean;
}

/**
 * Register/refresh a digital-library candidate for an uploaded reference and record
 * that this course uses it. Best-effort and fully non-fatal: a failure here must
 * never break the (already successful) reference ingestion. Dedups the same book
 * across courses via the file content hash.
 */
async function registerLibraryCandidate(params: {
  courseCode: string;
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
  title: string;
  sourceType: ReferenceSourceType;
  docId: string;
  uploadedBy?: string;
}): Promise<void> {
  try {
    const contentHash = createHash('sha256').update(params.buffer).digest('hex');
    let book = await libraryRepo.getBookByHash(contentHash);
    if (!book) {
      const bookId = uuidv4();
      const filePath = saveSourceFile(bookId, params.buffer, params.mimeType, params.originalFilename);
      const now = new Date().toISOString();
      book = {
        book_id: bookId,
        status: 'candidate',
        title: params.title,
        authors: [],
        description: '',
        isbn: null,
        publisher: null,
        published_year: null,
        cover_path: null,
        file_path: filePath,
        mime_type: params.mimeType,
        original_filename: params.originalFilename,
        content_hash: contentHash,
        source_type: params.sourceType,
        created_by: params.uploadedBy ?? null,
        approved_by: null,
        approved_at: null,
        created_at: now,
        updated_at: now,
      } satisfies LibraryBook;
      await libraryRepo.saveBook(book);
      // Newly discovered book: enrich (cover/description) in the background so it
      // displays nicely as a course reference even before admin approval.
      enrichCandidateInBackground(book.book_id);
    }
    await libraryRepo.recordUsage({
      bookId: book.book_id,
      courseCode: params.courseCode,
      docId: params.docId,
      addedBy: params.uploadedBy ?? null,
    });
  } catch (err) {
    console.error('[library] candidate registration failed (non-fatal):', err);
  }
}

/** Result of turning raw text into embedded, context-headed passages. */
export interface ProducedChunks {
  /** Raw chunk metadata (seq, text, section_heading, token_estimate). */
  rawChunks: ReturnType<typeof chunkText>;
  /** Per-chunk context header + content hash (parallel to rawChunks). */
  headerResults: Awaited<ReturnType<typeof generateContextHeadersForChunks>>;
  /** Embedding vectors (parallel to rawChunks). */
  vectors: number[][];
  model: string;
  dimensions: number;
}

/**
 * Extracted-text -> chunk -> contextual header -> embed. Shared by per-course
 * ingestion and course-independent canonical indexing so both produce identical
 * passages/embeddings (the only difference is how the rows are keyed/stored).
 *
 * Throws if no usable chunks remain after the junk filter.
 */
export async function produceContextualChunks(
  text: string,
  docTitle: string,
  onProgress: IngestionReporter = noopReporter
): Promise<ProducedChunks> {
  onProgress({ phase: 'chunking', charCount: text.length });
  const rawChunks = chunkText(text);
  if (rawChunks.length === 0) {
    throw new Error(
      'Reference file produced no usable chunks after extraction (all content was filtered as junk/thin).'
    );
  }
  onProgress({
    phase: 'chunking',
    charCount: text.length,
    chunkCount: rawChunks.length,
    message: `Found ${rawChunks.length} passages to ingest.`,
  });

  const headerInputs: ChunkHeaderInput[] = rawChunks.map((raw) => ({
    key: String(raw.seq),
    docTitle,
    sectionHeading: raw.section_heading,
    text: raw.text,
  }));
  onProgress({
    phase: 'contextualizing',
    current: 0,
    total: headerInputs.length,
    chunkCount: rawChunks.length,
  });
  const headerResults = await generateContextHeadersForChunks(headerInputs, {
    onProgress: (current, total) =>
      onProgress({
        phase: 'contextualizing',
        current,
        total,
        chunkCount: rawChunks.length,
        message: `Adding context to passage ${current} of ${total}…`,
      }),
  });

  const enrichedTexts = rawChunks.map((raw, i) => buildEnrichedText(headerResults[i].header, raw.text));
  onProgress({
    phase: 'embedding',
    current: 0,
    total: enrichedTexts.length,
    chunkCount: rawChunks.length,
  });
  const { vectors, model, dimensions } = await embedTexts(enrichedTexts, (current, total) =>
    onProgress({
      phase: 'embedding',
      current,
      total,
      chunkCount: rawChunks.length,
      message: `Embedding passage ${current} of ${total}…`,
    })
  );

  return { rawChunks, headerResults, vectors, model, dimensions };
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
    onProgress = noopReporter,
    uploadedBy,
    skipLibraryCandidate = false,
  } = params;

  const docTitle = (title || originalFilename).trim();
  onProgress({ phase: 'extracting', docTitle, filename: originalFilename });
  const text = (await extractTextFromBuffer(buffer, mimeType, originalFilename))?.trim();
  if (!text) {
    throw new Error('No extractable text found in the uploaded reference file.');
  }

  const docId = uuidv4();
  const label = (citationLabel || docTitle).trim();
  const cloIds = scope.clo_ids ?? [];
  const subtopicIds = scope.subtopic_ids ?? [];

  const { rawChunks, headerResults, vectors, model, dimensions } = await produceContextualChunks(
    text,
    docTitle,
    onProgress
  );

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

  // Persist document (+full text) then index chunks/embeddings into pgvector.
  onProgress({
    phase: 'indexing',
    chunkCount: chunks.length,
    charCount: text.length,
    docTitle,
  });
  await referenceRepo.saveDocument(doc, text);
  const store = await resolveStoreForIndexing(dimensions);
  await store.indexChunks(chunks);

  // Register/refresh the institution-wide library candidate (non-fatal).
  if (!skipLibraryCandidate) {
    await registerLibraryCandidate({
      courseCode,
      buffer,
      mimeType,
      originalFilename,
      title: docTitle,
      sourceType,
      docId,
      uploadedBy,
    });
  }

  onProgress({
    phase: 'done',
    chunkCount: chunks.length,
    charCount: text.length,
    docTitle,
    message: `Ingested "${docTitle}" — ${chunks.length} passages indexed.`,
  });

  return doc;
}

export interface IngestReferenceFromUrlParams {
  courseCode: string;
  url: string;
  title?: string;
  sourceType?: ReferenceSourceType;
  citationLabel?: string;
  scope?: ReferenceScope;
  /** Optional live-progress reporter (no-op when omitted). */
  onProgress?: IngestionReporter;
  /** User id of the uploader (threaded into the library candidate record). */
  uploadedBy?: string;
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
  const {
    courseCode,
    url,
    title,
    sourceType = 'other',
    citationLabel,
    scope,
    onProgress = noopReporter,
    uploadedBy,
  } = params;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) links are supported.');
  }

  onProgress({ phase: 'fetching', message: 'Downloading the source PDF…' });
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
    onProgress,
    uploadedBy,
  });
}

export async function listReferenceDocuments(courseCode: string): Promise<ReferenceDocument[]> {
  return referenceRepo.listDocuments(courseCode);
}

export async function deleteReferenceDocument(courseCode: string, docId: string): Promise<boolean> {
  const doc = await referenceRepo.getDocument(docId);
  if (!doc) return false;
  // Remove the vector index rows, then the document (cascades its chunks).
  await getStoreForBackend('postgres').deleteDoc(courseCode, docId);
  await referenceRepo.deleteDocument(docId);
  // Drop the digital-library usage link so the admin catalog stops counting this
  // course (the canonical book + chunks stay; only this course's usage is removed).
  // Best-effort: a failure here must not block the (successful) reference removal.
  try {
    await libraryRepo.deleteUsageByDoc(courseCode, docId);
  } catch (err) {
    console.error('[library] failed to clear usage on reference delete (non-fatal):', err);
  }
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
export interface RechunkResult {
  docs: number;
  /** Docs whose raw text was available and were re-chunked. */
  rechunked: number;
  /** Docs skipped because their raw extracted text was not stored (re-upload required). */
  skippedNoText: string[];
  chunksBefore: number;
  chunksAfter: number;
  /** Net chunks removed by the Issue 2 junk filter across all re-chunked docs. */
  junkRemoved: number;
  model: string;
  dimensions: number;
  elapsedMs: number;
}

/**
 * Backfill path (Issue 2E): re-chunk already-indexed references through the NEW
 * junk filter and re-index them, so existing courses (e.g. MDLD602) stop citing
 * page-number/TOC/index noise without a manual re-upload.
 *
 * Reuses the stored raw extracted text (referenceDocuments.doc_text). For each
 * doc with stored text it: re-chunks (now junk-filtered) -> regenerates context
 * headers -> re-embeds the enriched text -> replaces the doc's chunks -> re-indexes.
 *
 * IMPORTANT: re-chunking creates NEW chunk ids and resets per-chunk scope tags to
 * the document-level scope. Any prior per-chunk Reference Alignment (Layer 7)
 * tagging is therefore cleared for re-chunked docs — re-run Reference Alignment
 * afterwards for precise subtopic/CLO grounding. Docs with NO stored text are
 * reported in `skippedNoText` and must be re-uploaded (we never silently no-op).
 */
export async function rechunkCourseReferences(courseCode: string): Promise<RechunkResult> {
  const startedAt = Date.now();
  const documents = await referenceRepo.listDocuments(courseCode);

  const result: RechunkResult = {
    docs: documents.length,
    rechunked: 0,
    skippedNoText: [],
    chunksBefore: 0,
    chunksAfter: 0,
    junkRemoved: 0,
    model: '',
    dimensions: 0,
    elapsedMs: 0,
  };

  for (const doc of documents) {
    const existing = await referenceRepo.getChunksByDoc(doc.doc_id);
    result.chunksBefore += existing.length;

    const text = await referenceRepo.getDocText(doc.doc_id);
    if (!text || !text.trim()) {
      // No stored raw text → cannot re-chunk; a re-upload of the PDF is required.
      result.skippedNoText.push(doc.doc_id);
      result.chunksAfter += existing.length; // unchanged
      continue;
    }

    const rawChunks = chunkText(text); // junk-filtered by Issue 2B
    if (rawChunks.length === 0) {
      // Everything filtered as junk — drop the stale chunks rather than keep noise.
      await referenceRepo.deleteChunksByDoc(courseCode, doc.doc_id);
      await getStoreForBackend('postgres').deleteDoc(courseCode, doc.doc_id);
      result.rechunked += 1;
      result.junkRemoved += existing.length;
      doc.chunk_count = 0;
      await referenceRepo.saveDocument(doc);
      continue;
    }

    const docTitle = doc.title;
    const label = doc.citation_label || docTitle;
    const cloIds = doc.scope?.clo_ids ?? [];
    const subtopicIds = doc.scope?.subtopic_ids ?? [];

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
    result.model = model;
    result.dimensions = dimensions;

    const chunks: ReferenceChunk[] = rawChunks.map((raw, i) => ({
      chunk_id: `${doc.doc_id}-C${raw.seq}`,
      doc_id: doc.doc_id,
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

    // Replace the doc's chunks (drop stale index rows first), then re-index.
    await referenceRepo.deleteChunksByDoc(courseCode, doc.doc_id);
    await referenceRepo.upsertChunks(chunks);
    const store = await resolveStoreForIndexing(dimensions);
    await store.indexChunks(chunks);

    doc.chunk_count = chunks.length;
    doc.char_count = text.length;
    await referenceRepo.saveDocument(doc);

    result.rechunked += 1;
    result.chunksAfter += chunks.length;
    result.junkRemoved += Math.max(0, existing.length - chunks.length);
  }

  if (!result.model) result.model = documents[0]?.embedding_model ?? '';
  if (!result.dimensions) result.dimensions = documents[0]?.embedding_dimensions ?? 0;
  result.elapsedMs = Date.now() - startedAt;
  return result;
}

export async function reembedCourseWithContext(
  courseCode: string
): Promise<ReembedContextualResult> {
  const startedAt = Date.now();
  const documents = await referenceRepo.listDocuments(courseCode);
  if (documents.length === 0) {
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

  for (const doc of documents) {
    const chunks = await referenceRepo.getChunksByDoc(doc.doc_id);
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

    await referenceRepo.upsertChunks(chunks);
    allUpdatedChunks.push(...chunks);
    doc.contextual_embeddings = true;
    await referenceRepo.saveDocument(doc);
  }

  // Re-index all chunks once into pgvector (ensures the HNSW index too).
  if (allUpdatedChunks.length > 0) {
    const indexDims = dimensions || documents[0]?.embedding_dimensions || 0;
    const store = await resolveStoreForIndexing(indexDims);
    await store.indexChunks(allUpdatedChunks);
  }

  if (!model) model = documents[0]?.embedding_model ?? '';
  if (!dimensions) dimensions = documents[0]?.embedding_dimensions ?? 0;

  return {
    docs: documents.length,
    chunks: totalChunks,
    headersGenerated,
    cacheHits,
    reembedded,
    model,
    dimensions,
    elapsedMs: Date.now() - startedAt,
  };
}
