/**
 * SME prose editing + single-node regenerate for M7 node-sets.
 * Governed/structured fields stay system-owned; prose edits re-open review.
 */
import type { CandidateMisconception, Citation, Node, NodeSet } from '../models/nodeEngine.js';
import { parseNodeSet } from '../models/nodeEngine.js';
import { buildV1ContractBundle } from './stage1Adapter.service.js';
import {
  buildNodeGenerationContext,
  buildDefaultExecutor,
  getNodeSet,
} from './nodeGeneration.service.js';
import { saveNodeSetArtifact } from './store.service.js';
import { deriveNodeReviewTriage } from './nodeReviewTriage.service.js';
import { buildGroundedContextWithFallback } from '../services/referenceRetrieval.service.js';
import { judgeNodeGroundingPassages } from '../services/referenceJudgment.service.js';
import { parseAIJson } from '../services/ai.service.js';
import type { AIMessage } from '../services/council.service.js';

export const EDITED_REOPEN_REASON = 'Edited — re-confirm';

export class NodeEditConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeEditConflictError';
  }
}

export interface NodeProsePatch {
  knowledge_component?: string;
  mastery_statement?: string;
  why_it_matters?: string;
  assessment_connection?: string;
  candidate_misconceptions?: Array<{
    candidate_misconception_id: string;
    statement?: string;
    reason?: string;
    suggested_trap?: string;
  }>;
}

const PROSE_KEYS = [
  'knowledge_component',
  'mastery_statement',
  'why_it_matters',
  'assessment_connection',
] as const;

function syncNodeSetApprovalStatus(nodeSet: NodeSet): void {
  const allApproved = nodeSet.nodes.every((n) => n.status === 'approved');
  nodeSet.status = allApproved ? 'approved' : 'needs_review';
  nodeSet.updated_at = new Date().toISOString();
}

export function markNodeReopenedAfterEdit(node: Node): void {
  const priorReasons = (node.review_reasons ?? []).filter((r) => r !== EDITED_REOPEN_REASON);
  node.sme_edited = true;
  node.sme_edited_at = new Date().toISOString();
  node.status = 'needs_revision';
  node.review_priority = 'must_review';
  node.review_reasons = [EDITED_REOPEN_REASON, ...priorReasons];
}

function applyCandidateProsePatches(node: Node, patches: NodeProsePatch['candidate_misconceptions']): boolean {
  if (!patches?.length) return false;
  let changed = false;
  const byId = new Map(patches.map((p) => [p.candidate_misconception_id, p]));
  node.candidate_misconceptions = node.candidate_misconceptions.map((c) => {
    const patch = byId.get(c.candidate_misconception_id);
    if (!patch) return c;
    const next: CandidateMisconception = { ...c };
    if (typeof patch.statement === 'string' && patch.statement !== c.statement) {
      next.statement = patch.statement;
      changed = true;
    }
    if (typeof patch.reason === 'string' && patch.reason !== c.reason) {
      next.reason = patch.reason;
      changed = true;
    }
    if (typeof patch.suggested_trap === 'string' && patch.suggested_trap !== (c.suggested_trap ?? '')) {
      next.suggested_trap = patch.suggested_trap;
      changed = true;
    }
    return next;
  });
  return changed;
}

function proseChanged(node: Node, patch: NodeProsePatch): boolean {
  for (const key of PROSE_KEYS) {
    const value = patch[key];
    if (typeof value === 'string' && value !== node[key]) return true;
  }
  if (!patch.candidate_misconceptions?.length) return false;
  const byId = new Map(patch.candidate_misconceptions.map((p) => [p.candidate_misconception_id, p]));
  for (const c of node.candidate_misconceptions) {
    const item = byId.get(c.candidate_misconception_id);
    if (!item) continue;
    if (typeof item.statement === 'string' && item.statement !== c.statement) return true;
    if (typeof item.reason === 'string' && item.reason !== c.reason) return true;
    if (typeof item.suggested_trap === 'string' && item.suggested_trap !== (c.suggested_trap ?? '')) return true;
  }
  return false;
}

function refreshGroundingSummary(nodeSet: NodeSet): void {
  const citations = new Set<string>();
  for (const n of nodeSet.nodes) {
    for (const ref of n.grounding_references) citations.add(ref.citation);
  }
  const existing = nodeSet.grounding_summary;
  const source = existing?.grounding_source ?? 'model_only';
  nodeSet.grounding_summary = {
    retrieval_called: existing?.retrieval_called ?? true,
    scoped_chunk_count: existing?.scoped_chunk_count ?? 0,
    course_level_chunk_count: existing?.course_level_chunk_count ?? 0,
    citations_count: citations.size,
    grounding_source: source,
    grounding_note: existing?.grounding_note ?? 'Grounding summary refreshed after node update.',
    academic_ready: citations.size > 0 && source !== 'model_only',
  };
}

async function regroundSingleNode(
  courseCode: string,
  subtopicId: string,
  node: Node,
  groundWithJudgment: boolean
): Promise<void> {
  const bundle = await buildV1ContractBundle(courseCode);
  const context = buildNodeGenerationContext(bundle, subtopicId);
  const cloId = context.subtopic.clo_ids[0];
  const subtopicContext = `${context.subtopic.title}. ${context.subtopic.expected_learning}`;

  const grounded = await buildGroundedContextWithFallback(courseCode, node.knowledge_component, {
    scope: { cloId, subtopicId: context.subtopic.subtopic_id },
  });

  const passageInputs = grounded.passages.map((p) => ({
    citation: p.citation,
    text_preview: p.text.length > 280 ? `${p.text.slice(0, 280)}…` : p.text,
  }));

  let teaches = grounded.passages.length > 0;
  let citations: Citation[] = grounded.passages.map((p) => ({
    citation: p.citation,
    passage_ref: p.citation,
  }));

  if (groundWithJudgment && passageInputs.length > 0) {
    const judgment = await judgeNodeGroundingPassages(
      node.knowledge_component,
      subtopicContext,
      passageInputs
    );
    teaches = judgment.teaches;
    const supported = judgment.supporting_indices
      .filter((i) => i >= 0 && i < grounded.passages.length)
      .map((i) => grounded.passages[i]);
    citations =
      supported.length > 0
        ? supported.map((p) => ({ citation: p.citation, passage_ref: p.citation }))
        : [];
  }

  node.grounding_references = citations;
  const scopedAndSubstantive =
    grounded.source === 'scoped_references' && grounded.quality_pass_count > 0;
  node.grounding_strength = scopedAndSubstantive && teaches ? 'strong' : 'weak';
}

function applyTriageToNode(
  node: Node,
  nodeSet: NodeSet,
  context: ReturnType<typeof buildNodeGenerationContext>
): void {
  const assessmentsById = new Map(
    context.connected_assessments.map((a) => [a.assessment_id, a] as const)
  );
  const triage = deriveNodeReviewTriage(node, {
    groundingSource: nodeSet.grounding_summary?.grounding_source,
    assessmentsById,
  });
  if (!node.sme_edited) {
    node.review_priority = triage.review_priority;
    node.review_reasons = triage.review_reasons;
  } else {
    const prior = triage.review_reasons.filter((r) => r !== EDITED_REOPEN_REASON);
    node.review_priority = 'must_review';
    node.review_reasons = [EDITED_REOPEN_REASON, ...prior];
  }
}

/** Apply SME prose edits; re-open review when content changes. */
export async function updateNodeProse(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  patch: NodeProsePatch
): Promise<NodeSet> {
  const existing = await getNodeSet(courseCode, subtopicId);
  if (!existing) {
    throw new Error(`No node-set found for course "${courseCode}" subtopic "${subtopicId}"`);
  }
  const node = existing.nodes.find((n: Node) => n.node_id === nodeId);
  if (!node) {
    throw new Error(`Node "${nodeId}" not found in node-set for "${subtopicId}"`);
  }

  if (!proseChanged(node, patch)) {
    return existing;
  }

  for (const key of PROSE_KEYS) {
    const value = patch[key];
    if (typeof value === 'string') node[key] = value;
  }
  applyCandidateProsePatches(node, patch.candidate_misconceptions);
  markNodeReopenedAfterEdit(node);
  syncNodeSetApprovalStatus(existing);

  const validated = parseNodeSet(JSON.parse(JSON.stringify(existing)));
  await saveNodeSetArtifact(courseCode, subtopicId, validated);
  return validated;
}

/** Revoke approval on a node-set so the SME can re-review (e.g. after CLO reopen). */
export async function reopenNodeSet(courseCode: string, subtopicId: string): Promise<NodeSet> {
  const existing = await getNodeSet(courseCode, subtopicId);
  if (!existing) {
    throw new Error(`No node-set found for course "${courseCode}" subtopic "${subtopicId}"`);
  }
  for (const node of existing.nodes) {
    if (node.status === 'approved') node.status = 'needs_revision';
  }
  existing.status = 'needs_review';
  existing.updated_at = new Date().toISOString();

  const validated = parseNodeSet(JSON.parse(JSON.stringify(existing)));
  await saveNodeSetArtifact(courseCode, subtopicId, validated);
  return validated;
}

interface RegeneratedNodeProse {
  knowledge_component?: string;
  mastery_statement?: string;
  why_it_matters?: string;
  assessment_connection?: string;
  core_academic_message?: string;
  candidate_misconceptions?: Array<{
    candidate_misconception_id?: string;
    statement?: string;
    reason?: string;
    suggested_trap?: string;
  }>;
}

function buildRegenerateMessages(context: ReturnType<typeof buildNodeGenerationContext>, node: Node): AIMessage[] {
  const siblingSummary = context.subtopic.possible_node_families?.length
    ? `Node families hint: ${context.subtopic.possible_node_families.join(', ')}`
    : '';
  return [
    {
      role: 'system',
      content:
        'You regenerate ONE mastery node\'s prose for an approved subtopic. Return JSON only. ' +
        'Preserve the node\'s pedagogical role. Do NOT change node_type, order, evidence checks, or severities. ' +
        'Return: {"knowledge_component","mastery_statement","why_it_matters","assessment_connection","core_academic_message","candidate_misconceptions":[{candidate_misconception_id,statement,reason,suggested_trap}]}.',
    },
    {
      role: 'user',
      content: [
        `Subtopic: ${context.subtopic.title}`,
        context.subtopic.expected_learning,
        siblingSummary,
        '',
        `Regenerate prose for node ${node.node_id} (${node.node_type}, order ${node.order + 1}).`,
        `Current KC: ${node.knowledge_component}`,
        `Keep the same misconception candidate IDs: ${node.candidate_misconceptions.map((c) => c.candidate_misconception_id).join(', ') || 'none'}.`,
      ].join('\n'),
    },
  ];
}

/** Regenerate one node's prose via the model; keeps governed fields. Requires ack if SME-edited. */
export async function regenerateSingleNode(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  options: { acknowledgeReplaceEdits?: boolean; groundWithJudgment?: boolean } = {}
): Promise<NodeSet> {
  const existing = await getNodeSet(courseCode, subtopicId);
  if (!existing) {
    throw new Error(`No node-set found for course "${courseCode}" subtopic "${subtopicId}"`);
  }
  const node = existing.nodes.find((n: Node) => n.node_id === nodeId);
  if (!node) {
    throw new Error(`Node "${nodeId}" not found in node-set for "${subtopicId}"`);
  }

  if (node.sme_edited && !options.acknowledgeReplaceEdits) {
    throw new NodeEditConflictError(
      'This node has manual edits — regenerating will replace them. Set acknowledgeReplaceEdits to continue.'
    );
  }

  const bundle = await buildV1ContractBundle(courseCode);
  const context = buildNodeGenerationContext(bundle, subtopicId);
  const { executor } = buildDefaultExecutor(4000);
  const raw = await executor(buildRegenerateMessages(context, node));
  const parsed = parseAIJson<RegeneratedNodeProse>(raw);

  if (typeof parsed.knowledge_component === 'string') node.knowledge_component = parsed.knowledge_component;
  if (typeof parsed.mastery_statement === 'string') node.mastery_statement = parsed.mastery_statement;
  if (typeof parsed.why_it_matters === 'string') node.why_it_matters = parsed.why_it_matters;
  if (typeof parsed.assessment_connection === 'string') node.assessment_connection = parsed.assessment_connection;
  if (typeof parsed.core_academic_message === 'string') node.core_academic_message = parsed.core_academic_message;

  if (Array.isArray(parsed.candidate_misconceptions)) {
    const byId = new Map(
      parsed.candidate_misconceptions
        .filter((c) => typeof c.candidate_misconception_id === 'string')
        .map((c) => [c.candidate_misconception_id as string, c])
    );
    node.candidate_misconceptions = node.candidate_misconceptions.map((c: CandidateMisconception) => {
      const patch = byId.get(c.candidate_misconception_id);
      if (!patch) return c;
      return {
        ...c,
        statement: typeof patch.statement === 'string' ? patch.statement : c.statement,
        reason: typeof patch.reason === 'string' ? patch.reason : c.reason,
        suggested_trap:
          typeof patch.suggested_trap === 'string' ? patch.suggested_trap : c.suggested_trap,
      };
    });
  }

  node.sme_edited = false;
  node.sme_edited_at = undefined;
  node.status = 'draft';

  await regroundSingleNode(courseCode, subtopicId, node, options.groundWithJudgment !== false);
  applyTriageToNode(node, existing, context);
  syncNodeSetApprovalStatus(existing);
  refreshGroundingSummary(existing);

  const validated = parseNodeSet(JSON.parse(JSON.stringify(existing)));
  await saveNodeSetArtifact(courseCode, subtopicId, validated);
  return validated;
}
