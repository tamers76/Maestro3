# Maestro V1 — Build-Readiness Review & Cursor Implementation Package

*Companion to **Maestro-Node-Engine-Build-Spec.md** (Steps 1–9). That companion spec is referenced by this planning package but is not currently present in this repository. This document turns the specification into a phased, buildable V1 and now reflects the implemented Postgres-first Course Architect + Maestro Node Engine application. Section numbers like "§8.14" point into the Build Spec.*

---

## 0. Framing — build a vertical slice, not twelve parallel modules

The biggest risk in a V1 of this size is building many services that each work in isolation but never connect into one working pipeline. So the organising principle of this package is:

> **First make ONE course flow end-to-end through the WHOLE pipeline, on ONE modality (text), for ONE node — then widen.**

The "golden path" V1 must prove:

```
upload syllabus → extract & refine CLOs → review/redesign assessments → generate subtopics
→ generate a node → node experience blueprint → Level 2 content spec → produce a TEXT object
via the text prompt template → wrap in the generated-object envelope
→ surface for SME/admin review → approve / regenerate → render a learner preview
```

Everything else (more modalities, more screens, more autonomy) is **widening** an already-working spine. The build order in §6 and the phases in §9 enforce this.

A note on implementation status: V1 now has a working **Course Architect → Node Engine** spine. Stage 1 layers, reference ingestion/retrieval, node sets, node editing, blueprints, content specs, text production, structured visual production/editing, video briefs, and optional HeyGen render submission are implemented. Postgres/pgvector is the source of truth; Neo4j is an optional projection. LMS/SCORM, runtime learner-model writes, simulation, and full learner routing remain deferred (§7).

---

## 1. V1 Build Scope

### In scope (V1 builds these for real)

| # | Capability | Spec ref |
|---|---|---|
| 1 | Course intake & syllabus extraction | Step 1 inputs / academic contract |
| 2 | CLO extraction & refinement | Course academic contract |
| 3 | Assessment review / redesign | Step 7 inputs, A1–A4 |
| 4 | Subtopic architecture | Step 2 |
| 5 | Node generation (node-set from a subtopic) | Step 2, Step 1 object |
| 6 | Node Experience Blueprint (Level 1) | §8.0 |
| 7 | Learning Object **Content Specification** (Level 2) | §8.1 |
| 8 | **Modality production** via prompt templates (Level 3) — text, structured_visual, and video production are implemented; interactive remains JSON/placeholder-first | §8.2–§8.14 |
| 9 | Generated-object **envelope** | §8.6 |
| 10 | **Step 9 validation** contracts are implemented; full object-level validator service remains to complete | §9.1–§9.16 |
| 11 | SME / admin **review workflow** | §9.8–§9.9, §8.11.1 governance |
| 12 | Prompt-template **registry & settings** (editable, versioned) | §8.14 |
| 13 | Evidence Map + Milestone Assessment Pack **as stored contracts** (read for validation; full runtime readiness deferred) | Step 4, Step 7 |

### Deferred (explicitly NOT in V1)

| Deferred item | Why deferred | Spec ref |
|---|---|---|
| Simulation engine | Reserved-deferred by design | §8.13 |
| Full runtime analytics / runtime monitoring automation | Later analytics build | §9.14 |
| Advanced / progressive autonomy (Levels 2–4 auto-proceed) | Earned over time; V1 stays at Level 0–1 (review-heavy) | §9.10 |
| Full Live AI Companion runtime behaviour | Runtime governed separately; V1 only stores the *handoff template* | §6.6–§6.7, §8.14.6 |
| Full interactive template **promotion lifecycle** (program→org→global) | V1 supports `course_only` + candidate creation only | §8.11.1 |
| Real image generation and full interactive runtime rendering | Mocked/deferred in V1 | §7 |
| LMS / SCORM export | Mocked/deferred in V1 | §9.15 |
| Runtime learner-model writes and routing execution | Stored/validated only; no adaptive runtime execution yet | §9.14–§9.15 |
| Tier-3 automated judgment checks | Route to SME-by-exception in V1 | §9.1 |

**V1 autonomy posture:** Level 0–1 only. Generation always produces a candidate; a human approves before publish/route. This is the spec's "conservative default — review more rather than less."

---

## 2. Implementation Modules

Each module below is a buildable unit. *Acceptance criteria are the contract for "done."*

### M1 — Schema & Enum Core
- **Purpose:** Single source of truth for all V1 data shapes and enums; everything imports from here.
- **Components:** `schemas/` (typed models), `enums/`, validation/serialization helpers (e.g. zod/pydantic-equivalent), DB migrations.
- **Schemas used:** all of §3.
- **APIs/actions:** none (library).
- **Dependencies:** none — built first.
- **Acceptance:** every §3 schema instantiable, serialisable, round-trips through storage; enums centralised; invalid enum value rejected at parse.

### M2 — Prompt Template Registry & Settings
- **Purpose:** Store the seven prompt templates as **editable, versioned** settings-layer objects; serve them to the production module.
- **Components:** `PromptTemplateRegistryService`, settings store, version-bump logic, audit fields.
- **Schemas:** `PromptTemplate`, `ModalityGenerationConfig`.
- **APIs/actions:** `listTemplates`, `getTemplate(id, version?)`, `updateTemplate` (creates new version), `getActiveVersion(vehicle)`.
- **Dependencies:** M1.
- **Acceptance:** the six active templates + simulation placeholder seedable from §8.14; editing creates a new version; existing generated objects keep their original `prompt_version`; audit fields populated.

### M3 — Course Intake & Academic Contract
- **Purpose:** Upload a syllabus, extract structure, store the `CourseAcademicContract`.
- **Components:** `SyllabusExtractionService` (LLM + parser), Postgres-backed course/artifact stores, intake UI hook.
- **Schemas:** `CourseAcademicContract`, `CLO`, `Assessment`.
- **APIs/actions:** `uploadSyllabus(file)`, `extractContract(docRef)`, `getContract(courseId)`, `updateContract`.
- **Dependencies:** M1; reuse existing document parsing where present.
- **Acceptance:** upload a real syllabus (e.g. MDLD602) → produces a contract with draft CLOs + assessments; human can edit/confirm; stored and retrievable.

### M4 — CLO Refinement
- **Purpose:** Refine extracted CLOs to measurable, aligned outcomes.
- **Components:** `CLORefinementService`, CLO review UI hook.
- **Schemas:** `CLO`.
- **APIs/actions:** `refineCLOs(courseId)`, `updateCLO`, `approveCLO`.
- **Dependencies:** M3.
- **Acceptance:** draft CLOs → refined suggestions with rationale; human approves; approval recorded.

### M5 — Assessment Review / Redesign
- **Purpose:** Review and redesign assessments A1–A4; store as the basis for milestone packs.
- **Components:** `AssessmentRedesignService`, assessment review UI hook.
- **Schemas:** `Assessment`, `MilestoneAssessmentPack` (stored, not yet runtime-evaluated).
- **APIs/actions:** `reviewAssessments(courseId)`, `redesignAssessment`, `generateMilestonePack(assessmentId)`.
- **Dependencies:** M4.
- **Acceptance:** each assessment maps to a stored milestone pack contract (per §7); `auto_approval_eligible:false` honoured (always flagged for SME).

### M6 — Subtopic Architecture
- **Purpose:** Generate the subtopic structure from the approved contract.
- **Components:** `SubtopicGenerationService`, subtopic UI hook.
- **Schemas:** `Subtopic`.
- **APIs/actions:** `generateSubtopics(courseId)`, `updateSubtopic`, `approveSubtopics`.
- **Dependencies:** M4 (CLOs approved).
- **Acceptance:** approved contract → ordered subtopics tied to CLOs; human-editable; approved.

### M7 — Node Generation
- **Purpose:** Generate a node-set from an approved subtopic (Step 2), each node a full Step 1 object incl. the primary Evidence Check requirement and misconception bindings.
- **Components:** `NodeGenerationService`, node list UI hook.
- **Schemas:** `Node`, `KnowledgeComponent`, `EvidenceMap` (primary EC requirement), misconception bindings.
- **APIs/actions:** `generateNodes(subtopicId)`, `getNode`, `updateNode`, `approveNode`.
- **Dependencies:** M6; misconception library (V1: per-node bindings; full registry can be minimal).
- **Acceptance:** a subtopic → coherent node-set; the worked node ("Distinguish description from critical evaluation") reproducible; each node carries `ec_node_<id>_primary`.

### M8 — Node Experience Blueprint (Level 1)
- **Purpose:** For a node, produce the experience plan (object sequence, purposes, suggested vehicles) — §8.0.
- **Components:** `NodeBlueprintService`, blueprint UI screen.
- **Schemas:** blueprint object (Level 1), object-family assignment (§8.0a).
- **APIs/actions:** `generateBlueprint(nodeId)`, `updateBlueprint`, `approveBlueprint`.
- **Dependencies:** M7.
- **Acceptance:** node → blueprint listing node learning objects + any milestone support objects, each with `suggested_vehicle` and purpose; mandatory primary-EC object present.

### M9 — Content Specification (Level 2)
- **Purpose:** For each blueprint object, produce the **academic source-of-truth** spec carrying `preservation_rules` and grounding — §8.1.
- **Components:** `ContentSpecService`, grounding call (reuse existing RAG), content-spec review UI.
- **Schemas:** Level 2 content spec, `grounding_references`, `grounding_strength`, `preservation_rules`.
- **APIs/actions:** `generateContentSpec(objectId)`, `groundContentSpec`, `updateContentSpec`, `approveContentSpec`.
- **Dependencies:** M8; **existing reference-grounding retrieval**.
- **Acceptance:** blueprint object → grounded Level 2 spec; `grounding_strength` computed; weak grounding flagged; spec approvable.

### M10 — Modality Production (Level 3)
- **Purpose:** Transform an **approved** Level 2 spec into a produced object via the matching prompt template (§8.14). Implemented vehicles include text, structured visual, and video brief/render flow.
- **Components:** `ModalityProductionService` (orchestrator), per-vehicle adapters (text, structured_visual, video), structured visual renderer/editor, optional HeyGen renderer with mock fallback, reuse the existing **chat executor**.
- **Schemas:** `GeneratedObjectEnvelope` (§8.6), text segment model (§8.8), structured-visual `modality_specific` (§8.9), `InteractiveInstance`/`NewTemplateCandidate` (§8.11.1).
- **APIs/actions:** `produceObject(contentSpecId, vehicle)`, `regenerate(objectId, reason)`.
- **Dependencies:** M2 (templates), M9 (approved spec), chat executor.
- **Acceptance:** approved text spec → valid envelope with `content.segments`, audit fields (`prompt_template_id/version`, `generation_mode`), `fidelity_check`; structured_visual produces governed semantic visual JSON that can be rendered and edited; video brief produces HeyGen-ready data and can render through HeyGen when configured or a mock when not.

### M11 — Step 9 Validator (object-level)
- **Purpose:** Independently validate a produced envelope; emit `ValidationResult` and a governance decision — §9.
- **Components:** `ValidationService` with **Tier-1 deterministic checks** (code) + **Tier-2 retrieval-backed grounding** (reuse RAG) + the **decision-composition rule** (§9.8); Tier-3 → route to SME.
- **Schemas:** `ValidationResult` (§9.16).
- **APIs/actions:** `validateObject(envelope)`, `revalidate(objectId)`.
- **Dependencies:** M10, M9 (spec to compare against), RAG.
- **Acceptance:** a clean text object → `auto_proceed`-eligible *but held at Level 0–1*; a seeded bad object (invented claim / missing citation / EC reveals answer) → correct `failed`/`needs_revision`; milestone-pack-linked object never returns `auto_proceed` (hard gate, §9.8 rule 3).

### M12 — Review Workflow (SME / Admin)
- **Purpose:** Queue validated objects for human decision; record approve / regenerate / revision / reject with lineage.
- **Components:** `ReviewWorkflowService`, SME review queue UI, role gating (SME vs Admin vs Dev/QA).
- **Schemas:** review decision records, governance status transitions (§8.2 enum).
- **APIs/actions:** `listReviewQueue(filter)`, `getObjectForReview`, `submitReviewDecision`, `routeToOwner`.
- **Dependencies:** M11.
- **Acceptance:** validated objects appear with priority + reasons + the **right visibility** (preview/fields/feedback/criteria/routing/governance — **not** raw JSON/code, per §8.11.1); SME approve/regenerate works; decisions audited.

### M13 — Learner Preview
- **Purpose:** Render the approved object set for a node as a learner-facing preview structure (read-only V1).
- **Components:** `LearnerPreviewService`, preview UI (text rendered for real; visual/interactive **mocked** as placeholders with their text-equivalents).
- **Schemas:** envelope (read).
- **APIs/actions:** `getNodePreview(nodeId)`.
- **Dependencies:** M12 (approved objects).
- **Acceptance:** a node's approved objects display in sequence; text renders from segments; mocked modalities show placeholder + text-equivalent; Evidence Check shows its prompt structure (no real capture in V1).

---

## 3. Data Schemas to Implement First

*Minimum fields for V1. "→" denotes a relationship/reference. Full field sets live in the Build Spec; this is the V1 subset.*

### CourseAcademicContract
- **Required:** `course_id`, `title`, `level` (e.g. postgraduate), `clo_ids[]` → CLO, `assessment_ids[]` → Assessment, `status` (draft|approved).
- **Optional:** `source_doc_ref`, `program_id`, `notes`.
- **Relationships:** owns CLOs and Assessments; root of the course.

### CLO
- **Required:** `clo_id`, `course_id`, `statement`, `status` (draft|refined|approved).
- **Optional:** `bloom_level`, `aligned_assessment_ids[]`, `rationale`.

### Assessment
- **Required:** `assessment_id`, `course_id`, `label` (A1–A4), `type`, `status`.
- **Optional:** `weighting`, `clo_ids[]`, `redesign_notes`, `milestone_pack_id` → MilestoneAssessmentPack.

### Subtopic
- **Required:** `subtopic_id`, `course_id`, `title`, `order`, `clo_ids[]`, `status`.
- **Optional:** `description`, `node_ids[]` → Node.

### Node
- **Required:** `node_id`, `subtopic_id`, `node_type` (enum: concept|distinction|misconception|procedure|judgment|application|integration|reflection|threshold|bridge|assessment_preparation), `title`, `kc_ids[]` → KnowledgeComponent, `primary_evidence_check_requirement` (`ec_node_<id>_primary`), `status`.
- **Optional:** `misconception_bindings[]`, `prepares_for_assessment_id`, `is_bridge`, `is_threshold`.
- **Relationships:** belongs to Subtopic; owns NodeLearningObjects; references Misconceptions and EvidenceMap.

### KnowledgeComponent
- **Required:** `kc_id`, `label`, `node_ids[]`.
- **Optional:** `description`, `prerequisite_kc_ids[]`.

### EvidenceMap
- **Required:** `evidence_map_id`, `node_id`, `must_capture_signals[]` (response|reasoning|confidence|process), `diagnostic_bands[]` (secure|fragile|knowledge_gap|misconception), `misconception_trap_ref`.
- **Optional:** `preferred_evidence_mode`, `confirming_probe`.

### MilestoneAssessmentPack
- **Required:** `milestone_pack_id`, `assessment_id`, `name`, `static_layer` (brief/rubric/etc.), `readiness_conditions[]`, `auto_approval_eligible:false`, `status`.
- **Optional:** `dynamic_readiness_logic` (definition only in V1, not runtime-evaluated), `support_object_ids[]`.
- **Note:** **always SME-reviewed** (hard gate).

### NodeLearningObject
- **Required:** `object_id`, `object_family:"node_learning_object"`, `parent_node_id`, `kc_ids[]`, `node_object_purpose`, `produced_modality`, `governance_status`, `grounding_strength`, `prompt_template_id`, `prompt_version`, `asset_ref`.
- **Optional:** `addresses_misconceptions[]`, `content_pattern`, `estimated_effort_minutes`, `accessibility`.
- **Relationships:** belongs to Node; wrapped by GeneratedObjectEnvelope.

### MilestoneSupportObject
- **Required:** `object_id`, `object_family:"milestone_support_object"`, `parent_milestone_pack_id`, `milestone_support_purpose`, `produced_modality`, `milestone_section_ui`, `governance_status`.
- **Optional:** as for NodeLearningObject (minus node-specific fields).

### ModalityGenerationConfig
- **Required:** `id` (vehicle), `generatorKind` (chat|image|video), `taskPrompt` (→ active PromptTemplate), `mode` (single|council).
- **Optional:** `productionTarget`, `memberSystemPrompt`, `chairmanSystemPrompt`, vehicle settings (e.g. HeyGen IDs — **mocked**).

### PromptTemplate
- **Required:** `prompt_template_id`, `prompt_template_name`, `vehicle`, `version`, `taskPrompt`, `output_schema_ref`, `last_updated_by`, `last_updated_at`.
- **Optional:** `change_note`, `status` (draft|approved|deprecated).
- **Rule:** editing → new version; never mutate a published version.

### GeneratedObjectEnvelope
- **Required:** the common envelope (§8.6): identity + family + parent refs + purpose + `produced_modality` + `content`/`modality_specific` + `grounding_references` + `grounding_strength` + audit (`prompt_template_id/name/version`, `generation_mode`) + `governance_status` + `asset_ref` + `fidelity_check`.
- **Optional:** `milestone_section_ui` (milestone support only), `estimated_effort_minutes`, `accessibility`.

### ValidationResult
- **Required:** `validation_id`, `validated_object_id`, `object_version`, `validation_timestamp`, `validation_status`, `governance_decision`, `review_priority`, `checks{}` (with `tier`), `risk_flags[]`, `can_publish`, `can_route_to_learner`, `can_write_to_learner_model`, `audit_refs{}`.
- **Optional:** `required_actions[]`, role-review flags.

### InteractiveTemplateProfile
- **Required:** `template_id`, `template_name`, `template_version`, `template_form_schema`, `supported_node_types[]`, `supported_object_purposes[]`, `evidence_check_capable`, `accessibility_status`, `approval_status`, `reuse_scope` (V1: `course_only`).
- **Optional:** `best_for[]`, `not_for[]`, `required_signals_supported[]`, `feedback_capabilities[]`, `learner_model_write_capabilities[]`.

### InteractiveInstance
- **Required:** `template_id`, `template_version`, `template_form_values`, `instance_purpose`, `evidence_check_role`, `signals_to_capture[]`, `feedback_logic`, `routing_connection`, `learner_model_write{}`.
- **Optional:** `attempt_policy`, `feedback_timing`, `diagnostic_bands[]`.

### NewTemplateCandidate
- **Required:** `template_candidate_id`, `template_name`, `learning_purpose`, `why_existing_templates_do_not_fit`, `interaction_behavior`, `learner_actions[]`, `template_form_schema`, `evidence_capture_requirements[]`, `accessibility_requirements[]`, `testing_checklist[]`, `suggested_reuse_scope`, build/QA/approval flags.
- **Companion:** `cursor_build_package` (mirrors candidate for the dev pipeline).

---

## 4. UI Screens for V1

*Role key: Author/Designer (builds the course), SME (academic review), Admin/Learning Design Lead (workflow + templates), Learner (preview only).*

### S1 — Course Intake
- **Role:** Author. **Sees:** upload control, extraction progress, draft contract summary. **Actions:** upload syllabus, trigger extraction, confirm. **Backend:** write `CourseAcademicContract`, `CLO`, `Assessment`. **Mock:** none (core path).

### S2 — Academic Contract Dashboard
- **Role:** Author/Admin. **Sees:** course overview — CLOs, assessments, subtopics, node counts, statuses. **Actions:** navigate into each area, see progress. **Backend:** read contract graph. **Mock:** none.

### S3 — CLO Review
- **Role:** Author + SME. **Sees:** draft vs refined CLOs with rationale. **Actions:** edit, approve. **Backend:** read/write `CLO`. **Mock:** none.

### S4 — Assessment Review
- **Role:** Author + SME. **Sees:** A1–A4, redesign suggestions, linked milestone pack. **Actions:** edit, approve, generate milestone pack. **Backend:** read/write `Assessment`, `MilestoneAssessmentPack`. **Mock:** none (but readiness logic stored, not evaluated).

### S5 — Subtopic Architecture
- **Role:** Author. **Sees:** ordered subtopics tied to CLOs. **Actions:** reorder, edit, approve, generate nodes. **Backend:** read/write `Subtopic`. **Mock:** none.

### S6 — Node Blueprint
- **Role:** Author. **Sees:** a node's object sequence (Level 1), each with purpose + suggested vehicle; the primary EC object highlighted. **Actions:** edit blueprint, approve, generate content specs. **Backend:** read/write blueprint + `Node`. **Mock:** none.

### S7 — Prompt Template Settings
- **Role:** Admin. **Sees:** the seven templates, versions, `taskPrompt` editor, audit. **Actions:** edit (→ new version), activate. **Backend:** read/write `PromptTemplate`, `ModalityGenerationConfig`. **Mock:** none (but vehicle settings like HeyGen IDs are placeholder fields).

### S8 — Generated Object Review
- **Role:** Author + SME. **Sees:** produced object — learner preview, editable authoring fields, grounding/citations, `fidelity_check`, governance status. **Actions:** approve, request revision, regenerate. **Backend:** read envelope + `ValidationResult`; write decision. **Mock:** visual/interactive shown as placeholder + text-equivalent.

### S9 — Step 9 Validation Panel
- **Role:** SME/Admin (embedded in S8). **Sees:** the `checks{}` with tier + status + findings, `risk_flags`, decision, can_publish/route/write. **Actions:** drill into a finding. **Backend:** read `ValidationResult`. **Mock:** Tier-3 checks show "routed to SME."

### S10 — SME Review Queue
- **Role:** SME, Admin. **Sees:** prioritised list (urgent→standard) with reasons; filters by risk flag / node / milestone. **Actions:** open, decide, route to owner. **Backend:** read queue, write decisions. **Mock:** none.

### S11 — Learner Preview
- **Role:** Learner (and Author to inspect). **Sees:** the node's approved objects in sequence; text rendered; mocked modalities as placeholders; EC prompt structure. **Actions:** navigate (read-only). **Backend:** read approved envelopes. **Mock:** all runtime capture, learner model, routing execution.

---

## 5. Backend Services / Actions

| Service | Key actions | Reuses / net-new |
|---|---|---|
| Syllabus Extraction | `uploadSyllabus`, `extractContract` | reuse doc parsing; net-new orchestration |
| CLO Refinement | `refineCLOs`, `approveCLO` | net-new |
| Assessment Redesign | `reviewAssessments`, `generateMilestonePack` | net-new |
| Subtopic Generation | `generateSubtopics`, `approveSubtopics` | net-new |
| Node Generation | `generateNodes`, `approveNode` | net-new |
| Blueprint | `generateBlueprint`, `approveBlueprint` | net-new |
| Content Spec | `generateContentSpec`, `groundContentSpec` | **reuse RAG**; net-new spec logic |
| Modality Production | `produceObject`, `regenerate` | **reuse chat executor**; net-new orchestration + adapters |
| Prompt Template Registry | `getActiveVersion`, `updateTemplate` | implemented with immutable version append |
| Validation (Step 9) | `validateObject`, `revalidate` | **reuse RAG** for Tier 2; net-new Tier 1 + decision rule |
| Review Workflow | `listReviewQueue`, `submitReviewDecision`, `routeToOwner` | net-new |
| Asset / Versioning | `storeAsset`, `bumpVersion`, `getLineage` | net-new |

---

## 6. Build Order (exact Cursor sequence)

1. **M1 — Schemas & enums** (everything depends on this).
2. **M2 — Prompt template registry & settings** + seed the seven templates from §8.14.
3. **M3 — Course intake & academic contract storage** (upload → contract).
4. **M4 — CLO extraction/refinement flow.**
5. **M5 + M6 — Assessment redesign (→ stored milestone packs) + subtopic generation.**
6. **M7 — Node object generation** (reproduce the worked node).
7. **M8 + M9 — Blueprint (Level 1) → Content Specification (Level 2)** with grounding.
8. **M10 (text only)** — produce the **text** object into the envelope. *This is the moment the spine is "alive."*
9. **M11 — Step 9 validation** contracts are present; complete the validator service/route before treating validation as an automated gate.
10. **M12 — SME review queue** (approve / regenerate).
11. **M13 — Learner preview** (text renders; rest placeholder).
12. **Widen M10** — structured_visual and video production are implemented; full interactive instances remain JSON/placeholder-first until the runtime widget layer exists.

*Checkpoint after step 11: the full golden path works on text. Only then widen modalities.*

---

## 7. What to Mock First

| Mock | V1 stand-in |
|---|---|
| LMS integration | `MockLmsExporter` — logs the high-level payload (completion/status/readiness/credit) that *would* be sent; no real connection (§9.15). |
| HeyGen video generation | Optional live HeyGen render when `HEYGEN_API_KEY` and avatar/voice settings are configured; otherwise the renderer falls back to a contract-shaped mock. |
| Full image generation | `MockImageRenderer` — returns a placeholder image ref + the alt_text/text_equivalent. |
| Interactive rendering | Render the **instance JSON** + a static placeholder; no full adaptive widget runtime. |
| Runtime learner model | `MockLearnerModel` — stores nothing diagnostic; preview only. |
| Live AI Companion runtime handoff | Store the **handoff template**; do not execute it. |
| Analytics / runtime monitoring | None in V1; manual SME loop only. |
| SCORM export | Mocked with LMS. |

**Mocking rule:** every mock must honour the **real contract shape** (same envelope, same fields) so swapping in the real implementation later needs no schema change.

---

## 8. Acceptance Criteria (V1 "done")

V1 is working when, on a real syllabus, a user can:

1. **Upload** a syllabus and get an extracted academic contract.
2. **Extract & refine CLOs**, and approve them.
3. **Review/redesign assessments** and generate stored **milestone packs** (each flagged SME-required).
4. **Generate subtopics → nodes**, reproducing the worked node with its primary EC requirement.
5. **Generate a Node Blueprint (Level 1)** and an approved **Content Spec (Level 2)** with grounding + `grounding_strength`.
6. **Produce a TEXT object** via the text prompt template into a valid **envelope** (audit fields, `fidelity_check`).
7. **Produce a structured_visual** and video brief/render object the same way; interactive remains a placeholder/runtime-deferred path.
8. **Run Step 9 validation** once the validator service is complete — clean object passes (held at Level 0–1); seeded-bad object correctly fails; milestone-linked object never auto-proceeds.
9. **Show the SME review queue** with priority + reasons + correct visibility.
10. **Approve / regenerate** an object, with lineage recorded.
11. **Render a learner preview** of the node (text real; others placeholder).

*If all eleven hold on one course end-to-end, V1 is proven and ready to widen.*

---

## 9. Cursor Build Package — Maestro V1

> **Paste-ready brief for Cursor. Build in phases; do not skip the schema phase; keep every mock contract-shaped.**

### Objective
Build and maintain the Maestro V1 "golden path": **syllabus → Course Architect Stage 1 layers → approved subtopic architecture → node set → blueprint → content spec → produced object envelope → SME review / iteration**, widening across text, structured visuals, and video production. V1 stays at autonomy **Level 0–1** (human approves before publish). Reuse the existing **reference-grounding retrieval** and **chat executor**; keep runtime learner routing, LMS/SCORM, simulation, and full interactive execution deferred.

### Build phases
- **Phase 0 — Foundations:** schemas/enums, Postgres/pgvector persistence, RBAC, prompt registry, modality config.
- **Phase 1 — Intake→Structure:** syllabus/form intake, Stage 1 layer review, CLO refinement, assessment redesign, rubric/integrity review, approved subtopic architecture.
- **Phase 2 — Nodes→Spec:** node sets, node editing/reopen/regenerate, blueprint generation/approval, content specs + grounding.
- **Phase 3 — Produce→Review:** text objects, structured visuals, video briefs, optional video render, SME edits/approval and audit.
- **Phase 4 — Deferred runtime:** full interactive execution, learner model writes/routing, LMS/SCORM, simulation.

### Modules
M1 Schema Core · M2 Prompt Registry · M3 Intake/Contract · M4 CLO Refinement · M5 Assessment/Milestone · M6 Subtopics · M7 Nodes · M8 Blueprint · M9 Content Spec · M10 Modality Production · M11 Step 9 Validator · M12 Review Workflow · M13 Learner Preview. *(Details in §2.)*

### Schemas (Phase 0)
CourseAcademicContract, CLO, Assessment, Subtopic, Node, KnowledgeComponent, EvidenceMap, MilestoneAssessmentPack, NodeLearningObject, MilestoneSupportObject, ModalityGenerationConfig, PromptTemplate, GeneratedObjectEnvelope, ValidationResult, InteractiveTemplateProfile, InteractiveInstance, NewTemplateCandidate. *(Fields in §3.)*

### UI components
S1 Intake · S2 Contract Dashboard · S3 CLO Review · S4 Assessment Review · S5 Subtopics · S6 Node Blueprint · S7 Prompt Template Settings · S8 Generated Object Review · S9 Step 9 Panel · S10 SME Review Queue · S11 Learner Preview. *(Details in §4.)*

### API endpoints / actions (minimum)
`uploadSyllabus`, `extractContract`, `getContract` · `refineCLOs`, `approveCLO` · `reviewAssessments`, `generateMilestonePack` · `generateSubtopics`, `approveSubtopics` · `generateNodes`, `approveNode` · `generateBlueprint`, `approveBlueprint` · `generateContentSpec`, `groundContentSpec`, `approveContentSpec` · `getActiveVersion`, `updateTemplate` · `produceObject`, `regenerate` · `validateObject`, `revalidate` · `listReviewQueue`, `submitReviewDecision`, `routeToOwner` · `getNodePreview`.

### Validation rules (Step 9, V1 subset)
- **Tier 1 (deterministic, hard block):** required metadata/audit fields present; citations on quotation/definition/table/formula; valid enums; `anchor_content` vs `runtime_handoff` mutual exclusivity; **no HeyGen API IDs in video prompt**; interactive `template_decision` populates exactly one of instance/candidate + fallback when proposing; EC flags (`store_first_attempt`, feedback timing, diagnostic bands) present; template-form-values complete vs schema.
- **Tier 2 (retrieval-backed):** every load-bearing claim matches a retrieved passage; unmatched = finding; weak grounding flagged.
- **Decision composition (§9.8):** any Tier-1 fail → block; grounding fail → no auto-proceed; **milestone-pack-linked / high-risk EC → never auto-proceed**; Tier-3 doubt or `validator_uncertainty` → escalate; else `auto_proceed`-eligible but **held at Level 0–1** (human approves).
- **Tier 3:** route to SME (not automated in V1).

### Test cases
1. Real syllabus → contract with CLOs + assessments.
2. CLOs refine + approve; approval recorded.
3. Assessment → milestone pack with `auto_approval_eligible:false`.
4. Subtopic → node-set; worked node reproducible; `ec_node_<id>_primary` present.
5. Blueprint → content spec; weak grounding flagged.
6. Approved text spec → valid envelope (audit + fidelity_check).
7. structured_visual + video brief/render objects produced as valid envelopes; interactive remains placeholder/runtime-deferred.
8. **Bad-object tests:** invented claim → grounding fail; missing citation → Tier-1 fail; EC reveals answer → fail; pictorial carrying academic text → fail/reroute.
9. Milestone-linked object → never `auto_proceed`.
10. Review queue ordering by priority; approve + regenerate both work with lineage.
11. Learner preview renders text; placeholders for mocked modalities.
12. Edit a prompt template → new version; previously generated objects keep old version.

### Deferred items
Simulation engine · runtime analytics/monitoring automation · advanced autonomy (Levels 2–4) · full Live AI Companion runtime · interactive template promotion (program/org/global) · real image generation · full interactive runtime rendering · LMS/SCORM export · runtime learner-model writes/routing execution · automated Tier-3 judgment.

### Do-not-build-yet list (guard rails)
- Do **not** wire real image generation or full interactive rendering — use contract-shaped mocks/placeholders.
- Do **not** require HeyGen for local development — live video rendering remains optional and must fall back to the mock path when not configured.
- Do **not** build runtime learner-model writes or routing **execution** — V1 stores/validates, it does not run the adaptive engine at runtime.
- Do **not** implement auto-proceed-without-human — V1 is Level 0–1.
- Do **not** export anything to an LMS.
- Do **not** build the simulation engine or template promotion lifecycle.
- Do **not** let a clean Step 9 sheet bypass the milestone/EC human gate.

---

*End of Maestro V1 Build-Readiness & Cursor Package. Pairs with Maestro-Node-Engine-Build-Spec.md (Steps 1–9).*
