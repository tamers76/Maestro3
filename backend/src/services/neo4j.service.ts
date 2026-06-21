/**
 * Neo4j = SECONDARY graph projection (IDs + relationships only).
 *
 * Postgres is the source of truth. This module keeps ONLY:
 *  - connection lifecycle (optional; entity reads/writes never depend on it)
 *  - edge/ID projection upserts built FROM Postgres (curriculum + M7 node-set)
 *  - rebuildProjection() to fully reconstruct a course's subgraph from Postgres
 *  - a projection worker that drains the transactional `projection_outbox`
 *
 * All entity PROPERTY storage and the old reference vector-index code were removed
 * (entities live in Postgres; RAG vectors live in pgvector).
 */
import neo4j, { Driver, Session } from 'neo4j-driver';
import { getSettings } from '../config.js';
import type { NodeSet } from '../models/nodeEngine.js';
import * as courseRepo from '../db/repos/courseRepo.js';
import * as cloRepo from '../db/repos/cloRepo.js';
import * as topicRepo from '../db/repos/topicRepo.js';
import * as learningNodeRepo from '../db/repos/learningNodeRepo.js';
import * as accreditationRepo from '../db/repos/accreditationRepo.js';
import * as nodeEngineRepo from '../db/repos/nodeEngineRepo.js';
import * as outboxRepo from '../db/repos/outboxRepo.js';

let driver: Driver | null = null;
let lastInitError: string | null = null;

export async function initNeo4j(): Promise<void> {
  const settings = getSettings();
  if (driver) await driver.close();
  lastInitError = null;
  driver = neo4j.driver(settings.neo4j.uri, neo4j.auth.basic(settings.neo4j.user, settings.neo4j.password));
  const session = driver.session();
  try {
    await session.run('RETURN 1');
    console.log('✓ Neo4j connected (graph projection)');
  } catch (err) {
    lastInitError = err instanceof Error ? err.message : String(err);
    try {
      await driver.close();
    } finally {
      driver = null;
    }
    throw err;
  } finally {
    await session.close();
  }
}

export function getNeo4jStatus(): { connected: boolean; last_error: string | null } {
  return { connected: driver !== null, last_error: lastInitError };
}

export function isNeo4jConnected(): boolean {
  return driver !== null;
}

function getSession(): Session {
  if (!driver) throw new Error('Neo4j driver not initialized');
  return driver.session();
}

export async function closeNeo4j(): Promise<void> {
  stopProjectionWorker();
  if (driver) {
    await driver.close();
    driver = null;
  }
}

// ===========================================================================
// Curriculum projection (Course -> CLO -> Topic -> LearningNode + PREREQUIRES)
// ===========================================================================

/** Remove a course's entire projected subgraph (curriculum + tags). */
export async function deleteCourseProjection(courseCode: string): Promise<void> {
  if (!driver) return;
  const session = getSession();
  try {
    await session.run(
      `MATCH (c:Course { course_code: $courseCode })
       OPTIONAL MATCH (c)-[:HAS_CLO]->(clo:CLO)
       OPTIONAL MATCH (clo)-[:HAS_TOPIC]->(t:Topic)
       OPTIONAL MATCH (t)-[:DECOMPOSED_TO]->(ln1:LearningNode)
       OPTIONAL MATCH (clo)-[:DECOMPOSED_TO]->(ln2:LearningNode)
       DETACH DELETE c, clo, t, ln1, ln2`,
      { courseCode }
    );
  } finally {
    await session.close();
  }
}

/** (Re)project a course's curriculum subgraph from Postgres. Best-effort/no-op without a driver. */
export async function projectCourse(courseCode: string): Promise<boolean> {
  if (!driver) return false;
  const course = await courseRepo.getCourse(courseCode);
  if (!course) {
    await deleteCourseProjection(courseCode);
    return true;
  }
  const [clos, topics, nodes, tags] = await Promise.all([
    cloRepo.getCLOs(courseCode),
    topicRepo.getTopics(courseCode),
    learningNodeRepo.getLearningNodes(courseCode),
    accreditationRepo.getAccreditationTags(courseCode),
  ]);

  const session = getSession();
  try {
    await deleteCourseProjection(courseCode);
    await session.run(`MERGE (c:Course { course_code: $courseCode }) SET c.title = $title`, {
      courseCode,
      title: course.title ?? courseCode,
    });
    if (clos.length > 0) {
      await session.run(
        `UNWIND $clos AS clo
         MATCH (c:Course { course_code: $courseCode })
         MERGE (n:CLO { clo_id: clo.clo_id })
         SET n.course_code = $courseCode, n.clo_text = clo.clo_text
         MERGE (c)-[:HAS_CLO]->(n)`,
        { courseCode, clos: clos.map((c) => ({ clo_id: c.clo_id, clo_text: c.clo_text ?? '' })) }
      );
    }
    if (topics.length > 0) {
      await session.run(
        `UNWIND $topics AS t
         MATCH (clo:CLO { clo_id: t.clo_id })
         MERGE (n:Topic { topic_id: t.topic_id })
         SET n.clo_id = t.clo_id, n.title = t.title
         MERGE (clo)-[:HAS_TOPIC]->(n)`,
        { topics: topics.map((t) => ({ topic_id: t.topic_id, clo_id: t.clo_id, title: t.title ?? '' })) }
      );
    }
    if (nodes.length > 0) {
      await session.run(
        `UNWIND $nodes AS ln
         MERGE (n:LearningNode { node_id: ln.node_id })
         SET n.clo_id = ln.clo_id, n.topic_id = ln.topic_id, n.node_type = ln.node_type,
             n.learning_intent = ln.learning_intent
         WITH n, ln
         CALL {
           WITH n, ln
           WITH n, ln WHERE ln.topic_id <> ''
           MATCH (t:Topic { topic_id: ln.topic_id })
           MERGE (t)-[:DECOMPOSED_TO]->(n)
         }
         WITH n, ln
         CALL {
           WITH n, ln
           WITH n, ln WHERE ln.topic_id = ''
           MATCH (clo:CLO { clo_id: ln.clo_id })
           MERGE (clo)-[:DECOMPOSED_TO]->(n)
         }
         RETURN count(*)`,
        {
          nodes: nodes.map((n) => ({
            node_id: n.node_id,
            clo_id: n.clo_id,
            topic_id: n.topic_id ?? '',
            node_type: String(n.node_type),
            learning_intent: n.learning_intent ?? '',
          })),
        }
      );
      const edges: { node_id: string; prereq_id: string }[] = [];
      for (const n of nodes) for (const p of n.prerequisite_nodes ?? []) edges.push({ node_id: n.node_id, prereq_id: p });
      if (edges.length > 0) {
        await session.run(
          `UNWIND $edges AS e
           MATCH (a:LearningNode { node_id: e.node_id })
           MATCH (b:LearningNode { node_id: e.prereq_id })
           MERGE (a)-[:PREREQUIRES]->(b)`,
          { edges }
        );
      }
    }
    if (tags.length > 0) {
      await session.run(
        `UNWIND $tags AS tag
         MATCH (c:Course { course_code: $courseCode })
         MERGE (t:AccreditationTag { tag_id: tag.tag_id }) SET t.name = tag.name
         MERGE (c)-[:SATISFIES]->(t)`,
        { courseCode, tags: tags.map((name) => ({ tag_id: name.toLowerCase().replace(/\s+/g, '-'), name })) }
      );
    }
    return true;
  } finally {
    await session.close();
  }
}

// ===========================================================================
// M7 node-set projection (MaestroNode / KnowledgeComponent / EvidenceCheck)
// ===========================================================================

export async function deleteNodeSetGraph(subtopicId: string): Promise<void> {
  if (!driver) return;
  const session = getSession();
  try {
    await session.run(
      `MATCH (n:MaestroNode { subtopic_id: $subtopicId })
       OPTIONAL MATCH (n)-[:HAS_KC]->(kc:KnowledgeComponent)
       OPTIONAL MATCH (n)-[:HAS_PRIMARY_EVIDENCE_CHECK]->(ec:EvidenceCheckRequirement)
       DETACH DELETE n, kc, ec`,
      { subtopicId }
    );
  } finally {
    await session.close();
  }
}

/** Project one governed node-set as the M7 subgraph. Best-effort/no-op without a driver. */
export async function persistNodeSetGraph(nodeSet: NodeSet): Promise<boolean> {
  if (!driver) return false;
  await deleteNodeSetGraph(nodeSet.subtopic_id);
  const session = getSession();
  try {
    for (const node of nodeSet.nodes) {
      await session.run(
        `MERGE (n:MaestroNode { node_id: $node_id })
         SET n.subtopic_id = $subtopic_id, n.course_id = $course_id, n.clo_ids = $clo_ids,
             n.node_type = $node_type, n.node_title = $node_title,
             n.knowledge_component = $knowledge_component, n.order = $order,
             n.prepares_for_assessment_id = $prepares_for_assessment_id, n.status = $status
         MERGE (kc:KnowledgeComponent { node_id: $node_id })
         SET kc.statement = $knowledge_component, kc.kc_ids = $kc_ids
         MERGE (n)-[:HAS_KC]->(kc)
         MERGE (ec:EvidenceCheckRequirement { evidence_check_id: $evidence_check_id })
         SET ec.node_id = $node_id, ec.preferred_evidence_mode = $preferred_evidence_mode,
             ec.must_capture_signals = $must_capture_signals
         MERGE (n)-[:HAS_PRIMARY_EVIDENCE_CHECK]->(ec)`,
        {
          node_id: node.node_id,
          subtopic_id: node.parent_subtopic_id,
          course_id: node.course_id ?? nodeSet.course_id,
          clo_ids: node.clo_ids,
          node_type: node.node_type,
          node_title: node.node_title,
          knowledge_component: node.knowledge_component,
          order: neo4j.int(node.order),
          prepares_for_assessment_id: node.prepares_for_assessment_id ?? null,
          status: node.status,
          kc_ids: node.kc_ids,
          evidence_check_id: node.primary_evidence_check_requirement.evidence_check_id,
          preferred_evidence_mode: node.primary_evidence_check_requirement.preferred_evidence_mode,
          must_capture_signals: node.primary_evidence_check_requirement.must_capture_signals,
        }
      );
    }
    for (const node of nodeSet.nodes) {
      for (const prereq of node.prerequisite_node_ids) {
        await session.run(
          `MATCH (n:MaestroNode { node_id: $node_id })
           MATCH (p:MaestroNode { node_id: $prereq_id })
           MERGE (n)-[:PREREQUISITE_OF]->(p)`,
          { node_id: node.node_id, prereq_id: prereq }
        );
      }
    }
    return true;
  } finally {
    await session.close();
  }
}

// ===========================================================================
// Rebuild + projection worker (drains the transactional outbox)
// ===========================================================================

/** Fully reconstruct a course's projection (curriculum + all its node-sets) from Postgres. */
export async function rebuildProjection(courseCode: string): Promise<void> {
  if (!driver) return;
  await projectCourse(courseCode);
  const sets = await nodeEngineRepo.listNodeSets(courseCode);
  for (const set of sets) await persistNodeSetGraph(set);
}

async function processOutboxRow(row: outboxRepo.OutboxRow): Promise<void> {
  if (row.entityType === 'course') {
    if (row.op === 'delete') await deleteCourseProjection(row.entityKey);
    else await projectCourse(row.entityKey);
    return;
  }
  if (row.entityType === 'node_set') {
    const [courseCode, subtopicId] = row.entityKey.split(':');
    if (row.op === 'delete') {
      await deleteNodeSetGraph(subtopicId);
    } else {
      const set = await nodeEngineRepo.getNodeSet(courseCode, subtopicId);
      if (set) await persistNodeSetGraph(set);
      else await deleteNodeSetGraph(subtopicId);
    }
  }
}

let workerTimer: NodeJS.Timeout | null = null;
let draining = false;

/** Drain pending outbox rows once. Safe to call repeatedly; no-op without a driver. */
export async function drainProjectionOutbox(): Promise<void> {
  if (!driver || draining) return;
  draining = true;
  try {
    const rows = await outboxRepo.claimPending(50);
    for (const row of rows) {
      try {
        await processOutboxRow(row);
        await outboxRepo.markDone(row.id);
      } catch (err) {
        await outboxRepo.markFailed(row.id, err instanceof Error ? err.message : String(err));
      }
    }
  } finally {
    draining = false;
  }
}

export function startProjectionWorker(intervalMs = 5000): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void drainProjectionOutbox();
  }, intervalMs);
  // Don't keep the process alive solely for the worker.
  if (typeof workerTimer.unref === 'function') workerTimer.unref();
}

export function stopProjectionWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
