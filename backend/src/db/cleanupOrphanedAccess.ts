/**
 * One-off cleanup CLI: purge orphaned course-access rows left behind by courses
 * that were deleted before delete-time cleanup existed.
 *
 * Historically, deleting a course removed the `courses` row but NOT the related
 * access rows (`course_review_assignments`, `course_review_requests`,
 * `course_student_assignments`), because those tables store `course_code` as
 * plain text with no FK cascade. As a result, reviewers/students could still
 * "see" a course that no longer exists. Delete now cleans these up going forward;
 * this script removes the stale rows that already exist.
 *
 * Safe to run repeatedly (idempotent): it only deletes rows whose `course_code`
 * has no matching row in `courses`.
 *
 * Usage:
 *   tsx src/db/cleanupOrphanedAccess.ts            # delete orphaned rows
 *   tsx src/db/cleanupOrphanedAccess.ts --dry-run  # report only, delete nothing
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { existsSync } from 'fs';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { initPostgres, closePostgres, getPool, getDb } from './client.js';
import { ensureSchema } from './bootstrap.js';
import { getPostgresConfig } from '../config.js';
import { courses } from './schema/courses.js';
import {
  courseReviewAssignments,
  courseReviewRequests,
  courseStudentAssignments,
} from './schema/auth.js';

async function bootDb(): Promise<void> {
  await initPostgres();
  const pool = getPool();
  if (!pool) throw new Error('Postgres pool was not initialized');
  const { schema } = getPostgresConfig();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await ensureSchema(pool);
}

/** Predicate: course_code has no matching row in `courses`. */
const isOrphaned = (courseCodeCol: AnyPgColumn) =>
  sql`${courseCodeCol} NOT IN (SELECT ${courses.courseCode} FROM ${courses})`;

async function main(): Promise<void> {
  const envPath = join(process.cwd(), '..', '.env');
  if (existsSync(envPath)) dotenvConfig({ path: envPath });

  const dryRun = process.argv.includes('--dry-run');

  await bootDb();
  const db = getDb();

  if (dryRun) {
    const [reqs, assigns, students] = await Promise.all([
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(courseReviewRequests)
        .where(isOrphaned(courseReviewRequests.courseCode)),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(courseReviewAssignments)
        .where(isOrphaned(courseReviewAssignments.courseCode)),
      db
        .select({ c: sql<number>`count(*)::int` })
        .from(courseStudentAssignments)
        .where(isOrphaned(courseStudentAssignments.courseCode)),
    ]);
    console.log('[cleanup] DRY RUN — no rows will be deleted. Orphaned rows found:');
    console.log(`  course_review_requests:    ${reqs[0]?.c ?? 0}`);
    console.log(`  course_review_assignments: ${assigns[0]?.c ?? 0}`);
    console.log(`  course_student_assignments:${students[0]?.c ?? 0}`);
    return;
  }

  const deletedRequests = await db
    .delete(courseReviewRequests)
    .where(isOrphaned(courseReviewRequests.courseCode))
    .returning({ courseCode: courseReviewRequests.courseCode });
  const deletedAssignments = await db
    .delete(courseReviewAssignments)
    .where(isOrphaned(courseReviewAssignments.courseCode))
    .returning({ courseCode: courseReviewAssignments.courseCode });
  const deletedStudents = await db
    .delete(courseStudentAssignments)
    .where(isOrphaned(courseStudentAssignments.courseCode))
    .returning({ courseCode: courseStudentAssignments.courseCode });

  console.log('[cleanup] done. Orphaned rows deleted:');
  console.log(`  course_review_requests:    ${deletedRequests.length}`);
  console.log(`  course_review_assignments: ${deletedAssignments.length}`);
  console.log(`  course_student_assignments:${deletedStudents.length}`);
}

main()
  .then(async () => {
    await closePostgres();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[cleanup] FAILED:', err);
    await closePostgres().catch(() => undefined);
    process.exit(1);
  });
