/**
 * Digital Library (institution-wide book catalog).
 *
 * `library_books` is the admin-curated catalog that sits ABOVE the per-course
 * `reference_documents`. Every reference a professor uploads becomes a candidate
 * here; an admin approves it (triggering AI cover + description enrichment) to
 * make it reusable by any professor. The original file is stored on disk
 * (`file_path`) so an approved book can be re-ingested into another course.
 *
 * A generated `tsv` column powers name/topic keyword search (GIN index created in
 * the bootstrap SQL, mirroring `reference_chunks.tsv`).
 */
import { pgTable, text, integer, jsonb, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import type { LibraryBook } from '../../models/schemas.js';
import { tsvector, vector } from './_custom.js';

/** Lifecycle of a catalog entry. */
export type LibraryBookStatus = 'candidate' | 'approved' | 'rejected';

export const libraryBooks = pgTable(
  'library_books',
  {
    bookId: text('book_id').primaryKey(),
    status: text('status').$type<LibraryBookStatus>().notNull().default('candidate'),
    title: text('title').notNull().default(''),
    authors: text('authors').array().notNull().default([]),
    description: text('description').notNull().default(''),
    isbn: text('isbn'),
    publisher: text('publisher'),
    publishedYear: integer('published_year'),
    coverPath: text('cover_path'),
    filePath: text('file_path'),
    mimeType: text('mime_type'),
    originalFilename: text('original_filename'),
    contentHash: text('content_hash'),
    sourceType: text('source_type').notNull().default('other'),
    createdBy: text('created_by'),
    approvedBy: text('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    data: jsonb('data').$type<LibraryBook>().notNull(),
    searchText: text('search_text').notNull().default(''),
    /** Canonical extracted text (course-independent), set during canonical indexing. */
    docText: text('doc_text'),
    tsv: tsvector('tsv'),
  },
  (t) => ({
    byStatus: index('library_books_status_idx').on(t.status),
    byHash: index('library_books_hash_idx').on(t.contentHash),
  })
);

/**
 * Course-INDEPENDENT canonical chunks for a catalog book. Produced once when the
 * book is added/approved into the library, then cloned into `reference_chunks`
 * (with a course_code + new doc id) whenever a professor adds the book to a course
 * — avoiding a full re-ingest each time.
 */
export const libraryBookChunks = pgTable(
  'library_book_chunks',
  {
    chunkId: text('chunk_id').primaryKey(),
    bookId: text('book_id').notNull(),
    seq: integer('seq').notNull().default(0),
    text: text('text').notNull(),
    citation: text('citation').notNull().default(''),
    sectionHeading: text('section_heading'),
    contextHeader: text('context_header'),
    contentHash: text('content_hash'),
    tokenEstimate: integer('token_estimate'),
    embedding: vector('embedding', { dim: 1536 }),
  },
  (t) => ({
    byBook: index('library_book_chunks_book_idx').on(t.bookId),
  })
);

/** Which courses use a catalog book (powers "where it's used"). */
export const libraryBookUsages = pgTable(
  'library_book_usages',
  {
    bookId: text('book_id').notNull(),
    courseCode: text('course_code').notNull(),
    docId: text('doc_id').notNull().default(''),
    addedBy: text('added_by'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('library_book_usage_pk').on(t.bookId, t.courseCode),
    byBook: index('library_book_usage_book_idx').on(t.bookId),
    byCourse: index('library_book_usage_course_idx').on(t.courseCode),
  })
);
