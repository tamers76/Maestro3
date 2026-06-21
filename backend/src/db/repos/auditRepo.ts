/**
 * Audit-event repository (append-only).
 *
 * `createAuditEvent` records a single high-value action; `listAuditEvents`
 * powers the Admin Center Audit page with filters by actor, course, entity,
 * action/category, and date range plus a free-text search over the human-readable
 * fields. Mirrors the other repos: every method accepts an optional executor.
 */
import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { auditEvents } from '../schema/audit.js';
import { exec, type Executor } from './_exec.js';

export interface AuditEventInput {
  actorUserId?: string | null;
  actorEmail?: string;
  actorName?: string;
  actorRole?: string;
  action: string;
  category?: string;
  entityType?: string;
  entityId?: string;
  courseCode?: string;
  targetUserId?: string;
  status?: string;
  summary?: string;
  metadata?: unknown;
  method?: string;
  path?: string;
  ip?: string;
}

export interface AuditEventRecord {
  id: number;
  actor_user_id: string | null;
  actor_email: string;
  actor_name: string;
  actor_role: string;
  action: string;
  category: string;
  entity_type: string;
  entity_id: string;
  course_code: string;
  target_user_id: string;
  status: string;
  summary: string;
  metadata: unknown;
  method: string;
  path: string;
  ip: string;
  created_at: string;
}

function toRecord(row: typeof auditEvents.$inferSelect): AuditEventRecord {
  return {
    id: row.id,
    actor_user_id: row.actorUserId ?? null,
    actor_email: row.actorEmail,
    actor_name: row.actorName,
    actor_role: row.actorRole,
    action: row.action,
    category: row.category,
    entity_type: row.entityType,
    entity_id: row.entityId,
    course_code: row.courseCode,
    target_user_id: row.targetUserId,
    status: row.status,
    summary: row.summary,
    metadata: row.metadata ?? null,
    method: row.method,
    path: row.path,
    ip: row.ip,
    created_at: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  };
}

export async function createAuditEvent(input: AuditEventInput, tx?: Executor): Promise<void> {
  await exec(tx)
    .insert(auditEvents)
    .values({
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? '',
      actorName: input.actorName ?? '',
      actorRole: input.actorRole ?? '',
      action: input.action,
      category: input.category ?? '',
      entityType: input.entityType ?? '',
      entityId: input.entityId ?? '',
      courseCode: input.courseCode ?? '',
      targetUserId: input.targetUserId ?? '',
      status: input.status ?? 'success',
      summary: input.summary ?? '',
      metadata: (input.metadata ?? null) as object | null,
      method: input.method ?? '',
      path: input.path ?? '',
      ip: input.ip ?? '',
    });
}

export interface AuditEventFilters {
  actorUserId?: string;
  courseCode?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  category?: string;
  status?: string;
  /** ISO date (inclusive lower bound) on created_at. */
  from?: string;
  /** ISO date (inclusive upper bound) on created_at. */
  to?: string;
  /** Free-text match across summary/action/actor/entity/course. */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AuditEventPage {
  events: AuditEventRecord[];
  total: number;
  limit: number;
  offset: number;
}

function buildWhere(filters: AuditEventFilters) {
  const clauses = [] as ReturnType<typeof eq>[];
  if (filters.actorUserId) clauses.push(eq(auditEvents.actorUserId, filters.actorUserId));
  if (filters.courseCode) clauses.push(eq(auditEvents.courseCode, filters.courseCode));
  if (filters.entityType) clauses.push(eq(auditEvents.entityType, filters.entityType));
  if (filters.entityId) clauses.push(eq(auditEvents.entityId, filters.entityId));
  if (filters.action) clauses.push(eq(auditEvents.action, filters.action));
  if (filters.category) clauses.push(eq(auditEvents.category, filters.category));
  if (filters.status) clauses.push(eq(auditEvents.status, filters.status));
  if (filters.from) clauses.push(gte(auditEvents.createdAt, new Date(filters.from)));
  if (filters.to) clauses.push(lte(auditEvents.createdAt, new Date(filters.to)));
  if (filters.search && filters.search.trim()) {
    const term = `%${filters.search.trim()}%`;
    const match = or(
      ilike(auditEvents.summary, term),
      ilike(auditEvents.action, term),
      ilike(auditEvents.actorEmail, term),
      ilike(auditEvents.actorName, term),
      ilike(auditEvents.entityId, term),
      ilike(auditEvents.courseCode, term)
    );
    if (match) clauses.push(match as unknown as ReturnType<typeof eq>);
  }
  return clauses.length > 0 ? and(...clauses) : undefined;
}

export async function listAuditEvents(
  filters: AuditEventFilters = {},
  tx?: Executor
): Promise<AuditEventPage> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const where = buildWhere(filters);

  const rows = await exec(tx)
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit)
    .offset(offset);

  const countRows = await exec(tx)
    .select({ c: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(where);

  return {
    events: rows.map(toRecord),
    total: countRows[0]?.c ?? 0,
    limit,
    offset,
  };
}

/** Distinct values to populate Audit page filter dropdowns. */
export async function listAuditFacets(tx?: Executor): Promise<{
  actions: string[];
  categories: string[];
  entityTypes: string[];
}> {
  const e = exec(tx);
  const [actions, categories, entityTypes] = await Promise.all([
    e.selectDistinct({ v: auditEvents.action }).from(auditEvents).orderBy(auditEvents.action),
    e.selectDistinct({ v: auditEvents.category }).from(auditEvents).orderBy(auditEvents.category),
    e.selectDistinct({ v: auditEvents.entityType }).from(auditEvents).orderBy(auditEvents.entityType),
  ]);
  return {
    actions: actions.map((r) => r.v).filter(Boolean),
    categories: categories.map((r) => r.v).filter(Boolean),
    entityTypes: entityTypes.map((r) => r.v).filter(Boolean),
  };
}
