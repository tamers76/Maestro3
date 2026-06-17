/**
 * Transactional projection outbox. Rows are appended in the SAME transaction as
 * the entity/edge write; an async worker drains pending rows to the Neo4j
 * projection and marks them done (see neo4j.service rebuild/projection worker).
 */
import { and, eq, sql } from 'drizzle-orm';
import { projectionOutbox } from '../schema/artifacts.js';
import { exec, type Executor } from './_exec.js';

export type ProjectionEntityType = 'course' | 'node_set';
export type ProjectionOp = 'upsert' | 'delete';

/**
 * After this many failed delivery attempts a row is parked as `failed`
 * (dead-letter) so a permanently-failing ("poison") row stops being retried
 * forever and never head-of-line blocks the queue. `failedCount()` surfaces the
 * dead-letter set for ops; `rebuildProjection` is the full-reconcile backstop.
 */
export const MAX_ATTEMPTS = 5;

export interface OutboxRow {
  id: number;
  entityType: string;
  entityKey: string;
  op: string;
  status: string;
  attempts: number;
  lastError: string | null;
}

/** Enqueue a projection event (call within the entity write's transaction). */
export async function enqueue(
  entityType: ProjectionEntityType,
  entityKey: string,
  op: ProjectionOp = 'upsert',
  tx?: Executor
): Promise<void> {
  await exec(tx)
    .insert(projectionOutbox)
    .values({ entityType, entityKey, op, status: 'pending' });
}

/** Claim up to `limit` pending rows (not yet exhausted) for processing. */
export async function claimPending(limit = 50, tx?: Executor): Promise<OutboxRow[]> {
  const rows = await exec(tx)
    .select()
    .from(projectionOutbox)
    .where(
      and(
        eq(projectionOutbox.status, 'pending'),
        sql`${projectionOutbox.attempts} < ${MAX_ATTEMPTS}`
      )
    )
    .orderBy(projectionOutbox.id)
    .limit(limit);
  return rows as OutboxRow[];
}

export async function markDone(id: number, tx?: Executor): Promise<void> {
  await exec(tx).delete(projectionOutbox).where(eq(projectionOutbox.id, id));
}

/**
 * Record a failed delivery: increment attempts and, once the cap is reached, park
 * the row as `failed` (dead-letter) instead of leaving it `pending` to be retried
 * forever. Below the cap it stays `pending` for the next drain cycle.
 */
export async function markFailed(id: number, error: string, tx?: Executor): Promise<void> {
  await exec(tx)
    .update(projectionOutbox)
    .set({
      attempts: sql`${projectionOutbox.attempts} + 1`,
      lastError: error,
      status: sql`CASE WHEN ${projectionOutbox.attempts} + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
    })
    .where(eq(projectionOutbox.id, id));
}

export async function pendingCount(tx?: Executor): Promise<number> {
  const res = await exec(tx)
    .select({ n: sql<number>`count(*)::int` })
    .from(projectionOutbox)
    .where(and(eq(projectionOutbox.status, 'pending')));
  return res[0]?.n ?? 0;
}

/** Count dead-lettered (parked) rows that exhausted their delivery attempts. */
export async function failedCount(tx?: Executor): Promise<number> {
  const res = await exec(tx)
    .select({ n: sql<number>`count(*)::int` })
    .from(projectionOutbox)
    .where(eq(projectionOutbox.status, 'failed'));
  return res[0]?.n ?? 0;
}
