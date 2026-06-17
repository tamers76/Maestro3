/**
 * Generic artifact repository over `stage_artifacts` (JSONB). Replaces the dozens
 * of per-artifact JSON read/write helpers in file.service. Keyed by
 * (courseCode, artifactType, nodeId). nodeId defaults to '' for course-scoped
 * artifacts; per-node artifacts (e.g. Stage 4 node content) pass the node id.
 *
 * These are write-once-read-whole blobs; nothing queries them by inner field.
 */
import { and, eq, sql } from 'drizzle-orm';
import { stageArtifacts } from '../schema/artifacts.js';
import { exec, type Executor } from './_exec.js';

export interface ArtifactKeyOpts {
  stage?: string;
  nodeId?: string;
}

export async function save(courseCode: string, artifactType: string, data: unknown, opts: ArtifactKeyOpts = {}, tx?: Executor): Promise<void> {
  const nodeId = opts.nodeId ?? '';
  await exec(tx)
    .insert(stageArtifacts)
    .values({ courseCode, stage: opts.stage ?? null, artifactType, nodeId, data: data as object, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [stageArtifacts.courseCode, stageArtifacts.artifactType, stageArtifacts.nodeId],
      set: { data: sql`excluded.data`, stage: sql`excluded.stage`, updatedAt: new Date() },
    });
}

export async function get<T = unknown>(courseCode: string, artifactType: string, nodeId = '', tx?: Executor): Promise<T | null> {
  const rows = await exec(tx)
    .select({ data: stageArtifacts.data })
    .from(stageArtifacts)
    .where(and(eq(stageArtifacts.courseCode, courseCode), eq(stageArtifacts.artifactType, artifactType), eq(stageArtifacts.nodeId, nodeId)))
    .limit(1);
  return (rows[0]?.data as T) ?? null;
}

export async function has(courseCode: string, artifactType: string, nodeId = '', tx?: Executor): Promise<boolean> {
  const rows = await exec(tx)
    .select({ n: sql`1` })
    .from(stageArtifacts)
    .where(and(eq(stageArtifacts.courseCode, courseCode), eq(stageArtifacts.artifactType, artifactType), eq(stageArtifacts.nodeId, nodeId)))
    .limit(1);
  return rows.length > 0;
}

export async function remove(courseCode: string, artifactType: string, nodeId = '', tx?: Executor): Promise<void> {
  await exec(tx)
    .delete(stageArtifacts)
    .where(and(eq(stageArtifacts.courseCode, courseCode), eq(stageArtifacts.artifactType, artifactType), eq(stageArtifacts.nodeId, nodeId)));
}

/** List the node ids that have an artifact of `artifactType` for a course (excludes the course-scoped '' key). */
export async function listNodeIds(courseCode: string, artifactType: string, tx?: Executor): Promise<string[]> {
  const rows = await exec(tx)
    .select({ nodeId: stageArtifacts.nodeId })
    .from(stageArtifacts)
    .where(and(eq(stageArtifacts.courseCode, courseCode), eq(stageArtifacts.artifactType, artifactType)));
  return rows.map((r) => r.nodeId).filter((id) => id !== '');
}

/** Fetch all (nodeId -> data) entries of an artifact type for a course. */
export async function getAllByType<T = unknown>(courseCode: string, artifactType: string, tx?: Executor): Promise<Array<{ nodeId: string; data: T }>> {
  const rows = await exec(tx)
    .select({ nodeId: stageArtifacts.nodeId, data: stageArtifacts.data })
    .from(stageArtifacts)
    .where(and(eq(stageArtifacts.courseCode, courseCode), eq(stageArtifacts.artifactType, artifactType)));
  return rows.map((r) => ({ nodeId: r.nodeId, data: r.data as T }));
}

export async function removeByType(courseCode: string, artifactType: string, tx?: Executor): Promise<void> {
  await exec(tx).delete(stageArtifacts).where(and(eq(stageArtifacts.courseCode, courseCode), eq(stageArtifacts.artifactType, artifactType)));
}

/** Delete every artifact for a course (used when a course is deleted). */
export async function removeByCourse(courseCode: string, tx?: Executor): Promise<void> {
  await exec(tx).delete(stageArtifacts).where(eq(stageArtifacts.courseCode, courseCode));
}
