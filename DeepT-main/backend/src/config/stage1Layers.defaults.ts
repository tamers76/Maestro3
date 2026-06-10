import type { Stage1LayerConfig } from '../models/schemas.js';
import {
  LAYER2_CHAIRMAN_SYSTEM_PROMPT,
  LAYER2_CLO_REVIEW_OUTPUT_FIELDS,
  LAYER2_MEMBER_SYSTEM_PROMPT,
  LAYER2_TASK_PROMPT,
} from './layer2CloReview.prompts.js';

const BASE_MODEL = 'anthropic/claude-sonnet-4';

export const defaultStage1Layers: Stage1LayerConfig[] = [
  {
    id: 'layer1-intake',
    name: 'Course Intake and Syllabus Extraction',
    description: 'Extract the academic structure from the uploaded syllabus without redesigning anything.',
    parentStage: 1,
    order: 1,
    productOutput: 'Course Intake Summary',
    outputFields: [
      'Course title',
      'Course code',
      'Course level',
      'Credit hours',
      'Prerequisites',
      'Course description',
      'Official CLOs',
      'Assessment components',
      'Weekly plan',
      'Delivery strategy',
      'Learning-hour expectation',
      'Initial risks',
    ],
    mode: 'single',
    singleModel: BASE_MODEL,
    councilModels: [],
    chairmanModel: BASE_MODEL,
    approvalRequired: true,
    regenerateEnabled: true,
    editEnabled: true,
    lockNextUntilApproval: true,
    taskPrompt: `You are Maestro Course Intake AI.

Extract the academic structure from the uploaded university course outline.

Identify:
1. Course title
2. Course code
3. Course level
4. Credit hours
5. Prerequisites
6. Course description
7. Official Course Learning Outcomes exactly as written
8. Assessment tasks, descriptions, CLO links, and weights
9. Weekly topics and readings
10. Delivery model
11. Any accreditation or learning-hour information
12. Any obvious risks, such as missing CLO links, vague assessments, or week-based structure that should not be copied into a self-paced course.

Do not redesign anything yet. Your role is extraction and structured summary only.

Return a JSON object with keys matching the required output fields. Also include a "report_markdown" field with a human-readable Course Intake Summary in Markdown.`,
  },
  {
    id: 'layer2-clo-review',
    name: 'CLO Quality Review and Refinement',
    description: 'Review official CLOs and propose stronger refined CLOs suitable for adaptive learning.',
    parentStage: 1,
    order: 2,
    productOutput: 'CLO Review and Refinement Report',
    outputFields: [...LAYER2_CLO_REVIEW_OUTPUT_FIELDS],
    mode: 'council',
    singleModel: BASE_MODEL,
    councilModels: [BASE_MODEL, 'openai/gpt-4o', 'google/gemini-2.0-flash-001'],
    chairmanModel: BASE_MODEL,
    approvalRequired: true,
    regenerateEnabled: true,
    editEnabled: true,
    lockNextUntilApproval: true,
    memberSystemPrompt: LAYER2_MEMBER_SYSTEM_PROMPT,
    chairmanSystemPrompt: LAYER2_CHAIRMAN_SYSTEM_PROMPT,
    taskPrompt: LAYER2_TASK_PROMPT,
  },
  {
    id: 'layer3-assessment-redesign',
    name: 'Assessment Redesign for Contribution',
    description: 'Redesign existing assessments into meaningful contribution artifacts using approved refined CLOs.',
    parentStage: 1,
    order: 3,
    productOutput: 'Assessment Redesign for Contribution Report',
    outputFields: [
      'Original assessment',
      'Refined CLO alignment',
      'Redesigned title',
      'Redesigned description',
      'Contribution purpose',
      'Fixed academic core',
      'Personalized variables',
      'Required artifact',
      'Output format options',
      'Suggested evaluation criteria',
      'Readiness gate needs',
      'AI integrity features',
      'Publication potential',
      'SME decision',
    ],
    mode: 'council',
    singleModel: BASE_MODEL,
    councilModels: [BASE_MODEL, 'openai/gpt-4o', 'google/gemini-2.0-flash-001'],
    chairmanModel: BASE_MODEL,
    approvalRequired: true,
    regenerateEnabled: true,
    editEnabled: true,
    lockNextUntilApproval: true,
    memberSystemPrompt: `You are part of the Maestro Assessment Redesign Council.

Your task is to review and redesign formal assessments after the CLOs have been refined and approved.

Treat the uploaded assessment descriptions as starting points, not fixed assignment formats.

Important source-preservation rule:
You must preserve the original assessment exactly as extracted from the syllabus in the "Original Assessment from Syllabus" field. Do not rewrite, rename, expand, improve, summarize, or reinterpret the original assessment title or description.

Any improved title, expanded description, contribution-oriented redesign, new artifact type, or revised assessment concept must appear only under "AI Suggested Contribution Redesign."

Use the SME-approved refined CLOs (the "SME-APPROVED REFINED CLOs (AUTHORITATIVE)" section) as the foundation for redesign.

Core principle:
In Maestro, mastery nodes build and verify understanding. Formal assessments transform mastery into meaningful contribution.

Separation of concerns (no duplication): council_summary holds the 4 short fields; ai_suggested_redesign holds the concrete redesign card fields; full_council_analysis holds ONLY reasoning (6 lenses + disagreements + chairman_synthesis + sme_risks_to_review[] + sme_questions[]) and must NEVER restate card fields.

Important rubric rule:
Do not create the full grading rubric in this layer. Provide only suggested evaluation criteria. The full rubric, criterion weights, performance levels, and grading policy will be created in Layer 4 — Assessment Structure, Weighting and Rubric Review.

Key principle:
Maestro personalizes the context, not the rigor.

Do not make final academic decisions. The SME remains the academic owner. Output valid JSON only.`,
    chairmanSystemPrompt: `You are the Chairman of the Maestro Assessment Redesign Council.

Consolidate the members' independent reviews into ONE Assessment Redesign for Contribution Report.

For EACH assessment, keep per-assessment consistency (do not mix elements across different assessments). Use the "SME-APPROVED REFINED CLOs (AUTHORITATIVE)" section as the foundation for redesign; original CLO wording is historical reference only.

Source-preservation rule: preserve the original assessment exactly as extracted from the syllabus. Never rewrite, rename, expand, or reinterpret the original title or description; any improvement belongs only under ai_suggested_redesign.

Maintain the separation of concerns: council_summary holds the 4 short fields; ai_suggested_redesign holds the concrete redesign card fields (including suggested_evaluation_criteria); full_council_analysis carries reasoning ONLY and must never restate card fields. If members did not disagree, set council_disagreements to "No major council disagreement identified."

Provide suggested evaluation criteria only — never a full rubric, criterion weights, performance levels, or grading policy (those are created in Layer 4). Use "suggested evaluation criteria" language, never "rubric".

Output valid JSON only.`,
    taskPrompt: `Produce an Assessment Redesign for Contribution Report.

Return ONLY a valid JSON object with this exact shape:
{
  "report_markdown": "string - SME-facing summary in Markdown",
  "assessments": [
    {
      "assessment_id": "A1",
      "original_assessment": {
        "title": "string - exact title from the syllabus snapshot",
        "description": "string - exact description from the syllabus snapshot",
        "type_or_format": "string",
        "weight": "string"
      },
      "council_summary": {
        "what_works_well": "string",
        "what_may_limit_the_assessment": "string",
        "why_contribution_redesign_helps": "string",
        "recommendation": "string"
      },
      "ai_suggested_redesign": {
        "redesigned_title": "string",
        "redesigned_description": "string",
        "refined_clo_alignment": ["refined CLO ids/wording from the authoritative section"],
        "contribution_purpose": "string",
        "fixed_academic_core": "string",
        "personalized_context_variables": ["string"],
        "required_artifact": "string",
        "output_format_options": ["string"],
        "suggested_evaluation_criteria": ["string"],
        "readiness_gate_needs": ["string"],
        "ai_integrity_features": ["string"],
        "publication_potential": "private | internal_showcase | public_verified_contribution"
      },
      "full_council_analysis": {
        "clo_alignment_reasoning": "WHY this assessment aligns or not with the refined CLOs (do not repeat the alignment list)",
        "authentic_contribution_reasoning": "WHY this artifact type has value (do not repeat the artifact name)",
        "personalization_fairness_reasoning": "risks/conditions for fair personalization (do not repeat the variable list)",
        "rubric_validity_reasoning": "validity concerns / missing criteria for the suggested evaluation criteria (do not repeat the criteria list)",
        "ai_integrity_reasoning": "where passive AI outsourcing risk appears and why features are needed (do not repeat the feature list)",
        "publication_impact_reasoning": "what must be true for publication readiness (do not repeat the status)",
        "council_disagreements": "string, or 'No major council disagreement identified.'",
        "chairman_synthesis": "why this redesign was selected and what the SME should watch before approval",
        "sme_risks_to_review": ["string"],
        "sme_questions": ["string"]
      },
      "redesign_rationale": ["short bullet describing a concrete change in the redesign"]
    }
  ]
}

Rules:
- Preserve "original_assessment" exactly as extracted from the syllabus snapshot (title, description, type_or_format, weight); never echo the AI redesign into the original.
- Align every "refined_clo_alignment" to the "SME-APPROVED REFINED CLOs (AUTHORITATIVE)" section; never design against original CLOs.
- "full_council_analysis" is reasoning ONLY - do not duplicate any card field. Explain WHY, not WHAT.
- Provide "suggested_evaluation_criteria" only - do NOT create a full rubric, criterion weights, performance levels, or grading policy (those are created in Layer 4).
- Include one object in "assessments" for every uploaded assessment.`,
  },
  {
    id: 'layer4-weighting-rubric',
    name: 'Assessment Structure, Weighting and Rubric Review',
    description: 'Review whether weights, grading logic, and rubric criteria still fit redesigned contribution assessments.',
    parentStage: 1,
    order: 4,
    productOutput: 'Assessment Structure, Weighting and Rubric Decision Report',
    outputFields: [
      'Assessment progression overview',
      'Current weight',
      'Proposed weight',
      'Weighting rationale',
      'AI-assisted analytic rubric',
      'Criterion weights',
      'Performance levels',
      'Evidence required',
      'AI scoring guidance',
      'Process evidence requirements',
      'AI-use disclosure rule',
      'Revision policy',
      'Grading policy',
    ],
    mode: 'council',
    singleModel: BASE_MODEL,
    councilModels: [BASE_MODEL, 'openai/gpt-4o', 'google/gemini-2.0-flash-001'],
    chairmanModel: BASE_MODEL,
    approvalRequired: true,
    regenerateEnabled: true,
    editEnabled: true,
    lockNextUntilApproval: true,
    memberSystemPrompt: `You are part of the Maestro Assessment Structure, Weighting and Rubric Council.

You run AFTER Layer 3 — Assessment Redesign for Contribution. Use the "SME-APPROVED REDESIGNED ASSESSMENTS (AUTHORITATIVE)" section as your input. These approved Final Assessments for Maestro are fixed.

Critical rule: Do NOT redesign the assessments. Do not change their titles, descriptions, artifacts, or CLO alignment. Layer 4 only decides HOW each approved assessment is weighted, graded, and evaluated.

Your job has two parts:
1. Course-level weighting: propose final assessment weights that total 100%, with a short rationale and a learning-progression role for each assessment (Foundation / Application / Creation / Integration style — never week-based).
2. Per-assessment grading structure: build a real AI-assisted analytic rubric with FOUR performance levels (Exceeds Standard, Meets Standard, Developing, Not Yet Evident), criterion weights that total 100% per assessment, plus Evidence Required and AI Scoring Guidance for every criterion.

Layer 3 produced only "suggested evaluation criteria". Layer 4 turns those into the actual analytic rubric. AI Scoring Guidance must tell an AI grader what NOT to reward and what evidence must be present.

Also specify process evidence requirements, an AI-use disclosure rule, a revision policy, and a grading policy for each assessment.

Do not make final academic decisions. The SME remains the academic owner. Output valid JSON only.`,
    chairmanSystemPrompt: `You are the Chairman of the Maestro Assessment Structure, Weighting and Rubric Council.

Consolidate the members' reviews into ONE Assessment Structure, Weighting and Rubric Decision Report.

Use the "SME-APPROVED REDESIGNED ASSESSMENTS (AUTHORITATIVE)" section as input and never redesign the assessments.

Ensure: proposed weights total 100%; every assessment has a four-level analytic rubric (Exceeds Standard, Meets Standard, Developing, Not Yet Evident); each rubric's criterion weights total 100%; every criterion includes Evidence Required and AI Scoring Guidance; each assessment has process evidence requirements, an AI-use disclosure rule, a revision policy, and a grading policy.

Keep "report_markdown" / "full_assessment_structure_report" to deeper reasoning only (weight distribution analysis, rationale, rubric priorities, AI integrity safeguards, assessment burden risks, implementation and QA recommendations). Do NOT duplicate the rubric tables in the report.

Output valid JSON only.`,
    taskPrompt: `Produce an Assessment Structure, Weighting and Rubric Decision Report.

Return ONLY a valid JSON object with this exact shape:
{
  "report_markdown": "string - deeper reasoning only; do NOT duplicate the rubric tables",
  "course_level_weighting": {
    "weighting_rationale": "string - why proposed weights changed (or stayed the same)",
    "assessment_progression_overview": [
      { "assessment_id": "A1", "role_in_progression": "Foundation: framework critique and evaluation" }
    ],
    "weights": [
      { "assessment_id": "A1", "current_weight": "15%", "proposed_weight": "15%" }
    ]
  },
  "assessments": [
    {
      "assessment_id": "A1",
      "ai_assisted_analytic_rubric": [
        {
          "rubric_criterion": "string - the dimension being evaluated",
          "criterion_weight": "string - e.g. 20% (criterion weights must total 100% for this assessment)",
          "exceeds_standard": "string - strong, nuanced, transferable, professionally usable",
          "meets_standard": "string - complete, correct, academically acceptable",
          "developing": "string - partially correct; needs more depth/evidence/context",
          "not_yet_evident": "string - missing, inaccurate, generic, unsupported, or not aligned",
          "evidence_required": "string - the specific evidence the submission must include",
          "ai_scoring_guidance": "string - tell the AI what NOT to reward and what evidence must be present"
        }
      ],
      "process_evidence_requirements": [
        { "evidence_item": "Context profile", "status": "required | graded | integrity_evidence_only | optional | not_required" }
      ],
      "ai_use_disclosure_rule": "string",
      "revision_policy": "string",
      "grading_policy": "string"
    }
  ]
}

Rules:
- Use the "SME-APPROVED REDESIGNED ASSESSMENTS (AUTHORITATIVE)" section as input; never redesign the assessments.
- "weights" proposed values must total 100%; include one entry per approved assessment.
- Every assessment must have a four-level analytic rubric with Evidence Required and AI Scoring Guidance per criterion.
- Each rubric's criterion_weight values must total 100% for that assessment.
- "report_markdown" is deeper reasoning only and must NOT duplicate the rubric tables.
- Include one object in "assessments" for every approved assessment.`,
  },
  {
    id: 'layer5-integrity-ai',
    name: 'Assessment Integrity and Active AI Use',
    description: 'Design assessments so AI can support the learner but cannot replace learner thinking.',
    parentStage: 1,
    order: 5,
    productOutput: 'Assessment Integrity and Active AI Use Report',
    outputFields: [
      'Overall integrity position',
      'Main strengths',
      'Main risks',
      'SME attention points',
      'AI use framework',
      'Passive AI risk summary',
      'Learner ownership evidence',
      'AI-use disclosure requirements',
      'Context verification requirements',
      'Reflection or defense requirement',
      'Integrity flags',
    ],
    mode: 'single',
    singleModel: BASE_MODEL,
    councilModels: [],
    chairmanModel: BASE_MODEL,
    approvalRequired: true,
    regenerateEnabled: true,
    editEnabled: true,
    lockNextUntilApproval: true,
    taskPrompt: `You are Maestro Assessment Integrity Reviewer.

Core principle: Maestro assessments should be designed for ACTIVE, TRANSPARENT, and ACCOUNTABLE AI use — not passive AI outsourcing. Do NOT prohibit AI use by default. Design assessments so AI can support thinking but cannot replace the learner's context, judgment, decisions, and evidence.

Use as authoritative input:
- The "SME-APPROVED REDESIGNED ASSESSMENTS (AUTHORITATIVE)" section (final assessment titles, artifacts, refined CLO alignment).
- The "SME-APPROVED ASSESSMENT WEIGHTS & RUBRICS (AUTHORITATIVE)" section (selected weights and rubric criteria).

STRICT RULES:
- Do NOT redesign the assessments.
- Do NOT recreate or re-weight the rubric.
- Only ADD integrity and active-AI-use requirements: ownership evidence, AI-use disclosure, context verification, reflection/defense, and integrity flags.
- Include one object in "assessment_integrity_reviews" for every approved assessment, using the same assessment_id.
- "full_integrity_report" / "report_markdown" is deeper reasoning only and must NOT duplicate the card tables.

Output ONLY valid JSON in exactly this shape:
{
  "course_level_integrity_summary": {
    "overall_integrity_position": "string",
    "main_strengths": ["string"],
    "main_risks": ["string"],
    "sme_attention_points": ["string"],
    "ai_use_framework": [
      { "ai_use_category": "string", "meaning": "string", "allowed_status": "allowed | allowed_with_caution | not_acceptable", "disclosure_required": true }
    ],
    "full_integrity_report": "string"
  },
  "assessment_integrity_reviews": [
    {
      "assessment_id": "A1",
      "passive_ai_risk_summary": {
        "risk_level": "very_low | low | medium | high",
        "why_passive_ai_could_happen": "string",
        "why_assessment_resists_passive_ai": "string",
        "what_must_be_protected": ["string"]
      },
      "learner_ownership_evidence": [
        { "evidence_item": "string", "purpose": "string", "required_status": "required | optional | not_required", "use_status": "graded | integrity_evidence | support_only" }
      ],
      "ai_use_disclosure_requirements": [
        { "field": "string", "learner_must_explain": "string" }
      ],
      "context_verification_requirements": [
        { "check_item": "string", "required": true }
      ],
      "reflection_or_defense_requirement": "none | written_reflection | video_audio_explanation | oral_defense_if_flagged | sme_review_for_publication",
      "integrity_flags": ["string"]
    }
  ]
}

Use reflection by default; reserve oral/video defense for high-risk or high-stakes assessments.`,
  },
  {
    id: 'layer6-subtopic-architecture',
    name: 'Self-Paced Subtopic Architecture',
    description: 'Create self-paced learning territories under each refined CLO; do not copy weekly structure.',
    parentStage: 1,
    order: 6,
    productOutput: 'Self-Paced Subtopic Architecture Report',
    outputFields: [
      'Refined CLO',
      'Proposed subtopic',
      'Purpose',
      'CLO alignment',
      'Assessment connection',
      'Learning function',
      'Expected learning',
      'Possible node families',
      'Cross-CLO links',
      'Adaptive value',
      'Estimated learning effort',
      'Source evidence',
      'Recommendation',
      'SME decision',
    ],
    mode: 'council',
    singleModel: BASE_MODEL,
    councilModels: [BASE_MODEL, 'openai/gpt-4o', 'google/gemini-2.0-flash-001'],
    chairmanModel: BASE_MODEL,
    approvalRequired: true,
    regenerateEnabled: true,
    editEnabled: true,
    lockNextUntilApproval: true,
    memberSystemPrompt: `You are part of the Maestro Curriculum Re-Engineering Council.

Create a Self-Paced Subtopic Architecture for a university course being transformed into an adaptive self-paced learning journey.

Use the SME-approved refined CLOs and approved redesigned assessments as the primary foundation. Use the uploaded syllabus, readings, weekly plan, and credit-hour expectations only as source evidence. Do not copy the weekly plan as the course structure.

For each refined CLO, create a structured list of essential subtopics. Each subtopic is a learning territory, NOT a textbook chapter, week title, activity name, or content block.

Output STRUCTURED JSON (not only a narrative). Do not create mastery nodes, learning blocks, or learner-facing content yet.`,
    chairmanSystemPrompt: `You are the Chairman of the Maestro Subtopic Architecture Council.

Consolidate the members' subtopic proposals into one structured Self-Paced Subtopic Architecture. Remove duplication, merge/split where needed, and highlight cross-CLO links.

Return STRUCTURED JSON with this exact shape:
{
  "self_paced_subtopic_architecture": {
    "course_summary": {
      "course_title": string,
      "total_refined_clos": number,
      "total_subtopics": number,
      "architecture_summary": string,
      "source_evidence_note": "The weekly plan is used as source evidence only, not copied as the self-paced structure.",
      "full_report": string
    },
    "clo_sections": [
      {
        "clo_id": "CLO-1",
        "refined_clo": string,
        "related_assessments": ["A1"],
        "clo_learning_journey_summary": string,
        "subtopics": [
          {
            "subtopic_id": "CLO1-ST1",
            "proposed_subtopic": string,
            "purpose": string,
            "clo_alignment": string,
            "assessment_connection": ["A1"],
            "learning_function": "foundational | applied | integrative | bridge | assessment_preparation",
            "expected_learning": string,
            "possible_node_families": ["concept_node","judgment_node","misconception_node","application_node","bridge_node","assessment_preparation_node"],
            "cross_clo_links": [{ "linked_clo_id": "CLO-4", "reason": string }],
            "adaptive_value": string,
            "estimated_learning_effort": "low | moderate | high",
            "source_evidence": ["refined_clo","assessment","syllabus","readings"],
            "recommendation": "keep | merge | split | move | remove"
          }
        ]
      }
    ]
  },
  "report_markdown": string
}

Provide a course-level architecture summary, a CLO-level learning journey summary, and a full narrative report for transparency. Do not create mastery nodes or learner-facing materials yet.`,
    taskPrompt: `Using all approved Stage 1 layer outputs below, produce a structured Self-Paced Subtopic Architecture. Build every subtopic against the "SME-APPROVED REFINED CLOs (AUTHORITATIVE)" section; treat original CLO wording as reference only. Connect each subtopic to the approved assessments and respect the approved integrity/ownership requirements. Return the structured JSON shape defined in the system prompt (self_paced_subtopic_architecture with course_summary and clo_sections[].subtopics[]), plus report_markdown.`,
  },
];

export const STAGE1_LAYER_IDS = defaultStage1Layers.map((l) => l.id);
