/**
 * Library binary storage on the filesystem (mirrors the avatar/blob pattern).
 *
 * Each catalog book gets a folder `data/library/<bookId>/` holding the original
 * source file (`source.<ext>`) and the cover image (`cover.<ext>`). The DB stores
 * only the bare filenames (`file_path`, `cover_path`); binaries are streamed back
 * through authenticated routes. Filenames are sanitized to prevent traversal.
 */
import { existsSync, mkdirSync, writeFileSync, createReadStream, statSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';

const LIBRARY_DIR = join(process.cwd(), '..', 'data', 'library');

const DOC_MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'text/plain': 'txt',
};

const IMAGE_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function bookDir(bookId: string): string {
  // bookId is a UUID; strip any path separators defensively.
  const safe = bookId.replace(/[/\\]/g, '');
  return join(LIBRARY_DIR, safe);
}

function ensureDir(bookId: string): string {
  const dir = bookDir(bookId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function extFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext && ext.length <= 5 ? ext : 'bin';
}

/**
 * Persist the original source file. Returns the bare filename stored in the DB
 * (e.g. `source.pdf`). Extension is derived from the MIME type, falling back to
 * the original filename's extension.
 */
export function saveSourceFile(
  bookId: string,
  buffer: Buffer,
  mimeType: string,
  originalFilename: string
): string {
  ensureDir(bookId);
  const ext = DOC_MIME_EXT[mimeType] ?? extFromFilename(originalFilename);
  const filename = `source.${ext}`;
  writeFileSync(join(bookDir(bookId), filename), buffer);
  return filename;
}

/** Persist a cover image. Returns the bare filename stored in the DB. */
export function saveCoverImage(bookId: string, buffer: Buffer, mimeType: string): string {
  ensureDir(bookId);
  const ext = IMAGE_MIME_EXT[mimeType] ?? 'jpg';
  const filename = `cover.${ext}`;
  writeFileSync(join(bookDir(bookId), filename), buffer);
  return filename;
}

/** Absolute path for a stored book file (source or cover), or null if missing. */
export function resolveBookFile(bookId: string, filename: string | null): string | null {
  if (!filename) return null;
  const safe = filename.replace(/[/\\]/g, '');
  const full = join(bookDir(bookId), safe);
  return existsSync(full) ? full : null;
}

export function contentTypeForFile(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'doc':
      return 'application/msword';
    case 'txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

export function streamBookFile(fullPath: string) {
  const size = statSync(fullPath).size;
  return { stream: createReadStream(fullPath), size, contentType: contentTypeForFile(fullPath) };
}

/** Read the stored source file back into memory (for re-ingestion). */
export function readSourceBuffer(bookId: string, filename: string | null): Buffer | null {
  const full = resolveBookFile(bookId, filename);
  if (!full) return null;
  return readFileSync(full);
}

/** Remove all stored binaries for a book (used when deleting a catalog entry). */
export function deleteBookFiles(bookId: string): void {
  const dir = bookDir(bookId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
