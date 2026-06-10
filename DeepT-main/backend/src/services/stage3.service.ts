import { callAI, parseAIJson, getCouncilInfo, getStageConfig, type CouncilProgressCallback } from './ai.service.js';
import * as neo4j from './neo4j.service.js';
import * as fileService from './file.service.js';
import { buildStage3Prompt } from '../utils/prompts.js';
import { startStageProgress, updateProgress, completeStageProgress, errorStageProgress, type CouncilInfo } from './progress.service.js';
import type {
  StageResult, LearningNode, StageExecutionMode, SkippingEligibility, RequiredStatus,
  Stage3NodeLogic, Stage3Snapshot, GateStrictness,
  FailureType, ObservableSignal, RemediationPath, ProgressionRules, PreknowledgeCheckLogic,
  Stage3IncompleteNode, Stage3IncompleteReport
} from '../models/schemas.js';

// Helper to create a council progress callback for a stage
function createCouncilProgressCallback(
  courseCode: string, 
  stage: number, 
  step: string, 
  councilInfo: CouncilInfo
): CouncilProgressCallback {
  return {
    onMemberComplete: (model: string, completed: number, total: number) => {
      updateProgress({
        courseCode,
        stage,
        status: 'running',
        step,
        message: `Council deliberating: ${completed}/${total} members responded`,
        council: {
          ...councilInfo,
          phase: 'deliberating',
          completedModels: councilInfo.models.slice(0, completed)
        }
      });
    },
    onSynthesisStart: (chairmanModel: string, memberCount: number) => {
      updateProgress({
        courseCode,
        stage,
        status: 'running',
        step,
        message: `All ${memberCount} council members submitted. Chairman synthesizing responses...`,
        council: {
          ...councilInfo,
          phase: 'synthesizing',
          completedModels: councilInfo.models
        }
      });
    }
  };
}

// ============================================================================
// AI Response Interfaces (raw from AI before normalization)
// ============================================================================

interface AIStage3NodeResult {
  node_id: string;
  diagnostic_intent?: string;
  failure_types?: Array<{
    id?: string;
    description?: string;
    misconception_category?: string;
    severity?: string;
  }>;
  observable_signals?: Array<{
    id?: string;
    description?: string;
    failure_type_ids?: string[];
    signal_type?: string;
  }>;
  remediation_paths?: Array<{
    id?: string;
    failure_type_id?: string;
    strategy?: string;
    description?: string;
    target_node_id?: string;
  }>;
  progression_rules?: {
    mastery_definition?: string;
    mastery_threshold?: string;
    gate_strictness?: string;
    blocks_downstream?: boolean;
    rationale?: string;
  };
  preknowledge_check_logic?: {
    eligible?: boolean;
    reasoning_based?: boolean;
    check_description?: string;
    high_risk_override?: boolean;
    explainability_note?: string;
  };
  required_status?: string;
  skipping_eligibility?: string;
  skip_conditions?: string;
  // Legacy fields
  mandatory?: boolean;
  skippable?: boolean;
}

interface AIStage3Result {
  nodes: AIStage3NodeResult[];
}

// ============================================================================
// Normalization helpers
// ============================================================================

function normalizeSkippingEligibility(raw?: string): SkippingEligibility {
  const valid: SkippingEligibility[] = ['non_skippable', 'conditionally_skippable', 'skippable', 'not_applicable'];
  if (raw && valid.includes(raw as SkippingEligibility)) return raw as SkippingEligibility;
  return 'non_skippable';
}

function normalizeRequiredStatus(raw?: string): RequiredStatus {
  if (raw === 'optional') return 'optional';
  return 'mandatory';
}

function normalizeGateStrictness(raw?: string): GateStrictness {
  if (raw === 'flexible') return 'flexible';
  return 'strict';
}

function normalizeMasteryThreshold(raw?: string): 'full' | 'partial' | 'flexible' {
  if (raw === 'partial') return 'partial';
  if (raw === 'flexible') return 'flexible';
  return 'full';
}

function normalizeSeverity(raw?: string): 'low' | 'medium' | 'high' {
  if (raw === 'low') return 'low';
  if (raw === 'high') return 'high';
  return 'medium';
}

type SignalType = 'incorrect_justification' | 'patterned_wrong_answers' | 'missing_reasoning' | 'shallow_explanation' | 'procedural_skip' | 'other';
const VALID_SIGNAL_TYPES: SignalType[] = ['incorrect_justification', 'patterned_wrong_answers', 'missing_reasoning', 'shallow_explanation', 'procedural_skip', 'other'];

function normalizeSignalType(raw?: string): SignalType {
  if (raw && VALID_SIGNAL_TYPES.includes(raw as SignalType)) return raw as SignalType;
  return 'other';
}

type StrategyType = 'revisit_prerequisite' | 'alternative_explanation' | 'contrasting_example' | 'targeted_feedback' | 'scaffolded_practice' | 'peer_discussion' | 'other';
const VALID_STRATEGIES: StrategyType[] = ['revisit_prerequisite', 'alternative_explanation', 'contrasting_example', 'targeted_feedback', 'scaffolded_practice', 'peer_discussion', 'other'];

function normalizeStrategy(raw?: string): StrategyType {
  if (raw && VALID_STRATEGIES.includes(raw as StrategyType)) return raw as StrategyType;
  return 'other';
}

/**
 * Normalize a single AI node result into a fully validated Stage3NodeLogic.
 *
 * IMPORTANT: inputNode only carries the six allowed Stage 2 fields.
 * We do NOT use Stage 2 failure_meaning or diagnostic_intent as fallbacks —
 * Stage 3 must generate these independently.  Missing fields are left empty
 * (caught later by validateNodeLogic).
 */
function normalizeNodeLogic(raw: AIStage3NodeResult, inputNode: { learning_intent: string; risk_level: string; node_type: string }): Stage3NodeLogic {
  // Map failure types — no placeholder fabrication for empty descriptions
  const failureTypes: FailureType[] = (raw.failure_types || []).map((ft, i) => ({
    id: ft.id || `FT-${i + 1}`,
    description: ft.description || '',
    misconception_category: ft.misconception_category || '',
    severity: normalizeSeverity(ft.severity)
  }));

  // Map observable signals — no placeholder fabrication
  const observableSignals: ObservableSignal[] = (raw.observable_signals || []).map((sig, i) => ({
    id: sig.id || `SIG-${i + 1}`,
    description: sig.description || '',
    failure_type_ids: sig.failure_type_ids || [],
    signal_type: normalizeSignalType(sig.signal_type)
  }));

  // Map remediation paths — no placeholder fabrication
  const remediationPaths: RemediationPath[] = (raw.remediation_paths || []).map((rem, i) => ({
    id: rem.id || `REM-${i + 1}`,
    failure_type_id: rem.failure_type_id || '',
    strategy: normalizeStrategy(rem.strategy),
    description: rem.description || '',
    target_node_id: rem.target_node_id || undefined
  }));

  const progressionRules: ProgressionRules = {
    mastery_definition: raw.progression_rules?.mastery_definition || '',
    mastery_threshold: normalizeMasteryThreshold(raw.progression_rules?.mastery_threshold),
    gate_strictness: normalizeGateStrictness(raw.progression_rules?.gate_strictness),
    blocks_downstream: raw.progression_rules?.blocks_downstream ?? (inputNode.risk_level === 'high'),
    rationale: raw.progression_rules?.rationale || ''
  };

  const preknowledgeCheckLogic: PreknowledgeCheckLogic = {
    eligible: raw.preknowledge_check_logic?.eligible ?? false,
    reasoning_based: raw.preknowledge_check_logic?.reasoning_based ?? true,
    check_description: raw.preknowledge_check_logic?.check_description || '',
    high_risk_override: raw.preknowledge_check_logic?.high_risk_override ?? (inputNode.risk_level === 'high'),
    explainability_note: raw.preknowledge_check_logic?.explainability_note || ''
  };

  return {
    node_id: raw.node_id,
    diagnostic_intent: raw.diagnostic_intent || '',
    failure_types: failureTypes,
    observable_signals: observableSignals,
    remediation_paths: remediationPaths,
    progression_rules: progressionRules,
    preknowledge_check_logic: preknowledgeCheckLogic,
    required_status: normalizeRequiredStatus(raw.required_status),
    skipping_eligibility: normalizeSkippingEligibility(raw.skipping_eligibility),
    skip_conditions: raw.skip_conditions || ''
  };
}

/** Check for forbidden content keys that indicate the AI generated assessment items */
function hasForbiddenContent(nodeObj: Record<string, unknown>): string[] {
  const forbidden = ['questions', 'question', 'quiz', 'assignment', 'assignments', 'mcq', 'mcqs', 'options', 'video', 'videos', 'content', 'instructional_content'];
  return forbidden.filter(key => key in nodeObj);
}

// ============================================================================
// Validation — detect Stage 3 Incomplete nodes (no placeholder fabrication)
// ============================================================================

/**
 * Validate that a Stage3NodeLogic has ALL required A–F elements.
 * Returns a list of missing element names. Empty list = complete.
 */
function validateNodeLogic(logic: Stage3NodeLogic): string[] {
  const missing: string[] = [];

  // Step A — Diagnostic Intent
  if (!logic.diagnostic_intent || logic.diagnostic_intent.trim().length === 0) {
    missing.push('diagnostic_intent');
  }

  // Step B — Failure Types (need at least 1 with a non-empty description)
  if (logic.failure_types.length === 0) {
    missing.push('failure_types');
  } else {
    const hasValidFT = logic.failure_types.some(ft => ft.description && ft.description.trim().length > 0);
    if (!hasValidFT) missing.push('failure_types');
  }

  // Step C — Observable Signals (need at least 1 with description + mapped to failure types)
  if (logic.observable_signals.length === 0) {
    missing.push('observable_signals');
  } else {
    const hasValidSig = logic.observable_signals.some(
      sig => sig.description && sig.description.trim().length > 0 && sig.failure_type_ids.length > 0
    );
    if (!hasValidSig) missing.push('observable_signals');
  }

  // Step D — Remediation Paths (need at least 1 with description + mapped failure_type_id)
  if (logic.remediation_paths.length === 0) {
    missing.push('remediation_paths');
  } else {
    const hasValidRem = logic.remediation_paths.some(
      rem => rem.description && rem.description.trim().length > 0 && rem.failure_type_id && rem.failure_type_id.trim().length > 0
    );
    if (!hasValidRem) missing.push('remediation_paths');
  }

  // Step E — Progression Rules
  if (!logic.progression_rules.mastery_definition || logic.progression_rules.mastery_definition.trim().length === 0) {
    missing.push('progression_rules.mastery_definition');
  }
  if (!logic.progression_rules.rationale || logic.progression_rules.rationale.trim().length === 0) {
    missing.push('progression_rules.rationale');
  }

  // Step F — Pre-Knowledge Check Logic (only if eligible)
  if (logic.preknowledge_check_logic.eligible) {
    if (!logic.preknowledge_check_logic.check_description || logic.preknowledge_check_logic.check_description.trim().length === 0) {
      missing.push('preknowledge_check_logic.check_description');
    }
    if (!logic.preknowledge_check_logic.explainability_note || logic.preknowledge_check_logic.explainability_note.trim().length === 0) {
      missing.push('preknowledge_check_logic.explainability_note');
    }
  }

  return missing;
}

// ============================================================================
// Risk / Skip Enforcement — deterministic overrides after normalization
// ============================================================================

/**
 * Apply deterministic risk and skipping enforcement rules that override
 * whatever the AI produced when the rules require it.
 *
 * Rules enforced:
 *  - High-risk → mandatory, non_skippable, strict gate, full mastery, blocks downstream, pre-check ineligible
 *  - reasoning_based is ALWAYS forced to true
 *  - If skipping_eligibility is not skippable/conditionally_skippable → pre-check ineligible
 */
function enforceRiskRules(logic: Stage3NodeLogic, riskLevel: string): Stage3NodeLogic {
  // Always enforce: pre-checks must test reasoning, never recall
  logic.preknowledge_check_logic.reasoning_based = true;

  // High-risk enforcement
  if (riskLevel === 'high') {
    logic.required_status = 'mandatory';
    logic.skipping_eligibility = 'non_skippable';
    logic.skip_conditions = '';
    logic.progression_rules.gate_strictness = 'strict';
    logic.progression_rules.mastery_threshold = 'full';
    logic.progression_rules.blocks_downstream = true;
    logic.preknowledge_check_logic.eligible = false;
    logic.preknowledge_check_logic.high_risk_override = true;
  }

  // Eligibility consistency: non-skippable/not_applicable nodes cannot have pre-check
  if (logic.skipping_eligibility !== 'skippable' && logic.skipping_eligibility !== 'conditionally_skippable') {
    logic.preknowledge_check_logic.eligible = false;
  }

  return logic;
}

// ============================================================================
// MAIN STAGE 3 FUNCTION
// ============================================================================

export async function runStage3(courseCode: string, executionOverride?: StageExecutionMode): Promise<StageResult> {
  try {
    console.log('Stage 3: Starting assessment intelligence analysis for', courseCode);
    
    // Get council info for progress reporting
    const councilInfo = getCouncilInfo(3, executionOverride);
    const council: CouncilInfo = {
      mode: councilInfo.mode,
      memberCount: councilInfo.memberCount,
      models: councilInfo.models,
      chairmanModel: councilInfo.chairmanModel,
      phase: councilInfo.mode === 'council' ? 'deliberating' : undefined
    };
    
    // Get stage config for custom prompts
    const stageConfig = getStageConfig(3);
    
    startStageProgress(courseCode, 3, 'Initializing assessment intelligence analysis', council);
    
    // Get existing learning nodes
    const nodes = await neo4j.getLearningNodes(courseCode);
    
    if (nodes.length === 0) {
      throw new Error('No learning nodes found. Please run Stage 2 first.');
    }
    
    // Build a lookup map for input nodes (for fallback values during normalization)
    const inputNodeMap = new Map<string, LearningNode>();
    for (const n of nodes) {
      inputNodeMap.set(n.node_id, n);
    }
    
    // Prepare node summary for AI — ONLY the six fields Stage 3 spec permits:
    // node_id, node_type, learning_intent, prerequisite_nodes, risk_level, skippability flag
    // Do NOT include: failure_meaning, diagnostic_intent, required_status, topic_id
    const nodeSummary = nodes.map(n => ({
      node_id: n.node_id,
      node_type: n.node_type,
      learning_intent: n.learning_intent,
      prerequisite_nodes: n.prerequisite_nodes,
      risk_level: n.risk_level,
      skipping_eligibility: n.skipping_eligibility || 'non_skippable'
    }));
    
    console.log(`Stage 3: Analyzing ${nodes.length} nodes for assessment intelligence...`);
    
    // Batch nodes to avoid output truncation — the rich Stage 3 schema
    // produces ~500-800 tokens per node, so we keep batches small
    const BATCH_SIZE = 5;
    const batches: typeof nodeSummary[] = [];
    for (let i = 0; i < nodeSummary.length; i += BATCH_SIZE) {
      batches.push(nodeSummary.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`Stage 3: Processing ${batches.length} batches of up to ${BATCH_SIZE} nodes each`);
    
    const allRawNodes: AIStage3NodeResult[] = [];
    
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      const batchLabel = `Batch ${batchIdx + 1}/${batches.length}`;
      
      updateProgress({
        courseCode,
        stage: 3,
        status: 'running',
        step: `Analyzing assessment intelligence (${batchLabel})`,
        message: `AI is analyzing nodes ${batchIdx * BATCH_SIZE + 1}–${Math.min((batchIdx + 1) * BATCH_SIZE, nodes.length)} of ${nodes.length} for diagnostic rules, failure types, remediation paths, and progression logic...`,
        council
      });
      
      const prompt = buildStage3Prompt(batch, stageConfig.taskPrompt);
      const progressCallback = council.mode === 'council'
        ? createCouncilProgressCallback(courseCode, 3, `Analyzing assessment intelligence (${batchLabel})`, council)
        : undefined;
      
      const response = await callAI(
        [
          { 
            role: 'system', 
            content: 'You are a JSON API. You ONLY output valid JSON objects. Never include explanations, markdown, or any text outside the JSON structure. Start your response with { and end with }. You must NOT generate any actual assessment questions, quiz items, or instructional content — only assessment LOGIC and rules.' 
          },
          { role: 'user', content: prompt }
        ],
        3,
        { jsonMode: true, maxTokens: 16384, progressCallback },
        executionOverride
      );
      
      console.log(`Stage 3: ${batchLabel} AI response received, parsing...`);
      let batchResult = parseAIJson<AIStage3Result>(response);
      
      // Handle case where AI returns array directly instead of {nodes: [...]}
      if (Array.isArray(batchResult)) {
        console.log(`Stage 3: ${batchLabel} AI returned nodes as direct array, wrapping...`);
        batchResult = { nodes: batchResult as unknown as AIStage3Result['nodes'] };
      }
      
      // Validate that result has nodes array
      if (!batchResult || !batchResult.nodes || !Array.isArray(batchResult.nodes)) {
        console.error(`Stage 3: ${batchLabel} Invalid AI response - missing nodes array`);
        console.error(`Stage 3: ${batchLabel} Received result:`, JSON.stringify(batchResult, null, 2));
        throw new Error(`Invalid AI response in ${batchLabel}: Expected 'nodes' array but got ${batchResult ? typeof batchResult.nodes : 'null result'}`);
      }
      
      // Check for forbidden content in AI output
      for (const rawNode of batchResult.nodes) {
        const forbidden = hasForbiddenContent(rawNode as unknown as Record<string, unknown>);
        if (forbidden.length > 0) {
          console.warn(`Stage 3: Node ${rawNode.node_id} contained forbidden keys: ${forbidden.join(', ')} — stripping them`);
          for (const key of forbidden) {
            delete (rawNode as unknown as Record<string, unknown>)[key];
          }
        }
      }
      
      allRawNodes.push(...batchResult.nodes);
      console.log(`Stage 3: ${batchLabel} processed ${batchResult.nodes.length} nodes (total so far: ${allRawNodes.length})`);
    }
    
    // Combine all batch results
    const result: AIStage3Result = { nodes: allRawNodes };
    
    updateProgress({
      courseCode,
      stage: 3,
      status: 'running',
      step: 'Normalizing and validating',
      message: 'Validating and normalizing Stage 3 assessment intelligence...',
      council
    });
    
    // Normalize all node results into Stage3NodeLogic
    const stage3Nodes: Stage3NodeLogic[] = [];
    for (const rawNode of result.nodes) {
      const inputNode = inputNodeMap.get(rawNode.node_id);
      if (!inputNode) {
        console.warn(`Stage 3: AI returned unknown node_id ${rawNode.node_id}, skipping`);
        continue;
      }
      
      const normalized = normalizeNodeLogic(rawNode, {
        learning_intent: inputNode.learning_intent,
        risk_level: inputNode.risk_level,
        node_type: inputNode.node_type as string
      });
      stage3Nodes.push(normalized);
    }
    
    // Ensure every input node is represented — omitted nodes get empty shells
    // (they will be caught as Stage 3 Incomplete by validateNodeLogic)
    const returnedNodeIds = new Set(stage3Nodes.map(n => n.node_id));
    for (const inputNode of nodes) {
      if (!returnedNodeIds.has(inputNode.node_id)) {
        console.warn(`Stage 3: AI omitted node ${inputNode.node_id}, creating empty shell (Stage 3 Incomplete)`);
        stage3Nodes.push(normalizeNodeLogic(
          { node_id: inputNode.node_id },
          {
            learning_intent: inputNode.learning_intent,
            risk_level: inputNode.risk_level,
            node_type: inputNode.node_type as string
          }
        ));
      }
    }
    
    // ----------------------------------------------------------------
    // Apply deterministic risk/skip enforcement rules on every node
    // ----------------------------------------------------------------
    for (let i = 0; i < stage3Nodes.length; i++) {
      const inputNode = inputNodeMap.get(stage3Nodes[i].node_id);
      const riskLevel = inputNode?.risk_level || 'high'; // default to strictest if unknown
      stage3Nodes[i] = enforceRiskRules(stage3Nodes[i], riskLevel);
    }

    // ----------------------------------------------------------------
    // Validate completeness of A–F for every node
    // ----------------------------------------------------------------
    const incompleteNodes: Stage3IncompleteNode[] = [];
    for (const logicNode of stage3Nodes) {
      const missingElements = validateNodeLogic(logicNode);
      if (missingElements.length > 0) {
        console.warn(`Stage 3: Node ${logicNode.node_id} is Stage 3 Incomplete — missing: ${missingElements.join(', ')}`);
        incompleteNodes.push({ node_id: logicNode.node_id, missing_elements: missingElements });
      }
    }

    if (incompleteNodes.length > 0) {
      console.warn(`Stage 3: ${incompleteNodes.length} of ${stage3Nodes.length} nodes are Stage 3 Incomplete`);
    }

    // Build and persist incomplete report
    const incompleteReport: Stage3IncompleteReport = {
      course_code: courseCode,
      generated_at: new Date().toISOString(),
      incomplete_count: incompleteNodes.length,
      nodes: incompleteNodes
    };
    fileService.saveStage3IncompleteReport(courseCode, incompleteReport);

    updateProgress({
      courseCode,
      stage: 3,
      status: 'running',
      step: 'Saving to database',
      message: 'Persisting assessment intelligence to database and filesystem...',
      council
    });
    
    // Persist to Neo4j — update each LearningNode with Stage 3 fields
    let updatedCount = 0;
    for (const logicNode of stage3Nodes) {
      const requiredStatus = logicNode.required_status;
      const skippingEligibility = logicNode.skipping_eligibility;
      const mandatory = requiredStatus === 'mandatory';
      const skippable = skippingEligibility === 'skippable' || skippingEligibility === 'conditionally_skippable';
      
      await neo4j.updateLearningNode(logicNode.node_id, {
        mandatory,
        skippable,
        required_status: requiredStatus,
        skipping_eligibility: skippingEligibility,
        skip_conditions: logicNode.skip_conditions || '',
        // Stage 3 assessment intelligence fields
        stage3_logic_json: JSON.stringify(logicNode),
        stage3_preknowledge_eligible: logicNode.preknowledge_check_logic.eligible,
        stage3_gate_strictness: logicNode.progression_rules.gate_strictness
      } as Partial<LearningNode>);
      updatedCount++;
    }
    
    // Compute summary stats
    const mandatoryCount = stage3Nodes.filter(n => n.required_status === 'mandatory').length;
    const optionalCount = stage3Nodes.filter(n => n.required_status === 'optional').length;
    const strictGateCount = stage3Nodes.filter(n => n.progression_rules.gate_strictness === 'strict').length;
    const flexibleGateCount = stage3Nodes.filter(n => n.progression_rules.gate_strictness === 'flexible').length;
    const preknowledgeEligibleCount = stage3Nodes.filter(n => n.preknowledge_check_logic.eligible).length;
    const failureTypesTotal = stage3Nodes.reduce((sum, n) => sum + n.failure_types.length, 0);
    const remediationPathsTotal = stage3Nodes.reduce((sum, n) => sum + n.remediation_paths.length, 0);
    
    // Build and save Stage 3 snapshot to filesystem
    const snapshot: Stage3Snapshot = {
      course_code: courseCode,
      generated_at: new Date().toISOString(),
      node_count: stage3Nodes.length,
      nodes: stage3Nodes,
      summary: {
        total_nodes: stage3Nodes.length,
        mandatory_count: mandatoryCount,
        optional_count: optionalCount,
        strict_gate_count: strictGateCount,
        flexible_gate_count: flexibleGateCount,
        preknowledge_eligible_count: preknowledgeEligibleCount,
        failure_types_total: failureTypesTotal,
        remediation_paths_total: remediationPathsTotal
      }
    };
    fileService.saveStage3Snapshot(courseCode, snapshot);
    
    // Update course stage
    await neo4j.updateCourseStage(courseCode, 3);
    
    console.log('Stage 3: Complete');
    
    // Get updated nodes for response
    const updatedNodes = await neo4j.getLearningNodes(courseCode);
    
    const nonSkippableCount = updatedNodes.filter(n => n.skipping_eligibility === 'non_skippable').length;
    const conditionalCount = updatedNodes.filter(n => n.skipping_eligibility === 'conditionally_skippable').length;
    const skippableCount = updatedNodes.filter(n => n.skipping_eligibility === 'skippable').length;
    
    const incompleteLabel = incompleteNodes.length > 0 ? ` | ${incompleteNodes.length} INCOMPLETE` : '';
    const summaryMsg = `Assessment intelligence for ${updatedCount} nodes: ${mandatoryCount} mandatory, ${optionalCount} optional | Gates: ${strictGateCount} strict, ${flexibleGateCount} flexible | ${failureTypesTotal} failure types, ${remediationPathsTotal} remediation paths | ${preknowledgeEligibleCount} pre-knowledge eligible${incompleteLabel}`;
    
    completeStageProgress(courseCode, 3, summaryMsg);
    
    return {
      success: true,
      stage: 3,
      message: summaryMsg,
      data: {
        course_code: courseCode,
        nodes: updatedNodes,
        snapshot,
        summary: {
          total: updatedCount,
          mandatory: mandatoryCount,
          optional: optionalCount,
          non_skippable: nonSkippableCount,
          conditionally_skippable: conditionalCount,
          skippable: skippableCount,
          strict_gate: strictGateCount,
          flexible_gate: flexibleGateCount,
          preknowledge_eligible: preknowledgeEligibleCount,
          failure_types_total: failureTypesTotal,
          remediation_paths_total: remediationPathsTotal
        }
      }
    };
  } catch (error) {
    console.error('Stage 3 Error:', error);
    errorStageProgress(courseCode, 3, error instanceof Error ? error.message : String(error));
    return {
      success: false,
      stage: 3,
      message: 'Failed to complete Stage 3',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
