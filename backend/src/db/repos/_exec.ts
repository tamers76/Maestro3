/**
 * Shared executor plumbing for repositories.
 *
 * Every repo method accepts an optional `tx` (a Drizzle transaction handle) so a
 * caller can compose multi-entity writes — an entity + its edges/children + the
 * projection-outbox row — atomically inside one `db.transaction()`. When omitted,
 * methods run against the pooled singleton.
 */
import { getDb, type Database } from '../client.js';

/** A Drizzle transaction handle (same query surface as the db). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Either the pooled db or an in-flight transaction. */
export type Executor = Database | Tx;

/** Resolve the executor: the provided tx, else the pooled singleton. */
export function exec(tx?: Executor): Executor {
  return tx ?? getDb();
}

/** Run `fn` inside a transaction (or reuse an existing one if provided). */
export async function withTx<T>(
  fn: (tx: Executor) => Promise<T>,
  existing?: Executor
): Promise<T> {
  if (existing) return fn(existing);
  return getDb().transaction((tx) => fn(tx));
}
