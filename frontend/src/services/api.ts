import { withAccessToken } from './authToken';

const API_BASE = '/api';

// ============================================================================
// Auth + Users (RBAC)
// ============================================================================

export type UserRole = 'admin' | 'professor' | 'student';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  title?: string;
  department?: string;
  bio?: string;
  phone?: string;
  avatar_url?: string | null;
}

export interface ManagedUser extends AuthUser {
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Login failed');
  return data as LoginResult;
}

export async function fetchMe(): Promise<AuthUser> {
  const response = await fetch(`${API_BASE}/auth/me`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to load profile');
  return data.user as AuthUser;
}

// ============================================================================
// Self-service profile
// ============================================================================

export interface ProfileUpdate {
  name?: string;
  email?: string;
  title?: string;
  department?: string;
  bio?: string;
  phone?: string;
}

export async function updateProfile(patch: ProfileUpdate): Promise<AuthUser> {
  const response = await fetch(`${API_BASE}/auth/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to update profile');
  return data.user as AuthUser;
}

export async function uploadAvatar(file: File): Promise<AuthUser> {
  const form = new FormData();
  form.append('avatar', file);
  const response = await fetch(`${API_BASE}/auth/avatar`, { method: 'POST', body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to upload avatar');
  return data.user as AuthUser;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to change password');
}

/** Resolve a user's avatar URL into an authenticated, loadable <img> src. */
export function avatarSrc(avatarUrl?: string | null): string | null {
  if (!avatarUrl) return null;
  return withAccessToken(avatarUrl);
}

// ============================================================================
// Peer-to-peer review requests
// ============================================================================

export interface ReviewParty {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

export interface ReviewRequest {
  id: string;
  course_code: string;
  course_title: string;
  requester_id: string;
  reviewer_id: string;
  status: 'pending' | 'accepted' | 'declined';
  message: string;
  created_at: string;
  responded_at: string | null;
  requester?: ReviewParty | null;
  reviewer?: ReviewParty | null;
}

export async function listReviewRequests(
  direction: 'incoming' | 'outgoing'
): Promise<ReviewRequest[]> {
  const response = await fetch(`${API_BASE}/review-requests?direction=${direction}`);
  const data = await response.json().catch(() => ([]));
  if (!response.ok) throw new Error((data as any).error || 'Failed to load review requests');
  return data as ReviewRequest[];
}

export async function createReviewRequest(input: {
  course_code: string;
  reviewer_id: string;
  message?: string;
}): Promise<ReviewRequest> {
  const response = await fetch(`${API_BASE}/review-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to create review request');
  return data as ReviewRequest;
}

export async function respondReviewRequest(
  id: string,
  action: 'accept' | 'decline'
): Promise<void> {
  const response = await fetch(`${API_BASE}/review-requests/${encodeURIComponent(id)}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to respond to review request');
}

export async function fetchReviewCandidates(courseCode: string): Promise<ReviewParty[]> {
  const response = await fetch(
    `${API_BASE}/review-requests/candidates?course_code=${encodeURIComponent(courseCode)}`
  );
  const data = await response.json().catch(() => ([]));
  if (!response.ok) throw new Error((data as any).error || 'Failed to load candidates');
  return data as ReviewParty[];
}

export async function listUsers(): Promise<ManagedUser[]> {
  const response = await fetch(`${API_BASE}/users`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to list users');
  return data.users as ManagedUser[];
}

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
  role: UserRole;
}): Promise<ManagedUser> {
  const response = await fetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to create user');
  return data.user as ManagedUser;
}

export async function setUserActive(id: string, isActive: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/users/${encodeURIComponent(id)}/active`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: isActive }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to update user');
}

export async function resetUserPassword(id: string, password: string): Promise<void> {
  const response = await fetch(`${API_BASE}/users/${encodeURIComponent(id)}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to reset password');
}

export interface CourseAccess {
  owner_user_id: string | null;
  reviewer_ids: string[];
  student_ids: string[];
}

export async function fetchCourseAccess(code: string): Promise<CourseAccess> {
  const response = await fetch(`${API_BASE}/users/courses/${encodeURIComponent(code)}/access`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to load course access');
  return data as CourseAccess;
}

export async function setCourseOwner(code: string, ownerUserId: string | null): Promise<void> {
  const response = await fetch(`${API_BASE}/users/courses/${encodeURIComponent(code)}/owner`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_user_id: ownerUserId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to set course owner');
}

export async function assignReviewer(code: string, professorId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/users/courses/${encodeURIComponent(code)}/reviewers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ professor_id: professorId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to assign reviewer');
}

export async function removeReviewer(code: string, professorId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/users/courses/${encodeURIComponent(code)}/reviewers/${encodeURIComponent(professorId)}`,
    { method: 'DELETE' }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to remove reviewer');
}

export async function assignStudent(code: string, studentId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/users/courses/${encodeURIComponent(code)}/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student_id: studentId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to assign student');
}

export async function removeStudent(code: string, studentId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/users/courses/${encodeURIComponent(code)}/students/${encodeURIComponent(studentId)}`,
    { method: 'DELETE' }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to remove student');
}

// Types
export interface CourseListItem {
  course_code: string;
  title: string;
  current_stage: number;
  created_at: string;
  updated_at: string;
  access?: 'owner' | 'reviewer' | 'admin';
}

export interface CLO {
  clo_id: string;
  clo_text: string;
  capability_statement: string;
  conditions_of_performance: string;
  evidence_of_mastery: string;
  bloom_level: string;
  knowledge_type: string;
  risk_level: string;
}

// Canonical Node Types (Stage 2)
export type NodeType = 'concept' | 'principle' | 'procedure' | 'application' | 'metacognitive' | 'transfer';
export const CANONICAL_NODE_TYPES: NodeType[] = ['concept', 'principle', 'procedure', 'application', 'metacognitive', 'transfer'];

// Skipping eligibility
export type SkippingEligibility = 'non_skippable' | 'conditionally_skippable' | 'skippable' | 'not_applicable';
export type RequiredStatus = 'mandatory' | 'optional';

export interface LearningNode {
  node_id: string;
  clo_id: string;
  topic_id: string;
  topic_title?: string;
  node_type: string;
  learning_intent: string;
  prerequisite_nodes: string[];
  risk_level: string;
  mandatory: boolean;
  skippable: boolean;
  required_status: RequiredStatus;
  skipping_eligibility: SkippingEligibility;
  skip_conditions: string;
  failure_meaning: string;
  diagnostic_intent: string;
  // Stage 3 assessment intelligence
  stage3_logic_json?: string;
  stage3_preknowledge_eligible?: boolean;
  stage3_gate_strictness?: 'strict' | 'flexible';
  content_path?: string;
  // UI position (Stage 2.5 editor)
  ui_x?: number;
  ui_y?: number;
}

// ============================================================================
// STAGE 3 — Assessment Intelligence Types
// ============================================================================

export type GateStrictness = 'strict' | 'flexible';

export interface FailureType {
  id: string;
  description: string;
  misconception_category: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ObservableSignal {
  id: string;
  description: string;
  failure_type_ids: string[];
  signal_type: string;
}

export interface RemediationPath {
  id: string;
  failure_type_id: string;
  strategy: string;
  description: string;
  target_node_id?: string;
}

export interface ProgressionRules {
  mastery_definition: string;
  mastery_threshold: 'full' | 'partial' | 'flexible';
  gate_strictness: GateStrictness;
  blocks_downstream: boolean;
  rationale: string;
}

export interface PreknowledgeCheckLogic {
  eligible: boolean;
  reasoning_based: boolean;
  check_description: string;
  high_risk_override: boolean;
  explainability_note: string;
}

export interface Stage3NodeLogic {
  node_id: string;
  diagnostic_intent: string;
  failure_types: FailureType[];
  observable_signals: ObservableSignal[];
  remediation_paths: RemediationPath[];
  progression_rules: ProgressionRules;
  preknowledge_check_logic: PreknowledgeCheckLogic;
  required_status: RequiredStatus;
  skipping_eligibility: SkippingEligibility;
  skip_conditions: string;
}

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
  missing_elements: string[];
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
  node_type: string;
  learning_intent: string;
  risk_level: string;
  failure_meaning?: string;
  diagnostic_intent?: string;
  topic_id?: string;
  ui_x?: number;
  ui_y?: number;
}

// Weekly plan item with CLO mapping
export interface WeeklyPlanItem {
  week: number;
  topic: string;
  description: string;
  readings?: string;
  clo_ids?: string[];
}

// CLO Distribution statistics
export interface CLODistributionStat {
  clo_id: string;
  clo_text: string;
  weeks_covered: number[];
  count: number;
  is_fair: boolean;
}

export interface CLODistribution {
  total_weeks: number;
  total_clos: number;
  ideal_weeks_per_clo: number;
  min_acceptable: number;
  max_acceptable: number;
  per_clo: CLODistributionStat[];
  overall_is_fair: boolean;
  mapped_weeks: number;
  unmapped_weeks: number[];
  computed_at: string;
}

// AI-suggested weekly plan types (from deep textbook research) — LEGACY, kept for migration
export interface ResolvedTextbook {
  title?: string;
  authors?: string[];
  edition?: string;
  isbn?: string;
}

export interface SuggestedWeeklyPlanItem {
  week: number;
  topic: string;
  description: string;
  readings: string;
  clo_ids: string[];
  rationale: string;
}

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

// Topics grouped by CLO
export interface CloTopicGroup {
  clo_id: string;
  topics: TopicItem[];
}

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

// CLO Topic Coverage statistics
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
  all_clos_covered: boolean;
  computed_at: string;
}

// Stage 1 Layer 2 — CLO refinement
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

export interface SuggestedCloRefinement {
  clo_id: string;
  official_clo: string;
  council_feedback_summary: CouncilFeedbackSummary;
  full_council_analysis: FullCouncilAnalysis;
  ai_suggested_refined_clo: string;
  refinement_rationale: string[];
}

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

export interface CloRefinementReviewSummary {
  total_clos: number;
  pending_count: number;
  approved_count: number;
  needs_revision_count: number;
  all_approved: boolean;
}

export interface CloRefinementsResponse {
  clos: CLO[];
  suggestions: SuggestedCloRefinement[];
  refinements: CloRefinementItem[];
  summary: CloRefinementReviewSummary;
  layer2GeneratedAt?: string;
}

// ---- Layer 3: Assessment Redesign ----
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

export interface SuggestedAssessmentRedesign {
  assessment_id: string;
  original_assessment: OriginalAssessment;
  council_summary: CouncilAssessmentSummary;
  ai_suggested_redesign: AiSuggestedRedesign;
  full_council_analysis: FullAssessmentCouncilAnalysis;
  redesign_rationale: string[];
}

export interface AssessmentRedesignItem extends SuggestedAssessmentRedesign {
  sme_decision: AssessmentSmeDecision;
  final_assessment_for_maestro: FinalAssessmentForMaestro;
  sme_internal_note?: string;
  approval_status: CloApprovalStatus;
}

export interface AssessmentRedesignReviewSummary {
  total_assessments: number;
  pending_count: number;
  approved_count: number;
  needs_revision_count: number;
  all_approved: boolean;
}

export interface AssessmentRedesignsResponse {
  suggestions: SuggestedAssessmentRedesign[];
  redesigns: AssessmentRedesignItem[];
  summary: AssessmentRedesignReviewSummary;
  layer3GeneratedAt?: string;
}

// ---- Layer 4: Assessment Structure, Weighting and Rubric ----
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

export interface AssessmentProgressionItem {
  assessment_id: string;
  role_in_progression: string;
}

export interface WeightEntry {
  assessment_id: string;
  current_weight: string;
  proposed_weight: string;
  selected_weight: string;
  approved_weight?: string | null;
  change_type: WeightChangeType;
}

export interface CourseLevelWeightingSummary {
  current_total_weight: string;
  proposed_total_weight: string;
  selected_total_weight: string;
  weight_decision: WeightDecision;
  step_1_approved: boolean;
  weights_valid: boolean;
  approved_at?: string | null;
  weighting_rationale: string;
  assessment_progression_overview: AssessmentProgressionItem[];
  weights: WeightEntry[];
}

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

export interface Layer4FinalAssessmentRef {
  title: string;
  description: string;
  required_artifact: string;
  refined_clo_alignment: string[];
  suggested_evaluation_criteria: string[];
}

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

export interface WeightingRubricResponse {
  course_level_weighting_summary: CourseLevelWeightingSummary;
  assessment_structure_reviews: AssessmentStructureReview[];
  full_assessment_structure_report?: string;
  summary: WeightingRubricReviewSummary;
  layer4GeneratedAt?: string;
}

export interface SaveWeightingRubricResult {
  course_level_weighting_summary: CourseLevelWeightingSummary;
  assessment_structure_reviews: AssessmentStructureReview[];
  summary: WeightingRubricReviewSummary;
}

// Layer 5 — Assessment Integrity and Active AI Use
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

export interface AiUseFrameworkItem {
  ai_use_category: string;
  meaning: string;
  allowed_status: AiUseAllowedStatus;
  disclosure_required: boolean;
}

export interface CourseLevelIntegritySummary {
  overall_integrity_position: string;
  main_strengths: string[];
  main_risks: string[];
  sme_attention_points: string[];
  ai_use_framework: AiUseFrameworkItem[];
  full_integrity_report: string;
}

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

export interface IntegrityReviewReviewSummary {
  total_assessments: number;
  pending_count: number;
  approved_count: number;
  needs_revision_count: number;
  all_approved: boolean;
}

export interface IntegrityReviewResponse {
  course_level_integrity_summary: CourseLevelIntegritySummary;
  assessment_integrity_reviews: AssessmentIntegrityReview[];
  summary: IntegrityReviewReviewSummary;
  layer5GeneratedAt?: string;
}

export interface SaveIntegrityReviewResult {
  course_level_integrity_summary: CourseLevelIntegritySummary;
  assessment_integrity_reviews: AssessmentIntegrityReview[];
  summary: IntegrityReviewReviewSummary;
}

// ----------------------------------------------------------------------------
// Stage 1 Layer 6 — Self-Paced Subtopic Architecture
// ----------------------------------------------------------------------------

export type SubtopicLearningFunction =
  | 'foundational'
  | 'applied'
  | 'integrative'
  | 'bridge'
  | 'assessment_preparation';

export type SubtopicEffort = 'low' | 'moderate' | 'high';

export type SubtopicRecommendation = 'keep' | 'merge' | 'split' | 'move' | 'remove';

export type SubtopicDecision =
  | 'pending'
  | 'approved'
  | 'edited'
  | 'rejected'
  | 'needs_regeneration';

export interface SubtopicCrossCloLink {
  linked_clo_id: string;
  reason: string;
}

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

export interface SubtopicCloSection {
  clo_id: string;
  refined_clo: string;
  bloom_level: string;
  related_assessments: string[];
  clo_learning_journey_summary: string;
  reference_readings: string[];
  subtopics: ArchitectureSubtopic[];
}

export interface SubtopicArchitectureCourseSummary {
  course_title: string;
  total_refined_clos: number;
  total_subtopics: number;
  architecture_summary: string;
  source_evidence_note: string;
  full_report: string;
}

export interface SubtopicArchitectureReviewSummary {
  total_clos: number;
  total_subtopics: number;
  pending_count: number;
  approved_count: number;
  needs_revision_count: number;
  all_approved: boolean;
}

export interface SubtopicArchitectureResponse {
  course_summary: SubtopicArchitectureCourseSummary;
  clo_sections: SubtopicCloSection[];
  summary: SubtopicArchitectureReviewSummary;
  layer6GeneratedAt?: string;
}

export interface SaveSubtopicArchitectureResult {
  course_summary: SubtopicArchitectureCourseSummary;
  clo_sections: SubtopicCloSection[];
  summary: SubtopicArchitectureReviewSummary;
}

// Course confirmation gates
export interface CourseConfirmations {
  weekly_plan_confirmed_at?: string; // LEGACY
  weekly_plan_summary?: string; // LEGACY
  clo_topics_confirmed_at?: string; // New: confirms CLO topic coverage
  clo_topics_summary?: string;
  node_graph_confirmed_at?: string; // Stage 2.5: user edited node graph
  node_graph_summary?: string;
  graph_confirmed_at?: string; // Stage 3: adaptive logic graph confirmation
  graph_summary?: string;
}

export interface CourseDetail {
  course_code: string;
  title: string;
  description: string;
  credit_hours: number;
  current_stage: number;
  created_at: string;
  updated_at: string;
  clos: CLO[];
  nodes: LearningNode[];
  contract?: {
    course_metadata: {
      credits: number;
      hours: number;
      accreditation_tags: string[];
    };
    assessment_strategy: string;
  };
  snapshot?: {
    weekly_plan: WeeklyPlanItem[]; // LEGACY
    assessments: Array<{ name: string; type: string; weight: number; description: string }>;
    references: string[];
    clo_distribution?: CLODistribution; // LEGACY
    suggested_weekly_plan?: SuggestedWeeklyPlan; // LEGACY
    // New topic-per-CLO model
    clo_topics?: CloTopics;
    suggested_clo_topics?: SuggestedCloTopics;
    clo_topic_coverage?: CloTopicCoverage;
  };
  confirmations?: CourseConfirmations;
}

export interface GraphData {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    data: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
  }>;
}

export interface StageResult {
  success: boolean;
  stage: number;
  message: string;
  data?: unknown;
  error?: string;
}

// Council execution info for progress tracking
export interface CouncilInfo {
  mode: 'single' | 'council';
  memberCount: number;
  models: string[];
  chairmanModel: string;
  phase?: 'deliberating' | 'synthesizing' | 'consensus';
  activeModel?: string;
  completedModels?: string[];
}

// Progress tracking types
export interface ProgressUpdate {
  courseCode: string;
  stage: number;
  status: 'idle' | 'running' | 'completed' | 'error';
  step: string;
  current?: number;
  total?: number;
  itemId?: string;
  message?: string;
  error?: string;
  // Council execution details
  council?: CouncilInfo;
}

export type AIProvider = 'openrouter' | 'ollama' | 'openai';
export type StageExecutionMode = 'single' | 'council';

// Per-stage model configuration
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

// All stages configuration
export interface StageConfigs {
  stage1: StageModelConfig;
  stage2: StageModelConfig;
  stage3: StageModelConfig;
  stage4: StageModelConfig;
  stage5: StageModelConfig;
}

// Global council settings (prompts - shared across all stages)
export interface CouncilSettings {
  memberSystemPrompt: string;
  chairmanSystemPrompt: string;
}

// Legacy interfaces kept for backward compatibility
export interface CouncilConfig {
  councilModels: string[];
  chairmanModel: string;
  memberSystemPrompt: string;
  chairmanSystemPrompt: string;
}

// Per-stage execution settings (legacy)
export interface StageExecution {
  stage1: StageExecutionMode;
  stage2: StageExecutionMode;
  stage3: StageExecutionMode;
  stage4: StageExecutionMode;
  stage5: StageExecutionMode;
}

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
  // New per-stage model configuration
  stageConfigs: StageConfigs;
  // Global council settings (temperature, prompts)
  councilSettings: CouncilSettings;
  // Legacy fields (kept for backward compatibility)
  council: CouncilConfig;
  stageExecution: StageExecution;
  stage1Layers?: Stage1LayerConfig[];
}

export type Stage1LayerStatus =
  | 'not_started'
  | 'locked'
  | 'running'
  | 'generated'
  | 'needs_review'
  | 'approved'
  | 'needs_revision'
  | 'blocked';

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

export interface Stage1LayerStateView extends Stage1LayerState {
  config: Stage1LayerConfig;
  canRun: boolean;
  canApprove: boolean;
  canEdit: boolean;
  canRegenerate: boolean;
}

export interface Stage1LayersResponse {
  layers: Stage1LayerStateView[];
  allApproved: boolean;
  stage1Complete: boolean;
}

// API Functions
export async function fetchCourses(): Promise<CourseListItem[]> {
  const response = await fetch(`${API_BASE}/courses`);
  if (!response.ok) throw new Error('Failed to fetch courses');
  return response.json();
}

export async function fetchCourse(code: string): Promise<CourseDetail> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}`);
  if (!response.ok) throw new Error('Failed to fetch course');
  return response.json();
}

export async function createCourse(file: File): Promise<StageResult> {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch(`${API_BASE}/courses`, {
    method: 'POST',
    body: formData,
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create course');
  }
  return response.json();
}

export async function createCourseFromForm(data: {
  course_code: string;
  title: string;
  description: string;
  credit_hours: number;
  clos: string[];
  assessments?: Array<{ name: string; type: string; weight: number; description: string }>;
  references?: string[];
}): Promise<StageResult> {
  const response = await fetch(`${API_BASE}/courses/form`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create course');
  }
  return response.json();
}

export async function deleteCourse(code: string): Promise<void> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete course');
}

export async function runStage(
  code: string, 
  stage: number, 
  executionOverride?: StageExecutionMode
): Promise<StageResult> {
  const body = executionOverride ? { execution: executionOverride } : undefined;
  
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/stage/${stage}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to run stage');
  }
  return response.json();
}

export async function fetchGraphData(code: string): Promise<GraphData> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/graph`);
  if (!response.ok) throw new Error('Failed to fetch graph data');
  return response.json();
}

export async function fetchNodeContent(code: string, nodeId: string): Promise<{ node_id: string; content: string }> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/nodes/${encodeURIComponent(nodeId)}/content`);
  if (!response.ok) throw new Error('Failed to fetch node content');
  return response.json();
}

export function getDownloadUrl(code: string, type: 'pdf' | 'zip' = 'pdf'): string {
  return `${API_BASE}/courses/${encodeURIComponent(code)}/download${type === 'zip' ? '/zip' : ''}`;
}

// Settings API
export async function fetchSettings(): Promise<Settings> {
  const response = await fetch(`${API_BASE}/settings`);
  if (!response.ok) throw new Error('Failed to fetch settings');
  return response.json();
}

export async function fetchRawSettings(): Promise<Settings> {
  const response = await fetch(`${API_BASE}/settings/raw`);
  if (!response.ok) throw new Error('Failed to fetch settings');
  return response.json();
}

export async function updateSettings(settings: Partial<Settings>): Promise<{ message: string; settings: Settings; warning?: string }> {
  const response = await fetch(`${API_BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update settings');
  }
  return response.json();
}

export async function testNeo4jConnection(): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/settings/test-neo4j`, { method: 'POST' });
  return response.json();
}

export async function testOpenRouterConnection(apiKey?: string, baseUrl?: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/settings/test-openrouter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, baseUrl }),
  });
  return response.json();
}

export async function testOllamaConnection(): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/settings/test-ollama`, { method: 'POST' });
  return response.json();
}

export async function testOpenAIConnection(apiKey?: string, baseUrl?: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/settings/test-openai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, baseUrl }),
  });
  return response.json();
}

export interface EmbeddingHealth {
  ok: boolean;
  provider: string;
  model: string;
  configuredDimensions: number;
  liveDimensions: number;
  providerConfigured: boolean;
  error?: string;
  checkedAt: string;
}

/** Live embedding/RAG provider probe — surfaces silent grounding failures. */
export async function fetchEmbeddingHealth(): Promise<EmbeddingHealth> {
  const response = await fetch(`${API_BASE}/settings/embedding-health`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to check embedding health');
  return data;
}

// Recommended prompts interface (from backend defaults)
export interface RecommendedPrompts {
  global: {
    memberSystemPrompt: string;
    chairmanSystemPrompt: string;
  };
  stages: {
    [key: string]: {
      memberSystemPrompt: string;
      chairmanSystemPrompt: string;
      taskPrompt?: string;
      taskPrompt2?: string; // Only for stage1 (CLO Analysis prompt)
    };
  };
}

// Fetch recommended system prompts from the backend
export async function fetchRecommendedPrompts(): Promise<RecommendedPrompts> {
  const response = await fetch(`${API_BASE}/settings/recommended-prompts`);
  if (!response.ok) throw new Error('Failed to fetch recommended prompts');
  const data = await response.json();
  return data.data;
}

// Unified model interface (works for both OpenRouter and Ollama)
export interface AIModel {
  id: string;
  name: string;
  shortName?: string;
  description: string;
  contextLength: number;
  maxOutput: number;
  promptPrice: number;
  completionPrice: number;
  isFree: boolean;
  provider: string;
  modality: string;
}

// Legacy alias for backward compatibility
export type OpenRouterModel = AIModel;

export async function fetchOpenRouterModels(): Promise<AIModel[]> {
  const response = await fetch(`${API_BASE}/settings/models`);
  if (!response.ok) throw new Error('Failed to fetch OpenRouter models');
  return response.json();
}

export async function fetchOllamaModels(): Promise<AIModel[]> {
  const response = await fetch(`${API_BASE}/settings/models/ollama`);
  if (!response.ok) throw new Error('Failed to fetch Ollama models');
  return response.json();
}

export async function fetchOpenAIModels(): Promise<AIModel[]> {
  const response = await fetch(`${API_BASE}/settings/models/openai`);
  if (!response.ok) throw new Error('Failed to fetch OpenAI models');
  return response.json();
}

// Fetch models based on current provider
export async function fetchAvailableModels(provider: AIProvider = 'openrouter'): Promise<AIModel[]> {
  if (provider === 'ollama') {
    return fetchOllamaModels();
  }
  if (provider === 'openai') {
    return fetchOpenAIModels();
  }
  return fetchOpenRouterModels();
}

// Progress tracking API

/**
 * Fetch current progress for a course (polling fallback)
 */
export async function fetchProgress(code: string): Promise<ProgressUpdate> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/progress`);
  if (!response.ok) throw new Error('Failed to fetch progress');
  return response.json();
}

// ============================================================================
// Weekly Plan Mapping API
// ============================================================================

export interface WeeklyPlanMappingUpdate {
  week: number
  clo_ids: string[]
}

/**
 * Save user-edited CLO-to-week mappings
 */
export async function saveWeeklyPlanMapping(
  code: string, 
  mappings: WeeklyPlanMappingUpdate[]
): Promise<{
  message: string
  weekly_plan: WeeklyPlanItem[]
  clo_distribution: CLODistribution
}> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/weekly-plan/mapping`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mappings }),
  })
  if (!response.ok) {
    // Try to parse as JSON, fallback to status text if not JSON
    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to save weekly plan mapping')
    } else {
      throw new Error(`Server error: ${response.status} ${response.statusText}`)
    }
  }
  return response.json()
}

// ============================================================================
// CLO Week Suggestions API (Deep Research) — LEGACY
// ============================================================================

/**
 * Generate AI-powered CLO week suggestions using OpenAI deep research
 * Returns immediately; progress is tracked via SSE
 * @deprecated Use generateSuggestedCloTopics instead
 */
export async function generateSuggestedWeeklyPlan(
  code: string
): Promise<{ message: string; status: string }> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/weekly-plan/suggest-clo-weeks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to generate suggested weekly plan')
    } else {
      throw new Error(`Server error: ${response.status} ${response.statusText}`)
    }
  }
  return response.json()
}

// ============================================================================
// CLO Topics API (replaces weekly plan mapping)
// ============================================================================

/**
 * Save user-edited CLO topics
 */
export async function saveCloTopics(
  code: string,
  cloTopics: CloTopics
): Promise<{
  message: string
  clo_topics: CloTopics
  clo_topic_coverage: CloTopicCoverage
}> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/clo-topics`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clo_topics: cloTopics }),
  })
  if (!response.ok) {
    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to save CLO topics')
    } else {
      throw new Error(`Server error: ${response.status} ${response.statusText}`)
    }
  }
  return response.json()
}

/**
 * Generate AI-powered CLO topic suggestions using OpenAI deep research
 * Returns immediately; progress is tracked via SSE
 */
export async function generateSuggestedCloTopics(
  code: string
): Promise<{ message: string; status: string }> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/clo-topics/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to generate suggested CLO topics')
    } else {
      throw new Error(`Server error: ${response.status} ${response.statusText}`)
    }
  }
  return response.json()
}

/**
 * Confirm CLO topic coverage to unlock Stage 2
 */
export async function fetchStage1Layers(code: string): Promise<Stage1LayersResponse> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/stage1/layers`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch Stage 1 layers');
  }
  return response.json();
}

export async function runStage1Layer(
  code: string,
  layerId: string,
  execution?: StageExecutionMode
): Promise<{ success: boolean; layers: Stage1LayerStateView[]; layer: Stage1LayerState }> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/layers/${encodeURIComponent(layerId)}/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(execution ? { execution } : {}),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to run layer');
  return data;
}

export async function approveStage1Layer(
  code: string,
  layerId: string
): Promise<{ layers: Stage1LayerStateView[]; allApproved: boolean }> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/layers/${encodeURIComponent(layerId)}/approve`,
    { method: 'POST' }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to approve layer');
  return data;
}

export async function rejectStage1Layer(
  code: string,
  layerId: string
): Promise<{ layers: Stage1LayerStateView[] }> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/layers/${encodeURIComponent(layerId)}/reject`,
    { method: 'POST' }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to reject layer');
  return data;
}

export async function fetchCloRefinements(code: string): Promise<CloRefinementsResponse> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/clo-refinements`
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch CLO refinements');
  }
  return response.json();
}

export async function saveCloRefinements(
  code: string,
  items: CloRefinementItem[]
): Promise<{ refinements: CloRefinementItem[]; summary: CloRefinementReviewSummary }> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/clo-refinements`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save CLO refinements');
  }
  return response.json();
}

export async function fetchAssessmentRedesigns(
  code: string
): Promise<AssessmentRedesignsResponse> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/assessment-redesigns`
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch assessment redesigns');
  }
  return response.json();
}

export async function saveAssessmentRedesigns(
  code: string,
  items: AssessmentRedesignItem[]
): Promise<{ redesigns: AssessmentRedesignItem[]; summary: AssessmentRedesignReviewSummary }> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/assessment-redesigns`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save assessment redesigns');
  }
  return response.json();
}

export async function saveCourseReferences(
  code: string,
  references: string[]
): Promise<{ references: string[] }> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/references`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ references }),
    }
  )
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to save references')
  }
  return response.json()
}

export async function fetchWeightingRubric(
  code: string
): Promise<WeightingRubricResponse> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/weighting-rubric`
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch weighting rubric');
  }
  return response.json();
}

export async function saveWeightingRubric(
  code: string,
  payload: {
    courseLevelWeightingSummary: CourseLevelWeightingSummary;
    assessmentStructureReviews: AssessmentStructureReview[];
    fullAssessmentStructureReport?: string;
  }
): Promise<SaveWeightingRubricResult> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/weighting-rubric`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save weighting rubric');
  }
  return response.json();
}

export async function fetchIntegrityReview(
  code: string
): Promise<IntegrityReviewResponse> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/integrity-review`
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch integrity review');
  }
  return response.json();
}

export async function saveIntegrityReview(
  code: string,
  payload: {
    courseLevelIntegritySummary: CourseLevelIntegritySummary;
    assessmentIntegrityReviews: AssessmentIntegrityReview[];
  }
): Promise<SaveIntegrityReviewResult> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/integrity-review`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save integrity review');
  }
  return response.json();
}

export async function fetchSubtopicArchitecture(
  code: string
): Promise<SubtopicArchitectureResponse> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/subtopic-architecture`
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch subtopic architecture');
  }
  return response.json();
}

export async function saveSubtopicArchitecture(
  code: string,
  payload: {
    courseSummary: SubtopicArchitectureCourseSummary;
    cloSections: SubtopicCloSection[];
  }
): Promise<SaveSubtopicArchitectureResult> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/subtopic-architecture`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save subtopic architecture');
  }
  return response.json();
}

export async function saveStage1LayerOutput(
  code: string,
  layerId: string,
  reportMarkdown: string
): Promise<{ layers: Stage1LayerStateView[] }> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/stage1/layers/${encodeURIComponent(layerId)}/output`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportMarkdown }),
    }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to save layer output');
  return data;
}

export async function confirmCloTopics(code: string): Promise<{ message: string; confirmations: CourseConfirmations }> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/confirm/clo-topics`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to confirm CLO topics');
  }
  return response.json();
}

// Confirmation API calls

/**
 * Confirm weekly plan distribution to unlock Stage 2
 */
export async function confirmWeeklyPlan(code: string): Promise<{ message: string; confirmations: CourseConfirmations }> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/confirm/weekly-plan`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to confirm weekly plan');
  }
  return response.json();
}

/**
 * Confirm graph structure to unlock Stage 4
 */
export async function confirmGraph(code: string): Promise<{ message: string; confirmations: CourseConfirmations }> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/confirm/graph`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to confirm graph');
  }
  return response.json();
}

// ============================================================================
// STAGE 3: Assessment Intelligence API
// ============================================================================

/**
 * Fetch Stage 3 assessment intelligence snapshot
 */
export async function fetchStage3Snapshot(code: string): Promise<Stage3Snapshot> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/stage/3/snapshot`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch Stage 3 snapshot');
  }
  return response.json();
}

/**
 * Fetch Stage 3 incomplete nodes report
 */
export async function fetchStage3IncompleteReport(code: string): Promise<Stage3IncompleteReport> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/stage/3/incomplete-report`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch Stage 3 incomplete report');
  }
  return response.json();
}

// ============================================================================
// STAGE 2.5: CLO Graph Editing API
// ============================================================================

/**
 * Get learning nodes for a specific CLO
 */
export async function fetchCloNodes(code: string, cloId: string): Promise<{
  clo_id: string;
  nodes: LearningNode[];
  node_count: number;
}> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/clos/${encodeURIComponent(cloId)}/nodes`
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch CLO nodes');
  }
  return response.json();
}

/**
 * Upsert/delete nodes for a CLO (Stage 2.5)
 */
export async function saveCloNodes(
  code: string,
  cloId: string,
  payload: {
    upserts?: LearningNodeUpsert[];
    deletes?: string[];
  }
): Promise<{
  message: string;
  clo_id: string;
  created: Record<string, string>;
  deleted: string[];
}> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/clos/${encodeURIComponent(cloId)}/nodes`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save CLO nodes');
    }
    throw new Error(`Server error (${response.status}): Backend may not be running. Please check that the server is started.`);
  }
  return response.json();
}

/**
 * Save prerequisites for a CLO (Stage 2.5)
 */
export async function saveCloPrerequisites(
  code: string,
  cloId: string,
  edges: Array<{ source_node_id: string; target_node_id: string }>
): Promise<{
  message: string;
  clo_id: string;
  edge_count: number;
}> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/clos/${encodeURIComponent(cloId)}/prerequisites`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edges }),
    }
  );
  if (!response.ok) {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save prerequisites');
    }
    throw new Error(`Server error (${response.status}): Backend may not be running. Please check that the server is started.`);
  }
  return response.json();
}

/**
 * Confirm node graph structure to unlock Stage 3
 */
export async function confirmNodeGraph(code: string): Promise<{
  message: string;
  confirmations: CourseConfirmations;
  summary: {
    total_nodes: number;
    clo_count: number;
    edge_count: number;
    nodes_per_clo: Record<string, number>;
  };
}> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/confirm/node-graph`,
    { method: 'POST' }
  );
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to confirm node graph');
  }
  return response.json();
}

/**
 * Subscribe to real-time progress updates via SSE
 * Returns a Promise that resolves to an unsubscribe function when connected
 */
export function subscribeToProgress(
  code: string,
  onProgress: (update: ProgressUpdate) => void,
  onError?: (error: Event) => void
): Promise<() => void> {
  return new Promise((resolve) => {
    const eventSource = new EventSource(
      withAccessToken(`${API_BASE}/courses/${encodeURIComponent(code)}/progress/stream`)
    );
    
    eventSource.onopen = () => {
      console.log('SSE connection established for course:', code);
      // Resolve with unsubscribe function once connected
      resolve(() => {
        eventSource.close();
      });
    };
    
    eventSource.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data) as ProgressUpdate;
        onProgress(update);
      } catch (e) {
        console.error('Failed to parse progress update:', e);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      if (onError) {
        onError(error);
      }
      // Still resolve so we don't hang forever
      resolve(() => {
        eventSource.close();
      });
    };
  });
}

// ============================================================================
// STAGE 4 ENHANCED TYPES - Content Pack, Assessments, Videos, Rubric, Workload
// ============================================================================

export type ContentModality = 'text' | 'visual' | 'video' | 'interactive' | 'reflection';
export type VideoScriptType = 'explainer' | 'walkthrough' | 'demonstration' | 'feedback';
export type Stage4AssessmentType = 'pre_knowledge' | 'formative_diagnostic' | 'mastery_evidence';
export type WorkloadAlignmentStatus = 'aligned' | 'under' | 'over';

export interface VideoSection {
  section_number: number;
  title: string;
  duration_seconds: number;
  narration: string;
  visual_description: string;
  on_screen_text?: string;
  transitions?: string;
}

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

export interface AssessmentQuestion {
  question_id: string;
  question_type: 'multiple_choice' | 'true_false' | 'short_answer' | 'scenario' | 'reflection';
  question_text: string;
  options?: string[];
  correct_answer?: string;
  rubric_criteria?: string;
  points: number;
  bloom_level: string;
  diagnostic_value: string;
}

export interface NodeAssessment {
  node_id: string;
  assessment_type: Stage4AssessmentType;
  title: string;
  description: string;
  questions: AssessmentQuestion[];
  adaptive_function: string;
  pass_threshold: number;
  time_limit_minutes?: number;
  instructions: string;
}

export interface VisualPrompt {
  prompt_id: string;
  node_id: string;
  prompt_type: 'diagram' | 'illustration' | 'infographic' | 'screenshot' | 'flowchart';
  description: string;
  purpose: string;
  placement: string;
  alt_text: string;
  style_notes?: string;
}

export interface Stage4NodeContent {
  node_id: string;
  clo_id: string;
  node_type: string;
  modalities: ContentModality[];
  instructional_content: string;
  learner_instructions: string;
  visual_prompts: VisualPrompt[];
  video_script?: VideoScript;
  assessments: NodeAssessment[];
  time_on_task_minutes: number;
  generated_at: string;
  content_version: string;
}

export interface NodeWorkload {
  node_id: string;
  clo_id: string;
  node_type: string;
  learning_intent: string;
  content_time_minutes: number;
  video_time_minutes: number;
  assessment_time_minutes: number;
  practice_time_minutes: number;
  total_time_minutes: number;
}

export interface WeeklyWorkload {
  week: number;
  topic: string;
  clo_ids: string[];
  node_count: number;
  total_time_minutes: number;
  total_time_hours: number;
  is_balanced: boolean;
}

export interface WorkloadMap {
  course_code: string;
  nodes: NodeWorkload[];
  weekly_workload: WeeklyWorkload[];
  total_content_hours: number;
  total_assessment_hours: number;
  total_hours: number;
  credit_hours: number;
  expected_hours: number;
  hours_per_credit: number;
  alignment_status: WorkloadAlignmentStatus;
  deviation_percentage: number;
  deviation_hours: number;
  is_valid: boolean;
  validation_notes: string[];
  computed_at: string;
}

export interface RubricLevel {
  level: number;
  label: string;
  description: string;
  points: number;
}

export interface RubricCriterion {
  criterion_id: string;
  description: string;
  weight: number;
  levels: RubricLevel[];
}

export interface CLORubricCriteria {
  clo_id: string;
  clo_text: string;
  bloom_level: string;
  criteria: RubricCriterion[];
}

export interface GradingLevel {
  grade: string;
  min_percentage: number;
  max_percentage: number;
  description: string;
}

export interface CourseRubric {
  course_code: string;
  title: string;
  clo_criteria: CLORubricCriteria[];
  grading_scale: GradingLevel[];
  marking_guide: string;
  learner_instructions: string;
  assessment_weights: {
    pre_knowledge: number;
    formative: number;
    mastery: number;
  };
  generated_at: string;
}

export interface Stage4ContentPack {
  course_code: string;
  title: string;
  total_nodes: number;
  nodes_with_content: number;
  nodes_with_video: number;
  total_assessments: number;
  total_visual_prompts: number;
  node_content_status: {
    node_id: string;
    has_content: boolean;
    has_video: boolean;
    has_assessments: boolean;
    assessment_types: Stage4AssessmentType[];
  }[];
  workload_summary: {
    total_hours: number;
    alignment_status: WorkloadAlignmentStatus;
    deviation_percentage: number;
  };
  has_rubric: boolean;
  is_complete: boolean;
  completion_percentage: number;
  missing_items: string[];
  generated_at: string;
}

export interface WorkloadValidation {
  course_code: string;
  credit_hours: number;
  expected_hours: number;
  actual_hours: number;
  alignment_status: WorkloadAlignmentStatus;
  deviation_percentage: number;
  deviation_hours: number;
  is_valid: boolean;
  validation_notes: string[];
}

export interface AllAssessmentsResponse {
  course_code: string;
  total_assessments: number;
  by_type: {
    pre_knowledge: (NodeAssessment & { node_learning_intent: string; node_type: string })[];
    formative_diagnostic: (NodeAssessment & { node_learning_intent: string; node_type: string })[];
    mastery_evidence: (NodeAssessment & { node_learning_intent: string; node_type: string })[];
  };
  summary: {
    pre_knowledge_count: number;
    formative_count: number;
    mastery_count: number;
  };
}

export interface AllVideoScriptsResponse {
  course_code: string;
  total_videos: number;
  total_duration_minutes: number;
  video_scripts: (VideoScript & { node_learning_intent: string; node_type: string })[];
}

// ============================================================================
// STAGE 4 ENHANCED API FUNCTIONS
// ============================================================================

/**
 * Fetch the full Stage 4 content pack summary for a course
 */
export async function fetchContentPack(code: string): Promise<Stage4ContentPack> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/stage/4/content-pack`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch content pack');
  }
  return response.json();
}

/**
 * Fetch the full content pack for a specific node
 */
export async function fetchNodeContentPack(code: string, nodeId: string): Promise<Stage4NodeContent> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/nodes/${encodeURIComponent(nodeId)}/content-pack`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch node content pack');
  }
  return response.json();
}

/**
 * Fetch assessments for a specific node
 */
export async function fetchNodeAssessments(code: string, nodeId: string): Promise<{
  node_id: string;
  assessment_count: number;
  assessments: NodeAssessment[];
}> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/nodes/${encodeURIComponent(nodeId)}/assessments`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch node assessments');
  }
  return response.json();
}

/**
 * Fetch video script for a specific node
 */
export async function fetchNodeVideoScript(code: string, nodeId: string): Promise<VideoScript> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/nodes/${encodeURIComponent(nodeId)}/video-script`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch video script');
  }
  return response.json();
}

/**
 * Fetch course rubric
 */
export async function fetchRubric(code: string): Promise<CourseRubric> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/rubric`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch rubric');
  }
  return response.json();
}

/**
 * Fetch workload map
 */
export async function fetchWorkloadMap(code: string): Promise<WorkloadMap> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/workload`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch workload map');
  }
  return response.json();
}

/**
 * Validate workload against credit hours
 */
export async function validateWorkload(code: string): Promise<WorkloadValidation> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/workload/validate`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to validate workload');
  }
  return response.json();
}

/**
 * Fetch learner instructions
 */
export async function fetchLearnerInstructions(code: string): Promise<{ course_code: string; instructions: string }> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/learner-instructions`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch learner instructions');
  }
  return response.json();
}

/**
 * Fetch all assessments for a course
 */
export async function fetchAllAssessments(code: string): Promise<AllAssessmentsResponse> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/assessments`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch assessments');
  }
  return response.json();
}

/**
 * Fetch all video scripts for a course
 */
export async function fetchAllVideoScripts(code: string): Promise<AllVideoScriptsResponse> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/video-scripts`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch video scripts');
  }
  return response.json();
}

// ============================================================================
// Reference Materials (RAG grounding)
// ============================================================================

export type ReferenceSourceType = 'textbook_chapter' | 'paper' | 'other';

export interface ReferenceDocument {
  doc_id: string;
  course_code: string;
  title: string;
  source_type: ReferenceSourceType;
  citation_label: string;
  scope: { clo_ids?: string[]; subtopic_ids?: string[] };
  original_filename: string;
  mime_type: string;
  uploaded_at: string;
  char_count: number;
  chunk_count: number;
  embedding_model: string;
  embedding_dimensions: number;
}

export interface RetrievedChunk {
  chunk_id: string;
  doc_id: string;
  text: string;
  citation: string;
  score: number;
  clo_ids: string[];
  subtopic_ids: string[];
}

export async function listReferences(code: string): Promise<ReferenceDocument[]> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/references`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to list reference materials');
  }
  const data = await response.json();
  return data.documents ?? [];
}

export async function uploadReference(
  code: string,
  file: File,
  meta: {
    title?: string;
    source_type?: ReferenceSourceType;
    citation_label?: string;
    clo_ids?: string[];
    subtopic_ids?: string[];
  } = {}
): Promise<ReferenceDocument> {
  const formData = new FormData();
  formData.append('file', file);
  if (meta.title) formData.append('title', meta.title);
  if (meta.source_type) formData.append('source_type', meta.source_type);
  if (meta.citation_label) formData.append('citation_label', meta.citation_label);
  if (meta.clo_ids?.length) formData.append('clo_ids', JSON.stringify(meta.clo_ids));
  if (meta.subtopic_ids?.length) formData.append('subtopic_ids', JSON.stringify(meta.subtopic_ids));

  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/references`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to upload reference material');
  }
  const data = await response.json();
  return data.document;
}

export async function uploadReferenceFromLink(
  code: string,
  url: string,
  meta: { title?: string; source_type?: ReferenceSourceType } = {}
): Promise<ReferenceDocument> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/references/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, ...meta }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to ingest reference link');
  }
  const data = await response.json();
  return data.document;
}

export async function deleteReference(code: string, docId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/references/${encodeURIComponent(docId)}`,
    { method: 'DELETE' }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to delete reference material');
  }
}

export async function retrieveReferences(
  code: string,
  query: string,
  opts: { cloId?: string; subtopicId?: string; topN?: number } = {}
): Promise<RetrievedChunk[]> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/references/retrieve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, ...opts }),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to retrieve reference passages');
  }
  const data = await response.json();
  return data.results ?? [];
}

// ============================================================================
// Reference Alignment — transition between Course Architect and the Node Engine
// ============================================================================

export type AlignmentStatus = 'locked' | 'no_references' | 'available' | 'proposed' | 'approved';

export interface AlignmentCandidate {
  id: string;
  label: string;
  score: number;
}

export interface AlignmentChunkMapping {
  chunk_id: string;
  doc_id: string;
  citation: string;
  text_preview: string;
  subtopic_candidates: AlignmentCandidate[];
  clo_candidates: AlignmentCandidate[];
  confidence: number;
  decided_subtopic_ids: string[];
  decided_clo_ids: string[];
  edited?: boolean;
}

export interface ReferenceAlignmentArtifact {
  course_code: string;
  status: AlignmentStatus;
  threshold: number;
  embedding_model: string;
  embedding_dimensions: number;
  subtopic_count: number;
  reference_doc_count: number;
  chunk_count: number;
  tagged_chunk_count: number;
  generated_at?: string;
  approved_at?: string;
  approved_by?: string;
  mappings: AlignmentChunkMapping[];
  lock_reason?: string;
}

export interface AlignmentStateSummary {
  status: AlignmentStatus;
  lock_reason?: string;
  subtopic_count: number;
  reference_doc_count: number;
  chunk_count: number;
  tagged_chunk_count: number;
  active_tagged_chunk_count: number;
  proposed_tagged_chunk_count?: number;
  threshold: number;
  generated_at?: string;
  approved_at?: string;
  approved_by?: string;
  corpus_updated_at?: string;
  is_stale: boolean;
  stale_reason?: string;
  pending_activation: boolean;
  node_gen_ready: boolean;
  per_document_tag_summary?: AlignmentDocTagSummary[];
}

export interface AlignmentDocTagSummary {
  doc_id: string;
  title: string;
  active_tagged_chunks: number;
  proposed_tagged_chunks?: number;
}

export interface AlignmentMappingEdit {
  chunk_id: string;
  subtopic_ids: string[];
  clo_ids?: string[];
}

export async function fetchAlignment(
  code: string
): Promise<{ state: AlignmentStateSummary; proposal: ReferenceAlignmentArtifact | null }> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/references/alignment`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to load reference alignment');
  return data;
}

export async function proposeAlignment(
  code: string,
  opts: { threshold?: number; maxCandidates?: number } = {}
): Promise<ReferenceAlignmentArtifact> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/references/alignment/propose`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opts) }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to propose alignment');
  return data.proposal;
}

export async function updateAlignmentMapping(
  code: string,
  edits: AlignmentMappingEdit[]
): Promise<ReferenceAlignmentArtifact> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/references/alignment/mapping`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edits }) }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to update alignment mapping');
  return data.proposal;
}

export async function approveAlignment(
  code: string,
  approver: string
): Promise<ReferenceAlignmentArtifact> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/references/alignment/approve`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approver }) }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to approve alignment');
  return data.proposal;
}

// ============================================================================
// Reference Coverage — read-only, per-CLO measurement of corpus adequacy
// ============================================================================

export type CoverageBand = 'well_covered' | 'partial' | 'not_covered';
export type CoverageVerdict = 'covered' | 'partial' | 'none';
export type CoverageStatus = 'locked' | 'no_references' | 'available' | 'computed';

export interface ReferenceCoverageThresholds {
  topK: number;
  relevanceFloor: number;
  minPassages: number;
  distributionMin: number;
}

export interface CoverageSignals {
  top_score: number;
  median_score: number;
  retrieved_count: number;
  supporting_count: number;
  distinct_sources: number;
}

export interface CoveragePassage {
  chunk_id: string;
  doc_id: string;
  citation: string;
  text_preview: string;
  score: number;
}

export type CoverageDocStrength = 'strong' | 'partial';

export interface CoverageDocRef {
  doc_id: string;
  title: string;
  strength: CoverageDocStrength;
}

export interface CoverageCloResult {
  clo_id: string;
  statement: string;
  /** Short 2-4 word label (statement-derived fallback when missing on older reports). */
  short_label: string;
  band: CoverageBand;
  /** Integer percentage derived from the top similarity signal (0-100). */
  coverage_pct: number;
  verdict: CoverageVerdict | null;
  evidence_gate_passed: boolean;
  signals: CoverageSignals;
  rationale: string;
  supporting_passages: CoveragePassage[];
  /** Supporting documents rolled up from supporting passages (strong-first). */
  covered_by: CoverageDocRef[];
  gaps: string[];
}

export interface CoverageSummary {
  total_clos: number;
  well_covered: number;
  partial: number;
  not_covered: number;
}

export interface ReferenceCoverageReport {
  course_code: string;
  status: CoverageStatus;
  thresholds: ReferenceCoverageThresholds;
  reference_doc_count: number;
  chunk_count: number;
  summary: CoverageSummary;
  clos: CoverageCloResult[];
  generated_at?: string;
  lock_reason?: string;
}

export interface CoverageStateSummary {
  status: CoverageStatus;
  lock_reason?: string;
  approved_clo_count: number;
  reference_doc_count: number;
  chunk_count: number;
  thresholds: ReferenceCoverageThresholds;
  summary?: CoverageSummary;
  generated_at?: string;
}

export type CoverageDirection = 'improved' | 'regressed' | 'unchanged';

export interface CoverageDeltaEntry {
  clo_id: string;
  from_band: CoverageBand | null;
  to_band: CoverageBand;
  direction: CoverageDirection;
}

export interface CoverageDelta {
  entries: CoverageDeltaEntry[];
  improved: number;
  regressed: number;
  unchanged: number;
}

export async function fetchCoverage(
  code: string
): Promise<{ state: CoverageStateSummary; report: ReferenceCoverageReport | null }> {
  const response = await fetch(`${API_BASE}/courses/${encodeURIComponent(code)}/references/coverage`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to load reference coverage');
  return data;
}

/**
 * Recompute coverage and return the new report plus a per-CLO before/after
 * `delta` (null on the first measurement, when there is no prior to diff).
 */
export async function computeCoverage(
  code: string
): Promise<{ report: ReferenceCoverageReport; delta: CoverageDelta | null }> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/references/coverage/compute`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to compute reference coverage');
  return { report: data.report, delta: data.delta ?? null };
}

// ----------------------------------------------------------------------------
// Reference Coverage — Phase C AI source suggestions.
// AI PROPOSES, SME APPROVES: these are candidate sources to verify, never
// auto-ingested. Approval routes through the EXISTING reference ingest path.
// ----------------------------------------------------------------------------

export interface CoverageSourceSuggestion {
  title: string;
  url: string;
  /** One sentence tying the source to the CLO's gap. */
  why: string;
  source_type: ReferenceSourceType;
}

/**
 * Ask the AI to propose candidate sources for ONE weak/uncovered CLO. Returns a
 * (possibly empty) list plus an optional `reason` when empty (fail-soft). Nothing
 * is ingested by this call — the SME approves each suggestion separately.
 */
export async function suggestSources(
  code: string,
  cloId: string
): Promise<{ suggestions: CoverageSourceSuggestion[]; reason?: string; clo_id: string }> {
  const response = await fetch(
    `${API_BASE}/courses/${encodeURIComponent(code)}/references/coverage/suggest-sources`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clo_id: cloId }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to suggest sources');
  return { suggestions: data.suggestions ?? [], reason: data.reason, clo_id: data.clo_id ?? cloId };
}

// ----------------------------------------------------------------------------
// Reference cross-referencing config — the numeric evidence-gate thresholds.
// ----------------------------------------------------------------------------

export interface ReferenceCoverageConfigFile {
  schema_version: number;
  updated_at: string;
  thresholds: ReferenceCoverageThresholds;
}

export async function fetchReferenceCoverageConfig(): Promise<ReferenceCoverageConfigFile> {
  const response = await fetch(`${API_BASE}/node-engine/reference-coverage-config`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to load reference coverage config');
  return data.config;
}

export async function updateReferenceCoverageConfig(
  thresholds: ReferenceCoverageThresholds
): Promise<ReferenceCoverageConfigFile> {
  const response = await fetch(`${API_BASE}/node-engine/reference-coverage-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thresholds }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to update reference coverage config');
  return data.config;
}

// ============================================================================
// Maestro Node Engine (M1/M2) — prompt template registry + status
// ============================================================================

export type NodeEngineVehicle =
  | 'text'
  | 'structured_visual'
  | 'pictorial_visual'
  | 'video'
  | 'interactive'
  | 'simulation'
  | 'learning_anchor';

export type PromptTemplateStatus = 'draft' | 'approved' | 'archived' | 'reserved';

export interface PromptTemplate {
  prompt_template_id: string;
  prompt_template_name: string;
  vehicle: NodeEngineVehicle;
  version: number;
  status: PromptTemplateStatus;
  generator_kind: 'chat' | 'image' | 'video';
  task_prompt: string;
  output_schema_ref: unknown;
  member_system_prompt?: string;
  chairman_system_prompt?: string;
  last_updated_by: string;
  last_updated_at: string;
  change_note: string;
}

export interface PromptTemplateRegistryEntry {
  prompt_template_id: string;
  vehicle: NodeEngineVehicle;
  active_version: number;
  versions: PromptTemplate[];
}

export interface NodeEngineStatus {
  engine: string;
  phase: number;
  legacy_stages_enabled: boolean;
  prompt_templates: {
    count: number;
    vehicles: NodeEngineVehicle[];
    updated_at: string;
  };
}

export async function fetchNodeEngineStatus(): Promise<NodeEngineStatus> {
  const response = await fetch(`${API_BASE}/node-engine/status`);
  if (!response.ok) throw new Error('Failed to fetch node engine status');
  return response.json();
}

export async function fetchPromptTemplates(): Promise<PromptTemplate[]> {
  const response = await fetch(`${API_BASE}/node-engine/prompt-templates`);
  if (!response.ok) throw new Error('Failed to fetch prompt templates');
  const data = await response.json();
  return data.templates ?? [];
}

export async function fetchPromptTemplate(id: string): Promise<PromptTemplateRegistryEntry> {
  const response = await fetch(`${API_BASE}/node-engine/prompt-templates/${encodeURIComponent(id)}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch prompt template');
  }
  return response.json();
}

export async function updatePromptTemplate(
  id: string,
  payload: {
    task_prompt?: string;
    member_system_prompt?: string;
    chairman_system_prompt?: string;
    status?: PromptTemplateStatus;
    last_updated_by: string;
    change_note: string;
  }
): Promise<{ message: string; template: PromptTemplate }> {
  const response = await fetch(`${API_BASE}/node-engine/prompt-templates/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update prompt template');
  }
  return response.json();
}

// ============================================================================
// HeyGen catalog (avatar looks + voices for Video render Settings)
// ============================================================================

export interface HeyGenAvatarLookOption {
  id: string;
  name: string;
  gender: string | null;
  avatar_type: string | null;
  preview_image_url: string | null;
  preview_video_url: string | null;
  default_voice_id: string | null;
  supported_api_engines: string[];
  tags: string[];
  group_id: string | null;
}

export interface HeyGenVoiceOption {
  voice_id: string;
  name: string;
  language: string | null;
  gender: string | null;
  type: string | null;
  preview_audio_url: string | null;
  support_pause: boolean;
  support_locale: boolean;
}

export interface HeyGenCatalogPage<T> {
  items: T[];
  has_more: boolean;
  next_token: string | null;
}

export async function fetchHeyGenCatalogStatus(apiKeyRef?: string): Promise<{
  configured: boolean;
  api_key_ref: string;
}> {
  const params = apiKeyRef ? `?api_key_ref=${encodeURIComponent(apiKeyRef)}` : '';
  const response = await fetch(`${API_BASE}/node-engine/heygen/catalog/status${params}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to read HeyGen status');
  return data;
}

/** HBMSU Avatar Library — configured in heygenApprovedAvatars.defaults.ts */
export async function fetchHeyGenApprovedAvatars(apiKeyRef?: string): Promise<{
  items: AvatarLibraryEntry[];
}> {
  const params = apiKeyRef ? `?api_key_ref=${encodeURIComponent(apiKeyRef)}` : '';
  const response = await fetch(`${API_BASE}/node-engine/heygen/approved-avatars${params}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to load HBMSU Avatar Library');
  return data;
}

export interface HeyGenAvatarCharacter {
  group_id: string;
  name: string;
  gender: string | null;
  default_voice_id: string | null;
  looks_count: number;
  preview_image_url: string | null;
  preview_video_url: string | null;
  preview_looks: HeyGenAvatarLookOption[];
}

export async function fetchHeyGenAvatarCharacters(options: {
  api_key_ref?: string;
  ownership?: 'public' | 'private';
  avatar_type?: 'studio_avatar' | 'digital_twin' | 'photo_avatar';
  limit?: number;
  token?: string;
} = {}): Promise<HeyGenCatalogPage<HeyGenAvatarCharacter>> {
  const params = new URLSearchParams();
  if (options.api_key_ref) params.set('api_key_ref', options.api_key_ref);
  if (options.ownership) params.set('ownership', options.ownership);
  if (options.avatar_type) params.set('avatar_type', options.avatar_type);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.token) params.set('token', options.token);
  const qs = params.toString();
  const response = await fetch(
    `${API_BASE}/node-engine/heygen/avatar-characters${qs ? `?${qs}` : ''}`
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to list HeyGen avatar characters');
  return data;
}

export async function fetchHeyGenCharacterLooks(
  groupId: string,
  options: {
    api_key_ref?: string;
    ownership?: 'public' | 'private';
    limit?: number;
    token?: string;
  } = {}
): Promise<HeyGenCatalogPage<HeyGenAvatarLookOption>> {
  const params = new URLSearchParams();
  if (options.api_key_ref) params.set('api_key_ref', options.api_key_ref);
  if (options.ownership) params.set('ownership', options.ownership);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.token) params.set('token', options.token);
  const qs = params.toString();
  const response = await fetch(
    `${API_BASE}/node-engine/heygen/avatar-characters/${encodeURIComponent(groupId)}/looks${qs ? `?${qs}` : ''}`
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to list character looks');
  return data;
}

export async function fetchHeyGenAvatars(options: {
  api_key_ref?: string;
  ownership?: 'public' | 'private';
  avatar_type?: 'studio_avatar' | 'digital_twin' | 'photo_avatar';
  limit?: number;
  token?: string;
} = {}): Promise<HeyGenCatalogPage<HeyGenAvatarLookOption>> {
  const params = new URLSearchParams();
  if (options.api_key_ref) params.set('api_key_ref', options.api_key_ref);
  if (options.ownership) params.set('ownership', options.ownership);
  if (options.avatar_type) params.set('avatar_type', options.avatar_type);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.token) params.set('token', options.token);
  const qs = params.toString();
  const response = await fetch(`${API_BASE}/node-engine/heygen/avatars${qs ? `?${qs}` : ''}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to list HeyGen avatars');
  return data;
}

export async function fetchHeyGenVoices(options: {
  api_key_ref?: string;
  type?: 'public' | 'private';
  language?: string;
  gender?: string;
  limit?: number;
  token?: string;
} = {}): Promise<HeyGenCatalogPage<HeyGenVoiceOption>> {
  const params = new URLSearchParams();
  if (options.api_key_ref) params.set('api_key_ref', options.api_key_ref);
  if (options.type) params.set('type', options.type);
  if (options.language) params.set('language', options.language);
  if (options.gender) params.set('gender', options.gender);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.token) params.set('token', options.token);
  const qs = params.toString();
  const response = await fetch(`${API_BASE}/node-engine/heygen/voices${qs ? `?${qs}` : ''}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to list HeyGen voices');
  return data;
}

export async function fetchHeyGenStyles(options: {
  api_key_ref?: string;
  tag?: string;
  limit?: number;
  token?: string;
} = {}): Promise<HeyGenCatalogPage<HeyGenVideoAgentStyle>> {
  const params = new URLSearchParams();
  if (options.api_key_ref) params.set('api_key_ref', options.api_key_ref);
  if (options.tag) params.set('tag', options.tag);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.token) params.set('token', options.token);
  const qs = params.toString();
  const response = await fetch(`${API_BASE}/node-engine/heygen/styles${qs ? `?${qs}` : ''}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to list HeyGen video agent styles');
  return data;
}

// ============================================================================
// Maestro Node Engine — per-vehicle Modality Generation (model) config
// Stored independently from prompt templates: editing model config NEVER mints
// a new prompt-template version.
// ============================================================================

export type ModelSelectionSource =
  | 'global_default'
  | 'modality_config'
  | 'prompt_template_override';

export type GenerationMode = 'single' | 'council';

// HeyGen v3 render settings (POST /v3/videos shape). Real render is MOCKED in V1.
// No style_id/brand_kit_id (deferred v2 Template-API concern).
export type VideoEngine = 'avatar_iv' | 'avatar_v';
export type VideoResolution = '4k' | '1080p' | '720p';
export type VideoAspectRatio = 'auto' | '16:9' | '9:16' | '4:5' | '5:4' | '1:1';
export type VideoOutputFormat = 'mp4' | 'webm';

export interface VideoVoiceSettings {
  speed?: number;
  pitch?: number;
  locale?: string;
}

export interface AvatarLibraryEntry {
  id: string;
  name: string;
  preview_image_url?: string | null;
  avatar_type?: string | null;
  default_voice_id?: string | null;
  supported_api_engines?: string[];
  group_id?: string | null;
  character_name?: string | null;
}

/** @deprecated Use AvatarLibraryEntry */
export type FavoriteAvatarRef = AvatarLibraryEntry;

export type VideoRenderStyle = 'studio_direct' | 'video_agent_produced';
export type NarrationFidelity = 'strict' | 'moderate';
export type VideoOrientation = 'landscape' | 'portrait';
export type RenderStyleOverride = VideoRenderStyle | 'inherit';

export interface VideoBrandKit {
  enabled: boolean;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  mediaTypeGuidance?: string;
}

export interface VideoAgentPromptTemplates {
  scriptFramingDirective?: string;
  defaultStyleBlock?: string;
}

export interface VideoSettings {
  provider: 'heygen';
  /** Reference to the API key (env/setting NAME), never the key value. */
  apiKeyRef?: string;
  avatar_id?: string;
  voice_id?: string;
  /** HBMSU Avatar Library entries for video renders. */
  approved_avatars?: AvatarLibraryEntry[];
  /** Selected looks that rotate across course video objects (stable per object_id). */
  avatar_rotation_pool?: AvatarLibraryEntry[];
  /** @deprecated Migrated to approved_avatars on read. */
  favorite_avatars?: AvatarLibraryEntry[];
  engine?: VideoEngine;
  resolution?: VideoResolution;
  aspect_ratio?: VideoAspectRatio;
  voice_settings?: VideoVoiceSettings;
  background?: Record<string, unknown>;
  remove_background?: boolean;
  motion_prompt?: string;
  output_format?: VideoOutputFormat;
  callback_url?: string;
  /** Course-wide default render style (per-object override happens in Layer 4). */
  video_render_style?: VideoRenderStyle;
  narration_fidelity?: NarrationFidelity;
  style_id?: string;
  orientation?: VideoOrientation;
  target_duration_seconds?: number;
  brand_kit?: VideoBrandKit;
  agent_prompt_templates?: VideoAgentPromptTemplates;
}

export interface HeyGenVideoAgentStyle {
  style_id: string;
  name: string;
  thumbnail_url: string | null;
  preview_video_url: string | null;
  tags: string[];
  aspect_ratio: string | null;
}

export interface NodeEngineAgentSection {
  section_number: number;
  title: string;
  duration_seconds?: number;
  narration: string;
  visual_description: string;
  on_screen_text?: string[];
  transitions?: string;
}

export interface NodeEngineAgentProduction {
  learning_objective: string;
  target_audience: string;
  sections: NodeEngineAgentSection[];
  production_notes: string;
  critical_on_screen_text: string[];
}

export interface ModalityGenerationConfig {
  id: string;
  vehicle: NodeEngineVehicle;
  generatorKind: 'chat' | 'image' | 'video';
  mode: GenerationMode;
  /** Mirror of the active template's prompt for display (not authoritative). */
  taskPrompt: string;
  singleModel?: string;
  councilModels?: string[];
  chairmanModel?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  modelSelectionReason?: string;
  productionTarget?: string;
  /** HeyGen v3 render settings — only meaningful for the `video` vehicle. */
  videoSettings?: VideoSettings;
  enabled: boolean;
}

/** The resolved model + which layer it came from (binding resolution order). */
export interface ResolvedGenerationModel {
  model: string;
  source: ModelSelectionSource;
  reason?: string;
  mode: GenerationMode;
  councilModels?: string[];
  chairmanModel?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ModalityConfigEntry {
  config: ModalityGenerationConfig;
  resolved: ResolvedGenerationModel;
}

export interface ModalityConfigsResponse {
  global_default_model: string;
  configs: ModalityConfigEntry[];
}

export interface ModalityConfigResponse {
  global_default_model: string;
  config: ModalityGenerationConfig;
  resolved: ResolvedGenerationModel;
}

/** Editable model/generation fields (PUT payload). */
export interface ModalityConfigUpdate {
  mode?: GenerationMode;
  singleModel?: string;
  councilModels?: string[];
  chairmanModel?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  modelSelectionReason?: string;
  productionTarget?: string;
  videoSettings?: VideoSettings;
  enabled?: boolean;
}

export async function fetchModalityConfigs(): Promise<ModalityConfigsResponse> {
  const response = await fetch(`${API_BASE}/node-engine/modality-config`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch modality configs');
  }
  return response.json();
}

export async function fetchModalityConfig(vehicle: string): Promise<ModalityConfigResponse> {
  const response = await fetch(
    `${API_BASE}/node-engine/modality-config/${encodeURIComponent(vehicle)}`
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch modality config');
  }
  return response.json();
}

export async function updateModalityConfig(
  vehicle: string,
  payload: ModalityConfigUpdate
): Promise<{ message: string; config: ModalityGenerationConfig; resolved: ResolvedGenerationModel }> {
  const response = await fetch(
    `${API_BASE}/node-engine/modality-config/${encodeURIComponent(vehicle)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to update modality config');
  }
  return response.json();
}

// ============================================================================
// Maestro Node Engine — Layer 1 (M7) Node Generation
//
// Mirrors the backend `Node`/`NodeSet` contract shapes from
// backend/src/models/nodeEngine.ts (the M7 portion). These power the operational
// Layer 1 workflow: generate 4-7 governed mastery nodes from ONE approved V1
// subtopic, review the readable Node Set Report, then approve (Level 0-1 — a
// human approves the draft before any downstream/M8 use; no auto-proceed).
// ============================================================================

export type NodeEngineNodeType =
  | 'concept'
  | 'distinction'
  | 'misconception'
  | 'procedure'
  | 'judgment'
  | 'application'
  | 'integration'
  | 'reflection'
  | 'threshold'
  | 'bridge'
  | 'assessment_preparation';

/** Lifecycle status shared by node-engine review objects (a node or a node-set). */
export type NodeEngineLifecycleStatus = 'draft' | 'needs_review' | 'approved' | 'needs_revision';

export type NodeEngineEvidenceMode =
  | 'explain'
  | 'classify_and_justify'
  | 'select_and_justify'
  | 'apply_to_case'
  | 'artifact_fragment'
  | 'simulation_decision'
  | 'reflection_response';

export type NodeEngineCaptureSignal = 'response' | 'reasoning' | 'confidence' | 'process';
export type NodeEngineDiagnosticBand = 'secure' | 'fragile' | 'knowledge_gap' | 'misconception';
export type NodeEngineGroundingStrength = 'strong' | 'weak';
export type NodeEngineRiskClassification = 'standard' | 'critical' | 'bridge' | 'high_risk';
export type NodeEngineMisconceptionSlotState = 'pending' | 'populated';
export type NodeEngineMisconceptionSeverity = 'low' | 'medium' | 'high';

export interface NodeEngineCitation {
  citation: string;
  passage_ref: string;
}

export interface NodeEnginePrimaryEvidenceCheck {
  evidence_check_id: string;
  must_capture_signals: NodeEngineCaptureSignal[];
  preferred_evidence_mode: NodeEngineEvidenceMode;
  diagnostic_bands: NodeEngineDiagnosticBand[];
}

export interface NodeEngineCandidateMisconception {
  candidate_misconception_id: string;
  statement: string;
  reason: string;
  severity?: NodeEngineMisconceptionSeverity;
  suggested_trap?: string;
}

export interface NodeEngineMisconceptionBinding {
  misconception_id: string;
  statement: string;
  severity: NodeEngineMisconceptionSeverity;
  trap: string;
  expected_error_pattern: string;
  confirming_probe: string;
  blocks_submission_if_state: 'confirmed' | 'suspected' | 'never';
  clearance_rule: string;
}

export interface NodeEngineCrossCloLink {
  clo_id: string;
  reason: string;
}

export interface NodeEngineEvidenceMapCriterion {
  criterion_id: string;
  criterion_name: string;
  solo_descriptors: {
    surface: string;
    multi_element: string;
    relational: string;
    extended_abstract: string;
  };
  critical: boolean;
}

export interface NodeEngineNode {
  node_id: string;
  parent_subtopic_id: string;
  parent_clo_id?: string;
  clo_ids: string[];
  course_id?: string;
  node_type: NodeEngineNodeType;
  node_title: string;
  /** Position in the within-subtopic prerequisite chain. */
  order: number;
  cognitive_level?: string;
  prepares_for_assessment_id?: string | null;
  is_core: boolean;
  knowledge_component: string;
  kc_ids: string[];
  mastery_statement: string;
  why_it_matters: string;
  assessment_connection: string;
  core_academic_message: string;
  node_learning_intent?: string;
  evidence_map: NodeEngineEvidenceMapCriterion[];
  captured_signals: NodeEngineCaptureSignal[];
  prerequisite_node_ids: string[];
  dependent_node_ids: string[];
  cross_clo_links: NodeEngineCrossCloLink[];
  primary_evidence_check_requirement: NodeEnginePrimaryEvidenceCheck;
  misconception_slots: NodeEngineMisconceptionSlotState;
  candidate_misconceptions: NodeEngineCandidateMisconception[];
  misconception_bindings: NodeEngineMisconceptionBinding[];
  grounding_references: NodeEngineCitation[];
  grounding_strength?: NodeEngineGroundingStrength;
  risk_classification: NodeEngineRiskClassification[];
  generator_divergence_note?: string;
  grain_justification?: string;
  /** Review-by-exception triage (Issue 1). Older artifacts may omit these. */
  review_priority?: NodeEngineReviewPriority;
  review_reasons?: string[];
  sme_edited?: boolean;
  sme_edited_at?: string;
  status: NodeEngineLifecycleStatus;
}

export type NodeEngineReviewPriority = 'must_review' | 'can_proceed';

export type NodeEngineGroundingSource = 'scoped_references' | 'course_level_references' | 'model_only';

export interface NodeEngineGroundingSummary {
  retrieval_called: boolean;
  scoped_chunk_count: number;
  course_level_chunk_count: number;
  citations_count: number;
  grounding_source: NodeEngineGroundingSource;
  grounding_note: string;
  academic_ready: boolean;
}

export interface NodeEngineNodeSet {
  node_set_id: string;
  course_id: string;
  subtopic_id: string;
  clo_ids: string[];
  prepares_for_assessment_ids: string[];
  nodes: NodeEngineNode[];
  grain_justification?: string;
  generator_divergence_notes: string[];
  status: NodeEngineLifecycleStatus;
  grounding_summary?: NodeEngineGroundingSummary;
  model_used?: string;
  model_selection_source?: ModelSelectionSource;
  model_selection_reason?: string;
  generation_mode?: GenerationMode;
  prompt_template_id?: string;
  prompt_version?: number;
  created_at: string;
  updated_at: string;
  approved_by?: string;
  approved_at?: string;
  academic_override_reason?: string;
  academic_override_by?: string;
}

export interface GenerateNodeSetOptions {
  ground?: boolean;
  persist?: boolean;
  persistGraph?: boolean;
}

/**
 * Generate a DRAFT node-set for one approved subtopic (Layer 1 / M7). The
 * returned set has status `draft` and requires human approval before any
 * downstream use.
 */
export async function generateNodeSet(
  code: string,
  subtopicId: string,
  options: GenerateNodeSetOptions = {}
): Promise<NodeEngineNodeSet> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/node-set`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to generate node set');
  return data.node_set;
}

/** Read a previously generated node-set for a subtopic. Returns null when none exists. */
export async function fetchNodeSet(
  code: string,
  subtopicId: string
): Promise<NodeEngineNodeSet | null> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/node-set`
  );
  if (response.status === 404) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to fetch node set');
  return data.node_set;
}

/**
 * Human approval step (Level 0-1). Moves the node-set (and the approved nodes)
 * from draft → approved. Approving all nodes unlocks Layer 2.
 */
export class AcademicApprovalRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcademicApprovalRequiredError';
  }
}

export async function approveNodeSet(
  code: string,
  subtopicId: string,
  payload: { approver: string; nodeIds?: string[]; overrideReason?: string }
): Promise<NodeEngineNodeSet> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/node-set/approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // 422 = academic-approval guard: caller must attach grounding or override.
    if (response.status === 422 || data.academic_approval_required) {
      throw new AcademicApprovalRequiredError(data.error || 'Academic approval required');
    }
    throw new Error(data.error || 'Failed to approve node set');
  }
  return data.node_set;
}

export interface NodeProsePatch {
  knowledge_component?: string;
  mastery_statement?: string;
  why_it_matters?: string;
  assessment_connection?: string;
  candidate_misconceptions?: Array<{
    candidate_misconception_id: string;
    statement?: string;
    reason?: string;
    suggested_trap?: string;
  }>;
}

export class NodeEditConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeEditConflictError';
  }
}

export async function updateNodeProse(
  code: string,
  subtopicId: string,
  nodeId: string,
  patch: NodeProsePatch
): Promise<NodeEngineNodeSet> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/node-set/nodes/${encodeURIComponent(nodeId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to update node prose');
  return data.node_set;
}

export async function regenerateSingleNode(
  code: string,
  subtopicId: string,
  nodeId: string,
  options: { acknowledgeReplaceEdits?: boolean } = {}
): Promise<NodeEngineNodeSet> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/node-set/nodes/${encodeURIComponent(nodeId)}/regenerate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 409 || data.manual_edits_present) {
      throw new NodeEditConflictError(
        data.error || 'This node has manual edits — regenerating will replace them.'
      );
    }
    throw new Error(data.error || 'Failed to regenerate node');
  }
  return data.node_set;
}

export async function reopenNodeSet(code: string, subtopicId: string): Promise<NodeEngineNodeSet> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/node-set/reopen`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to reopen node set');
  return data.node_set;
}

// ============================================================================
// Maestro Node Engine — Layer 2 (M8) Experience Blueprint
// ============================================================================

export type BlueprintObjectFamily = 'node_learning_object' | 'milestone_support_object';

export type BlueprintNodeObjectPurpose =
  | 'orientation'
  | 'explanation'
  | 'worked_example'
  | 'practice'
  | 'evidence_check'
  | 'remediation'
  | 'enrichment'
  | 'reflection'
  | 'bridge'
  | 'assessment_connection';

export type BlueprintVehicle =
  | 'text'
  | 'structured_visual'
  | 'pictorial_visual'
  | 'video'
  | 'interactive'
  | 'simulation'
  | 'learning_anchor';

export interface NodeEngineBlueprintObject {
  object_id: string;
  object_family: BlueprintObjectFamily;
  sequence_order: number;
  parent_node_id: string;
  kc_ids: string[];
  node_object_purpose: BlueprintNodeObjectPurpose | null;
  milestone_support_purpose: string | null;
  suggested_vehicle: BlueprintVehicle;
  content_pattern: string;
  is_primary_evidence_check: boolean;
  title: string;
  design_rationale: string;
  estimated_effort_minutes: number;
  addresses_misconception_ids: string[];
  targets_misconception_id?: string | null;
}

export interface NodeEngineBlueprint {
  blueprint_id: string;
  course_id: string;
  subtopic_id: string;
  node_id: string;
  node_title: string;
  objects: NodeEngineBlueprintObject[];
  status: NodeEngineLifecycleStatus;
  created_at: string;
  updated_at: string;
  approved_by?: string;
  approved_at?: string;
}

export interface BlueprintObjectPatch {
  object_id: string;
  title?: string;
  design_rationale?: string;
  suggested_vehicle?: BlueprintVehicle;
  node_object_purpose?: BlueprintNodeObjectPurpose;
  content_pattern?: string;
  estimated_effort_minutes?: number;
  sequence_order?: number;
  targets_misconception_id?: string | null;
}

export async function fetchBlueprint(
  code: string,
  subtopicId: string,
  nodeId: string
): Promise<NodeEngineBlueprint | null> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/nodes/${encodeURIComponent(nodeId)}/blueprint`
  );
  if (response.status === 404) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to fetch blueprint');
  return data.blueprint;
}

export async function generateBlueprint(
  code: string,
  subtopicId: string,
  nodeId: string
): Promise<NodeEngineBlueprint> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/nodes/${encodeURIComponent(nodeId)}/blueprint`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to generate blueprint');
  return data.blueprint;
}

export async function updateBlueprint(
  code: string,
  subtopicId: string,
  nodeId: string,
  objects: BlueprintObjectPatch[]
): Promise<NodeEngineBlueprint> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/nodes/${encodeURIComponent(nodeId)}/blueprint`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objects }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to update blueprint');
  return data.blueprint;
}

export async function approveBlueprint(
  code: string,
  subtopicId: string,
  nodeId: string,
  approver: string
): Promise<NodeEngineBlueprint> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/nodes/${encodeURIComponent(nodeId)}/blueprint/approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approver }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to approve blueprint');
  return data.blueprint;
}

export async function hydrateBlueprints(
  code: string,
  nodes: Array<{ subtopicId: string; nodeId: string }>
): Promise<Record<string, NodeEngineBlueprint | null>> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/blueprints/hydrate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to hydrate blueprints');
  return data.blueprints ?? {};
}

// ============================================================================
// Maestro Node Engine — Layer 3 (M9) Content Specification
// ============================================================================

export interface NodeEngineContentSpecExample {
  label: string;
  content: string;
  citation?: NodeEngineCitation;
}

export interface NodeEngineContentSpecNonExample {
  label: string;
  content: string;
  why_not: string;
}

export interface NodeEngineEvidenceCheckSpec {
  learner_task: string;
  response_prompt: string;
  reasoning_prompt: string;
  confidence_prompt: string;
  evidence_criteria_summary: string;
  misconception_trap?: string;
  no_feedback_before_submission: boolean;
  preferred_evidence_mode: NodeEngineEvidenceMode;
  must_capture_signals: NodeEngineCaptureSignal[];
}

export interface NodeEngineContentSpec {
  content_spec_id: string;
  object_id: string;
  blueprint_id: string;
  course_id: string;
  subtopic_id: string;
  node_id: string;
  object_family: BlueprintObjectFamily;
  node_object_purpose: BlueprintNodeObjectPurpose | null;
  milestone_support_purpose: string | null;
  content_pattern: string;
  suggested_vehicle: BlueprintVehicle;
  is_primary_evidence_check: boolean;
  parent_node_id: string;
  kc_ids: string[];
  title: string;
  required_explanation: string;
  examples: NodeEngineContentSpecExample[];
  non_examples: NodeEngineContentSpecNonExample[];
  preservation_rules: string[];
  addresses_misconception_ids: string[];
  targets_misconception_id?: string | null;
  grounding_references: NodeEngineCitation[];
  grounding_strength: NodeEngineGroundingStrength;
  grounding_note?: string;
  evidence_check_spec?: NodeEngineEvidenceCheckSpec;
  status: NodeEngineLifecycleStatus;
  created_at: string;
  updated_at: string;
  approved_by?: string;
  approved_at?: string;
}

export interface ContentSpecPatch {
  title?: string;
  required_explanation?: string;
  preservation_rules?: string[];
  grounding_note?: string;
}

export async function fetchContentSpecs(
  code: string,
  subtopicId: string,
  nodeId: string
): Promise<NodeEngineContentSpec[]> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/nodes/${encodeURIComponent(nodeId)}/content-specs`
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to fetch content specs');
  return data.specs ?? [];
}

export async function generateContentSpecs(
  code: string,
  subtopicId: string,
  nodeId: string,
  objectId?: string
): Promise<NodeEngineContentSpec[]> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/nodes/${encodeURIComponent(nodeId)}/content-specs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(objectId ? { object_id: objectId } : {}),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to generate content specs');
  return data.specs ?? [];
}

export async function updateContentSpec(
  code: string,
  subtopicId: string,
  nodeId: string,
  objectId: string,
  patch: ContentSpecPatch
): Promise<NodeEngineContentSpec> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/nodes/${encodeURIComponent(nodeId)}/objects/${encodeURIComponent(objectId)}/content-spec`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to update content spec');
  return data.spec;
}

export async function approveContentSpec(
  code: string,
  subtopicId: string,
  nodeId: string,
  objectId: string,
  approver: string
): Promise<NodeEngineContentSpec> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/nodes/${encodeURIComponent(nodeId)}/objects/${encodeURIComponent(objectId)}/content-spec/approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approver }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to approve content spec');
  return data.spec;
}

export async function hydrateContentSpecs(
  code: string,
  nodes: Array<{ subtopicId: string; nodeId: string }>
): Promise<Record<string, NodeEngineContentSpec | null>> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/content-specs/hydrate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to hydrate content specs');
  return data.specs ?? {};
}

// ---------------------------------------------------------------------------
// M10 — Modality Production (Phase A: text only)
// ---------------------------------------------------------------------------

export type TextSegmentType =
  | 'heading'
  | 'subheading'
  | 'body'
  | 'definition'
  | 'example'
  | 'non_example'
  | 'callout'
  | 'quotation'
  | 'table'
  | 'formula'
  | 'summary';

export interface NodeEngineTextSegment {
  type: TextSegmentType;
  text: string;
  citation?: { citation: string; passage_ref: string };
  items?: string[];
  columns?: string[];
  rows?: string[][];
}

export interface NodeEngineTextFidelityCheck {
  status: 'passed' | 'needs_review';
  notes: string[];
}

export interface NodeEngineVideoBriefFidelityCheck {
  status: 'passed' | 'needs_review';
  notes: string[];
}

export type StructuredVisualType =
  | 'comparison_table'
  | 'process_map'
  | 'concept_map'
  | 'decision_tree'
  | 'framework_diagram'
  | 'criteria_matrix'
  | 'annotated_example'
  | 'rubric_map'
  | 'checklist_visual'
  | 'timeline'
  | 'hierarchy'
  | 'cause_effect_map'
  | 'infographic';

export type SemanticElementType =
  | 'concept'
  | 'criterion'
  | 'step'
  | 'example'
  | 'non_example'
  | 'misconception'
  | 'correction'
  | 'evidence'
  | 'decision_point'
  | 'rubric_level'
  | 'checklist_item';

export type SemanticRelationshipType =
  | 'contrasts_with'
  | 'leads_to'
  | 'depends_on'
  | 'supports'
  | 'violates'
  | 'maps_to'
  | 'prepares_for'
  | 'corrects'
  | 'exemplifies';

export type SemanticAnnotationType =
  | 'explanation'
  | 'warning'
  | 'misconception_alert'
  | 'evidence_note'
  | 'rubric_note'
  | 'assessment_tip';

export interface NodeEngineSemanticElement {
  element_id: string;
  element_type: SemanticElementType;
  label: string;
  description?: string;
  citation?: string;
  importance?: string;
}

export interface NodeEngineSemanticRelationship {
  from_element_id: string;
  to_element_id: string;
  relationship_type: SemanticRelationshipType;
  label?: string;
}

export interface NodeEngineSemanticAnnotation {
  annotation_id: string;
  target_element_id: string;
  annotation_type: SemanticAnnotationType;
  text: string;
  citation?: string;
}

export interface NodeEngineStructuredVisual {
  visual_type: StructuredVisualType;
  title: string;
  semantic_elements: NodeEngineSemanticElement[];
  relationships: NodeEngineSemanticRelationship[];
  annotations: NodeEngineSemanticAnnotation[];
  layout_intent: string;
  reading_order: string[];
  renderer_notes?: string;
  alt_text: string;
  text_equivalent: string;
  grounding_strength: 'strong' | 'moderate' | 'weak';
  evidence_check_role?: 'not_evidence_check' | 'supporting_visual' | 'evidence_collection_visual';
  rendering_route: 'platform_native' | 'ai_infographic';
  fidelity_check?: NodeEngineTextFidelityCheck;
}

export interface NodeEngineProducedObject {
  object_id: string;
  content_spec_id: string;
  node_id: string;
  subtopic_id: string;
  course_id: string;
  blueprint_suggested_vehicle: BlueprintVehicle;
  produced_modality: BlueprintVehicle;
  envelope: {
    object_id: string;
    produced_modality: string;
    governance_status: string;
    modality_specific: {
      segments?: NodeEngineTextSegment[];
      fidelity_check?: NodeEngineTextFidelityCheck | NodeEngineVideoBriefFidelityCheck;
      production_note?: string;
      /** Phase B video — HeyGen-ready prompt (copy-paste until API connected). */
      heygen_prompt?: string;
      heygen_recommended_mode?: 'generate' | 'chat';
      transcript?: string;
      render_status?: 'brief_ready' | 'render_pending' | 'render_complete' | 'render_failed';
      script_word_count?: number;
      /** Effective word budget (derived from target duration); falls back to 420. */
      script_word_budget?: number;
      heygen_video_id?: string;
      /** Ephemeral HeyGen presigned URL (audit / re-ingest only). */
      heygen_source_url?: string;
      /** @deprecated Use heygen_source_url — kept for older produced artifacts. */
      video_url?: string;
      /** Maestro asset tag, e.g. MSTR-VID-MDLD602-obj_video_1 */
      maestro_video_asset_id?: string;
      maestro_video_stored?: boolean;
      maestro_video_bytes?: number;
      maestro_video_ingested_at?: string;
      maestro_video_ingest_error?: string;
      render_mock?: boolean;
      render_failure_message?: string;
      last_render_at?: string;
      /** Effective render style stamped at brief time. */
      video_render_style?: VideoRenderStyle;
      /** Per-object override (Layer 4). */
      video_render_style_override?: RenderStyleOverride;
      /** Which HeyGen API path produced the render. */
      render_path?: 'direct_video' | 'video_agent';
      heygen_session_id?: string;
      /** Captured rendered transcript (Video Agent) for SME drift review. */
      rendered_transcript?: string;
      transcript_fidelity?: 'matched' | 'minor_drift' | 'needs_review';
      transcript_fidelity_notes?: string[];
      /** Structured scenes for the Video Agent path. */
      agent_production?: NodeEngineAgentProduction;
      video_brief?: {
        narration?: {
          video_title?: string;
          full_script?: string;
          script_word_count?: number;
          approximate_duration_minutes?: number;
        };
        heygen_prompt_payload?: { prompt?: string; recommended_mode?: 'generate' | 'chat' };
        fidelity_check?: NodeEngineVideoBriefFidelityCheck;
        video_render_style?: VideoRenderStyle;
        agent_production?: NodeEngineAgentProduction;
      };
      /** Structured visual semantic spec (platform-rendered). */
      structured_visual?: NodeEngineStructuredVisual;
      visual_type?: StructuredVisualType;
      text_equivalent?: string;
      rendering_route?: 'platform_native' | 'ai_infographic';
    };
    grounding_strength: string;
    estimated_effort_minutes: number;
  };
  prompt_template_id: string;
  prompt_version: number;
  generation_mode: string;
  produced_at: string;
}

export async function produceTextObject(
  code: string,
  subtopicId: string,
  nodeId: string,
  objectId: string
): Promise<NodeEngineProducedObject> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/nodes/${encodeURIComponent(nodeId)}/objects/${encodeURIComponent(objectId)}/produce-text`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to produce text object');
  return data.produced;
}

export async function produceVideoBriefObject(
  code: string,
  subtopicId: string,
  nodeId: string,
  objectId: string,
  renderStyleOverride?: RenderStyleOverride
): Promise<NodeEngineProducedObject> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/nodes/${encodeURIComponent(nodeId)}/objects/${encodeURIComponent(objectId)}/produce-video-brief`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        renderStyleOverride ? { render_style_override: renderStyleOverride } : {}
      ),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to produce video brief');
  return data.produced;
}

export async function produceStructuredVisualObject(
  code: string,
  subtopicId: string,
  nodeId: string,
  objectId: string
): Promise<NodeEngineProducedObject> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/nodes/${encodeURIComponent(nodeId)}/objects/${encodeURIComponent(objectId)}/produce-structured-visual`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to produce structured visual');
  return data.produced;
}

/** Layer 4 production — routes to the producer matching the approved spec vehicle. */
export async function produceLayer4Object(
  code: string,
  subtopicId: string,
  nodeId: string,
  objectId: string,
  suggestedVehicle: BlueprintVehicle,
  renderStyleOverride?: RenderStyleOverride
): Promise<NodeEngineProducedObject> {
  if (suggestedVehicle === 'video') {
    return produceVideoBriefObject(code, subtopicId, nodeId, objectId, renderStyleOverride);
  }
  if (suggestedVehicle === 'structured_visual') {
    return produceStructuredVisualObject(code, subtopicId, nodeId, objectId);
  }
  return produceTextObject(code, subtopicId, nodeId, objectId);
}

export async function renderVideoObject(
  code: string,
  subtopicId: string,
  nodeId: string,
  objectId: string
): Promise<NodeEngineProducedObject> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/nodes/${encodeURIComponent(nodeId)}/objects/${encodeURIComponent(objectId)}/render-video`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to render video');
  return data.produced;
}

export async function refreshVideoRender(
  code: string,
  subtopicId: string,
  nodeId: string,
  objectId: string
): Promise<NodeEngineProducedObject> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/subtopics/${encodeURIComponent(
      subtopicId
    )}/nodes/${encodeURIComponent(nodeId)}/objects/${encodeURIComponent(objectId)}/render-video/refresh`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to refresh video render');
  return data.produced;
}

/** In-app stream URL for a Maestro-ingested produced video (SME review). */
export function producedVideoStreamUrl(courseCode: string, objectId: string): string {
  return withAccessToken(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(courseCode)}/objects/${encodeURIComponent(objectId)}/video`
  );
}

export async function hydrateProducedObjects(
  code: string,
  objectIds: string[]
): Promise<Record<string, NodeEngineProducedObject | null>> {
  const response = await fetch(
    `${API_BASE}/node-engine/courses/${encodeURIComponent(code)}/produced-objects/hydrate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ object_ids: objectIds }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to hydrate produced objects');
  return data.produced ?? {};
}
