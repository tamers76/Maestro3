/**
 * Core curriculum entities (Postgres source of truth). Each entity table keeps
 * promoted columns for keys/FKs/filtering/sorting plus a `data` JSONB holding the
 * full typed object for lossless round-trip with the existing schemas.ts types.
 *
 * Relationships (edges) live in `node_prerequisites` + the FK columns; these are
 * the source projected to Neo4j.
 */
import { pgTable, text, integer, serial, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import type { Course, CLO, Topic, LearningNode } from '../../models/schemas.js';

export const courses = pgTable(
  'courses',
  {
    courseCode: text('course_code').primaryKey(),
    currentStage: integer('current_stage').notNull().default(1),
    ownerUserId: text('owner_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    data: jsonb('data').$type<Course>().notNull(),
  },
  (t) => ({ byOwner: index('courses_owner_idx').on(t.ownerUserId) })
);

export const clos = pgTable(
  'clos',
  {
    cloId: text('clo_id').primaryKey(),
    courseCode: text('course_code')
      .notNull()
      .references(() => courses.courseCode, { onDelete: 'cascade' }),
    seq: serial('seq'),
    data: jsonb('data').$type<CLO>().notNull(),
  },
  (t) => ({ byCourse: index('clos_course_idx').on(t.courseCode) })
);

export const topics = pgTable(
  'topics',
  {
    topicId: text('topic_id').primaryKey(),
    cloId: text('clo_id')
      .notNull()
      .references(() => clos.cloId, { onDelete: 'cascade' }),
    courseCode: text('course_code').notNull(),
    seq: serial('seq'),
    data: jsonb('data').$type<Topic>().notNull(),
  },
  (t) => ({ byClo: index('topics_clo_idx').on(t.cloId), byCourse: index('topics_course_idx').on(t.courseCode) })
);

export const learningNodes = pgTable(
  'learning_nodes',
  {
    nodeId: text('node_id').primaryKey(),
    cloId: text('clo_id').notNull(),
    topicId: text('topic_id'),
    courseCode: text('course_code').notNull(),
    nodeType: text('node_type'),
    uiX: integer('ui_x'),
    uiY: integer('ui_y'),
    seq: serial('seq'),
    data: jsonb('data').$type<LearningNode>().notNull(),
  },
  (t) => ({
    byClo: index('learning_nodes_clo_idx').on(t.cloId),
    byCourse: index('learning_nodes_course_idx').on(t.courseCode),
  })
);

/** Prerequisite edges among learning nodes (dependent -> prerequisite). */
export const nodePrerequisites = pgTable(
  'node_prerequisites',
  {
    id: serial('id').primaryKey(),
    courseCode: text('course_code').notNull(),
    cloId: text('clo_id').notNull(),
    nodeId: text('node_id').notNull(),
    prereqId: text('prereq_id').notNull(),
  },
  (t) => ({
    uniq: uniqueIndex('node_prereq_uniq').on(t.nodeId, t.prereqId),
    byClo: index('node_prereq_clo_idx').on(t.cloId),
    byCourse: index('node_prereq_course_idx').on(t.courseCode),
  })
);

export const accreditationTags = pgTable('accreditation_tags', {
  tagId: text('tag_id').primaryKey(),
  name: text('name').notNull(),
});

export const courseAccreditationTags = pgTable(
  'course_accreditation_tags',
  {
    courseCode: text('course_code').notNull(),
    tagId: text('tag_id').notNull(),
  },
  (t) => ({ pk: uniqueIndex('course_acc_tag_pk').on(t.courseCode, t.tagId) })
);
