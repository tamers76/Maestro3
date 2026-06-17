/** Topic repository (replaces Topic CRUD formerly in neo4j.service). */
import { and, eq, sql } from 'drizzle-orm';
import type { Topic } from '../../models/schemas.js';
import { topics, learningNodes, nodePrerequisites } from '../schema/courses.js';
import { exec, type Executor } from './_exec.js';

export async function createTopics(courseCode: string, cloId: string, items: Topic[], tx?: Executor): Promise<void> {
  if (items.length === 0) return;
  await exec(tx)
    .insert(topics)
    .values(
      items.map((t) => ({
        topicId: t.topic_id,
        cloId,
        courseCode,
        data: { ...t, clo_id: cloId },
      }))
    )
    .onConflictDoUpdate({
      target: topics.topicId,
      set: { cloId: sql`excluded.clo_id`, courseCode: sql`excluded.course_code`, data: sql`excluded.data` },
    });
}

export async function getTopics(courseCode: string, tx?: Executor): Promise<Topic[]> {
  const rows = await exec(tx)
    .select({ data: topics.data })
    .from(topics)
    .where(eq(topics.courseCode, courseCode))
    .orderBy(topics.cloId, topics.topicId);
  return rows.map((r) => r.data);
}

export async function getTopicsByClo(cloId: string, tx?: Executor): Promise<Topic[]> {
  const rows = await exec(tx).select({ data: topics.data }).from(topics).where(eq(topics.cloId, cloId)).orderBy(topics.topicId);
  return rows.map((r) => r.data);
}

/** Delete all topics (and their learning nodes) for a course. */
export async function deleteTopics(courseCode: string, tx?: Executor): Promise<void> {
  const db = exec(tx);
  await db.delete(nodePrerequisites).where(eq(nodePrerequisites.courseCode, courseCode));
  await db.delete(learningNodes).where(and(eq(learningNodes.courseCode, courseCode)));
  await db.delete(topics).where(eq(topics.courseCode, courseCode));
}
