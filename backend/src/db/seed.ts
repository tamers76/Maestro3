/**
 * Seed admin + dev user accounts without re-running schema migration.
 *
 * Usage: tsx src/db/seed.ts
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { existsSync } from 'fs';
import { getPostgresConfig } from '../config.js';
import { initPostgres, closePostgres, getPool } from './client.js';
import { ensureSchema } from './bootstrap.js';
import { seedUsers } from './seedUsers.js';

async function main(): Promise<void> {
  const envPath = join(process.cwd(), '..', '.env');
  if (existsSync(envPath)) dotenvConfig({ path: envPath });

  const { schema } = getPostgresConfig();
  await initPostgres();
  const pool = getPool()!;
  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await ensureSchema(pool);
    console.log('[seed] seeding users...');
    await seedUsers();
    console.log('[seed] user seeding complete.');
  } finally {
    await closePostgres();
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', err);
  process.exit(1);
});
