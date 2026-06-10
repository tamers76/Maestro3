/**
 * Stage 5A Service — Structural Assembly & Adaptive Logic Validation
 *
 * Purpose: Verify that the adaptive system behaves correctly before
 * academic approval or deployment.
 *
 * This stage assembles all components into a runnable adaptive course model
 * and validates adaptive path integrity, mastery protection, diagnostic
 * explainability, assessment trigger accuracy, and workload accumulation.
 *
 * No new assets are created. No AI calls are made.
 */

import * as neo4j from './neo4j.service.js';
import * as fileService from './file.service.js';
import {
  startStageProgress,
  updateProgress,
  completeStageProgress,
  errorStageProgress,
  type CouncilInfo
} from './progress.service.js';
import type {
  StageResult,
  LearningNode,
  CLO,
  Stage3NodeLogic,
  AdaptiveCourseModel,
  AdaptiveNodeSnapshot,
  AdaptiveEdge,
  Stage5AValidationReport,
  Stage5ACheckResult,
  Stage5AViolation,
  Stage5ACheckCategory,
  Stage5AGraphSummary,
  Stage5AWorkloadBounds,
  Stage5AReportSummary,
  SimulatedLearnerPath
} from '../models/schemas.js';

// ============================================================================
// HELPERS
// ============================================================================

let violationCounter = 0;

function nextViolationId(): string {
  return `V-${++violationCounter}`;
}

function resetViolationCounter(): void {
  violationCounter = 0;
}

/**
 * Determine if a node qualifies for LLM-interactive assessment.
 * (Mirror of the logic in stage4.service.ts to avoid cross-import.)
 */
function requiresLLMInteractive(
  node: LearningNode,
  stage3Logic: Stage3NodeLogic | undefined
): boolean {
  if (!stage3Logic) return false;
  if (node.risk_level === 'high') return true;
  const reasoningTypes = ['application', 'transfer', 'principle'];
  if (
    reasoningTypes.includes(node.node_type as string) &&
    stage3Logic.progression_rules.gate_strictness === 'strict'
  ) {
    return true;
  }
  const hasHighSeverityFailure = stage3Logic.failure_types.some(ft => ft.severity === 'high');
  if (hasHighSeverityFailure && ['concept', 'principle'].includes(node.node_type as string)) {
    return true;
  }
  return false;
}

// ============================================================================
// PHASE 1 — ASSEMBLE ADAPTIVE COURSE MODEL
// ============================================================================

async function assembleAdaptiveModel(
  courseCode: string
): Promise<{
  model: AdaptiveCourseModel;
  nodes: LearningNode[];
  clos: CLO[];
  stage3Map: Map<string, Stage3NodeLogic>;
}> {
  const course = await neo4j.getCourse(courseCode);
  if (!course) throw new Error(`Course ${courseCode} not found`);

  const clos = await neo4j.getCLOs(courseCode);
  const nodes = await neo4j.getLearningNodes(courseCode);

  if (nodes.length === 0) {
    throw new Error('No learning nodes found. Please run Stage 2 first.');
  }

  // Load Stage 3 logic
  const stage3Map = new Map<string, Stage3NodeLogic>();
  const snapshot = fileService.getStage3Snapshot(courseCode);
  if (snapshot?.nodes) {
    for (const logic of snapshot.nodes) {
      stage3Map.set(logic.node_id, logic);
    }
  } else {
    // Fallback: parse per-node stage3_logic_json
    for (const node of nodes) {
      if (node.stage3_logic_json) {
        try {
          const logic = JSON.parse(node.stage3_logic_json) as Stage3NodeLogic;
          stage3Map.set(node.node_id, logic);
        } catch { /* skip */ }
      }
    }
  }

  // Build edges from prerequisite_nodes
  const edges: AdaptiveEdge[] = [];
  for (const node of nodes) {
    for (const prereqId of node.prerequisite_nodes || []) {
      edges.push({ source_node_id: node.node_id, target_node_id: prereqId });
    }
  }

  // Summative assessment data
  const summativePack = fileService.getStage4SummativeAssessments(courseCode);
  const summativeCoverage = summativePack?.clo_coverage_matrix || [];

  // Build node snapshots
  const adaptiveNodes: AdaptiveNodeSnapshot[] = nodes.map(node => {
    const s3 = stage3Map.get(node.node_id);
    const contentPack = fileService.getStage4NodeContent(courseCode, node.node_id);
    const hasDiag = fileService.getStage4DiagnosticAssessment(courseCode, node.node_id) !== null;
    const hasLLM = fileService.getStage4LLMInteractiveSpec(courseCode, node.node_id) !== null;
    const hasRem = fileService.getStage4RemediationPack(courseCode, node.node_id) !== null;
    const hasPkg = fileService.getStage4InstructionalPackage(courseCode, node.node_id) !== null;
    const hasPlan = fileService.getStage4ModalityPlan(courseCode, node.node_id) !== null;

    return {
      node_id: node.node_id,
      clo_id: node.clo_id,
      topic_id: node.topic_id,
      node_type: node.node_type as string,
      learning_intent: node.learning_intent,
      risk_level: node.risk_level,
      required_status: node.required_status || (node.mandatory ? 'mandatory' : 'optional'),
      skipping_eligibility: node.skipping_eligibility || (node.skippable ? 'skippable' : 'non_skippable'),
      skip_conditions: node.skip_conditions || '',
      prerequisite_nodes: node.prerequisite_nodes || [],
      has_stage3_logic: !!s3,
      gate_strictness: s3?.progression_rules.gate_strictness,
      mastery_threshold: s3?.progression_rules.mastery_threshold,
      blocks_downstream: s3?.progression_rules.blocks_downstream,
      failure_type_count: s3?.failure_types.length || 0,
      remediation_path_count: s3?.remediation_paths.length || 0,
      preknowledge_eligible: s3?.preknowledge_check_logic.eligible,
      has_diagnostic_assessment: hasDiag,
      has_llm_interactive_spec: hasLLM,
      has_remediation_pack: hasRem,
      has_instructional_package: hasPkg,
      has_modality_plan: hasPlan,
      time_on_task_minutes: contentPack?.time_on_task_minutes || 0
    };
  });

  const totalWorkloadMinutes = adaptiveNodes.reduce((s, n) => s + n.time_on_task_minutes, 0);
  const HOURS_PER_CREDIT = 15;
  const expectedHours = course.credit_hours * HOURS_PER_CREDIT;

  const model: AdaptiveCourseModel = {
    course_code: courseCode,
    title: course.title,
    credit_hours: course.credit_hours,
    clo_count: clos.length,
    node_count: nodes.length,
    nodes: adaptiveNodes,
    edges,
    has_summative_pack: !!summativePack,
    summative_total_weight: summativePack?.total_weight || 0,
    summative_clo_coverage: summativeCoverage.map(c => ({
      clo_id: c.clo_id,
      status: c.coverage_status
    })),
    total_workload_minutes: totalWorkloadMinutes,
    expected_hours: expectedHours,
    assembled_at: new Date().toISOString()
  };

  return { model, nodes, clos, stage3Map };
}

// ============================================================================
// PHASE 2 — VALIDATORS
// ============================================================================

// ---------------------------------------------------------------------------
// 1) Adaptive Path Integrity
// ---------------------------------------------------------------------------

function validateAdaptivePathIntegrity(
  model: AdaptiveCourseModel
): Stage5ACheckResult[] {
  const results: Stage5ACheckResult[] = [];
  const nodeSet = new Set(model.nodes.map(n => n.node_id));
  const nodeMap = new Map(model.nodes.map(n => [n.node_id, n]));

  // 1a) No circular prerequisites (course-wide cycle detection)
  {
    const violations: Stage5AViolation[] = [];
    // Build adjacency list
    const adj = new Map<string, string[]>();
    for (const edge of model.edges) {
      if (!adj.has(edge.source_node_id)) adj.set(edge.source_node_id, []);
      adj.get(edge.source_node_id)!.push(edge.target_node_id);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();
    const cyclePaths: string[][] = [];

    function dfs(nodeId: string, path: string[]): void {
      visited.add(nodeId);
      recStack.add(nodeId);
      path.push(nodeId);

      for (const neighbor of adj.get(nodeId) || []) {
        if (!visited.has(neighbor)) {
          dfs(neighbor, path);
        } else if (recStack.has(neighbor)) {
          // Extract cycle
          const cycleStart = path.indexOf(neighbor);
          cyclePaths.push([...path.slice(cycleStart), neighbor]);
        }
      }

      recStack.delete(nodeId);
      path.pop();
    }

    for (const n of model.nodes) {
      if (!visited.has(n.node_id)) {
        dfs(n.node_id, []);
      }
    }

    for (const cycle of cyclePaths) {
      violations.push({
        violation_id: nextViolationId(),
        category: 'adaptive_path_integrity',
        severity: 'error',
        message: `Circular prerequisite detected: ${cycle.join(' → ')}`,
        affected_node_ids: cycle,
        details: { cycle }
      });
    }

    results.push({
      check_id: 'API-1',
      check_name: 'No circular prerequisites',
      category: 'adaptive_path_integrity',
      passed: violations.length === 0,
      message: violations.length === 0
        ? 'No circular prerequisites detected'
        : `${cyclePaths.length} cycle(s) detected in the prerequisite graph`,
      violations
    });
  }

  // 1b) No orphan nodes (dangling prereq references + unreachable nodes)
  {
    const violations: Stage5AViolation[] = [];

    // Dangling prereq references
    for (const node of model.nodes) {
      for (const prereqId of node.prerequisite_nodes) {
        if (!nodeSet.has(prereqId)) {
          violations.push({
            violation_id: nextViolationId(),
            category: 'adaptive_path_integrity',
            severity: 'error',
            message: `Node ${node.node_id} references non-existent prerequisite ${prereqId}`,
            affected_node_ids: [node.node_id],
            details: { missing_prereq: prereqId }
          });
        }
      }
    }

    // Unreachable nodes: within each CLO subgraph, find nodes not reachable
    // from any root (a root = node with 0 prereqs within the same CLO).
    const cloGroups = new Map<string, AdaptiveNodeSnapshot[]>();
    for (const node of model.nodes) {
      if (!cloGroups.has(node.clo_id)) cloGroups.set(node.clo_id, []);
      cloGroups.get(node.clo_id)!.push(node);
    }

    let orphanCount = 0;
    for (const [cloId, cloNodes] of cloGroups) {
      const cloNodeIds = new Set(cloNodes.map(n => n.node_id));
      // Build reverse adjacency (dependent → prereqs) within CLO
      // We want forward reachability from roots, so build forward adj
      const fwdAdj = new Map<string, string[]>();
      for (const n of cloNodes) {
        // n depends on its prerequisite_nodes; so edges go prereq → n
        for (const prereqId of n.prerequisite_nodes) {
          if (cloNodeIds.has(prereqId)) {
            if (!fwdAdj.has(prereqId)) fwdAdj.set(prereqId, []);
            fwdAdj.get(prereqId)!.push(n.node_id);
          }
        }
      }

      // Find roots (nodes with 0 prereqs within this CLO)
      const roots = cloNodes.filter(n =>
        n.prerequisite_nodes.filter(pid => cloNodeIds.has(pid)).length === 0
      );

      // BFS from roots
      const reachable = new Set<string>();
      const queue = roots.map(r => r.node_id);
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (reachable.has(current)) continue;
        reachable.add(current);
        for (const child of fwdAdj.get(current) || []) {
          if (!reachable.has(child)) queue.push(child);
        }
      }

      for (const n of cloNodes) {
        if (!reachable.has(n.node_id)) {
          orphanCount++;
          violations.push({
            violation_id: nextViolationId(),
            category: 'adaptive_path_integrity',
            severity: 'warning',
            message: `Node ${n.node_id} is unreachable from any root in CLO ${cloId}`,
            affected_node_ids: [n.node_id],
            affected_clo_ids: [cloId]
          });
        }
      }
    }

    const errCount = violations.filter(v => v.severity === 'error').length;
    results.push({
      check_id: 'API-2',
      check_name: 'No orphan nodes',
      category: 'adaptive_path_integrity',
      passed: errCount === 0,
      message: violations.length === 0
        ? 'All nodes are reachable and have valid prerequisite references'
        : `${errCount} error(s), ${orphanCount} unreachable node(s)`,
      violations
    });
  }

  // 1c) No illegal skips
  {
    const violations: Stage5AViolation[] = [];

    // Build a dependents map (who depends on this node?)
    const dependentsMap = new Map<string, string[]>();
    for (const edge of model.edges) {
      // edge.source_node_id depends on edge.target_node_id
      if (!dependentsMap.has(edge.target_node_id)) dependentsMap.set(edge.target_node_id, []);
      dependentsMap.get(edge.target_node_id)!.push(edge.source_node_id);
    }

    for (const node of model.nodes) {
      // High-risk must be non_skippable
      if (node.risk_level === 'high' && node.skipping_eligibility !== 'non_skippable') {
        violations.push({
          violation_id: nextViolationId(),
          category: 'adaptive_path_integrity',
          severity: 'error',
          message: `High-risk node ${node.node_id} must be non_skippable but is ${node.skipping_eligibility}`,
          affected_node_ids: [node.node_id]
        });
      }

      // blocks_downstream + has dependents → must be non_skippable
      const hasDependents = (dependentsMap.get(node.node_id) || []).length > 0;
      if (node.blocks_downstream && hasDependents) {
        if (node.skipping_eligibility === 'skippable' || node.skipping_eligibility === 'conditionally_skippable') {
          violations.push({
            violation_id: nextViolationId(),
            category: 'adaptive_path_integrity',
            severity: 'error',
            message: `Node ${node.node_id} blocks downstream and has dependents but is ${node.skipping_eligibility}`,
            affected_node_ids: [node.node_id]
          });
        }
      }

      // Non-skippable/not_applicable must not have skip_conditions
      if (
        node.skipping_eligibility !== 'skippable' &&
        node.skipping_eligibility !== 'conditionally_skippable' &&
        node.skip_conditions.trim().length > 0
      ) {
        violations.push({
          violation_id: nextViolationId(),
          category: 'adaptive_path_integrity',
          severity: 'warning',
          message: `Node ${node.node_id} is ${node.skipping_eligibility} but has non-empty skip_conditions`,
          affected_node_ids: [node.node_id]
        });
      }
    }

    results.push({
      check_id: 'API-3',
      check_name: 'No illegal skips',
      category: 'adaptive_path_integrity',
      passed: violations.filter(v => v.severity === 'error').length === 0,
      message: violations.length === 0
        ? 'All skip rules are consistent with risk levels and dependency structure'
        : `${violations.length} skip rule violation(s) found`,
      violations
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// 2) Mastery Protection
// ---------------------------------------------------------------------------

function validateMasteryProtection(
  model: AdaptiveCourseModel,
  stage3Map: Map<string, Stage3NodeLogic>
): Stage5ACheckResult[] {
  const results: Stage5ACheckResult[] = [];
  const nodeMap = new Map(model.nodes.map(n => [n.node_id, n]));

  // Dependents map
  const dependentsMap = new Map<string, string[]>();
  for (const edge of model.edges) {
    if (!dependentsMap.has(edge.target_node_id)) dependentsMap.set(edge.target_node_id, []);
    dependentsMap.get(edge.target_node_id)!.push(edge.source_node_id);
  }

  // 2a) High-risk bypass prevention invariants
  {
    const violations: Stage5AViolation[] = [];

    for (const node of model.nodes) {
      if (node.risk_level === 'high') {
        const issues: string[] = [];
        if (node.required_status !== 'mandatory') issues.push('not mandatory');
        if (node.skipping_eligibility !== 'non_skippable') issues.push('not non_skippable');
        if (node.gate_strictness !== 'strict') issues.push('gate not strict');
        if (node.mastery_threshold !== 'full') issues.push('mastery threshold not full');
        if (node.blocks_downstream !== true) issues.push('does not block downstream');

        if (issues.length > 0) {
          violations.push({
            violation_id: nextViolationId(),
            category: 'mastery_protection',
            severity: 'error',
            message: `High-risk node ${node.node_id} fails bypass prevention: ${issues.join(', ')}`,
            affected_node_ids: [node.node_id],
            details: { issues }
          });
        }
      }

      // Strict gate + has dependents → must be non_skippable
      if (node.gate_strictness === 'strict') {
        const hasDeps = (dependentsMap.get(node.node_id) || []).length > 0;
        if (hasDeps && node.skipping_eligibility !== 'non_skippable') {
          violations.push({
            violation_id: nextViolationId(),
            category: 'mastery_protection',
            severity: 'error',
            message: `Node ${node.node_id} has strict gating with dependents but is ${node.skipping_eligibility}`,
            affected_node_ids: [node.node_id]
          });
        }
      }
    }

    results.push({
      check_id: 'MP-1',
      check_name: 'High-risk bypass prevention',
      category: 'mastery_protection',
      passed: violations.filter(v => v.severity === 'error').length === 0,
      message: violations.length === 0
        ? 'All high-risk nodes are fully protected'
        : `${violations.length} mastery protection violation(s)`,
      violations
    });
  }

  // 2b) Stage 3 ↔ Stage 4 consistency
  {
    const violations: Stage5AViolation[] = [];

    for (const node of model.nodes) {
      if (!node.has_stage3_logic) continue;

      // Must have diagnostic assessment
      if (!node.has_diagnostic_assessment) {
        violations.push({
          violation_id: nextViolationId(),
          category: 'mastery_protection',
          severity: 'error',
          message: `Node ${node.node_id} has Stage 3 logic but no Stage 4 diagnostic assessment`,
          affected_node_ids: [node.node_id]
        });
      }

      // Must have remediation pack if failure types exist
      const s3 = stage3Map.get(node.node_id);
      if (s3 && s3.failure_types.length > 0 && s3.remediation_paths.length > 0) {
        if (!node.has_remediation_pack) {
          violations.push({
            violation_id: nextViolationId(),
            category: 'mastery_protection',
            severity: 'error',
            message: `Node ${node.node_id} has ${s3.failure_types.length} failure types and ${s3.remediation_paths.length} remediation paths but no Stage 4 remediation pack`,
            affected_node_ids: [node.node_id]
          });
        }
      }

      // Mastery threshold consistency check
      if (node.has_diagnostic_assessment && s3) {
        const diagAssessment = fileService.getStage4DiagnosticAssessment(
          model.course_code,
          node.node_id
        );
        if (diagAssessment) {
          if (diagAssessment.mastery_rules.gate_strictness !== s3.progression_rules.gate_strictness) {
            violations.push({
              violation_id: nextViolationId(),
              category: 'mastery_protection',
              severity: 'warning',
              message: `Node ${node.node_id}: Stage 3 gate_strictness (${s3.progression_rules.gate_strictness}) differs from Stage 4 diagnostic mastery_rules (${diagAssessment.mastery_rules.gate_strictness})`,
              affected_node_ids: [node.node_id]
            });
          }
        }
      }

      // Remediation targets must be valid nodes
      if (s3) {
        for (const rem of s3.remediation_paths) {
          if (rem.target_node_id && !nodeMap.has(rem.target_node_id)) {
            violations.push({
              violation_id: nextViolationId(),
              category: 'mastery_protection',
              severity: 'error',
              message: `Node ${node.node_id}: remediation path ${rem.id} targets non-existent node ${rem.target_node_id}`,
              affected_node_ids: [node.node_id],
              details: { remediation_path_id: rem.id, target_node_id: rem.target_node_id }
            });
          }
        }
      }
    }

    results.push({
      check_id: 'MP-2',
      check_name: 'Stage 3 / Stage 4 mastery consistency',
      category: 'mastery_protection',
      passed: violations.filter(v => v.severity === 'error').length === 0,
      message: violations.length === 0
        ? 'Stage 3 logic and Stage 4 artifacts are consistent for all nodes'
        : `${violations.length} consistency issue(s) found`,
      violations
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// 3) Diagnostic Explainability
// ---------------------------------------------------------------------------

function validateDiagnosticExplainability(
  model: AdaptiveCourseModel,
  stage3Map: Map<string, Stage3NodeLogic>
): Stage5ACheckResult[] {
  const results: Stage5ACheckResult[] = [];
  const violations: Stage5AViolation[] = [];

  for (const node of model.nodes) {
    const s3 = stage3Map.get(node.node_id);
    if (!s3) continue;

    // Load Stage 4 diagnostic to check failure type coverage
    const diagAssessment = fileService.getStage4DiagnosticAssessment(
      model.course_code,
      node.node_id
    );
    const llmSpec = fileService.getStage4LLMInteractiveSpec(
      model.course_code,
      node.node_id
    );
    const remPack = fileService.getStage4RemediationPack(
      model.course_code,
      node.node_id
    );

    for (const ft of s3.failure_types) {
      // Check 1: failure_type is referenced in at least one Stage 4 artifact
      let isReferenced = false;

      // Check diagnostic assessment items
      if (diagAssessment) {
        for (const item of diagAssessment.items) {
          if (item.failure_types_detected.includes(ft.id)) {
            isReferenced = true;
            break;
          }
        }
        // Also check remediation triggers
        if (!isReferenced) {
          for (const trigger of diagAssessment.remediation_triggers) {
            if (trigger.failure_type_id === ft.id) {
              isReferenced = true;
              break;
            }
          }
        }
      }

      // Check LLM probing paths
      if (!isReferenced && llmSpec) {
        for (const pp of llmSpec.probing_paths) {
          if (pp.failure_type_id === ft.id) {
            isReferenced = true;
            break;
          }
        }
      }

      if (!isReferenced) {
        violations.push({
          violation_id: nextViolationId(),
          category: 'diagnostic_explainability',
          severity: 'warning',
          message: `Node ${node.node_id}: failure type ${ft.id} ("${ft.description.substring(0, 60)}") is not referenced by any Stage 4 assessment item or trigger`,
          affected_node_ids: [node.node_id],
          details: { failure_type_id: ft.id }
        });
      }

      // Check 2: failure type has at least one remediation path (Stage 3)
      const hasRemPath = s3.remediation_paths.some(rp => rp.failure_type_id === ft.id);
      if (!hasRemPath) {
        violations.push({
          violation_id: nextViolationId(),
          category: 'diagnostic_explainability',
          severity: 'warning',
          message: `Node ${node.node_id}: failure type ${ft.id} has no Stage 3 remediation path`,
          affected_node_ids: [node.node_id],
          details: { failure_type_id: ft.id }
        });
      }

      // Check 3: failure type has at least one remediation asset (Stage 4)
      if (remPack) {
        const hasAsset = remPack.assets.some(a => a.failure_type_id === ft.id);
        if (!hasAsset) {
          violations.push({
            violation_id: nextViolationId(),
            category: 'diagnostic_explainability',
            severity: 'warning',
            message: `Node ${node.node_id}: failure type ${ft.id} has no Stage 4 remediation asset`,
            affected_node_ids: [node.node_id],
            details: { failure_type_id: ft.id }
          });
        }
      }
    }

    // Check observable signals reference valid failure type IDs
    for (const sig of s3.observable_signals) {
      const validFtIds = new Set(s3.failure_types.map(ft => ft.id));
      for (const ftId of sig.failure_type_ids) {
        if (!validFtIds.has(ftId)) {
          violations.push({
            violation_id: nextViolationId(),
            category: 'diagnostic_explainability',
            severity: 'warning',
            message: `Node ${node.node_id}: observable signal ${sig.id} references unknown failure type ${ftId}`,
            affected_node_ids: [node.node_id],
            details: { signal_id: sig.id, failure_type_id: ftId }
          });
        }
      }
    }
  }

  results.push({
    check_id: 'DE-1',
    check_name: 'Diagnostic explainability coverage',
    category: 'diagnostic_explainability',
    passed: violations.filter(v => v.severity === 'error').length === 0,
    message: violations.length === 0
      ? 'All failure types are covered by assessments, triggers, and remediation'
      : `${violations.length} explainability gap(s) found`,
    violations
  });

  return results;
}

// ---------------------------------------------------------------------------
// 4) Assessment Trigger Accuracy
// ---------------------------------------------------------------------------

function validateAssessmentTriggerAccuracy(
  model: AdaptiveCourseModel,
  nodes: LearningNode[],
  stage3Map: Map<string, Stage3NodeLogic>
): Stage5ACheckResult[] {
  const results: Stage5ACheckResult[] = [];
  const nodeMap = new Map(nodes.map(n => [n.node_id, n]));

  // 4a) Diagnostic assessment presence
  {
    const violations: Stage5AViolation[] = [];

    for (const snap of model.nodes) {
      if (snap.has_stage3_logic && !snap.has_diagnostic_assessment) {
        violations.push({
          violation_id: nextViolationId(),
          category: 'assessment_trigger_accuracy',
          severity: 'error',
          message: `Node ${snap.node_id} has Stage 3 logic but missing diagnostic assessment`,
          affected_node_ids: [snap.node_id]
        });
      }
    }

    results.push({
      check_id: 'ATA-1',
      check_name: 'Diagnostic assessment presence',
      category: 'assessment_trigger_accuracy',
      passed: violations.length === 0,
      message: violations.length === 0
        ? 'All nodes with Stage 3 logic have diagnostic assessments'
        : `${violations.length} node(s) missing diagnostic assessments`,
      violations
    });
  }

  // 4b) LLM-interactive spec presence for qualifying nodes
  {
    const violations: Stage5AViolation[] = [];

    for (const snap of model.nodes) {
      const node = nodeMap.get(snap.node_id);
      const s3 = stage3Map.get(snap.node_id);
      if (node && requiresLLMInteractive(node, s3) && !snap.has_llm_interactive_spec) {
        violations.push({
          violation_id: nextViolationId(),
          category: 'assessment_trigger_accuracy',
          severity: 'error',
          message: `Node ${snap.node_id} qualifies for LLM-interactive assessment but has no spec`,
          affected_node_ids: [snap.node_id]
        });
      }
    }

    results.push({
      check_id: 'ATA-2',
      check_name: 'LLM-interactive spec completeness',
      category: 'assessment_trigger_accuracy',
      passed: violations.length === 0,
      message: violations.length === 0
        ? 'All qualifying nodes have LLM-interactive specs'
        : `${violations.length} qualifying node(s) missing LLM-interactive specs`,
      violations
    });
  }

  // 4c) LLM-interactive scope constraints
  {
    const violations: Stage5AViolation[] = [];
    const nodeSet = new Set(model.nodes.map(n => n.node_id));

    for (const snap of model.nodes) {
      if (!snap.has_llm_interactive_spec) continue;
      const spec = fileService.getStage4LLMInteractiveSpec(model.course_code, snap.node_id);
      if (!spec) continue;

      // allowed_scope.node_id should be this node
      if (spec.allowed_scope.node_id !== snap.node_id) {
        violations.push({
          violation_id: nextViolationId(),
          category: 'assessment_trigger_accuracy',
          severity: 'warning',
          message: `Node ${snap.node_id}: LLM spec allowed_scope.node_id is ${spec.allowed_scope.node_id} (expected ${snap.node_id})`,
          affected_node_ids: [snap.node_id]
        });
      }

      // Prereq node IDs in scope must be actual prerequisites
      for (const pid of spec.allowed_scope.prerequisite_node_ids) {
        if (!snap.prerequisite_nodes.includes(pid) && !nodeSet.has(pid)) {
          violations.push({
            violation_id: nextViolationId(),
            category: 'assessment_trigger_accuracy',
            severity: 'warning',
            message: `Node ${snap.node_id}: LLM spec references out-of-scope prerequisite ${pid}`,
            affected_node_ids: [snap.node_id],
            details: { out_of_scope_prereq: pid }
          });
        }
      }
    }

    results.push({
      check_id: 'ATA-3',
      check_name: 'LLM-interactive scope constraints',
      category: 'assessment_trigger_accuracy',
      passed: violations.length === 0,
      message: violations.length === 0
        ? 'All LLM-interactive specs reference only valid scope'
        : `${violations.length} scope constraint issue(s)`,
      violations
    });
  }

  // 4d) Summative assessment pack
  {
    const violations: Stage5AViolation[] = [];

    if (!model.has_summative_pack) {
      violations.push({
        violation_id: nextViolationId(),
        category: 'assessment_trigger_accuracy',
        severity: 'error',
        message: 'No summative assessment pack found',
      });
    } else {
      if (Math.abs(model.summative_total_weight - 100) > 1) {
        violations.push({
          violation_id: nextViolationId(),
          category: 'assessment_trigger_accuracy',
          severity: 'error',
          message: `Summative assessment weights total ${model.summative_total_weight}%, expected 100%`,
          details: { total_weight: model.summative_total_weight }
        });
      }

      for (const cov of model.summative_clo_coverage) {
        if (cov.status === 'none') {
          violations.push({
            violation_id: nextViolationId(),
            category: 'assessment_trigger_accuracy',
            severity: 'error',
            message: `CLO ${cov.clo_id} has no summative assessment coverage`,
            affected_clo_ids: [cov.clo_id]
          });
        }
      }
    }

    results.push({
      check_id: 'ATA-4',
      check_name: 'Summative assessment coverage and weights',
      category: 'assessment_trigger_accuracy',
      passed: violations.filter(v => v.severity === 'error').length === 0,
      message: violations.length === 0
        ? 'Summative assessments cover all CLOs with correct weights'
        : `${violations.length} summative assessment issue(s)`,
      violations
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// 5) Workload Accumulation Sanity
// ---------------------------------------------------------------------------

// (Workload validation is handled by validateWorkloadAccumulationFull below)

// ============================================================================
// PHASE 3 — GRAPH SUMMARY
// ============================================================================

function computeGraphSummary(model: AdaptiveCourseModel): Stage5AGraphSummary {
  const nodeSet = new Set(model.nodes.map(n => n.node_id));

  // Build forward adjacency (prereq → dependent)
  const fwdAdj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const n of model.nodes) {
    inDegree.set(n.node_id, 0);
    outDegree.set(n.node_id, 0);
  }

  for (const edge of model.edges) {
    if (!nodeSet.has(edge.source_node_id) || !nodeSet.has(edge.target_node_id)) continue;
    // edge.source_node_id depends on edge.target_node_id
    // so forward direction: target → source (target comes first in learning)
    if (!fwdAdj.has(edge.target_node_id)) fwdAdj.set(edge.target_node_id, []);
    fwdAdj.get(edge.target_node_id)!.push(edge.source_node_id);

    inDegree.set(edge.source_node_id, (inDegree.get(edge.source_node_id) || 0) + 1);
    outDegree.set(edge.target_node_id, (outDegree.get(edge.target_node_id) || 0) + 1);
  }

  const rootNodes = model.nodes.filter(n => (inDegree.get(n.node_id) || 0) === 0).length;
  const leafNodes = model.nodes.filter(n => (outDegree.get(n.node_id) || 0) === 0).length;

  // Compute max depth via topological order + longest path
  const depths = new Map<string, number>();
  // Kahn's algorithm for topological order
  const queue: string[] = [];
  const tempInDegree = new Map(inDegree);

  for (const [nid, deg] of tempInDegree) {
    if (deg === 0) {
      queue.push(nid);
      depths.set(nid, 0);
    }
  }

  let maxDepth = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depths.get(current) || 0;

    for (const child of fwdAdj.get(current) || []) {
      const newDepth = currentDepth + 1;
      if (newDepth > (depths.get(child) || 0)) {
        depths.set(child, newDepth);
      }
      if (newDepth > maxDepth) maxDepth = newDepth;

      const remaining = (tempInDegree.get(child) || 0) - 1;
      tempInDegree.set(child, remaining);
      if (remaining === 0) {
        queue.push(child);
      }
    }
  }

  // Orphan count: nodes not visited by topological sort (if cycles or isolated)
  const visited = new Set(depths.keys());
  const orphanNodes = model.nodes.filter(n => !visited.has(n.node_id)).length;

  return {
    total_nodes: model.nodes.length,
    total_edges: model.edges.length,
    root_nodes: rootNodes,
    leaf_nodes: leafNodes,
    orphan_nodes: orphanNodes,
    max_depth: maxDepth
  };
}

// ============================================================================
// PHASE 4 — LEARNER PATH SIMULATION (Optional)
// ============================================================================

function simulateLearnerPaths(
  model: AdaptiveCourseModel
): SimulatedLearnerPath[] {
  const paths: SimulatedLearnerPath[] = [];
  const nodeMap = new Map(model.nodes.map(n => [n.node_id, n]));

  // Dependents map: who depends on node X?
  const dependentsMap = new Map<string, Set<string>>();
  for (const edge of model.edges) {
    if (!dependentsMap.has(edge.target_node_id)) dependentsMap.set(edge.target_node_id, new Set());
    dependentsMap.get(edge.target_node_id)!.add(edge.source_node_id);
  }

  // Strategy 1: Complete all nodes
  {
    const visited = model.nodes.map(n => n.node_id);
    const totalMinutes = model.nodes.reduce((s, n) => s + n.time_on_task_minutes, 0);
    paths.push({
      path_id: 'SIM-1',
      strategy: 'complete_all',
      nodes_visited: visited,
      nodes_skipped: [],
      total_minutes: totalMinutes,
      mastery_violations: [],
      is_valid: true
    });
  }

  // Strategy 2: Skip all eligible nodes
  {
    const skippable = new Set(
      model.nodes
        .filter(n => n.skipping_eligibility === 'skippable' || n.skipping_eligibility === 'conditionally_skippable')
        .map(n => n.node_id)
    );

    // But cannot skip if a dependent of this node has strict gating and needs it
    // For simplicity: skip only if the node doesn't block downstream
    const actuallySkipped: string[] = [];
    const visited: string[] = [];

    for (const node of model.nodes) {
      if (skippable.has(node.node_id) && !node.blocks_downstream) {
        actuallySkipped.push(node.node_id);
      } else {
        visited.push(node.node_id);
      }
    }

    const totalMinutes = visited.reduce((s, nid) => {
      const n = nodeMap.get(nid);
      return s + (n?.time_on_task_minutes || 0);
    }, 0);

    // Check mastery violations: did we skip a node that some strict-gate dependent requires?
    const masteryViolations: string[] = [];
    for (const skippedId of actuallySkipped) {
      const deps = dependentsMap.get(skippedId) || new Set();
      for (const depId of deps) {
        const depNode = nodeMap.get(depId);
        if (depNode && depNode.gate_strictness === 'strict' && !actuallySkipped.includes(depId)) {
          masteryViolations.push(skippedId);
          break;
        }
      }
    }

    paths.push({
      path_id: 'SIM-2',
      strategy: 'skip_all_eligible',
      nodes_visited: visited,
      nodes_skipped: actuallySkipped,
      total_minutes: totalMinutes,
      mastery_violations: masteryViolations,
      is_valid: masteryViolations.length === 0
    });
  }

  return paths;
}

// ============================================================================
// PHASE 5 — MARKDOWN REPORT RENDERER
// ============================================================================

function renderReportMarkdown(
  report: Stage5AValidationReport,
  model: AdaptiveCourseModel,
  simulations?: SimulatedLearnerPath[]
): string {
  const lines: string[] = [];

  lines.push(`# Stage 5A — System Integrity Check`);
  lines.push(`\n**Course:** ${model.title} (${model.course_code})`);
  lines.push(`**Generated:** ${report.generated_at}`);
  lines.push(`**Overall Status:** ${report.is_valid ? 'PASSED' : 'FAILED'}\n`);

  lines.push('---\n');

  // Summary
  lines.push('## Summary\n');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Checks | ${report.summary.total_checks} |`);
  lines.push(`| Passed | ${report.summary.passed_checks} |`);
  lines.push(`| Failed | ${report.summary.failed_checks} |`);
  lines.push(`| Violations (Error) | ${report.summary.error_count} |`);
  lines.push(`| Violations (Warning) | ${report.summary.warning_count} |`);
  lines.push(`| Violations (Info) | ${report.summary.info_count} |`);
  lines.push('');

  // Graph Summary
  lines.push('## Graph Summary\n');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Nodes | ${report.graph_summary.total_nodes} |`);
  lines.push(`| Total Edges | ${report.graph_summary.total_edges} |`);
  lines.push(`| Root Nodes | ${report.graph_summary.root_nodes} |`);
  lines.push(`| Leaf Nodes | ${report.graph_summary.leaf_nodes} |`);
  lines.push(`| Orphan Nodes | ${report.graph_summary.orphan_nodes} |`);
  lines.push(`| Max Depth | ${report.graph_summary.max_depth} |`);
  lines.push('');

  // Workload Bounds
  lines.push('## Workload Bounds\n');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Expected | ${Math.round(report.workload_bounds.expected_minutes / 60)}h (${report.workload_bounds.expected_minutes}m) |`);
  lines.push(`| Max Path (all nodes) | ${Math.round(report.workload_bounds.max_path_minutes / 60)}h (${report.workload_bounds.max_path_minutes}m) [${report.workload_bounds.max_deviation_percent > 0 ? '+' : ''}${report.workload_bounds.max_deviation_percent}%] |`);
  lines.push(`| Min Path (skip eligible) | ${Math.round(report.workload_bounds.min_path_minutes / 60)}h (${report.workload_bounds.min_path_minutes}m) [${report.workload_bounds.min_deviation_percent > 0 ? '+' : ''}${report.workload_bounds.min_deviation_percent}%] |`);
  lines.push('');

  // Detailed Check Results
  lines.push('## Detailed Check Results\n');

  const categories: Stage5ACheckCategory[] = [
    'adaptive_path_integrity',
    'mastery_protection',
    'diagnostic_explainability',
    'assessment_trigger_accuracy',
    'workload_accumulation'
  ];

  const categoryLabels: Record<Stage5ACheckCategory, string> = {
    adaptive_path_integrity: 'Adaptive Path Integrity',
    mastery_protection: 'Mastery Protection',
    diagnostic_explainability: 'Diagnostic Explainability',
    assessment_trigger_accuracy: 'Assessment Trigger Accuracy',
    workload_accumulation: 'Workload Accumulation'
  };

  for (const cat of categories) {
    const catChecks = report.checks.filter(c => c.category === cat);
    if (catChecks.length === 0) continue;

    lines.push(`### ${categoryLabels[cat]}\n`);

    for (const check of catChecks) {
      const icon = check.passed ? 'PASS' : 'FAIL';
      lines.push(`**[${icon}] ${check.check_name}** (${check.check_id})`);
      lines.push(`> ${check.message}\n`);

      if (check.violations.length > 0) {
        for (const v of check.violations) {
          const sevLabel = v.severity.toUpperCase();
          lines.push(`- [${sevLabel}] ${v.message}`);
        }
        lines.push('');
      }
    }
  }

  // Simulations (if provided)
  if (simulations && simulations.length > 0) {
    lines.push('## Learner Path Simulations\n');

    for (const sim of simulations) {
      const valid = sim.is_valid ? 'VALID' : 'INVALID';
      lines.push(`### ${sim.path_id}: ${sim.strategy} [${valid}]\n`);
      lines.push(`- Nodes visited: ${sim.nodes_visited.length}`);
      lines.push(`- Nodes skipped: ${sim.nodes_skipped.length}`);
      lines.push(`- Total time: ${Math.round(sim.total_minutes / 60)}h (${sim.total_minutes}m)`);
      if (sim.mastery_violations.length > 0) {
        lines.push(`- Mastery violations: ${sim.mastery_violations.join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ============================================================================
// MAIN RUNNER
// ============================================================================

export interface Stage5AOptions {
  simulate?: boolean;  // Run learner path simulations (default: true)
}

export async function runStage5A(
  courseCode: string,
  options?: Stage5AOptions
): Promise<StageResult> {
  const { simulate = true } = options || {};
  resetViolationCounter();

  try {
    console.log('Stage 5A: Starting adaptive logic validation for', courseCode);

    const council: CouncilInfo = {
      mode: 'single',
      memberCount: 1,
      models: ['Validation Engine'],
      chairmanModel: 'Validation Engine'
    };

    startStageProgress(courseCode, 5, 'Stage 5A: Initializing adaptive logic validation', council);

    // ----------------------------------------------------------------
    // PHASE 1: Assemble model
    // ----------------------------------------------------------------
    updateProgress({
      courseCode,
      stage: 5,
      status: 'running',
      step: 'Assembling adaptive course model',
      message: 'Loading nodes, Stage 3 logic, Stage 4 artifacts...',
      council
    });

    const { model, nodes, clos, stage3Map } = await assembleAdaptiveModel(courseCode);
    fileService.saveStage5aAdaptiveModel(courseCode, model);

    console.log(`Stage 5A: Assembled model with ${model.node_count} nodes, ${model.edges.length} edges`);

    // ----------------------------------------------------------------
    // PHASE 2: Run validators
    // ----------------------------------------------------------------
    updateProgress({
      courseCode,
      stage: 5,
      status: 'running',
      step: 'Running validation checks',
      message: 'Checking adaptive path integrity...',
      council
    });

    const allChecks: Stage5ACheckResult[] = [];

    // 1) Adaptive Path Integrity
    allChecks.push(...validateAdaptivePathIntegrity(model));

    updateProgress({
      courseCode,
      stage: 5,
      status: 'running',
      step: 'Running validation checks',
      message: 'Checking mastery protection...',
      council
    });

    // 2) Mastery Protection
    allChecks.push(...validateMasteryProtection(model, stage3Map));

    updateProgress({
      courseCode,
      stage: 5,
      status: 'running',
      step: 'Running validation checks',
      message: 'Checking diagnostic explainability...',
      council
    });

    // 3) Diagnostic Explainability
    allChecks.push(...validateDiagnosticExplainability(model, stage3Map));

    updateProgress({
      courseCode,
      stage: 5,
      status: 'running',
      step: 'Running validation checks',
      message: 'Checking assessment trigger accuracy...',
      council
    });

    // 4) Assessment Trigger Accuracy
    allChecks.push(...validateAssessmentTriggerAccuracy(model, nodes, stage3Map));

    updateProgress({
      courseCode,
      stage: 5,
      status: 'running',
      step: 'Running validation checks',
      message: 'Checking workload accumulation...',
      council
    });

    // 5) Workload Accumulation
    const { checks: workloadChecks, bounds: workloadBounds } = validateWorkloadAccumulationFull(model);
    allChecks.push(...workloadChecks);

    // ----------------------------------------------------------------
    // PHASE 3: Compute graph summary
    // ----------------------------------------------------------------
    const graphSummary = computeGraphSummary(model);

    // ----------------------------------------------------------------
    // PHASE 4: Optional learner path simulations
    // ----------------------------------------------------------------
    let simulations: SimulatedLearnerPath[] | undefined;
    if (simulate) {
      updateProgress({
        courseCode,
        stage: 5,
        status: 'running',
        step: 'Simulating learner paths',
        message: 'Running path simulations...',
        council
      });
      simulations = simulateLearnerPaths(model);
    }

    // ----------------------------------------------------------------
    // PHASE 5: Build report
    // ----------------------------------------------------------------
    const allViolations = allChecks.flatMap(c => c.violations);

    const summary: Stage5AReportSummary = {
      total_checks: allChecks.length,
      passed_checks: allChecks.filter(c => c.passed).length,
      failed_checks: allChecks.filter(c => !c.passed).length,
      total_violations: allViolations.length,
      error_count: allViolations.filter(v => v.severity === 'error').length,
      warning_count: allViolations.filter(v => v.severity === 'warning').length,
      info_count: allViolations.filter(v => v.severity === 'info').length
    };

    const report: Stage5AValidationReport = {
      course_code: courseCode,
      is_valid: summary.error_count === 0,
      summary,
      graph_summary: graphSummary,
      workload_bounds: workloadBounds,
      checks: allChecks,
      all_violations: allViolations,
      generated_at: new Date().toISOString()
    };

    // Persist
    fileService.saveStage5aValidationReport(courseCode, report);
    const markdown = renderReportMarkdown(report, model, simulations);
    fileService.saveStage5aReportMarkdown(courseCode, markdown);

    const statusLabel = report.is_valid ? 'PASSED' : 'FAILED';
    const summaryMsg = `Stage 5A ${statusLabel}: ${summary.passed_checks}/${summary.total_checks} checks passed | ${summary.error_count} errors, ${summary.warning_count} warnings | Graph: ${graphSummary.total_nodes} nodes, ${graphSummary.total_edges} edges, depth ${graphSummary.max_depth} | Workload: ${Math.round(workloadBounds.min_path_minutes / 60)}h–${Math.round(workloadBounds.max_path_minutes / 60)}h (expected ${model.expected_hours}h)`;

    console.log(`Stage 5A: Complete. ${summaryMsg}`);
    completeStageProgress(courseCode, 5, summaryMsg);

    return {
      success: true,
      stage: 5,
      message: summaryMsg,
      data: {
        course_code: courseCode,
        is_valid: report.is_valid,
        summary,
        graph_summary: graphSummary,
        workload_bounds: workloadBounds,
        check_count: allChecks.length,
        violation_count: allViolations.length,
        simulations: simulations || []
      }
    };
  } catch (error) {
    console.error('Stage 5A Error:', error);
    errorStageProgress(courseCode, 5, error instanceof Error ? error.message : String(error));
    return {
      success: false,
      stage: 5,
      message: 'Failed to complete Stage 5A',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Proper workload validation that returns both checks and bounds
 */
function validateWorkloadAccumulationFull(
  model: AdaptiveCourseModel
): { checks: Stage5ACheckResult[]; bounds: Stage5AWorkloadBounds } {
  const checks: Stage5ACheckResult[] = [];
  const violations: Stage5AViolation[] = [];

  const expectedMinutes = model.expected_hours * 60;

  // Max path: all nodes
  const maxPathMinutes = model.nodes.reduce((s, n) => s + n.time_on_task_minutes, 0);

  // Min path: skip all skippable/conditionally_skippable that don't block downstream
  const minPathMinutes = model.nodes
    .filter(n =>
      n.skipping_eligibility !== 'skippable' &&
      n.skipping_eligibility !== 'conditionally_skippable'
    )
    .reduce((s, n) => s + n.time_on_task_minutes, 0);

  const TOLERANCE = 0.10;
  const upperBound = expectedMinutes * (1 + TOLERANCE);
  const lowerBound = expectedMinutes * (1 - TOLERANCE);

  const maxDeviation = expectedMinutes > 0
    ? Math.round(((maxPathMinutes - expectedMinutes) / expectedMinutes) * 100)
    : 0;
  const minDeviation = expectedMinutes > 0
    ? Math.round(((minPathMinutes - expectedMinutes) / expectedMinutes) * 100)
    : 0;

  if (maxPathMinutes > upperBound) {
    violations.push({
      violation_id: nextViolationId(),
      category: 'workload_accumulation',
      severity: 'warning',
      message: `Maximum path workload (${Math.round(maxPathMinutes / 60)}h) exceeds expected ${model.expected_hours}h by ${Math.abs(maxDeviation)}%`,
      details: { max_path_minutes: maxPathMinutes, expected_minutes: expectedMinutes }
    });
  }

  if (minPathMinutes < lowerBound) {
    violations.push({
      violation_id: nextViolationId(),
      category: 'workload_accumulation',
      severity: 'warning',
      message: `Minimum path workload (${Math.round(minPathMinutes / 60)}h) is below expected ${model.expected_hours}h by ${Math.abs(minDeviation)}%`,
      details: { min_path_minutes: minPathMinutes, expected_minutes: expectedMinutes }
    });
  }

  // Check if any node has 0 time (missing Stage 4 content)
  const zeroTimeNodes = model.nodes.filter(n => n.time_on_task_minutes === 0);
  if (zeroTimeNodes.length > 0) {
    violations.push({
      violation_id: nextViolationId(),
      category: 'workload_accumulation',
      severity: 'warning',
      message: `${zeroTimeNodes.length} node(s) have 0 time-on-task (missing Stage 4 content?)`,
      affected_node_ids: zeroTimeNodes.map(n => n.node_id),
      details: { count: zeroTimeNodes.length }
    });
  }

  checks.push({
    check_id: 'WA-1',
    check_name: 'Workload accumulation sanity',
    category: 'workload_accumulation',
    passed: violations.filter(v => v.severity === 'error').length === 0,
    message: violations.length === 0
      ? `Workload bounds (${Math.round(minPathMinutes / 60)}h–${Math.round(maxPathMinutes / 60)}h) are within tolerance of ${model.expected_hours}h expected`
      : `${violations.length} workload issue(s) found`,
    violations
  });

  const bounds: Stage5AWorkloadBounds = {
    max_path_minutes: maxPathMinutes,
    min_path_minutes: minPathMinutes,
    expected_minutes: expectedMinutes,
    max_deviation_percent: maxDeviation,
    min_deviation_percent: minDeviation
  };

  return { checks, bounds };
}

// ============================================================================
// RETRIEVAL FUNCTIONS
// ============================================================================

export function getStage5AReport(courseCode: string): Stage5AValidationReport | null {
  return fileService.getStage5aValidationReport(courseCode);
}

export function getStage5AModel(courseCode: string): AdaptiveCourseModel | null {
  return fileService.getStage5aAdaptiveModel(courseCode);
}

export function getStage5AReportMarkdown(courseCode: string): string | null {
  return fileService.getStage5aReportMarkdown(courseCode);
}
