/**
 * Learning-node repository. Stores the full node in `data` JSONB and maintains
 * the `node_prerequisites` edge rows (the authoritative source projected to Neo4j
 * and validated as a DAG). On read, `prerequisite_nodes` is reconstructed from the
 * edge table so edits via replaceCloPrerequisites/upsert stay consistent.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { LearningNode, LearningNodeUpsert } from '../../models/schemas.js';
import { clos, learningNodes, nodePrerequisites } from '../schema/courses.js';
import { exec, withTx, type Executor } from './_exec.js';

async function courseForClo(cloId: string, db: Executor): Promise<string> {
  const rows = await db.select({ courseCode: clos.courseCode }).from(clos).where(eq(clos.cloId, cloId)).limit(1);
  return rows[0]?.courseCode ?? '';
}

function fullNode(partial: Partial<LearningNode> & { node_id: string; clo_id: string }): LearningNode {
  const mandatory = partial.mandatory ?? true;
  const skippable = partial.skippable ?? false;
  return {
    node_id: partial.node_id,
    clo_id: partial.clo_id,
    topic_id: partial.topic_id ?? '',
    topic_title: partial.topic_title ?? '',
    node_type: partial.node_type ?? 'concept',
    learning_intent: partial.learning_intent ?? '',
    prerequisite_nodes: partial.prerequisite_nodes ?? [],
    risk_level: partial.risk_level ?? 'medium',
    mandatory,
    skippable,
    required_status: partial.required_status ?? (mandatory ? 'mandatory' : 'optional'),
    skipping_eligibility: partial.skipping_eligibility ?? (skippable ? 'skippable' : 'non_skippable'),
    skip_conditions: partial.skip_conditions ?? '',
    failure_meaning: partial.failure_meaning ?? '',
    diagnostic_intent: partial.diagnostic_intent ?? '',
    stage3_logic_json: partial.stage3_logic_json,
    stage3_preknowledge_eligible: partial.stage3_preknowledge_eligible,
    stage3_gate_strictness: partial.stage3_gate_strictness,
    content_path: partial.content_path,
    ui_x: partial.ui_x,
    ui_y: partial.ui_y,
  };
}

async function insertNodeRow(node: LearningNode, courseCode: string, db: Executor): Promise<void> {
  await db
    .insert(learningNodes)
    .values({
      nodeId: node.node_id,
      cloId: node.clo_id,
      topicId: node.topic_id || null,
      courseCode,
      nodeType: String(node.node_type),
      uiX: node.ui_x ?? null,
      uiY: node.ui_y ?? null,
      data: node,
    })
    .onConflictDoUpdate({
      target: learningNodes.nodeId,
      set: {
        cloId: sql`excluded.clo_id`,
        topicId: sql`excluded.topic_id`,
        courseCode: sql`excluded.course_code`,
        nodeType: sql`excluded.node_type`,
        uiX: sql`excluded.ui_x`,
        uiY: sql`excluded.ui_y`,
        data: sql`excluded.data`,
      },
    });
}

async function setPrereqs(nodeId: string, cloId: string, courseCode: string, prereqIds: string[], db: Executor): Promise<void> {
  await db.delete(nodePrerequisites).where(eq(nodePrerequisites.nodeId, nodeId));
  if (prereqIds.length === 0) return;
  await db
    .insert(nodePrerequisites)
    .values(prereqIds.map((prereqId) => ({ courseCode, cloId, nodeId, prereqId })))
    .onConflictDoNothing();
}

/** Bulk create nodes + their prerequisite edges (Stage 2). */
export async function createLearningNodes(nodes: LearningNode[], courseCode?: string, tx?: Executor): Promise<void> {
  if (nodes.length === 0) return;
  await withTx(async (db) => {
    for (const node of nodes) {
      const cc = courseCode || (await courseForClo(node.clo_id, db));
      await insertNodeRow(node, cc, db);
    }
    for (const node of nodes) {
      const cc = courseCode || (await courseForClo(node.clo_id, db));
      await setPrereqs(node.node_id, node.clo_id, cc, node.prerequisite_nodes ?? [], db);
    }
  }, tx);
}

async function attachPrereqs(rows: { data: LearningNode }[], db: Executor): Promise<LearningNode[]> {
  const ids = rows.map((r) => r.data.node_id);
  if (ids.length === 0) return [];
  const edges = await db
    .select({ nodeId: nodePrerequisites.nodeId, prereqId: nodePrerequisites.prereqId })
    .from(nodePrerequisites)
    .where(inArray(nodePrerequisites.nodeId, ids));
  const byNode = new Map<string, string[]>();
  for (const e of edges) {
    if (!byNode.has(e.nodeId)) byNode.set(e.nodeId, []);
    byNode.get(e.nodeId)!.push(e.prereqId);
  }
  return rows.map((r) => ({ ...r.data, prerequisite_nodes: byNode.get(r.data.node_id) ?? [] }));
}

export async function getLearningNodes(courseCode: string, tx?: Executor): Promise<LearningNode[]> {
  const db = exec(tx);
  const rows = await db
    .select({ data: learningNodes.data })
    .from(learningNodes)
    .where(eq(learningNodes.courseCode, courseCode))
    .orderBy(learningNodes.cloId, learningNodes.topicId, learningNodes.nodeId);
  return attachPrereqs(rows, db);
}

export async function getLearningNodesByClo(cloId: string, tx?: Executor): Promise<LearningNode[]> {
  const db = exec(tx);
  const rows = await db
    .select({ data: learningNodes.data })
    .from(learningNodes)
    .where(eq(learningNodes.cloId, cloId))
    .orderBy(learningNodes.topicId, learningNodes.nodeId);
  return attachPrereqs(rows, db);
}

export async function updateLearningNode(nodeId: string, updates: Partial<LearningNode>, tx?: Executor): Promise<void> {
  await withTx(async (db) => {
    const rows = await db.select({ data: learningNodes.data }).from(learningNodes).where(eq(learningNodes.nodeId, nodeId)).limit(1);
    const current = rows[0]?.data;
    if (!current) return;
    const merged: LearningNode = { ...current, ...updates };
    await db
      .update(learningNodes)
      .set({
        data: merged,
        nodeType: String(merged.node_type),
        topicId: merged.topic_id || null,
        uiX: merged.ui_x ?? null,
        uiY: merged.ui_y ?? null,
      })
      .where(eq(learningNodes.nodeId, nodeId));
    if (updates.prerequisite_nodes) {
      await setPrereqs(nodeId, merged.clo_id, merged.clo_id ? await courseForClo(merged.clo_id, db) : '', updates.prerequisite_nodes, db);
    }
  }, tx);
}

export async function deleteLearningNodes(courseCode: string, tx?: Executor): Promise<void> {
  const db = exec(tx);
  await db.delete(nodePrerequisites).where(eq(nodePrerequisites.courseCode, courseCode));
  await db.delete(learningNodes).where(eq(learningNodes.courseCode, courseCode));
}

export async function createSingleLearningNode(
  cloId: string,
  nodeData: LearningNodeUpsert,
  generatedNodeId?: string,
  tx?: Executor
): Promise<string> {
  const nodeId = nodeData.node_id || generatedNodeId || `${cloId}-N${Date.now()}`;
  await withTx(async (db) => {
    const courseCode = await courseForClo(cloId, db);
    const node = fullNode({
      node_id: nodeId,
      clo_id: cloId,
      topic_id: nodeData.topic_id ?? '',
      node_type: nodeData.node_type,
      learning_intent: nodeData.learning_intent,
      risk_level: nodeData.risk_level,
      failure_meaning: nodeData.failure_meaning ?? '',
      diagnostic_intent: nodeData.diagnostic_intent ?? '',
      ui_x: nodeData.ui_x,
      ui_y: nodeData.ui_y,
    });
    await insertNodeRow(node, courseCode, db);
  }, tx);
  return nodeId;
}

export async function deleteSingleLearningNode(nodeId: string, tx?: Executor): Promise<void> {
  const db = exec(tx);
  await db.delete(nodePrerequisites).where(eq(nodePrerequisites.nodeId, nodeId));
  await db.delete(nodePrerequisites).where(eq(nodePrerequisites.prereqId, nodeId));
  await db.delete(learningNodes).where(eq(learningNodes.nodeId, nodeId));
}

export async function upsertCloNodes(
  cloId: string,
  upserts: LearningNodeUpsert[],
  deletes: string[],
  tx?: Executor
): Promise<{ created: Record<string, string>; deleted: string[] }> {
  const created: Record<string, string> = {};
  await withTx(async (db) => {
    const courseCode = await courseForClo(cloId, db);
    for (const nodeId of deletes) {
      await db.delete(nodePrerequisites).where(eq(nodePrerequisites.nodeId, nodeId));
      await db.delete(nodePrerequisites).where(eq(nodePrerequisites.prereqId, nodeId));
      await db.delete(learningNodes).where(and(eq(learningNodes.nodeId, nodeId), eq(learningNodes.cloId, cloId)));
    }
    for (let i = 0; i < upserts.length; i++) {
      const nodeData = upserts[i];
      if (nodeData.node_id) {
        const rows = await db.select({ data: learningNodes.data }).from(learningNodes).where(and(eq(learningNodes.nodeId, nodeData.node_id), eq(learningNodes.cloId, cloId))).limit(1);
        const current = rows[0]?.data;
        if (!current) continue;
        const merged: LearningNode = {
          ...current,
          node_type: nodeData.node_type,
          learning_intent: nodeData.learning_intent,
          risk_level: nodeData.risk_level,
          failure_meaning: nodeData.failure_meaning ?? current.failure_meaning,
          diagnostic_intent: nodeData.diagnostic_intent ?? current.diagnostic_intent,
          ui_x: nodeData.ui_x ?? current.ui_x,
          ui_y: nodeData.ui_y ?? current.ui_y,
        };
        await insertNodeRow(merged, courseCode, db);
      } else {
        const generatedId = `${cloId}-N${Date.now()}-${i}`;
        const node = fullNode({
          node_id: generatedId,
          clo_id: cloId,
          topic_id: nodeData.topic_id ?? '',
          node_type: nodeData.node_type,
          learning_intent: nodeData.learning_intent,
          risk_level: nodeData.risk_level,
          failure_meaning: nodeData.failure_meaning ?? '',
          diagnostic_intent: nodeData.diagnostic_intent ?? '',
          ui_x: nodeData.ui_x,
          ui_y: nodeData.ui_y,
        });
        await insertNodeRow(node, courseCode, db);
        created[`temp-${i}`] = generatedId;
      }
    }
  }, tx);
  return { created, deleted: deletes };
}

/** Replace all PREREQUISITE edges among a CLO's nodes. */
export async function replaceCloPrerequisites(
  cloId: string,
  edges: Array<{ source_node_id: string; target_node_id: string }>,
  tx?: Executor
): Promise<void> {
  await withTx(async (db) => {
    const courseCode = await courseForClo(cloId, db);
    await db.delete(nodePrerequisites).where(eq(nodePrerequisites.cloId, cloId));
    if (edges.length > 0) {
      await db
        .insert(nodePrerequisites)
        .values(edges.map((e) => ({ courseCode, cloId, nodeId: e.source_node_id, prereqId: e.target_node_id })))
        .onConflictDoNothing();
    }
  }, tx);
}

export async function getNodeCountsByClo(courseCode: string, tx?: Executor): Promise<Record<string, number>> {
  const rows = await exec(tx)
    .select({ cloId: learningNodes.cloId, n: sql<number>`count(*)::int` })
    .from(learningNodes)
    .where(eq(learningNodes.courseCode, courseCode))
    .groupBy(learningNodes.cloId);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.cloId] = r.n;
  return counts;
}
