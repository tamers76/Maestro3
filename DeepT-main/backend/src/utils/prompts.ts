// AI Prompt Templates for each stage

export const STAGE1_EXTRACTION_PROMPT = `You are an expert curriculum analyst. Analyze the following syllabus text and extract structured information.

Extract the following:
1. Course metadata (title, code, description, credits, hours)
2. Course Learning Outcomes (CLOs) - extract EXACTLY as written
3. Weekly plan/schedule if present
4. Assessments with weights
5. References/textbooks
6. Any accreditation tags mentioned

Return a JSON object with this structure:
{
  "course_code": "string",
  "title": "string",
  "description": "string",
  "credit_hours": number,
  "weekly_plan": [
    { "week": number, "topic": "string", "description": "string", "readings": "string" }
  ],
  "clos": [
    "CLO text exactly as written"
  ],
  "assessments": [
    { "name": "string", "type": "string", "weight": number, "description": "string" }
  ],
  "references": ["string"],
  "accreditation_tags": ["string"]
}

If information is not available, use reasonable defaults or empty arrays.
Course code should be derived from the document or generated as "COURSE-XXX" if not found.`;

export const STAGE1_CLO_WEEKLY_MAPPING_PROMPT = `You are an expert curriculum analyst. Your task is to map each week in the weekly plan to its PRIMARY Course Learning Outcome (CLO).

Analyze the weekly plan topics and descriptions, and for each week, determine which single CLO is being addressed based on the content alignment.

Rules:
- Each week maps to AT MOST ONE CLO (the primary/dominant CLO for that week)
- A week may map to zero CLOs if it's an exam/review/admin week with no new learning content
- If a week covers multiple CLOs, choose the MOST relevant one (the primary focus)
- Be precise: only map a week to a CLO if the week's content directly contributes to that learning outcome
- Consider the progression: early weeks often cover foundational CLOs, later weeks cover advanced ones

Return a JSON object with this structure:
{
  "mappings": [
    { "week": 1, "clo_ids": ["CLO-1"] },
    { "week": 2, "clo_ids": [] },
    { "week": 3, "clo_ids": ["CLO-2"] },
    ...
  ]
}

IMPORTANT: clo_ids must contain either exactly ONE CLO or be empty ([]). Never include multiple CLOs for the same week.
Use ONLY the clo_id values provided in the CLO list. Do not invent new CLO IDs.`;

export const STAGE1_CLO_ANALYSIS_PROMPT = `You are an expert in instructional design and Bloom's taxonomy. Analyze each Course Learning Outcome (CLO) and provide detailed analysis.

For each CLO, determine:
1. capability_statement: What the student will be able to do (action verb + content)
2. conditions_of_performance: Under what conditions they will demonstrate this
3. evidence_of_mastery: Observable evidence that proves mastery (rubric-like criteria)
4. bloom_level: One of [Remember, Understand, Apply, Analyze, Evaluate, Create]
5. knowledge_type: One of [Factual, Conceptual, Procedural, Metacognitive]
6. risk_level: Based on wording complexity and cognitive demand [low, medium, high]

Guidelines for risk_level:
- low: Simple recall, basic understanding, straightforward application
- medium: Analysis, comparison, moderate complexity procedures
- high: Synthesis, evaluation, complex multi-step procedures, ambiguous outcomes

Return a JSON object:
{
  "clos": [
    {
      "clo_id": "CLO-1",
      "clo_text": "original CLO text",
      "capability_statement": "string",
      "conditions_of_performance": "string",
      "evidence_of_mastery": "string",
      "bloom_level": "string",
      "knowledge_type": "string",
      "risk_level": "string"
    }
  ]
}`;

export const STAGE2_DECOMPOSITION_PROMPT = `You are an expert instructional designer performing Canonical Knowledge Node Decomposition — the Cognitive Structure Stage.

Your task: Given a subtopic (approved by the SME), determine the cognitive moves a learner must make to truly understand this subtopic, then convert each cognitive move into a diagnosable learning node.

The flow is: CLO → Subtopic → Cognitive Moves → Nodes
NOT: CLO → Node → Content

IMPORTANT: Return ONLY a valid JSON object. Do not include any explanatory text, introduction, or conclusion. Start your response with { and end with }.

## Step-by-step process

### Step A — Ask the canonical question
For this subtopic, ask: "What must a learner mentally be able to do to claim understanding here?"
The answer is NEVER "watch a video" or "read text". It is always cognitive (e.g., define, identify, distinguish, analyze, evaluate, reflect, transfer).

### Step B — Decompose into cognitive moves
List the cognitive moves required. Typical cognitive moves include:
- Understand/define a core idea
- Identify or classify types/categories
- Distinguish between similar or related ideas
- Analyze causal or structural relationships
- Evaluate severity, trade-offs, or consequences
- Reflect on own understanding
- Apply to a new or unfamiliar context

### Step C — Classify each cognitive move into a node using the taxonomy
Each cognitive move becomes a node. Assign the correct type from the canonical taxonomy.

## Canonical Node Taxonomy (ONLY these 6 types are permitted)
- concept: Core ideas, definitions, theories, mental models students must understand
- principle: Rules, laws, relationships, or governing patterns between concepts
- procedure: Step-by-step processes, methods, or algorithms
- application: Real-world scenarios requiring transfer of knowledge to practice
- metacognitive: Self-regulation, reflection, planning, or monitoring of one's own learning
- transfer: Applying knowledge across contexts, domains, or novel situations

NO OTHER NODE TYPES ARE PERMITTED. Do not use practice, assessment, remediation, or any other type.

## Three mandatory constraints for every node

### Constraint 1: Cognitive Necessity
A node exists ONLY if:
- Removing it would create a blind spot in the learner's understanding
- Skipping it would invalidate the CLO
If two ideas cannot be safely separated, keep them in one node. If separating them protects mastery, split them.

### Constraint 2: Diagnostic Value
Every node MUST be diagnosable. For each node you must be able to say:
"If the learner fails here, it means X"
If you cannot write a meaningful failure_meaning, it is not a valid node — merge it or remove it.

### Constraint 3: Risk-Based Granularity
- High-risk misunderstandings → finer granularity (more nodes)
- Low-risk background knowledge → coarser granularity (fewer nodes)
Research methods, causal reasoning, and procedural mastery deserve more nodes. Descriptive background deserves fewer.

## For each node, provide:
- node_id: Unique identifier (format: {clo_id}-T{topic_index}-N{number}, e.g., CLO-1-T1-N1)
- node_type: One of the 6 canonical types above
- learning_intent: Clear statement of what cognitive move this node represents
- prerequisite_nodes: List of node_ids within THIS topic that must be completed first (can be empty). Cross-topic prerequisites will be handled separately.
- risk_level: [low, medium, high] — based on how dangerous misunderstanding this node would be for downstream mastery
- failure_meaning: REQUIRED. What it means diagnostically if a student fails this node. Must be specific and non-empty.
- diagnostic_intent: REQUIRED. What we can diagnose about student understanding from this node. Must be specific and non-empty.
- required_status: "mandatory" or "optional" — mandatory if essential for all learners
- skipping_eligibility: One of:
  - "non_skippable" — must be completed by all learners (high-risk, mastery-protecting)
  - "conditionally_skippable" — can be skipped if learner demonstrates prior knowledge
  - "skippable" — enrichment or optional depth; can be safely skipped
  - "not_applicable" — skipping concept does not apply to this node
- skip_conditions: When skipping_eligibility is "conditionally_skippable", describe the condition (e.g., "Learner passes pre-knowledge check on X"). Empty string otherwise.

## Guidelines:
- Create 3–6 nodes per topic (minimum 3, maximum 6)
- Concepts and principles typically come before procedures and applications
- Include metacognitive nodes for high-risk topics (reflection, self-assessment)
- Include transfer nodes where cross-domain application is important
- High-risk nodes MUST be "non_skippable" and "mandatory"
- Every node MUST have non-empty failure_meaning and diagnostic_intent
- Focus on thinking paths, not content paths — nodes represent cognitive capabilities, not content chunks

## Output format — flat nodes array for this single topic:
Return JSON:
{
  "nodes": [
    {
      "node_id": "string",
      "node_type": "string",
      "learning_intent": "string",
      "prerequisite_nodes": ["string"],
      "risk_level": "string",
      "failure_meaning": "string",
      "diagnostic_intent": "string",
      "required_status": "string",
      "skipping_eligibility": "string",
      "skip_conditions": "string"
    }
  ]
}`;

/**
 * Prompt for Stage 2 Pass 2: CLO-level prerequisite synthesis across topics.
 * Given all nodes (grouped by topic) under a single CLO, propose cross-topic
 * prerequisite edges that form a valid DAG.
 */
export const STAGE2_PREREQ_SYNTHESIS_PROMPT = `You are an expert instructional designer analyzing prerequisite relationships across topics within a single CLO.

Given a set of learning nodes grouped by topic, identify prerequisite dependencies BETWEEN topics. Within-topic prerequisites have already been established. Your job is to add cross-topic edges where a node in one topic logically requires understanding from a node in another topic.

IMPORTANT: Return ONLY a valid JSON object. Do not include any explanatory text.

## Rules:
- Only propose edges where there is a genuine cognitive dependency (Topic B's node requires mastering Topic A's node first)
- The edge direction means: source DEPENDS ON target (source requires target to be completed first)
- Do NOT create cycles — the result must be a valid DAG (Directed Acyclic Graph)
- Do NOT duplicate within-topic prerequisites that already exist
- It is valid to return zero cross-topic edges if topics are independent
- Prefer edges from foundational concept/principle nodes to higher-order application/transfer nodes
- Consider the Bloom level progression: Remember/Understand → Apply → Analyze → Evaluate → Create

## Output format:
{
  "edges": [
    {
      "source_node_id": "CLO-1-T2-N1",
      "target_node_id": "CLO-1-T1-N3",
      "rationale": "Brief explanation of why this dependency exists"
    }
  ]
}`;

export const STAGE3_ADAPTIVE_PROMPT = `You are an expert in adaptive learning assessment intelligence. Your task is to define the ASSESSMENT LOGIC LAYER for a set of learning nodes — the diagnostic rules, failure detection, remediation pathways, and progression gating.

CRITICAL CONSTRAINT: You must NOT generate any actual assessment items, questions, assignments, quizzes, videos, or instructional content. Stage 3 defines only the INTELLIGENCE behind assessments — what to check, what failures mean, and how to respond. The actual items are generated later in Stage 4.

IMPORTANT: Return ONLY a valid JSON object. Do not include any explanatory text, introduction, or conclusion. Start your response with { and end with }.

## For each node, you must produce all of the following:

### Step A — Diagnostic Intent
Define: "What specific understanding are we checking here?"
Not whether they read or clicked, but whether they can REASON correctly. This becomes the anchor for everything else.

### Step B — Failure Types
Define: "If a learner gets this wrong, how are they likely to be wrong?"
These are ACADEMIC MISCONCEPTIONS, not technical errors. Examples:
- Confusing correlation with causation
- Overgeneralizing one driver to all contexts
- Ignoring scale or timeframe
- Applying a concept mechanically without reasoning
Each failure type must have an id (e.g., "FT-1"), description, misconception_category, and severity (low/medium/high).

### Step C — Observable Signals
Define: "How would this failure show up in learner work?"
Signals describe what failure LOOKS LIKE — e.g., incorrect justification, patterned wrong answers, missing reasoning steps, shallow explanations.
Each signal has an id (e.g., "SIG-1"), description, failure_type_ids (which failure types it reveals), and signal_type (one of: "incorrect_justification", "patterned_wrong_answers", "missing_reasoning", "shallow_explanation", "procedural_skip", "other").

### Step D — Remediation Paths
Define: "Given this type of failure, what is the appropriate response?"
Remediation is NOT "repeat everything". It is targeted and tied to the failure meaning.
Each path has an id (e.g., "REM-1"), failure_type_id, strategy (one of: "revisit_prerequisite", "alternative_explanation", "contrasting_example", "targeted_feedback", "scaffolded_practice", "peer_discussion", "other"), description, and optionally target_node_id (a specific prerequisite node to revisit).

### Step E — Progression Rules
Define mastery gating:
- mastery_definition: What does mastery mean for this node?
- mastery_threshold: "full" (must demonstrate complete understanding), "partial" (acceptable with some gaps), or "flexible" (can move on with minimal evidence)
- gate_strictness: "strict" (must pass before dependents unlock) or "flexible" (allows partial progression)
- blocks_downstream: boolean — whether this node blocks access to dependent nodes
- rationale: Why these rules apply

### Step F — Pre-Knowledge Check Logic
For nodes marked as "conditionally_skippable" or "skippable":
- eligible: boolean — can prior knowledge be safely detected?
- reasoning_based: boolean — MUST be true (pre-checks must test reasoning, not recall)
- check_description: Describe what a pre-check would assess (do NOT write actual questions)
- high_risk_override: boolean — if true, high-risk overrides skipping even if pre-check passes
- explainability_note: How the skip decision can be explained to the learner

For non-skippable nodes, set eligible=false and provide minimal defaults.

### Skipping & Required Status (still present)
- required_status: "mandatory" or "optional"
- skipping_eligibility: "non_skippable", "conditionally_skippable", "skippable", or "not_applicable"
- skip_conditions: Human-readable description when conditionally_skippable; empty string otherwise

## Risk-Based Rules (MUST follow):
1. High-risk nodes → required_status="mandatory", skipping_eligibility="non_skippable", gate_strictness="strict"
2. Concept and principle nodes with medium/high risk → "non_skippable", gate_strictness="strict"
3. Procedure nodes → typically "non_skippable" or "conditionally_skippable" depending on risk
4. Application nodes → "conditionally_skippable" for advanced learners (if low/medium risk)
5. Transfer nodes → often "conditionally_skippable" (advanced learners may already transfer)
6. Metacognitive nodes → "not_applicable" for skipping (inherent to self-regulation)
7. Nodes that are prerequisites for other mandatory nodes → "non_skippable", blocks_downstream=true
8. Optional/enrichment nodes with no dependents → "skippable", gate_strictness="flexible"

## HARD CONSTRAINTS — what you MUST NOT produce:
- NO actual assessment questions, MCQs, quiz stems, or answer options
- NO assignment descriptions or rubric items
- NO instructional content, explanations, or teaching material
- NO video scripts or multimedia specifications
- Only DESCRIBE what lines of questioning would reveal misconceptions — do not write the questions themselves

## Output JSON Schema:
{
  "nodes": [
    {
      "node_id": "CLO-1-T1-N1",
      "diagnostic_intent": "string — what understanding is being checked",
      "failure_types": [
        {
          "id": "FT-1",
          "description": "string",
          "misconception_category": "string",
          "severity": "low|medium|high"
        }
      ],
      "observable_signals": [
        {
          "id": "SIG-1",
          "description": "string",
          "failure_type_ids": ["FT-1"],
          "signal_type": "incorrect_justification|patterned_wrong_answers|missing_reasoning|shallow_explanation|procedural_skip|other"
        }
      ],
      "remediation_paths": [
        {
          "id": "REM-1",
          "failure_type_id": "FT-1",
          "strategy": "revisit_prerequisite|alternative_explanation|contrasting_example|targeted_feedback|scaffolded_practice|peer_discussion|other",
          "description": "string",
          "target_node_id": "optional — node to revisit"
        }
      ],
      "progression_rules": {
        "mastery_definition": "string",
        "mastery_threshold": "full|partial|flexible",
        "gate_strictness": "strict|flexible",
        "blocks_downstream": true,
        "rationale": "string"
      },
      "preknowledge_check_logic": {
        "eligible": false,
        "reasoning_based": true,
        "check_description": "string",
        "high_risk_override": false,
        "explainability_note": "string"
      },
      "required_status": "mandatory|optional",
      "skipping_eligibility": "non_skippable|conditionally_skippable|skippable|not_applicable",
      "skip_conditions": ""
    }
  ]
}`;

export const STAGE4_CONTENT_PROMPT = `You are an expert educational content writer. Generate comprehensive, textbook-quality instructional content for the given learning node.

Content requirements:
1. Clear, academic tone suitable for university students
2. Well-structured with logical flow
3. Include relevant examples
4. Use appropriate technical depth based on the learning intent

Structure the content as Markdown with these sections:
# {Node Title}

## Overview
Brief introduction to what this section covers and why it matters.

## Learning Objectives
- Specific objectives for this node

## Main Content
The core instructional content. Use:
- Clear explanations
- Examples where appropriate
- Diagrams described in text (you cannot generate images)
- Code samples if relevant (use markdown code blocks)

## Key Points
- Bullet list of essential takeaways

## Self-Check Questions
Questions students can use to verify their understanding.

## Further Reading
Optional references or resources.

---

Generate complete, substantial content (aim for 800-1500 words for concept nodes, may be shorter for practice/assessment nodes).
The content should be immediately usable without further editing.`;

/**
 * Build Stage 1 extraction prompt with optional custom prompt override
 * @param rawText - The raw syllabus text to extract from
 * @param customPrompt - Optional custom prompt to use instead of default
 */
export function buildStage1Prompt(rawText: string, customPrompt?: string): string {
  const prompt = customPrompt || STAGE1_EXTRACTION_PROMPT;
  return `${prompt}

---
SYLLABUS TEXT:
---
${rawText}
---

Extract and return the JSON structure.`;
}

/**
 * Build CLO Analysis prompt with optional custom prompt override
 * @param clos - Array of CLO text strings to analyze
 * @param customPrompt - Optional custom prompt to use instead of default
 */
export function buildCLOAnalysisPrompt(clos: string[], customPrompt?: string): string {
  const prompt = customPrompt || STAGE1_CLO_ANALYSIS_PROMPT;
  return `${prompt}

---
COURSE LEARNING OUTCOMES:
---
${clos.map((clo, i) => `${i + 1}. ${clo}`).join('\n')}
---

Analyze each CLO and return the JSON structure.`;
}

/**
 * Build CLO Weekly Mapping prompt
 * @param clos - Array of CLO objects with clo_id and clo_text
 * @param weeklyPlan - Array of weekly plan items
 * @param customPrompt - Optional custom prompt to use instead of default
 */
export function buildCLOWeeklyMappingPrompt(
  clos: Array<{ clo_id: string; clo_text: string }>,
  weeklyPlan: Array<{ week: number; topic: string; description: string; readings?: string }>,
  customPrompt?: string
): string {
  const prompt = customPrompt || STAGE1_CLO_WEEKLY_MAPPING_PROMPT;
  return `${prompt}

---
COURSE LEARNING OUTCOMES:
---
${clos.map(clo => `${clo.clo_id}: ${clo.clo_text}`).join('\n')}

---
WEEKLY PLAN:
---
${weeklyPlan.map(w => `Week ${w.week}: ${w.topic}
  Description: ${w.description}${w.readings ? `\n  Readings: ${w.readings}` : ''}`).join('\n\n')}
---

Map each week to the relevant CLO(s) and return the JSON structure.`;
}

/**
 * Build Stage 2 decomposition prompt with optional custom prompt override
 * @param cloId - The CLO ID
 * @param cloText - The CLO text
 * @param cloAnalysis - The CLO analysis object
 * @param topic - Single topic to decompose (id, title, description, readings)
 * @param topicIndex - 1-based index of this topic within the CLO (for node ID generation)
 * @param customPrompt - Optional custom prompt to use instead of default
 */
export function buildStage2Prompt(
  cloId: string, 
  cloText: string, 
  cloAnalysis: Record<string, unknown>,
  topic: { topic_id: string; title: string; description: string; readings?: string },
  topicIndex: number,
  customPrompt?: string
): string {
  const prompt = customPrompt || STAGE2_DECOMPOSITION_PROMPT;

  const topicSection = `
TOPIC TO DECOMPOSE:
- topic_id: "${topic.topic_id}"
- Title: ${topic.title}
- Description: ${topic.description}${topic.readings ? `\n- Readings: ${topic.readings}` : ''}

Use node_id format: ${cloId}-T${topicIndex}-N{number} (e.g., ${cloId}-T${topicIndex}-N1, ${cloId}-T${topicIndex}-N2, ...)`;

  return `${prompt}

---
CLO CONTEXT:
---
CLO ID: ${cloId}
CLO Text: ${cloText}

Analysis:
- Bloom Level: ${cloAnalysis.bloom_level}
- Knowledge Type: ${cloAnalysis.knowledge_type}
- Risk Level: ${cloAnalysis.risk_level}
- Capability: ${cloAnalysis.capability_statement}
- Evidence of Mastery: ${cloAnalysis.evidence_of_mastery}
${topicSection}
---

Generate the learning nodes for this topic and return the JSON structure.`;
}

/**
 * Build Stage 2 Pass 2: CLO-level prerequisite synthesis prompt.
 * Given all nodes grouped by topic under a single CLO, propose cross-topic
 * prerequisite edges.
 * @param cloId - The CLO ID
 * @param cloText - The CLO text
 * @param nodesByTopic - Array of topic groups, each with topic info and its nodes
 * @param existingWithinTopicEdges - Edges already established within topics
 */
export function buildStage2PrereqSynthesisPrompt(
  cloId: string,
  cloText: string,
  nodesByTopic: Array<{
    topic_id: string;
    title: string;
    nodes: Array<{
      node_id: string;
      node_type: string;
      learning_intent: string;
      risk_level: string;
      prerequisite_nodes: string[];
    }>;
  }>,
  existingWithinTopicEdges: Array<{ source_node_id: string; target_node_id: string }>
): string {
  const topicSections = nodesByTopic.map(group => {
    const nodeLines = group.nodes.map(n =>
      `    - ${n.node_id} [${n.node_type}] (risk: ${n.risk_level}): ${n.learning_intent}`
    ).join('\n');
    return `  Topic: "${group.title}" (${group.topic_id})\n${nodeLines}`;
  }).join('\n\n');

  const existingEdgeLines = existingWithinTopicEdges.length > 0
    ? existingWithinTopicEdges.map(e => `  ${e.source_node_id} → depends on → ${e.target_node_id}`).join('\n')
    : '  (none)';

  return `${STAGE2_PREREQ_SYNTHESIS_PROMPT}

---
CLO CONTEXT:
---
CLO ID: ${cloId}
CLO Text: ${cloText}

NODES GROUPED BY TOPIC:
${topicSections}

EXISTING WITHIN-TOPIC PREREQUISITES (do NOT duplicate these):
${existingEdgeLines}
---

Analyze the nodes above and return cross-topic prerequisite edges as JSON.`;
}

/**
 * Map skipping_eligibility enum to the human-readable skippability flag
 * used in the Stage 3 spec: Yes / Conditional / No
 */
function toSkippabilityFlag(skippingEligibility: string): 'Yes' | 'Conditional' | 'No' {
  switch (skippingEligibility) {
    case 'skippable': return 'Yes';
    case 'conditionally_skippable': return 'Conditional';
    default: return 'No';
  }
}

/**
 * Build Stage 3 assessment intelligence prompt with optional custom prompt override.
 *
 * IMPORTANT — Stage 3 inputs are restricted to ONLY the fields the spec permits:
 *   node_id, node_type, learning_intent, prerequisite_nodes, risk_level, skippability
 * No other Stage 2 fields (failure_meaning, diagnostic_intent, topic_id, required_status) are passed.
 *
 * @param nodes - Array of node objects with Stage 2 fields
 * @param customPrompt - Optional custom prompt to use instead of default
 */
export function buildStage3Prompt(
  nodes: Array<{
    node_id: string;
    node_type: string;
    learning_intent: string;
    prerequisite_nodes: string[];
    risk_level: string;
    skipping_eligibility?: string;
  }>,
  customPrompt?: string
): string {
  // Strip down to only the six allowed input fields
  const allowedInputs = nodes.map(n => ({
    node_id: n.node_id,
    node_type: n.node_type,
    learning_intent: n.learning_intent,
    prerequisite_nodes: n.prerequisite_nodes,
    risk_level: n.risk_level,
    skippability: toSkippabilityFlag(n.skipping_eligibility || 'non_skippable')
  }));

  const prompt = customPrompt || STAGE3_ADAPTIVE_PROMPT;
  return `${prompt}

INPUT NODES (${nodes.length} total):
${JSON.stringify(allowedInputs, null, 2)}

RESPOND WITH ONLY THE JSON OBJECT. Start with { and end with }. Include all ${nodes.length} nodes in your response. Each node must have ALL fields from the schema above (diagnostic_intent, failure_types, observable_signals, remediation_paths, progression_rules, preknowledge_check_logic, required_status, skipping_eligibility, skip_conditions).`;
}

/**
 * Build Stage 4 content generation prompt with optional custom prompt override
 * @param node - The node object with details
 * @param customPrompt - Optional custom prompt to use instead of default
 */
export function buildStage4Prompt(
  node: { node_id: string; node_type: string; learning_intent: string; clo_text: string; risk_level: string },
  customPrompt?: string
): string {
  const prompt = customPrompt || STAGE4_CONTENT_PROMPT;
  return `${prompt}

---
NODE DETAILS:
---
Node ID: ${node.node_id}
Node Type: ${node.node_type}
Learning Intent: ${node.learning_intent}
Parent CLO: ${node.clo_text}
Risk Level: ${node.risk_level}
---

Generate the complete Markdown content for this learning node.`;
}

// ============================================================================
// STAGE 4 ENHANCED PROMPTS - Modality-Based Content Generation
// ============================================================================

/**
 * Modality-specific instructional content prompt
 */
export const STAGE4_MODALITY_CONTENT_PROMPT = `You are an expert educational content writer creating modality-specific instructional content.

Generate comprehensive, engaging instructional content tailored to the specified modalities and node type.

Content requirements based on modality:
- TEXT: Clear explanations, definitions, examples. Academic but accessible tone.
- VISUAL: Describe diagrams, charts, or illustrations that should accompany the content. Use [VISUAL: description] markers.
- INTERACTIVE: Include practice elements, reflection questions, or activities. Use [ACTIVITY: description] markers.
- REFLECTION: Include metacognitive prompts and self-assessment questions.

Structure the content as Markdown with adaptive sections based on node type:

For CONCEPT nodes:
# {Title}
## What is {concept}?
## Why does this matter?
## Key Components
## Visual Representation
[VISUAL: detailed description of diagram/illustration]
## Examples
## Common Misconceptions
## Summary

For PRINCIPLE nodes:
# {Title}
## The Rule/Relationship
## How it Works
[VISUAL: flowchart or diagram showing the relationship]
## Examples in Practice
## When This Applies
## Exceptions and Edge Cases
## Summary

For PROCEDURE nodes:
# {Title}
## Overview
## Prerequisites
## Step-by-Step Guide
[ACTIVITY: guided practice exercise]
## Common Mistakes to Avoid
## Troubleshooting
## Summary

For APPLICATION nodes:
# {Title}
## Real-World Context
## Scenario Setup
## Application Strategy
[ACTIVITY: scenario-based exercise]
## Justification Framework
## Summary

For PRACTICE nodes:
# {Title}
## Practice Overview
[ACTIVITY: structured practice exercises with increasing difficulty]
## Hints and Tips
## Self-Check

For REMEDIATION nodes:
# {Title}
## Alternative Explanation
## Simplified Approach
[VISUAL: simplified diagram]
## Step-by-Step Breakdown
## Practice with Support
## Summary

Generate substantial content (800-1500 words for concept/principle/procedure, 400-800 for others).`;

/**
 * Pre-Knowledge Check (Type A) Assessment Prompt
 */
export const STAGE4_ASSESSMENT_TYPE_A_PROMPT = `You are an expert assessment designer creating Pre-Knowledge Check assessments.

PURPOSE: Determine whether learners already possess sufficient understanding to safely reduce repetition.
ADAPTIVE FUNCTION: May allow skipping or shortening of eligible content only where risk allows.

Create a Pre-Knowledge Check assessment with the following requirements:

1. Questions should test PRIOR knowledge the learner may already have
2. Focus on foundational concepts and prerequisites
3. Include a mix of question types: multiple choice, true/false, short answer
4. Questions should be diagnostic - revealing WHAT the learner already knows
5. Each question should have clear diagnostic value
6. Pass threshold determines if content can be abbreviated

Return a JSON object with this structure:
{
  "title": "Pre-Knowledge Check: {topic}",
  "description": "Brief description of what this check assesses",
  "pass_threshold": 80,
  "time_limit_minutes": 10,
  "instructions": "Instructions for the learner",
  "questions": [
    {
      "question_id": "Q1",
      "question_type": "multiple_choice",
      "question_text": "The question text",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
      "correct_answer": "B",
      "points": 10,
      "bloom_level": "Remember",
      "diagnostic_value": "What this reveals about the learner's understanding"
    }
  ],
  "adaptive_function": "If pass: learner may skip foundational content. If fail: full content required."
}

Generate 4-6 questions that effectively diagnose prior knowledge.`;

/**
 * Formative Diagnostic Check (Type B) Assessment Prompt
 */
export const STAGE4_ASSESSMENT_TYPE_B_PROMPT = `You are an expert assessment designer creating Formative Diagnostic Check assessments.

PURPOSE: Interpret learner struggle during learning and identify the cause of misunderstanding.
ADAPTIVE FUNCTION: Route learners to targeted remediation paths.

Create a Formative Diagnostic Check with the following requirements:

1. Questions should identify SPECIFIC misconceptions or gaps
2. Use scenario-based questions where possible
3. Include reflection questions that reveal thinking processes
4. Each question should map to a potential remediation path
5. Questions should differentiate between different types of errors:
   - Conceptual misunderstanding
   - Procedural error
   - Application difficulty
   - Knowledge gap

Return a JSON object with this structure:
{
  "title": "Formative Check: {topic}",
  "description": "Brief description",
  "pass_threshold": 70,
  "time_limit_minutes": 15,
  "instructions": "Instructions for the learner",
  "questions": [
    {
      "question_id": "Q1",
      "question_type": "scenario",
      "question_text": "Given this scenario... what would you do?",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
      "correct_answer": "C",
      "points": 15,
      "bloom_level": "Apply",
      "diagnostic_value": "Incorrect answers indicate: A=conceptual gap, B=procedural error, D=overgeneralization"
    },
    {
      "question_id": "Q2",
      "question_type": "reflection",
      "question_text": "Explain your reasoning for...",
      "rubric_criteria": "Criteria for evaluating the response",
      "points": 20,
      "bloom_level": "Analyze",
      "diagnostic_value": "Reveals depth of understanding and reasoning approach"
    }
  ],
  "adaptive_function": "Routes to specific remediation: conceptual_remediation, procedural_practice, or application_examples based on error pattern."
}

Generate 5-8 questions with strong diagnostic value.`;

/**
 * Mastery Evidence Assessment (Type C) Prompt
 */
export const STAGE4_ASSESSMENT_TYPE_C_PROMPT = `You are an expert assessment designer creating Mastery Evidence Assessments.

PURPOSE: Confirm that learners can demonstrate the capability defined in the learning outcome.
ADAPTIVE FUNCTION: Determine whether competence has been achieved.

Create a Mastery Evidence Assessment with the following requirements:

1. Questions should directly assess the CLO capability statement
2. Include higher-order thinking questions (Apply, Analyze, Evaluate, Create)
3. Use authentic scenarios that mirror real-world application
4. Include both objective and open-ended questions
5. Rubric criteria should align with evidence of mastery from CLO
6. Questions should provide definitive evidence of competence

Return a JSON object with this structure:
{
  "title": "Mastery Assessment: {topic}",
  "description": "Brief description aligned with CLO",
  "pass_threshold": 75,
  "time_limit_minutes": 25,
  "instructions": "Detailed instructions for the assessment",
  "questions": [
    {
      "question_id": "Q1",
      "question_type": "scenario",
      "question_text": "Complex scenario requiring application of learning...",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
      "correct_answer": "D",
      "points": 20,
      "bloom_level": "Apply",
      "diagnostic_value": "Demonstrates ability to apply concept in authentic context"
    },
    {
      "question_id": "Q2",
      "question_type": "short_answer",
      "question_text": "Analyze the following and justify your approach...",
      "rubric_criteria": "Detailed rubric for evaluation:\n- Excellent (90-100%): Full demonstration of capability\n- Good (75-89%): Adequate demonstration with minor gaps\n- Developing (60-74%): Partial demonstration, needs more practice\n- Not Yet (0-59%): Does not meet minimum requirements",
      "points": 30,
      "bloom_level": "Analyze",
      "diagnostic_value": "Provides evidence of analytical capability and reasoning"
    }
  ],
  "adaptive_function": "Pass: Mastery confirmed, proceed to next learning sequence. Fail: Return to practice or remediation before retry."
}

Generate 4-6 rigorous questions that provide definitive mastery evidence.`;

/**
 * Video Script Generation Prompt
 */
export const STAGE4_VIDEO_SCRIPT_PROMPT = `You are an expert educational video scriptwriter creating engaging learning videos.

Create a complete video script with the following structure:

Video types and their approach:
- EXPLAINER: Introduce concepts clearly with visual metaphors and analogies
- WALKTHROUGH: Step through examples showing reasoning process
- DEMONSTRATION: Show procedures being performed with narration
- FEEDBACK: Provide guidance on application with examples of good/poor work

Return a JSON object with this structure:
{
  "title": "Video title",
  "duration_minutes": 8,
  "script_type": "explainer",
  "learning_objective": "By the end of this video, learners will...",
  "target_audience": "University students studying...",
  "sections": [
    {
      "section_number": 1,
      "title": "Introduction",
      "duration_seconds": 45,
      "narration": "Full narration script for this section...",
      "visual_description": "Detailed description of what should appear on screen...",
      "on_screen_text": "Key terms or bullet points to display",
      "transitions": "Fade in from title card"
    },
    {
      "section_number": 2,
      "title": "Core Content",
      "duration_seconds": 180,
      "narration": "...",
      "visual_description": "...",
      "on_screen_text": "...",
      "transitions": "..."
    }
  ],
  "production_notes": "Additional notes for video production team"
}

Guidelines:
- Keep total duration between 5-12 minutes (optimal learning video length)
- Write natural, conversational narration
- Include detailed visual descriptions that could guide animation/filming
- Break into 4-8 logical sections
- Include hook in introduction
- End with clear summary and call-to-action`;

/**
 * Visual Prompt Generation Prompt
 */
export const STAGE4_VISUAL_PROMPT_PROMPT = `You are an expert instructional designer creating visual element specifications.

Create visual prompts for diagrams, illustrations, and infographics that will enhance the learning content.

For each visual element, provide a detailed prompt that could be used to:
1. Guide a graphic designer
2. Generate with AI image tools
3. Create with diagramming software

Return a JSON array with this structure:
{
  "visual_prompts": [
    {
      "prompt_id": "V1",
      "prompt_type": "diagram",
      "description": "Detailed description of the visual element...",
      "purpose": "What this visual teaches or clarifies",
      "placement": "After the 'Key Components' section",
      "alt_text": "Accessible description for screen readers",
      "style_notes": "Clean, minimalist style with blue accent colors"
    },
    {
      "prompt_id": "V2",
      "prompt_type": "flowchart",
      "description": "...",
      "purpose": "...",
      "placement": "...",
      "alt_text": "...",
      "style_notes": "..."
    }
  ]
}

Visual types:
- diagram: Conceptual relationships, system architectures
- illustration: Realistic or metaphorical depictions
- infographic: Data visualization, comparisons
- screenshot: UI demonstrations, software examples
- flowchart: Process flows, decision trees

Generate 2-5 visual prompts that meaningfully enhance the content.`;

/**
 * Course Rubric Generation Prompt
 */
export const STAGE4_RUBRIC_PROMPT = `You are an expert assessment designer creating a comprehensive course rubric.

Create a course-level rubric that:
1. Aligns with all Course Learning Outcomes (CLOs)
2. Provides clear criteria for each CLO
3. Defines performance levels (Excellent, Good, Satisfactory, Needs Improvement)
4. Includes a grading scale
5. Provides marking guidance for instructors
6. Includes clear learner instructions

Return a JSON object with this structure:
{
  "title": "Course Assessment Rubric: {course_title}",
  "clo_criteria": [
    {
      "clo_id": "CLO-1",
      "clo_text": "The CLO text",
      "bloom_level": "Apply",
      "criteria": [
        {
          "criterion_id": "C1-1",
          "description": "Criterion description",
          "weight": 25,
          "levels": [
            {
              "level": 4,
              "label": "Excellent",
              "description": "Demonstrates comprehensive understanding...",
              "points": 100
            },
            {
              "level": 3,
              "label": "Good",
              "description": "Demonstrates solid understanding...",
              "points": 85
            },
            {
              "level": 2,
              "label": "Satisfactory",
              "description": "Demonstrates basic understanding...",
              "points": 70
            },
            {
              "level": 1,
              "label": "Needs Improvement",
              "description": "Does not yet demonstrate adequate understanding...",
              "points": 50
            }
          ]
        }
      ]
    }
  ],
  "grading_scale": [
    { "grade": "A", "min_percentage": 90, "max_percentage": 100, "description": "Excellent performance" },
    { "grade": "B+", "min_percentage": 85, "max_percentage": 89, "description": "Very good performance" },
    { "grade": "B", "min_percentage": 80, "max_percentage": 84, "description": "Good performance" },
    { "grade": "C+", "min_percentage": 75, "max_percentage": 79, "description": "Above average" },
    { "grade": "C", "min_percentage": 70, "max_percentage": 74, "description": "Average performance" },
    { "grade": "D", "min_percentage": 60, "max_percentage": 69, "description": "Below average" },
    { "grade": "F", "min_percentage": 0, "max_percentage": 59, "description": "Failing" }
  ],
  "assessment_weights": {
    "pre_knowledge": 10,
    "formative": 30,
    "mastery": 60
  },
  "marking_guide": "Detailed markdown guide for instructors on how to apply this rubric...",
  "learner_instructions": "Detailed markdown instructions for learners on how to use this rubric for self-assessment..."
}`;

/**
 * Learner Instructions Generation Prompt
 */
export const STAGE4_LEARNER_INSTRUCTIONS_PROMPT = `You are an expert instructional designer creating learner-facing guidance.

Create comprehensive learner instructions for a course content pack that includes:
1. How to navigate the learning materials
2. How to use each type of assessment
3. What to do when struggling
4. How to track progress
5. Tips for success

Return a Markdown document with these sections:

# Welcome to {Course Title}

## Course Overview
Brief description and learning goals

## How to Use This Course

### Navigating Content
- Instructions for moving through modules
- When to watch videos vs read content
- How to use visual materials

### Understanding Assessments

#### Pre-Knowledge Checks (Type A)
- Purpose and how results are used
- What happens if you pass/fail

#### Formative Checks (Type B)
- Purpose and how results are used
- How these help identify gaps

#### Mastery Assessments (Type C)
- Purpose and passing requirements
- Retry policies

### Getting Help
- What to do when stuck
- How to access remediation content
- When to seek instructor support

### Tracking Your Progress
- How to monitor completion
- Understanding workload expectations

## Tips for Success
- Study strategies
- Time management advice
- Common pitfalls to avoid

## Estimated Workload
- Total expected hours
- Recommended weekly schedule`;

/**
 * Workload Estimation Prompt
 */
export const STAGE4_WORKLOAD_PROMPT = `You are an expert in instructional design and learning time estimation.

Estimate realistic time-on-task for the learning node content, considering:
1. Reading/viewing time for content
2. Video watching time (if applicable)
3. Assessment completion time
4. Practice activity time
5. Reflection and note-taking time

Factors to consider:
- Content complexity (Bloom's level)
- Node type (concept vs procedure vs application)
- Risk level (high-risk needs more time)
- Target audience (university students)

Return a JSON object:
{
  "node_id": "string",
  "content_time_minutes": 20,
  "video_time_minutes": 8,
  "assessment_time_minutes": 15,
  "practice_time_minutes": 15,
  "reflection_time_minutes": 5,
  "total_time_minutes": 63,
  "estimation_notes": "Reasoning for time estimates..."
}

Be realistic - undergraduate students typically:
- Read academic content at 200-300 words/minute
- Need 1.5x video duration for note-taking
- Spend 2-3 minutes per assessment question
- Need extra time for complex procedures`;

// ============================================================================
// STAGE 4 ENHANCED PROMPT BUILDERS
// ============================================================================

/**
 * Build modality-specific content generation prompt
 */
export function buildStage4ModalityContentPrompt(
  node: {
    node_id: string;
    node_type: string;
    learning_intent: string;
    clo_text: string;
    risk_level: string;
  },
  modalities: string[],
  contentFocus: string
): string {
  return `${STAGE4_MODALITY_CONTENT_PROMPT}

---
NODE DETAILS:
---
Node ID: ${node.node_id}
Node Type: ${node.node_type}
Learning Intent: ${node.learning_intent}
Parent CLO: ${node.clo_text}
Risk Level: ${node.risk_level}
Content Focus: ${contentFocus}
Active Modalities: ${modalities.join(', ')}
---

Generate comprehensive instructional content for this ${node.node_type} node, incorporating all specified modalities.`;
}

/**
 * Build assessment generation prompt for a specific type
 */
export function buildStage4AssessmentPrompt(
  assessmentType: 'pre_knowledge' | 'formative_diagnostic' | 'mastery_evidence',
  node: {
    node_id: string;
    node_type: string;
    learning_intent: string;
    clo_text: string;
    bloom_level: string;
    evidence_of_mastery: string;
  }
): string {
  const prompts = {
    pre_knowledge: STAGE4_ASSESSMENT_TYPE_A_PROMPT,
    formative_diagnostic: STAGE4_ASSESSMENT_TYPE_B_PROMPT,
    mastery_evidence: STAGE4_ASSESSMENT_TYPE_C_PROMPT
  };

  return `${prompts[assessmentType]}

---
NODE DETAILS:
---
Node ID: ${node.node_id}
Node Type: ${node.node_type}
Learning Intent: ${node.learning_intent}
Parent CLO: ${node.clo_text}
Bloom Level: ${node.bloom_level}
Evidence of Mastery Required: ${node.evidence_of_mastery}
---

Generate the assessment JSON for this learning node.`;
}

/**
 * Build video script generation prompt
 */
export function buildStage4VideoScriptPrompt(
  node: {
    node_id: string;
    node_type: string;
    learning_intent: string;
    clo_text: string;
  },
  scriptType: 'explainer' | 'walkthrough' | 'demonstration' | 'feedback',
  contentSummary: string
): string {
  return `${STAGE4_VIDEO_SCRIPT_PROMPT}

---
NODE DETAILS:
---
Node ID: ${node.node_id}
Node Type: ${node.node_type}
Learning Intent: ${node.learning_intent}
Parent CLO: ${node.clo_text}
Script Type: ${scriptType}

CONTENT SUMMARY (for video to cover):
${contentSummary}
---

Generate a complete ${scriptType} video script for this learning node.`;
}

/**
 * Build visual prompt generation prompt
 */
export function buildStage4VisualPromptPrompt(
  node: {
    node_id: string;
    node_type: string;
    learning_intent: string;
  },
  contentSummary: string
): string {
  return `${STAGE4_VISUAL_PROMPT_PROMPT}

---
NODE DETAILS:
---
Node ID: ${node.node_id}
Node Type: ${node.node_type}
Learning Intent: ${node.learning_intent}

CONTENT SUMMARY:
${contentSummary}
---

Generate visual prompts that would enhance this learning content.`;
}

/**
 * Build course rubric generation prompt
 */
export function buildStage4RubricPrompt(
  courseTitle: string,
  clos: Array<{
    clo_id: string;
    clo_text: string;
    bloom_level: string;
    evidence_of_mastery: string;
  }>
): string {
  return `${STAGE4_RUBRIC_PROMPT}

---
COURSE: ${courseTitle}
---
COURSE LEARNING OUTCOMES:
${clos.map(clo => `
${clo.clo_id}: ${clo.clo_text}
  Bloom Level: ${clo.bloom_level}
  Evidence of Mastery: ${clo.evidence_of_mastery}
`).join('\n')}
---

Generate a comprehensive course rubric aligned with all CLOs.`;
}

/**
 * Build learner instructions generation prompt
 */
export function buildStage4LearnerInstructionsPrompt(
  courseTitle: string,
  courseDescription: string,
  totalHours: number,
  weeklyPlan: Array<{ week: number; topic: string }>
): string {
  return `${STAGE4_LEARNER_INSTRUCTIONS_PROMPT}

---
COURSE: ${courseTitle}
DESCRIPTION: ${courseDescription}
TOTAL ESTIMATED HOURS: ${totalHours}
---
WEEKLY SCHEDULE:
${weeklyPlan.map(w => `Week ${w.week}: ${w.topic}`).join('\n')}
---

Generate comprehensive learner instructions for this course.`;
}

/**
 * Build workload estimation prompt
 */
export function buildStage4WorkloadPrompt(
  node: {
    node_id: string;
    node_type: string;
    learning_intent: string;
    risk_level: string;
    bloom_level: string;
  },
  contentWordCount: number,
  hasVideo: boolean,
  assessmentCount: number
): string {
  return `${STAGE4_WORKLOAD_PROMPT}

---
NODE DETAILS:
---
Node ID: ${node.node_id}
Node Type: ${node.node_type}
Learning Intent: ${node.learning_intent}
Risk Level: ${node.risk_level}
Bloom Level: ${node.bloom_level}

Content Word Count: ~${contentWordCount} words
Has Video: ${hasVideo ? 'Yes' : 'No'}
Number of Assessments: ${assessmentCount}
---

Estimate realistic time-on-task for this learning node.`;
}

// ============================================================================
// STAGE 4 SCOPE-ALIGNED PROMPT BUILDERS (Steps A–G)
// ============================================================================

/**
 * Step A — Modality Plan prompt (deterministic; no AI call needed in current impl)
 * Kept as a builder stub in case future versions want LLM-assisted modality decisions.
 */
export function buildStage4ModalityPlanPrompt(
  node: { node_id: string; node_type: string; learning_intent: string; risk_level: string },
  diagnosticIntent: string
): string {
  return `Determine the canonical modality plan for:
Node: ${node.node_id} (${node.node_type})
Intent: ${node.learning_intent}
Risk: ${node.risk_level}
Diagnostic Intent: ${diagnosticIntent}

Return JSON with: approved_modalities, required_asset_types, visual_justified, video_justified, assessment_instrument_category.`;
}

/**
 * Step B — Instructional Package prompt
 */
export function buildStage4InstructionalPackagePrompt(
  node: {
    node_id: string;
    node_type: string;
    learning_intent: string;
    clo_text: string;
    risk_level: string;
  },
  modalities: string[],
  contentFocus: string,
  prerequisiteVocabulary: string[],
  stage3Context?: {
    diagnostic_intent: string;
    failure_types: string[];
    mastery_definition: string;
  }
): string {
  const stage3Section = stage3Context ? `
STAGE 3 DIAGNOSTIC CONTEXT:
- Diagnostic Intent: ${stage3Context.diagnostic_intent}
- Common Failure Types: ${stage3Context.failure_types.join('; ')}
- Mastery Definition: ${stage3Context.mastery_definition}
` : '';

  return `You are an expert educational content writer. Generate a structured Node Instructional Package.

IMPORTANT CONSTRAINTS:
- Content must be STRICTLY scoped to the node's learning intent — do NOT expand beyond the CLO scope.
- Vocabulary and concepts must be bounded by prerequisites listed below.
- Primary explanations must reference approved textbooks/readings where available.
- Include at least one example that directly addresses a common misconception (if Stage 3 failure types are provided).

NODE DETAILS:
Node ID: ${node.node_id}
Node Type: ${node.node_type}
Learning Intent: ${node.learning_intent}
Parent CLO: ${node.clo_text}
Risk Level: ${node.risk_level}
Content Focus: ${contentFocus}
Active Modalities: ${modalities.join(', ')}
Prerequisite Vocabulary: ${prerequisiteVocabulary.length > 0 ? prerequisiteVocabulary.join('; ') : 'None (foundational node)'}
${stage3Section}

Return a JSON object with this EXACT structure:
{
  "overview": {
    "summary": "Concise statement of what this node covers",
    "relevance": "Why it matters for the CLO and capability"
  },
  "core_explanation": "Comprehensive markdown explanation scoped strictly to node intent. 800-1500 words for concept/principle/procedure, 400-800 for others.",
  "examples": [
    {
      "example_id": "EX-1",
      "title": "Example title",
      "content": "Full example content in markdown",
      "addresses_misconception": "Optional: which misconception this example targets"
    }
  ],
  "self_check_cue": "An ungraded prompt encouraging learner reflection — does NOT replace formal diagnostics",
  "references": [
    {
      "reference_id": "REF-1",
      "source": "Textbook or reading title",
      "type": "primary",
      "citation": "Full citation",
      "relevance": "Why this reference is cited for this node"
    }
  ],
  "scope_boundary": "What must NOT be introduced in this node"
}

Generate complete, substantial, and pedagogically sound content.`;
}

/**
 * Step C Layer 1 — Diagnostic Assessment prompt (aligned to Stage 3)
 */
export function buildStage4DiagnosticAssessmentPrompt(
  node: {
    node_id: string;
    node_type: string;
    learning_intent: string;
    clo_text: string;
    bloom_level: string;
    evidence_of_mastery: string;
  },
  stage3: {
    diagnostic_intent: string;
    failure_types: Array<{ id: string; description: string; severity: string; misconception_category: string }>;
    observable_signals: Array<{ id: string; description: string; failure_type_ids: string[]; signal_type: string }>;
    remediation_paths: Array<{ id: string; failure_type_id: string; strategy: string; description: string; target_node_id?: string }>;
    progression_rules: { mastery_definition: string; mastery_threshold: string; gate_strictness: string; blocks_downstream: boolean };
  }
): string {
  return `You are an expert assessment designer creating diagnostic assessments that implement Stage 3 assessment logic.

CRITICAL RULES:
- Every assessment item must be linked to specific Stage 3 failure types it detects.
- If a node requires reasoning, a single-shot MCQ is NOT sufficient by default.
- Remediation triggers must reference specific failure types and their prescribed remediation paths.
- Scoring/mastery rules must align with the Stage 3 progression rules below.

NODE DETAILS:
Node ID: ${node.node_id}
Node Type: ${node.node_type}
Learning Intent: ${node.learning_intent}
Parent CLO: ${node.clo_text}
Bloom Level: ${node.bloom_level}
Evidence of Mastery: ${node.evidence_of_mastery}

STAGE 3 DIAGNOSTIC SPECIFICATION:
Diagnostic Intent: ${stage3.diagnostic_intent}

Failure Types:
${stage3.failure_types.map(ft => `- ${ft.id}: ${ft.description} (severity: ${ft.severity}, category: ${ft.misconception_category})`).join('\n')}

Observable Signals:
${stage3.observable_signals.map(s => `- ${s.id}: ${s.description} (type: ${s.signal_type}, detects: ${s.failure_type_ids.join(', ')})`).join('\n')}

Remediation Paths:
${stage3.remediation_paths.map(r => `- ${r.id}: ${r.description} (strategy: ${r.strategy}, for failure: ${r.failure_type_id}${r.target_node_id ? ', target: ' + r.target_node_id : ''})`).join('\n')}

Progression Rules:
- Mastery Definition: ${stage3.progression_rules.mastery_definition}
- Mastery Threshold: ${stage3.progression_rules.mastery_threshold}
- Gate Strictness: ${stage3.progression_rules.gate_strictness}
- Blocks Downstream: ${stage3.progression_rules.blocks_downstream}

Return a JSON object:
{
  "items": [
    {
      "item_id": "DI-1",
      "item_type": "structured_mcq|multi_select|short_structured_response|scenario_justification|procedural_check|transfer_mini_challenge",
      "question_text": "The question",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct_answer": "B",
      "rubric_criteria": "For open-ended items",
      "points": 10,
      "bloom_level": "Apply",
      "diagnostic_intent": "What understanding this item checks",
      "failure_types_detected": ["FT-1", "FT-2"],
      "remediation_trigger": "If incorrect: route to REM-1 (revisit_prerequisite)",
      "scoring_rule": "Full marks for correct answer with justification; partial for correct answer without justification"
    }
  ],
  "remediation_triggers": [
    {
      "failure_type_id": "FT-1",
      "trigger_condition": "Score below 70% on items detecting FT-1",
      "remediation_action": "Route to alternative explanation of concept",
      "target_node_id": "optional node to revisit"
    }
  ],
  "pass_threshold": 70,
  "time_limit_minutes": 15,
  "instructions": "Assessment instructions for the learner"
}

Generate 4-8 diagnostic items with clear Stage 3 alignment.`;
}

/**
 * Step C Layer 2 — LLM-Interactive Assessment Spec prompt
 */
export function buildStage4LLMInteractiveSpecPrompt(
  node: {
    node_id: string;
    node_type: string;
    learning_intent: string;
    clo_text: string;
    prerequisite_nodes: string[];
  },
  qualificationReason: 'high_risk' | 'reasoning_intensive' | 'recall_gaming_vulnerable',
  stage3: {
    diagnostic_intent: string;
    failure_types: Array<{ id: string; description: string; severity: string }>;
    progression_rules: { mastery_definition: string; mastery_threshold: string; gate_strictness: string };
  }
): string {
  return `You are designing a STRUCTURED LLM-interactive assessment specification (NOT a free-chat). The LLM applies Stage 3 rules; it does NOT invent criteria or redefine mastery.

This node qualifies because: ${qualificationReason}

NON-NEGOTIABLE BOUNDARY: The LLM applies Stage 3 rules; it does not invent criteria or redefine mastery.

NODE DETAILS:
Node ID: ${node.node_id}
Node Type: ${node.node_type}
Learning Intent: ${node.learning_intent}
Parent CLO: ${node.clo_text}
Prerequisites: ${node.prerequisite_nodes.join(', ') || 'None'}

STAGE 3 CONTEXT:
Diagnostic Intent: ${stage3.diagnostic_intent}
Mastery Definition: ${stage3.progression_rules.mastery_definition}
Mastery Threshold: ${stage3.progression_rules.mastery_threshold}
Gate Strictness: ${stage3.progression_rules.gate_strictness}

Failure Types:
${stage3.failure_types.map(ft => `- ${ft.id}: ${ft.description} (severity: ${ft.severity})`).join('\n')}

Return a JSON object:
{
  "assessment_objective": "What this interactive assessment aims to determine",
  "allowed_scope": {
    "topics_in_scope": ["topic1", "topic2"],
    "topics_out_of_scope": ["topic that must not be introduced"]
  },
  "initial_prompt": "The opening scenario or question presented to the learner",
  "probing_paths": [
    {
      "failure_type_id": "FT-1",
      "failure_description": "What this failure looks like",
      "follow_up_questions": ["Question if learner shows signs of FT-1", "Deeper probe"],
      "expected_reasoning_indicators": ["What good reasoning looks like"],
      "misconception_indicators": ["What indicates the misconception"]
    }
  ],
  "mastery_rubric": [
    {
      "criterion": "Criterion name",
      "acceptable_evidence": "What constitutes acceptable reasoning",
      "unacceptable_evidence": "What indicates failure to meet criterion"
    }
  ]
}

Generate a structured spec with probing paths for EACH failure type.`;
}

/**
 * Step D — Remediation Assets prompt
 */
export function buildStage4RemediationAssetsPrompt(
  node: {
    node_id: string;
    node_type: string;
    learning_intent: string;
    clo_text: string;
  },
  stage3: {
    failure_types: Array<{ id: string; description: string; misconception_category: string; severity: string }>;
    remediation_paths: Array<{ id: string; failure_type_id: string; strategy: string; description: string; target_node_id?: string }>;
  }
): string {
  return `You are an expert remediation content designer. Generate targeted, non-repetitive remediation assets for each failure type and remediation path defined in Stage 3.

IMPORTANT: Remediation is targeted, not repetitive. Each asset addresses a SPECIFIC misunderstanding.

NODE DETAILS:
Node ID: ${node.node_id}
Node Type: ${node.node_type}
Learning Intent: ${node.learning_intent}
Parent CLO: ${node.clo_text}

STAGE 3 FAILURE TYPES:
${stage3.failure_types.map(ft => `- ${ft.id}: ${ft.description} (category: ${ft.misconception_category}, severity: ${ft.severity})`).join('\n')}

STAGE 3 REMEDIATION PATHS:
${stage3.remediation_paths.map(r => `- ${r.id}: For ${r.failure_type_id} — strategy: ${r.strategy} — ${r.description}${r.target_node_id ? ' (revisit: ' + r.target_node_id + ')' : ''}`).join('\n')}

Return a JSON object:
{
  "assets": [
    {
      "asset_id": "RA-1",
      "failure_type_id": "FT-1",
      "failure_description": "What the learner misunderstands",
      "remediation_path_id": "REM-1",
      "strategy": "alternative_explanation",
      "feedback_message": "Targeted feedback message explaining what went wrong and why",
      "micro_content": "Short remediation content (markdown) that directly addresses the misconception",
      "alternate_explanation": "A different way to explain the concept that avoids the misconception trigger",
      "alternate_example": "A concrete example that clarifies the correct understanding",
      "prerequisite_link": {
        "node_id": "optional prerequisite node to revisit",
        "reason": "Why revisiting this prerequisite helps"
      }
    }
  ]
}

Generate one remediation asset per failure type + remediation path combination.`;
}

/**
 * Step E — Visual Asset Specification prompt (enhanced)
 */
export function buildStage4VisualAssetSpecPrompt(
  node: {
    node_id: string;
    node_type: string;
    learning_intent: string;
    clo_id: string;
  },
  contentSummary: string,
  misconceptions: string[]
): string {
  return `You are an expert instructional designer creating production-ready visual asset specifications.

Each spec must include a ready-to-use generation prompt that can be directly passed to a visual generation AI agent.

NODE DETAILS:
Node ID: ${node.node_id}
Node Type: ${node.node_type}
Learning Intent: ${node.learning_intent}
CLO: ${node.clo_id}

CONTENT SUMMARY:
${contentSummary}

MISCONCEPTIONS TO AVOID IN VISUALS:
${misconceptions.length > 0 ? misconceptions.join('\n- ') : 'None specified'}

Return a JSON object:
{
  "visual_specs": [
    {
      "spec_id": "VS-1",
      "visual_type": "diagram|flowchart|comparison_table|concept_map|infographic|illustration|schematic",
      "purpose": "What this visual teaches",
      "learning_intent": "Specific learning intent served",
      "required_elements": ["element1", "element2"],
      "required_labels": ["label1", "label2"],
      "misconceptions_to_avoid": ["Do not depict X as Y because..."],
      "style_constraints": "academic|schematic|minimal|detailed",
      "generation_prompt": "A complete, ready-to-use prompt for generating this visual with an AI agent. Be specific about layout, elements, labels, colors, and style.",
      "alt_text": "Accessible description",
      "placement": "Where in the content this should appear"
    }
  ]
}

Generate 2-4 visual specs that meaningfully enhance understanding.`;
}

/**
 * Step E — Video Production Package prompt (enhanced)
 */
export function buildStage4VideoProductionPackagePrompt(
  node: {
    node_id: string;
    node_type: string;
    learning_intent: string;
    clo_id: string;
    clo_text: string;
  },
  scriptType: 'explainer' | 'walkthrough' | 'demonstration' | 'feedback',
  contentSummary: string
): string {
  return `You are an expert educational video production specialist creating a complete video production package.

This package must be ready to use by AI video agents, studios, or instructional designers.

NODE DETAILS:
Node ID: ${node.node_id}
Node Type: ${node.node_type}
Learning Intent: ${node.learning_intent}
CLO: ${node.clo_id} — ${node.clo_text}
Script Type: ${scriptType}

CONTENT SUMMARY:
${contentSummary}

SCOPE BOUNDARIES:
- The video must ONLY cover what is in the node's learning intent
- It must NOT introduce concepts from downstream nodes

Return a JSON object:
{
  "pedagogical_purpose": "Why this video is needed and what it achieves",
  "duration_guidance_minutes": 8,
  "full_script": "Complete narration script for the entire video",
  "segments": [
    {
      "segment_number": 1,
      "title": "Introduction",
      "duration_seconds": 45,
      "narration": "Full narration for this segment",
      "visual_cues": "Detailed description of on-screen visuals",
      "on_screen_text": "Key text/bullets to display"
    }
  ],
  "scope_boundaries": {
    "must_cover": ["topic1", "topic2"],
    "must_not_introduce": ["concept_from_later_node"]
  },
  "target_audience": "Description of target audience",
  "production_notes": "Additional notes for production team"
}

Create a 5-10 minute video with 4-8 segments. Include detailed visual cues for each segment.`;
}

/**
 * Step C Layer 3 — Summative Assessments prompt
 */
export function buildStage4SummativeAssessmentsPrompt(
  courseTitle: string,
  clos: Array<{ clo_id: string; clo_text: string; bloom_level: string }>,
  assessmentBlueprint: Array<{ name: string; type: string; weight: number; description: string }>,
  assessmentStrategy: string
): string {
  return `You are an expert assessment designer creating course-level summative assessment artifacts.

Each artifact must be:
- Explicitly mapped to CLOs
- Aligned to diagnostic logic
- Defensible for accreditation review
- Include workload estimates

COURSE: ${courseTitle}

ASSESSMENT STRATEGY: ${assessmentStrategy || 'Not specified — use standard academic assessment practices'}

ASSESSMENT BLUEPRINT (from syllabus):
${assessmentBlueprint.length > 0
  ? assessmentBlueprint.map(a => `- ${a.name} (${a.type}): ${a.weight}% — ${a.description}`).join('\n')
  : 'No blueprint provided — generate a balanced set of summative assessments covering all CLOs'}

COURSE LEARNING OUTCOMES:
${clos.map(c => `- ${c.clo_id}: ${c.clo_text} (Bloom: ${c.bloom_level})`).join('\n')}

Return a JSON object:
{
  "artifacts": [
    {
      "artifact_id": "SA-1",
      "artifact_type": "assignment_brief|project_spec|case_study|final_assessment|capstone",
      "title": "Assessment title",
      "description": "Detailed description of the assessment",
      "clo_ids": ["CLO-1", "CLO-2"],
      "clo_coverage_statement": "How this assessment addresses the listed CLOs",
      "weight_percentage": 30,
      "rubric": [
        {
          "criterion_id": "CR-1",
          "description": "Criterion description",
          "weight": 40,
          "levels": [
            { "level": 4, "label": "Excellent", "description": "...", "points": 100 },
            { "level": 3, "label": "Good", "description": "...", "points": 80 },
            { "level": 2, "label": "Satisfactory", "description": "...", "points": 60 },
            { "level": 1, "label": "Needs Improvement", "description": "...", "points": 40 }
          ]
        }
      ],
      "marking_guide": "Detailed markdown guide for markers",
      "diagnostic_alignment": "How this assessment connects to the course diagnostic logic",
      "estimated_hours": 10
    }
  ]
}

Generate artifacts that together cover ALL CLOs and sum to ~100% weight. Ensure variety in artifact types.`;
}

/**
 * Step F — Course Book Chapter prompt (stub — assembly is deterministic, not AI)
 */
export function buildStage4CourseBookChapterPrompt(
  cloId: string,
  cloText: string,
  topicTitle: string,
  nodeContents: Array<{ node_id: string; content: string }>
): string {
  return `Compile the following node contents into a coherent chapter section for CLO: ${cloId} — ${cloText}, Topic: ${topicTitle}.
Nodes: ${nodeContents.map(n => n.node_id).join(', ')}
Maintain node-id anchors and do not alter content meaning.`;
}
