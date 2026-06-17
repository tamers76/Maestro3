/**
 * Blob-file metadata repository over `blob_files`. Binaries (compiled PDF/DOCX,
 * uploaded source files) stay on the filesystem; this records a row per file so
 * Postgres remains the catalog/source-of-truth for what exists on disk.
 */
import { and, eq, sql } from 'drizzle-orm';
import { blobFiles } from '../schema/artifacts.js';
import { exec, type Executor } from './_exec.js';

export interface BlobRecord {
  courseCode: string;
  kind: string;
  docType?: string | null;
  format?: string | null;
  path: string;
  bytes?: number | null;
}

/** Upsert-by-(course,kind,docType,format) metadata for a binary kept on disk. */
export async function record(blob: BlobRecord, tx?: Executor): Promise<void> {
  const db = exec(tx);
  await db
    .delete(blobFiles)
    .where(
      and(
        eq(blobFiles.courseCode, blob.courseCode),
        eq(blobFiles.kind, blob.kind),
        blob.docType == null ? sql`doc_type IS NULL` : eq(blobFiles.docType, blob.docType),
        blob.format == null ? sql`format IS NULL` : eq(blobFiles.format, blob.format)
      )
    );
  await db.insert(blobFiles).values({
    courseCode: blob.courseCode,
    kind: blob.kind,
    docType: blob.docType ?? null,
    format: blob.format ?? null,
    path: blob.path,
    bytes: blob.bytes ?? null,
  });
}

export async function listByCourse(courseCode: string, tx?: Executor): Promise<BlobRecord[]> {
  const rows = await exec(tx).select().from(blobFiles).where(eq(blobFiles.courseCode, courseCode));
  return rows.map((r) => ({
    courseCode: r.courseCode,
    kind: r.kind,
    docType: r.docType,
    format: r.format,
    path: r.path,
    bytes: r.bytes,
  }));
}

export async function removeByCourse(courseCode: string, tx?: Executor): Promise<void> {
  await exec(tx).delete(blobFiles).where(eq(blobFiles.courseCode, courseCode));
}
