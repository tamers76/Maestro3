/**
 * M7 — Node Generation service.
 *
 * Turns ONE approved V1 Subtopic into a governed set of 4-7 Step-1 node objects
 * (Build Spec Step 1 + Step 2, with the three M7 clarifications). This is the
 * first GENERATIVE node-engine module: the Stage 1 → V1 adapter gives us the
 * subtopic; M7 creates the masterable units inside it and STOPS at the proposed
 * node-set (no blueprint/content-spec/modality — those are M8/M9/M10).
 *
 * Hard rules enforced here:
 *  - reads the RICH V1 Subtopic from `buildV1ContractBundle` — never the lossy
 *    `clo_topics` projection;
 *  - every node gets exactly one mandatory primary Evidence Check requirement
 *    with the deterministic id `ec_node_<node_id>_primary`;
 *  - 4-7 grain rule, with `grain_justification` recorded when adjusted;
 *  - node types chosen on pedagogical grounds, only informed by
 *    `possible_node_families` (divergence recorded in `generator_divergence_note`);
 *  - misconceptions are PROPOSED (candidate_misconceptions + slots="pending")
 *    unless an APPROVED registry entry already exists (Clarification 2);
 *  - `preferred_evidence_mode` is a response-mode, never a modality
 *    (Clarification 1);
 *  - grounding is additive (empty acceptable) and reuses the existing RAG layer;
 *  - every node enters at `status: draft` — Level 0-1, a human approves before
 *    downstream use (no auto-proceed).
 *
 * The deterministic projection (`projectNodeSet`) is split from all I/O so the
 * golden acceptance test can reproduce the worked node-set without a live model
 * or DB.
 */
import {
  parseNodeSet,
  PREFERRED_EVIDENCE_MODES,
  DIAGNOSTIC_BANDS,
  type Assessment,
  type CandidateMisconception,
  type CaptureSignal,
  type CLO,
  type Citation,
  type EvidenceMapCriterion,
  type MisconceptionBinding,
  type MisconceptionSeverity,
  type Node,
  type NodeCrossCloLink,
  type NodeSet,
  type NodeType,
  type PreferredEvidenceMode,
  type PrimaryEvidenceCheckRequirement,
  type RiskClassification,
  type SubmissionBlockState,
  type Subtopic,
  type NodeSetGroundingSummary,
  isEnumMember,
  resolveGenerationModel,
} from '../models/nodeEngine.js';
import { buildV1ContractBundle, type V1ContractBundle } from './stage1Adapter.service.js';
import { getActiveNodeGenerationPrompt } from './nodeGenerationPrompt.service.js';
import { getNodeSetArtifact, saveNodeSetArtifact } from './store.service.js';
import { getConfigForVehicle } from './modalityGenerationConfig.service.js';
import { getActiveTemplateForVehicle } from './promptTemplateRegistry.service.js';
import { getNodeEngineDefaultModel } from '../config.js';
import {
  callModel,
  collectCouncilResponses,
  synthesizeWithChairmanModel,
  type AIMessage,
} from '../services/council.service.js';
import { parseAIJson } from '../services/ai.service.js';
import {
  buildGroundedContextWithFallback,
  type GroundingSource,
} from '../services/referenceRetrieval.service.js';
import { judgeNodeGroundingPassages } from '../services/referenceJudgment.service.js';
import { isNeo4jConnected, persistNodeSetGraph } from '../services/neo4j.service.js';
import { deriveNodeReviewTriage } from './nodeReviewTriage.service.js';

const DEFAULT_SIGNALS: CaptureSignal[] = ['response', 'reasoning', 'confidence'];
const MIN_GRAIN = 4;
const MAX_GRAIN = 7;

/**
 * Minimum top fused `final_score` a scoped grounding must clear to count as
 * 'strong' (secondary, score-aware lever on top of source + quality gate).
 *
 * The fused score is `0.6·semNorm + 0.4·kwNorm + RRF`, min-max normalized within
 * the candidate pool so a healthy scoped match lands near ~1.0. 0.35 is therefore
 * comfortably cleared by genuine grounding, but downgrades degenerate retrievals
 * whose best passage was carried only by the tiny RRF tie-break (≈0.016) or a
 * negligible signal to 'weak' — i.e. "scoped, but the best match is barely a
 * match". NOTE: because scores are pool-normalized, this does NOT by itself catch
 * an off-topic passage that is the best of a bad pool (e.g. the back-of-book index
 * that scored ~0.82) — that is the structural index/TOC detector's job; this is a
 * documented secondary safety that flips thin/degenerate grounding to weak.
 */
const STRONG_MIN_TOP_SCORE = 0.35;

// ===========================================================================
// Public types
// ===========================================================================

/** An entry in an APPROVED misconception registry (Step 3 governed library).
 * M7 may only bind a misconception that already exists here; everything else is
 * proposed as a candidate. */
export interface ApprovedMisconceptionEntry {
  misconception_id: string;
  statement: string;
  severity: MisconceptionSeverity;
  trap: string;
  expected_error_pattern: string;
  confirming_probe: string;
  blocks_submission_if_state: SubmissionBlockState;
  clearance_rule: string;
  /** Optional candidate ids / statements this approved entry resolves. */
  matches?: string[];
}

/** The context M7 assembles from the V1 bundle for ONE subtopic (Step 2.1). */
export interface NodeGenerationContext {
  course_id: string;
  subtopic: Subtopic;
  parent_clos: CLO[];
  /** The connected summative assessment(s) — frozen ids. */
  connected_assessments: Assessment[];
  /** Frozen assessment ids this subtopic prepares for (subtopic ∩ course). */
  prepares_for_assessment_ids: string[];
  /** Other subtopics under the same CLO(s) (sibling/prerequisite context). */
  sibling_subtopics: Subtopic[];
  /** Whether this subtopic connects to a summative assessment (A-facing). */
  is_assessment_facing: boolean;
  /** Whether it is the last (highest-order) connected subtopic before the artifact
   *  — the structural cue to consider an `assessment_preparation` node (§2.2.6). */
  is_last_before_assessment: boolean;
}

/** The raw, pre-normalization node the generator proposes (parsed AI JSON). */
export interface RawNodeProposal {
  node_id?: string;
  node_title: string;
  node_type: string;
  knowledge_component: string;
  kc_ids?: string[];
  mastery_statement?: string;
  why_it_matters?: string;
  node_learning_intent?: string;
  core_academic_message?: string;
  assessment_connection?: string;
  cognitive_level?: string;
  prerequisite_node_ids?: string[];
  cross_clo_links?: Array<{ clo_id?: string; linked_clo_id?: string; reason?: string }>;
  evidence_map?: unknown;
  captured_signals?: unknown;
  primary_evidence_check_requirement?: {
    preferred_evidence_mode?: string;
    must_capture_signals?: unknown;
    diagnostic_bands?: unknown;
  };
  misconception_slots?: string;
  candidate_misconceptions?: unknown;
  misconception_bindings?: unknown;
  risk_classification?: unknown;
  generator_divergence_note?: string;
  prepares_for_assessment_id?: string;
}

export interface RawNodeSetProposal {
  grain_justification?: string;
  nodes: RawNodeProposal[];
}

export type NodeGenerationExecutor = (messages: AIMessage[]) => Promise<string>;

export interface GenerateNodeSetOptions {
  /** Inject a generation executor (tests pass a canned one). Default: council/chat. */
  executor?: NodeGenerationExecutor;
  /** Ground each node via the existing RAG layer. Default: true (best-effort). */
  ground?: boolean;
  /** Apply teach/don't-teach judgment to grounding strength. Default: true. */
  groundWithJudgment?: boolean;
  /** Persist the node-set artifact to the JSON store. Default: true. */
  persist?: boolean;
  /** Also write the node-set graph to Neo4j (best-effort; needs a live driver). Default: false. */
  persistGraph?: boolean;
  /** Approved misconception registry entries (Step 3 library), if any. */
  approvedMisconceptionRegistry?: ApprovedMisconceptionEntry[];
  maxTokens?: number;
}

// ===========================================================================
// Context assembly (Step 2.1) — pure read from the V1 bundle
// ===========================================================================

/** Find one subtopic in the bundle (throws if absent). */
function findSubtopic(bundle: V1ContractBundle, subtopicId: string): Subtopic {
  const subtopic = bundle.subtopics.find((s) => s.subtopic_id === subtopicId);
  if (!subtopic) {
    throw new Error(`Subtopic "${subtopicId}" not found in V1 bundle for course "${bundle.contract.course_id}"`);
  }
  return subtopic;
}

/**
 * Assemble the M7 generation context for ONE subtopic from the rich V1 bundle.
 * Reads the rich Subtopic (purpose / expected_learning / learning_function /
 * possible_node_families / cross_clo_links / source_evidence / cognitive_level)
 * — never the lossy clo_topics projection.
 */
export function buildNodeGenerationContext(
  bundle: V1ContractBundle,
  subtopicId: string
): NodeGenerationContext {
  const subtopic = findSubtopic(bundle, subtopicId);

  const parent_clos = bundle.clos.filter((c) => subtopic.clo_ids.includes(c.clo_id));

  // Frozen assessment ids: the subtopic's assessment_connection ∩ the course's
  // assessments (so reordering never breaks references — the adapter froze them).
  const courseAssessmentIds = new Set(bundle.assessments.map((a) => a.assessment_id));
  const prepares_for_assessment_ids = subtopic.assessment_connection.filter((id) =>
    courseAssessmentIds.has(id)
  );
  const connected_assessments = bundle.assessments.filter((a) =>
    prepares_for_assessment_ids.includes(a.assessment_id)
  );

  const sibling_subtopics = bundle.subtopics.filter(
    (s) => s.subtopic_id !== subtopic.subtopic_id && s.clo_ids.some((id) => subtopic.clo_ids.includes(id))
  );

  // Assessment-facing = the subtopic connects to a summative artifact. The
  // "last before the artifact" cue (for an assessment_preparation node) is the
  // highest-ordered connected subtopic under the same CLO(s).
  const is_assessment_facing = prepares_for_assessment_ids.length > 0;
  const maxOrderAmongConnected = Math.max(
    subtopic.order,
    ...sibling_subtopics
      .filter((s) => s.assessment_connection.some((id) => prepares_for_assessment_ids.includes(id)))
      .map((s) => s.order)
  );
  const is_last_before_assessment = is_assessment_facing && subtopic.order >= maxOrderAmongConnected;

  return {
    course_id: bundle.contract.course_id,
    subtopic,
    parent_clos,
    connected_assessments,
    prepares_for_assessment_ids,
    sibling_subtopics,
    is_assessment_facing,
    is_last_before_assessment,
  };
}

// ===========================================================================
// Prompt assembly — reuses the seeded §2.7 generator prompt
// ===========================================================================

/** Build the council/chat messages for node generation. Grounding is additive. */
export function buildNodeGenerationMessages(
  context: NodeGenerationContext,
  groundingBlock?: string
): AIMessage[] {
  const prompt = getActiveNodeGenerationPrompt();
  const { subtopic, parent_clos, connected_assessments, sibling_subtopics } = context;

  const inputPayload = {
    subtopic: {
      subtopic_id: subtopic.subtopic_id,
      title: subtopic.title,
      purpose: subtopic.purpose,
      expected_learning: subtopic.expected_learning,
      learning_function: subtopic.learning_function,
      possible_node_families: subtopic.possible_node_families,
      assessment_connection: subtopic.assessment_connection,
      cross_clo_links: subtopic.cross_clo_links,
      cognitive_level: subtopic.cognitive_level,
      source_evidence: subtopic.source_evidence,
      clo_ids: subtopic.clo_ids,
    },
    parent_clos: parent_clos.map((c) => ({
      clo_id: c.clo_id,
      statement: c.statement,
      bloom_level: c.bloom_level,
    })),
    connected_assessments: connected_assessments.map((a) => ({
      assessment_id: a.assessment_id,
      label: a.label,
      type: a.type,
      weighting: a.weighting,
    })),
    sibling_subtopics: sibling_subtopics.map((s) => ({
      subtopic_id: s.subtopic_id,
      title: s.title,
      order: s.order,
    })),
    is_assessment_facing: context.is_assessment_facing,
    is_last_before_assessment: context.is_last_before_assessment,
  };

  const userParts = [
    prompt.task_prompt,
    '',
    '=== INPUT (one approved subtopic + its V1 context) ===',
    JSON.stringify(inputPayload, null, 2),
  ];
  if (groundingBlock && groundingBlock.trim()) {
    userParts.push('', groundingBlock);
  }

  return [
    { role: 'system', content: prompt.system_prompt },
    { role: 'user', content: userParts.join('\n') },
  ];
}

// ===========================================================================
// Deterministic projection (Step 2.2-2.7) — pure, no I/O
// ===========================================================================

/** Default response-mode for a node type (used when the proposal omits/invalids it). */
function defaultEvidenceMode(nodeType: NodeType): PreferredEvidenceMode {
  switch (nodeType) {
    case 'concept':
    case 'threshold':
      return 'explain';
    case 'distinction':
    case 'misconception':
      return 'classify_and_justify';
    case 'judgment':
      return 'select_and_justify';
    case 'application':
    case 'integration':
    case 'procedure':
    case 'bridge':
      return 'apply_to_case';
    case 'reflection':
      return 'reflection_response';
    case 'assessment_preparation':
      return 'artifact_fragment';
    default:
      return 'explain';
  }
}

/** Stable, filesystem/graph-safe id slug. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function coerceNodeType(value: string): NodeType {
  const normalized = String(value || '').trim().toLowerCase().replace(/_node$/i, '');
  return isEnumMember<NodeType>(
    ['concept', 'distinction', 'misconception', 'procedure', 'judgment', 'application', 'integration', 'reflection', 'threshold', 'bridge', 'assessment_preparation'],
    normalized
  )
    ? (normalized as NodeType)
    : 'concept';
}

function coerceEvidenceMode(value: unknown, nodeType: NodeType): PreferredEvidenceMode {
  return isEnumMember(PREFERRED_EVIDENCE_MODES, value) ? value : defaultEvidenceMode(nodeType);
}

function coerceSignals(value: unknown): CaptureSignal[] {
  if (!Array.isArray(value)) return [...DEFAULT_SIGNALS];
  const signals = value.filter((s): s is CaptureSignal =>
    isEnumMember(['response', 'reasoning', 'confidence', 'process'], s)
  );
  return signals.length > 0 ? signals : [...DEFAULT_SIGNALS];
}

function coerceEvidenceMap(value: unknown): EvidenceMapCriterion[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, i) => {
    const c = (entry ?? {}) as Record<string, unknown>;
    const solo = (c.solo_descriptors ?? {}) as Record<string, unknown>;
    return {
      criterion_id: typeof c.criterion_id === 'string' && c.criterion_id ? c.criterion_id : `crit_${i + 1}`,
      criterion_name: typeof c.criterion_name === 'string' ? c.criterion_name : '',
      solo_descriptors: {
        surface: typeof solo.surface === 'string' ? solo.surface : '',
        multi_element: typeof solo.multi_element === 'string' ? solo.multi_element : '',
        relational: typeof solo.relational === 'string' ? solo.relational : '',
        extended_abstract: typeof solo.extended_abstract === 'string' ? solo.extended_abstract : '',
      },
      critical: typeof c.critical === 'boolean' ? c.critical : false,
    };
  });
}

function coerceCrossCloLinks(value: RawNodeProposal['cross_clo_links']): NodeCrossCloLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((l) => ({ clo_id: l?.clo_id ?? l?.linked_clo_id ?? '', reason: l?.reason ?? '' }))
    .filter((l) => l.clo_id.length > 0);
}

function coerceCandidates(value: unknown): CandidateMisconception[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, i) => {
    const m = (entry ?? {}) as Record<string, unknown>;
    const candidate: CandidateMisconception = {
      candidate_misconception_id:
        (typeof m.candidate_misconception_id === 'string' && m.candidate_misconception_id) ||
        (typeof m.misconception_id === 'string' && m.misconception_id) ||
        `candidate_${i + 1}`,
      statement: typeof m.statement === 'string' ? m.statement : '',
      reason: typeof m.reason === 'string' ? m.reason : '',
    };
    if (isEnumMember(['low', 'medium', 'high'], m.severity)) candidate.severity = m.severity as MisconceptionSeverity;
    if (typeof m.suggested_trap === 'string') candidate.suggested_trap = m.suggested_trap;
    return candidate;
  });
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Resolve a candidate against the approved registry; returns a binding if found. */
function findApprovedBinding(
  candidate: CandidateMisconception,
  registry: ApprovedMisconceptionEntry[]
): MisconceptionBinding | null {
  const entry = registry.find(
    (e) =>
      e.misconception_id === candidate.candidate_misconception_id ||
      (e.matches ?? []).includes(candidate.candidate_misconception_id) ||
      normalizeForMatch(e.statement) === normalizeForMatch(candidate.statement)
  );
  if (!entry) return null;
  return {
    misconception_id: entry.misconception_id,
    statement: entry.statement,
    severity: entry.severity,
    trap: entry.trap,
    expected_error_pattern: entry.expected_error_pattern,
    confirming_probe: entry.confirming_probe,
    blocks_submission_if_state: entry.blocks_submission_if_state,
    clearance_rule: entry.clearance_rule,
  };
}

export interface ProjectNodeSetOptions {
  approvedMisconceptionRegistry?: ApprovedMisconceptionEntry[];
  model_used?: string;
  model_selection_source?: NodeSet['model_selection_source'];
  model_selection_reason?: string;
  generation_mode?: NodeSet['generation_mode'];
  prompt_template_id?: string;
  prompt_version?: number;
  now?: string;
}

/**
 * Deterministically normalize a raw generator proposal into a governed NodeSet:
 * assigns stable node ids, freezes the mandatory `ec_node_<id>_primary` Evidence
 * Check on every node, wires FKs (subtopic / CLO / frozen assessment), applies
 * the misconception candidate-vs-binding rule, enforces the 4-7 grain rule (with
 * grain_justification), and stamps every node `status: draft` (no auto-proceed).
 */
export function projectNodeSet(
  raw: RawNodeSetProposal,
  context: NodeGenerationContext,
  options: ProjectNodeSetOptions = {}
): NodeSet {
  const registry = options.approvedMisconceptionRegistry ?? [];
  const now = options.now ?? new Date().toISOString();
  const { subtopic } = context;
  const proposals = Array.isArray(raw.nodes) ? raw.nodes : [];

  // Pass 1: assign stable node ids (deterministic) before wiring prerequisites.
  const usedIds = new Set<string>();
  const assignedIds = proposals.map((p, index) => {
    let id = (typeof p.node_id === 'string' && p.node_id.trim())
      ? p.node_id.trim()
      : `node_${slugify(subtopic.subtopic_id)}_${index + 1}`;
    // Guarantee uniqueness within the set.
    let n = 2;
    const base = id;
    while (usedIds.has(id)) id = `${base}_${n++}`;
    usedIds.add(id);
    return id;
  });

  const primaryAssessmentId = context.prepares_for_assessment_ids[0] ?? null;
  const divergenceNotes: string[] = [];

  const nodes: Node[] = proposals.map((p, index) => {
    const node_id = assignedIds[index];
    const node_type = coerceNodeType(p.node_type);
    const ecMode = coerceEvidenceMode(p.primary_evidence_check_requirement?.preferred_evidence_mode, node_type);

    const ec: PrimaryEvidenceCheckRequirement = {
      // Deterministic, born here — never supplied by the model.
      evidence_check_id: `ec_node_${node_id}_primary`,
      must_capture_signals: coerceSignals(p.primary_evidence_check_requirement?.must_capture_signals),
      preferred_evidence_mode: ecMode,
      diagnostic_bands: Array.isArray(p.primary_evidence_check_requirement?.diagnostic_bands)
        ? (p.primary_evidence_check_requirement!.diagnostic_bands as unknown[]).filter((b) =>
            isEnumMember(DIAGNOSTIC_BANDS, b)
          ) as PrimaryEvidenceCheckRequirement['diagnostic_bands']
        : [...DIAGNOSTIC_BANDS],
    };
    if (ec.diagnostic_bands.length === 0) ec.diagnostic_bands = [...DIAGNOSTIC_BANDS];

    // Misconceptions: PROPOSE candidates; only bind ones already approved (C2).
    const candidates = coerceCandidates(p.candidate_misconceptions);
    const bindings: MisconceptionBinding[] = [];
    const remainingCandidates: CandidateMisconception[] = [];
    for (const candidate of candidates) {
      const binding = findApprovedBinding(candidate, registry);
      if (binding) bindings.push(binding);
      else remainingCandidates.push(candidate);
    }
    const misconception_slots = bindings.length > 0 ? 'populated' : 'pending';

    // Node type divergence vs the free-text family hints.
    const families = subtopic.possible_node_families.map((f) => f.toLowerCase().replace(/_node$/i, ''));
    let generator_divergence_note = typeof p.generator_divergence_note === 'string' ? p.generator_divergence_note : undefined;
    if (!generator_divergence_note && families.length > 0 && !families.includes(node_type)) {
      generator_divergence_note = `node_type "${node_type}" diverges from possible_node_families [${families.join(', ')}] — chosen on pedagogical grounds.`;
    }
    if (generator_divergence_note) divergenceNotes.push(`${node_id}: ${generator_divergence_note}`);

    // Risk classification: keep proposed + auto-flag bridge nodes (§1.5).
    const risk = new Set<RiskClassification>(
      (Array.isArray(p.risk_classification) ? p.risk_classification : []).filter((r): r is RiskClassification =>
        isEnumMember(['standard', 'critical', 'bridge', 'high_risk'], r)
      )
    );
    if (node_type === 'bridge') risk.add('bridge');
    if (risk.size === 0) risk.add('standard');

    // prepares_for_assessment: assessment-facing subtopic → the frozen primary id.
    const prepares_for_assessment_id =
      typeof p.prepares_for_assessment_id === 'string' && context.prepares_for_assessment_ids.includes(p.prepares_for_assessment_id)
        ? p.prepares_for_assessment_id
        : context.is_assessment_facing
          ? primaryAssessmentId
          : node_type === 'assessment_preparation'
            ? primaryAssessmentId
            : null;

    const draftMessage =
      (typeof p.core_academic_message === 'string' && p.core_academic_message) ||
      (typeof p.node_learning_intent === 'string' && p.node_learning_intent) ||
      p.mastery_statement ||
      '';

    const kc_ids =
      Array.isArray(p.kc_ids) && p.kc_ids.length > 0
        ? p.kc_ids.filter((x) => typeof x === 'string')
        : [`kc_${node_id}`];

    const node: Node = {
      node_id,
      parent_subtopic_id: subtopic.subtopic_id,
      clo_ids: subtopic.clo_ids,
      course_id: context.course_id,
      node_type,
      node_title: p.node_title || node_id,
      order: index,
      is_core: true,
      knowledge_component: p.knowledge_component || '',
      kc_ids,
      mastery_statement: p.mastery_statement ?? '',
      why_it_matters: p.why_it_matters ?? '',
      assessment_connection:
        p.assessment_connection ??
        (primaryAssessmentId ? `Prepares for ${primaryAssessmentId}.` : ''),
      core_academic_message: draftMessage,
      evidence_map: coerceEvidenceMap(p.evidence_map),
      captured_signals: coerceSignals(p.captured_signals),
      prerequisite_node_ids: Array.isArray(p.prerequisite_node_ids)
        ? p.prerequisite_node_ids.filter((x) => typeof x === 'string')
        : [],
      dependent_node_ids: [],
      cross_clo_links: coerceCrossCloLinks(p.cross_clo_links),
      primary_evidence_check_requirement: ec,
      misconception_slots,
      candidate_misconceptions: remainingCandidates,
      misconception_bindings: bindings,
      grounding_references: [],
      risk_classification: [...risk],
      // Triage is derived AFTER grounding in generateNodeSet(); default safe here.
      review_priority: 'can_proceed',
      review_reasons: [],
      status: 'draft',
    };

    if (subtopic.clo_ids[0]) node.parent_clo_id = subtopic.clo_ids[0];
    const cognitive = p.cognitive_level ?? subtopic.cognitive_level;
    if (cognitive) node.cognitive_level = cognitive;
    if (typeof p.node_learning_intent === 'string') node.node_learning_intent = p.node_learning_intent;
    if (prepares_for_assessment_id) node.prepares_for_assessment_id = prepares_for_assessment_id;
    if (generator_divergence_note) node.generator_divergence_note = generator_divergence_note;

    return node;
  });

  // Pass 2: derive dependent_node_ids from prerequisite edges (within-set).
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  for (const n of nodes) {
    for (const prereq of n.prerequisite_node_ids) {
      const target = byId.get(prereq);
      if (target && !target.dependent_node_ids.includes(n.node_id)) {
        target.dependent_node_ids.push(n.node_id);
      }
    }
  }

  // Grain rule: 4-7 nodes, else a written grain_justification is required.
  let grain_justification = typeof raw.grain_justification === 'string' && raw.grain_justification.trim()
    ? raw.grain_justification.trim()
    : undefined;
  if ((nodes.length < MIN_GRAIN || nodes.length > MAX_GRAIN) && !grain_justification) {
    grain_justification = `Node count ${nodes.length} is outside the 4-7 grain band; no generator justification was supplied — flag for SME review.`;
  }

  const nodeSet: NodeSet = {
    node_set_id: `nodeset_${subtopic.subtopic_id}`,
    course_id: context.course_id,
    subtopic_id: subtopic.subtopic_id,
    clo_ids: subtopic.clo_ids,
    prepares_for_assessment_ids: context.prepares_for_assessment_ids,
    nodes,
    generator_divergence_notes: divergenceNotes,
    status: 'draft',
    created_at: now,
    updated_at: now,
  };
  if (grain_justification) nodeSet.grain_justification = grain_justification;
  if (options.model_used) nodeSet.model_used = options.model_used;
  if (options.model_selection_source) nodeSet.model_selection_source = options.model_selection_source;
  if (options.model_selection_reason) nodeSet.model_selection_reason = options.model_selection_reason;
  if (options.generation_mode) nodeSet.generation_mode = options.generation_mode;
  if (options.prompt_template_id) nodeSet.prompt_template_id = options.prompt_template_id;
  if (options.prompt_version !== undefined) nodeSet.prompt_version = options.prompt_version;

  // Round-trip through the parser so the persisted artifact is schema-valid.
  return parseNodeSet(JSON.parse(JSON.stringify(nodeSet)));
}

// ===========================================================================
// Grounding (additive; reuses the existing RAG layer)
// ===========================================================================

/** Running totals while grounding (scoped vs course-level safety net). */
interface GroundingAggregate {
  retrieval_called: boolean;
  scopedCount: number;
  courseLevelCount: number;
  /** Best source seen so far (scoped beats course-level beats model_only). */
  source: GroundingSource;
  citations: Set<string>;
  /** Citations that cleared the Issue 2 quality gate (summed across nodes/prompt). */
  qualityPassCount: number;
  /** Candidate passages dropped by the quality gate (summed). */
  qualityFailCount: number;
  /** True when at least one scoped retrieval found hits that were all thin/junk. */
  scopedThin: boolean;
  /** True when at least one scoped retrieval succeeded but its best passage failed
   * the score-aware strong threshold (scoped, but low-relevance → weak). */
  scopedLowRelevance: boolean;
  /** True when at least one node had passages retrieved but judgment said none teach. */
  judgmentDowngraded: boolean;
  judgmentCalled: boolean;
}

function newGroundingAggregate(): GroundingAggregate {
  return {
    retrieval_called: false,
    scopedCount: 0,
    courseLevelCount: 0,
    source: 'model_only',
    citations: new Set(),
    qualityPassCount: 0,
    qualityFailCount: 0,
    scopedThin: false,
    scopedLowRelevance: false,
    judgmentDowngraded: false,
    judgmentCalled: false,
  };
}

const SOURCE_RANK: Record<GroundingSource, number> = {
  scoped_references: 2,
  course_level_references: 1,
  model_only: 0,
};

function promoteSource(current: GroundingSource, next: GroundingSource): GroundingSource {
  return SOURCE_RANK[next] > SOURCE_RANK[current] ? next : current;
}

/**
 * Best-effort: ground each node by its KC, scoped to the subtopic/CLO, with a
 * COURSE-LEVEL SAFETY NET so grounding is never silently empty. Mutates each node
 * and folds per-node retrieval results into `agg` for the node-set transparency
 * summary. Empty grounding is acceptable (additive) but is now visible.
 */
async function groundNodes(
  courseCode: string,
  context: NodeGenerationContext,
  nodes: Node[],
  agg: GroundingAggregate,
  groundWithJudgment: boolean
): Promise<void> {
  const cloId = context.subtopic.clo_ids[0];
  const subtopicContext = `${context.subtopic.title}. ${context.subtopic.expected_learning}`;

  await Promise.all(
    nodes.map(async (node) => {
      try {
        agg.retrieval_called = true;
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
          agg.judgmentCalled = true;
          const judgment = await judgeNodeGroundingPassages(
            node.knowledge_component,
            subtopicContext,
            passageInputs
          );
          teaches = judgment.teaches;
          if (!teaches) agg.judgmentDowngraded = true;
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

        agg.scopedCount += grounded.scopedCount;
        agg.courseLevelCount += grounded.courseLevelCount;
        agg.source = promoteSource(agg.source, grounded.source);
        agg.qualityPassCount += grounded.quality_pass_count;
        agg.qualityFailCount += grounded.quality_fail_count;
        if (grounded.scoped_filtered_out) agg.scopedThin = true;
        for (const c of citations.map((x) => x.citation)) agg.citations.add(c);
      } catch {
        node.grounding_references = [];
        node.grounding_strength = 'weak';
      }
    })
  );
}

/** Build the human-readable transparency summary persisted on the node-set. */
function buildGroundingSummary(agg: GroundingAggregate): NodeSetGroundingSummary {
  const citationsCount = agg.citations.size;
  const academic_ready = agg.source !== 'model_only' && citationsCount > 0;
  let note: string;
  if (!agg.retrieval_called) {
    note = 'Grounding was not run for this node-set.';
  } else if (agg.source === 'scoped_references') {
    note = `Grounded on ${agg.scopedCount} CLO/subtopic-scoped reference passage(s) — ${citationsCount} citation(s).`;
    if (agg.qualityFailCount > 0) {
      note += ` ${agg.qualityFailCount} thin/low-content passage(s) were filtered out by the citation quality gate.`;
    }
    if (agg.judgmentDowngraded) {
      note +=
        ' Some node(s) retrieved passages but judgment found none that substantively teach the knowledge component — downgraded to weak grounding.';
    } else if (agg.scopedLowRelevance) {
      note +=
        ' Some node(s) are scoped but LOW-RELEVANCE (best passage below the strong-grounding score floor), ' +
        'so they were downgraded to weak grounding — review whether the references actually cover these nodes.';
    }
  } else if (agg.source === 'course_level_references') {
    note =
      (agg.scopedThin
        ? `Scoped retrieval returned only thin/low-quality passages (filtered out); `
        : `Scoped retrieval returned nothing; `) +
      `used the course-level safety net ` +
      `(${agg.courseLevelCount} passage(s), ${citationsCount} citation(s)). ` +
      `Run Reference Alignment (Course Architect Layer 7) to tag substantive chunks to this subtopic for precise grounding.`;
  } else {
    note =
      'No reference passages were retrieved (model-only). Node generation is not academically approvable ' +
      'until references are uploaded and aligned, or an explicit override is recorded.';
  }
  return {
    retrieval_called: agg.retrieval_called,
    scoped_chunk_count: agg.scopedCount,
    course_level_chunk_count: agg.courseLevelCount,
    citations_count: citationsCount,
    grounding_source: agg.source,
    grounding_note: note,
    academic_ready,
  };
}

// ===========================================================================
// Model resolution + default executor (chat-kind, single mode in V1)
// ===========================================================================

/**
 * Resolve the generation model for node generation. Node generation is a
 * chat-kind generation; per the contract it runs through the model-selection
 * layer with the active model. We use the chat (`text`) modality config as the
 * chat-generation model source, falling back to the node-engine global default.
 */
function resolveNodeGenerationModel() {
  const activeTemplate = getActiveTemplateForVehicle('text') ?? null;
  const modalityConfig = getConfigForVehicle('text') ?? null;
  return resolveGenerationModel({
    templateVersion: activeTemplate,
    modalityConfig,
    globalDefaultModel: getNodeEngineDefaultModel(),
  });
}

export function buildDefaultExecutor(maxTokens: number): { executor: NodeGenerationExecutor; audit: ProjectNodeSetOptions } {
  const resolved = resolveNodeGenerationModel();
  const prompt = getActiveNodeGenerationPrompt();
  const audit: ProjectNodeSetOptions = {
    model_used: resolved.model,
    model_selection_source: resolved.source,
    generation_mode: resolved.mode,
    prompt_template_id: prompt.prompt_id,
    prompt_version: prompt.version,
  };
  if (resolved.reason) audit.model_selection_reason = resolved.reason;

  const executor: NodeGenerationExecutor = async (messages) => {
    if (resolved.mode === 'council' && resolved.councilModels && resolved.councilModels.length > 1) {
      const responses = await collectCouncilResponses(messages, resolved.councilModels, {
        maxTokens,
        jsonMode: true,
      });
      const chairman = resolved.chairmanModel ?? resolved.model;
      return synthesizeWithChairmanModel(messages, responses, chairman, { maxTokens, jsonMode: true });
    }
    return callModel(messages, resolved.model, { maxTokens, jsonMode: true });
  };
  return { executor, audit };
}

// ===========================================================================
// Orchestrator + approval (Level 0-1, no auto-proceed)
// ===========================================================================

/**
 * Generate a governed M7 node-set for ONE approved subtopic. Produces a draft
 * node-set (status: draft) — a human must approve it before downstream use.
 */
export async function generateNodeSet(
  courseCode: string,
  subtopicId: string,
  options: GenerateNodeSetOptions = {}
): Promise<NodeSet> {
  const { ground = true, groundWithJudgment = true, persist = true, persistGraph = false, maxTokens = 8000 } = options;

  const bundle = await buildV1ContractBundle(courseCode);
  const context = buildNodeGenerationContext(bundle, subtopicId);

  const agg = newGroundingAggregate();

  // Subtopic-level grounding block for the prompt (additive; empty acceptable),
  // now with the course-level safety net so the prompt is grounded whenever any
  // reference exists for the course.
  let groundingBlock = '';
  if (ground) {
    try {
      agg.retrieval_called = true;
      const grounded = await buildGroundedContextWithFallback(
        courseCode,
        `${context.subtopic.title}. ${context.subtopic.expected_learning}`,
        { scope: { cloId: context.subtopic.clo_ids[0], subtopicId } }
      );
      groundingBlock = grounded.promptBlock;
      agg.scopedCount += grounded.scopedCount;
      agg.courseLevelCount += grounded.courseLevelCount;
      agg.source = promoteSource(agg.source, grounded.source);
      agg.qualityPassCount += grounded.quality_pass_count;
      agg.qualityFailCount += grounded.quality_fail_count;
      if (grounded.scoped_filtered_out) agg.scopedThin = true;
      if (
        grounded.source === 'scoped_references' &&
        grounded.quality_pass_count > 0 &&
        grounded.top_score < STRONG_MIN_TOP_SCORE
      ) {
        agg.scopedLowRelevance = true;
      }
      for (const c of grounded.citations) agg.citations.add(c);
    } catch {
      groundingBlock = '';
    }
  }

  const messages = buildNodeGenerationMessages(context, groundingBlock);

  let executor = options.executor;
  let audit: ProjectNodeSetOptions = {};
  if (!executor) {
    const built = buildDefaultExecutor(maxTokens);
    executor = built.executor;
    audit = built.audit;
  }

  const rawResponse = await executor(messages);
  const proposal = parseAIJson<RawNodeSetProposal>(rawResponse);

  const nodeSet = projectNodeSet(proposal, context, {
    ...audit,
    approvedMisconceptionRegistry: options.approvedMisconceptionRegistry,
  });

  if (ground) {
    await groundNodes(courseCode, context, nodeSet.nodes, agg, groundWithJudgment);
  }
  nodeSet.grounding_summary = buildGroundingSummary(agg);

  // Issue 1 — derive review-by-exception triage from the (now grounded) signals.
  const assessmentsById = new Map(
    context.connected_assessments.map((a) => [a.assessment_id, a] as const)
  );
  const triageContext = {
    groundingSource: nodeSet.grounding_summary.grounding_source,
    assessmentsById,
  };
  for (const node of nodeSet.nodes) {
    const triage = deriveNodeReviewTriage(node, triageContext);
    node.review_priority = triage.review_priority;
    node.review_reasons = triage.review_reasons;
  }

  if (persist) {
    await saveNodeSetArtifact(courseCode, subtopicId, nodeSet);
  }

  if (persistGraph && isNeo4jConnected()) {
    try {
      await persistNodeSetGraph(nodeSet);
    } catch (error) {
      // Graph write is best-effort — the JSON artifact is the source of truth.
      console.warn('[M7] Node-set graph persistence failed (artifact still saved):', error);
    }
  }

  return nodeSet;
}

/** Read a previously generated node-set artifact (null if none). */
export async function getNodeSet(courseCode: string, subtopicId: string): Promise<NodeSet | null> {
  const raw = await getNodeSetArtifact(courseCode, subtopicId);
  return raw ? parseNodeSet(raw) : null;
}

export interface ApproveNodeSetInput {
  approver: string;
  /** Optional subset of node ids to approve; default approves all. */
  nodeIds?: string[];
  /** Required to approve a set that has NO reference grounding (academic guard). */
  overrideReason?: string;
}

/** Error thrown when the academic-approval guard blocks an ungrounded approval. */
export class AcademicApprovalRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcademicApprovalRequiredError';
  }
}

/** True when real reference passages back the set (>=1 citation). Falls back to
 * the node citations for older artifacts lacking a grounding_summary. */
export function isNodeSetAcademicallyReady(nodeSet: NodeSet): boolean {
  if (nodeSet.grounding_summary) return nodeSet.grounding_summary.academic_ready;
  return nodeSet.nodes.some((n) => n.grounding_references.length > 0);
}

/**
 * Human approval step (Level 0-1). Moves the node-set (and the approved nodes)
 * from draft → approved. There is NO auto-proceed: only an approved set emits to
 * M8.
 *
 * Academic-approval guard: a set with NO reference grounding cannot be approved
 * unless an explicit `overrideReason` is recorded (persisted for audit).
 */
export async function approveNodeSet(
  courseCode: string,
  subtopicId: string,
  input: ApproveNodeSetInput
): Promise<NodeSet> {
  const existing = await getNodeSet(courseCode, subtopicId);
  if (!existing) {
    throw new Error(`No node-set found for course "${courseCode}" subtopic "${subtopicId}"`);
  }

  const academicReady = isNodeSetAcademicallyReady(existing);
  const overrideReason = input.overrideReason?.trim();
  if (!academicReady && !overrideReason) {
    throw new AcademicApprovalRequiredError(
      'Academic-approval guard: this node-set has no reference grounding attached. ' +
        'Run Reference Alignment (Course Architect Layer 7) to ground it, or provide an ' +
        'override reason to approve without reference grounding.'
    );
  }

  const approveAll = !input.nodeIds || input.nodeIds.length === 0;
  const targetIds = new Set(input.nodeIds ?? []);

  for (const node of existing.nodes) {
    if (approveAll || targetIds.has(node.node_id)) node.status = 'approved';
  }
  const allApproved = existing.nodes.every((n) => n.status === 'approved');
  existing.status = allApproved ? 'approved' : 'needs_review';
  existing.updated_at = new Date().toISOString();
  existing.approved_by = input.approver;
  existing.approved_at = existing.updated_at;
  if (!academicReady && overrideReason) {
    existing.academic_override_reason = overrideReason;
    existing.academic_override_by = input.approver;
  }

  const validated = parseNodeSet(JSON.parse(JSON.stringify(existing)));
  await saveNodeSetArtifact(courseCode, subtopicId, validated);
  return validated;
}

/** Only approved nodes emit to M8 (the scope guard). */
export async function getApprovedNodesForM8(courseCode: string, subtopicId: string): Promise<Node[]> {
  const nodeSet = await getNodeSet(courseCode, subtopicId);
  if (!nodeSet || nodeSet.status !== 'approved') return [];
  return nodeSet.nodes.filter((n) => n.status === 'approved');
}
