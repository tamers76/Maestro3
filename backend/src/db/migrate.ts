/**
 * Apply the Postgres schema (idempotent) and optionally build the vector index.
 *
 * Usage:
 *   tsx src/db/migrate.ts            -> ensure schema (tables + GIN indexes)
 *   tsx src/db/migrate.ts --vector   -> also build the HNSW index (post-load)
 *   tsx src/db/migrate.ts --verify   -> ensure schema, then print verification
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { existsSync } from 'fs';
import pg from 'pg';
import { getPostgresConfig } from '../config.js';
import { initPostgres, closePostgres, getPool } from './client.js';
import { ensureSchema, buildVectorIndex, hasVectorIndex } from './bootstrap.js';
import { seedUsers } from './seedUsers.js';

async function verify(pool: pg.Pool, schema: string): Promise<void> {
  const ext = await pool.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
    [schema]
  );
  const indexes = await pool.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`,
    [schema]
  );
  console.log('[migrate] pgvector version:', ext.rows[0]?.extversion ?? 'NOT INSTALLED');
  console.log('[migrate] tables:', tables.rows.map((r) => r.table_name).join(', '));
  console.log('[migrate] HNSW vector index present:', await hasVectorIndex(pool));
  console.log('[migrate] index count:', indexes.rowCount);
}

async function main(): Promise<void> {
  const envPath = join(process.cwd(), '..', '.env');
  if (existsSync(envPath)) dotenvConfig({ path: envPath });

  const { schema } = getPostgresConfig();
  await initPostgres();
  const pool = getPool()!;
  try {
    console.log(`[migrate] target schema: ${schema}`);
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    console.log('[migrate] ensuring schema...');
    await ensureSchema(pool);
    console.log('[migrate] schema ensured.');

    console.log('[migrate] seeding users...');
    await seedUsers();
    console.log('[migrate] user seeding complete.');

    if (process.argv.includes('--vector')) {
      console.log('[migrate] building HNSW vector index (post-load)...');
      await buildVectorIndex(pool);
      console.log('[migrate] vector index ready.');
    }
    if (process.argv.includes('--verify')) {
      await verify(pool, schema);
    }
  } finally {
    await closePostgres();
  }
}

main().catch((err) => {
  console.error('[migrate] FAILED:', err);
  process.exit(1);
});
