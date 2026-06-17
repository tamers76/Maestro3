/** Course entity repository (replaces course CRUD formerly in neo4j.service). */
import { desc, eq, sql } from 'drizzle-orm';
import type { Course } from '../../models/schemas.js';
import { courses, clos, topics, learningNodes, nodePrerequisites, courseAccreditationTags } from '../schema/courses.js';
import { referenceDocuments, referenceChunks } from '../schema/references.js';
import { nodeSets, maestroNodes, knowledgeComponents, evidenceCheckRequirements, maestroNodePrerequisites } from '../schema/nodeEngine.js';
import { stageArtifacts, blobFiles } from '../schema/artifacts.js';
import { exec, type Executor } from './_exec.js';

export async function createCourse(course: Course, tx?: Executor): Promise<void> {
  await exec(tx)
    .insert(courses)
    .values({
      courseCode: course.course_code,
      currentStage: course.current_stage,
      data: course,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: courses.courseCode,
      set: { currentStage: course.current_stage, data: course, updatedAt: new Date() },
    });
}

export async function getCourse(courseCode: string, tx?: Executor): Promise<Course | null> {
  const rows = await exec(tx).select({ data: courses.data }).from(courses).where(eq(courses.courseCode, courseCode)).limit(1);
  return rows[0]?.data ?? null;
}

export async function getAllCourses(tx?: Executor): Promise<Course[]> {
  const rows = await exec(tx).select({ data: courses.data }).from(courses).orderBy(desc(courses.createdAt));
  return rows.map((r) => r.data);
}

export async function courseExists(courseCode: string, tx?: Executor): Promise<boolean> {
  const rows = await exec(tx).select({ c: sql`1` }).from(courses).where(eq(courses.courseCode, courseCode)).limit(1);
  return rows.length > 0;
}

export async function updateCourseStage(courseCode: string, stage: number, tx?: Executor): Promise<void> {
  const current = await getCourse(courseCode, tx);
  if (!current) return;
  const updated: Course = { ...current, current_stage: stage as Course['current_stage'], updated_at: new Date().toISOString() };
  await exec(tx).update(courses).set({ currentStage: stage, data: updated, updatedAt: new Date() }).where(eq(courses.courseCode, courseCode));
}

/** Delete a course and ALL its course-scoped rows across every table. */
export async function deleteCourse(courseCode: string, tx?: Executor): Promise<void> {
  const db = exec(tx);
  // node-engine child tables keyed by subtopic/course
  const sets = await db.select({ subtopicId: nodeSets.subtopicId }).from(nodeSets).where(eq(nodeSets.courseCode, courseCode));
  for (const s of sets) {
    await db.delete(maestroNodePrerequisites).where(eq(maestroNodePrerequisites.subtopicId, s.subtopicId));
  }
  await db.delete(maestroNodes).where(eq(maestroNodes.courseCode, courseCode));
  await db.delete(nodeSets).where(eq(nodeSets.courseCode, courseCode));
  // references
  await db.delete(referenceChunks).where(eq(referenceChunks.courseCode, courseCode));
  await db.delete(referenceDocuments).where(eq(referenceDocuments.courseCode, courseCode));
  // curriculum
  await db.delete(nodePrerequisites).where(eq(nodePrerequisites.courseCode, courseCode));
  await db.delete(learningNodes).where(eq(learningNodes.courseCode, courseCode));
  await db.delete(topics).where(eq(topics.courseCode, courseCode));
  await db.delete(clos).where(eq(clos.courseCode, courseCode));
  await db.delete(courseAccreditationTags).where(eq(courseAccreditationTags.courseCode, courseCode));
  // artifacts + blobs
  await db.delete(stageArtifacts).where(eq(stageArtifacts.courseCode, courseCode));
  await db.delete(blobFiles).where(eq(blobFiles.courseCode, courseCode));
  // course last (clos FK cascade already handled, but explicit deletes above keep order safe)
  await db.delete(courses).where(eq(courses.courseCode, courseCode));
}

/**
 * KCs/ECs are keyed by node_id (no course column); clean orphans not referenced by
 * any maestro_node. Call after course/node-set deletions when needed.
 */
export async function pruneOrphanNodeEngineChildren(tx?: Executor): Promise<void> {
  const db = exec(tx);
  await db.execute(sql`DELETE FROM knowledge_components kc WHERE NOT EXISTS (SELECT 1 FROM maestro_nodes mn WHERE mn.node_id = kc.node_id)`);
  await db.execute(sql`DELETE FROM evidence_check_requirements ec WHERE NOT EXISTS (SELECT 1 FROM maestro_nodes mn WHERE mn.node_id = ec.node_id)`);
}
