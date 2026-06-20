/**
 * M9 — Learning Object Content Specification service (Level 2, Build Spec §8.1).
 *
 * For each approved blueprint object, produces the academic source-of-truth spec
 * (required_explanation, examples, preservation_rules, grounding) that M10
 * renders into produced learning objects.
 *
 * V1 uses a deterministic projection from the approved blueprint + node (testable,
 * no model required). Grounding inherits the node's references; weak grounding is
 * flagged when no citations are present.
 */
import {
  parseLearningObjectContentSpec,
  parseNodeContentSpecsBundle,
  parseNodeExperienceBlueprint,
  type BlueprintObject,
  type ContentSpecExample,
  type ContentSpecNonExample,
  type EvidenceCheckContentSpec,
  type GroundingStrength,
  type LearningObjectContentSpec,
  type Node,
  type NodeContentSpecsBundle,
  type NodeExperienceBlueprint,
} from '../models/nodeEngine.js';
import { getBlueprintArtifact, getContentSpecsArtifact, saveContentSpecsArtifact } from './store.service.js';
import { getApprovedNodesForM8, getNodeSet } from './nodeGeneration.service.js';

// ===========================================================================
// Public errors
// ===========================================================================

export class ContentSpecBlueprintNotApprovedError extends Error {
  constructor(nodeId: string) {
    super(`Blueprint for node "${nodeId}" must be approved before generating content specs.`);
    this.name = 'ContentSpecBlueprintNotApprovedError';
  }
}

export class ContentSpecValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentSpecValidationError';
  }
}

// ===========================================================================
// Deterministic projection (golden / test path)
// ===========================================================================

function resolveGroundingStrength(node: Node): GroundingStrength {
  if (node.grounding_strength) return node.grounding_strength;
  return node.grounding_references.length > 0 ? 'strong' : 'weak';
}

function preservationRulesForObject(node: Node, obj: BlueprintObject): string[] {
  const rules = [
    `Preserve knowledge component focus: "${node.knowledge_component}".`,
    `Do not change object purpose (${obj.node_object_purpose ?? 'unspecified'}) or parent node (${node.node_id}).`,
    'Do not invent academic claims beyond the approved content specification.',
  ];
  if (obj.is_primary_evidence_check) {
    rules.push('Do not reveal correct answers or feedback before the learner submits their first attempt.');
    rules.push(
      `Must capture signals: ${node.primary_evidence_check_requirement.must_capture_signals.join(', ')}.`
    );
  }
  if (obj.addresses_misconception_ids.length > 0) {
    rules.push(`Address misconceptions: ${obj.addresses_misconception_ids.join(', ')}.`);
  }
  if (obj.targets_misconception_id) {
    rules.push(`Remediation must target misconception ${obj.targets_misconception_id}.`);
  }
  if (obj.content_pattern !== 'none') {
    rules.push(`Honour content pattern: ${obj.content_pattern}.`);
  }
  return rules;
}

function requiredExplanationForObject(node: Node, obj: BlueprintObject): string {
  const purpose = obj.node_object_purpose;
  switch (purpose) {
    case 'orientation':
      return `Orient the learner to "${node.node_title}". Mastery goal: ${node.mastery_statement}. Why it matters: ${node.why_it_matters}`;
    case 'explanation':
      return (
        node.core_academic_message ||
        `Explain ${node.knowledge_component} in service of: ${node.mastery_statement}. ${obj.design_rationale}`
      );
    case 'remediation': {
      const target =
        node.candidate_misconceptions.find(
          (m) => m.candidate_misconception_id === obj.targets_misconception_id
        ) ?? node.candidate_misconceptions[0];
      return target
        ? `Surface and correct the misconception: "${target.statement}". ${target.reason}`
        : `Address likely misconceptions before the evidence check. ${obj.design_rationale}`;
    }
    case 'worked_example':
      return `Demonstrate step-by-step application of ${node.knowledge_component}. ${obj.design_rationale}`;
    case 'practice':
      return `Guided practice for ${node.knowledge_component}. Learner applies: ${node.mastery_statement}`;
    case 'assessment_connection':
      return node.assessment_connection || obj.design_rationale;
    case 'evidence_check':
      return `Official evidence check for "${node.node_title}". Learner must demonstrate: ${node.mastery_statement}`;
    default:
      return obj.design_rationale || node.knowledge_component;
  }
}

function examplesForObject(node: Node, obj: BlueprintObject): ContentSpecExample[] {
  if (obj.node_object_purpose === 'explanation' && node.core_academic_message.trim()) {
    return [{ label: 'Core message', content: node.core_academic_message }];
  }
  if (obj.node_object_purpose === 'remediation') {
    const misc =
      node.candidate_misconceptions.find(
        (m) => m.candidate_misconception_id === obj.targets_misconception_id
      ) ?? node.candidate_misconceptions[0];
    if (misc?.suggested_trap) {
      return [{ label: 'Likely trap', content: misc.suggested_trap }];
    }
  }
  return [];
}

function nonExamplesForObject(node: Node, obj: BlueprintObject): ContentSpecNonExample[] {
  if (obj.node_object_purpose === 'remediation') {
    const misc = node.candidate_misconceptions[0];
    if (misc) {
      return [
        {
          label: 'Misconception to avoid',
          content: misc.statement,
          why_not: misc.reason,
        },
      ];
    }
  }
  return [];
}

function evidenceCheckSpecForObject(node: Node, obj: BlueprintObject): EvidenceCheckContentSpec | undefined {
  if (obj.node_object_purpose !== 'evidence_check') return undefined;
  const ec = node.primary_evidence_check_requirement;
  const criteria =
    node.evidence_map.length > 0
      ? node.evidence_map.map((c) => c.criterion_name).join('; ')
      : node.mastery_statement;
  const trap = node.candidate_misconceptions[0]?.suggested_trap ?? node.candidate_misconceptions[0]?.statement;
  return {
    learner_task: `Demonstrate mastery of ${node.knowledge_component} for "${node.node_title}".`,
    response_prompt: 'Provide your response to the evidence check task.',
    reasoning_prompt: 'Explain the reasoning behind your response.',
    confidence_prompt: 'How confident are you in your response?',
    evidence_criteria_summary: criteria,
    no_feedback_before_submission: true,
    preferred_evidence_mode: ec.preferred_evidence_mode,
    must_capture_signals: [...ec.must_capture_signals],
    ...(trap ? { misconception_trap: trap } : {}),
  };
}

/** Pure projection: approved blueprint object → Level-2 content spec. */
export function projectContentSpecFromBlueprintObject(
  node: Node,
  blueprint: NodeExperienceBlueprint,
  blueprintObject: BlueprintObject,
  now = new Date().toISOString()
): LearningObjectContentSpec {
  const groundingStrength = resolveGroundingStrength(node);
  const spec: LearningObjectContentSpec = {
    content_spec_id: `spec_${blueprintObject.object_id}`,
    object_id: blueprintObject.object_id,
    blueprint_id: blueprint.blueprint_id,
    course_id: blueprint.course_id,
    subtopic_id: blueprint.subtopic_id,
    node_id: blueprint.node_id,
    object_family: blueprintObject.object_family,
    node_object_purpose: blueprintObject.node_object_purpose,
    milestone_support_purpose: blueprintObject.milestone_support_purpose,
    content_pattern: blueprintObject.content_pattern,
    suggested_vehicle: blueprintObject.suggested_vehicle,
    is_primary_evidence_check: blueprintObject.is_primary_evidence_check,
    parent_node_id: blueprintObject.parent_node_id,
    parent_milestone_pack_id: blueprintObject.parent_milestone_pack_id ?? null,
    kc_ids: [...blueprintObject.kc_ids],
    title: blueprintObject.title,
    required_explanation: requiredExplanationForObject(node, blueprintObject),
    examples: examplesForObject(node, blueprintObject),
    non_examples: nonExamplesForObject(node, blueprintObject),
    preservation_rules: preservationRulesForObject(node, blueprintObject),
    addresses_misconception_ids: [...blueprintObject.addresses_misconception_ids],
    grounding_references: node.grounding_references.map((c) => ({ ...c })),
    grounding_strength: groundingStrength,
    status: 'draft',
    created_at: now,
    updated_at: now,
  };
  if (blueprintObject.targets_misconception_id) {
    spec.targets_misconception_id = blueprintObject.targets_misconception_id;
  }
  if (groundingStrength === 'weak') {
    spec.grounding_note = 'No node-level citations — SME should verify or add grounding before M10 production.';
  }
  const ecSpec = evidenceCheckSpecForObject(node, blueprintObject);
  if (ecSpec) spec.evidence_check_spec = ecSpec;
  return spec;
}

export function validateContentSpec(
  spec: LearningObjectContentSpec,
  _node: Node,
  blueprintObject: BlueprintObject
): void {
  if (!spec.required_explanation.trim()) {
    throw new ContentSpecValidationError(
      `Content spec for "${spec.object_id}" is missing required_explanation.`
    );
  }
  if (spec.object_id !== blueprintObject.object_id) {
    throw new ContentSpecValidationError(
      `Content spec object_id "${spec.object_id}" does not match blueprint object "${blueprintObject.object_id}".`
    );
  }
  if (spec.preservation_rules.length === 0) {
    throw new ContentSpecValidationError(
      `Content spec for "${spec.object_id}" must include at least one preservation rule.`
    );
  }
  if (blueprintObject.is_primary_evidence_check && !spec.evidence_check_spec) {
    throw new ContentSpecValidationError(
      `Primary evidence check spec "${spec.object_id}" must include evidence_check_spec.`
    );
  }
}

// ===========================================================================
// Persistence helpers
// ===========================================================================

async function loadBundle(courseCode: string, nodeId: string): Promise<NodeContentSpecsBundle | null> {
  const raw = await getContentSpecsArtifact(courseCode, nodeId);
  if (!raw) return null;
  return parseNodeContentSpecsBundle(raw);
}

async function saveBundle(bundle: NodeContentSpecsBundle, courseCode: string): Promise<NodeContentSpecsBundle> {
  const validated = parseNodeContentSpecsBundle(JSON.parse(JSON.stringify(bundle)));
  await saveContentSpecsArtifact(courseCode, bundle.node_id, validated);
  return validated;
}

async function requireApprovedBlueprint(
  courseCode: string,
  subtopicId: string,
  nodeId: string
): Promise<{ node: Node; blueprint: NodeExperienceBlueprint }> {
  const nodes = await getApprovedNodesForM8(courseCode, subtopicId);
  const node = nodes.find((n) => n.node_id === nodeId);
  if (!node) {
    throw new ContentSpecBlueprintNotApprovedError(nodeId);
  }
  const raw = await getBlueprintArtifact(courseCode, nodeId);
  if (!raw) {
    throw new ContentSpecBlueprintNotApprovedError(nodeId);
  }
  const blueprint = parseNodeExperienceBlueprint(raw);
  if (blueprint.status !== 'approved') {
    throw new ContentSpecBlueprintNotApprovedError(nodeId);
  }
  return { node, blueprint };
}

function upsertSpecInBundle(
  bundle: NodeContentSpecsBundle,
  spec: LearningObjectContentSpec
): NodeContentSpecsBundle {
  const specs = bundle.specs.filter((s) => s.object_id !== spec.object_id);
  specs.push(spec);
  return {
    ...bundle,
    specs: specs.sort((a, b) => a.object_id.localeCompare(b.object_id)),
    updated_at: new Date().toISOString(),
  };
}

// ===========================================================================
// Public API
// ===========================================================================

export async function getContentSpecsForNode(
  courseCode: string,
  _subtopicId: string,
  nodeId: string
): Promise<LearningObjectContentSpec[]> {
  const bundle = await loadBundle(courseCode, nodeId);
  return bundle?.specs ?? [];
}

export async function getContentSpec(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  objectId: string
): Promise<LearningObjectContentSpec | null> {
  const specs = await getContentSpecsForNode(courseCode, subtopicId, nodeId);
  return specs.find((s) => s.object_id === objectId) ?? null;
}

export interface GenerateContentSpecOptions {
  persist?: boolean;
  objectId?: string;
}

export async function generateContentSpecs(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  options: GenerateContentSpecOptions = {}
): Promise<LearningObjectContentSpec[]> {
  const { persist = true, objectId } = options;
  const { node, blueprint } = await requireApprovedBlueprint(courseCode, subtopicId, nodeId);
  const nodeSet = await getNodeSet(courseCode, subtopicId);
  const targets = objectId
    ? blueprint.objects.filter((o) => o.object_id === objectId)
    : blueprint.objects;
  if (targets.length === 0) {
    throw new ContentSpecValidationError(
      objectId ? `Blueprint object "${objectId}" not found.` : 'Blueprint has no objects.'
    );
  }

  const now = new Date().toISOString();
  const generated = targets.map((obj) => {
    const spec = projectContentSpecFromBlueprintObject(node, blueprint, obj, now);
    validateContentSpec(spec, node, obj);
    return parseLearningObjectContentSpec(JSON.parse(JSON.stringify(spec)));
  });

  if (!persist) return generated;

  let bundle = await loadBundle(courseCode, nodeId);
  if (!bundle) {
    bundle = {
      bundle_id: `csb_${nodeId}`,
      course_id: nodeSet?.course_id ?? courseCode,
      subtopic_id: subtopicId,
      node_id: nodeId,
      specs: [],
      updated_at: now,
    };
  }
  for (const spec of generated) {
    bundle = upsertSpecInBundle(bundle, spec);
  }
  const saved = await saveBundle(bundle, courseCode);
  return objectId ? saved.specs.filter((s) => s.object_id === objectId) : saved.specs;
}

export interface ContentSpecPatch {
  title?: string;
  required_explanation?: string;
  preservation_rules?: string[];
  grounding_note?: string;
}

export async function updateContentSpec(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  objectId: string,
  patch: ContentSpecPatch
): Promise<LearningObjectContentSpec> {
  const { node, blueprint } = await requireApprovedBlueprint(courseCode, subtopicId, nodeId);
  const bundle = await loadBundle(courseCode, nodeId);
  if (!bundle) {
    throw new Error(`No content specs for node "${nodeId}" — generate first.`);
  }
  const blueprintObject = blueprint.objects.find((o) => o.object_id === objectId);
  if (!blueprintObject) {
    throw new ContentSpecValidationError(`Blueprint object "${objectId}" not found.`);
  }
  const existing = bundle.specs.find((s) => s.object_id === objectId);
  if (!existing) {
    throw new Error(`No content spec for object "${objectId}" — generate first.`);
  }

  const updated: LearningObjectContentSpec = {
    ...existing,
    title: patch.title ?? existing.title,
    required_explanation: patch.required_explanation ?? existing.required_explanation,
    preservation_rules: patch.preservation_rules ?? existing.preservation_rules,
    grounding_note: patch.grounding_note ?? existing.grounding_note,
    updated_at: new Date().toISOString(),
    status: existing.status === 'approved' ? 'needs_revision' : 'needs_review',
  };
  validateContentSpec(updated, node, blueprintObject);
  const saved = await saveBundle(upsertSpecInBundle(bundle, updated), courseCode);
  const spec = saved.specs.find((s) => s.object_id === objectId);
  if (!spec) throw new Error('Failed to persist content spec update.');
  return spec;
}

export async function groundContentSpec(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  objectId: string
): Promise<LearningObjectContentSpec> {
  const { node, blueprint } = await requireApprovedBlueprint(courseCode, subtopicId, nodeId);
  const bundle = await loadBundle(courseCode, nodeId);
  if (!bundle) {
    throw new Error(`No content specs for node "${nodeId}" — generate first.`);
  }
  const blueprintObject = blueprint.objects.find((o) => o.object_id === objectId);
  if (!blueprintObject) {
    throw new ContentSpecValidationError(`Blueprint object "${objectId}" not found.`);
  }
  const existing = bundle.specs.find((s) => s.object_id === objectId);
  if (!existing) {
    throw new Error(`No content spec for object "${objectId}" — generate first.`);
  }

  const strength = resolveGroundingStrength(node);
  const updated: LearningObjectContentSpec = {
    ...existing,
    grounding_references: node.grounding_references.map((c) => ({ ...c })),
    grounding_strength: strength,
    grounding_note:
      strength === 'weak'
        ? 'No node-level citations — SME should verify or add grounding before M10 production.'
        : undefined,
    updated_at: new Date().toISOString(),
    status: existing.status === 'approved' ? 'needs_revision' : 'needs_review',
  };
  validateContentSpec(updated, node, blueprintObject);
  const saved = await saveBundle(upsertSpecInBundle(bundle, updated), courseCode);
  const spec = saved.specs.find((s) => s.object_id === objectId);
  if (!spec) throw new Error('Failed to persist grounded content spec.');
  return spec;
}

export async function approveContentSpec(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  objectId: string,
  approver: string
): Promise<LearningObjectContentSpec> {
  const { node, blueprint } = await requireApprovedBlueprint(courseCode, subtopicId, nodeId);
  const bundle = await loadBundle(courseCode, nodeId);
  if (!bundle) {
    throw new Error(`No content specs for node "${nodeId}" — generate first.`);
  }
  const blueprintObject = blueprint.objects.find((o) => o.object_id === objectId);
  if (!blueprintObject) {
    throw new ContentSpecValidationError(`Blueprint object "${objectId}" not found.`);
  }
  const existing = bundle.specs.find((s) => s.object_id === objectId);
  if (!existing) {
    throw new Error(`No content spec for object "${objectId}" — generate first.`);
  }

  validateContentSpec(existing, node, blueprintObject);
  const now = new Date().toISOString();
  const approved: LearningObjectContentSpec = {
    ...existing,
    status: 'approved',
    updated_at: now,
    approved_by: approver,
    approved_at: now,
  };
  const saved = await saveBundle(upsertSpecInBundle(bundle, approved), courseCode);
  const spec = saved.specs.find((s) => s.object_id === objectId);
  if (!spec) throw new Error('Failed to persist content spec approval.');
  return spec;
}

/** Batch-read content specs for hydration (returns flat map by object_id). */
export async function getContentSpecsForNodes(
  courseCode: string,
  nodeRefs: Array<{ subtopicId: string; nodeId: string }>
): Promise<Record<string, LearningObjectContentSpec | null>> {
  const entries = await Promise.all(
    nodeRefs.map(async ({ nodeId }) => {
      const bundle = await loadBundle(courseCode, nodeId);
      return bundle?.specs ?? [];
    })
  );
  const out: Record<string, LearningObjectContentSpec | null> = {};
  for (const specs of entries) {
    for (const spec of specs) {
      out[spec.object_id] = spec;
    }
  }
  return out;
}
