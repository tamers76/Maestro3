/**
 * Ephemeral-Postgres test harness (behind the RUN_DB_TESTS env flag).
 *
 * DB-dependent tests gate on `dbTestsEnabled` so the pure-function suite stays
 * DB-free in plain `npm test`. When RUN_DB_TESTS=1, `setupTestDb()` connects to a
 * DISPOSABLE schema in the configured Postgres (separate from the app's
 * maestro_v1 schema), ensures the full DDL + HNSW index, and injects that Drizzle
 * instance via setDb() so every repository runs against it. `resetTestData()`
 * truncates all tables for per-test isolation; `teardownTestDb()` drops the schema.
 *
 * Run DB tests with, e.g.:
 *   RUN_DB_TESTS=1 APP_DB_SCHEMA=maestro_test npm test
 */
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getPostgresConfig } from '../config.js';
import { ensureSchema, buildVectorIndex } from './bootstrap.js';
import { setDb } from './client.js';
import * as schema from './schema/index.js';

export const dbTestsEnabled = process.env.RUN_DB_TESTS === '1';

// node:test runs each test FILE in its own process concurrently. A shared schema
// name would make their setupTestDb()/ensureSchema() calls race on type creation
// (duplicate pg_type), so each process gets its own disposable schema (by pid).
const SCHEMA_BASE = (process.env.APP_DB_SCHEMA || 'maestro_test').replace(/[^a-zA-Z0-9_]/g, '');
const TEST_SCHEMA = `${SCHEMA_BASE}_${process.pid}`;

let pool: pg.Pool | null = null;

/** Connect to the disposable test schema, ensure DDL + vector index, inject db. */
export async function setupTestDb(): Promise<void> {
  if (pool) return;
  const { connectionString, max } = getPostgresConfig();
  pool = new pg.Pool({ connectionString, max, options: `-c search_path=${TEST_SCHEMA},public` });
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA}`);
  await ensureSchema(pool);
  await buildVectorIndex(pool);
  setDb(drizzle(pool, { schema }));
}

/** Truncate every table in the test schema so each test starts clean. */
export async function resetTestData(): Promise<void> {
  if (!pool) return;
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
    [TEST_SCHEMA]
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${TEST_SCHEMA}"."${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

/** Drop the disposable schema and close the pool. */
export async function teardownTestDb(): Promise<void> {
  if (!pool) return;
  await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await pool.end();
  pool = null;
}
