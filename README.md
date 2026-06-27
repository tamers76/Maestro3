# Adaptive Curriculum Intelligence System

Maestro turns a course syllabus and reference corpus into a governed, node-based adaptive curriculum. The current application combines a **Course Architect** flow for syllabus extraction and academic review with the **Maestro Node Engine** for node generation, blueprints, grounded content specifications, produced learning objects, structured visuals, and video production.

## What Maestro Does

1. **Ingests a syllabus** from PDF/DOCX upload or form entry and extracts course metadata, CLOs, assessments, weekly/topic structure, and reference needs.
2. **Runs the Course Architect workflow** across Stage 1 layers: CLO refinement, assessment redesign, weighting rubric, integrity review, and subtopic architecture.
3. **Grounds the course in references** through per-course uploads, URL ingestion, an institution-wide digital library, pgvector retrieval, coverage checks, alignment review, and source suggestions.
4. **Generates adaptive nodes** from approved subtopics, requiring academic approval before downstream production.
5. **Creates node-level learning objects** through the Node Engine: node-set review, Level 1 blueprints, Level 2 grounded content specs, and Level 3 produced objects.
6. **Supports multiple modalities** including text objects, structured visual JSON rendered in the UI, HeyGen-ready video briefs, and optional HeyGen video rendering with mock fallback.
7. **Governance and access control** are built in through JWT auth, admin/professor/student roles, course ownership, reviewer assignments, review requests, and an audit log.

## Current Workflow

The default V1 route is:

```text
login -> dashboard -> create course -> Course Architect Stage 1 layers
-> approve subtopic architecture -> Node Engine node-set
-> approve nodes -> generate/approve blueprints
-> generate/ground/approve content specs
-> produce text, structured visual, or video objects
-> SME/admin review and iteration
```

Legacy Stages 2-5 are still present but parked behind `LEGACY_STAGES_ENABLED=true` on the backend and `VITE_LEGACY_STAGES_ENABLED=true` on the frontend. By default, the React course route uses the wizard that connects Course Architect output directly into the Maestro Node Engine.

## AI Execution

Maestro supports both single-model and council-style generation.

- **Single mode** runs one configured model for a stage or vehicle.
- **Council mode** lets multiple model members respond and a chairman model synthesize the result.
- Legacy stage prompts and Node Engine prompt templates are editable from the admin UI. Node Engine prompt edits create immutable new versions, while produced objects keep the exact prompt version used to generate them.

Supported AI providers are configured through settings and environment variables. OpenRouter and OpenAI are supported directly; Ollama health/model discovery is available from admin settings.

## Data Architecture

Maestro uses **PostgreSQL with `pgvector` as the required primary source of truth** for entities, settings, auth/RBAC, audit events, pipeline artifacts, library metadata, reference chunks, and embeddings.

**Neo4j is optional** and acts as a secondary graph projection for traversal and visualization. The server starts without Neo4j, and graph visualization degrades gracefully. Binary files such as uploaded syllabi, reference books, avatars, rendered videos, and compiled exports live on the filesystem with metadata in Postgres.

- **Postgres is required** at startup. The server exits if it cannot connect or ensure the schema.
- **pgvector is required** for reference retrieval. The `vector` extension must be created once by a superuser.
- **Neo4j is optional** and can be left down for most entity reads/writes.
- **Filesystem storage is used** for uploaded and generated binary assets.

## Prerequisites

- Node.js 18+
- PostgreSQL 15+ with `pgvector`
- Neo4j 5.x, optional
- OpenRouter API key, OpenAI API key, or local Ollama depending on configured provider
- HeyGen API key, optional, only for live video rendering

## Quick Start

1. Install dependencies:
   ```bash
   npm run install:all
   ```

2. Copy `.env.example` to `.env` at the repo root and configure required values:
   ```bash
   cp .env.example .env
   # DATABASE_URL=postgresql://maestro:<password>@127.0.0.1:5432/maestronexus
   # APP_DB_SCHEMA=maestro_v1
   # JWT_SECRET=<long-random-secret>
   # MAESTRO_ADMIN_EMAIL=admin@example.com
   # MAESTRO_ADMIN_PASSWORD=<strong-password>
   ```

   Use a least-privilege `maestro` role, not the `postgres` superuser. The app schema defaults to `maestro_v1`. The `.env.example` file includes the one-time SQL shape for creating the role/schema and enabling `vector`.

3. Apply the schema:
   ```bash
   npm --prefix backend run db:migrate
   ```

   After bulk reference ingestion, rebuild the HNSW index if needed:
   ```bash
   npm --prefix backend run db:build-vector-index
   ```

4. Start development servers:
   ```bash
   npm run dev
   ```

   Backend: `http://localhost:3001`

   Frontend: `http://localhost:5173`

5. Check health:
   ```text
   GET /api/health
   ```

   The health response reports Postgres and Neo4j status. Postgres must be connected for `status: "ok"`.

   Server startup also ensures the schema and runs admin/dev-user seeding. `db:migrate` remains the explicit verification path before development or deployment.

## Authentication And Roles

All curriculum, library, settings, admin, and node-engine APIs are authenticated. Development seeding can create local users when `SEED_DEV_USERS` is enabled, which is the default outside production. The local seed accounts are `admin/admin`, `prof/prof`, and `student/student`. For real use, set `MAESTRO_ADMIN_EMAIL`, `MAESTRO_ADMIN_PASSWORD`, and `JWT_SECRET`.

## Feature Flags

- `LEGACY_STAGES_ENABLED=true` enables retired backend Stages 2-5.
- `VITE_LEGACY_STAGES_ENABLED=true` switches the course UI back to the legacy `CourseDetail` page instead of the default wizard.

- **Admin** can manage users, course access, settings, models, prompts, database/RAG controls, audit logs, and library curation.
- **Professor** can create and author assigned/owned courses, request peer review, review assigned courses, ingest course references, and use approved library books.
- **Student** can authenticate and browse/read approved library materials; learner consumption is still limited compared with authoring workflows.

## Frontend Routes

- `/` - public landing page
- `/login` - authentication
- `/dashboard` - authenticated course dashboard
- `/courses/new` - course creation for admins/professors
- `/courses/:code/*` - Course Architect and Node Engine wizard
- `/library` - authenticated digital library browse/read/curation surface
- `/admin/*` - admin center for users, access, API keys, database, models, prompts, RAG, and audit
- `/profile` - profile, avatar, and password management

## API Surface

Core route families:

- `GET /api/health` - service health
- `/api/auth` - login, current user, profile, avatar, password
- `/api/users` - admin user management and course access assignments
- `/api/review-requests` - professor-to-professor course review requests
- `/api/courses` - course creation, details, progress streams, Course Architect layers, confirmations, legacy stages, graph, downloads, and generated course artifacts
- `/api/courses/:code/references` - course-scoped reference ingestion, retrieval preview, duplicate detection, alignment, coverage, and source suggestions
- `/api/library` - institution-wide approved book catalog, file/cover streaming, course reuse, and admin curation
- `/api/node-engine` - prompt templates, modality config, HeyGen catalog metadata, reference coverage config, node generation prompt, node sets, blueprints, content specs, produced objects, structured visuals, and video rendering
- `/api/settings` - admin-only app/provider/database/model settings and connectivity checks
- `/api/audit` - admin-only filtered audit log and facets

## Important Scripts

```bash
npm run dev                                  # backend + frontend
npm run build                                # backend tsc + frontend build
npm run install:all                          # root, backend, frontend installs
npm --prefix backend run db:migrate          # ensure schema and verify
npm --prefix backend run db:seed             # seed database data
npm --prefix backend run db:build-vector-index
npm --prefix backend run db:cleanup-orphaned-access
npm --prefix backend test
npm --prefix frontend run build
```

DB-backed tests run only when explicitly enabled:

```bash
RUN_DB_TESTS=1 APP_DB_SCHEMA=maestro_test npm --prefix backend test
```

Tests that require a fully seeded course additionally use `RUN_SEEDED_TESTS=1`.

## Project Structure

```text
backend/
  src/
    auth/          JWT auth, RBAC, permissions, course access
    db/            Drizzle schema, repositories, bootstrap, migrations, test support
    node-engine/   V1 node sets, blueprints, content specs, modalities, HeyGen, prompt registry
    routes/        Express route families
    services/      Course stages, council, files, references, library, audit, Neo4j projection
    models/        Shared TypeScript data contracts
frontend/
  src/
    components/    Course Architect, Node Engine, library, graph, and UI components
    contexts/      Auth and theme providers
    pages/         Dashboard, course, library, profile, and admin pages
    services/      API client and auth token helpers
data/              Local runtime files and generated assets
.env.example       Required and optional environment variables
```

## Documentation

- `Maestro-V1-Build-Readiness-and-Cursor-Package.md` tracks the V1 build scope and implementation package.
- `Maestro-V1-Phase0-Decisions.md` records the architectural decisions that guided the current Postgres-first, Node Engine implementation.
- `design.md` and the `frontend/**/DESIGN.md` files are design-system/reference artifacts, not operational setup docs.

## License

MIT
