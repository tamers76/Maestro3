/**
 * Backfill CLI (Issue 2E): re-chunk already-indexed reference documents through
 * the new junk filter and re-index them, so existing courses stop citing
 * page-number / TOC / index noise. Filtering otherwise only affects NEW ingests.
 *
 * Usage:
 *   tsx src/db/rechunkReferences.ts <COURSE_CODE>
 *   tsx src/db/rechunkReferences.ts MDLD602
 *
 * Requires a live DB (the reference store) and the embedding provider (re-chunked
 * passages are re-embedded). It reuses the stored raw extracted text
 * (reference_documents.doc_text). Documents that have no stored raw text cannot be
 * re-chunked and are reported — those PDFs must be re-uploaded.
 *
 * NOTE: re-chunking resets per-chunk scope tags to the document-level scope, so
 * re-run Reference Alignment (Course Architect Layer 7) afterwards for precise
 * subtopic/CLO grounding.
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { existsSync } from 'fs';
import { initPostgres, closePostgres, getPool } from './client.js';
import { ensureSchema } from './bootstrap.js';
import { getPostgresConfig, hydrateSettings } from '../config.js';
import { rechunkCourseReferences } from '../services/referenceIngestion.service.js';

/**
 * Boot the DB exactly like server.ts does at startup so this CLI can run
 * standalone: init the Postgres pool, ensure the schema, and hydrate the
 * (non-secret) settings overlay so the embedding provider config is available.
 * Without this the script throws "Postgres is not initialized" on first repo call.
 */
async function bootDb(): Promise<void> {
  await initPostgres();
  const pool = getPool();
  if (!pool) throw new Error('Postgres pool was not initialized');
  const { schema } = getPostgresConfig();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await ensureSchema(pool);
  await hydrateSettings();
}

async function main(): Promise<void> {
  const envPath = join(process.cwd(), '..', '.env');
  if (existsSync(envPath)) dotenvConfig({ path: envPath });

  const courseCode = process.argv[2];
  if (!courseCode) {
    console.error('[rechunk] Usage: tsx src/db/rechunkReferences.ts <COURSE_CODE>');
    process.exit(1);
  }

  await bootDb();

  console.log(`[rechunk] re-chunking references for course "${courseCode}"...`);
  const result = await rechunkCourseReferences(courseCode);

  console.log('[rechunk] done:');
  console.log(`  documents:        ${result.docs}`);
  console.log(`  re-chunked:       ${result.rechunked}`);
  console.log(`  chunks before:    ${result.chunksBefore}`);
  console.log(`  chunks after:     ${result.chunksAfter}`);
  console.log(`  junk removed:     ${result.junkRemoved}`);
  console.log(`  model/dims:       ${result.model} / ${result.dimensions}`);
  console.log(`  elapsed:          ${result.elapsedMs}ms`);
  if (result.skippedNoText.length > 0) {
    console.warn(
      `[rechunk] ${result.skippedNoText.length} document(s) had NO stored raw text and were SKIPPED ` +
        `(re-upload required): ${result.skippedNoText.join(', ')}`
    );
  }
  console.log(
    '[rechunk] Re-run Reference Alignment (Layer 7) to restore precise subtopic/CLO grounding.'
  );
}

main()
  .then(async () => {
    await closePostgres();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[rechunk] FAILED:', err);
    await closePostgres().catch(() => undefined);
    process.exit(1);
  });
