/**
 * Postgres connection + Drizzle client (primary source-of-truth DB).
 *
 * The app REQUIRES Postgres. `initPostgres()` creates a pooled connection and a
 * Drizzle instance; `getDb()` returns it (throwing if not initialized). Tests can
 * inject an alternate Drizzle instance (e.g. PGlite) via `setDb()` so they run
 * without a live server.
 */

import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getPostgresConfig } from '../config.js';
import * as schema from './schema/index.js';

const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

let pool: pg.Pool | null = null;
let db: Database | null = null;
let lastInitError: string | null = null;

/**
 * Initialize the Postgres pool + Drizzle client and verify connectivity.
 * Throws on failure (callers decide whether that is fatal).
 */
export async function initPostgres(): Promise<void> {
  if (db) return;
  lastInitError = null;
  const { connectionString, max, options } = getPostgresConfig();
  pool = new Pool({ connectionString, max, options });
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  } catch (err) {
    lastInitError = err instanceof Error ? err.message : String(err);
    await pool.end().catch(() => undefined);
    pool = null;
    throw err;
  }
  db = drizzle(pool, { schema });
}

/** Returns the Drizzle DB, throwing if Postgres has not been initialized. */
export function getDb(): Database {
  if (!db) {
    throw new Error(
      'Postgres is not initialized. Call initPostgres() during startup (or setDb() in tests).'
    );
  }
  return db;
}

/** Test seam: inject a Drizzle instance (e.g. PGlite-backed) without a live pool. */
export function setDb(instance: Database): void {
  db = instance;
}

export function getPool(): pg.Pool | null {
  return pool;
}

export function isPostgresConnected(): boolean {
  return db !== null;
}

export function getPostgresStatus(): { connected: boolean; last_error: string | null } {
  return { connected: db !== null, last_error: lastInitError };
}

export async function closePostgres(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => undefined);
    pool = null;
  }
  db = null;
}
