/**
 * Node-engine (M7). `node_sets` (JSONB) is the source of truth for a subtopic's
 * governed node set. On save, the constituent nodes/KCs/ECs/edges are denormalized
 * into the tables below within the same transaction, so the Neo4j projection worker
 * and any SQL queries read from a stable relational shape.
 */
import { pgTable, text, integer, jsonb, timestamp, serial, uniqueIndex, index } from 'drizzle-orm/pg-core';
import type { NodeSet } from '../../models/nodeEngine.js';

export const nodeSets = pgTable(
  'node_sets',
  {
    nodeSetId: text('node_set_id').primaryKey(),
    courseCode: text('course_code').notNull(),
    subtopicId: text('subtopic_id').notNull(),
    status: text('status'),
    data: jsonb('data').$type<NodeSet>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySubtopic: uniqueIndex('node_sets_subtopic_uniq').on(t.courseCode, t.subtopicId),
    byCourse: index('node_sets_course_idx').on(t.courseCode),
  })
);

export const maestroNodes = pgTable(
  'maestro_nodes',
  {
    nodeId: text('node_id').primaryKey(),
    subtopicId: text('subtopic_id').notNull(),
    courseCode: text('course_code').notNull(),
    cloIds: text('clo_ids').array().notNull().default([]),
    nodeType: text('node_type'),
    nodeTitle: text('node_title'),
    knowledgeComponent: text('knowledge_component'),
    order: integer('node_order').notNull().default(0),
    preparesForAssessmentId: text('prepares_for_assessment_id'),
    status: text('status'),
  },
  (t) => ({
    bySubtopic: index('maestro_nodes_subtopic_idx').on(t.subtopicId),
    byCourse: index('maestro_nodes_course_idx').on(t.courseCode),
  })
);

export const knowledgeComponents = pgTable('knowledge_components', {
  nodeId: text('node_id').primaryKey(),
  statement: text('statement'),
  kcIds: text('kc_ids').array().notNull().default([]),
});

export const evidenceCheckRequirements = pgTable('evidence_check_requirements', {
  evidenceCheckId: text('evidence_check_id').primaryKey(),
  nodeId: text('node_id').notNull(),
  preferredEvidenceMode: text('preferred_evidence_mode'),
  mustCaptureSignals: text('must_capture_signals').array().notNull().default([]),
});

export const maestroNodePrerequisites = pgTable(
  'maestro_node_prerequisites',
  {
    id: serial('id').primaryKey(),
    subtopicId: text('subtopic_id').notNull(),
    nodeId: text('node_id').notNull(),
    prereqId: text('prereq_id').notNull(),
  },
  (t) => ({ uniq: uniqueIndex('maestro_node_prereq_uniq').on(t.nodeId, t.prereqId) })
);
