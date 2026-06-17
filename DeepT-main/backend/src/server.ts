// Load environment variables FIRST, before any other imports
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { existsSync } from 'fs';

// Load .env from repo root (one level up from backend/)
const envPath = join(process.cwd(), '..', '.env');
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath });
  console.log('[Env] Loaded environment variables from .env');
} else {
  console.log('[Env] No .env file found at repo root, using defaults/environment');
}

import express from 'express';
import cors from 'cors';
import {
  initNeo4j,
  closeNeo4j,
  getNeo4jStatus,
  startProjectionWorker,
  stopProjectionWorker,
} from './services/neo4j.service.js';
import {
  initPostgres,
  closePostgres,
  getPostgresStatus,
  getPool,
} from './db/client.js';
import { ensureSchema } from './db/bootstrap.js';
import { getPostgresConfig, hydrateSettings } from './config.js';
import { hydrateRegistry } from './node-engine/promptTemplateRegistry.service.js';
import { hydrateModalityConfig } from './node-engine/modalityGenerationConfig.service.js';
import { hydrateNodeGenerationPrompt } from './node-engine/nodeGenerationPrompt.service.js';
import coursesRouter from './routes/courses.js';
import settingsRouter from './routes/settings.js';
import referencesRouter from './routes/references.js';
import nodeEngineRouter from './routes/nodeEngine.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Routes
app.use('/api/courses', coursesRouter);
app.use('/api/courses', referencesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/node-engine', nodeEngineRouter);

// Health check
app.get('/api/health', (_req, res) => {
  const neo4j = getNeo4jStatus();
  const postgres = getPostgresStatus();
  res.json({
    status: postgres.connected ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    postgres,
    neo4j,
  });
});

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: err.message || 'Internal server error' 
  });
});

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received. Closing connections...`);
  stopProjectionWorker();
  await closeNeo4j();
  await closePostgres();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Start server
async function start() {
  // Postgres is the primary source of truth and is REQUIRED — fail fast if it is
  // unreachable or the schema cannot be ensured.
  try {
    await initPostgres();
    const pool = getPool();
    if (!pool) throw new Error('Postgres pool was not initialized');
    const { schema } = getPostgresConfig();
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await ensureSchema(pool);
    console.log('[Startup] Postgres connected and schema ensured.');
  } catch (error) {
    console.error(
      '[Startup] FATAL: Postgres is required but could not be initialized.',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }

  // Hydrate synchronous config caches from Postgres (settings + node-engine config).
  try {
    await Promise.all([
      hydrateSettings(),
      hydrateRegistry(),
      hydrateModalityConfig(),
      hydrateNodeGenerationPrompt(),
    ]);
    console.log('[Startup] Configuration caches hydrated.');
  } catch (e) {
    console.error('[Startup] Config hydration encountered an error:', e);
  }

  // Neo4j is an OPTIONAL graph projection — never block startup on it.
  let neo4jConnected = false;
  let neo4jError: string | null = null;
  try {
    await initNeo4j();
    neo4jConnected = true;
    startProjectionWorker();
  } catch (e) {
    neo4jError = e instanceof Error ? e.message : String(e);
    console.error('[Startup] Neo4j connection failed. Server will start without graph projection.', neo4jError);
  }

  app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║     Adaptive Curriculum Intelligence System            ║
║     Backend Server                                     ║
╠════════════════════════════════════════════════════════╣
║     🚀 Server running on http://localhost:${PORT}         ║
║     🐘 Postgres: connected (primary)                   ║
║     📊 Neo4j: ${neo4jConnected ? 'connected (projection)' : 'NOT connected        '}${neo4jError ? ' (see /api/health)' : '          '}║
║     📚 API ready                                       ║
╚════════════════════════════════════════════════════════╝
      `);
  });
}

start();
