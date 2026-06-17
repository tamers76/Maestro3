/**
 * Curriculum entity store (Postgres-backed) — the facade the stage services and
 * routes call instead of the old Neo4j entity API. Writes persist to Postgres via
 * repos AND enqueue a `projection_outbox` row in the SAME transaction so the
 * async worker keeps the Neo4j graph projection in sync. Reads (incl. getGraphData)
 * come straight from Postgres, so they never depend on Neo4j being up.
 *
 * Method names + signatures intentionally mirror the former neo4j.service entity
 * API to keep call sites unchanged (only their import path moves here).
 */
import { eq } from 'drizzle-orm';
import type {
  Course,
  CLO,
  LearningNode,
  LearningNodeUpsert,
  Topic,
  GraphData,
  GraphNode,
  GraphEdge,
} from '../models/schemas.js';
import { getDb } from '../db/client.js';
import { clos as closTable } from '../db/schema/courses.js';
import * as courseRepo from '../db/repos/courseRepo.js';
import * as cloRepo from '../db/repos/cloRepo.js';
import * as topicRepo from '../db/repos/topicRepo.js';
import * as learningNodeRepo from '../db/repos/learningNodeRepo.js';
import * as accreditationRepo from '../db/repos/accreditationRepo.js';
import * as outboxRepo from '../db/repos/outboxRepo.js';
import { withTx, type Executor } from '../db/repos/_exec.js';

async function courseForClo(cloId: string, db: Executor): Promise<string> {
  const rows = await db.select({ courseCode: closTable.courseCode }).from(closTable).where(eq(closTable.cloId, cloId)).limit(1);
  return rows[0]?.courseCode ?? '';
}

// ===== Course =====

export async function createCourse(course: Course): Promise<void> {
  await withTx(async (tx) => {
    await courseRepo.createCourse(course, tx);
    await outboxRepo.enqueue('course', course.course_code, 'upsert', tx);
  });
}

export async function getCourse(courseCode: string): Promise<Course | null> {
  return courseRepo.getCourse(courseCode);
}

export async function getAllCourses(): Promise<Course[]> {
  return courseRepo.getAllCourses();
}

export async function updateCourseStage(courseCode: string, stage: number): Promise<void> {
  await withTx(async (tx) => {
    await courseRepo.updateCourseStage(courseCode, stage, tx);
    await outboxRepo.enqueue('course', courseCode, 'upsert', tx);
  });
}

export async function deleteCourse(courseCode: string): Promise<void> {
  await withTx(async (tx) => {
    await courseRepo.deleteCourse(courseCode, tx);
    await outboxRepo.enqueue('course', courseCode, 'delete', tx);
  });
}

export async function courseExists(courseCode: string): Promise<boolean> {
  return courseRepo.courseExists(courseCode);
}

// ===== CLOs =====

export async function createCLOs(courseCode: string, items: CLO[]): Promise<void> {
  await withTx(async (tx) => {
    await cloRepo.createCLOs(courseCode, items, tx);
    await outboxRepo.enqueue('course', courseCode, 'upsert', tx);
  });
}

export async function getCLOs(courseCode: string): Promise<CLO[]> {
  return cloRepo.getCLOs(courseCode);
}

export async function deleteCLOs(courseCode: string): Promise<void> {
  await withTx(async (tx) => {
    await cloRepo.deleteCLOs(courseCode, tx);
    await outboxRepo.enqueue('course', courseCode, 'upsert', tx);
  });
}

// ===== Topics =====

export async function createTopics(cloId: string, topics: Topic[]): Promise<void> {
  await withTx(async (tx) => {
    const courseCode = await courseForClo(cloId, tx);
    await topicRepo.createTopics(courseCode, cloId, topics, tx);
    await outboxRepo.enqueue('course', courseCode, 'upsert', tx);
  });
}

export async function getTopics(courseCode: string): Promise<Topic[]> {
  return topicRepo.getTopics(courseCode);
}

export async function deleteTopics(courseCode: string): Promise<void> {
  await withTx(async (tx) => {
    await topicRepo.deleteTopics(courseCode, tx);
    await outboxRepo.enqueue('course', courseCode, 'upsert', tx);
  });
}

// ===== Learning nodes =====

export async function createLearningNodes(nodes: LearningNode[]): Promise<void> {
  if (nodes.length === 0) return;
  await withTx(async (tx) => {
    const courseCode = await courseForClo(nodes[0].clo_id, tx);
    await learningNodeRepo.createLearningNodes(nodes, courseCode, tx);
    await outboxRepo.enqueue('course', courseCode, 'upsert', tx);
  });
}

export async function getLearningNodes(courseCode: string): Promise<LearningNode[]> {
  return learningNodeRepo.getLearningNodes(courseCode);
}

export async function getLearningNodesByClo(cloId: string): Promise<LearningNode[]> {
  return learningNodeRepo.getLearningNodesByClo(cloId);
}

export async function updateLearningNode(nodeId: string, updates: Partial<LearningNode>): Promise<void> {
  await withTx(async (tx) => {
    await learningNodeRepo.updateLearningNode(nodeId, updates, tx);
    const courseCode = await courseForClo((await learningNodeCloId(nodeId, tx)) ?? '', tx);
    if (courseCode) await outboxRepo.enqueue('course', courseCode, 'upsert', tx);
  });
}

export async function deleteLearningNodes(courseCode: string): Promise<void> {
  await withTx(async (tx) => {
    await learningNodeRepo.deleteLearningNodes(courseCode, tx);
    await outboxRepo.enqueue('course', courseCode, 'upsert', tx);
  });
}

export async function createSingleLearningNode(
  cloId: string,
  nodeData: LearningNodeUpsert,
  generatedNodeId?: string
): Promise<string> {
  let nodeId = '';
  await withTx(async (tx) => {
    const courseCode = await courseForClo(cloId, tx);
    nodeId = await learningNodeRepo.createSingleLearningNode(cloId, nodeData, generatedNodeId, tx);
    await outboxRepo.enqueue('course', courseCode, 'upsert', tx);
  });
  return nodeId;
}

export async function deleteSingleLearningNode(nodeId: string): Promise<void> {
  await withTx(async (tx) => {
    // Resolve the course BEFORE the delete (the clo link is gone afterwards).
    const courseCode = await courseForClo((await learningNodeCloId(nodeId, tx)) ?? '', tx);
    await learningNodeRepo.deleteSingleLearningNode(nodeId, tx);
    if (courseCode) await outboxRepo.enqueue('course', courseCode, 'upsert', tx);
  });
}

export async function upsertCloNodes(
  cloId: string,
  upserts: LearningNodeUpsert[],
  deletes: string[]
): Promise<{ created: Record<string, string>; deleted: string[] }> {
  return withTx(async (tx) => {
    const courseCode = await courseForClo(cloId, tx);
    const result = await learningNodeRepo.upsertCloNodes(cloId, upserts, deletes, tx);
    await outboxRepo.enqueue('course', courseCode, 'upsert', tx);
    return result;
  });
}

export async function replaceCloPrerequisites(
  cloId: string,
  edges: Array<{ source_node_id: string; target_node_id: string }>
): Promise<void> {
  await withTx(async (tx) => {
    const courseCode = await courseForClo(cloId, tx);
    await learningNodeRepo.replaceCloPrerequisites(cloId, edges, tx);
    await outboxRepo.enqueue('course', courseCode, 'upsert', tx);
  });
}

export async function getNodeCountsByClo(courseCode: string): Promise<Record<string, number>> {
  return learningNodeRepo.getNodeCountsByClo(courseCode);
}

// ===== Accreditation =====

export async function createAccreditationTags(courseCode: string, tags: string[]): Promise<void> {
  await withTx(async (tx) => {
    await accreditationRepo.createAccreditationTags(courseCode, tags, tx);
    await outboxRepo.enqueue('course', courseCode, 'upsert', tx);
  });
}

async function learningNodeCloId(nodeId: string, db: Executor): Promise<string | null> {
  const { learningNodes } = await import('../db/schema/courses.js');
  const rows = await db.select({ cloId: learningNodes.cloId }).from(learningNodes).where(eq(learningNodes.nodeId, nodeId)).limit(1);
  return rows[0]?.cloId ?? null;
}

// ===========================================================================
// Graph visualization data (built FROM Postgres; identical shape to before)
// ===========================================================================

export async function getGraphData(courseCode: string): Promise<GraphData> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const course = await courseRepo.getCourse(courseCode);
  if (course) {
    nodes.push({ id: `course-${courseCode}`, type: 'course', label: course.title, data: course as unknown as Record<string, unknown> });
  }

  const clos = await cloRepo.getCLOs(courseCode);
  for (const clo of clos) {
    nodes.push({ id: `clo-${clo.clo_id}`, type: 'clo', label: (clo.clo_text ?? '').substring(0, 50) + '...', data: clo as unknown as Record<string, unknown> });
    edges.push({ id: `edge-course-${clo.clo_id}`, source: `course-${courseCode}`, target: `clo-${clo.clo_id}`, type: 'HAS_CLO' });
  }

  const topics = await topicRepo.getTopics(courseCode);
  const topicIdSet = new Set<string>();
  for (const t of topics) {
    const topicGraphId = `topic-${t.topic_id}`;
    if (topicIdSet.has(topicGraphId)) continue;
    topicIdSet.add(topicGraphId);
    nodes.push({
      id: topicGraphId,
      type: 'topic',
      label: t.title ? (t.title.length > 50 ? t.title.substring(0, 50) + '...' : t.title) : t.topic_id,
      data: t as unknown as Record<string, unknown>,
    });
    edges.push({ id: `edge-clo-topic-${t.topic_id}`, source: `clo-${t.clo_id}`, target: topicGraphId, type: 'HAS_TOPIC' });
  }

  const lnNodes = await learningNodeRepo.getLearningNodes(courseCode);
  const addedLnIds = new Set<string>();
  for (const ln of lnNodes) {
    const lnGraphId = `ln-${ln.node_id}`;
    if (addedLnIds.has(lnGraphId)) continue;
    addedLnIds.add(lnGraphId);
    nodes.push({
      id: lnGraphId,
      type: 'learning_node',
      label: (ln.learning_intent ?? '').substring(0, 40) + '...',
      data: ln as unknown as Record<string, unknown>,
    });
    if (ln.topic_id) {
      edges.push({ id: `edge-topic-${ln.node_id}`, source: `topic-${ln.topic_id}`, target: lnGraphId, type: 'DECOMPOSED_TO' });
    } else {
      edges.push({ id: `edge-clo-${ln.node_id}`, source: `clo-${ln.clo_id}`, target: lnGraphId, type: 'DECOMPOSED_TO' });
    }
    for (const prereqId of ln.prerequisite_nodes ?? []) {
      edges.push({ id: `edge-prereq-${ln.node_id}-${prereqId}`, source: lnGraphId, target: `ln-${prereqId}`, type: 'PREREQUIRES' });
    }
  }

  return { nodes, edges };
}

// ===========================================================================
// DAG validation (pure, in-memory) — unchanged from the prior implementation
// ===========================================================================

export async function validateCloEdgesDAG(
  _cloId: string,
  edges: Array<{ source_node_id: string; target_node_id: string }>
): Promise<{ valid: boolean; cycle?: string[] }> {
  const adj = new Map<string, string[]>();
  const allNodes = new Set<string>();
  for (const edge of edges) {
    allNodes.add(edge.source_node_id);
    allNodes.add(edge.target_node_id);
    if (!adj.has(edge.source_node_id)) adj.set(edge.source_node_id, []);
    adj.get(edge.source_node_id)!.push(edge.target_node_id);
  }
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];
  function hasCycle(node: string): boolean {
    visited.add(node);
    recStack.add(node);
    path.push(node);
    for (const neighbor of adj.get(node) || []) {
      if (!visited.has(neighbor)) {
        if (hasCycle(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        path.push(neighbor);
        return true;
      }
    }
    recStack.delete(node);
    path.pop();
    return false;
  }
  for (const node of allNodes) {
    if (!visited.has(node)) {
      if (hasCycle(node)) return { valid: false, cycle: [...path] };
    }
  }
  return { valid: true };
}
