# Adaptive Curriculum Intelligence System

Turn a **course syllabus** into a **node-based adaptive learning curriculum**. Upload a PDF or DOCX syllabus; the system extracts learning outcomes, decomposes them into prerequisite-linked nodes, applies adaptive logic (mandatory vs. skippable), and generates full instructional content—ready for adaptive delivery or export as a textbook-style PDF.

## Core Idea: Syllabus → Nodes for Adaptive Learning

Traditional syllabi are linear and one-size-fits-all. This system:

1. **Ingests** your syllabus (PDF/DOCX) and extracts course metadata, CLOs, and assessments.
2. **Decomposes** each learning outcome into **learning nodes** with clear prerequisites, forming a knowledge graph.
3. **Marks nodes** as mandatory or skippable so adaptive paths can skip what a learner already knows.
4. **Generates content** for every node so each path has full instructional material.
5. **Assembles & exports** everything into a single downloadable PDF or feeds the graph for adaptive platforms.

The result is a **syllabus converted into nodes** suitable for adaptive learning: learners follow paths through the graph based on their level, and every node has generated content to support them.

## Council: A Smart Way to Create Content

Content quality matters. Instead of relying on a single model, the system supports an **LLM Council**: multiple AI models deliberate on a task, and a **chairman** model synthesizes their outputs into the final answer. This is especially effective for **content creation** (e.g., Stage 4—writing full instructional Markdown per node), where diverse perspectives and synthesis produce clearer, more consistent material.

- **Single mode** (default): One model per stage—fast and simple.
- **Council mode**: Several “council members” respond; the chairman merges and refines. Use this where quality matters most (e.g., content generation).

Configure council members and chairman in **Settings > LLM Council**, and choose per-stage execution (Single vs. Council) in Settings or override per run on the Course Detail page.

## Pipeline at a Glance

| Stage | Purpose |
|-------|---------|
| **Stage 1** | Extraction & course contract — parse syllabus, CLOs, metadata, assessments |
| **Stage 2** | Node decomposition — learning nodes per CLO with prerequisites |
| **Stage 3** | Adaptive logic — mandatory vs. skippable nodes |
| **Stage 4** | Content generation — full Markdown content per node (Council recommended) |
| **Stage 5** | Assembly & export — compile to downloadable PDF |

## Data architecture

Maestro uses **PostgreSQL (with the `pgvector` extension) as the primary source of
truth** for all entity data, pipeline artifacts (JSONB), and reference/RAG vectors.
**Neo4j is an optional secondary graph projection** (node IDs + relationships only)
used for traversal/DAG/visualization; it is rebuilt from Postgres via a transactional
outbox and can be down without affecting entity reads/writes. Binary files (compiled
PDF/DOCX, uploaded sources) stay on the filesystem with a metadata row in Postgres.

- **Postgres is REQUIRED** at startup (the server fails fast if it is unreachable).
- **Neo4j is OPTIONAL** (graph visualization degrades gracefully if it is down).
- **pgvector** is the vector store; the old JSON-cosine and Neo4j vector backends are retired.

## Prerequisites

- Node.js 18+
- PostgreSQL 15+ with the `pgvector` extension (REQUIRED)
- Neo4j 5.x (OPTIONAL — graph projection/visualization)
- OpenRouter API key (or OpenAI API key, or local Ollama)

## Quick Start

1. **Install dependencies**:
   ```bash
   npm run install:all
   ```

2. **Configure the database connection**:
   Copy `.env.example` to `.env` at the repo root and set `DATABASE_URL` to a
   **least-privilege** `maestro` role (NOT the `postgres` superuser):
   ```bash
   cp .env.example .env
   # DATABASE_URL=postgresql://maestro:<password>@127.0.0.1:5432/maestronexus
   ```
   The `vector` extension must be created once by a superuser; the app then connects
   as `maestro`. API keys / passwords come from env and are never persisted.

3. **Apply the schema** (idempotent; builds tables + GIN indexes):
   ```bash
   npm --prefix backend run db:migrate
   # after a bulk re-ingest, build the HNSW vector index:
   npm --prefix backend run db:build-vector-index
   ```

4. **Start development servers**:
   ```bash
   npm run dev
   ```
   - Backend: http://localhost:3001  
   - Frontend: http://localhost:5173

   Check `/api/health` to see both `postgres` and `neo4j` status.

## Configuration

Connection settings come from `.env` (`DATABASE_URL` for Postgres; `NEO4J_*` for the
optional projection). Non-secret application settings are persisted in the
`app_settings` table and editable in the UI (Settings page). Key sections:
`aiProvider`, `models`, `neo4j`, `postgres`, and `council` (members, chairman,
temperatures). Use `stageExecution` to set Single vs. Council per stage.

## Testing

```bash
npm --prefix backend test          # pure-function suite (no database)
RUN_DB_TESTS=1 APP_DB_SCHEMA=maestro_test npm --prefix backend test   # + repo/pgvector tests in a disposable schema
```

DB-backed tests run in a disposable, per-process schema and are skipped unless
`RUN_DB_TESTS=1`. Integration tests that need a fully-seeded course additionally
require `RUN_SEEDED_TESTS=1`.

## Project Structure

```
├── backend/           # Express API server
│   └── src/
│       ├── db/        # Drizzle schema, repositories, client, bootstrap/migrate
│       ├── routes/    # API endpoints
│       ├── services/  # Business logic (stages, council, pgvector RAG, Neo4j projection)
│       └── models/    # TypeScript interfaces
├── frontend/          # React application
│   └── src/
│       ├── components/
│       ├── pages/
│       └── services/
├── .env               # DATABASE_URL + secrets (do not commit)
└── data/              # Filesystem binaries (compiled PDF/DOCX, uploads)
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/courses` | List all courses |
| POST | `/api/courses` | Create course (upload syllabus or form) |
| GET | `/api/courses/:code` | Get course details |
| DELETE | `/api/courses/:code` | Delete course |
| POST | `/api/courses/:code/stage/:num` | Run/rerun stage |
| GET | `/api/courses/:code/graph` | Get Neo4j graph (nodes for adaptive learning) |
| GET | `/api/courses/:code/download` | Download PDF |
| GET | `/api/settings` | Get current settings |
| PUT | `/api/settings` | Update settings |

## License

MIT
