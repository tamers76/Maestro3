import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit config. NOTE: the authoritative DDL lives in src/db/bootstrap.ts
 * (idempotent, includes pgvector/HNSW/tsvector objects drizzle-kit cannot express
 * cleanly). This config exists for schema introspection / `drizzle-kit studio`.
 */
export default {
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://maestro:maestro@127.0.0.1:5432/maestronexus',
  },
} satisfies Config;
