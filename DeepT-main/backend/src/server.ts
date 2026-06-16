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
import { initNeo4j, closeNeo4j, getNeo4jStatus } from './services/neo4j.service.js';
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
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    neo4j
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
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Closing connections...');
  await closeNeo4j();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Closing connections...');
  await closeNeo4j();
  process.exit(0);
});

// Start server
async function start() {
  try {
    // Initialize Neo4j connection (do not block startup)
    let neo4jConnected = false;
    let neo4jError: string | null = null;
    try {
      await initNeo4j();
      neo4jConnected = true;
    } catch (e) {
      neo4jConnected = false;
      neo4jError = e instanceof Error ? e.message : String(e);
      console.error('[Startup] Neo4j connection failed. Server will start without Neo4j.', neo4jError);
    }
    
    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════════════╗
║     Adaptive Curriculum Intelligence System            ║
║     Backend Server                                     ║
╠════════════════════════════════════════════════════════╣
║     🚀 Server running on http://localhost:${PORT}         ║
║     📊 Neo4j: ${neo4jConnected ? 'connected' : 'NOT connected'}${neo4jError ? ' (check /api/health)' : '                '}║
║     📚 API ready                                       ║
╚════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
