/**
 * Digital Library repository: catalog books + per-course usage.
 *
 * `library_books.data` (JSONB) is the source of truth for a book; the promoted
 * columns exist for filtering (status), dedup (content_hash), and full-text search
 * (the generated `tsv`). Keyword/topic search uses the GIN `tsv` index with an
 * ILIKE fallback so partial titles still match.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { LibraryBook, LibraryBookStatus, LibraryBookUsage } from '../../models/schemas.js';
import { libraryBooks, libraryBookUsages, libraryBookChunks } from '../schema/library.js';
import { exec, type Executor } from './_exec.js';

/** Map a JSONB-backed book row to the domain object. */
function toBook(row: { data: LibraryBook }): LibraryBook {
  return row.data;
}

/** Flatten catalog fields into one string for the generated tsvector column. */
function buildSearchText(book: LibraryBook): string {
  return [book.title, ...(book.authors ?? []), book.description].filter(Boolean).join(' ').trim();
}

/** Persist (insert or update) a book. The promoted columns are kept in sync with `data`. */
export async function saveBook(book: LibraryBook, tx?: Executor): Promise<void> {
  const searchText = buildSearchText(book);
  const values = {
    bookId: book.book_id,
    status: book.status,
    title: book.title,
    authors: book.authors ?? [],
    description: book.description ?? '',
    searchText,
    isbn: book.isbn ?? null,
    publisher: book.publisher ?? null,
    publishedYear: book.published_year ?? null,
    coverPath: book.cover_path ?? null,
    filePath: book.file_path ?? null,
    mimeType: book.mime_type ?? null,
    originalFilename: book.original_filename ?? null,
    contentHash: book.content_hash ?? null,
    sourceType: book.source_type,
    createdBy: book.created_by ?? null,
    approvedBy: book.approved_by ?? null,
    approvedAt: book.approved_at ? new Date(book.approved_at) : null,
    updatedAt: new Date(),
    data: book,
  };
  await exec(tx)
    .insert(libraryBooks)
    .values(values)
    .onConflictDoUpdate({
      target: libraryBooks.bookId,
      set: {
        status: sql`excluded.status`,
        title: sql`excluded.title`,
        authors: sql`excluded.authors`,
        description: sql`excluded.description`,
        searchText: sql`excluded.search_text`,
        isbn: sql`excluded.isbn`,
        publisher: sql`excluded.publisher`,
        publishedYear: sql`excluded.published_year`,
        coverPath: sql`excluded.cover_path`,
        filePath: sql`excluded.file_path`,
        mimeType: sql`excluded.mime_type`,
        originalFilename: sql`excluded.original_filename`,
        contentHash: sql`excluded.content_hash`,
        sourceType: sql`excluded.source_type`,
        createdBy: sql`excluded.created_by`,
        approvedBy: sql`excluded.approved_by`,
        approvedAt: sql`excluded.approved_at`,
        updatedAt: sql`excluded.updated_at`,
        data: sql`excluded.data`,
      },
    });
}

export async function getBook(bookId: string, tx?: Executor): Promise<LibraryBook | null> {
  const rows = await exec(tx)
    .select({ data: libraryBooks.data })
    .from(libraryBooks)
    .where(eq(libraryBooks.bookId, bookId))
    .limit(1);
  return rows[0] ? toBook(rows[0]) : null;
}

/** Find an existing book by file content hash (dedup the same book across courses). */
export async function getBookByHash(contentHash: string, tx?: Executor): Promise<LibraryBook | null> {
  if (!contentHash) return null;
  const rows = await exec(tx)
    .select({ data: libraryBooks.data })
    .from(libraryBooks)
    .where(eq(libraryBooks.contentHash, contentHash))
    .limit(1);
  return rows[0] ? toBook(rows[0]) : null;
}

export async function listByStatus(status: LibraryBookStatus, tx?: Executor): Promise<LibraryBook[]> {
  const rows = await exec(tx)
    .select({ data: libraryBooks.data })
    .from(libraryBooks)
    .where(eq(libraryBooks.status, status))
    .orderBy(desc(libraryBooks.updatedAt));
  return rows.map(toBook);
}

export async function listAll(tx?: Executor): Promise<LibraryBook[]> {
  const rows = await exec(tx)
    .select({ data: libraryBooks.data })
    .from(libraryBooks)
    .orderBy(desc(libraryBooks.updatedAt));
  return rows.map(toBook);
}

/**
 * Search APPROVED books by name/topic. Empty query returns all approved books
 * (most recent first). A query runs full-text against the generated `tsv` and
 * also ILIKE-matches the title/description so partial words still surface.
 */
export async function searchApproved(query: string, limit = 60, tx?: Executor): Promise<LibraryBook[]> {
  const q = query.trim();
  if (!q) {
    const rows = await exec(tx)
      .select({ data: libraryBooks.data })
      .from(libraryBooks)
      .where(eq(libraryBooks.status, 'approved'))
      .orderBy(desc(libraryBooks.updatedAt))
      .limit(limit);
    return rows.map(toBook);
  }
  const like = `%${q}%`;
  const rows = await exec(tx)
    .select({ data: libraryBooks.data })
    .from(libraryBooks)
    .where(
      and(
        eq(libraryBooks.status, 'approved'),
        sql`(${libraryBooks.tsv} @@ plainto_tsquery('english', ${q})
          OR ${libraryBooks.title} ILIKE ${like}
          OR ${libraryBooks.description} ILIKE ${like})`
      )
    )
    .orderBy(desc(libraryBooks.updatedAt))
    .limit(limit);
  return rows.map(toBook);
}

export async function deleteBook(bookId: string, tx?: Executor): Promise<void> {
  const db = exec(tx);
  await db.delete(libraryBookChunks).where(eq(libraryBookChunks.bookId, bookId));
  await db.delete(libraryBookUsages).where(eq(libraryBookUsages.bookId, bookId));
  await db.delete(libraryBooks).where(eq(libraryBooks.bookId, bookId));
}

// ---- Canonical (course-independent) chunks + extracted text ----

/** A canonical chunk: a passage of a catalog book with its embedding. */
export interface CanonicalChunk {
  chunk_id: string;
  book_id: string;
  seq: number;
  text: string;
  citation: string;
  section_heading?: string;
  context_header?: string;
  content_hash?: string;
  token_estimate?: number;
  embedding: number[];
}

/** Replace a book's canonical chunks (delete-then-insert). */
export async function saveCanonicalChunks(
  bookId: string,
  chunks: CanonicalChunk[],
  tx?: Executor
): Promise<void> {
  const db = exec(tx);
  await db.delete(libraryBookChunks).where(eq(libraryBookChunks.bookId, bookId));
  if (chunks.length === 0) return;
  await db.insert(libraryBookChunks).values(
    chunks.map((c) => ({
      chunkId: c.chunk_id,
      bookId: c.book_id,
      seq: c.seq,
      text: c.text,
      citation: c.citation ?? '',
      sectionHeading: c.section_heading ?? null,
      contextHeader: c.context_header ?? null,
      contentHash: c.content_hash ?? null,
      tokenEstimate: c.token_estimate ?? null,
      embedding: c.embedding && c.embedding.length > 0 ? c.embedding : null,
    }))
  );
}

export async function getCanonicalChunks(bookId: string, tx?: Executor): Promise<CanonicalChunk[]> {
  const rows = await exec(tx)
    .select()
    .from(libraryBookChunks)
    .where(eq(libraryBookChunks.bookId, bookId))
    .orderBy(libraryBookChunks.seq);
  return rows.map((r) => ({
    chunk_id: r.chunkId,
    book_id: r.bookId,
    seq: Number(r.seq ?? 0),
    text: r.text,
    citation: r.citation ?? '',
    section_heading: r.sectionHeading || undefined,
    context_header: r.contextHeader || undefined,
    content_hash: r.contentHash || undefined,
    token_estimate: r.tokenEstimate ?? undefined,
    embedding: (r.embedding as number[] | null) ?? [],
  }));
}

export async function deleteCanonicalChunks(bookId: string, tx?: Executor): Promise<void> {
  await exec(tx).delete(libraryBookChunks).where(eq(libraryBookChunks.bookId, bookId));
}

/** Persist the canonical extracted text on the book row (used for later re-chunking). */
export async function saveCanonicalText(bookId: string, text: string, tx?: Executor): Promise<void> {
  await exec(tx)
    .update(libraryBooks)
    .set({ docText: text })
    .where(eq(libraryBooks.bookId, bookId));
}

export async function getCanonicalText(bookId: string, tx?: Executor): Promise<string | null> {
  const rows = await exec(tx)
    .select({ docText: libraryBooks.docText })
    .from(libraryBooks)
    .where(eq(libraryBooks.bookId, bookId))
    .limit(1);
  return rows[0]?.docText ?? null;
}

// ---- Usage (which courses use a book) ----

function toUsage(row: typeof libraryBookUsages.$inferSelect): LibraryBookUsage {
  return {
    book_id: row.bookId,
    course_code: row.courseCode,
    doc_id: row.docId ?? '',
    added_by: row.addedBy ?? null,
    added_at: (row.addedAt instanceof Date ? row.addedAt : new Date(row.addedAt)).toISOString(),
  };
}

/** Record (or refresh) that a course uses a book. Idempotent per (book, course). */
export async function recordUsage(
  input: { bookId: string; courseCode: string; docId: string; addedBy?: string | null },
  tx?: Executor
): Promise<void> {
  await exec(tx)
    .insert(libraryBookUsages)
    .values({
      bookId: input.bookId,
      courseCode: input.courseCode,
      docId: input.docId,
      addedBy: input.addedBy ?? null,
    })
    .onConflictDoUpdate({
      target: [libraryBookUsages.bookId, libraryBookUsages.courseCode],
      set: { docId: sql`excluded.doc_id`, addedBy: sql`excluded.added_by`, addedAt: new Date() },
    });
}

export async function listUsages(bookId: string, tx?: Executor): Promise<LibraryBookUsage[]> {
  const rows = await exec(tx)
    .select()
    .from(libraryBookUsages)
    .where(eq(libraryBookUsages.bookId, bookId))
    .orderBy(desc(libraryBookUsages.addedAt));
  return rows.map(toUsage);
}

/** The single usage row for a (book, course) pair, or null when not used there. */
export async function getUsageForCourse(
  bookId: string,
  courseCode: string,
  tx?: Executor
): Promise<LibraryBookUsage | null> {
  const rows = await exec(tx)
    .select()
    .from(libraryBookUsages)
    .where(and(eq(libraryBookUsages.bookId, bookId), eq(libraryBookUsages.courseCode, courseCode)))
    .limit(1);
  return rows[0] ? toUsage(rows[0]) : null;
}

/**
 * Remove the usage link for a specific course reference document. Called when a
 * professor deletes a reference so the digital library stops counting that course.
 * Returns the affected book ids (usually one) so callers can react if needed.
 */
export async function deleteUsageByDoc(
  courseCode: string,
  docId: string,
  tx?: Executor
): Promise<string[]> {
  const deleted = await exec(tx)
    .delete(libraryBookUsages)
    .where(and(eq(libraryBookUsages.courseCode, courseCode), eq(libraryBookUsages.docId, docId)))
    .returning({ bookId: libraryBookUsages.bookId });
  return deleted.map((r) => r.bookId);
}

/** Book ids already used by a course (drives the picker's "already added" state). */
export async function listUsedBookIdsForCourse(courseCode: string, tx?: Executor): Promise<string[]> {
  const rows = await exec(tx)
    .select({ bookId: libraryBookUsages.bookId })
    .from(libraryBookUsages)
    .where(eq(libraryBookUsages.courseCode, courseCode));
  return rows.map((r) => r.bookId);
}

/** Catalog display info for every library book a course uses, keyed for doc join. */
export interface CourseBookInfo {
  docId: string;
  bookId: string;
  coverPath: string | null;
  description: string;
  authors: string[];
  title: string;
  status: LibraryBookStatus;
}

export async function listCourseBookInfo(courseCode: string, tx?: Executor): Promise<CourseBookInfo[]> {
  const rows = await exec(tx)
    .select({
      docId: libraryBookUsages.docId,
      bookId: libraryBooks.bookId,
      coverPath: libraryBooks.coverPath,
      description: libraryBooks.description,
      authors: libraryBooks.authors,
      title: libraryBooks.title,
      status: libraryBooks.status,
    })
    .from(libraryBookUsages)
    .innerJoin(libraryBooks, eq(libraryBookUsages.bookId, libraryBooks.bookId))
    .where(eq(libraryBookUsages.courseCode, courseCode));
  return rows.map((r) => ({
    docId: r.docId ?? '',
    bookId: r.bookId,
    coverPath: r.coverPath ?? null,
    description: r.description ?? '',
    authors: r.authors ?? [],
    title: r.title ?? '',
    status: r.status as LibraryBookStatus,
  }));
}

export async function countUsages(bookId: string, tx?: Executor): Promise<number> {
  const rows = await exec(tx)
    .select({ n: sql<number>`count(*)::int` })
    .from(libraryBookUsages)
    .where(eq(libraryBookUsages.bookId, bookId));
  return Number(rows[0]?.n ?? 0);
}
