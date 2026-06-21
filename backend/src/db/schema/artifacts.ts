/**
 * Generic artifact + config + blob-metadata + projection-outbox tables.
 *
 * `stage_artifacts` is a deliberate god-table for write-once-read-whole JSON
 * artifacts (Stage 1 layers, Stage 3/4/5 outputs, confirmations, checkpoints,
 * alignment proposals, error logs). Keyed by (course_code, artifact_type, node_id).
 * If any read ever filters by inner field, add a GIN index on `data` or promote
 * the field to a column.
 */
import { pgTable, text, integer, jsonb, timestamp, serial, bigint, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const stageArtifacts = pgTable(
  'stage_artifacts',
  {
    id: serial('id').primaryKey(),
    courseCode: text('course_code').notNull(),
    stage: text('stage'),
    artifactType: text('artifact_type').notNull(),
    nodeId: text('node_id').notNull().default(''),
    data: jsonb('data').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('stage_artifacts_key_uniq').on(t.courseCode, t.artifactType, t.nodeId),
    byCourse: index('stage_artifacts_course_idx').on(t.courseCode),
  })
);

/** Singleton-row config documents (replaces config/*.json). Keyed by `key`. */
export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  data: jsonb('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Metadata for binary files kept on the filesystem (PDF/DOCX/ZIP, uploads). */
export const blobFiles = pgTable(
  'blob_files',
  {
    id: serial('id').primaryKey(),
    courseCode: text('course_code').notNull(),
    kind: text('kind').notNull(),
    docType: text('doc_type'),
    format: text('format'),
    path: text('path').notNull(),
    bytes: bigint('bytes', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byCourse: index('blob_files_course_idx').on(t.courseCode) })
);

/**
 * Transactional outbox for the Neo4j projection. Written in the SAME transaction
 * as the entity/edge change; an async worker drains pending rows to Neo4j and
 * marks them done. Gives projection drift a defined recovery point.
 */
export const projectionOutbox = pgTable(
  'projection_outbox',
  {
    id: serial('id').primaryKey(),
    /** 'course' | 'node_set' — what kind of subgraph to (re)project. */
    entityType: text('entity_type').notNull(),
    /** course_code for 'course'; `${courseCode}:${subtopicId}` for 'node_set'. */
    entityKey: text('entity_key').notNull(),
    /** 'upsert' | 'delete'. */
    op: text('op').notNull().default('upsert'),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byStatus: index('projection_outbox_status_idx').on(t.status) })
);
