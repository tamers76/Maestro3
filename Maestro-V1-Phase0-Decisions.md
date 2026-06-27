# Maestro V1 — Phase 0 Decisions Sheet

*Historical Phase 0 decision record for M1 (Schema/Enum Core) and M2 (Prompt-Template Registry). This file now records the decisions reflected in the live codebase, including the Postgres/pgvector primary store, optional Neo4j projection, RBAC, and Node Engine prompt/config persistence.*

*Pairs with: Maestro-V1-Build-Readiness-and-Cursor-Package.md and Maestro-Node-Engine-Build-Spec.md.*

---

## D1 — Storage substrate: Postgres primary, Neo4j projection

The implemented decision is **Postgres/pgvector first**. All authoritative entities, settings, auth/RBAC data, audit events, pipeline artifacts, Node Engine objects, reference chunks, and embeddings live in Postgres. JSON-shaped artifacts are stored as JSONB where appropriate, and vectors live in pgvector columns.

**Postgres — source of truth:**
- Course and Stage 1 artifacts, CLO refinements, assessment redesigns, weighting rubrics, integrity review, subtopic architecture.
- Node Engine objects: node sets, node edits, blueprints, content specs, prompt templates, modality config, produced objects, reference coverage config, and node-generation prompt versions.
- Auth/RBAC, course ownership, reviewers/students, review requests, audit events, settings, digital library metadata, references, and RAG chunks.

**Neo4j — optional graph projection:**
- Used for traversal/DAG/visualization and graph-oriented compatibility.
- Startup does not require Neo4j. The server starts in degraded graph mode when Neo4j is unavailable.
- Entity reads/writes do not depend on Neo4j.

**Filesystem — binary storage:**
- Uploaded syllabi, reference/library files, covers, avatars, compiled exports, and rendered/stored videos live on disk with metadata in Postgres.

> **Decision recorded:** Postgres/pgvector is authoritative; Neo4j is optional projection only.

---

## D2 — ID convention

`ec_node_<node_id>_primary` is fixed by the spec. Everything else needs a convention so references resolve across modules.

**Recorded default:** human-readable **prefixed slugs** for course-structure entities, UUIDs for high-volume artifacts.
- Course-structure entities: `course_<slug>`, `clo_<course>_<n>`, `assess_<course>_<A1..A4>`, `subtopic_<course>_<n>`, `node_<subtopic>_<n>`, `kc_<n>`, `emap_<node_id>`, `mpack_<assessment_id>`.
- Evidence Check (fixed by spec): `ec_node_<node_id>_primary`.
- Artifacts: `obj_<uuid>` (envelopes), `val_<uuid>` (validation results), `tmplcand_<uuid>` (candidates).
- Prompt templates: keep the spec's literal IDs (`text_generation_prompt`, etc.) — they are stable names, with version carried separately (see D3).

*Why mixed:* slugs make course structure, optional graph projection, and audit logs readable while debugging V1; UUIDs avoid collision for the many generated objects/validations.

> **Decision recorded:** mixed slugs + UUIDs.

---

## D3 — Versioning mechanics (the core of M2)

"Edit → new version; published versions immutable; objects keep their original `prompt_version`" is the rule. M2 can't be built without the mechanism.

**Recorded default:**
- **Version identifier:** monotonic **integer per template** (`v1`, `v2`, …), plus an optional human `change_note`. Avoid semver in V1 — there's no public contract to communicate breaking-vs-minor; integers are simpler and unambiguous.
- **History storage:** each version is a **separate immutable record** keyed `(prompt_template_id, version)`; the registry tracks a pointer `active_version` per template. Never mutate a published version in place.
- **Resolution at generation time:** `getActiveVersion(vehicle)` returns `(prompt_template_id, version, taskPrompt)`; the produced object's envelope stores **that exact `prompt_version`**. Regeneration may use a newer active version → new object version (§9.13).
- **Provenance:** every version record carries `last_updated_by`, `last_updated_at`, `change_note`, `status` (draft|approved|deprecated). Only `approved` versions are selectable as active.

**The same mechanism applies to Step 9 itself** (`validation_version`) — when validator rules/thresholds change, that's a versioned change and existing passed objects aren't silently re-judged (§9.13). Build the version primitive once, reuse it for both.

> **Decision recorded:** monotonic integer versions plus active pointers; published versions are immutable.

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

> **Decision recorded:** centralize these enum vocabularies in the Node Engine/schema core and keep object governance status separate from validator governance decision.

---

## D5 — Council executor & RAG interface

The live code confirms both reuse points.

**Executor:**
- `backend/src/services/council.service.ts` provides the AI execution layer used by legacy stages and Node Engine services.
- Settings support single/council execution, council members, chairman model, member/chairman prompts, model selection, temperatures, and provider configuration.
- Node Engine modality config resolves the model per vehicle and stores prompt-template versions separately from model settings.

**RAG retrieval:**
- `backend/src/services/referenceRetrieval.service.ts` exposes reference retrieval for course-scoped grounding.
- Course references are ingested through `backend/src/services/referenceIngestion.service.ts` and related services for chunking, dedupe, contextual embedding, alignment, coverage, quality, and source suggestions.
- Retrieval uses Postgres/pgvector, with embedding provider/model/dimensions configured through environment/settings.

> **Decision recorded:** reuse the implemented council/chat executor and pgvector RAG services; do not introduce a second executor or vector backend.

---

## D6 — Two small consistency confirmations (cheap, prevents rework)

- **`governance_status` vs `governance_decision`:** as noted in D4, Step 8 objects carry `governance_status` (no `reject`); Step 9 emits `governance_decision` (adds `reject`). Decide the mapping: a Step 9 `reject` sets the object's `governance_status` to `needs_revision` or a new terminal `rejected` value. *Recommended:* add `rejected` to `governance_status` so the object can hold a terminal state; document that only Step 9 can set it.
- **Pre-existing build state:** the repo now carries Node Engine, auth/RBAC, library, audit, and pgvector tests. Keep `npm run build`, `npm --prefix frontend run build`, and `npm --prefix backend test` as the current verification commands. DB-backed tests remain opt-in through `RUN_DB_TESTS=1`.

> **Decisions recorded:** use separate `governance_status` and `governance_decision` enums; keep build/test status verified through the current scripts.

---

## Summary — what to lock before M1/M2

| # | Decision | Type |
|---|---|---|
| D1 | Postgres/pgvector primary store + optional Neo4j projection | recorded |
| D2 | ID convention | recorded |
| D3 | Version mechanics (integer + active-pointer, immutable versions) | recorded |
| D4 | Enum single-source list | recorded |
| D5 | Council executor + RAG interface | recorded |
| D6 | status/decision mapping + build/test verification | recorded |

With D1–D6 recorded, the implemented M1/M2 foundation is unambiguous: Postgres/pgvector owns state, Neo4j is projection-only, enums are centralized, prompt versions are immutable, and Node Engine generation reuses the existing executor/RAG services.

*End of Phase 0 Decisions Sheet.*
