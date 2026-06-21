/**
 * Audit log entity (Postgres source of truth).
 *
 * A single append-only table that records high-value actions across the platform
 * (user management, course-access grants, course create/delete, academic
 * approvals, review requests, and configuration changes). The Admin Center Audit
 * page reads this table with filters by actor, course, entity, action, and date.
 *
 * Audit rows NEVER store secrets (API keys, passwords, connection strings); the
 * `metadata` JSON carries only non-sensitive context (e.g. which fields changed).
 */
import { pgTable, text, jsonb, timestamp, index, serial } from 'drizzle-orm/pg-core';

export const auditEvents = pgTable(
  'audit_events',
  {
    id: serial('id').primaryKey(),
    // Who performed the action (snapshotted so the log stays readable even if the
    // user is later renamed or removed).
    actorUserId: text('actor_user_id'),
    actorEmail: text('actor_email').notNull().default(''),
    actorName: text('actor_name').notNull().default(''),
    actorRole: text('actor_role').notNull().default(''),
    // What happened: a stable action key (e.g. 'user.create') + a coarse category.
    action: text('action').notNull(),
    category: text('category').notNull().default(''),
    // What it happened to.
    entityType: text('entity_type').notNull().default(''),
    entityId: text('entity_id').notNull().default(''),
    courseCode: text('course_code').notNull().default(''),
    targetUserId: text('target_user_id').notNull().default(''),
    // Free-form non-sensitive context + outcome.
    status: text('status').notNull().default('success'),
    summary: text('summary').notNull().default(''),
    metadata: jsonb('metadata'),
    method: text('method').notNull().default(''),
    path: text('path').notNull().default(''),
    ip: text('ip').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byActor: index('audit_events_actor_idx').on(t.actorUserId),
    byCourse: index('audit_events_course_idx').on(t.courseCode),
    byEntity: index('audit_events_entity_idx').on(t.entityType, t.entityId),
    byAction: index('audit_events_action_idx').on(t.action),
    byCreatedAt: index('audit_events_created_at_idx').on(t.createdAt),
  })
);
