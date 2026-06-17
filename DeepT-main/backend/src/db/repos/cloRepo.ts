/** CLO repository (replaces CLO CRUD formerly in neo4j.service). */
import { eq, sql } from 'drizzle-orm';
import type { CLO } from '../../models/schemas.js';
import { clos, topics, learningNodes, nodePrerequisites } from '../schema/courses.js';
import { exec, type Executor } from './_exec.js';

export async function createCLOs(courseCode: string, items: CLO[], tx?: Executor): Promise<void> {
  if (items.length === 0) return;
  await exec(tx)
    .insert(clos)
    .values(items.map((clo) => ({ cloId: clo.clo_id, courseCode, data: clo })))
    .onConflictDoUpdate({
      target: clos.cloId,
      set: { courseCode: sql`excluded.course_code`, data: sql`excluded.data` },
    });
}

export async function getCLOs(courseCode: string, tx?: Executor): Promise<CLO[]> {
  const rows = await exec(tx).select({ data: clos.data }).from(clos).where(eq(clos.courseCode, courseCode)).orderBy(clos.cloId);
  return rows.map((r) => r.data);
}

export async function deleteCLOs(courseCode: string, tx?: Executor): Promise<void> {
  const db = exec(tx);
  await db.delete(nodePrerequisites).where(eq(nodePrerequisites.courseCode, courseCode));
  await db.delete(learningNodes).where(eq(learningNodes.courseCode, courseCode));
  await db.delete(topics).where(eq(topics.courseCode, courseCode));
  await db.delete(clos).where(eq(clos.courseCode, courseCode));
}
