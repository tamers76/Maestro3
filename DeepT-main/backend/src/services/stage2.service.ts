import { callAI, parseAIJson, getCouncilInfo, getStageConfig, type CouncilProgressCallback } from './ai.service.js';
import * as neo4j from './neo4j.service.js';
import * as fileService from './file.service.js';
import { buildStage2Prompt, buildStage2PrereqSynthesisPrompt } from '../utils/prompts.js';
import { startStageProgress, updateItemProgress, updateProgress, completeStageProgress, errorStageProgress, type CouncilInfo } from './progress.service.js';
import type { LearningNode, Topic, StageResult, CLO, StageExecutionMode, SkippingEligibility, RequiredStatus } from '../models/schemas.js';
import { CANONICAL_NODE_TYPES } from '../models/schemas.js';

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

/** Shape returned by the AI for a single topic decomposition */
interface TopicNodeResult {
  nodes: Array<{
    node_id: string;
    node_type: string;
    learning_intent: string;
    prerequisite_nodes: string[];
    risk_level: string;
    failure_meaning: string;
    diagnostic_intent: string;
    required_status?: string;
    skipping_eligibility?: string;
    skip_conditions?: string;
  }>;
}

/** Shape returned by the AI for cross-topic prerequisite synthesis */
interface PrereqSynthesisResult {
  edges: Array<{
    source_node_id: string;
    target_node_id: string;
    rationale?: string;
  }>;
}

// ============================================================================
// VALIDATION / ENFORCEMENT HELPERS
// ============================================================================

/** Validate / repair a node_type to be within canonical set */
function enforceNodeType(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if ((CANONICAL_NODE_TYPES as string[]).includes(lower)) return lower;
  // Map common legacy types
  const mapping: Record<string, string> = {
    practice: 'application',
    assessment: 'metacognitive',
    remediation: 'procedure',
    knowledge: 'concept',
    theory: 'principle',
    skill: 'procedure',
    reflection: 'metacognitive',
  };
  return mapping[lower] || 'concept';
}

function enforceSkippingEligibility(raw?: string): SkippingEligibility {
  const valid: SkippingEligibility[] = ['non_skippable', 'conditionally_skippable', 'skippable', 'not_applicable'];
  if (raw && valid.includes(raw as SkippingEligibility)) return raw as SkippingEligibility;
  return 'non_skippable';
}

function enforceRequiredStatus(raw?: string): RequiredStatus {
  if (raw === 'optional') return 'optional';
  return 'mandatory';
}

/** Ensure diagnostic fields are non-empty; provide fallback text if AI left them blank */
function enforceDiagnosticFields(
  node: { failure_meaning: string; diagnostic_intent: string; learning_intent: string; node_type: string }
): { failure_meaning: string; diagnostic_intent: string } {
  const failure_meaning = (node.failure_meaning || '').trim() ||
    `Learner cannot ${node.learning_intent.toLowerCase()}`;
  const diagnostic_intent = (node.diagnostic_intent || '').trim() ||
    `Diagnose understanding of ${node.node_type}: ${node.learning_intent}`;
  return { failure_meaning, diagnostic_intent };
}

// Maximum retry attempts for minimum-node enforcement
const MAX_RETRY_ATTEMPTS = 2;
const MIN_NODES_PER_TOPIC = 3;

// ============================================================================
// MAIN STAGE 2 FUNCTION
// ============================================================================

export async function runStage2(courseCode: string, executionOverride?: StageExecutionMode): Promise<StageResult> {
  try {
    console.log('Stage 2: Starting cognitive node decomposition for', courseCode);
    
    // Get council info for progress reporting
    const councilInfo = getCouncilInfo(2, executionOverride);
    const council: CouncilInfo = {
      mode: councilInfo.mode,
      memberCount: councilInfo.memberCount,
      models: councilInfo.models,
      chairmanModel: councilInfo.chairmanModel,
      phase: councilInfo.mode === 'council' ? 'deliberating' : undefined
    };
    
    // Get stage config for custom prompts
    const stageConfig = getStageConfig(2);
    
    startStageProgress(courseCode, 2, 'Initializing cognitive node decomposition', council);
    
    // Get course contract with CLO analysis
    const contract = fileService.getCourseContract(courseCode);
    if (!contract) {
      throw new Error('Course contract not found. Please run Stage 1 first.');
    }
    
    // Get snapshot to load approved CLO topics
    const snapshot = fileService.getExtractedSnapshot(courseCode);
    const cloTopicsMap = new Map<string, Array<{ topic_id: string; title: string; description: string; readings?: string }>>();
    if (snapshot?.clo_topics) {
      for (const group of snapshot.clo_topics) {
        cloTopicsMap.set(group.clo_id, group.topics);
      }
    }
    
    // Delete existing learning nodes + topics if regenerating
    await neo4j.deleteLearningNodes(courseCode);
    
    const allNodes: LearningNode[] = [];
    const allTopics: Topic[] = [];
    
    // Count total topics across all CLOs for progress reporting
    // Add 1 extra step per CLO for Pass 2 (cross-topic prereq synthesis)
    let totalSteps = 0;
    for (const clo of contract.course_learning_outcomes) {
      const topics = cloTopicsMap.get(clo.clo_id) || [];
      totalSteps += Math.max(topics.length, 1); // at least 1 synthetic topic per CLO
      totalSteps += 1; // cross-topic prerequisite synthesis step
    }
    let completedSteps = 0;
    
    // =========================================================================
    // PASS 1: Per-topic node generation (cognitive moves → nodes)
    // =========================================================================
    
    for (let i = 0; i < contract.course_learning_outcomes.length; i++) {
      const clo = contract.course_learning_outcomes[i];
      const cloTopics = cloTopicsMap.get(clo.clo_id) || [];
      console.log(`Stage 2: Decomposing ${clo.clo_id} (${cloTopics.length} topics)...`);
      
      // If no approved topics, create a single synthetic topic for the whole CLO
      const topicsToProcess = cloTopics.length > 0 
        ? cloTopics 
        : [{ topic_id: `${clo.clo_id}-T1`, title: `${clo.clo_id} General`, description: clo.clo_text, readings: '' }];
      
      const cloAnalysis = {
        bloom_level: clo.bloom_level,
        knowledge_type: clo.knowledge_type,
        risk_level: clo.risk_level,
        capability_statement: clo.capability_statement,
        evidence_of_mastery: clo.evidence_of_mastery
      };
      
      // Track all node IDs within this CLO for prereq filtering
      const allNodeIdsForClo = new Set<string>();
      const cloNodes: LearningNode[] = [];
      
      // Track nodes grouped by topic for Pass 2
      const nodesByTopicForClo: Array<{
        topic_id: string;
        title: string;
        nodes: Array<{
          node_id: string;
          node_type: string;
          learning_intent: string;
          risk_level: string;
          prerequisite_nodes: string[];
        }>;
      }> = [];
      
      for (let tIdx = 0; tIdx < topicsToProcess.length; tIdx++) {
        const topic = topicsToProcess[tIdx];
        const topicIndex = tIdx + 1; // 1-based
        completedSteps++;
        
        console.log(`Stage 2:   Topic ${topicIndex}/${topicsToProcess.length}: "${topic.title}" (${topic.topic_id})`);
        
        // Update progress
        updateItemProgress(
          courseCode,
          2,
          `Pass 1: ${clo.clo_id} — Topic ${topicIndex}/${topicsToProcess.length}: ${topic.title}`,
          completedSteps,
          totalSteps,
          `${clo.clo_id}/${topic.topic_id}`,
          council
        );
        
        // Always create Topic entity (even if AI returns 0 nodes)
        const topicEntity: Topic = {
          topic_id: topic.topic_id,
          clo_id: clo.clo_id,
          title: topic.title,
          description: topic.description || '',
          readings: topic.readings || '',
          rationale: ''
        };
        allTopics.push(topicEntity);
        
        // Build per-topic prompt
        const prompt = buildStage2Prompt(
          clo.clo_id, clo.clo_text, cloAnalysis,
          topic, topicIndex, stageConfig.taskPrompt
        );
        
        const progressCallback = council.mode === 'council'
          ? createCouncilProgressCallback(courseCode, 2, `Decomposing ${clo.clo_id} / ${topic.title}`, council)
          : undefined;
        
        // Call AI with retry logic for minimum node count
        let result: TopicNodeResult | null = null;
        let attempt = 0;
        
        while (attempt <= MAX_RETRY_ATTEMPTS) {
          const currentPrompt = attempt === 0
            ? prompt
            : `${prompt}\n\nIMPORTANT CORRECTION: Your previous response returned only ${result?.nodes?.length ?? 0} nodes. The MINIMUM is ${MIN_NODES_PER_TOPIC} nodes per topic (target 3–6). You MUST produce at least ${MIN_NODES_PER_TOPIC} cognitive-move nodes. Think about what additional cognitive moves are needed for mastery of this subtopic.`;
          
          const response = await callAI(
            [{ role: 'user', content: currentPrompt }],
            2,
            { jsonMode: true, progressCallback: attempt === 0 ? progressCallback : undefined },
            executionOverride
          );
          
          result = parseAIJson<TopicNodeResult>(response);
          
          // Handle case where AI returns array directly (array of nodes)
          if (Array.isArray(result)) {
            result = { nodes: result as unknown as TopicNodeResult['nodes'] };
          }
          
          const nodeCount = result?.nodes?.length ?? 0;
          
          if (nodeCount >= MIN_NODES_PER_TOPIC) {
            break; // Good enough
          }
          
          if (nodeCount > 0 && attempt >= MAX_RETRY_ATTEMPTS) {
            console.warn(`Stage 2:   Topic "${topic.title}" — accepted ${nodeCount} nodes after ${attempt + 1} attempts (below minimum ${MIN_NODES_PER_TOPIC})`);
            break; // Accept what we have after exhausting retries
          }
          
          if (nodeCount === 0 && attempt >= MAX_RETRY_ATTEMPTS) {
            console.warn(`Stage 2:   Topic "${topic.title}" (${topic.topic_id}) — AI returned 0 nodes after ${attempt + 1} attempts`);
            break;
          }
          
          console.log(`Stage 2:   Topic "${topic.title}" — retry ${attempt + 1}: only ${nodeCount} nodes (need >= ${MIN_NODES_PER_TOPIC})`);
          attempt++;
        }
        
        if (!result || !result.nodes || !Array.isArray(result.nodes) || result.nodes.length === 0) {
          console.warn(`Stage 2:   Topic "${topic.title}" (${topic.topic_id}) — 0 nodes after all attempts, skipping`);
          nodesByTopicForClo.push({ topic_id: topic.topic_id, title: topic.title, nodes: [] });
          continue;
        }
        
        console.log(`Stage 2:   Topic "${topic.title}" → ${result.nodes.length} nodes from AI`);
        
        // Collect node summaries for Pass 2
        const topicNodeSummaries: typeof nodesByTopicForClo[0]['nodes'] = [];
        
        // Collect node IDs for prereq filtering
        for (const n of result.nodes) {
          allNodeIdsForClo.add(n.node_id);
        }
        
        // Create LearningNode objects
        for (const n of result.nodes) {
          const nodeType = enforceNodeType(n.node_type);
          
          // Filter prerequisites: only allow references to nodes within this topic, no self-deps
          const topicNodeIds = new Set(result.nodes.map(x => x.node_id));
          const filteredPrereqs = [...new Set(
            (n.prerequisite_nodes || []).filter(
              pid => pid !== n.node_id && topicNodeIds.has(pid)
            )
          )];
          
          const requiredStatus = enforceRequiredStatus(n.required_status);
          const skippingEligibility = enforceSkippingEligibility(n.skipping_eligibility);
          const mandatory = requiredStatus === 'mandatory';
          const skippable = skippingEligibility === 'skippable' || skippingEligibility === 'conditionally_skippable';
          
          // Enforce diagnostic fields
          const diagnostics = enforceDiagnosticFields({
            failure_meaning: n.failure_meaning,
            diagnostic_intent: n.diagnostic_intent,
            learning_intent: n.learning_intent,
            node_type: nodeType
          });
          
          const node: LearningNode = {
            node_id: n.node_id,
            clo_id: clo.clo_id,
            topic_id: topic.topic_id,
            topic_title: topic.title,
            node_type: nodeType,
            learning_intent: n.learning_intent,
            prerequisite_nodes: filteredPrereqs,
            risk_level: (n.risk_level as LearningNode['risk_level']) || 'medium',
            mandatory,
            skippable,
            required_status: requiredStatus,
            skipping_eligibility: skippingEligibility,
            skip_conditions: n.skip_conditions || '',
            failure_meaning: diagnostics.failure_meaning,
            diagnostic_intent: diagnostics.diagnostic_intent
          };
          
          cloNodes.push(node);
          
          topicNodeSummaries.push({
            node_id: n.node_id,
            node_type: nodeType,
            learning_intent: n.learning_intent,
            risk_level: node.risk_level,
            prerequisite_nodes: filteredPrereqs
          });
        }
        
        nodesByTopicForClo.push({
          topic_id: topic.topic_id,
          title: topic.title,
          nodes: topicNodeSummaries
        });
      }
      
      // =====================================================================
      // PASS 2: Cross-topic prerequisite synthesis (per CLO)
      // =====================================================================
      
      completedSteps++;
      updateItemProgress(
        courseCode,
        2,
        `Pass 2: ${clo.clo_id} — Cross-topic prerequisite synthesis`,
        completedSteps,
        totalSteps,
        `${clo.clo_id}/prereq-synthesis`,
        council
      );
      
      // Only run Pass 2 if there are multiple topics with nodes
      const topicsWithNodes = nodesByTopicForClo.filter(t => t.nodes.length > 0);
      
      if (topicsWithNodes.length >= 2) {
        console.log(`Stage 2:   Pass 2: Synthesizing cross-topic prerequisites for ${clo.clo_id} (${topicsWithNodes.length} topics, ${cloNodes.length} nodes)`);
        
        // Collect existing within-topic edges
        const withinTopicEdges: Array<{ source_node_id: string; target_node_id: string }> = [];
        for (const node of cloNodes) {
          for (const prereqId of node.prerequisite_nodes) {
            withinTopicEdges.push({ source_node_id: node.node_id, target_node_id: prereqId });
          }
        }
        
        const prereqPrompt = buildStage2PrereqSynthesisPrompt(
          clo.clo_id,
          clo.clo_text,
          topicsWithNodes,
          withinTopicEdges
        );
        
        try {
          const prereqResponse = await callAI(
            [{ role: 'user', content: prereqPrompt }],
            2,
            { jsonMode: true },
            executionOverride
          );
          
          let prereqResult = parseAIJson<PrereqSynthesisResult>(prereqResponse);
          
          // Handle direct array
          if (Array.isArray(prereqResult)) {
            prereqResult = { edges: prereqResult as unknown as PrereqSynthesisResult['edges'] };
          }
          
          if (prereqResult?.edges && Array.isArray(prereqResult.edges) && prereqResult.edges.length > 0) {
            // Filter to valid edges only (both nodes must exist in this CLO)
            const validCrossEdges = prereqResult.edges.filter(e =>
              allNodeIdsForClo.has(e.source_node_id) &&
              allNodeIdsForClo.has(e.target_node_id) &&
              e.source_node_id !== e.target_node_id
            );
            
            if (validCrossEdges.length > 0) {
              // Combine within-topic and cross-topic edges for DAG validation
              const allEdges = [
                ...withinTopicEdges,
                ...validCrossEdges.map(e => ({
                  source_node_id: e.source_node_id,
                  target_node_id: e.target_node_id
                }))
              ];
              
              // Validate DAG
              const dagResult = await neo4j.validateCloEdgesDAG(clo.clo_id, allEdges);
              
              if (dagResult.valid) {
                // Apply cross-topic edges to cloNodes
                for (const edge of validCrossEdges) {
                  const sourceNode = cloNodes.find(n => n.node_id === edge.source_node_id);
                  if (sourceNode && !sourceNode.prerequisite_nodes.includes(edge.target_node_id)) {
                    sourceNode.prerequisite_nodes.push(edge.target_node_id);
                  }
                }
                console.log(`Stage 2:   Pass 2: Added ${validCrossEdges.length} cross-topic prerequisite edges for ${clo.clo_id}`);
              } else {
                console.warn(`Stage 2:   Pass 2: Cross-topic edges would create a cycle in ${clo.clo_id}, discarding. Cycle: ${dagResult.cycle?.join(' → ')}`);
                // Don't apply cross-topic edges if they create cycles
              }
            } else {
              console.log(`Stage 2:   Pass 2: No valid cross-topic edges for ${clo.clo_id}`);
            }
          } else {
            console.log(`Stage 2:   Pass 2: AI returned 0 cross-topic edges for ${clo.clo_id} (topics may be independent)`);
          }
        } catch (prereqError) {
          console.warn(`Stage 2:   Pass 2: Cross-topic prerequisite synthesis failed for ${clo.clo_id}:`, prereqError);
          // Non-fatal — proceed without cross-topic edges
        }
      } else {
        console.log(`Stage 2:   Pass 2: Skipped for ${clo.clo_id} (${topicsWithNodes.length <= 1 ? 'single topic or no topics with nodes' : 'no topics'})`);
      }
      
      // Final pass: ensure all prerequisites reference valid node IDs within this CLO
      for (const node of cloNodes) {
        node.prerequisite_nodes = node.prerequisite_nodes.filter(pid => allNodeIdsForClo.has(pid));
      }
      
      allNodes.push(...cloNodes);
    }
    
    console.log(`Stage 2: Created ${allTopics.length} topics and ${allNodes.length} learning nodes`);
    updateItemProgress(courseCode, 2, 'Saving topics and nodes to database', totalSteps, totalSteps, undefined, council);
    
    // Save Topics to Neo4j first (grouped by CLO)
    const topicsByClo = new Map<string, Topic[]>();
    for (const topic of allTopics) {
      if (!topicsByClo.has(topic.clo_id)) topicsByClo.set(topic.clo_id, []);
      topicsByClo.get(topic.clo_id)!.push(topic);
    }
    for (const [cloId, topics] of topicsByClo) {
      await neo4j.createTopics(cloId, topics);
    }
    
    // Save LearningNodes to Neo4j (they reference Topics)
    await neo4j.createLearningNodes(allNodes);
    
    // Update course stage
    await neo4j.updateCourseStage(courseCode, 2);
    
    // Count cross-topic edges for reporting
    let crossTopicEdgeCount = 0;
    for (const node of allNodes) {
      for (const prereqId of node.prerequisite_nodes) {
        const prereqNode = allNodes.find(n => n.node_id === prereqId);
        if (prereqNode && prereqNode.topic_id !== node.topic_id) {
          crossTopicEdgeCount++;
        }
      }
    }
    
    console.log('Stage 2: Complete');
    const summaryMsg = `Decomposed ${contract.course_learning_outcomes.length} CLOs into ${allTopics.length} topics and ${allNodes.length} learning nodes (${crossTopicEdgeCount} cross-topic prerequisites)`;
    completeStageProgress(courseCode, 2, summaryMsg);
    
    return {
      success: true,
      stage: 2,
      message: summaryMsg,
      data: {
        course_code: courseCode,
        topics: allTopics,
        nodes: allNodes,
        topic_count: allTopics.length,
        node_count: allNodes.length,
        cross_topic_edges: crossTopicEdgeCount
      }
    };
  } catch (error) {
    console.error('Stage 2 Error:', error);
    errorStageProgress(courseCode, 2, error instanceof Error ? error.message : String(error));
    return {
      success: false,
      stage: 2,
      message: 'Failed to complete Stage 2',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
