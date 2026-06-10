// Bloom's Taxonomy Levels
export type BloomLevel = 
  | 'Remember' 
  | 'Understand' 
  | 'Apply' 
  | 'Analyze' 
  | 'Evaluate' 
  | 'Create';

// Knowledge Types
export type KnowledgeType = 
  | 'Factual' 
  | 'Conceptual' 
  | 'Procedural' 
  | 'Metacognitive';

// Learning Node Types — Canonical Node Taxonomy (Stage 2)
// No other node types are permitted.
export type NodeType = 
  | 'concept' 
  | 'principle' 
  | 'procedure' 
  | 'application' 
  | 'metacognitive' 
  | 'transfer';

// Legacy node types kept for backward-compatibility reads only
export type LegacyNodeType = 'practice' | 'assessment' | 'remediation';

// Canonical node types as array (for validation)
export const CANONICAL_NODE_TYPES: NodeType[] = [
  'concept', 'principle', 'procedure', 'application', 'metacognitive', 'transfer'
];

// Risk Levels
export type RiskLevel = 'low' | 'medium' | 'high';

// Skipping Eligibility — Risk-Based (Stage 2 / Stage 3)
export type SkippingEligibility =
  | 'non_skippable'
  | 'conditionally_skippable'
  | 'skippable'
  | 'not_applicable';

// Required Status (mandatory vs optional)
export type RequiredStatus = 'mandatory' | 'optional';

// Stage Numbers
export type StageNumber = 1 | 2 | 3 | 4 | 5;

// Course Learning Outcome (CLO)
export interface CLO {
  clo_id: string;
  clo_text: string;
  capability_statement: string;
  conditions_of_performance: string;
  evidence_of_mastery: string;
  bloom_level: BloomLevel;
  knowledge_type: KnowledgeType;
  risk_level: RiskLevel;
}

// Course Contract (Stage 1 output)
export interface CourseContract {
  course_code: string;
  course_metadata: {
    credits: number;
    hours: number;
    accreditation_tags: string[];
  };
  course_learning_outcomes: CLO[];
  assessment_strategy: string;
  assumptions_and_constraints: string;
}

// Topic node (first-class graph entity, sits between CLO and LearningNode)
export interface Topic {
  topic_id: string;
  clo_id: string;
  title: string;
  description: string;
  readings?: string;
  rationale?: string;
}

// Learning Node (Stage 2 output)
export interface LearningNode {
  node_id: string;
  clo_id: string;
  topic_id: string;          // Links to parent Topic
  topic_title?: string;       // Denormalized for UI convenience
  node_type: NodeType | string; // string allows legacy types at read-time
  learning_intent: string;
  prerequisite_nodes: string[];
  risk_level: RiskLevel;
  // Adaptivity fields (set by Stage 2, refined by Stage 3)
  mandatory: boolean;                           // kept for backward compat
  skippable: boolean;                           // kept for backward compat
  required_status: RequiredStatus;              // replaces boolean mandatory
  skipping_eligibility: SkippingEligibility;    // 4-way classification
  skip_conditions: string;
  failure_meaning: string;
  diagnostic_intent: string;
  // Stage 3 assessment intelligence (set by Stage 3)
  stage3_logic_json?: string;                    // Full Stage3NodeLogic as JSON string
  stage3_preknowledge_eligible?: boolean;         // Convenience: true if pre-knowledge check is feasible
  stage3_gate_strictness?: 'strict' | 'flexible'; // Convenience: mastery gating strictness
  // Added in Stage 4
  content_path?: string;
  // UI position (Stage 2.5 editor)
  ui_x?: number;
  ui_y?: number;
}

// ============================================================================
// STAGE 3 — Assessment Intelligence Types
// ============================================================================

// Gate strictness for progression rules
export type GateStrictness = 'strict' | 'flexible';

// A failure type describing a likely misconception (Step B)
export interface FailureType {
  id: string;                        // e.g., "FT-1"
  description: string;               // What the misconception is
  misconception_category: string;    // e.g., "causal confusion", "overgeneralization", "procedural error"
  severity: 'low' | 'medium' | 'high';
}

// An observable signal tied to one or more failure types (Step C)
export interface ObservableSignal {
  id: string;                        // e.g., "SIG-1"
  description: string;               // What the signal looks like in learner work
  failure_type_ids: string[];        // Which failure types this signal reveals
  signal_type: 'incorrect_justification' | 'patterned_wrong_answers' | 'missing_reasoning' | 'shallow_explanation' | 'procedural_skip' | 'other';
}

// A remediation path tied to a failure type (Step D)
export interface RemediationPath {
  id: string;                        // e.g., "REM-1"
  failure_type_id: string;           // Which failure type this remediates
  strategy: 'revisit_prerequisite' | 'alternative_explanation' | 'contrasting_example' | 'targeted_feedback' | 'scaffolded_practice' | 'peer_discussion' | 'other';
  description: string;               // What the remediation involves
  target_node_id?: string;           // Optional: specific node to revisit
}

// Progression rules for this node (Step E)
export interface ProgressionRules {
  mastery_definition: string;        // What mastery means for this node
  mastery_threshold: 'full' | 'partial' | 'flexible'; // Level of mastery required
  gate_strictness: GateStrictness;   // 'strict' = must pass before dependents unlock, 'flexible' = allows partial progression
  blocks_downstream: boolean;        // Whether this node must be completed before dependents
  rationale: string;                 // Why these rules apply
}

// Pre-knowledge check logic (Step F) — only for eligible nodes
export interface PreknowledgeCheckLogic {
  eligible: boolean;                 // Whether a pre-knowledge check is feasible
  reasoning_based: boolean;          // true = tests reasoning, false = tests recall (must be true)
  check_description: string;         // What the pre-check would assess (NOT actual questions)
  high_risk_override: boolean;       // true = high-risk overrides skipping even if pre-check passed
  explainability_note: string;       // How the skip decision can be explained
}

// Per-node Stage 3 assessment intelligence output
export interface Stage3NodeLogic {
  node_id: string;
  // Step A — Diagnostic intent
  diagnostic_intent: string;         // What specific understanding is being checked
  // Step B — Failure types
  failure_types: FailureType[];
  // Step C — Observable signals
  observable_signals: ObservableSignal[];
  // Step D — Remediation paths
  remediation_paths: RemediationPath[];
  // Step E — Progression rules
  progression_rules: ProgressionRules;
  // Step F — Pre-knowledge check logic
  preknowledge_check_logic: PreknowledgeCheckLogic;
  // Skipping/mandatory fields (still present, refined)
  required_status: RequiredStatus;
  skipping_eligibility: SkippingEligibility;
  skip_conditions: string;
}

// Course-level Stage 3 snapshot (persisted to filesystem)
export interface Stage3Snapshot {
  course_code: string;
  generated_at: string;
  node_count: number;
  nodes: Stage3NodeLogic[];
  summary: {
    total_nodes: number;
    mandatory_count: number;
    optional_count: number;
    strict_gate_count: number;
    flexible_gate_count: number;
    preknowledge_eligible_count: number;
    failure_types_total: number;
    remediation_paths_total: number;
  };
}

// Stage 3 Incomplete Report — nodes missing one or more A–F elements
export interface Stage3IncompleteNode {
  node_id: string;
  missing_elements: string[];   // e.g. ['diagnostic_intent', 'failure_types', ...]
}

export interface Stage3IncompleteReport {
  course_code: string;
  generated_at: string;
  incomplete_count: number;
  nodes: Stage3IncompleteNode[];
}

// Learning Node Upsert (for Stage 2.5 editing)
export interface LearningNodeUpsert {
  node_id?: string; // If omitted, server generates a new ID
  node_type: NodeType | string;
  learning_intent: string;
  risk_level: RiskLevel;
  failure_meaning?: string;
  diagnostic_intent?: string;
  topic_id?: string;
  ui_x?: number;
  ui_y?: number;
}

// Course Entity
export interface Course {
  course_code: string;
  title: string;
  description: string;
  credit_hours: number;
  raw_extracted_text: string;
  current_stage: StageNumber;
  created_at: string;
  updated_at: string;
}

// Resolved textbook info
export interface ResolvedTextbook {
  title?: string;
  authors?: string[];
  edition?: string;
  isbn?: string;
}

// Suggested weekly plan item (from deep research) — LEGACY, kept for migration
export interface SuggestedWeeklyPlanItem {
  week: number;
  topic: string;
  description: string;
  readings: string;
  clo_ids: string[];
  rationale: string;
}

// AI-suggested weekly plan (generated by deep textbook research) — LEGACY, kept for migration
export interface SuggestedWeeklyPlan {
  generated_at: string;
  provider: 'openai';
  model: string;
  textbook: ResolvedTextbook | null;
  weekly_plan: SuggestedWeeklyPlanItem[];
  web_sources: Array<{ title: string; url: string }>;
  stale?: boolean;
  stale_reason?: string;
}

// ============================================================================
// TOPIC-PER-CLO MODEL (replaces week-centric planning)
// ============================================================================

// A single self-paced topic that a learner completes toward a CLO
export interface TopicItem {
  topic_id: string;
  title: string;
  description: string;
  readings?: string;
  rationale?: string;
}

// Topics grouped by CLO (user-confirmed / editable)
export interface CloTopicGroup {
  clo_id: string;
  topics: TopicItem[];
}

// Stored on ExtractedSnapshot as clo_topics
export type CloTopics = CloTopicGroup[];

// AI-suggested topic for a CLO (from deep research)
export interface SuggestedTopicItem {
  title: string;
  description: string;
  readings: string;
  rationale: string;
}

// AI-suggested topics grouped by CLO
export interface SuggestedCloTopicGroup {
  clo_id: string;
  topics: SuggestedTopicItem[];
}

// AI-suggested topics (generated by deep textbook research)
export interface SuggestedCloTopics {
  generated_at: string;
  provider: 'openai';
  model: string;
  textbook: ResolvedTextbook | null;
  topics_by_clo: SuggestedCloTopicGroup[];
  web_sources: Array<{ title: string; url: string }>;
  stale?: boolean;
  stale_reason?: string;
}

// ============================================================================
// CLO REFINEMENT (Stage 1 Layer 2)
// ============================================================================

export type SmeRefinementDecision =
  | 'pending'
  | 'keep_official'
  | 'accept_ai_refinement'
  | 'custom_wording';

export type CloApprovalStatus = 'pending' | 'approved' | 'needs_revision';

export interface CouncilFeedbackSummary {
  strengths?: string;
  risks_limitations?: string;
  adaptive_readiness_notes?: string;
  evidence_of_mastery_direction?: string;
  chairman_recommendation?: string;
}

export interface FullCouncilAnalysis {
  learning_outcome_quality?: string;
  curriculum_coherence?: string;
  adaptive_readiness?: string;
  assessment_evidence?: string;
  discipline_context?: string;
  chairman_synthesis?: string;
  council_disagreement?: string;
}

/** AI council output for one CLO (Layer 2) */
export interface SuggestedCloRefinement {
  clo_id: string;
  official_clo: string;
  council_feedback_summary: CouncilFeedbackSummary;
  full_council_analysis: FullCouncilAnalysis;
  ai_suggested_refined_clo: string;
  refinement_rationale: string[];
}

/** SME working copy per CLO */
export interface CloRefinementItem {
  clo_id: string;
  official_clo: string;
  council_feedback_summary: CouncilFeedbackSummary;
  full_council_analysis: FullCouncilAnalysis;
  ai_suggested_refined_clo: string;
  refinement_rationale: string[];
  sme_decision: SmeRefinementDecision;
  final_clo_for_adaptive_design: string;
  sme_internal_note?: string;
  approval_status: CloApprovalStatus;
}

export interface CloRefinementsFile {
  items: CloRefinementItem[];
  updated_at: string;
}

export interface CloRefinementReviewSummary {
  total_clos: number;
  pending_count: number;
  approved_count: number;
  needs_revision_count: number;
  all_approved: boolean;
}

// ============================================================================
// ASSESSMENT REDESIGN (Stage 1 Layer 3)
// ============================================================================

export type AssessmentSmeDecision =
  | 'pending'
  | 'keep_original'
  | 'accept_ai_redesign'
  | 'custom_redesign';

export interface OriginalAssessment {
  title: string;
  description: string;
  type_or_format: string;
  weight: string;
}

export interface CouncilAssessmentSummary {
  what_works_well?: string;
  what_may_limit_the_assessment?: string;
  why_contribution_redesign_helps?: string;
  recommendation?: string;
}

export interface AiSuggestedRedesign {
  redesigned_title: string;
  redesigned_description: string;
  contribution_purpose: string;
  refined_clo_alignment: string[];
  fixed_academic_core: string;
  personalized_context_variables: string[];
  required_artifact: string;
  output_format_options: string[];
  suggested_evaluation_criteria: string[];
  readiness_gate_needs: string[];
  ai_integrity_features: string[];
  publication_potential: string;
}

/** Deeper reasoning only - must NOT duplicate card fields */
export interface FullAssessmentCouncilAnalysis {
  clo_alignment_reasoning?: string;
  authentic_contribution_reasoning?: string;
  personalization_fairness_reasoning?: string;
  rubric_validity_reasoning?: string;
  ai_integrity_reasoning?: string;
  publication_impact_reasoning?: string;
  council_disagreements?: string;
  chairman_synthesis?: string;
  sme_risks_to_review: string[];
  sme_questions: string[];
}

export interface FinalAssessmentForMaestro {
  title: string;
  description: string;
  refined_clo_alignment: string[];
  required_artifact: string;
  output_format_options: string[];
  fixed_academic_core: string;
  personalized_context_variables: string[];
  suggested_evaluation_criteria: string[];
  readiness_gate_needs: string[];
  ai_integrity_features: string[];
  publication_potential: string;
}

/** AI council output for one assessment (Layer 3) */
export interface SuggestedAssessmentRedesign {
  assessment_id: string;
  original_assessment: OriginalAssessment;
  council_summary: CouncilAssessmentSummary;
  ai_suggested_redesign: AiSuggestedRedesign;
  full_council_analysis: FullAssessmentCouncilAnalysis;
  redesign_rationale: string[];
}

/** SME working copy per assessment */
export interface AssessmentRedesignItem extends SuggestedAssessmentRedesign {
  sme_decision: AssessmentSmeDecision;
  final_assessment_for_maestro: FinalAssessmentForMaestro;
  sme_internal_note?: string;
  approval_status: CloApprovalStatus;
}

export interface AssessmentRedesignsFile {
  items: AssessmentRedesignItem[];
  updated_at: string;
}

export interface AssessmentRedesignReviewSummary {
  total_assessments: number;
  pending_count: number;
  approved_count: number;
  needs_revision_count: number;
  all_approved: boolean;
}

// ============================================================================
// ASSESSMENT STRUCTURE, WEIGHTING & RUBRIC (Stage 1 Layer 4)
// ============================================================================

export type WeightDecision =
  | 'pending'
  | 'keep_current'
  | 'approve_proposed'
  | 'custom_weights';

export type WeightChangeType = 'no_change' | 'increased' | 'decreased';

export type RubricDecision = 'pending' | 'approve' | 'edit' | 'needs_revision';

export type AssessmentStructureDecision =
  | 'pending'
  | 'approve'
  | 'edit'
  | 'needs_revision';

export type ProcessEvidenceStatus =
  | 'required'
  | 'graded'
  | 'integrity_evidence_only'
  | 'optional'
  | 'not_required';

/** One step of the learning progression narrative shown before the weight table */
export interface AssessmentProgressionItem {
  assessment_id: string;
  role_in_progression: string;
}

/** Current vs proposed vs SME-selected weight for one assessment */
export interface WeightEntry {
  assessment_id: string;
  current_weight: string;
  proposed_weight: string;
  selected_weight: string;
  /** Frozen copy of selected_weight once Step 1 is approved; null until then. */
  approved_weight?: string | null;
  change_type: WeightChangeType;
}

/** Step 1 — course-level weighting decision */
export interface CourseLevelWeightingSummary {
  current_total_weight: string;
  proposed_total_weight: string;
  selected_total_weight: string;
  weight_decision: WeightDecision;
  /** Selecting a weight option is NOT approval; the SME must confirm the structure. */
  step_1_approved: boolean;
  weights_valid: boolean;
  approved_at?: string | null;
  weighting_rationale: string;
  assessment_progression_overview: AssessmentProgressionItem[];
  weights: WeightEntry[];
}

/** One row of the AI-assisted analytic rubric (four performance levels) */
export interface AnalyticRubricCriterion {
  rubric_criterion: string;
  criterion_weight: string;
  exceeds_standard: string;
  meets_standard: string;
  developing: string;
  not_yet_evident: string;
  evidence_required: string;
  ai_scoring_guidance: string;
}

export interface ProcessEvidenceItem {
  evidence_item: string;
  status: ProcessEvidenceStatus;
}

/** Read-only reference to the approved Final Assessment for Maestro from Layer 3 */
export interface Layer4FinalAssessmentRef {
  title: string;
  description: string;
  required_artifact: string;
  refined_clo_alignment: string[];
  suggested_evaluation_criteria: string[];
}

/** Step 2 — per-assessment rubric and structure review (SME working copy) */
export interface AssessmentStructureReview {
  assessment_id: string;
  selected_weight_from_step_1: string;
  final_assessment_from_layer_3: Layer4FinalAssessmentRef;
  ai_assisted_analytic_rubric: AnalyticRubricCriterion[];
  rubric_decision: RubricDecision;
  process_evidence_requirements: ProcessEvidenceItem[];
  ai_use_disclosure_rule: string;
  revision_policy: string;
  grading_policy: string;
  assessment_structure_decision: AssessmentStructureDecision;
  sme_internal_note?: string;
  approval_status: CloApprovalStatus;
}

export interface WeightingRubricFile {
  course_level_weighting_summary: CourseLevelWeightingSummary;
  assessment_structure_reviews: AssessmentStructureReview[];
  full_assessment_structure_report?: string;
  updated_at: string;
}

export interface WeightingRubricReviewSummary {
  total_assessments: number;
  pending_count: number;
  approved_count: number;
  needs_revision_count: number;
  all_approved: boolean;
  weighting_decided: boolean;
  assessment_cards_unlocked: boolean;
  selected_weight_total: number;
  weights_balanced: boolean;
}

// ============================================================================
// ASSESSMENT INTEGRITY & ACTIVE AI USE (Stage 1 Layer 5)
// ============================================================================

export type AiUseAllowedStatus = 'allowed' | 'allowed_with_caution' | 'not_acceptable';

export type PassiveAiRiskLevel = 'very_low' | 'low' | 'medium' | 'high';

export type OwnershipRequiredStatus = 'required' | 'optional' | 'not_required';

export type OwnershipUseStatus = 'graded' | 'integrity_evidence' | 'support_only';

export type ReflectionDefenseRequirement =
  | 'none'
  | 'written_reflection'
  | 'video_audio_explanation'
  | 'oral_defense_if_flagged'
  | 'sme_review_for_publication';

export type IntegrityDecision = 'pending' | 'approve' | 'edit' | 'needs_revision';

/** One row of the course-level AI-use framework (active vs passive AI use) */
export interface AiUseFrameworkItem {
  ai_use_category: string;
  meaning: string;
  allowed_status: AiUseAllowedStatus;
  disclosure_required: boolean;
}

/** Course-level integrity summary shown at the top of Layer 5 */
export interface CourseLevelIntegritySummary {
  overall_integrity_position: string;
  main_strengths: string[];
  main_risks: string[];
  sme_attention_points: string[];
  ai_use_framework: AiUseFrameworkItem[];
  full_integrity_report: string;
}

/** Read-only reference to the approved assessment from Layer 3 + Layer 4 */
export interface IntegrityFinalAssessmentRef {
  title: string;
  required_artifact: string;
  refined_clo_alignment: string[];
  selected_weight: string;
  rubric_summary: string[];
}

export interface PassiveAiRiskSummary {
  risk_level: PassiveAiRiskLevel;
  why_passive_ai_could_happen: string;
  why_assessment_resists_passive_ai: string;
  what_must_be_protected: string[];
}

export interface LearnerOwnershipEvidenceItem {
  evidence_item: string;
  purpose: string;
  required_status: OwnershipRequiredStatus;
  use_status: OwnershipUseStatus;
}

export interface AiUseDisclosureField {
  field: string;
  learner_must_explain: string;
}

export interface ContextVerificationItem {
  check_item: string;
  required: boolean;
}

/** Per-assessment integrity review (SME working copy) */
export interface AssessmentIntegrityReview {
  assessment_id: string;
  final_assessment_reference: IntegrityFinalAssessmentRef;
  passive_ai_risk_summary: PassiveAiRiskSummary;
  learner_ownership_evidence: LearnerOwnershipEvidenceItem[];
  ai_use_disclosure_requirements: AiUseDisclosureField[];
  context_verification_requirements: ContextVerificationItem[];
  reflection_or_defense_requirement: ReflectionDefenseRequirement;
  integrity_flags: string[];
  sme_decision: IntegrityDecision;
  sme_internal_note?: string;
  approval_status: CloApprovalStatus;
}

export interface IntegrityReviewFile {
  course_level_integrity_summary: CourseLevelIntegritySummary;
  assessment_integrity_reviews: AssessmentIntegrityReview[];
  updated_at: string;
}

export interface IntegrityReviewReviewSummary {
  total_assessments: number;
  pending_count: number;
  approved_count: number;
  needs_revision_count: number;
  all_approved: boolean;
}

// ============================================================================
// SELF-PACED SUBTOPIC ARCHITECTURE (Stage 1 Layer 6)
// ============================================================================

export type SubtopicLearningFunction =
  | 'foundational'
  | 'applied'
  | 'integrative'
  | 'bridge'
  | 'assessment_preparation';

export type SubtopicEffort = 'low' | 'moderate' | 'high';

export type SubtopicRecommendation = 'keep' | 'merge' | 'split' | 'move' | 'remove';

/** SME decision recorded for one subtopic (richer than approval_status for audit) */
export type SubtopicDecision =
  | 'pending'
  | 'approved'
  | 'edited'
  | 'rejected'
  | 'needs_regeneration';

/** A connection from this subtopic to another refined CLO */
export interface SubtopicCrossCloLink {
  linked_clo_id: string;
  reason: string;
}

/** One self-paced learning territory (subtopic) under a refined CLO */
export interface ArchitectureSubtopic {
  subtopic_id: string;
  proposed_subtopic: string;
  purpose: string;
  clo_alignment: string;
  assessment_connection: string[];
  learning_function: SubtopicLearningFunction;
  expected_learning: string;
  possible_node_families: string[];
  cross_clo_links: SubtopicCrossCloLink[];
  adaptive_value: string;
  estimated_learning_effort: SubtopicEffort;
  source_evidence: string[];
  recommendation: SubtopicRecommendation;
  sme_decision: SubtopicDecision;
  sme_internal_note?: string;
  approval_status: CloApprovalStatus;
}

/** One refined-CLO section grouping its subtopics */
export interface SubtopicCloSection {
  clo_id: string;
  refined_clo: string;
  /** Bloom Taxonomy level copied from the parent CLO (authoritative on read) */
  bloom_level: BloomLevel;
  related_assessments: string[];
  clo_learning_journey_summary: string;
  /** Read-only deep-research readings pool surfaced as source evidence reference */
  reference_readings: string[];
  subtopics: ArchitectureSubtopic[];
}

/** Course-level summary shown at the top of Layer 6 */
export interface SubtopicArchitectureCourseSummary {
  course_title: string;
  total_refined_clos: number;
  total_subtopics: number;
  architecture_summary: string;
  source_evidence_note: string;
  full_report: string;
}

/** SME working file persisted as subtopic-architecture.json */
export interface SubtopicArchitectureFile {
  course_summary: SubtopicArchitectureCourseSummary;
  clo_sections: SubtopicCloSection[];
  updated_at: string;
}

export interface SubtopicArchitectureReviewSummary {
  total_clos: number;
  total_subtopics: number;
  pending_count: number;
  approved_count: number;
  needs_revision_count: number;
  all_approved: boolean;
}

// CLO Topic Coverage statistics (replaces CLODistribution for topics)
export interface CloTopicCoverageStat {
  clo_id: string;
  clo_text: string;
  topic_count: number;
  has_topics: boolean;
}

export interface CloTopicCoverage {
  total_clos: number;
  total_topics: number;
  per_clo: CloTopicCoverageStat[];
  all_clos_covered: boolean; // true if every CLO has >= 1 topic
  computed_at: string;
}

// Extracted Snapshot (raw extraction result)
export interface ExtractedSnapshot {
  course_code: string;
  title: string;
  description: string;
  credit_hours: number;
  raw_text: string;
  weekly_plan: WeeklyPlanItem[]; // LEGACY — kept for migration
  assessments: Assessment[];
  references: string[];
  extracted_at: string;
  clo_distribution?: CLODistribution; // LEGACY — kept for migration
  suggested_weekly_plan?: SuggestedWeeklyPlan; // LEGACY — kept for migration
  // New topic-per-CLO model
  clo_topics?: CloTopics; // User-editable topics per CLO
  suggested_clo_topics?: SuggestedCloTopics; // AI-suggested topics from deep textbook research
  clo_topic_coverage?: CloTopicCoverage; // Computed coverage stats
}

// Course confirmation gates
export interface CourseConfirmations {
  weekly_plan_confirmed_at?: string; // LEGACY — kept for migration
  weekly_plan_summary?: string; // LEGACY — kept for migration
  clo_topics_confirmed_at?: string; // New: confirms CLO topic coverage
  clo_topics_summary?: string;
  node_graph_confirmed_at?: string; // Stage 2.5: user edited node graph
  node_graph_summary?: string;
  graph_confirmed_at?: string; // Stage 3: adaptive logic graph confirmation
  graph_summary?: string;
}

export interface WeeklyPlanItem {
  week: number;
  topic: string;
  description: string;
  readings?: string;
  clo_ids?: string[]; // CLOs covered in this week (added by CLO mapping step)
}

// CLO Distribution statistics
export interface CLODistributionStat {
  clo_id: string;
  clo_text: string;
  weeks_covered: number[];
  count: number;
  is_fair: boolean; // true if count is within ±20% of ideal
}

export interface CLODistribution {
  total_weeks: number;
  total_clos: number;
  ideal_weeks_per_clo: number;
  min_acceptable: number; // floor(0.8 * ideal)
  max_acceptable: number; // ceil(1.2 * ideal)
  per_clo: CLODistributionStat[];
  overall_is_fair: boolean; // true if all CLOs are fairly distributed
  mapped_weeks: number; // count of weeks that have a CLO assigned
  unmapped_weeks: number[]; // week numbers that have no CLO assigned (e.g., exam/review weeks)
  computed_at: string;
}

export interface Assessment {
  name: string;
  type: string;
  weight: number;
  description: string;
}

// API Response Types
export interface CourseListItem {
  course_code: string;
  title: string;
  current_stage: StageNumber;
  created_at: string;
  updated_at: string;
}

export interface CourseDetail extends Course {
  contract?: CourseContract;
  nodes?: LearningNode[];
  clos?: CLO[];
}

// Graph Data for Visualization
export interface GraphNode {
  id: string;
  type: 'course' | 'clo' | 'topic' | 'learning_node';
  label: string;
  data: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// AI Provider type
export type AIProvider = 'openrouter' | 'ollama' | 'openai';

// Stage execution mode: single (council-of-1) or council (multi-member)
export type StageExecutionMode = 'single' | 'council';

// Per-stage model configuration (NEW)
export interface StageModelConfig {
  mode: StageExecutionMode;
  singleModel: string;
  councilModels: string[];
  chairmanModel: string;
  // Per-stage council prompts (used when mode is 'council')
  memberSystemPrompt?: string;
  chairmanSystemPrompt?: string;
  // Task prompts (used in both single and council modes)
  taskPrompt?: string;
  taskPrompt2?: string; // For Stage 1's CLO Analysis prompt (only used by stage1)
}

// All stages configuration (NEW)
export interface StageConfigs {
  stage1: StageModelConfig;
  stage2: StageModelConfig;
  stage3: StageModelConfig;
  stage4: StageModelConfig;
  stage5: StageModelConfig;
}

// Stage 1 internal layer status
export type Stage1LayerStatus =
  | 'not_started'
  | 'locked'
  | 'running'
  | 'generated'
  | 'needs_review'
  | 'approved'
  | 'needs_revision'
  | 'blocked';

// Configurable Stage 1 internal layer (extends per-stage model config)
export interface Stage1LayerConfig extends StageModelConfig {
  id: string;
  name: string;
  description: string;
  parentStage: number;
  order: number;
  productOutput: string;
  outputFields: string[];
  approvalRequired: boolean;
  regenerateEnabled: boolean;
  editEnabled: boolean;
  lockNextUntilApproval: boolean;
}

// Per-course Stage 1 layer runtime state
export interface Stage1LayerState {
  layerId: string;
  status: Stage1LayerStatus;
  reportMarkdown?: string;
  outputJson?: unknown;
  generatedAt?: string;
  approvedAt?: string;
  editedAt?: string;
  error?: string;
}

export interface Stage1LayersFile {
  layers: Stage1LayerState[];
  updatedAt: string;
}

// Global council settings - prompts (shared across all stages)
export interface CouncilSettings {
  memberSystemPrompt: string;
  chairmanSystemPrompt: string;
}

// Per-stage execution settings (LEGACY - kept for backward compatibility)
export interface StageExecution {
  stage1: StageExecutionMode;
  stage2: StageExecutionMode;
  stage3: StageExecutionMode;
  stage4: StageExecutionMode;
  stage5: StageExecutionMode;
}

// Council configuration (LEGACY - kept for backward compatibility)
export interface CouncilConfig {
  // Council member models (for multi-member council)
  councilModels: string[];
  // Chairman model for synthesizing council outputs
  chairmanModel: string;
  // System prompts for council members and chairman
  memberSystemPrompt: string;
  chairmanSystemPrompt: string;
}

// Settings Configuration
export interface Settings {
  aiProvider: AIProvider;
  openrouter: {
    apiKey: string;
    baseUrl: string;
  };
  openai: {
    apiKey: string;
    baseUrl: string;
  };
  ollama: {
    baseUrl: string;
    // Optional: default options for Ollama
    options?: {
      temperature?: number;
      numCtx?: number;
    };
  };
  models: {
    stage1: string;
    stage2: string;
    stage3: string;
    stage4: string;
    stage5: string;
  };
  neo4j: {
    uri: string;
    user: string;
    password: string;
  };
  // NEW: Per-stage model configuration (single or council per stage)
  stageConfigs: StageConfigs;
  // NEW: Global council settings (temperature, prompts)
  councilSettings: CouncilSettings;
  // LEGACY: LLM Council configuration (kept for backward compatibility)
  council: CouncilConfig;
  // LEGACY: Per-stage execution mode selection (kept for backward compatibility)
  stageExecution: StageExecution;
  // Stage 1 internal academic-contract layers
  stage1Layers?: Stage1LayerConfig[];
}

// Stage Execution Result
export interface StageResult {
  success: boolean;
  stage: StageNumber;
  message: string;
  data?: unknown;
  error?: string;
}

// Stage 4 Checkpoint for resume functionality
export interface Stage4Checkpoint {
  courseCode: string;
  completedNodeIds: string[];
  totalNodes: number;
  startedAt: string;
  lastUpdatedAt: string;
  errors: number;
}

// Stage 4 Error Entry for persistent error logging
export interface Stage4ErrorEntry {
  timestamp: string;
  nodeId: string;
  errorMessage: string;
  errorStack?: string;
  attempt: number;
}

// Stage 4 run options
export interface Stage4Options {
  resume?: boolean;      // Default: true - auto-resume if checkpoint exists
  forceRestart?: boolean; // Force fresh start, ignore checkpoint
}

// ============================================================================
// STAGE 4 ENHANCED TYPES - Content, Assessment, and Workload Generation
// ============================================================================

// Content modality types per node type
export type ContentModality = 'text' | 'visual' | 'video' | 'interactive' | 'reflection';

// Video script types based on node modality
export type VideoScriptType = 'explainer' | 'walkthrough' | 'demonstration' | 'feedback';

// Assessment types for adaptive learning
export type Stage4AssessmentType = 'pre_knowledge' | 'formative_diagnostic' | 'mastery_evidence';

// Workload alignment status
export type WorkloadAlignmentStatus = 'aligned' | 'under' | 'over';

// Video section within a script
export interface VideoSection {
  section_number: number;
  title: string;
  duration_seconds: number;
  narration: string;
  visual_description: string;
  on_screen_text?: string;
  transitions?: string;
}

// Complete video script structure
export interface VideoScript {
  node_id: string;
  title: string;
  duration_minutes: number;
  script_type: VideoScriptType;
  learning_objective: string;
  target_audience: string;
  sections: VideoSection[];
  production_notes?: string;
}

// Assessment question structure
export interface AssessmentQuestion {
  question_id: string;
  question_type: 'multiple_choice' | 'true_false' | 'short_answer' | 'scenario' | 'reflection';
  question_text: string;
  options?: string[];           // For multiple choice
  correct_answer?: string;      // For auto-gradable questions
  rubric_criteria?: string;     // For open-ended questions
  points: number;
  bloom_level: BloomLevel;
  diagnostic_value: string;     // What this question reveals about understanding
}

// Assessment per node (Type A, B, or C)
export interface NodeAssessment {
  node_id: string;
  assessment_type: Stage4AssessmentType;
  title: string;
  description: string;
  questions: AssessmentQuestion[];
  adaptive_function: string;    // What happens based on result
  pass_threshold: number;       // Percentage to pass (0-100)
  time_limit_minutes?: number;
  instructions: string;
}

// Visual prompt for image/diagram generation
export interface VisualPrompt {
  prompt_id: string;
  node_id: string;
  prompt_type: 'diagram' | 'illustration' | 'infographic' | 'screenshot' | 'flowchart';
  description: string;
  purpose: string;
  placement: string;            // Where in content this should appear
  alt_text: string;             // Accessibility description
  style_notes?: string;
}

// Node content pack - all Stage 4 outputs for a single node
export interface Stage4NodeContent {
  node_id: string;
  clo_id: string;
  node_type: NodeType | string;
  modalities: ContentModality[];
  
  // Instructional content
  instructional_content: string;        // Main content markdown
  learner_instructions: string;         // How to use this content
  
  // Visual elements
  visual_prompts: VisualPrompt[];
  
  // Video (if applicable based on modality)
  video_script?: VideoScript;
  
  // Assessments (Type A, B, C)
  assessments: NodeAssessment[];
  
  // Workload estimate
  time_on_task_minutes: number;
  
  // Metadata
  generated_at: string;
  content_version: string;
}

// Per-node workload breakdown
export interface NodeWorkload {
  node_id: string;
  clo_id: string;
  node_type: NodeType | string;
  learning_intent: string;
  content_time_minutes: number;         // Reading/viewing time
  video_time_minutes: number;           // Video watching time
  assessment_time_minutes: number;      // All assessments
  practice_time_minutes: number;        // Practice activities
  total_time_minutes: number;
}

// Weekly workload aggregation
export interface WeeklyWorkload {
  week: number;
  topic: string;
  clo_ids: string[];
  node_count: number;
  total_time_minutes: number;
  total_time_hours: number;
  is_balanced: boolean;                 // Within acceptable range
}

// Complete workload map for the course
export interface WorkloadMap {
  course_code: string;
  nodes: NodeWorkload[];
  weekly_workload: WeeklyWorkload[];
  
  // Summary statistics
  total_content_hours: number;
  total_assessment_hours: number;
  total_hours: number;
  
  // Credit alignment
  credit_hours: number;
  expected_hours: number;               // credit_hours * hours_per_credit
  hours_per_credit: number;             // Standard: 15
  
  // Alignment check
  alignment_status: WorkloadAlignmentStatus;
  deviation_percentage: number;         // How far from expected
  deviation_hours: number;
  
  // Validation
  is_valid: boolean;
  validation_notes: string[];
  
  computed_at: string;
}

// CLO-specific rubric criteria
export interface CLORubricCriteria {
  clo_id: string;
  clo_text: string;
  bloom_level: BloomLevel;
  criteria: RubricCriterion[];
}

// Individual rubric criterion
export interface RubricCriterion {
  criterion_id: string;
  description: string;
  weight: number;                       // Percentage weight
  levels: RubricLevel[];
}

// Performance levels within a criterion
export interface RubricLevel {
  level: number;                        // 1-4 typically
  label: string;                        // e.g., "Excellent", "Good", "Satisfactory", "Needs Improvement"
  description: string;
  points: number;
}

// Grading scale definition
export interface GradingLevel {
  grade: string;                        // e.g., "A", "B+", "C"
  min_percentage: number;
  max_percentage: number;
  description: string;
}

// Complete course-level rubric
export interface CourseRubric {
  course_code: string;
  title: string;
  
  // CLO-aligned criteria
  clo_criteria: CLORubricCriteria[];
  
  // Overall grading
  grading_scale: GradingLevel[];
  
  // Marking guide for instructors
  marking_guide: string;                // Markdown
  
  // Instructions for learners
  learner_instructions: string;         // Markdown
  
  // Assessment weights
  assessment_weights: {
    pre_knowledge: number;              // Type A weight
    formative: number;                  // Type B weight
    mastery: number;                    // Type C weight
  };
  
  generated_at: string;
}

// Stage 4 Content Pack Summary
export interface Stage4ContentPack {
  course_code: string;
  title: string;
  
  // Statistics
  total_nodes: number;
  nodes_with_content: number;
  nodes_with_video: number;
  total_assessments: number;
  total_visual_prompts: number;
  
  // Content coverage
  node_content_status: {
    node_id: string;
    has_content: boolean;
    has_video: boolean;
    has_assessments: boolean;
    assessment_types: Stage4AssessmentType[];
  }[];
  
  // Workload summary
  workload_summary: {
    total_hours: number;
    alignment_status: WorkloadAlignmentStatus;
    deviation_percentage: number;
  };
  
  // Rubric status
  has_rubric: boolean;
  
  // Completion status
  is_complete: boolean;
  completion_percentage: number;
  missing_items: string[];
  
  generated_at: string;
}

// Stage 4 generation progress tracking
export interface Stage4Progress {
  phase: 'modality_plan' | 'content' | 'assessments' | 'remediation' | 'media_specs' | 'summative' | 'course_book' | 'workload' | 'rubric' | 'complete';
  current_node?: string;
  nodes_completed: number;
  total_nodes: number;
  assessments_generated: number;
  videos_generated: number;
  percentage: number;
}

// ============================================================================
// STAGE 4 ENHANCED ARTIFACTS — Steps A–G Scope-Aligned Types
// ============================================================================

// ---------------------------------------------------------------------------
// Step A — Canonical Modality Plan (per-node, persisted before content)
// ---------------------------------------------------------------------------

export interface ModalityPlan {
  node_id: string;
  clo_id: string;
  node_type: NodeType | string;
  // Approved modalities for this node
  approved_modalities: ContentModality[];
  // Required asset types that must be produced
  required_asset_types: ('instructional_text' | 'visual' | 'video' | 'interactive_activity' | 'reflection_prompt')[];
  // Whether visual/video are justified and why
  visual_justified: boolean;
  visual_justification?: string;
  video_justified: boolean;
  video_justification?: string;
  // Assessment instrument category required by Stage 3 diagnostics
  assessment_instrument_category: 'structured_mcq' | 'short_response' | 'scenario_justification' | 'procedural_check' | 'transfer_challenge' | 'llm_interactive' | 'reflection';
  // Stage 3 diagnostic context that drove this plan
  diagnostic_intent: string;
  risk_level: string;
  gate_strictness: string;
  // Metadata
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Step B — Node Instructional Package (structured, replaces raw markdown)
// ---------------------------------------------------------------------------

export interface NodeInstructionalPackage {
  node_id: string;
  clo_id: string;
  node_type: NodeType | string;
  // 1. Node Overview
  overview: {
    summary: string;          // Concise statement of what this node covers
    relevance: string;        // Why it matters for the CLO and capability
  };
  // 2. Core Explanation
  core_explanation: string;   // Markdown — scoped to node intent, bounded by prerequisites
  // 3. Examples
  examples: {
    example_id: string;
    title: string;
    content: string;          // Markdown
    addresses_misconception?: string; // Optional: which misconception this example targets
  }[];
  // 4. Informal Self-Check Cue
  self_check_cue: string;     // Ungraded prompt encouraging learner reflection
  // Reference Grounding
  references: {
    reference_id: string;
    source: string;           // Textbook/reading title
    type: 'primary' | 'secondary';
    citation: string;         // Full citation
    relevance: string;        // Why this reference is cited
  }[];
  // Scope constraints
  prerequisite_vocabulary: string[];  // Vocabulary/concepts bounded by prerequisites
  scope_boundary: string;            // What must NOT be introduced
  // Metadata
  generated_at: string;
  content_version: string;
}

// ---------------------------------------------------------------------------
// Step C Layer 1 — Node-Level Diagnostic Assessment (implements Stage 3)
// ---------------------------------------------------------------------------

export interface DiagnosticAssessmentItem {
  item_id: string;
  item_type: 'structured_mcq' | 'multi_select' | 'short_structured_response' | 'scenario_justification' | 'procedural_check' | 'transfer_mini_challenge';
  question_text: string;
  options?: string[];
  correct_answer?: string;
  rubric_criteria?: string;
  points: number;
  bloom_level: BloomLevel;
  // Stage 3 linkages
  diagnostic_intent: string;
  failure_types_detected: string[];     // IDs of failure types this item detects
  remediation_trigger: string;          // What remediation fires on failure
  scoring_rule: string;                 // How to score/determine mastery
}

export interface DiagnosticAssessment {
  node_id: string;
  clo_id: string;
  diagnostic_intent: string;            // From Stage 3
  // All failure types this assessment can detect
  failure_types: {
    id: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
  }[];
  // Mastery/progression rules from Stage 3
  mastery_rules: {
    mastery_definition: string;
    mastery_threshold: 'full' | 'partial' | 'flexible';
    gate_strictness: 'strict' | 'flexible';
    blocks_downstream: boolean;
  };
  // Assessment items
  items: DiagnosticAssessmentItem[];
  // Remediation triggers tied to failure meaning
  remediation_triggers: {
    failure_type_id: string;
    trigger_condition: string;
    remediation_action: string;
    target_node_id?: string;
  }[];
  pass_threshold: number;
  time_limit_minutes?: number;
  instructions: string;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Step C Layer 2 — LLM-Interactive Assessment Specification
// ---------------------------------------------------------------------------

export interface LLMInteractiveAssessmentSpec {
  node_id: string;
  clo_id: string;
  // Why this node requires LLM-interactive assessment
  qualification_reason: 'high_risk' | 'reasoning_intensive' | 'recall_gaming_vulnerable';
  // Assessment objective
  assessment_objective: string;
  // Allowed scope (node + prerequisites only)
  allowed_scope: {
    node_id: string;
    prerequisite_node_ids: string[];
    topics_in_scope: string[];
    topics_out_of_scope: string[];
  };
  // Initial scenario or question
  initial_prompt: string;
  // Structured follow-up probing paths per failure type
  probing_paths: {
    failure_type_id: string;
    failure_description: string;
    follow_up_questions: string[];
    expected_reasoning_indicators: string[];
    misconception_indicators: string[];
  }[];
  // Mastery rubric
  mastery_rubric: {
    criterion: string;
    acceptable_evidence: string;
    unacceptable_evidence: string;
  }[];
  // Evidence capture format
  evidence_capture: {
    format: 'reasoning_transcript_summary';
    fields: {
      summarized_reasoning: string;       // Template/guidance
      detected_misconception_tags: string[];
      mastery_decision: 'mastered' | 'partial' | 'not_mastered';
      confidence_level: 'high' | 'medium' | 'low';
      remediation_path_taken?: string;
    };
  };
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Step C Layer 3 — Course-Level Summative Assessment Artifacts
// ---------------------------------------------------------------------------

export interface SummativeAssessmentArtifact {
  artifact_id: string;
  artifact_type: 'assignment_brief' | 'project_spec' | 'case_study' | 'final_assessment' | 'capstone';
  title: string;
  description: string;
  // CLO coverage
  clo_ids: string[];
  clo_coverage_statement: string;
  // Assessment details
  weight_percentage: number;
  // Rubric / marking guide
  rubric: {
    criterion_id: string;
    description: string;
    weight: number;
    levels: RubricLevel[];
  }[];
  marking_guide: string;              // Markdown
  // Alignment
  diagnostic_alignment: string;       // How this connects to diagnostic logic
  // Workload
  estimated_hours: number;
  // Metadata
  generated_at: string;
}

export interface SummativeAssessmentPack {
  course_code: string;
  artifacts: SummativeAssessmentArtifact[];
  total_weight: number;               // Should sum to 100
  clo_coverage_matrix: {
    clo_id: string;
    artifact_ids: string[];
    coverage_status: 'full' | 'partial' | 'none';
  }[];
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Step D — Remediation Assets (per-node, keyed to Stage 3 failure types)
// ---------------------------------------------------------------------------

export interface RemediationAsset {
  asset_id: string;
  node_id: string;
  failure_type_id: string;
  failure_description: string;
  remediation_path_id: string;
  strategy: string;                   // From Stage 3 remediation_paths.strategy
  // Content
  feedback_message: string;           // Targeted feedback for this failure type
  micro_content: string;              // Remediation micro-content (markdown)
  alternate_explanation?: string;     // Alternative way to explain the concept
  alternate_example?: string;         // Different example addressing the misconception
  // Routing
  prerequisite_link?: {
    node_id: string;
    reason: string;
  };
  generated_at: string;
}

export interface NodeRemediationPack {
  node_id: string;
  clo_id: string;
  assets: RemediationAsset[];
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Step E — Enhanced Visual & Video Production Specifications
// ---------------------------------------------------------------------------

export interface VisualAssetSpec {
  spec_id: string;
  node_id: string;
  clo_id: string;
  // Purpose and learning intent
  purpose: string;
  learning_intent: string;
  // Visual type and content
  visual_type: 'diagram' | 'flowchart' | 'comparison_table' | 'concept_map' | 'infographic' | 'illustration' | 'schematic';
  required_elements: string[];
  required_labels: string[];
  // Pedagogical constraints
  misconceptions_to_avoid: string[];
  style_constraints: string;          // e.g., "academic", "schematic", "minimal"
  // Ready-to-use generation prompt for a visual agent
  generation_prompt: string;
  // Alt text for accessibility
  alt_text: string;
  placement: string;                  // Where in content this should appear
  generated_at: string;
}

export interface VideoProductionPackage {
  package_id: string;
  node_id: string;
  clo_id: string;
  // Pedagogical purpose
  pedagogical_purpose: string;
  // Duration guidance
  duration_guidance_minutes: number;
  // Full script
  full_script: string;
  // Scene/segment breakdown
  segments: {
    segment_number: number;
    title: string;
    duration_seconds: number;
    narration: string;
    visual_cues: string;              // On-screen visual cues
    on_screen_text?: string;
  }[];
  // Scope boundaries
  scope_boundaries: {
    must_cover: string[];
    must_not_introduce: string[];
  };
  // Production metadata
  script_type: VideoScriptType;
  target_audience: string;
  production_notes?: string;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Step F — Course Book Assembly
// ---------------------------------------------------------------------------

export interface CourseBookChapter {
  clo_id: string;
  clo_text: string;
  topics: {
    topic_id: string;
    topic_title: string;
    nodes: {
      node_id: string;
      node_type: string;
      learning_intent: string;
      content: string;                // Instructional content markdown
    }[];
  }[];
}

export interface CourseBook {
  course_code: string;
  title: string;
  // Table of contents / structure
  chapters: CourseBookChapter[];
  // Bibliography
  bibliography: {
    reference_id: string;
    citation: string;
    source_type: 'primary' | 'secondary';
    referenced_by_nodes: string[];
  }[];
  // Traceability index
  node_index: {
    node_id: string;
    clo_id: string;
    chapter_index: number;
    topic_index: number;
  }[];
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Step G — Enhanced Workload Map
// ---------------------------------------------------------------------------

export interface EnhancedWorkloadMap extends WorkloadMap {
  // Per-CLO/topic aggregation
  clo_workload: {
    clo_id: string;
    clo_text: string;
    topics: {
      topic_id: string;
      topic_title: string;
      node_count: number;
      total_time_minutes: number;
    }[];
    total_time_minutes: number;
    total_time_hours: number;
  }[];
  // Summative component workload
  summative_workload: {
    artifact_id: string;
    artifact_type: string;
    title: string;
    estimated_hours: number;
    weight_percentage: number;
  }[];
  // Deterministic flags
  flags: {
    flag_type: 'overload' | 'under_coverage' | 'policy_misalignment' | 'unbalanced_clo';
    severity: 'warning' | 'error';
    message: string;
    affected_entity: string;          // CLO ID, topic ID, week number, etc.
  }[];
  // Institutional policy reference
  institutional_policy: {
    hours_per_credit: number;
    max_weekly_hours: number;
    min_assessment_weight: number;
    max_assessment_weight: number;
  };
}

// ---------------------------------------------------------------------------
// Operational Layer — Asset Tag (consistent tagging for all Stage 4 outputs)
// ---------------------------------------------------------------------------

export interface Stage4AssetTag {
  asset_type: string;
  node_id?: string;
  clo_id?: string;
  diagnostic_purpose?: string;
  workload_contribution_minutes?: number;
  assessment_instrument_category?: string;
  regeneration_safe: boolean;          // Can be regenerated without redesign
}

// ---------------------------------------------------------------------------
// Stage 4 Validation Report
// ---------------------------------------------------------------------------

export interface Stage4ValidationReport {
  course_code: string;
  is_valid: boolean;
  checks: {
    check_name: string;
    passed: boolean;
    message: string;
    affected_nodes?: string[];
  }[];
  generated_at: string;
}

// ============================================================================
// STAGE 5A — Structural Assembly & Adaptive Logic Validation
// ============================================================================

// ---------------------------------------------------------------------------
// Assembled Adaptive Course Model (snapshot used for validation)
// ---------------------------------------------------------------------------

/** A lightweight graph-edge representation used in the assembled model */
export interface AdaptiveEdge {
  source_node_id: string;
  target_node_id: string;
}

/** Per-node slice of the assembled adaptive model */
export interface AdaptiveNodeSnapshot {
  node_id: string;
  clo_id: string;
  topic_id: string;
  node_type: string;
  learning_intent: string;
  risk_level: RiskLevel;
  // Adaptivity fields
  required_status: RequiredStatus;
  skipping_eligibility: SkippingEligibility;
  skip_conditions: string;
  prerequisite_nodes: string[];
  // Stage 3 logic (if present)
  has_stage3_logic: boolean;
  gate_strictness?: GateStrictness;
  mastery_threshold?: 'full' | 'partial' | 'flexible';
  blocks_downstream?: boolean;
  failure_type_count: number;
  remediation_path_count: number;
  preknowledge_eligible?: boolean;
  // Stage 4 artifact presence
  has_diagnostic_assessment: boolean;
  has_llm_interactive_spec: boolean;
  has_remediation_pack: boolean;
  has_instructional_package: boolean;
  has_modality_plan: boolean;
  time_on_task_minutes: number;
}

/** Course-level assembled adaptive model */
export interface AdaptiveCourseModel {
  course_code: string;
  title: string;
  credit_hours: number;
  clo_count: number;
  node_count: number;
  // Graph
  nodes: AdaptiveNodeSnapshot[];
  edges: AdaptiveEdge[];
  // Summative assessment presence
  has_summative_pack: boolean;
  summative_total_weight: number;
  summative_clo_coverage: { clo_id: string; status: 'full' | 'partial' | 'none' }[];
  // Workload
  total_workload_minutes: number;
  expected_hours: number;
  // Metadata
  assembled_at: string;
}

// ---------------------------------------------------------------------------
// Validation violation & check result shapes
// ---------------------------------------------------------------------------

export type Stage5ASeverity = 'error' | 'warning' | 'info';

export type Stage5ACheckCategory =
  | 'adaptive_path_integrity'
  | 'mastery_protection'
  | 'diagnostic_explainability'
  | 'assessment_trigger_accuracy'
  | 'workload_accumulation';

export interface Stage5AViolation {
  violation_id: string;
  category: Stage5ACheckCategory;
  severity: Stage5ASeverity;
  message: string;
  affected_node_ids?: string[];
  affected_clo_ids?: string[];
  details?: Record<string, unknown>;
}

export interface Stage5ACheckResult {
  check_id: string;
  check_name: string;
  category: Stage5ACheckCategory;
  passed: boolean;
  message: string;
  violations: Stage5AViolation[];
}

// ---------------------------------------------------------------------------
// Stage 5A Validation Report (persisted output)
// ---------------------------------------------------------------------------

export interface Stage5AReportSummary {
  total_checks: number;
  passed_checks: number;
  failed_checks: number;
  total_violations: number;
  error_count: number;
  warning_count: number;
  info_count: number;
}

export interface Stage5AGraphSummary {
  total_nodes: number;
  total_edges: number;
  root_nodes: number;           // Nodes with 0 prerequisites
  leaf_nodes: number;           // Nodes with 0 dependents
  orphan_nodes: number;         // Unreachable nodes
  max_depth: number;            // Longest path in the DAG
}

export interface Stage5AWorkloadBounds {
  max_path_minutes: number;     // All nodes completed
  min_path_minutes: number;     // All skippable nodes skipped
  expected_minutes: number;     // credit_hours * 15 * 60
  max_deviation_percent: number;
  min_deviation_percent: number;
}

export interface Stage5AValidationReport {
  course_code: string;
  is_valid: boolean;            // true only if 0 errors
  // Summaries
  summary: Stage5AReportSummary;
  graph_summary: Stage5AGraphSummary;
  workload_bounds: Stage5AWorkloadBounds;
  // Detailed results
  checks: Stage5ACheckResult[];
  // All violations (flattened for easy filtering)
  all_violations: Stage5AViolation[];
  // Metadata
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Learner Path Simulation (optional Stage 5A add-on)
// ---------------------------------------------------------------------------

export interface SimulatedLearnerPath {
  path_id: string;
  strategy: 'complete_all' | 'skip_all_eligible' | 'random';
  nodes_visited: string[];
  nodes_skipped: string[];
  total_minutes: number;
  mastery_violations: string[];   // Node IDs where mastery was bypassed
  is_valid: boolean;
}
