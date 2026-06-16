# Maestro V1 — Phase 0 Decisions Sheet

*Resolve these **before** writing M1 (Schema/Enum Core) and M2 (Prompt-Template Registry). Each item gives a recommended default + rationale. Items marked **[CONFIRM IN REPO]** must be checked against the live codebase, not chosen on paper — Claude can't see the repo, so these need you or Cursor to verify against actual code rather than the spec's described intent.*

*Pairs with: Maestro-V1-Build-Readiness-and-Cursor-Package.md and Maestro-Node-Engine-Build-Spec.md.*

---

## D1 — Storage substrate: what is a graph node vs a document?

The spec uses Neo4j + file/JSON. V1 needs an explicit mapping so Cursor doesn't pick one substrate for everything and redo migrations later.

**Recommended split:**

**Graph (Neo4j) — the relational web (things connected by edges, traversed by routing/pathway logic):**
- `CourseAcademicContract`, `CLO`, `Assessment`, `Subtopic`, `Node`, `KnowledgeComponent`, `EvidenceMap`, `MilestoneAssessmentPack`
- Edges: `Course-[:HAS_CLO]->CLO`, `Course-[:HAS_ASSESSMENT]->Assessment`, `Subtopic-[:HAS_NODE]->Node`, `Node-[:TARGETS_KC]->KC`, `Node-[:HAS_EVIDENCE_MAP]->EvidenceMap`, `Node-[:PREPARES_FOR]->Assessment`, `Assessment-[:HAS_MILESTONE_PACK]->MilestoneAssessmentPack`, `CLO-[:ALIGNS_WITH]->Assessment`.
- *Why graph:* these are exactly the relationships §9.18 pathway validation traverses (sequence, routing targets, readiness-signal wiring, milestone evidence sources). Putting them in the graph makes that pass natural later.

**Document/JSON store — the produced artifacts and their audit (read/written as whole blobs, versioned, rarely traversed):**
- `GeneratedObjectEnvelope` (the produced learning/support objects), `ValidationResult`, `PromptTemplate` (+ versions), `ModalityGenerationConfig`, `InteractiveTemplateProfile`, `InteractiveInstance`, `NewTemplateCandidate`, Level 2 content specs, Level 1 blueprints.
- Each carries the **foreign keys** back to the graph (`parent_node_id`, `parent_milestone_pack_id`, `kc_ids[]`, `content_spec_id`) so the two stores join cleanly.

**The bridge:** an envelope is a document, but it has a lightweight graph stub `(:LearningObject {object_id})-[:BELONGS_TO]->(:Node)` so pathway validation can see object→node membership without loading every blob.

**[CONFIRM IN REPO]** What's already wired — is Neo4j live and connected? Is there an existing JSON/file store pattern (paths, naming)? Match the existing convention rather than introducing a second one.

> **Decision to record:** ____ (accept split as above / adjust which schemas go where)

---

## D2 — ID convention

`ec_node_<node_id>_primary` is fixed by the spec. Everything else needs a convention so references resolve across modules.

**Recommended:** human-readable **prefixed slugs** for graph entities, UUIDs for high-volume artifacts.
- Graph entities: `course_<slug>`, `clo_<course>_<n>`, `assess_<course>_<A1..A4>`, `subtopic_<course>_<n>`, `node_<subtopic>_<n>`, `kc_<n>`, `emap_<node_id>`, `mpack_<assessment_id>`.
- Evidence Check (fixed by spec): `ec_node_<node_id>_primary`.
- Artifacts: `obj_<uuid>` (envelopes), `val_<uuid>` (validation results), `tmplcand_<uuid>` (candidates).
- Prompt templates: keep the spec's literal IDs (`text_generation_prompt`, etc.) — they are stable names, with version carried separately (see D3).

*Why mixed:* slugs make the graph and logs readable while debugging V1; UUIDs avoid collision for the many generated objects/validations.

> **Decision to record:** ____ (accept / all-UUID / all-slug)

---

## D3 — Versioning mechanics (the core of M2)

"Edit → new version; published versions immutable; objects keep their original `prompt_version`" is the rule. M2 can't be built without the mechanism.

**Recommended:**
- **Version identifier:** monotonic **integer per template** (`v1`, `v2`, …), plus an optional human `change_note`. Avoid semver in V1 — there's no public contract to communicate breaking-vs-minor; integers are simpler and unambiguous.
- **History storage:** each version is a **separate immutable record** keyed `(prompt_template_id, version)`; the registry tracks a pointer `active_version` per template. Never mutate a published version in place.
- **Resolution at generation time:** `getActiveVersion(vehicle)` returns `(prompt_template_id, version, taskPrompt)`; the produced object's envelope stores **that exact `prompt_version`**. Regeneration may use a newer active version → new object version (§9.13).
- **Provenance:** every version record carries `last_updated_by`, `last_updated_at`, `change_note`, `status` (draft|approved|deprecated). Only `approved` versions are selectable as active.

**The same mechanism applies to Step 9 itself** (`validation_version`) — when validator rules/thresholds change, that's a versioned change and existing passed objects aren't silently re-judged (§9.13). Build the version primitive once, reuse it for both.

> **Decision to record:** ____ (integer + pointer as above / alternative)

---

## D4 — Enum single-source-of-truth

Several enums recur across schemas. They must live **only** in the enum core; every schema imports them. Drift here is a silent bug source (e.g. the envelope's status accepting a value the ValidationResult rejects).

**Canonical enums to centralise in M1 (with their spec sources):**
- `governance_status`: `auto_proceed | recommended_sme_review | needs_sme_review | sme_approved | needs_revision | regenerate` (§8.2)
- `governance_decision` (Step 9): `auto_proceed | recommended_sme_review | needs_sme_review | needs_revision | regenerate | reject` (§9.8) — *note this is a superset of governance_status with `reject`; keep them as two related enums, not one, and document the relationship.*
- `node_type`: `concept | distinction | misconception | procedure | judgment | application | integration | reflection | threshold | bridge | assessment_preparation` (Step 1)
- `produced_modality` / vehicle: `text | structured_visual | pictorial_visual | video | interactive | simulation | learning_anchor` (§8.7)
- `content_pattern`: `scenario | case | comparison | worked_example | challenge_prompt | mini_artifact` (§8.1)
- `object_family`: `node_learning_object | milestone_support_object` (§8.0a)
- `node_object_purpose`: `orientation | explanation | worked_example | practice | evidence_check | remediation | enrichment | reflection | bridge | assessment_connection` (§8.14.6 schema)
- `diagnostic_band`: `secure | fragile | knowledge_gap | misconception` (Step 4)
- `must_capture_signals`: `response | reasoning | confidence | process` (Step 4)
- `grounding_strength`: `strong | weak` (§8.4)
- `validation_status`: `passed | passed_with_warnings | failed` (§9.16)
- `check_status`: `passed | warning | failed | not_applicable` (§9.16)
- `review_priority`: `standard | recommended | required | urgent`
- `reuse_scope`: `course_only | program_library | organization_library | global_library` (V1 uses `course_only` only, but define the full enum)
- `generation_mode`: `single | council`

**Rule for Cursor:** no string literal for any of the above anywhere except the enum core. A schema field types against the enum, never a raw string.

> **Decision to record:** ____ (accept list / additions)

---

## D5 — Council executor & RAG interface **[CONFIRM IN REPO]**

M2 wires templates into the existing **council/chat executor**, and M9/M11 call the existing **RAG retrieval**. The spec *describes* these; the live code is the authority. Confirm before building the adapters.

**Confirm for the executor:**
- Exact function/method signature and module path.
- Input shape: how does it take a system/task prompt, `mode: single | council`, and member/chairman prompts? Does it already support council, or is that net-new?
- Output shape: does it return raw text, a structured object, tool-call blocks? (M10 must parse the produced JSON out of it.)
- How are model selection / params passed?

**Confirm for RAG retrieval:**
- The retrieval entry point(s) and their signature (the spec references a `buildGroundedContext` / `retrieveReferenceChunks`-style layer — verify the real names).
- What it returns per chunk (text, source ref, score) — M9 needs source refs for citations; M11 Tier-2 needs them for claim-to-passage matching.
- Embedding default and whether it's already configured (the spec notes an Ollama `nomic-embed-text` default — confirm).

**Why this matters:** these are the two reuse points that prevent rebuilding. If the executor doesn't yet support council mode, that's a scope flag for Phase 0 (V1 can ship `single` mode and defer council — the prompt templates already say council is optional).

> **Decision to record:** executor signature ____ · council supported now? ____ · RAG entry point ____ · returns source refs? ____ · embedding default confirmed? ____

---

## D6 — Two small consistency confirmations (cheap, prevents rework)

- **`governance_status` vs `governance_decision`:** as noted in D4, Step 8 objects carry `governance_status` (no `reject`); Step 9 emits `governance_decision` (adds `reject`). Decide the mapping: a Step 9 `reject` sets the object's `governance_status` to `needs_revision` or a new terminal `rejected` value. *Recommended:* add `rejected` to `governance_status` so the object can hold a terminal state; document that only Step 9 can set it.
- **Pre-existing build state:** the spec flagged **two pre-existing tsc errors** and an Ollama embedding default as housekeeping. **[CONFIRM IN REPO]** — clear or knowingly defer these before layering M1/M2 on top, so new code isn't built on a red build.

> **Decisions to record:** reject→status mapping ____ · tsc errors cleared/deferred ____

---

## Summary — what to lock before M1/M2

| # | Decision | Type |
|---|---|---|
| D1 | Graph vs document storage split | choose + **[CONFIRM IN REPO]** |
| D2 | ID convention | choose |
| D3 | Version mechanics (integer + active-pointer, immutable versions) | choose |
| D4 | Enum single-source list | accept/extend |
| D5 | Council executor + RAG interface | **[CONFIRM IN REPO]** |
| D6 | status/decision mapping + clear pre-existing tsc errors | choose + **[CONFIRM IN REPO]** |

Once D1–D6 are recorded, Cursor has an unambiguous foundation for M1 (schema/enum core) and M2 (prompt-template registry), and the rest of the package's modules inherit consistent IDs, enums, storage, and versioning.

*End of Phase 0 Decisions Sheet.*
