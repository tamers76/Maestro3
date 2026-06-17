/**
 * Custom Postgres column types not built into Drizzle's core: pgvector `vector`
 * and `tsvector`. Kept in one place so schema modules import a stable helper.
 */
import { customType } from 'drizzle-orm/pg-core';

/** pgvector `vector(dim)` column. Stores/returns number[]; wire format is '[a,b,c]'. */
export const vector = customType<{ data: number[]; driverData: string; config: { dim: number } }>({
  dataType(config) {
    const dim = config?.dim ?? 1536;
    return `vector(${dim})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: unknown): number[] {
    if (Array.isArray(value)) return value as number[];
    if (typeof value === 'string') {
      const inner = value.replace(/^\[/, '').replace(/\]$/, '');
      if (!inner) return [];
      return inner.split(',').map((s) => Number(s));
    }
    return [];
  },
});

/** Postgres full-text `tsvector` column (maintained as a generated column in DDL). */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});
