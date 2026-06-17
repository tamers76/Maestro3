/** Accreditation tag repository (replaces tag CRUD formerly in neo4j.service). */
import { eq, sql } from 'drizzle-orm';
import { accreditationTags, courseAccreditationTags } from '../schema/courses.js';
import { exec, type Executor } from './_exec.js';

export async function createAccreditationTags(courseCode: string, tags: string[], tx?: Executor): Promise<void> {
  if (tags.length === 0) return;
  const db = exec(tx);
  for (const name of tags) {
    const tagId = name.toLowerCase().replace(/\s+/g, '-');
    await db
      .insert(accreditationTags)
      .values({ tagId, name })
      .onConflictDoUpdate({ target: accreditationTags.tagId, set: { name: sql`excluded.name` } });
    await db
      .insert(courseAccreditationTags)
      .values({ courseCode, tagId })
      .onConflictDoNothing();
  }
}

export async function getAccreditationTags(courseCode: string, tx?: Executor): Promise<string[]> {
  const rows = await exec(tx)
    .select({ name: accreditationTags.name })
    .from(courseAccreditationTags)
    .innerJoin(accreditationTags, eq(courseAccreditationTags.tagId, accreditationTags.tagId))
    .where(eq(courseAccreditationTags.courseCode, courseCode));
  return rows.map((r) => r.name);
}
