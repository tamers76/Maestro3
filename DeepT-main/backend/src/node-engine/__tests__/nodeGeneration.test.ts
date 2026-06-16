/**
 * M7 Node Generation tests (run with: npm test).
 *
 * node:test via tsx (no test framework), mirroring phase0.test.ts /
 * stage1Adapter.test.ts. Three halves:
 *  1. New/changed schema validators round-trip and reject invalid enums.
 *  2. The pure context assembly + deterministic projection against the real,
 *     all-approved MDLD602 artifacts — including the GOLDEN node reproduction
 *     ("Distinguish description from critical evaluation").
 *  3. The orchestrator with an injected executor + the human approval gate.
 *
 * No live model or DB is required: the golden test feeds a canned generator
 * proposal into the pure projection, and the orchestrator test injects a canned
 * executor. Any artifact a test writes is cleaned up so the repo stays clean.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';

import {
  parseNode,
  parseNodeSet,
  NodeEngineValidationError,
  PREFERRED_EVIDENCE_MODES,
  type Node,
  type NodeSet,
} from '../../models/nodeEngine.js';
import { buildV1ContractBundle } from '../stage1Adapter.service.js';
import {
  buildNodeGenerationContext,
  buildNodeGenerationMessages,
  projectNodeSet,
  generateNodeSet,
  approveNodeSet,
  getApprovedNodesForM8,
  type ApprovedMisconceptionEntry,
  type RawNodeSetProposal,
} from '../nodeGeneration.service.js';
import { saveNodeSetArtifact, getNodeSetArtifact } from '../store.service.js';

const COURSE = 'MDLD602';
// The MDLD602 "critical-evaluation" subtopic (Analyze, A1-facing): the
// comparative/criteria framework-analysis subtopic that yields the worked node.
const CRITICAL_EVAL_SUBTOPIC = 'CLO1-ST2';
const FIXTURES_DIR = join(process.cwd(), 'src', 'node-engine', '__fixtures__');

function loadProposal(): RawNodeSetProposal {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, 'nodeset_proposal_critical-eval.json'), 'utf-8'));
}

// ===========================================================================
// 1. Schema validators (the 3 clarifications)
// ===========================================================================

function sampleNode(): Node {
  return parseNode(JSON.parse(readFileSync(join(FIXTURES_DIR, 'node_critical-eval_1.json'), 'utf-8')));
}

test('parseNode accepts response-mode preferred_evidence_mode (Clarification 1)', () => {
  const node = sampleNode();
  assert.equal(node.primary_evidence_check_requirement.preferred_evidence_mode, 'select_and_justify');
  assert.ok(PREFERRED_EVIDENCE_MODES.includes(node.primary_evidence_check_requirement.preferred_evidence_mode));
});

test('parseNode rejects a modality value for preferred_evidence_mode', () => {
  const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, 'node_critical-eval_1.json'), 'utf-8'));
  raw.primary_evidence_check_requirement.preferred_evidence_mode = 'interactive';
  assert.throws(() => parseNode(raw), NodeEngineValidationError);
});

test('parseNode round-trips new node-level fields (Clarification 3)', () => {
  const node = sampleNode();
  const round = parseNode(JSON.parse(JSON.stringify(node)));
  assert.deepEqual(round, node);
  assert.ok(node.mastery_statement.length > 0);
  assert.ok(node.why_it_matters.length > 0);
  assert.ok(node.evidence_map.length > 0);
  assert.ok('misconception_slots' in node);
});

test('parseNodeSet round-trips and rejects an invalid status', () => {
  const nodeSet: NodeSet = {
    node_set_id: 'nodeset_X',
    course_id: 'MDLD602',
    subtopic_id: 'CLO1-ST2',
    clo_ids: ['CLO-1'],
    prepares_for_assessment_ids: ['A1'],
    nodes: [sampleNode()],
    generator_divergence_notes: [],
    status: 'draft',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  assert.deepEqual(parseNodeSet(JSON.parse(JSON.stringify(nodeSet))), nodeSet);
  assert.throws(() => parseNodeSet({ ...nodeSet, status: 'published' }), NodeEngineValidationError);
});

// ===========================================================================
// 2. Context assembly + deterministic projection (golden reproduction)
// ===========================================================================

test('buildNodeGenerationContext reads the RICH V1 subtopic, parent CLO, frozen A1', () => {
  const bundle = buildV1ContractBundle(COURSE);
  const context = buildNodeGenerationContext(bundle, CRITICAL_EVAL_SUBTOPIC);

  // Rich grounding context preserved (never the lossy clo_topics projection).
  assert.ok(context.subtopic.purpose.length > 0, 'purpose preserved');
  assert.ok(context.subtopic.expected_learning.length > 0, 'expected_learning preserved');
  assert.ok(context.subtopic.possible_node_families.length > 0, 'possible_node_families preserved');
  assert.equal(context.subtopic.cognitive_level, 'Analyze');

  // Parent CLO + frozen assessment links.
  assert.deepEqual(context.parent_clos.map((c) => c.clo_id), ['CLO-1']);
  assert.deepEqual(context.prepares_for_assessment_ids, ['A1'], 'frozen A1 id');
  assert.equal(context.connected_assessments[0].assessment_id, 'A1');
  assert.equal(context.is_assessment_facing, true);
  assert.ok(context.sibling_subtopics.length > 0, 'sibling subtopics present');

  // The prompt is built from the rich subtopic (sanity: prompt carries purpose).
  const messages = buildNodeGenerationMessages(context);
  assert.equal(messages[0].role, 'system');
  assert.ok(messages[1].content.includes(context.subtopic.purpose.slice(0, 24)));
});

test('GOLDEN: projectNodeSet reproduces the critical-evaluation node-set', () => {
  const bundle = buildV1ContractBundle(COURSE);
  const context = buildNodeGenerationContext(bundle, CRITICAL_EVAL_SUBTOPIC);
  const nodeSet = projectNodeSet(loadProposal(), context, { now: '2026-01-01T00:00:00.000Z' });

  // 4-7 node set with an explicit prerequisite order.
  assert.ok(nodeSet.nodes.length >= 4 && nodeSet.nodes.length <= 7, 'within 4-7 grain');
  assert.equal(nodeSet.grain_justification, undefined, 'no grain adjustment for 7 nodes');
  assert.deepEqual(nodeSet.nodes.map((n) => n.order), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(nodeSet.status, 'draft', 'no auto-proceed: set is draft');

  // The worked node — "Distinguish description from critical evaluation".
  const distinction = nodeSet.nodes.find((n) => n.node_id === 'node_critical-eval_1')!;
  assert.ok(distinction, 'distinction node present');
  assert.equal(distinction.node_type, 'distinction');
  assert.equal(
    distinction.knowledge_component,
    'Separate describing a framework from evaluating it with criteria, evidence, and context'
  );
  assert.equal(distinction.status, 'draft');

  // Mandatory primary Evidence Check with the deterministic id + signals.
  assert.equal(
    distinction.primary_evidence_check_requirement.evidence_check_id,
    'ec_node_node_critical-eval_1_primary'
  );
  assert.deepEqual(distinction.primary_evidence_check_requirement.must_capture_signals, [
    'response',
    'reasoning',
    'confidence',
  ]);
  assert.equal(
    distinction.primary_evidence_check_requirement.preferred_evidence_mode,
    'classify_and_justify',
    'response-mode, never a modality'
  );

  // Misconception: eval-vs-opinion is a CANDIDATE (no approved registry entry),
  // so misconception_slots is pending and there are no bindings (Clarification 2).
  assert.equal(distinction.misconception_slots, 'pending');
  assert.equal(distinction.misconception_bindings.length, 0);
  const candidate = distinction.candidate_misconceptions[0];
  assert.equal(candidate.candidate_misconception_id, 'eval-vs-opinion');
  assert.equal(candidate.statement, 'evaluation means saying whether I like it');
  assert.ok(candidate.reason.length > 0);

  // A1-assessment-facing → prepares_for_assessment_id is the frozen A1 id.
  assert.equal(distinction.prepares_for_assessment_id, 'A1');

  // Type divergence from possible_node_families [application, judgment] is noted.
  assert.ok((distinction.generator_divergence_note ?? '').length > 0);

  // Reaches the subtopic's Analyze/Evaluate level (at least one judgment node).
  assert.ok(nodeSet.nodes.some((n) => n.node_type === 'judgment'));

  // Every node carries exactly one deterministic primary EC requirement.
  for (const node of nodeSet.nodes) {
    assert.equal(
      node.primary_evidence_check_requirement.evidence_check_id,
      `ec_node_${node.node_id}_primary`
    );
    assert.ok(node.clo_ids.includes('CLO-1'), 'CLO FK inherited');
    assert.equal(node.parent_subtopic_id, CRITICAL_EVAL_SUBTOPIC);
  }

  // Bridge node auto-flagged for SME governance (§1.5) + carries cross-CLO link.
  const bridge = nodeSet.nodes.find((n) => n.node_type === 'bridge')!;
  assert.ok(bridge.risk_classification.includes('bridge'));
  assert.equal(bridge.cross_clo_links[0].clo_id, 'CLO-4');

  // Prerequisite graph wired: node 2 depends on the distinction node.
  assert.ok(distinction.dependent_node_ids.length > 0, 'distinction has dependents');
});

test('projectNodeSet records grain_justification when the count is outside 4-7', () => {
  const bundle = buildV1ContractBundle(COURSE);
  const context = buildNodeGenerationContext(bundle, CRITICAL_EVAL_SUBTOPIC);

  // Three nodes, no justification supplied → projection must flag it.
  const tooFew: RawNodeSetProposal = {
    nodes: loadProposal().nodes.slice(0, 3),
  };
  const flagged = projectNodeSet(tooFew, context, { now: '2026-01-01T00:00:00.000Z' });
  assert.equal(flagged.nodes.length, 3);
  assert.ok((flagged.grain_justification ?? '').length > 0, 'grain_justification recorded');

  // A supplied justification is preserved verbatim.
  const withReason: RawNodeSetProposal = {
    grain_justification: 'Fused two near-duplicate KCs into one node.',
    nodes: loadProposal().nodes.slice(0, 3),
  };
  const kept = projectNodeSet(withReason, context, {});
  assert.equal(kept.grain_justification, 'Fused two near-duplicate KCs into one node.');
});

test('projectNodeSet binds an APPROVED misconception (else proposes a candidate)', () => {
  const bundle = buildV1ContractBundle(COURSE);
  const context = buildNodeGenerationContext(bundle, CRITICAL_EVAL_SUBTOPIC);

  const registry: ApprovedMisconceptionEntry[] = [
    {
      misconception_id: 'eval-vs-opinion',
      statement: 'evaluation means saying whether I like it',
      severity: 'high',
      trap: 'an item that invites an opinion-style answer where a criteria-based judgment is required',
      expected_error_pattern: 'learner judges by preference rather than by criteria/evidence/context',
      confirming_probe: 'ask the learner to justify the judgment; a criteria-free justification confirms it',
      blocks_submission_if_state: 'confirmed',
      clearance_rule: 'one_clean_demonstration',
    },
  ];

  const nodeSet = projectNodeSet(loadProposal(), context, {
    approvedMisconceptionRegistry: registry,
    now: '2026-01-01T00:00:00.000Z',
  });
  const distinction = nodeSet.nodes.find((n) => n.node_id === 'node_critical-eval_1')!;

  // Now an approved entry exists → it binds, slots populated, blocks A1 submission.
  assert.equal(distinction.misconception_slots, 'populated');
  assert.equal(distinction.misconception_bindings.length, 1);
  assert.equal(distinction.misconception_bindings[0].misconception_id, 'eval-vs-opinion');
  assert.equal(distinction.misconception_bindings[0].blocks_submission_if_state, 'confirmed');
  assert.equal(distinction.candidate_misconceptions.length, 0, 'no leftover candidate once bound');
});

// ===========================================================================
// 3. Orchestrator (injected executor) + human approval gate
// ===========================================================================

test('generateNodeSet runs end-to-end with an injected executor (no model, no DB)', async () => {
  const proposalJson = readFileSync(join(FIXTURES_DIR, 'nodeset_proposal_critical-eval.json'), 'utf-8');

  const nodeSet = await generateNodeSet(COURSE, CRITICAL_EVAL_SUBTOPIC, {
    executor: async () => proposalJson,
    ground: false,
    persist: false,
  });

  assert.equal(nodeSet.subtopic_id, CRITICAL_EVAL_SUBTOPIC);
  assert.equal(nodeSet.status, 'draft');
  assert.ok(nodeSet.nodes.length >= 4 && nodeSet.nodes.length <= 7);
  assert.ok(nodeSet.nodes.every((n) => n.status === 'draft'), 'every node is draft (Level 0-1)');
  assert.ok(
    nodeSet.nodes.every(
      (n) => n.primary_evidence_check_requirement.evidence_check_id === `ec_node_${n.node_id}_primary`
    ),
    'mandatory primary EC on every node'
  );
});

test('approveNodeSet gates draft → approved; only approved nodes emit to M8', () => {
  const TEMP_COURSE = 'M7TEST';
  const dir = join(process.cwd(), '..', 'data', 'courses', TEMP_COURSE);
  try {
    const bundle = buildV1ContractBundle(COURSE);
    const context = buildNodeGenerationContext(bundle, CRITICAL_EVAL_SUBTOPIC);
    const draft = projectNodeSet(loadProposal(), context, { now: '2026-01-01T00:00:00.000Z' });
    saveNodeSetArtifact(TEMP_COURSE, CRITICAL_EVAL_SUBTOPIC, draft);

    // Before approval, nothing emits to M8 (scope guard / no auto-proceed).
    assert.deepEqual(getApprovedNodesForM8(TEMP_COURSE, CRITICAL_EVAL_SUBTOPIC), []);

    // This projected draft has no reference grounding, so the academic-approval
    // guard requires an explicit override reason (recorded for audit).
    const approved = approveNodeSet(TEMP_COURSE, CRITICAL_EVAL_SUBTOPIC, {
      approver: 'sme@test',
      overrideReason: 'unit test: grounding not exercised here',
    });
    assert.equal(approved.status, 'approved');
    assert.ok(approved.nodes.every((n) => n.status === 'approved'));
    assert.equal(approved.approved_by, 'sme@test');
    assert.equal(approved.academic_override_reason, 'unit test: grounding not exercised here');

    const emitted = getApprovedNodesForM8(TEMP_COURSE, CRITICAL_EVAL_SUBTOPIC);
    assert.equal(emitted.length, draft.nodes.length, 'all approved nodes emit to M8');

    // The persisted artifact is schema-valid on re-read.
    const reread = getNodeSetArtifact(TEMP_COURSE, CRITICAL_EVAL_SUBTOPIC);
    assert.ok(reread);
  } finally {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});
