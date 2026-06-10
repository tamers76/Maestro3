/**
 * Stage 4 Service - Modality, Content, and Assessment Generation
 * 
 * Expression Stage: Expresses validated learning logic through content and assessments
 * while respecting workload and accreditation constraints.
 * 
 * Produces a complete Course Content Pack including:
 * - Instructional materials (modality-based)
 * - Video scripts (where applicable)
 * - Visual prompts
 * - Three assessment types (Pre-Knowledge, Formative Diagnostic, Mastery Evidence)
 * - Course-level rubric and marking guide
 * - Learner instructions
 * - Workload map with credit alignment
 */

import { callAI, getCouncilInfo, getStageConfig, type CouncilProgressCallback } from './ai.service.js';
import * as neo4j from './neo4j.service.js';
import * as fileService from './file.service.js';
import { 
  buildStage4Prompt,
  buildStage4ModalityContentPrompt,
  buildStage4AssessmentPrompt,
  buildStage4VideoScriptPrompt,
  buildStage4VisualPromptPrompt,
  buildStage4RubricPrompt,
  buildStage4LearnerInstructionsPrompt,
  buildStage4WorkloadPrompt,
  buildStage4ModalityPlanPrompt,
  buildStage4InstructionalPackagePrompt,
  buildStage4DiagnosticAssessmentPrompt,
  buildStage4LLMInteractiveSpecPrompt,
  buildStage4RemediationAssetsPrompt,
  buildStage4VisualAssetSpecPrompt,
  buildStage4VideoProductionPackagePrompt,
  buildStage4SummativeAssessmentsPrompt,
  buildStage4CourseBookChapterPrompt
} from '../utils/prompts.js';
import {
  getModalityConfig,
  shouldHaveVideo,
  getVideoScriptType,
  getAssessmentTypes,
  getContentModalities,
  getContentFocus,
  estimateNodeTime,
  getTimeBreakdown
} from '../utils/modality-mapper.js';
import { 
  startStageProgress, 
  updateItemProgress, 
  updateProgress, 
  completeStageProgress, 
  errorStageProgress, 
  type CouncilInfo 
} from './progress.service.js';
import type { 
  StageResult, 
  LearningNode, 
  CLO, 
  NodeType,
  StageExecutionMode, 
  Stage4Options, 
  Stage4Checkpoint, 
  Stage4ErrorEntry,
  Stage4NodeContent,
  VideoScript,
  NodeAssessment,
  VisualPrompt,
  Stage4AssessmentType,
  NodeWorkload,
  WeeklyWorkload,
  WorkloadMap,
  CourseRubric,
  Stage4ContentPack,
  WeeklyPlanItem,
  Stage3NodeLogic,
  Stage3Snapshot,
  ModalityPlan,
  NodeInstructionalPackage,
  DiagnosticAssessment,
  DiagnosticAssessmentItem,
  LLMInteractiveAssessmentSpec,
  NodeRemediationPack,
  RemediationAsset,
  VisualAssetSpec,
  VideoProductionPackage,
  SummativeAssessmentPack,
  SummativeAssessmentArtifact,
  CourseBook,
  CourseBookChapter,
  EnhancedWorkloadMap,
  Stage4ValidationReport,
  Topic,
  Assessment
} from '../models/schemas.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a council progress callback for a stage
 */
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

/**
 * Parse JSON from AI response, handling markdown code blocks and common issues
 */
function parseAIJson<T>(response: string): T {
  // Remove markdown code blocks if present
  let cleaned = response.trim();
  
  // Handle various markdown code block formats
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  
  cleaned = cleaned.trim();
  
  // Find the actual JSON object/array boundaries
  const jsonStart = cleaned.search(/[\[{]/);
  if (jsonStart > 0) {
    cleaned = cleaned.slice(jsonStart);
  }
  
  // Find the matching closing bracket
  const firstChar = cleaned[0];
  if (firstChar === '{' || firstChar === '[') {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let lastValidEnd = -1;
    
    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{' || char === '[') {
          depth++;
        } else if (char === '}' || char === ']') {
          depth--;
          if (depth === 0) {
            lastValidEnd = i;
            break;
          }
        }
      }
    }
    
    if (lastValidEnd > 0) {
      cleaned = cleaned.slice(0, lastValidEnd + 1);
    }
  }
  
  // Remove control characters that break JSON parsing (except valid whitespace)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Replace smart quotes and other Unicode quote variants with ASCII quotes
  // These are common in AI-generated text and break JSON parsing
  cleaned = cleaned.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"'); // Various double quotes
  cleaned = cleaned.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'"); // Various single quotes
  cleaned = cleaned.replace(/[\u2013\u2014]/g, '-'); // En-dash and em-dash to regular dash
  cleaned = cleaned.replace(/\u2026/g, '...'); // Ellipsis to three dots
  
  // Fix mismatched brackets (AI sometimes closes { with ] or [ with })
  cleaned = fixMismatchedBrackets(cleaned);
  
  // Try to parse
  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    const errorMsg = (firstError as Error).message;
    const errorMatch = errorMsg.match(/position (\d+)/);
    const errorPos = errorMatch ? parseInt(errorMatch[1], 10) : -1;
    
    // Log context around error position for debugging
    if (errorPos > 0) {
      const contextStart = Math.max(0, errorPos - 100);
      const contextEnd = Math.min(cleaned.length, errorPos + 100);
      console.error(`JSON error at position ${errorPos}. Context around error:`);
      console.error('...', cleaned.substring(contextStart, errorPos), '<<<ERROR>>>', cleaned.substring(errorPos, contextEnd), '...');
    }
    
    // Try aggressive JSON repair
    let fixed = cleaned;
    
    // Fix trailing commas before closing brackets
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
    
    // Fix unescaped quotes inside strings by rebuilding the JSON
    fixed = repairJsonStrings(fixed);
    
    try {
      return JSON.parse(fixed);
    } catch (secondError) {
      // Try fixing missing commas between properties (common AI error)
      let fixedCommas = fixed;
      
      // Fix missing comma after string value before next property (handles various whitespace)
      fixedCommas = fixedCommas.replace(/(")\s+(")/g, '$1, $2');
      
      // Fix missing comma after closing brace/bracket before next property
      fixedCommas = fixedCommas.replace(/([}\]])\s+(")/g, '$1, $2');
      
      // Fix missing comma after number before next property
      fixedCommas = fixedCommas.replace(/(\d)\s+(")/g, '$1, $2');
      
      // Fix missing comma after "true", "false", or "null" before next property
      fixedCommas = fixedCommas.replace(/(true|false|null)\s+(")/gi, '$1, $2');
      
      try {
        return JSON.parse(fixedCommas);
      } catch (thirdError) {
        // Try position-based fix on the ORIGINAL cleaned string
        if (errorPos > 0 && errorPos < cleaned.length) {
          const beforeError = cleaned.substring(0, errorPos);
          const afterError = cleaned.substring(errorPos);
          
          // Check if we need a comma (previous char is a value terminator)
          const lastNonWhitespace = beforeError.trimEnd();
          const lastChar = lastNonWhitespace[lastNonWhitespace.length - 1];
          
          if (lastChar === '"' || lastChar === '}' || lastChar === ']' || 
              /[\d]/.test(lastChar) || lastNonWhitespace.endsWith('true') || 
              lastNonWhitespace.endsWith('false') || lastNonWhitespace.endsWith('null')) {
            const fixedAtPosition = lastNonWhitespace + ', ' + afterError.trimStart();
            try {
              return JSON.parse(fixedAtPosition);
            } catch {
              // Also try applying all other fixes after position fix
              let posFixed = fixedAtPosition;
              posFixed = posFixed.replace(/,(\s*[}\]])/g, '$1');
              posFixed = repairJsonStrings(posFixed);
              posFixed = posFixed.replace(/(")\s+(")/g, '$1, $2');
              posFixed = posFixed.replace(/([}\]])\s+(")/g, '$1, $2');
              try {
                return JSON.parse(posFixed);
              } catch {
                // Continue to final fallback
              }
            }
          }
        }
        
        // Final attempt: try to close unclosed brackets/braces
        let closingFix = fixedCommas;
        const openBraces = (closingFix.match(/{/g) || []).length;
        const closeBraces = (closingFix.match(/}/g) || []).length;
        const openBrackets = (closingFix.match(/\[/g) || []).length;
        const closeBrackets = (closingFix.match(/]/g) || []).length;
        
        // Add missing closing brackets/braces
        for (let i = 0; i < openBrackets - closeBrackets; i++) {
          closingFix += ']';
        }
        for (let i = 0; i < openBraces - closeBraces; i++) {
          closingFix += '}';
        }
        
        try {
          return JSON.parse(closingFix);
        } catch {
          // Log details for debugging
          console.error('JSON parse failed. First 500 chars:', cleaned.substring(0, 500));
          console.error('Last 500 chars:', cleaned.substring(Math.max(0, cleaned.length - 500)));
          throw firstError; // Throw original error for better diagnostics
        }
      }
    }
  }
}

/**
 * Attempt to repair JSON strings with unescaped characters
 */
function repairJsonStrings(json: string): string {
  const result: string[] = [];
  let i = 0;
  
  while (i < json.length) {
    const char = json[i];
    
    if (char === '"') {
      // Start of a string - find the end while handling escapes
      result.push(char);
      i++;
      
      while (i < json.length) {
        const strChar = json[i];
        
        if (strChar === '\\') {
          // Escape sequence - include next char
          result.push(strChar);
          i++;
          if (i < json.length) {
            result.push(json[i]);
            i++;
          }
        } else if (strChar === '"') {
          // Check if this is the real end of string or an unescaped quote
          // Look ahead to see if it's followed by valid JSON structure
          const afterQuote = json.substring(i + 1).trimStart();
          if (afterQuote.length === 0 || 
              afterQuote[0] === ',' || 
              afterQuote[0] === '}' || 
              afterQuote[0] === ']' ||
              afterQuote[0] === ':') {
            // This is the real end of the string
            result.push(char);
            i++;
            break;
          } else {
            // This is an unescaped quote inside the string - escape it
            result.push('\\', '"');
            i++;
          }
        } else if (strChar === '\n') {
          // Unescaped newline - escape it
          result.push('\\', 'n');
          i++;
        } else if (strChar === '\r') {
          // Unescaped carriage return - escape it
          result.push('\\', 'r');
          i++;
        } else if (strChar === '\t') {
          // Tab is usually fine but let's be safe
          result.push('\\', 't');
          i++;
        } else {
          result.push(strChar);
          i++;
        }
      }
    } else {
      result.push(char);
      i++;
    }
  }
  
  return result.join('');
}

/**
 * Fix mismatched brackets in JSON (e.g., { closed with ] or [ closed with })
 * This is a common AI error where it confuses object and array syntax
 */
function fixMismatchedBrackets(json: string): string {
  const result: string[] = [];
  const bracketStack: { char: string; index: number }[] = [];
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    
    if (escapeNext) {
      escapeNext = false;
      result.push(char);
      continue;
    }
    
    if (char === '\\' && inString) {
      escapeNext = true;
      result.push(char);
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      result.push(char);
      continue;
    }
    
    if (inString) {
      result.push(char);
      continue;
    }
    
    // Track brackets outside of strings
    if (char === '{' || char === '[') {
      bracketStack.push({ char, index: result.length });
      result.push(char);
    } else if (char === '}' || char === ']') {
      if (bracketStack.length > 0) {
        const lastOpen = bracketStack.pop()!;
        const expectedClose = lastOpen.char === '{' ? '}' : ']';
        
        if (char !== expectedClose) {
          // Mismatch detected - use the correct closing bracket
          console.log(`Fixed bracket mismatch: expected '${expectedClose}' but found '${char}' at position ${i}`);
          result.push(expectedClose);
        } else {
          result.push(char);
        }
      } else {
        // Extra closing bracket - include it anyway
        result.push(char);
      }
    } else {
      result.push(char);
    }
  }
  
  return result.join('');
}

/**
 * Count words in markdown content
 */
function countWords(content: string): number {
  return content.split(/\s+/).filter(word => word.length > 0).length;
}

// ============================================================================
// STAGE 3 LOADING — Build per-node diagnostic logic lookup
// ============================================================================

/**
 * Load Stage 3 snapshot and build a Map<nodeId, Stage3NodeLogic>.
 * Falls back to parsing stage3_logic_json from individual nodes if snapshot is missing.
 */
function loadStage3LogicMap(
  courseCode: string,
  nodes: LearningNode[]
): Map<string, Stage3NodeLogic> {
  const map = new Map<string, Stage3NodeLogic>();

  // Try snapshot first (canonical source)
  const snapshot = fileService.getStage3Snapshot(courseCode);
  if (snapshot && snapshot.nodes) {
    for (const logic of snapshot.nodes) {
      map.set(logic.node_id, logic);
    }
    console.log(`Stage 4: Loaded ${map.size} Stage 3 diagnostic specs from snapshot`);
    return map;
  }

  // Fallback: parse per-node stage3_logic_json stored in Neo4j
  for (const node of nodes) {
    if (node.stage3_logic_json) {
      try {
        const logic = JSON.parse(node.stage3_logic_json) as Stage3NodeLogic;
        map.set(node.node_id, logic);
      } catch {
        console.warn(`Stage 4: Could not parse stage3_logic_json for ${node.node_id}`);
      }
    }
  }
  console.log(`Stage 4: Loaded ${map.size} Stage 3 diagnostic specs from node properties`);
  return map;
}

/**
 * Determine if a node qualifies for LLM-interactive assessment.
 * Returns the qualification reason or null if not needed.
 */
function getLLMInteractiveQualification(
  node: LearningNode,
  stage3Logic: Stage3NodeLogic | undefined
): 'high_risk' | 'reasoning_intensive' | 'recall_gaming_vulnerable' | null {
  if (!stage3Logic) return null;

  // High-risk nodes
  if (node.risk_level === 'high') return 'high_risk';

  // Reasoning-intensive: nodes with strict gating + application/transfer/principle types
  const reasoningTypes = ['application', 'transfer', 'principle'];
  if (
    reasoningTypes.includes(node.node_type) &&
    stage3Logic.progression_rules.gate_strictness === 'strict'
  ) {
    return 'reasoning_intensive';
  }

  // Vulnerable to recall-based gaming: concept/principle nodes with high-severity failure types
  const hasHighSeverityFailure = stage3Logic.failure_types.some(ft => ft.severity === 'high');
  if (hasHighSeverityFailure && ['concept', 'principle'].includes(node.node_type)) {
    return 'recall_gaming_vulnerable';
  }

  return null;
}

// ============================================================================
// STEP A — MODALITY PLAN GENERATION
// ============================================================================

/**
 * Generate a canonical modality plan for a node (Step A — before any content).
 */
async function generateModalityPlan(
  node: LearningNode,
  clo: CLO,
  stage3Logic: Stage3NodeLogic | undefined,
  councilInfo: CouncilInfo,
  courseCode: string,
  executionOverride?: StageExecutionMode
): Promise<ModalityPlan> {
  const config = getModalityConfig(node.node_type);
  const videoJustified = shouldHaveVideo(node.node_type);

  // Determine assessment instrument category from Stage 3 + node type
  let assessmentCategory: ModalityPlan['assessment_instrument_category'] = 'structured_mcq';
  if (stage3Logic) {
    const llmQual = getLLMInteractiveQualification(node, stage3Logic);
    if (llmQual) {
      assessmentCategory = 'llm_interactive';
    } else if (['application', 'transfer'].includes(node.node_type)) {
      assessmentCategory = 'scenario_justification';
    } else if (node.node_type === 'procedure') {
      assessmentCategory = 'procedural_check';
    } else if (node.node_type === 'metacognitive') {
      assessmentCategory = 'reflection';
    } else if (node.node_type === 'principle') {
      assessmentCategory = 'short_response';
    }
  }

  const requiredAssets: ModalityPlan['required_asset_types'] = ['instructional_text'];
  if (config.primaryModalities.includes('visual')) requiredAssets.push('visual');
  if (videoJustified) requiredAssets.push('video');
  if (config.primaryModalities.includes('interactive')) requiredAssets.push('interactive_activity');
  if (config.primaryModalities.includes('reflection')) requiredAssets.push('reflection_prompt');

  return {
    node_id: node.node_id,
    clo_id: node.clo_id,
    node_type: node.node_type,
    approved_modalities: config.primaryModalities,
    required_asset_types: requiredAssets,
    visual_justified: config.primaryModalities.includes('visual'),
    visual_justification: config.primaryModalities.includes('visual')
      ? `Visual content required for ${node.node_type} node to support understanding`
      : undefined,
    video_justified: videoJustified,
    video_justification: videoJustified
      ? `${getVideoScriptType(node.node_type)} video supports ${node.node_type} learning`
      : undefined,
    assessment_instrument_category: assessmentCategory,
    diagnostic_intent: stage3Logic?.diagnostic_intent || '',
    risk_level: node.risk_level,
    gate_strictness: stage3Logic?.progression_rules.gate_strictness || 'flexible',
    generated_at: new Date().toISOString()
  };
}

// ============================================================================
// STEP B — INSTRUCTIONAL PACKAGE GENERATION
// ============================================================================

/**
 * Generate a structured Node Instructional Package (Step B).
 */
async function generateInstructionalPackage(
  node: LearningNode,
  clo: CLO,
  stage3Logic: Stage3NodeLogic | undefined,
  allNodes: LearningNode[],
  councilInfo: CouncilInfo,
  courseCode: string,
  executionOverride?: StageExecutionMode
): Promise<NodeInstructionalPackage> {
  const modalities = getContentModalities(node.node_type);
  const contentFocus = getContentFocus(node.node_type);

  // Gather prerequisite vocabulary from prerequisite nodes
  const prereqNodes = allNodes.filter(n => node.prerequisite_nodes.includes(n.node_id));
  const prereqVocabulary = prereqNodes.map(n => n.learning_intent);

  // Build prompt with Stage 3 context
  const prompt = buildStage4InstructionalPackagePrompt(
    {
      node_id: node.node_id,
      node_type: node.node_type,
      learning_intent: node.learning_intent,
      clo_text: clo.clo_text,
      risk_level: node.risk_level
    },
    modalities,
    contentFocus,
    prereqVocabulary,
    stage3Logic ? {
      diagnostic_intent: stage3Logic.diagnostic_intent,
      failure_types: stage3Logic.failure_types.map(ft => ft.description),
      mastery_definition: stage3Logic.progression_rules.mastery_definition
    } : undefined
  );

  const progressCallback = councilInfo.mode === 'council'
    ? createCouncilProgressCallback(courseCode, 4, `Instructional Package: ${node.node_id}`, councilInfo)
    : undefined;

  const response = await callAI(
    [{ role: 'user', content: prompt }],
    4,
    { maxTokens: 8000, progressCallback },
    executionOverride
  );

  const data = parseAIJson<{
    overview: { summary: string; relevance: string };
    core_explanation: string;
    examples: { example_id: string; title: string; content: string; addresses_misconception?: string }[];
    self_check_cue: string;
    references: { reference_id: string; source: string; type: string; citation: string; relevance: string }[];
    scope_boundary: string;
  }>(response);

  return {
    node_id: node.node_id,
    clo_id: node.clo_id,
    node_type: node.node_type,
    overview: data.overview || { summary: node.learning_intent, relevance: `Supports ${clo.clo_text}` },
    core_explanation: data.core_explanation || '',
    examples: (data.examples || []).map((ex, i) => ({
      example_id: ex.example_id || `EX-${i + 1}`,
      title: ex.title || `Example ${i + 1}`,
      content: ex.content || '',
      addresses_misconception: ex.addresses_misconception
    })),
    self_check_cue: data.self_check_cue || '',
    references: (data.references || []).map((ref, i) => ({
      reference_id: ref.reference_id || `REF-${i + 1}`,
      source: ref.source || '',
      type: (ref.type === 'secondary' ? 'secondary' : 'primary') as 'primary' | 'secondary',
      citation: ref.citation || '',
      relevance: ref.relevance || ''
    })),
    prerequisite_vocabulary: prereqVocabulary,
    scope_boundary: data.scope_boundary || '',
    generated_at: new Date().toISOString(),
    content_version: '3.0'
  };
}

// ============================================================================
// STEP C LAYER 1 — DIAGNOSTIC ASSESSMENT GENERATION
// ============================================================================

/**
 * Generate diagnostic assessments aligned to Stage 3 logic (Step C Layer 1).
 */
async function generateDiagnosticAssessment(
  node: LearningNode,
  clo: CLO,
  stage3Logic: Stage3NodeLogic,
  councilInfo: CouncilInfo,
  courseCode: string,
  executionOverride?: StageExecutionMode
): Promise<DiagnosticAssessment> {
  const prompt = buildStage4DiagnosticAssessmentPrompt(
    {
      node_id: node.node_id,
      node_type: node.node_type,
      learning_intent: node.learning_intent,
      clo_text: clo.clo_text,
      bloom_level: clo.bloom_level,
      evidence_of_mastery: clo.evidence_of_mastery
    },
    {
      diagnostic_intent: stage3Logic.diagnostic_intent,
      failure_types: stage3Logic.failure_types,
      observable_signals: stage3Logic.observable_signals,
      remediation_paths: stage3Logic.remediation_paths,
      progression_rules: stage3Logic.progression_rules
    }
  );

  const progressCallback = councilInfo.mode === 'council'
    ? createCouncilProgressCallback(courseCode, 4, `Diagnostic Assessment: ${node.node_id}`, councilInfo)
    : undefined;

  const response = await callAI(
    [{ role: 'user', content: prompt }],
    4,
    { maxTokens: 6000, progressCallback },
    executionOverride
  );

  const data = parseAIJson<{
    items: Array<{
      item_id: string;
      item_type: string;
      question_text: string;
      options?: string[];
      correct_answer?: string;
      rubric_criteria?: string;
      points: number;
      bloom_level: string;
      diagnostic_intent: string;
      failure_types_detected: string[];
      remediation_trigger: string;
      scoring_rule: string;
    }>;
    remediation_triggers: Array<{
      failure_type_id: string;
      trigger_condition: string;
      remediation_action: string;
      target_node_id?: string;
    }>;
    pass_threshold: number;
    time_limit_minutes?: number;
    instructions: string;
  }>(response);

  return {
    node_id: node.node_id,
    clo_id: node.clo_id,
    diagnostic_intent: stage3Logic.diagnostic_intent,
    failure_types: stage3Logic.failure_types.map(ft => ({
      id: ft.id,
      description: ft.description,
      severity: ft.severity
    })),
    mastery_rules: {
      mastery_definition: stage3Logic.progression_rules.mastery_definition,
      mastery_threshold: stage3Logic.progression_rules.mastery_threshold,
      gate_strictness: stage3Logic.progression_rules.gate_strictness,
      blocks_downstream: stage3Logic.progression_rules.blocks_downstream
    },
    items: (data.items || []).map((item, i) => ({
      item_id: item.item_id || `DI-${i + 1}`,
      item_type: (item.item_type || 'structured_mcq') as DiagnosticAssessmentItem['item_type'],
      question_text: item.question_text || '',
      options: item.options,
      correct_answer: item.correct_answer,
      rubric_criteria: item.rubric_criteria,
      points: item.points || 1,
      bloom_level: (item.bloom_level || clo.bloom_level) as CLO['bloom_level'],
      diagnostic_intent: item.diagnostic_intent || stage3Logic.diagnostic_intent,
      failure_types_detected: item.failure_types_detected || [],
      remediation_trigger: item.remediation_trigger || '',
      scoring_rule: item.scoring_rule || ''
    })),
    remediation_triggers: (data.remediation_triggers || []).map(rt => ({
      failure_type_id: rt.failure_type_id,
      trigger_condition: rt.trigger_condition || '',
      remediation_action: rt.remediation_action || '',
      target_node_id: rt.target_node_id
    })),
    pass_threshold: data.pass_threshold || 70,
    time_limit_minutes: data.time_limit_minutes,
    instructions: data.instructions || '',
    generated_at: new Date().toISOString()
  };
}

// ============================================================================
// STEP C LAYER 2 — LLM-INTERACTIVE ASSESSMENT SPEC
// ============================================================================

/**
 * Generate an LLM-interactive assessment specification for qualifying nodes.
 */
async function generateLLMInteractiveSpec(
  node: LearningNode,
  clo: CLO,
  stage3Logic: Stage3NodeLogic,
  qualificationReason: 'high_risk' | 'reasoning_intensive' | 'recall_gaming_vulnerable',
  councilInfo: CouncilInfo,
  courseCode: string,
  executionOverride?: StageExecutionMode
): Promise<LLMInteractiveAssessmentSpec> {
  const prompt = buildStage4LLMInteractiveSpecPrompt(
    {
      node_id: node.node_id,
      node_type: node.node_type,
      learning_intent: node.learning_intent,
      clo_text: clo.clo_text,
      prerequisite_nodes: node.prerequisite_nodes
    },
    qualificationReason,
    {
      diagnostic_intent: stage3Logic.diagnostic_intent,
      failure_types: stage3Logic.failure_types,
      progression_rules: stage3Logic.progression_rules
    }
  );

  const progressCallback = councilInfo.mode === 'council'
    ? createCouncilProgressCallback(courseCode, 4, `LLM-Interactive Spec: ${node.node_id}`, councilInfo)
    : undefined;

  const response = await callAI(
    [{ role: 'user', content: prompt }],
    4,
    { maxTokens: 6000, progressCallback },
    executionOverride
  );

  const data = parseAIJson<{
    assessment_objective: string;
    allowed_scope: {
      topics_in_scope: string[];
      topics_out_of_scope: string[];
    };
    initial_prompt: string;
    probing_paths: Array<{
      failure_type_id: string;
      failure_description: string;
      follow_up_questions: string[];
      expected_reasoning_indicators: string[];
      misconception_indicators: string[];
    }>;
    mastery_rubric: Array<{
      criterion: string;
      acceptable_evidence: string;
      unacceptable_evidence: string;
    }>;
  }>(response);

  return {
    node_id: node.node_id,
    clo_id: node.clo_id,
    qualification_reason: qualificationReason,
    assessment_objective: data.assessment_objective || '',
    allowed_scope: {
      node_id: node.node_id,
      prerequisite_node_ids: node.prerequisite_nodes,
      topics_in_scope: data.allowed_scope?.topics_in_scope || [],
      topics_out_of_scope: data.allowed_scope?.topics_out_of_scope || []
    },
    initial_prompt: data.initial_prompt || '',
    probing_paths: (data.probing_paths || []).map(pp => ({
      failure_type_id: pp.failure_type_id || '',
      failure_description: pp.failure_description || '',
      follow_up_questions: pp.follow_up_questions || [],
      expected_reasoning_indicators: pp.expected_reasoning_indicators || [],
      misconception_indicators: pp.misconception_indicators || []
    })),
    mastery_rubric: (data.mastery_rubric || []).map(mr => ({
      criterion: mr.criterion || '',
      acceptable_evidence: mr.acceptable_evidence || '',
      unacceptable_evidence: mr.unacceptable_evidence || ''
    })),
    evidence_capture: {
      format: 'reasoning_transcript_summary',
      fields: {
        summarized_reasoning: 'Provide a summary of the learner reasoning observed during the interaction.',
        detected_misconception_tags: stage3Logic.failure_types.map(ft => ft.id),
        mastery_decision: 'not_mastered',
        confidence_level: 'medium',
        remediation_path_taken: undefined
      }
    },
    generated_at: new Date().toISOString()
  };
}

// ============================================================================
// STEP D — REMEDIATION ASSETS GENERATION
// ============================================================================

/**
 * Generate remediation assets keyed to Stage 3 failure types (Step D).
 */
async function generateRemediationAssets(
  node: LearningNode,
  clo: CLO,
  stage3Logic: Stage3NodeLogic,
  councilInfo: CouncilInfo,
  courseCode: string,
  executionOverride?: StageExecutionMode
): Promise<NodeRemediationPack> {
  const prompt = buildStage4RemediationAssetsPrompt(
    {
      node_id: node.node_id,
      node_type: node.node_type,
      learning_intent: node.learning_intent,
      clo_text: clo.clo_text
    },
    {
      failure_types: stage3Logic.failure_types,
      remediation_paths: stage3Logic.remediation_paths
    }
  );

  const progressCallback = councilInfo.mode === 'council'
    ? createCouncilProgressCallback(courseCode, 4, `Remediation: ${node.node_id}`, councilInfo)
    : undefined;

  const response = await callAI(
    [{ role: 'user', content: prompt }],
    4,
    { maxTokens: 6000, progressCallback },
    executionOverride
  );

  const data = parseAIJson<{
    assets: Array<{
      asset_id: string;
      failure_type_id: string;
      failure_description: string;
      remediation_path_id: string;
      strategy: string;
      feedback_message: string;
      micro_content: string;
      alternate_explanation?: string;
      alternate_example?: string;
      prerequisite_link?: { node_id: string; reason: string };
    }>;
  }>(response);

  return {
    node_id: node.node_id,
    clo_id: node.clo_id,
    assets: (data.assets || []).map((a, i) => ({
      asset_id: a.asset_id || `RA-${node.node_id}-${i + 1}`,
      node_id: node.node_id,
      failure_type_id: a.failure_type_id || '',
      failure_description: a.failure_description || '',
      remediation_path_id: a.remediation_path_id || '',
      strategy: a.strategy || '',
      feedback_message: a.feedback_message || '',
      micro_content: a.micro_content || '',
      alternate_explanation: a.alternate_explanation,
      alternate_example: a.alternate_example,
      prerequisite_link: a.prerequisite_link,
      generated_at: new Date().toISOString()
    })),
    generated_at: new Date().toISOString()
  };
}

// ============================================================================
// STEP E — ENHANCED VISUAL & VIDEO PRODUCTION SPECS
// ============================================================================

/**
 * Generate production-ready visual asset specifications (Step E).
 */
async function generateVisualAssetSpecs(
  node: LearningNode,
  clo: CLO,
  stage3Logic: Stage3NodeLogic | undefined,
  contentSummary: string,
  councilInfo: CouncilInfo,
  courseCode: string,
  executionOverride?: StageExecutionMode
): Promise<VisualAssetSpec[]> {
  try {
    const prompt = buildStage4VisualAssetSpecPrompt(
      {
        node_id: node.node_id,
        node_type: node.node_type,
        learning_intent: node.learning_intent,
        clo_id: node.clo_id
      },
      contentSummary,
      stage3Logic ? stage3Logic.failure_types.map(ft => ft.description) : []
    );

    const progressCallback = councilInfo.mode === 'council'
      ? createCouncilProgressCallback(courseCode, 4, `Visual Specs: ${node.node_id}`, councilInfo)
      : undefined;

    const response = await callAI(
      [{ role: 'user', content: prompt }],
      4,
      { maxTokens: 4000, progressCallback },
      executionOverride
    );

    const data = parseAIJson<{
      visual_specs: Array<{
        spec_id: string;
        visual_type: string;
        purpose: string;
        learning_intent: string;
        required_elements: string[];
        required_labels: string[];
        misconceptions_to_avoid: string[];
        style_constraints: string;
        generation_prompt: string;
        alt_text: string;
        placement: string;
      }>;
    }>(response);

    return (data.visual_specs || []).map((v, i) => ({
      spec_id: v.spec_id || `VS-${node.node_id}-${i + 1}`,
      node_id: node.node_id,
      clo_id: node.clo_id,
      purpose: v.purpose || '',
      learning_intent: v.learning_intent || node.learning_intent,
      visual_type: (v.visual_type || 'diagram') as VisualAssetSpec['visual_type'],
      required_elements: v.required_elements || [],
      required_labels: v.required_labels || [],
      misconceptions_to_avoid: v.misconceptions_to_avoid || [],
      style_constraints: v.style_constraints || 'academic',
      generation_prompt: v.generation_prompt || '',
      alt_text: v.alt_text || '',
      placement: v.placement || '',
      generated_at: new Date().toISOString()
    }));
  } catch (error) {
    console.error(`Failed to generate visual asset specs for ${node.node_id}:`, error);
    return [];
  }
}

/**
 * Generate a video production package (Step E).
 */
async function generateVideoProductionPackage(
  node: LearningNode,
  clo: CLO,
  contentSummary: string,
  councilInfo: CouncilInfo,
  courseCode: string,
  executionOverride?: StageExecutionMode
): Promise<VideoProductionPackage | undefined> {
  if (!shouldHaveVideo(node.node_type)) {
    return undefined;
  }

  const scriptType = getVideoScriptType(node.node_type);
  if (!scriptType) return undefined;

  try {
    const prompt = buildStage4VideoProductionPackagePrompt(
      {
        node_id: node.node_id,
        node_type: node.node_type,
        learning_intent: node.learning_intent,
        clo_id: node.clo_id,
        clo_text: clo.clo_text
      },
      scriptType,
      contentSummary
    );

    const progressCallback = councilInfo.mode === 'council'
      ? createCouncilProgressCallback(courseCode, 4, `Video Package: ${node.node_id}`, councilInfo)
      : undefined;

    const response = await callAI(
      [{ role: 'user', content: prompt }],
      4,
      { maxTokens: 5000, progressCallback },
      executionOverride
    );

    const data = parseAIJson<{
      pedagogical_purpose: string;
      duration_guidance_minutes: number;
      full_script: string;
      segments: Array<{
        segment_number: number;
        title: string;
        duration_seconds: number;
        narration: string;
        visual_cues: string;
        on_screen_text?: string;
      }>;
      scope_boundaries: {
        must_cover: string[];
        must_not_introduce: string[];
      };
      target_audience: string;
      production_notes?: string;
    }>(response);

    return {
      package_id: `VP-${node.node_id}`,
      node_id: node.node_id,
      clo_id: node.clo_id,
      pedagogical_purpose: data.pedagogical_purpose || '',
      duration_guidance_minutes: data.duration_guidance_minutes || 5,
      full_script: data.full_script || '',
      segments: (data.segments || []).map(s => ({
        segment_number: s.segment_number,
        title: s.title || '',
        duration_seconds: s.duration_seconds || 60,
        narration: s.narration || '',
        visual_cues: s.visual_cues || '',
        on_screen_text: s.on_screen_text
      })),
      scope_boundaries: data.scope_boundaries || { must_cover: [], must_not_introduce: [] },
      script_type: scriptType,
      target_audience: data.target_audience || 'university students',
      production_notes: data.production_notes,
      generated_at: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Failed to generate video production package for ${node.node_id}:`, error);
    return undefined;
  }
}

// ============================================================================
// STEP C LAYER 3 — SUMMATIVE ASSESSMENTS
// ============================================================================

/**
 * Generate course-level summative assessment artifacts (Step C Layer 3).
 */
async function generateSummativeAssessments(
  courseCode: string,
  courseTitle: string,
  clos: CLO[],
  assessmentBlueprint: Assessment[],
  assessmentStrategy: string,
  councilInfo: CouncilInfo,
  executionOverride?: StageExecutionMode
): Promise<SummativeAssessmentPack> {
  const prompt = buildStage4SummativeAssessmentsPrompt(
    courseTitle,
    clos.map(c => ({ clo_id: c.clo_id, clo_text: c.clo_text, bloom_level: c.bloom_level })),
    assessmentBlueprint,
    assessmentStrategy
  );

  const progressCallback = councilInfo.mode === 'council'
    ? createCouncilProgressCallback(courseCode, 4, 'Generating summative assessments', councilInfo)
    : undefined;

  const response = await callAI(
    [{ role: 'user', content: prompt }],
    4,
    { maxTokens: 10000, progressCallback },
    executionOverride
  );

  const data = parseAIJson<{
    artifacts: Array<{
      artifact_id: string;
      artifact_type: string;
      title: string;
      description: string;
      clo_ids: string[];
      clo_coverage_statement: string;
      weight_percentage: number;
      rubric: Array<{
        criterion_id: string;
        description: string;
        weight: number;
        levels: Array<{ level: number; label: string; description: string; points: number }>;
      }>;
      marking_guide: string;
      diagnostic_alignment: string;
      estimated_hours: number;
    }>;
  }>(response);

  const artifacts: SummativeAssessmentArtifact[] = (data.artifacts || []).map((a, i) => ({
    artifact_id: a.artifact_id || `SA-${i + 1}`,
    artifact_type: (a.artifact_type || 'assignment_brief') as SummativeAssessmentArtifact['artifact_type'],
    title: a.title || '',
    description: a.description || '',
    clo_ids: a.clo_ids || [],
    clo_coverage_statement: a.clo_coverage_statement || '',
    weight_percentage: a.weight_percentage || 0,
    rubric: (a.rubric || []).map(r => ({
      criterion_id: r.criterion_id,
      description: r.description,
      weight: r.weight,
      levels: r.levels || []
    })),
    marking_guide: a.marking_guide || '',
    diagnostic_alignment: a.diagnostic_alignment || '',
    estimated_hours: a.estimated_hours || 0,
    generated_at: new Date().toISOString()
  }));

  // Build CLO coverage matrix
  const cloMatrix = clos.map(c => {
    const covering = artifacts.filter(a => a.clo_ids.includes(c.clo_id));
    return {
      clo_id: c.clo_id,
      artifact_ids: covering.map(a => a.artifact_id),
      coverage_status: covering.length > 0 ? 'full' as const : 'none' as const
    };
  });

  return {
    course_code: courseCode,
    artifacts,
    total_weight: artifacts.reduce((sum, a) => sum + a.weight_percentage, 0),
    clo_coverage_matrix: cloMatrix,
    generated_at: new Date().toISOString()
  };
}

// ============================================================================
// STEP F — COURSE BOOK ASSEMBLY
// ============================================================================

/**
 * Assemble the course book from node instructional packages.
 */
function assembleCourseBook(
  courseCode: string,
  courseTitle: string,
  clos: CLO[],
  nodes: LearningNode[],
  topics: Topic[],
  instructionalPackages: Map<string, NodeInstructionalPackage>
): CourseBook {
  const chapters: CourseBookChapter[] = [];
  const allReferences: CourseBook['bibliography'] = [];
  const nodeIndex: CourseBook['node_index'] = [];
  const seenRefs = new Set<string>();

  for (let ci = 0; ci < clos.length; ci++) {
    const clo = clos[ci];
    const cloTopics = topics.filter(t => t.clo_id === clo.clo_id);
    const chapterTopics: CourseBookChapter['topics'] = [];

    for (let ti = 0; ti < cloTopics.length; ti++) {
      const topic = cloTopics[ti];
      const topicNodes = nodes.filter(n => n.clo_id === clo.clo_id && n.topic_id === topic.topic_id);
      const chapterNodes: CourseBookChapter['topics'][number]['nodes'] = [];

      for (const node of topicNodes) {
        const pkg = instructionalPackages.get(node.node_id);
        const content = pkg
          ? `## ${pkg.overview.summary}\n\n${pkg.overview.relevance}\n\n${pkg.core_explanation}\n\n${pkg.examples.map(ex => `### ${ex.title}\n${ex.content}`).join('\n\n')}\n\n**Self-Check:** ${pkg.self_check_cue}`
          : `*Content pending for ${node.learning_intent}*`;

        chapterNodes.push({
          node_id: node.node_id,
          node_type: node.node_type,
          learning_intent: node.learning_intent,
          content
        });

        nodeIndex.push({
          node_id: node.node_id,
          clo_id: clo.clo_id,
          chapter_index: ci,
          topic_index: ti
        });

        // Collect references
        if (pkg) {
          for (const ref of pkg.references) {
            if (!seenRefs.has(ref.citation)) {
              seenRefs.add(ref.citation);
              allReferences.push({
                reference_id: ref.reference_id,
                citation: ref.citation,
                source_type: ref.type,
                referenced_by_nodes: [node.node_id]
              });
            } else {
              const existing = allReferences.find(r => r.citation === ref.citation);
              if (existing && !existing.referenced_by_nodes.includes(node.node_id)) {
                existing.referenced_by_nodes.push(node.node_id);
              }
            }
          }
        }
      }

      if (chapterNodes.length > 0) {
        chapterTopics.push({
          topic_id: topic.topic_id,
          topic_title: topic.title,
          nodes: chapterNodes
        });
      }
    }

    chapters.push({
      clo_id: clo.clo_id,
      clo_text: clo.clo_text,
      topics: chapterTopics
    });
  }

  return {
    course_code: courseCode,
    title: courseTitle,
    chapters,
    bibliography: allReferences,
    node_index: nodeIndex,
    generated_at: new Date().toISOString()
  };
}

/**
 * Render CourseBook to Markdown
 */
function renderCourseBookMarkdown(book: CourseBook): string {
  const lines: string[] = [];
  lines.push(`# ${book.title}`);
  lines.push(`\n*Course Code: ${book.course_code}*\n`);
  lines.push('---\n');

  // Table of contents
  lines.push('## Table of Contents\n');
  for (let ci = 0; ci < book.chapters.length; ci++) {
    const ch = book.chapters[ci];
    lines.push(`${ci + 1}. **${ch.clo_id}**: ${ch.clo_text}`);
    for (let ti = 0; ti < ch.topics.length; ti++) {
      const topic = ch.topics[ti];
      lines.push(`   ${ci + 1}.${ti + 1}. ${topic.topic_title}`);
    }
  }
  lines.push('\n---\n');

  // Chapters
  for (let ci = 0; ci < book.chapters.length; ci++) {
    const ch = book.chapters[ci];
    lines.push(`# Chapter ${ci + 1}: ${ch.clo_text}\n`);
    lines.push(`*CLO: ${ch.clo_id}*\n`);

    for (const topic of ch.topics) {
      lines.push(`## ${topic.topic_title}\n`);
      lines.push(`*Topic: ${topic.topic_id}*\n`);

      for (const node of topic.nodes) {
        lines.push(`<!-- NODE: ${node.node_id} | TYPE: ${node.node_type} -->`);
        lines.push(node.content);
        lines.push('\n---\n');
      }
    }
  }

  // Bibliography
  if (book.bibliography.length > 0) {
    lines.push('# Bibliography\n');
    for (const ref of book.bibliography) {
      lines.push(`- [${ref.reference_id}] ${ref.citation} *(${ref.source_type}; referenced by: ${ref.referenced_by_nodes.join(', ')})*`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// STEP G — ENHANCED WORKLOAD MAP
// ============================================================================

/**
 * Compute the enhanced workload map with CLO/topic aggregation and flags.
 */
function computeEnhancedWorkloadMap(
  baseWorkloadMap: WorkloadMap,
  clos: CLO[],
  nodes: LearningNode[],
  topics: Topic[],
  nodeWorkloads: NodeWorkload[],
  summativePack: SummativeAssessmentPack | null,
  creditHours: number
): EnhancedWorkloadMap {
  const HOURS_PER_CREDIT = 15;
  const MAX_WEEKLY_HOURS = 12;
  const expectedHours = creditHours * HOURS_PER_CREDIT;

  // Per-CLO/topic aggregation
  const cloWorkload = clos.map(clo => {
    const cloTopics = topics.filter(t => t.clo_id === clo.clo_id);
    const topicBreakdown = cloTopics.map(topic => {
      const topicNodeIds = nodes
        .filter(n => n.clo_id === clo.clo_id && n.topic_id === topic.topic_id)
        .map(n => n.node_id);
      const topicWorkloads = nodeWorkloads.filter(nw => topicNodeIds.includes(nw.node_id));
      return {
        topic_id: topic.topic_id,
        topic_title: topic.title,
        node_count: topicWorkloads.length,
        total_time_minutes: topicWorkloads.reduce((s, nw) => s + nw.total_time_minutes, 0)
      };
    });
    const totalMin = topicBreakdown.reduce((s, t) => s + t.total_time_minutes, 0);
    return {
      clo_id: clo.clo_id,
      clo_text: clo.clo_text,
      topics: topicBreakdown,
      total_time_minutes: totalMin,
      total_time_hours: Math.round((totalMin / 60) * 10) / 10
    };
  });

  // Summative workload
  const summativeWorkload = summativePack
    ? summativePack.artifacts.map(a => ({
        artifact_id: a.artifact_id,
        artifact_type: a.artifact_type,
        title: a.title,
        estimated_hours: a.estimated_hours,
        weight_percentage: a.weight_percentage
      }))
    : [];

  // Deterministic flags
  const flags: EnhancedWorkloadMap['flags'] = [];

  // Check total workload alignment
  if (baseWorkloadMap.alignment_status === 'over') {
    flags.push({
      flag_type: 'overload',
      severity: Math.abs(baseWorkloadMap.deviation_percentage) > 20 ? 'error' : 'warning',
      message: `Total workload (${baseWorkloadMap.total_hours}h) exceeds expected ${expectedHours}h by ${Math.abs(baseWorkloadMap.deviation_percentage)}%`,
      affected_entity: 'course'
    });
  } else if (baseWorkloadMap.alignment_status === 'under') {
    flags.push({
      flag_type: 'under_coverage',
      severity: Math.abs(baseWorkloadMap.deviation_percentage) > 20 ? 'error' : 'warning',
      message: `Total workload (${baseWorkloadMap.total_hours}h) is below expected ${expectedHours}h by ${Math.abs(baseWorkloadMap.deviation_percentage)}%`,
      affected_entity: 'course'
    });
  }

  // Check weekly balance
  for (const week of baseWorkloadMap.weekly_workload) {
    if (week.total_time_hours > MAX_WEEKLY_HOURS) {
      flags.push({
        flag_type: 'overload',
        severity: 'warning',
        message: `Week ${week.week} (${week.topic}) has ${week.total_time_hours}h which exceeds recommended max of ${MAX_WEEKLY_HOURS}h`,
        affected_entity: `week-${week.week}`
      });
    }
  }

  // Check CLO balance
  const avgCloHours = cloWorkload.reduce((s, c) => s + c.total_time_hours, 0) / (cloWorkload.length || 1);
  for (const cw of cloWorkload) {
    if (cw.total_time_hours < avgCloHours * 0.3 && cw.total_time_hours > 0) {
      flags.push({
        flag_type: 'unbalanced_clo',
        severity: 'warning',
        message: `CLO ${cw.clo_id} has only ${cw.total_time_hours}h, significantly below average of ${Math.round(avgCloHours * 10) / 10}h`,
        affected_entity: cw.clo_id
      });
    }
  }

  // Check summative weights
  if (summativePack) {
    const totalWeight = summativePack.total_weight;
    if (Math.abs(totalWeight - 100) > 1) {
      flags.push({
        flag_type: 'policy_misalignment',
        severity: 'error',
        message: `Summative assessment weights total ${totalWeight}%, expected 100%`,
        affected_entity: 'summative_assessments'
      });
    }
  }

  return {
    ...baseWorkloadMap,
    clo_workload: cloWorkload,
    summative_workload: summativeWorkload,
    flags,
    institutional_policy: {
      hours_per_credit: HOURS_PER_CREDIT,
      max_weekly_hours: MAX_WEEKLY_HOURS,
      min_assessment_weight: 0,
      max_assessment_weight: 100
    }
  };
}

// ============================================================================
// VALIDATION ROUTINE
// ============================================================================

/**
 * Validate that all required Stage 4 artifacts exist and are properly linked.
 */
function validateStage4Outputs(
  courseCode: string,
  nodes: LearningNode[],
  stage3Map: Map<string, Stage3NodeLogic>,
  generatedPacks: {
    modalityPlans: Map<string, ModalityPlan>;
    instructionalPackages: Map<string, NodeInstructionalPackage>;
    diagnosticAssessments: Map<string, DiagnosticAssessment>;
    remediationPacks: Map<string, NodeRemediationPack>;
    llmInteractiveSpecs: Map<string, LLMInteractiveAssessmentSpec>;
  }
): Stage4ValidationReport {
  const checks: Stage4ValidationReport['checks'] = [];

  // Check 1: Every node has a modality plan
  const nodesWithoutPlan = nodes.filter(n => !generatedPacks.modalityPlans.has(n.node_id));
  checks.push({
    check_name: 'modality_plans_complete',
    passed: nodesWithoutPlan.length === 0,
    message: nodesWithoutPlan.length === 0
      ? 'All nodes have modality plans'
      : `${nodesWithoutPlan.length} nodes missing modality plans`,
    affected_nodes: nodesWithoutPlan.map(n => n.node_id)
  });

  // Check 2: Every node has an instructional package
  const nodesWithoutPkg = nodes.filter(n => !generatedPacks.instructionalPackages.has(n.node_id));
  checks.push({
    check_name: 'instructional_packages_complete',
    passed: nodesWithoutPkg.length === 0,
    message: nodesWithoutPkg.length === 0
      ? 'All nodes have instructional packages'
      : `${nodesWithoutPkg.length} nodes missing instructional packages`,
    affected_nodes: nodesWithoutPkg.map(n => n.node_id)
  });

  // Check 3: Every node with Stage 3 logic has diagnostic assessments
  const nodesWithS3 = nodes.filter(n => stage3Map.has(n.node_id));
  const nodesWithS3NoDiag = nodesWithS3.filter(n => !generatedPacks.diagnosticAssessments.has(n.node_id));
  checks.push({
    check_name: 'diagnostic_assessments_stage3_aligned',
    passed: nodesWithS3NoDiag.length === 0,
    message: nodesWithS3NoDiag.length === 0
      ? 'All Stage 3 nodes have diagnostic assessments'
      : `${nodesWithS3NoDiag.length} Stage 3 nodes missing diagnostic assessments`,
    affected_nodes: nodesWithS3NoDiag.map(n => n.node_id)
  });

  // Check 4: High-risk/reasoning nodes have LLM-interactive specs
  const nodesNeedingLLM = nodes.filter(n => {
    const s3 = stage3Map.get(n.node_id);
    return getLLMInteractiveQualification(n, s3) !== null;
  });
  const nodesNeedingLLMNoSpec = nodesNeedingLLM.filter(n => !generatedPacks.llmInteractiveSpecs.has(n.node_id));
  checks.push({
    check_name: 'llm_interactive_specs_complete',
    passed: nodesNeedingLLMNoSpec.length === 0,
    message: nodesNeedingLLMNoSpec.length === 0
      ? 'All qualifying nodes have LLM-interactive specs'
      : `${nodesNeedingLLMNoSpec.length} qualifying nodes missing LLM-interactive specs`,
    affected_nodes: nodesNeedingLLMNoSpec.map(n => n.node_id)
  });

  // Check 5: Remediation assets exist for every failure type
  const nodesWithS3NoRem = nodesWithS3.filter(n => {
    const s3 = stage3Map.get(n.node_id)!;
    const remPack = generatedPacks.remediationPacks.get(n.node_id);
    if (!remPack) return true;
    return s3.failure_types.length > remPack.assets.length;
  });
  checks.push({
    check_name: 'remediation_assets_complete',
    passed: nodesWithS3NoRem.length === 0,
    message: nodesWithS3NoRem.length === 0
      ? 'All failure types have remediation assets'
      : `${nodesWithS3NoRem.length} nodes have incomplete remediation coverage`,
    affected_nodes: nodesWithS3NoRem.map(n => n.node_id)
  });

  return {
    course_code: courseCode,
    is_valid: checks.every(c => c.passed),
    checks,
    generated_at: new Date().toISOString()
  };
}

// ============================================================================
// CONTENT GENERATION FUNCTIONS (Legacy — kept for backward compat)
// ============================================================================

/**
 * Generate modality-based instructional content for a node
 */
async function generateModalityContent(
  node: LearningNode,
  clo: CLO,
  councilInfo: CouncilInfo,
  courseCode: string,
  executionOverride?: StageExecutionMode
): Promise<string> {
  const modalities = getContentModalities(node.node_type);
  const contentFocus = getContentFocus(node.node_type);
  
  const prompt = buildStage4ModalityContentPrompt(
    {
      node_id: node.node_id,
      node_type: node.node_type,
      learning_intent: node.learning_intent,
      clo_text: clo.clo_text,
      risk_level: node.risk_level
    },
    modalities,
    contentFocus
  );
  
  const progressCallback = councilInfo.mode === 'council'
    ? createCouncilProgressCallback(courseCode, 4, `Content: ${node.node_id}`, councilInfo)
    : undefined;
    
  const content = await callAI(
    [{ role: 'user', content: prompt }],
    4,
    { maxTokens: 6000, progressCallback },
    executionOverride
  );
  
  return content;
}

/**
 * Generate assessments for a node (Type A, B, C based on modality)
 */
async function generateNodeAssessments(
  node: LearningNode,
  clo: CLO,
  councilInfo: CouncilInfo,
  courseCode: string,
  executionOverride?: StageExecutionMode
): Promise<NodeAssessment[]> {
  const assessmentTypes = getAssessmentTypes(node.node_type);
  const assessments: NodeAssessment[] = [];
  
  for (const assessmentType of assessmentTypes) {
    try {
      const prompt = buildStage4AssessmentPrompt(
        assessmentType,
        {
          node_id: node.node_id,
          node_type: node.node_type,
          learning_intent: node.learning_intent,
          clo_text: clo.clo_text,
          bloom_level: clo.bloom_level,
          evidence_of_mastery: clo.evidence_of_mastery
        }
      );
      
      const progressCallback = councilInfo.mode === 'council'
        ? createCouncilProgressCallback(courseCode, 4, `Assessment ${assessmentType}: ${node.node_id}`, councilInfo)
        : undefined;
        
      const response = await callAI(
        [{ role: 'user', content: prompt }],
        4,
        { maxTokens: 4000, progressCallback },
        executionOverride
      );
      
      const assessmentData = parseAIJson<{
        title: string;
        description: string;
        pass_threshold: number;
        time_limit_minutes?: number;
        instructions: string;
        questions: Array<{
          question_id: string;
          question_type: string;
          question_text: string;
          options?: string[];
          correct_answer?: string;
          rubric_criteria?: string;
          points: number;
          bloom_level: string;
          diagnostic_value: string;
        }>;
        adaptive_function: string;
      }>(response);
      
      const assessment: NodeAssessment = {
        node_id: node.node_id,
        assessment_type: assessmentType,
        title: assessmentData.title,
        description: assessmentData.description,
        questions: assessmentData.questions.map(q => ({
          question_id: q.question_id,
          question_type: q.question_type as 'multiple_choice' | 'true_false' | 'short_answer' | 'scenario' | 'reflection',
          question_text: q.question_text,
          options: q.options,
          correct_answer: q.correct_answer,
          rubric_criteria: q.rubric_criteria,
          points: q.points,
          bloom_level: q.bloom_level as CLO['bloom_level'],
          diagnostic_value: q.diagnostic_value
        })),
        adaptive_function: assessmentData.adaptive_function,
        pass_threshold: assessmentData.pass_threshold,
        time_limit_minutes: assessmentData.time_limit_minutes,
        instructions: assessmentData.instructions
      };
      
      assessments.push(assessment);
    } catch (error) {
      console.error(`Failed to generate ${assessmentType} assessment for ${node.node_id}:`, error);
      // Continue with other assessment types
    }
  }
  
  return assessments;
}

/**
 * Generate video script for a node (if applicable)
 */
async function generateVideoScript(
  node: LearningNode,
  clo: CLO,
  contentSummary: string,
  councilInfo: CouncilInfo,
  courseCode: string,
  executionOverride?: StageExecutionMode
): Promise<VideoScript | undefined> {
  if (!shouldHaveVideo(node.node_type)) {
    return undefined;
  }
  
  const scriptType = getVideoScriptType(node.node_type);
  if (!scriptType) {
    return undefined;
  }
  
  try {
    const prompt = buildStage4VideoScriptPrompt(
      {
        node_id: node.node_id,
        node_type: node.node_type,
        learning_intent: node.learning_intent,
        clo_text: clo.clo_text
      },
      scriptType,
      contentSummary
    );
    
    const progressCallback = councilInfo.mode === 'council'
      ? createCouncilProgressCallback(courseCode, 4, `Video: ${node.node_id}`, councilInfo)
      : undefined;
      
    const response = await callAI(
      [{ role: 'user', content: prompt }],
      4,
      { maxTokens: 4000, progressCallback },
      executionOverride
    );
    
    const videoData = parseAIJson<{
      title: string;
      duration_minutes: number;
      script_type: string;
      learning_objective: string;
      target_audience: string;
      sections: Array<{
        section_number: number;
        title: string;
        duration_seconds: number;
        narration: string;
        visual_description: string;
        on_screen_text?: string;
        transitions?: string;
      }>;
      production_notes?: string;
    }>(response);
    
    return {
      node_id: node.node_id,
      title: videoData.title,
      duration_minutes: videoData.duration_minutes,
      script_type: videoData.script_type as VideoScript['script_type'],
      learning_objective: videoData.learning_objective,
      target_audience: videoData.target_audience,
      sections: videoData.sections,
      production_notes: videoData.production_notes
    };
  } catch (error) {
    console.error(`Failed to generate video script for ${node.node_id}:`, error);
    return undefined;
  }
}

/**
 * Generate visual prompts for a node
 */
async function generateVisualPrompts(
  node: LearningNode,
  contentSummary: string,
  councilInfo: CouncilInfo,
  courseCode: string,
  executionOverride?: StageExecutionMode
): Promise<VisualPrompt[]> {
  try {
    const prompt = buildStage4VisualPromptPrompt(
      {
        node_id: node.node_id,
        node_type: node.node_type,
        learning_intent: node.learning_intent
      },
      contentSummary
    );
    
    const progressCallback = councilInfo.mode === 'council'
      ? createCouncilProgressCallback(courseCode, 4, `Visuals: ${node.node_id}`, councilInfo)
      : undefined;
      
    const response = await callAI(
      [{ role: 'user', content: prompt }],
      4,
      { maxTokens: 2000, progressCallback },
      executionOverride
    );
    
    const visualData = parseAIJson<{
      visual_prompts: Array<{
        prompt_id: string;
        prompt_type: string;
        description: string;
        purpose: string;
        placement: string;
        alt_text: string;
        style_notes?: string;
      }>;
    }>(response);
    
    return visualData.visual_prompts.map(v => ({
      prompt_id: v.prompt_id,
      node_id: node.node_id,
      prompt_type: v.prompt_type as VisualPrompt['prompt_type'],
      description: v.description,
      purpose: v.purpose,
      placement: v.placement,
      alt_text: v.alt_text,
      style_notes: v.style_notes
    }));
  } catch (error) {
    console.error(`Failed to generate visual prompts for ${node.node_id}:`, error);
    return [];
  }
}

/**
 * Generate complete content pack for a single node
 */
async function generateNodeContentPack(
  node: LearningNode,
  clo: CLO,
  councilInfo: CouncilInfo,
  courseCode: string,
  executionOverride?: StageExecutionMode
): Promise<Stage4NodeContent> {
  const modalities = getContentModalities(node.node_type);
  
  // Generate instructional content
  const instructionalContent = await generateModalityContent(
    node, clo, councilInfo, courseCode, executionOverride
  );
  
  // Create content summary for video/visual generation
  const contentSummary = instructionalContent.substring(0, 2000);
  
  // Generate components in parallel where possible
  const [assessments, videoScript, visualPrompts] = await Promise.all([
    generateNodeAssessments(node, clo, councilInfo, courseCode, executionOverride),
    generateVideoScript(node, clo, contentSummary, councilInfo, courseCode, executionOverride),
    generateVisualPrompts(node, contentSummary, councilInfo, courseCode, executionOverride)
  ]);
  
  // Calculate time estimate
  const timeBreakdown = getTimeBreakdown(node.node_type);
  
  const contentPack: Stage4NodeContent = {
    node_id: node.node_id,
    clo_id: node.clo_id,
    node_type: node.node_type,
    modalities,
    instructional_content: instructionalContent,
    learner_instructions: `Complete the following learning activities for: ${node.learning_intent}`,
    visual_prompts: visualPrompts,
    video_script: videoScript,
    assessments,
    time_on_task_minutes: timeBreakdown.total,
    generated_at: new Date().toISOString(),
    content_version: '2.0'
  };
  
  return contentPack;
}

// ============================================================================
// WORKLOAD CALCULATION
// ============================================================================

/**
 * Calculate workload map for the course
 */
async function calculateWorkloadMap(
  courseCode: string,
  nodes: LearningNode[],
  contentPacks: Map<string, Stage4NodeContent>,
  weeklyPlan: WeeklyPlanItem[],
  creditHours: number
): Promise<WorkloadMap> {
  const HOURS_PER_CREDIT = 15;
  const expectedHours = creditHours * HOURS_PER_CREDIT;
  
  // Calculate per-node workload
  const nodeWorkloads: NodeWorkload[] = nodes.map(node => {
    const contentPack = contentPacks.get(node.node_id);
    const timeBreakdown = getTimeBreakdown(node.node_type);
    
    return {
      node_id: node.node_id,
      clo_id: node.clo_id,
      node_type: node.node_type,
      learning_intent: node.learning_intent,
      content_time_minutes: timeBreakdown.content,
      video_time_minutes: contentPack?.video_script ? timeBreakdown.video : 0,
      assessment_time_minutes: timeBreakdown.assessment,
      practice_time_minutes: timeBreakdown.practice,
      total_time_minutes: contentPack?.time_on_task_minutes || timeBreakdown.total
    };
  });
  
  // Aggregate by week
  const weeklyWorkloads: WeeklyWorkload[] = weeklyPlan.map(week => {
    const weekCloIds = week.clo_ids || [];
    const weekNodes = nodeWorkloads.filter(n => weekCloIds.includes(n.clo_id));
    const totalMinutes = weekNodes.reduce((sum, n) => sum + n.total_time_minutes, 0);
    const totalHours = totalMinutes / 60;
    
    // A balanced week should have roughly expectedHours / weeklyPlan.length hours
    const idealWeeklyHours = expectedHours / weeklyPlan.length;
    const isBalanced = totalHours >= idealWeeklyHours * 0.5 && totalHours <= idealWeeklyHours * 1.5;
    
    return {
      week: week.week,
      topic: week.topic,
      clo_ids: weekCloIds,
      node_count: weekNodes.length,
      total_time_minutes: totalMinutes,
      total_time_hours: Math.round(totalHours * 10) / 10,
      is_balanced: isBalanced
    };
  });
  
  // Calculate totals
  const totalContentMinutes = nodeWorkloads.reduce((sum, n) => sum + n.content_time_minutes + n.video_time_minutes, 0);
  const totalAssessmentMinutes = nodeWorkloads.reduce((sum, n) => sum + n.assessment_time_minutes, 0);
  const totalMinutes = nodeWorkloads.reduce((sum, n) => sum + n.total_time_minutes, 0);
  const totalHours = totalMinutes / 60;
  
  // Check alignment
  const deviationHours = totalHours - expectedHours;
  const deviationPercentage = Math.round((deviationHours / expectedHours) * 100);
  
  let alignmentStatus: WorkloadMap['alignment_status'];
  if (Math.abs(deviationPercentage) <= 10) {
    alignmentStatus = 'aligned';
  } else if (deviationPercentage < 0) {
    alignmentStatus = 'under';
  } else {
    alignmentStatus = 'over';
  }
  
  const validationNotes: string[] = [];
  if (alignmentStatus === 'under') {
    validationNotes.push(`Workload is ${Math.abs(deviationPercentage)}% under credit expectations. Consider adding more content or practice activities.`);
  } else if (alignmentStatus === 'over') {
    validationNotes.push(`Workload is ${deviationPercentage}% over credit expectations. Consider reducing content or making some activities optional.`);
  }
  
  const unbalancedWeeks = weeklyWorkloads.filter(w => !w.is_balanced);
  if (unbalancedWeeks.length > 0) {
    validationNotes.push(`${unbalancedWeeks.length} week(s) have unbalanced workload: ${unbalancedWeeks.map(w => `Week ${w.week}`).join(', ')}`);
  }
  
  return {
    course_code: courseCode,
    nodes: nodeWorkloads,
    weekly_workload: weeklyWorkloads,
    total_content_hours: Math.round((totalContentMinutes / 60) * 10) / 10,
    total_assessment_hours: Math.round((totalAssessmentMinutes / 60) * 10) / 10,
    total_hours: Math.round(totalHours * 10) / 10,
    credit_hours: creditHours,
    expected_hours: expectedHours,
    hours_per_credit: HOURS_PER_CREDIT,
    alignment_status: alignmentStatus,
    deviation_percentage: deviationPercentage,
    deviation_hours: Math.round(deviationHours * 10) / 10,
    is_valid: alignmentStatus === 'aligned',
    validation_notes: validationNotes,
    computed_at: new Date().toISOString()
  };
}

// ============================================================================
// COURSE-LEVEL GENERATION
// ============================================================================

/**
 * Generate course-level rubric
 */
async function generateCourseRubric(
  courseCode: string,
  courseTitle: string,
  clos: CLO[],
  councilInfo: CouncilInfo,
  executionOverride?: StageExecutionMode
): Promise<CourseRubric> {
  const prompt = buildStage4RubricPrompt(
    courseTitle,
    clos.map(clo => ({
      clo_id: clo.clo_id,
      clo_text: clo.clo_text,
      bloom_level: clo.bloom_level,
      evidence_of_mastery: clo.evidence_of_mastery
    }))
  );
  
  const progressCallback = councilInfo.mode === 'council'
    ? createCouncilProgressCallback(courseCode, 4, 'Generating course rubric', councilInfo)
    : undefined;
    
  const response = await callAI(
    [{ role: 'user', content: prompt }],
    4,
    { maxTokens: 6000, progressCallback },
    executionOverride
  );
  
  const rubricData = parseAIJson<{
    title: string;
    clo_criteria: Array<{
      clo_id: string;
      clo_text: string;
      bloom_level: string;
      criteria: Array<{
        criterion_id: string;
        description: string;
        weight: number;
        levels: Array<{
          level: number;
          label: string;
          description: string;
          points: number;
        }>;
      }>;
    }>;
    grading_scale: Array<{
      grade: string;
      min_percentage: number;
      max_percentage: number;
      description: string;
    }>;
    assessment_weights: {
      pre_knowledge: number;
      formative: number;
      mastery: number;
    };
    marking_guide: string;
    learner_instructions: string;
  }>(response);
  
  return {
    course_code: courseCode,
    title: rubricData.title,
    clo_criteria: rubricData.clo_criteria.map(c => ({
      clo_id: c.clo_id,
      clo_text: c.clo_text,
      bloom_level: c.bloom_level as CLO['bloom_level'],
      criteria: c.criteria.map(cr => ({
        criterion_id: cr.criterion_id,
        description: cr.description,
        weight: cr.weight,
        levels: cr.levels
      }))
    })),
    grading_scale: rubricData.grading_scale,
    marking_guide: rubricData.marking_guide,
    learner_instructions: rubricData.learner_instructions,
    assessment_weights: rubricData.assessment_weights,
    generated_at: new Date().toISOString()
  };
}

/**
 * Generate learner instructions for the course
 */
async function generateLearnerInstructions(
  courseCode: string,
  courseTitle: string,
  courseDescription: string,
  totalHours: number,
  weeklyPlan: WeeklyPlanItem[],
  councilInfo: CouncilInfo,
  executionOverride?: StageExecutionMode
): Promise<string> {
  const prompt = buildStage4LearnerInstructionsPrompt(
    courseTitle,
    courseDescription,
    totalHours,
    weeklyPlan.map(w => ({ week: w.week, topic: w.topic }))
  );
  
  const progressCallback = councilInfo.mode === 'council'
    ? createCouncilProgressCallback(courseCode, 4, 'Generating learner instructions', councilInfo)
    : undefined;
    
  const instructions = await callAI(
    [{ role: 'user', content: prompt }],
    4,
    { maxTokens: 3000, progressCallback },
    executionOverride
  );
  
  return instructions;
}

// ============================================================================
// MAIN STAGE 4 RUNNER
// ============================================================================

export async function runStage4(
  courseCode: string, 
  executionOverride?: StageExecutionMode,
  options?: Stage4Options
): Promise<StageResult> {
  const { resume = true, forceRestart = false } = options || {};
  
  try {
    console.log('Stage 4: Starting content pack generation for', courseCode);
    
    // Get council info for progress reporting
    const councilInfo = getCouncilInfo(4, executionOverride);
    const council: CouncilInfo = {
      mode: councilInfo.mode,
      memberCount: councilInfo.memberCount,
      models: councilInfo.models,
      chairmanModel: councilInfo.chairmanModel,
      phase: councilInfo.mode === 'council' ? 'deliberating' : undefined
    };
    
    startStageProgress(courseCode, 4, 'Initializing content pack generation', council);
    
    // Get course data
    const course = await neo4j.getCourse(courseCode);
    if (!course) {
      throw new Error(`Course ${courseCode} not found`);
    }
    
    // Get learning nodes, CLOs, and topics
    const nodes = await neo4j.getLearningNodes(courseCode);
    const clos = await neo4j.getCLOs(courseCode);
    const allTopics = await neo4j.getTopics(courseCode);
    
    if (nodes.length === 0) {
      throw new Error('No learning nodes found. Please run Stage 2 first.');
    }
    
    // Get weekly plan and assessment blueprint from snapshot
    const extractedSnapshot = fileService.getExtractedSnapshot(courseCode);
    const weeklyPlan = extractedSnapshot?.weekly_plan || [];
    const assessmentBlueprint: Assessment[] = extractedSnapshot?.assessments || [];
    
    // Get course contract for assessment strategy
    const contract = fileService.getCourseContract(courseCode);
    const assessmentStrategy = contract?.assessment_strategy || '';
    
    // Create CLO lookup map
    const cloMap = new Map<string, CLO>();
    for (const clo of clos) {
      cloMap.set(clo.clo_id, clo);
    }
    
    // ================================================================
    // PHASE 0: Load Stage 3 diagnostic logic
    // ================================================================
    console.log('Stage 4: Phase 0 - Loading Stage 3 diagnostic logic...');
    updateProgress({
      courseCode, stage: 4, status: 'running',
      step: 'Loading Stage 3 diagnostics',
      message: 'Building per-node diagnostic logic lookup from Stage 3...',
      council
    });
    
    const stage3Map = loadStage3LogicMap(courseCode, nodes);
    
    // Check for existing checkpoint
    let checkpoint = resume && !forceRestart ? fileService.getStage4Checkpoint(courseCode) : null;
    let completedNodeIds = new Set<string>(checkpoint?.completedNodeIds || []);
    let errorCount = checkpoint?.errors || 0;
    
    // Handle force restart
    if (forceRestart || !resume) {
      console.log('Stage 4: Fresh start - clearing existing content...');
      fileService.deleteStage4Content(courseCode);
      fileService.clearStage4ErrorLog(courseCode);
      fileService.deleteStage4Checkpoint(courseCode);
      completedNodeIds = new Set<string>();
      errorCount = 0;
      checkpoint = null;
    } else if (checkpoint) {
      const existingFiles = new Set(fileService.getExistingStage4NodeIds(courseCode));
      completedNodeIds = new Set(
        Array.from(completedNodeIds).filter(id => existingFiles.has(id))
      );
      console.log(`Stage 4: Resuming - ${completedNodeIds.size}/${nodes.length} nodes already completed`);
    }
    
    const startedAt = checkpoint?.startedAt || new Date().toISOString();
    const totalNodes = nodes.length;
    const contentPacks = new Map<string, Stage4NodeContent>();
    const errors: string[] = [];
    
    // Tracking maps for new artifacts
    const modalityPlans = new Map<string, ModalityPlan>();
    const instructionalPackages = new Map<string, NodeInstructionalPackage>();
    const diagnosticAssessments = new Map<string, DiagnosticAssessment>();
    const llmInteractiveSpecs = new Map<string, LLMInteractiveAssessmentSpec>();
    const remediationPacks = new Map<string, NodeRemediationPack>();
    
    // ================================================================
    // PHASE A+B+C+D+E: Per-node generation loop
    // ================================================================
    console.log(`Stage 4: Phases A-E - Generating artifacts for ${nodes.length} nodes...`);
    
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      
      // Skip completed nodes (resume support)
      if (completedNodeIds.has(node.node_id)) {
        const existing = fileService.getStage4NodeContent(courseCode, node.node_id);
        if (existing) contentPacks.set(node.node_id, existing);
        // Load existing enhanced artifacts
        const existingPlan = fileService.getStage4ModalityPlan(courseCode, node.node_id);
        if (existingPlan) modalityPlans.set(node.node_id, existingPlan);
        const existingPkg = fileService.getStage4InstructionalPackage(courseCode, node.node_id);
        if (existingPkg) instructionalPackages.set(node.node_id, existingPkg);
        const existingDiag = fileService.getStage4DiagnosticAssessment(courseCode, node.node_id);
        if (existingDiag) diagnosticAssessments.set(node.node_id, existingDiag);
        const existingLLM = fileService.getStage4LLMInteractiveSpec(courseCode, node.node_id);
        if (existingLLM) llmInteractiveSpecs.set(node.node_id, existingLLM);
        const existingRem = fileService.getStage4RemediationPack(courseCode, node.node_id);
        if (existingRem) remediationPacks.set(node.node_id, existingRem);
        continue;
      }
      
      try {
        const clo = cloMap.get(node.clo_id);
        if (!clo) {
          throw new Error(`CLO ${node.clo_id} not found for node ${node.node_id}`);
        }
        const stage3Logic = stage3Map.get(node.node_id);
        
        // --- Step A: Modality Plan ---
        updateItemProgress(courseCode, 4,
          `Modality Plan: ${node.learning_intent.substring(0, 40)}...`,
          completedNodeIds.size + 1, totalNodes, node.node_id, council
        );
        
        const modalityPlan = await generateModalityPlan(
          node, clo, stage3Logic, council, courseCode, executionOverride
        );
        fileService.saveStage4ModalityPlan(courseCode, node.node_id, modalityPlan);
        modalityPlans.set(node.node_id, modalityPlan);
        
        // --- Step B: Instructional Package ---
        updateItemProgress(courseCode, 4,
          `Instructional Package: ${node.learning_intent.substring(0, 40)}...`,
          completedNodeIds.size + 1, totalNodes, node.node_id, council
        );
        
        const instrPkg = await generateInstructionalPackage(
          node, clo, stage3Logic, nodes, council, courseCode, executionOverride
        );
        fileService.saveStage4InstructionalPackage(courseCode, node.node_id, instrPkg);
        instructionalPackages.set(node.node_id, instrPkg);
        
        // Also generate legacy content pack for backward compatibility
        const contentSummary = instrPkg.core_explanation.substring(0, 2000);
        
        // --- Step C Layer 1: Diagnostic Assessment ---
        if (stage3Logic) {
          updateItemProgress(courseCode, 4,
            `Diagnostic Assessment: ${node.learning_intent.substring(0, 40)}...`,
            completedNodeIds.size + 1, totalNodes, node.node_id, council
          );
          
          const diagAssessment = await generateDiagnosticAssessment(
            node, clo, stage3Logic, council, courseCode, executionOverride
          );
          fileService.saveStage4DiagnosticAssessment(courseCode, node.node_id, diagAssessment);
          diagnosticAssessments.set(node.node_id, diagAssessment);
          
          // --- Step C Layer 2: LLM-Interactive Spec (if qualifying) ---
          const llmQual = getLLMInteractiveQualification(node, stage3Logic);
          if (llmQual) {
            updateItemProgress(courseCode, 4,
              `LLM-Interactive Spec: ${node.learning_intent.substring(0, 40)}...`,
              completedNodeIds.size + 1, totalNodes, node.node_id, council
            );
            
            const llmSpec = await generateLLMInteractiveSpec(
              node, clo, stage3Logic, llmQual, council, courseCode, executionOverride
            );
            fileService.saveStage4LLMInteractiveSpec(courseCode, node.node_id, llmSpec);
            llmInteractiveSpecs.set(node.node_id, llmSpec);
          }
          
          // --- Step D: Remediation Assets ---
          if (stage3Logic.failure_types.length > 0 && stage3Logic.remediation_paths.length > 0) {
            updateItemProgress(courseCode, 4,
              `Remediation Assets: ${node.learning_intent.substring(0, 40)}...`,
              completedNodeIds.size + 1, totalNodes, node.node_id, council
            );
            
            const remPack = await generateRemediationAssets(
              node, clo, stage3Logic, council, courseCode, executionOverride
            );
            fileService.saveStage4RemediationPack(courseCode, node.node_id, remPack);
            remediationPacks.set(node.node_id, remPack);
          }
        }
        
        // --- Step E: Visual Asset Specs + Video Production Packages ---
        updateItemProgress(courseCode, 4,
          `Media Specs: ${node.learning_intent.substring(0, 40)}...`,
          completedNodeIds.size + 1, totalNodes, node.node_id, council
        );
        
        const visualSpecs = await generateVisualAssetSpecs(
          node, clo, stage3Logic, contentSummary, council, courseCode, executionOverride
        );
        if (visualSpecs.length > 0) {
          fileService.saveStage4VisualAssetSpecs(courseCode, node.node_id, visualSpecs);
        }
        
        const videoPackage = await generateVideoProductionPackage(
          node, clo, contentSummary, council, courseCode, executionOverride
        );
        if (videoPackage) {
          fileService.saveStage4VideoProductionPackage(courseCode, node.node_id, videoPackage);
        }
        
        // --- Legacy content pack (backward compatibility) ---
        const legacyAssessments = await generateNodeAssessments(
          node, clo, council, courseCode, executionOverride
        );
        const legacyVisuals = await generateVisualPrompts(
          node, contentSummary, council, courseCode, executionOverride
        );
        const legacyVideo = await generateVideoScript(
          node, clo, contentSummary, council, courseCode, executionOverride
        );
        
        const timeBreakdown = getTimeBreakdown(node.node_type);
        const contentPack: Stage4NodeContent = {
          node_id: node.node_id,
          clo_id: node.clo_id,
          node_type: node.node_type,
          modalities: getContentModalities(node.node_type),
          instructional_content: `${instrPkg.overview.summary}\n\n${instrPkg.core_explanation}`,
          learner_instructions: `Complete the following learning activities for: ${node.learning_intent}`,
          visual_prompts: legacyVisuals,
          video_script: legacyVideo,
          assessments: legacyAssessments,
          time_on_task_minutes: timeBreakdown.total,
          generated_at: new Date().toISOString(),
          content_version: '3.0'
        };
        
        fileService.saveStage4NodeContent(courseCode, node.node_id, contentPack);
        contentPacks.set(node.node_id, contentPack);
        
        // Update Neo4j
        await neo4j.updateLearningNode(node.node_id, {
          content_path: fileService.getStage4NodeContentPath(courseCode, node.node_id)
        });
        
        completedNodeIds.add(node.node_id);
        
        // Update checkpoint
        const updatedCheckpoint: Stage4Checkpoint = {
          courseCode,
          completedNodeIds: Array.from(completedNodeIds),
          totalNodes,
          startedAt,
          lastUpdatedAt: new Date().toISOString(),
          errors: errorCount
        };
        fileService.saveStage4Checkpoint(courseCode, updatedCheckpoint);
        
      } catch (nodeError) {
        const errorMsg = `Failed content pack for ${node.node_id}: ${nodeError instanceof Error ? nodeError.message : String(nodeError)}`;
        console.error(errorMsg);
        errors.push(errorMsg);
        errorCount++;
        
        const errorEntry: Stage4ErrorEntry = {
          timestamp: new Date().toISOString(),
          nodeId: node.node_id,
          errorMessage: nodeError instanceof Error ? nodeError.message : String(nodeError),
          errorStack: nodeError instanceof Error ? nodeError.stack : undefined,
          attempt: 1
        };
        fileService.appendStage4ErrorLog(courseCode, errorEntry);
      }
    }
    
    // ================================================================
    // PHASE C LAYER 3: Summative Assessments
    // ================================================================
    console.log('Stage 4: Phase C3 - Generating summative assessments...');
    updateProgress({
      courseCode, stage: 4, status: 'running',
      step: 'Generating summative assessments',
      message: 'Creating course-level summative assessment artifacts...',
      council
    });
    
    let summativePack: SummativeAssessmentPack | null = null;
    try {
      summativePack = await generateSummativeAssessments(
        courseCode, course.title, clos, assessmentBlueprint, assessmentStrategy,
        council, executionOverride
      );
      fileService.saveStage4SummativeAssessments(courseCode, summativePack);
    } catch (error) {
      const msg = `Failed summative assessments: ${error instanceof Error ? error.message : String(error)}`;
      console.error(msg);
      errors.push(msg);
    }
    
    // ================================================================
    // PHASE F: Course Book Assembly
    // ================================================================
    console.log('Stage 4: Phase F - Assembling course book...');
    updateProgress({
      courseCode, stage: 4, status: 'running',
      step: 'Assembling course book',
      message: 'Compiling node content into traceable course book...',
      council
    });
    
    const courseBook = assembleCourseBook(
      courseCode, course.title, clos, nodes, allTopics, instructionalPackages
    );
    const courseBookMarkdown = renderCourseBookMarkdown(courseBook);
    fileService.saveStage4CourseBook(courseCode, courseBook, courseBookMarkdown);
    
    // ================================================================
    // PHASE G: Enhanced Workload Map
    // ================================================================
    console.log('Stage 4: Phase G - Computing enhanced workload map...');
    updateProgress({
      courseCode, stage: 4, status: 'running',
      step: 'Computing workload map',
      message: 'Analyzing time-on-task, credit alignment, and compliance flags...',
      council
    });
    
    // Compute base workload first
    const baseWorkloadMap = await calculateWorkloadMap(
      courseCode, nodes, contentPacks, weeklyPlan, course.credit_hours
    );
    
    const enhancedWorkload = computeEnhancedWorkloadMap(
      baseWorkloadMap, clos, nodes, allTopics,
      baseWorkloadMap.nodes, summativePack, course.credit_hours
    );
    fileService.saveStage4WorkloadMap(courseCode, enhancedWorkload);
    
    // ================================================================
    // PHASE: Course Rubric + Learner Instructions (legacy)
    // ================================================================
    console.log('Stage 4: Generating course rubric...');
    updateProgress({
      courseCode, stage: 4, status: 'running',
      step: 'Generating course rubric',
      message: 'Creating CLO-aligned rubric and marking guide...',
      council
    });
    
    const rubric = await generateCourseRubric(
      courseCode, course.title, clos, council, executionOverride
    );
    fileService.saveStage4Rubric(courseCode, rubric);
    
    console.log('Stage 4: Generating learner instructions...');
    updateProgress({
      courseCode, stage: 4, status: 'running',
      step: 'Generating learner instructions',
      message: 'Creating learner-facing course guide...',
      council
    });
    
    const learnerInstructions = await generateLearnerInstructions(
      courseCode, course.title, course.description,
      enhancedWorkload.total_hours, weeklyPlan, council, executionOverride
    );
    fileService.saveStage4LearnerInstructions(courseCode, learnerInstructions);
    
    // ================================================================
    // VALIDATION
    // ================================================================
    console.log('Stage 4: Running validation checks...');
    const validationReport = validateStage4Outputs(
      courseCode, nodes, stage3Map,
      { modalityPlans, instructionalPackages, diagnosticAssessments, remediationPacks, llmInteractiveSpecs }
    );
    fileService.saveStage4ValidationReport(courseCode, validationReport);
    
    // Update course stage
    await neo4j.updateCourseStage(courseCode, 4);
    
    // Clear checkpoint on success
    if (completedNodeIds.size === totalNodes) {
      fileService.deleteStage4Checkpoint(courseCode);
    }
    
    // Generate content pack summary
    const contentPackSummary: Stage4ContentPack = {
      course_code: courseCode,
      title: course.title,
      total_nodes: totalNodes,
      nodes_with_content: completedNodeIds.size,
      nodes_with_video: Array.from(contentPacks.values()).filter(cp => cp.video_script).length,
      total_assessments: Array.from(contentPacks.values()).reduce((sum, cp) => sum + cp.assessments.length, 0),
      total_visual_prompts: Array.from(contentPacks.values()).reduce((sum, cp) => sum + cp.visual_prompts.length, 0),
      node_content_status: nodes.map(node => {
        const cp = contentPacks.get(node.node_id);
        return {
          node_id: node.node_id,
          has_content: !!cp,
          has_video: !!cp?.video_script,
          has_assessments: (cp?.assessments.length || 0) > 0,
          assessment_types: cp?.assessments.map(a => a.assessment_type) || []
        };
      }),
      workload_summary: {
        total_hours: enhancedWorkload.total_hours,
        alignment_status: enhancedWorkload.alignment_status,
        deviation_percentage: enhancedWorkload.deviation_percentage
      },
      has_rubric: true,
      is_complete: completedNodeIds.size === totalNodes && enhancedWorkload.alignment_status === 'aligned',
      completion_percentage: Math.round((completedNodeIds.size / totalNodes) * 100),
      missing_items: errors,
      generated_at: new Date().toISOString()
    };
    
    fileService.saveStage4ContentPackSummary(courseCode, contentPackSummary);
    
    const summaryMsg = `Generated ${completedNodeIds.size}/${totalNodes} nodes | ${diagnosticAssessments.size} diagnostic assessments | ${llmInteractiveSpecs.size} LLM-interactive specs | ${remediationPacks.size} remediation packs | Workload: ${enhancedWorkload.alignment_status} (${enhancedWorkload.total_hours}h / ${enhancedWorkload.expected_hours}h) | Validation: ${validationReport.is_valid ? 'PASSED' : 'ISSUES FOUND'}`;
    
    console.log(`Stage 4: Complete. ${summaryMsg}`);
    completeStageProgress(courseCode, 4, summaryMsg);
    
    return {
      success: errors.length === 0,
      stage: 4,
      message: summaryMsg,
      data: {
        course_code: courseCode,
        generated_count: completedNodeIds.size,
        total_nodes: nodes.length,
        videos_generated: contentPackSummary.nodes_with_video,
        assessments_generated: contentPackSummary.total_assessments,
        diagnostic_assessments: diagnosticAssessments.size,
        llm_interactive_specs: llmInteractiveSpecs.size,
        remediation_packs: remediationPacks.size,
        course_book_generated: true,
        summative_assessments_generated: summativePack ? summativePack.artifacts.length : 0,
        workload: enhancedWorkload,
        rubric_generated: true,
        validation: validationReport,
        errors: errors.length > 0 ? errors : undefined
      }
    };
    
  } catch (error) {
    console.error('Stage 4 Error:', error);
    errorStageProgress(courseCode, 4, error instanceof Error ? error.message : String(error));
    
    const errorEntry: Stage4ErrorEntry = {
      timestamp: new Date().toISOString(),
      nodeId: 'STAGE_CRITICAL',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      attempt: 1
    };
    fileService.appendStage4ErrorLog(courseCode, errorEntry);
    
    return {
      success: false,
      stage: 4,
      message: 'Failed to complete Stage 4',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Legacy function for backward compatibility
export async function runStage4WithCouncil(courseCode: string, options?: Stage4Options): Promise<StageResult> {
  return runStage4(courseCode, 'council', options);
}

// ============================================================================
// RETRIEVAL FUNCTIONS
// ============================================================================

export function getStage4CheckpointStatus(courseCode: string): Stage4Checkpoint | null {
  return fileService.getStage4Checkpoint(courseCode);
}

export function getStage4Errors(courseCode: string): Stage4ErrorEntry[] {
  return fileService.getStage4ErrorLog(courseCode);
}

export function clearStage4Errors(courseCode: string): void {
  fileService.clearStage4ErrorLog(courseCode);
}

export function getStage4ContentPack(courseCode: string): Stage4ContentPack | null {
  return fileService.getStage4ContentPackSummary(courseCode);
}

export function getStage4NodeContent(courseCode: string, nodeId: string): Stage4NodeContent | null {
  return fileService.getStage4NodeContent(courseCode, nodeId);
}

export function getStage4WorkloadMap(courseCode: string): WorkloadMap | null {
  return fileService.getStage4WorkloadMap(courseCode);
}

export function getStage4Rubric(courseCode: string): CourseRubric | null {
  return fileService.getStage4Rubric(courseCode);
}

export function getStage4LearnerInstructions(courseCode: string): string | null {
  return fileService.getStage4LearnerInstructions(courseCode);
}

export function getNodeAssessments(courseCode: string, nodeId: string): NodeAssessment[] {
  const contentPack = fileService.getStage4NodeContent(courseCode, nodeId);
  return contentPack?.assessments || [];
}

export function getNodeVideoScript(courseCode: string, nodeId: string): VideoScript | null {
  const contentPack = fileService.getStage4NodeContent(courseCode, nodeId);
  return contentPack?.video_script || null;
}

// ============================================================================
// NEW RETRIEVAL FUNCTIONS — Steps A–G Artifacts
// ============================================================================

export function getStage4ModalityPlan(courseCode: string, nodeId: string): ModalityPlan | null {
  return fileService.getStage4ModalityPlan(courseCode, nodeId);
}

export function getStage4InstructionalPackage(courseCode: string, nodeId: string): NodeInstructionalPackage | null {
  return fileService.getStage4InstructionalPackage(courseCode, nodeId);
}

export function getStage4DiagnosticAssessment(courseCode: string, nodeId: string): DiagnosticAssessment | null {
  return fileService.getStage4DiagnosticAssessment(courseCode, nodeId);
}

export function getStage4LLMInteractiveSpec(courseCode: string, nodeId: string): LLMInteractiveAssessmentSpec | null {
  return fileService.getStage4LLMInteractiveSpec(courseCode, nodeId);
}

export function getStage4RemediationPack(courseCode: string, nodeId: string): NodeRemediationPack | null {
  return fileService.getStage4RemediationPack(courseCode, nodeId);
}

export function getStage4SummativeAssessments(courseCode: string): SummativeAssessmentPack | null {
  return fileService.getStage4SummativeAssessments(courseCode);
}

export function getStage4CourseBook(courseCode: string): CourseBook | null {
  return fileService.getStage4CourseBook(courseCode);
}

export function getStage4CourseBookMarkdown(courseCode: string): string | null {
  return fileService.getStage4CourseBookMarkdown(courseCode);
}

export function getStage4ValidationReport(courseCode: string): Stage4ValidationReport | null {
  return fileService.getStage4ValidationReport(courseCode);
}

export function getStage4VisualAssetSpecs(courseCode: string, nodeId: string): VisualAssetSpec[] | null {
  return fileService.getStage4VisualAssetSpecs(courseCode, nodeId);
}

export function getStage4VideoProductionPackage(courseCode: string, nodeId: string): VideoProductionPackage | null {
  return fileService.getStage4VideoProductionPackage(courseCode, nodeId);
}
