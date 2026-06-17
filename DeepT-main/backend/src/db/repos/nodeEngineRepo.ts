/**
 * Node-engine (M7) repository. `node_sets` JSONB is the source of truth; on save
 * the constituent nodes/KCs/ECs/prereq edges are denormalized into relational
 * tables within ONE transaction, and a projection-outbox row is enqueued so the
 * async worker (re)builds the Neo4j subgraph for the subtopic.
 */
import { and, eq } from 'drizzle-orm';
import type { NodeSet } from '../../models/nodeEngine.js';
import { nodeSets, maestroNodes, knowledgeComponents, evidenceCheckRequirements, maestroNodePrerequisites } from '../schema/nodeEngine.js';
import { exec, withTx, type Executor } from './_exec.js';
import * as outboxRepo from './outboxRepo.js';

function outboxKey(courseCode: string, subtopicId: string): string {
  return `${courseCode}:${subtopicId}`;
}

async function clearDenormalized(subtopicId: string, db: Executor): Promise<void> {
  const nodes = await db.select({ nodeId: maestroNodes.nodeId }).from(maestroNodes).where(eq(maestroNodes.subtopicId, subtopicId));
  for (const n of nodes) {
    await db.delete(knowledgeComponents).where(eq(knowledgeComponents.nodeId, n.nodeId));
    await db.delete(evidenceCheckRequirements).where(eq(evidenceCheckRequirements.nodeId, n.nodeId));
  }
  await db.delete(maestroNodePrerequisites).where(eq(maestroNodePrerequisites.subtopicId, subtopicId));
  await db.delete(maestroNodes).where(eq(maestroNodes.subtopicId, subtopicId));
}

export async function saveNodeSet(nodeSet: NodeSet, tx?: Executor): Promise<void> {
  await withTx(async (db) => {
    const courseCode = nodeSet.course_id;
    await db
      .insert(nodeSets)
      .values({ nodeSetId: nodeSet.node_set_id, courseCode, subtopicId: nodeSet.subtopic_id, status: nodeSet.status, data: nodeSet, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [nodeSets.courseCode, nodeSets.subtopicId],
        set: { nodeSetId: nodeSet.node_set_id, status: nodeSet.status, data: nodeSet, updatedAt: new Date() },
      });

    await clearDenormalized(nodeSet.subtopic_id, db);

    for (const node of nodeSet.nodes) {
      await db.insert(maestroNodes).values({
        nodeId: node.node_id,
        subtopicId: node.parent_subtopic_id,
        courseCode: node.course_id ?? courseCode,
        cloIds: node.clo_ids ?? [],
        nodeType: node.node_type,
        nodeTitle: node.node_title,
        knowledgeComponent: node.knowledge_component,
        order: node.order ?? 0,
        preparesForAssessmentId: node.prepares_for_assessment_id ?? null,
        status: node.status,
      });
      await db.insert(knowledgeComponents).values({ nodeId: node.node_id, statement: node.knowledge_component, kcIds: node.kc_ids ?? [] });
      const ec = node.primary_evidence_check_requirement;
      await db.insert(evidenceCheckRequirements).values({
        evidenceCheckId: ec.evidence_check_id,
        nodeId: node.node_id,
        preferredEvidenceMode: ec.preferred_evidence_mode,
        mustCaptureSignals: ec.must_capture_signals ?? [],
      });
    }

    for (const node of nodeSet.nodes) {
      for (const prereq of node.prerequisite_node_ids ?? []) {
        await db.insert(maestroNodePrerequisites).values({ subtopicId: node.parent_subtopic_id, nodeId: node.node_id, prereqId: prereq }).onConflictDoNothing();
      }
    }

    await outboxRepo.enqueue('node_set', outboxKey(courseCode, nodeSet.subtopic_id), 'upsert', db);
  }, tx);
}

export async function getNodeSet(courseCode: string, subtopicId: string, tx?: Executor): Promise<NodeSet | null> {
  const rows = await exec(tx)
    .select({ data: nodeSets.data })
    .from(nodeSets)
    .where(and(eq(nodeSets.courseCode, courseCode), eq(nodeSets.subtopicId, subtopicId)))
    .limit(1);
  return rows[0]?.data ?? null;
}

export async function getNodeSetById(nodeSetId: string, tx?: Executor): Promise<NodeSet | null> {
  const rows = await exec(tx).select({ data: nodeSets.data }).from(nodeSets).where(eq(nodeSets.nodeSetId, nodeSetId)).limit(1);
  return rows[0]?.data ?? null;
}

export async function listNodeSets(courseCode: string, tx?: Executor): Promise<NodeSet[]> {
  const rows = await exec(tx).select({ data: nodeSets.data }).from(nodeSets).where(eq(nodeSets.courseCode, courseCode));
  return rows.map((r) => r.data);
}

export async function deleteNodeSet(courseCode: string, subtopicId: string, tx?: Executor): Promise<void> {
  await withTx(async (db) => {
    await clearDenormalized(subtopicId, db);
    await db.delete(nodeSets).where(and(eq(nodeSets.courseCode, courseCode), eq(nodeSets.subtopicId, subtopicId)));
    await outboxRepo.enqueue('node_set', outboxKey(courseCode, subtopicId), 'delete', db);
  }, tx);
}
