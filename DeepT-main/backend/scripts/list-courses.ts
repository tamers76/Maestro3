import { config } from 'dotenv';
import { join } from 'path';
import { sql } from 'drizzle-orm';
import { initPostgres, getDb, closePostgres } from '../src/db/client.js';
import * as store from '../src/services/curriculumStore.service.js';

config({ path: join(process.cwd(), '..', '.env') });

async function main(): Promise<void> {
  await initPostgres();
  const courses = await store.getAllCourses();
  console.log('course_count:', courses.length);
  for (const c of courses) {
    console.log(`- ${c.course_code} | ${c.title} | stage ${c.current_stage}`);
  }
  const db = getDb();
  const art = await db.execute(sql`SELECT course_code, count(*)::int AS n FROM stage_artifacts GROUP BY course_code ORDER BY course_code`);
  console.log('artifacts_by_course:', art.rows);
  const refs = await db.execute(sql`SELECT course_code, count(*)::int AS n FROM reference_documents GROUP BY course_code ORDER BY course_code`);
  console.log('references_by_course:', refs.rows);
  const sets = await db.execute(sql`SELECT course_code, count(*)::int AS n FROM node_sets GROUP BY course_code ORDER BY course_code`);
  console.log('node_sets_by_course:', sets.rows);
  await closePostgres();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
