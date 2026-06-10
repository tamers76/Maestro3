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

## Prerequisites

- Node.js 18+
- Neo4j 5.x (running locally)
- OpenRouter API key (or OpenAI API key, or local Ollama)

## Quick Start

1. **Install dependencies**:
   ```bash
   npm run install:all
   ```

2. **Configure settings**:
   Copy `config/settings.example.json` to `config/settings.json` and add your credentials:
   ```bash
   cp config/settings.example.json config/settings.json
   ```
   Edit `config/settings.json` with Neo4j credentials and API keys. Do not commit this file.

3. **Start development servers**:
   ```bash
   npm run dev
   ```
   - Backend: http://localhost:3001  
   - Frontend: http://localhost:5173

## Configuration

See `config/settings.example.json` for a template. You can also change settings in the UI (Settings page). Key sections: `aiProvider`, `models`, `neo4j`, and `council` (members, chairman, temperatures). Use `stageExecution` to set Single vs. Council per stage (e.g., `"stage4": "council"` for content generation).

## Project Structure

```
├── backend/           # Express API server
│   └── src/
│       ├── routes/    # API endpoints
│       ├── services/  # Business logic (stages, council, Neo4j)
│       └── models/    # TypeScript interfaces
├── frontend/          # React application
│   └── src/
│       ├── components/
│       ├── pages/
│       └── services/
├── config/            # settings.json (do not commit)
└── data/              # Runtime course data
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
