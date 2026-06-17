/**
 * Reference materials (RAG). `reference_chunks` keeps real columns for vector +
 * scope + lexical search (not just JSONB) because retrieval queries them directly
 * via pgvector and array containment. The HNSW index + tsv generated column are
 * created in the bootstrap SQL (post-load for HNSW), not here.
 */
import { pgTable, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import type { ReferenceDocument } from '../../models/schemas.js';
import { vector, tsvector } from './_custom.js';

export const referenceDocuments = pgTable(
  'reference_documents',
  {
    docId: text('doc_id').primaryKey(),
    courseCode: text('course_code').notNull(),
    docText: text('doc_text'),
    data: jsonb('data').$type<ReferenceDocument>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byCourse: index('reference_documents_course_idx').on(t.courseCode) })
);

export const referenceChunks = pgTable(
  'reference_chunks',
  {
    chunkId: text('chunk_id').primaryKey(),
    docId: text('doc_id').notNull(),
    courseCode: text('course_code').notNull(),
    seq: integer('seq').notNull().default(0),
    text: text('text').notNull(),
    citation: text('citation').notNull().default(''),
    sectionHeading: text('section_heading'),
    contextHeader: text('context_header'),
    contentHash: text('content_hash'),
    tokenEstimate: integer('token_estimate'),
    cloIds: text('clo_ids').array().notNull().default([]),
    subtopicIds: text('subtopic_ids').array().notNull().default([]),
    embedding: vector('embedding', { dim: 1536 }),
    tsv: tsvector('tsv'),
  },
  (t) => ({
    byCourse: index('reference_chunks_course_idx').on(t.courseCode),
    byDoc: index('reference_chunks_doc_idx').on(t.docId),
  })
);
