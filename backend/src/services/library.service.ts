/**
 * Digital Library service: admin curation + professor reuse.
 *
 * Sits above the per-course RAG pipeline. Candidates are created automatically on
 * reference upload (see referenceIngestion.service). This service handles the admin
 * lifecycle (approve/reject/edit/re-enrich/delete) and lets a professor add an
 * approved book to their course, which re-ingests the stored original file.
 */
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
  LibraryBook,
  LibraryBookStatus,
  LibraryCanonicalIndex,
  ReferenceChunk,
  ReferenceDocument,
  ReferenceSourceType,
} from '../models/schemas.js';
import * as libraryRepo from '../db/repos/libraryRepo.js';
import * as referenceRepo from '../db/repos/referenceRepo.js';
import { enrichBook } from './libraryEnrichment.service.js';
import { readSourceBuffer, deleteBookFiles, saveSourceFile } from './libraryStorage.service.js';
import { ingestReferenceDocument, produceContextualChunks } from './referenceIngestion.service.js';
import { extractTextFromBuffer } from './extraction.service.js';
import { buildCitation } from './referenceChunking.service.js';
import { resolveStoreForIndexing } from './referenceStore.service.js';
import { getEmbeddingConfig } from './embedding.service.js';
import type { IngestionReporter } from './ingestionProgress.service.js';

export interface LibraryBookWithUsage extends LibraryBook {
  usage_count: number;
}

/** A book annotated with whether a given course already uses it (picker state). */
export interface LibraryBookForCourse extends LibraryBook {
  already_in_course: boolean;
}

/** Catalog display info attached to a course's reference documents. */
export interface ReferenceLibraryInfo {
  book_id: string;
  cover_path: string | null;
  description: string;
  authors: string[];
  title: string;
  status: LibraryBookStatus;
}

async function withUsageCount(book: LibraryBook): Promise<LibraryBookWithUsage> {
  const usage_count = await libraryRepo.countUsages(book.book_id);
  return { ...book, usage_count };
}

/** Candidates awaiting an admin decision (most recent first). */
export async function listCandidates(): Promise<LibraryBookWithUsage[]> {
  const books = await libraryRepo.listByStatus('candidate');
  return Promise.all(books.map(withUsageCount));
}

/** The approved catalog (admin view). */
export async function listApproved(): Promise<LibraryBookWithUsage[]> {
  const books = await libraryRepo.listByStatus('approved');
  return Promise.all(books.map(withUsageCount));
}

export async function getBook(bookId: string): Promise<LibraryBook | null> {
  return libraryRepo.getBook(bookId);
}

/**
 * Build the canonical (course-independent) chunk index for a book from its stored
 * file: extract -> chunk -> contextual headers -> embed -> persist to
 * `library_book_chunks` (+ canonical text on the book). This is the one-time
 * "ingestion" that makes later course-adds a fast clone. Returns the index summary.
 */
export async function indexBookCanonical(
  book: LibraryBook,
  onProgress?: IngestionReporter
): Promise<LibraryCanonicalIndex> {
  const buffer = readSourceBuffer(book.book_id, book.file_path);
  if (!buffer) throw new Error('The original file for this book is no longer available on disk');

  onProgress?.({ phase: 'extracting', docTitle: book.title });
  const text = (
    await extractTextFromBuffer(buffer, book.mime_type || 'application/pdf', book.original_filename || undefined)
  )?.trim();
  if (!text) throw new Error('No extractable text found in the book file.');

  const { rawChunks, headerResults, vectors, model, dimensions } = await produceContextualChunks(
    text,
    book.title,
    onProgress
  );

  const canonicalChunks: libraryRepo.CanonicalChunk[] = rawChunks.map((raw, i) => ({
    chunk_id: `${book.book_id}-C${raw.seq}`,
    book_id: book.book_id,
    seq: raw.seq,
    text: raw.text,
    citation: buildCitation(book.title, book.title, raw.section_heading),
    section_heading: raw.section_heading,
    context_header: headerResults[i].header,
    content_hash: headerResults[i].contentHash,
    token_estimate: raw.token_estimate,
    embedding: vectors[i] ?? [],
  }));

  await libraryRepo.saveCanonicalChunks(book.book_id, canonicalChunks);
  await libraryRepo.saveCanonicalText(book.book_id, text);

  return {
    chunk_count: canonicalChunks.length,
    char_count: text.length,
    embedding_model: model,
    embedding_dimensions: dimensions,
    contextual_embeddings: true,
    indexed_at: new Date().toISOString(),
  };
}

/** Background canonical (re)index for a book; persists the summary onto the book. */
function indexBookCanonicalInBackground(bookId: string): void {
  void (async () => {
    try {
      const book = await libraryRepo.getBook(bookId);
      if (!book) return;
      const canonical = await indexBookCanonical(book);
      const current = await libraryRepo.getBook(bookId);
      if (!current) return;
      await libraryRepo.saveBook({ ...current, canonical, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error('[library] background canonical indexing failed (non-fatal):', err);
    }
  })();
}

/**
 * Admin: add a book DIRECTLY to the library (not tied to any course). The file is
 * stored, the catalog row is created as `approved` (so it's immediately visible to
 * professors), enrichment runs in the background, and the canonical chunk index is
 * built INLINE so a later "add to course" is an instant clone (no re-ingest).
 */
export async function addBookToLibrary(params: {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  title?: string;
  sourceType?: ReferenceSourceType;
  createdBy?: string;
  onProgress?: IngestionReporter;
}): Promise<LibraryBook> {
  const contentHash = createHash('sha256').update(params.buffer).digest('hex');
  const now = new Date().toISOString();
  const fallbackTitle = (params.title || params.originalFilename).trim();

  let book = await libraryRepo.getBookByHash(contentHash);
  if (!book) {
    const bookId = uuidv4();
    const filePath = saveSourceFile(bookId, params.buffer, params.mimeType, params.originalFilename);
    book = {
      book_id: bookId,
      status: 'approved',
      title: fallbackTitle,
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
      source_type: params.sourceType ?? 'other',
      created_by: params.createdBy ?? null,
      approved_by: params.createdBy ?? null,
      approved_at: now,
      created_at: now,
      updated_at: now,
    };
  } else {
    // Book already known (e.g. a professor uploaded it before): promote to approved.
    book = {
      ...book,
      status: 'approved',
      approved_by: book.approved_by ?? params.createdBy ?? null,
      approved_at: book.approved_at ?? now,
      updated_at: now,
    };
  }
  await libraryRepo.saveBook(book);

  // Enrich (cover/description/metadata) in the background so the response is fast.
  try {
    const enriched = await enrichBook(book);
    book = { ...enriched, status: 'approved' };
    await libraryRepo.saveBook(book);
  } catch (err) {
    console.error('[library] enrichment during add-to-library failed (non-fatal):', err);
  }

  // Build the canonical index INLINE — this is the ingestion we never want to repeat.
  const canonical = await indexBookCanonical(book, params.onProgress);
  book = { ...book, canonical, updated_at: new Date().toISOString() };
  await libraryRepo.saveBook(book);

  return book;
}

export async function listUsages(bookId: string) {
  return libraryRepo.listUsages(bookId);
}

/**
 * Professor-facing search over APPROVED books only. When `courseCode` is provided,
 * each book is annotated with `already_in_course` so the picker can disable books
 * the course already uses (whether added from the library or uploaded directly).
 */
export async function searchApprovedBooks(
  query: string,
  courseCode?: string
): Promise<LibraryBook[] | LibraryBookForCourse[]> {
  const books = await libraryRepo.searchApproved(query);
  if (!courseCode) return books;
  const used = new Set(await libraryRepo.listUsedBookIdsForCourse(courseCode));
  return books.map((b) => ({ ...b, already_in_course: used.has(b.book_id) }));
}

/** Catalog cover/description for every library book a course references (keyed by doc_id). */
export async function getCourseReferenceLibraryInfo(
  courseCode: string
): Promise<Record<string, ReferenceLibraryInfo>> {
  const rows = await libraryRepo.listCourseBookInfo(courseCode);
  const map: Record<string, ReferenceLibraryInfo> = {};
  for (const r of rows) {
    if (!r.docId) continue;
    map[r.docId] = {
      book_id: r.bookId,
      cover_path: r.coverPath,
      description: r.description,
      authors: r.authors,
      title: r.title,
      status: r.status,
    };
  }
  return map;
}

/**
 * Approve a candidate: run enrichment (cover + metadata + description) then flip to
 * `approved`. Re-running on an already-approved book simply re-enriches it.
 */
export async function approveBook(bookId: string, approvedBy?: string): Promise<LibraryBook> {
  const book = await libraryRepo.getBook(bookId);
  if (!book) throw new Error('Book not found');

  const enriched = await enrichBook(book);
  const now = new Date().toISOString();
  const approved: LibraryBook = {
    ...enriched,
    status: 'approved',
    approved_by: approvedBy ?? book.approved_by ?? null,
    approved_at: book.approved_at ?? now,
    updated_at: now,
  };
  await libraryRepo.saveBook(approved);
  // Build the course-independent canonical chunk index in the background so future
  // course-adds clone instantly (non-fatal; course-usage chunks remain a fallback).
  indexBookCanonicalInBackground(approved.book_id);
  return approved;
}

/** Re-run AI/external enrichment on a book without changing its status. */
export async function reenrichBook(bookId: string): Promise<LibraryBook> {
  const book = await libraryRepo.getBook(bookId);
  if (!book) throw new Error('Book not found');
  const enriched = await enrichBook(book);
  await libraryRepo.saveBook(enriched);
  return enriched;
}

/** Reject a candidate (kept for audit; excluded from professor search). */
export async function rejectBook(bookId: string, rejectedBy?: string): Promise<LibraryBook> {
  const book = await libraryRepo.getBook(bookId);
  if (!book) throw new Error('Book not found');
  const updated: LibraryBook = {
    ...book,
    status: 'rejected',
    approved_by: rejectedBy ?? book.approved_by ?? null,
    updated_at: new Date().toISOString(),
  };
  await libraryRepo.saveBook(updated);
  return updated;
}

/** Editable catalog fields (admin full control). */
export interface BookMetadataEdit {
  title?: string;
  authors?: string[];
  description?: string;
  isbn?: string | null;
  publisher?: string | null;
  published_year?: number | null;
  source_type?: LibraryBook['source_type'];
  status?: LibraryBookStatus;
}

export async function updateBookMetadata(bookId: string, edit: BookMetadataEdit): Promise<LibraryBook> {
  const book = await libraryRepo.getBook(bookId);
  if (!book) throw new Error('Book not found');
  const updated: LibraryBook = {
    ...book,
    title: edit.title ?? book.title,
    authors: edit.authors ?? book.authors,
    description: edit.description ?? book.description,
    isbn: edit.isbn !== undefined ? edit.isbn : book.isbn,
    publisher: edit.publisher !== undefined ? edit.publisher : book.publisher,
    published_year: edit.published_year !== undefined ? edit.published_year : book.published_year,
    source_type: edit.source_type ?? book.source_type,
    status: edit.status ?? book.status,
    updated_at: new Date().toISOString(),
  };
  await libraryRepo.saveBook(updated);
  return updated;
}

export async function deleteBook(bookId: string): Promise<boolean> {
  const book = await libraryRepo.getBook(bookId);
  if (!book) return false;
  await libraryRepo.deleteBook(bookId);
  deleteBookFiles(bookId);
  return true;
}

/** Result of adding a library book to a course. */
export interface UseBookResult {
  docId: string;
  /** True when chunks/embeddings were reused (no re-ingestion). */
  reused: boolean;
  /** True when the course already had this book (nothing new created). */
  alreadyPresent: boolean;
}

/** A reusable, pre-embedded copy of a book's passages we can clone into a course. */
interface ReusableSource {
  /** Chunks with text + embeddings + headers; doc_id/course_code are placeholders. */
  chunks: ReferenceChunk[];
  embedding_model: string;
  embedding_dimensions: number;
  contextual_embeddings: boolean;
  char_count: number;
  docText: string | null;
}

function canonicalToReferenceChunk(c: libraryRepo.CanonicalChunk): ReferenceChunk {
  return {
    chunk_id: c.chunk_id,
    doc_id: '',
    course_code: '',
    seq: c.seq,
    text: c.text,
    token_estimate: c.token_estimate ?? 0,
    section_heading: c.section_heading,
    context_header: c.context_header,
    content_hash: c.content_hash,
    citation: c.citation ?? '',
    clo_ids: [],
    subtopic_ids: [],
    embedding: c.embedding,
  };
}

/**
 * A pre-embedded source to clone from, to avoid re-processing. Prefers the
 * course-independent canonical index; falls back to any prior course ingestion of
 * the same book. Returns null when no usable prior embeddings exist.
 */
async function findReusableSource(book: LibraryBook): Promise<ReusableSource | null> {
  // 1. Canonical (course-independent) index — the preferred source.
  if (book.canonical && book.canonical.chunk_count > 0) {
    const canon = await libraryRepo.getCanonicalChunks(book.book_id);
    const usable = canon.filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0);
    if (usable.length > 0) {
      return {
        chunks: usable.map(canonicalToReferenceChunk),
        embedding_model: book.canonical.embedding_model,
        embedding_dimensions: book.canonical.embedding_dimensions,
        contextual_embeddings: book.canonical.contextual_embeddings,
        char_count: book.canonical.char_count,
        docText: await libraryRepo.getCanonicalText(book.book_id),
      };
    }
  }

  // 2. Any prior course ingestion of the same book.
  const usages = await libraryRepo.listUsages(book.book_id);
  for (const usage of usages) {
    if (!usage.doc_id) continue;
    const doc = await referenceRepo.getDocument(usage.doc_id);
    if (!doc) continue;
    const chunks = await referenceRepo.getChunksByDoc(usage.doc_id);
    const usable = chunks.filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0);
    if (usable.length > 0) {
      return {
        chunks: usable,
        embedding_model: doc.embedding_model,
        embedding_dimensions: doc.embedding_dimensions,
        contextual_embeddings: doc.contextual_embeddings ?? false,
        char_count: doc.char_count ?? 0,
        docText: await referenceRepo.getDocText(doc.doc_id),
      };
    }
  }
  return null;
}

/**
 * Clone a reusable source's chunks into a course: same text + embeddings + context
 * headers, re-keyed to a new doc id and course. No extraction, chunking, LLM header
 * generation, or embedding happens — it is a fast DB copy + index.
 *
 * Per-chunk scope tags (CLO/subtopic) are reset to document-level (empty) because
 * alignment is course-specific; re-run Reference Alignment for precise grounding.
 */
async function cloneSourceIntoCourse(
  book: LibraryBook,
  courseCode: string,
  source: ReusableSource
): Promise<ReferenceDocument> {
  const newDocId = uuidv4();
  const now = new Date().toISOString();

  const newChunks: ReferenceChunk[] = source.chunks.map((c) => ({
    ...c,
    chunk_id: `${newDocId}-C${c.seq}`,
    doc_id: newDocId,
    course_code: courseCode,
    clo_ids: [],
    subtopic_ids: [],
  }));

  const newDoc: ReferenceDocument = {
    doc_id: newDocId,
    course_code: courseCode,
    title: book.title,
    source_type: book.source_type,
    citation_label: book.title,
    scope: { clo_ids: [], subtopic_ids: [] },
    original_filename: book.original_filename || `${book.title}.pdf`,
    mime_type: book.mime_type || 'application/pdf',
    uploaded_at: now,
    char_count: source.char_count || source.docText?.length || 0,
    chunk_count: newChunks.length,
    embedding_model: source.embedding_model,
    embedding_dimensions: source.embedding_dimensions,
    contextual_embeddings: source.contextual_embeddings,
  };

  await referenceRepo.saveDocument(newDoc, source.docText ?? undefined);
  // PostgresVectorStore.indexChunks upserts the chunk rows (incl. embeddings) and
  // ensures the HNSW index, so no separate upsert is needed.
  const store = await resolveStoreForIndexing(newDoc.embedding_dimensions);
  await store.indexChunks(newChunks);

  return newDoc;
}

/**
 * Add an approved library book to a course as grounding material.
 *
 * Fast path: if the book was already ingested somewhere (it always is — the catalog
 * candidate is created from an upload) and that ingestion used the SAME embedding
 * model, we CLONE its chunks/embeddings into this course (no re-extraction, chunking,
 * or embedding). Falls back to a full re-ingest of the stored file only when no
 * reusable chunks exist or the embedding model has changed. Idempotent per course:
 * if the book is already a reference here, returns the existing doc untouched.
 */
export async function useBookInCourse(
  bookId: string,
  courseCode: string,
  options: { addedBy?: string; onProgress?: IngestionReporter; allowUnapproved?: boolean } = {}
): Promise<UseBookResult> {
  const book = await libraryRepo.getBook(bookId);
  if (!book) throw new Error('Book not found');
  // Professors may only pull APPROVED books from the picker, but the upload-dedup
  // path (allowUnapproved) reuses a file the professor just provided themselves, so
  // a not-yet-approved candidate match is fine there.
  if (!options.allowUnapproved && book.status !== 'approved') {
    throw new Error('Only approved library books can be added to a course');
  }
  const onProgress = options.onProgress;

  // 1. Already a reference in this course? Don't duplicate it.
  const existing = await libraryRepo.getUsageForCourse(bookId, courseCode);
  if (existing?.doc_id) {
    const doc = await referenceRepo.getDocument(existing.doc_id);
    if (doc) {
      onProgress?.({
        phase: 'done',
        docTitle: book.title,
        chunkCount: doc.chunk_count,
        message: `"${book.title}" is already a reference in this course.`,
      });
      return { docId: doc.doc_id, reused: true, alreadyPresent: true };
    }
  }

  // 2. Fast path: clone existing chunks/embeddings when the embedding model matches.
  const source = await findReusableSource(book);
  const currentModel = getEmbeddingConfig().model;
  if (source && source.embedding_model === currentModel) {
    onProgress?.({
      phase: 'indexing',
      docTitle: book.title,
      chunkCount: source.chunks.length,
      message: `Reusing ${source.chunks.length} prepared passages (no re-processing)…`,
    });
    const doc = await cloneSourceIntoCourse(book, courseCode, source);
    await libraryRepo.recordUsage({
      bookId: book.book_id,
      courseCode,
      docId: doc.doc_id,
      addedBy: options.addedBy ?? null,
    });
    onProgress?.({
      phase: 'done',
      docTitle: book.title,
      chunkCount: doc.chunk_count,
      message: `Added "${book.title}" — ${doc.chunk_count} passages reused instantly.`,
    });
    return { docId: doc.doc_id, reused: true, alreadyPresent: false };
  }

  // 3. Fallback: full re-ingest of the stored original (no reusable chunks / model changed).
  const buffer = readSourceBuffer(book.book_id, book.file_path);
  if (!buffer) throw new Error('The original file for this book is no longer available on disk');

  const doc = await ingestReferenceDocument({
    courseCode,
    buffer,
    originalFilename: book.original_filename || `${book.title}.pdf`,
    mimeType: book.mime_type || 'application/pdf',
    title: book.title,
    sourceType: book.source_type,
    citationLabel: book.title,
    onProgress,
    skipLibraryCandidate: true,
  });

  await libraryRepo.recordUsage({
    bookId: book.book_id,
    courseCode,
    docId: doc.doc_id,
    addedBy: options.addedBy ?? null,
  });

  // Backfill the canonical index from this fresh ingestion (best-effort) so the
  // NEXT course-add is an instant clone instead of another full re-ingest.
  if (!book.canonical) {
    try {
      const freshChunks = await referenceRepo.getChunksByDoc(doc.doc_id);
      const usable = freshChunks.filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0);
      if (usable.length > 0) {
        await libraryRepo.saveCanonicalChunks(
          book.book_id,
          usable.map((c) => ({
            chunk_id: `${book.book_id}-C${c.seq}`,
            book_id: book.book_id,
            seq: c.seq,
            text: c.text,
            citation: c.citation,
            section_heading: c.section_heading,
            context_header: c.context_header,
            content_hash: c.content_hash,
            token_estimate: c.token_estimate,
            embedding: c.embedding,
          }))
        );
        const docText = await referenceRepo.getDocText(doc.doc_id);
        if (docText) await libraryRepo.saveCanonicalText(book.book_id, docText);
        await libraryRepo.saveBook({
          ...book,
          canonical: {
            chunk_count: usable.length,
            char_count: doc.char_count ?? docText?.length ?? 0,
            embedding_model: doc.embedding_model,
            embedding_dimensions: doc.embedding_dimensions,
            contextual_embeddings: doc.contextual_embeddings ?? false,
            indexed_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('[library] canonical backfill after full ingest failed (non-fatal):', err);
    }
  }

  return { docId: doc.doc_id, reused: false, alreadyPresent: false };
}

/** Outcome of de-duplicating a professor upload against the catalog. */
export interface UploadDedupResult extends UseBookResult {
  /** The catalog book the uploaded file matched (by content hash). */
  book: LibraryBook;
  /** The resulting course reference document. */
  document: ReferenceDocument;
}

/**
 * If a professor uploads a file whose bytes already exist in the library (matched by
 * SHA-256), add it to the course by cloning the catalog book's prepared passages —
 * or short-circuiting when it's already a reference here — instead of re-running the
 * full extract/chunk/embed pipeline. Returns null when the file is NOT already in the
 * library, signalling the caller to ingest the upload normally.
 */
export async function reuseUploadedBookIfKnown(params: {
  buffer: Buffer;
  courseCode: string;
  addedBy?: string;
  onProgress?: IngestionReporter;
}): Promise<UploadDedupResult | null> {
  const contentHash = createHash('sha256').update(params.buffer).digest('hex');
  const book = await libraryRepo.getBookByHash(contentHash);
  if (!book) return null;

  const result = await useBookInCourse(book.book_id, params.courseCode, {
    addedBy: params.addedBy,
    onProgress: params.onProgress,
    allowUnapproved: true,
  });
  const document = await referenceRepo.getDocument(result.docId);
  if (!document) return null; // Defensive: fall back to a normal ingest.
  return { ...result, book, document };
}
