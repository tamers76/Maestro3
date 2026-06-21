/**
 * M8 — Node Experience Blueprint service (Level 1, Build Spec §8.0).
 *
 * Turns ONE approved M7 node into a governed object sequence: each row carries
 * a purpose, suggested vehicle, and design rationale. The mandatory primary
 * Evidence Check object (`ec_node_<id>_primary`) is always present and flagged.
 *
 * V1 uses a deterministic full projection from the node (testable, no model
 * required): every object the node type and fields warrant — orientation,
 * explanation, remediation, practice, worked examples, assessment connection,
 * and the mandatory primary EC. A human approves each blueprint before M9.
 */
import {
  parseNodeExperienceBlueprint,
  type BlueprintObject,
  type ContentPattern,
  type Node,
  type NodeExperienceBlueprint,
  type NodeObjectPurpose,
  type NodeType,
  type PreferredEvidenceMode,
  type Vehicle,
} from '../models/nodeEngine.js';
import { getApprovedNodesForM8, getNodeSet } from './nodeGeneration.service.js';
import { getBlueprintArtifact, saveBlueprintArtifact } from './store.service.js';

// ===========================================================================
// Public errors
// ===========================================================================

export class BlueprintNodeNotApprovedError extends Error {
  constructor(nodeId: string) {
    super(`Node "${nodeId}" must be approved before generating an experience blueprint.`);
    this.name = 'BlueprintNodeNotApprovedError';
  }
}

export class BlueprintValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlueprintValidationError';
  }
}

// ===========================================================================
// Deterministic projection (golden / test path)
// ===========================================================================

function vehicleForEvidenceMode(mode: PreferredEvidenceMode): Vehicle {
  switch (mode) {
    case 'simulation_decision':
      return 'interactive';
    case 'apply_to_case':
    case 'classify_and_justify':
    case 'select_and_justify':
    case 'artifact_fragment':
      return 'interactive';
    case 'reflection_response':
      return 'text';
    default:
      return 'interactive';
  }
}

function contentPatternForNodeType(nodeType: NodeType): ContentPattern {
  switch (nodeType) {
    case 'distinction':
      return 'comparison';
    case 'application':
    case 'judgment':
      return 'scenario';
    case 'misconception':
      return 'challenge_prompt';
    case 'procedure':
      return 'worked_example';
    default:
      return 'none';
  }
}

/** Suggest a delivery vehicle from object purpose + node shape (full blueprint — not text-only). */
function vehicleForExplanation(node: Node, pattern: ContentPattern): Vehicle {
  switch (node.node_type) {
    case 'distinction':
      // Side-by-side contrasts can also work as structured_visual; video is the default
      // for narrated distinction walkthroughs (golden-node pattern).
      return pattern === 'comparison' ? 'video' : 'video';
    case 'procedure':
    case 'application':
    case 'judgment':
    case 'misconception':
      return 'video';
    case 'integration':
      return 'structured_visual';
    case 'concept':
    case 'reflection':
    case 'threshold':
    case 'bridge':
    case 'assessment_preparation':
      return 'text';
    default:
      return 'text';
  }
}

function vehicleForRemediation(node: Node): Vehicle {
  if (node.node_type === 'misconception' || node.candidate_misconceptions.length > 0) {
    return 'interactive';
  }
  return 'text';
}

function vehicleForWorkedExample(_node: Node): Vehicle {
  return 'video';
}

function vehicleForPractice(node: Node): Vehicle {
  if (node.primary_evidence_check_requirement.preferred_evidence_mode === 'simulation_decision') {
    return 'simulation';
  }
  if (node.node_type === 'application' || node.node_type === 'judgment') {
    return 'interactive';
  }
  if (node.node_type === 'distinction') {
    return 'interactive';
  }
  return 'interactive';
}

function buildObject(
  node: Node,
  partial: Omit<BlueprintObject, 'parent_node_id' | 'kc_ids'>
): BlueprintObject {
  const obj: BlueprintObject = {
    ...partial,
    parent_node_id: node.node_id,
    kc_ids: node.kc_ids.length > 0 ? [...node.kc_ids] : [`kc_${node.node_id}`],
  };
  if (partial.targets_misconception_id === undefined) {
    delete obj.targets_misconception_id;
  }
  return obj;
}

/** First governed misconception id on the node, when an object should name one target. */
function primaryMisconceptionTarget(node: Node): string | undefined {
  const binding = node.misconception_bindings[0]?.misconception_id;
  if (binding) return binding;
  const candidate = node.candidate_misconceptions[0]?.candidate_misconception_id;
  return candidate || undefined;
}

/**
 * Pure projection: approved node → Level-1 object sequence with mandatory
 * primary Evidence Check. Exported for tests and as the V1 default generator.
 */
export function projectBlueprintFromNode(node: Node): BlueprintObject[] {
  const ec = node.primary_evidence_check_requirement;
  const pattern = contentPatternForNodeType(node.node_type);
  const misconceptionIds = [
    ...node.misconception_bindings.map((m) => m.misconception_id),
    ...node.candidate_misconceptions.map((m) => m.candidate_misconception_id),
  ];
  const objects: BlueprintObject[] = [];
  let order = 1;

  objects.push(
    buildObject(node, {
      object_id: `obj_${node.node_id}_orientation`,
      object_family: 'node_learning_object',
      sequence_order: order++,
      parent_milestone_pack_id: null,
      node_object_purpose: 'orientation',
      milestone_support_purpose: null,
      suggested_vehicle: 'text',
      content_pattern: 'none',
      is_primary_evidence_check: false,
      title: `Orient: ${node.node_title}`,
      design_rationale:
        'Brief orientation framing the knowledge component and why the learner is here before deeper explanation.',
      estimated_effort_minutes: 3,
      addresses_misconception_ids: [],
    })
  );

  objects.push(
    buildObject(node, {
      object_id: `obj_${node.node_id}_explanation`,
      object_family: 'node_learning_object',
      sequence_order: order++,
      parent_milestone_pack_id: null,
      node_object_purpose: 'explanation',
      milestone_support_purpose: null,
      suggested_vehicle: vehicleForExplanation(node, pattern),
      content_pattern: pattern,
      is_primary_evidence_check: false,
      title: `Explain: ${node.knowledge_component}`,
      design_rationale:
        `Core academic explanation for "${node.knowledge_component}" aligned to the mastery statement.`,
      estimated_effort_minutes: 8,
      addresses_misconception_ids: misconceptionIds,
    })
  );

  if (node.node_type === 'misconception' || node.candidate_misconceptions.length > 0) {
    const targetId = primaryMisconceptionTarget(node);
    objects.push(
      buildObject(node, {
        object_id: `obj_${node.node_id}_remediation`,
        object_family: 'node_learning_object',
        sequence_order: order++,
        parent_milestone_pack_id: null,
        node_object_purpose: 'remediation',
        milestone_support_purpose: null,
        suggested_vehicle: vehicleForRemediation(node),
        content_pattern: 'challenge_prompt',
        is_primary_evidence_check: false,
        title: 'Address likely misconceptions',
        design_rationale:
          'Targeted remediation surfacing traps and confirming probes before the evidence check.',
        estimated_effort_minutes: 6,
        addresses_misconception_ids: misconceptionIds,
        ...(targetId ? { targets_misconception_id: targetId } : {}),
      })
    );
  }

  if (node.node_type === 'procedure') {
    objects.push(
      buildObject(node, {
        object_id: `obj_${node.node_id}_worked_example`,
        object_family: 'node_learning_object',
        sequence_order: order++,
        parent_milestone_pack_id: null,
        node_object_purpose: 'worked_example',
        milestone_support_purpose: null,
        suggested_vehicle: vehicleForWorkedExample(node),
        content_pattern: 'worked_example',
        is_primary_evidence_check: false,
        title: 'Worked example',
        design_rationale: 'Step-by-step demonstration before practice and evidence capture.',
        estimated_effort_minutes: 10,
        addresses_misconception_ids: [],
      })
    );
  }

  if (['application', 'judgment', 'distinction'].includes(node.node_type)) {
    objects.push(
      buildObject(node, {
        object_id: `obj_${node.node_id}_practice`,
        object_family: 'node_learning_object',
        sequence_order: order++,
        parent_milestone_pack_id: null,
        node_object_purpose: 'practice',
        milestone_support_purpose: null,
        suggested_vehicle: vehicleForPractice(node),
        content_pattern: pattern === 'none' ? 'scenario' : pattern,
        is_primary_evidence_check: false,
        title: 'Guided practice',
        design_rationale:
          'Low-stakes practice object before the official evidence check captures mastery signals.',
        estimated_effort_minutes: 12,
        addresses_misconception_ids: misconceptionIds,
      })
    );
  }

  if (node.assessment_connection.trim().length > 0) {
    objects.push(
      buildObject(node, {
        object_id: `obj_${node.node_id}_assessment_connection`,
        object_family: 'node_learning_object',
        sequence_order: order++,
        parent_milestone_pack_id: null,
        node_object_purpose: 'assessment_connection',
        milestone_support_purpose: null,
        suggested_vehicle: 'text',
        content_pattern: 'none',
        is_primary_evidence_check: false,
        title: 'Assessment connection',
        design_rationale: node.assessment_connection,
        estimated_effort_minutes: 4,
        addresses_misconception_ids: [],
      })
    );
  }

  // Mandatory primary Evidence Check — always last in the learner sequence.
  objects.push(
    buildObject(node, {
      object_id: ec.evidence_check_id,
      object_family: 'node_learning_object',
      sequence_order: order++,
      parent_milestone_pack_id: null,
      node_object_purpose: 'evidence_check',
      milestone_support_purpose: null,
      suggested_vehicle: vehicleForEvidenceMode(ec.preferred_evidence_mode),
      content_pattern: 'none',
      is_primary_evidence_check: true,
      title: `Primary evidence check: ${node.node_title}`,
      design_rationale:
        `Official evidence check capturing ${ec.must_capture_signals.join(', ')} via ${ec.preferred_evidence_mode}.`,
      estimated_effort_minutes: 15,
      addresses_misconception_ids: misconceptionIds,
    })
  );

  return objects;
}

/** Validate blueprint invariants before persist/approve. */
export function validateBlueprintObjects(objects: BlueprintObject[], node: Node): void {
  if (objects.length === 0) {
    throw new BlueprintValidationError('Blueprint must contain at least one object.');
  }
  const ecId = node.primary_evidence_check_requirement.evidence_check_id;
  const primary = objects.filter((o) => o.is_primary_evidence_check);
  if (primary.length !== 1) {
    throw new BlueprintValidationError(
      `Blueprint must contain exactly one primary evidence check object (found ${primary.length}).`
    );
  }
  if (primary[0].object_id !== ecId) {
    throw new BlueprintValidationError(
      `Primary evidence check object_id must be "${ecId}" (found "${primary[0].object_id}").`
    );
  }
  for (const obj of objects) {
    if (!obj.suggested_vehicle) {
      throw new BlueprintValidationError(`Object "${obj.object_id}" is missing suggested_vehicle.`);
    }
    if (obj.object_family === 'node_learning_object' && !obj.node_object_purpose) {
      throw new BlueprintValidationError(`Node learning object "${obj.object_id}" is missing purpose.`);
    }
    if (obj.object_family === 'milestone_support_object' && !obj.milestone_support_purpose) {
      throw new BlueprintValidationError(
        `Milestone support object "${obj.object_id}" is missing milestone_support_purpose.`
      );
    }
  }
}

function sortObjects(objects: BlueprintObject[]): BlueprintObject[] {
  return [...objects].sort((a, b) => a.sequence_order - b.sequence_order);
}

function requireApprovedNode(
  courseCode: string,
  subtopicId: string,
  nodeId: string
): Promise<Node> {
  return getApprovedNodesForM8(courseCode, subtopicId).then((nodes) => {
    const node = nodes.find((n) => n.node_id === nodeId);
    if (!node) throw new BlueprintNodeNotApprovedError(nodeId);
    return node;
  });
}

// ===========================================================================
// Persistence + orchestration
// ===========================================================================

export async function getBlueprint(
  courseCode: string,
  subtopicId: string,
  nodeId: string
): Promise<NodeExperienceBlueprint | null> {
  const raw = await getBlueprintArtifact(courseCode, nodeId);
  if (!raw) return null;
  return parseNodeExperienceBlueprint(raw);
}

export interface GenerateBlueprintOptions {
  persist?: boolean;
}

export async function generateBlueprint(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  options: GenerateBlueprintOptions = {}
): Promise<NodeExperienceBlueprint> {
  const { persist = true } = options;
  const node = await requireApprovedNode(courseCode, subtopicId, nodeId);
  const nodeSet = await getNodeSet(courseCode, subtopicId);
  const objects = sortObjects(projectBlueprintFromNode(node));
  validateBlueprintObjects(objects, node);

  const now = new Date().toISOString();
  const blueprint: NodeExperienceBlueprint = {
    blueprint_id: `bp_${nodeId}`,
    course_id: nodeSet?.course_id ?? courseCode,
    subtopic_id: subtopicId,
    node_id: nodeId,
    node_title: node.node_title,
    objects,
    status: 'draft',
    created_at: now,
    updated_at: now,
  };

  const validated = parseNodeExperienceBlueprint(JSON.parse(JSON.stringify(blueprint)));
  if (persist) await saveBlueprintArtifact(courseCode, nodeId, validated);
  return validated;
}

export interface BlueprintObjectPatch {
  object_id: string;
  title?: string;
  design_rationale?: string;
  suggested_vehicle?: Vehicle;
  node_object_purpose?: NodeObjectPurpose;
  content_pattern?: ContentPattern;
  estimated_effort_minutes?: number;
  sequence_order?: number;
}

export async function updateBlueprint(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  patches: BlueprintObjectPatch[]
): Promise<NodeExperienceBlueprint> {
  const existing = await getBlueprint(courseCode, subtopicId, nodeId);
  if (!existing) {
    throw new Error(`No blueprint found for node "${nodeId}" — generate one first.`);
  }
  const node = await requireApprovedNode(courseCode, subtopicId, nodeId);
  const patchById = new Map(patches.map((p) => [p.object_id, p]));

  const updatedObjects = existing.objects.map((obj) => {
    const patch = patchById.get(obj.object_id);
    if (!patch) return obj;
    if (obj.is_primary_evidence_check && patch.node_object_purpose && patch.node_object_purpose !== 'evidence_check') {
      throw new BlueprintValidationError('Cannot change purpose of the primary evidence check object.');
    }
    return {
      ...obj,
      title: patch.title ?? obj.title,
      design_rationale: patch.design_rationale ?? obj.design_rationale,
      suggested_vehicle: patch.suggested_vehicle ?? obj.suggested_vehicle,
      node_object_purpose: patch.node_object_purpose ?? obj.node_object_purpose,
      content_pattern: patch.content_pattern ?? obj.content_pattern,
      estimated_effort_minutes: patch.estimated_effort_minutes ?? obj.estimated_effort_minutes,
      sequence_order: patch.sequence_order ?? obj.sequence_order,
    };
  });

  validateBlueprintObjects(updatedObjects, node);
  existing.objects = sortObjects(updatedObjects);
  existing.updated_at = new Date().toISOString();
  existing.status = existing.status === 'approved' ? 'needs_revision' : 'needs_review';

  const validated = parseNodeExperienceBlueprint(JSON.parse(JSON.stringify(existing)));
  await saveBlueprintArtifact(courseCode, nodeId, validated);
  return validated;
}

export async function approveBlueprint(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  approver: string
): Promise<NodeExperienceBlueprint> {
  const existing = await getBlueprint(courseCode, subtopicId, nodeId);
  if (!existing) {
    throw new Error(`No blueprint found for node "${nodeId}" — generate one first.`);
  }
  const node = await requireApprovedNode(courseCode, subtopicId, nodeId);
  validateBlueprintObjects(existing.objects, node);

  const now = new Date().toISOString();
  existing.status = 'approved';
  existing.updated_at = now;
  existing.approved_by = approver;
  existing.approved_at = now;

  const validated = parseNodeExperienceBlueprint(JSON.parse(JSON.stringify(existing)));
  await saveBlueprintArtifact(courseCode, nodeId, validated);
  return validated;
}

/** List blueprint artifacts for many node ids (hydration helper). */
export async function getBlueprintsForNodes(
  courseCode: string,
  nodeRefs: Array<{ subtopicId: string; nodeId: string }>
): Promise<Record<string, NodeExperienceBlueprint | null>> {
  const entries = await Promise.all(
    nodeRefs.map(async ({ nodeId }) => [nodeId, await getBlueprintArtifact(courseCode, nodeId)] as const)
  );
  const out: Record<string, NodeExperienceBlueprint | null> = {};
  for (const [nodeId, raw] of entries) {
    out[nodeId] = raw ? parseNodeExperienceBlueprint(raw) : null;
  }
  return out;
}
