/**
 * Avatar binary storage on the filesystem (mirrors the course blob pattern).
 *
 * Files live under `data/avatars/<userId>.<ext>`. The DB stores the relative path
 * in `users.avatar_path`; images are streamed back through an authenticated route.
 */
import { existsSync, mkdirSync, writeFileSync, createReadStream, statSync } from 'fs';
import { join } from 'path';

const AVATAR_DIR = join(process.cwd(), '..', 'data', 'avatars');

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function isSupportedAvatarMime(mime: string): boolean {
  return mime in MIME_EXT;
}

function ensureDir(): void {
  if (!existsSync(AVATAR_DIR)) mkdirSync(AVATAR_DIR, { recursive: true });
}

/** Persist an avatar and return the relative path stored in the DB. */
export function saveAvatar(userId: string, buffer: Buffer, mimeType: string): string {
  ensureDir();
  const ext = MIME_EXT[mimeType] ?? 'png';
  const filename = `${userId}.${ext}`;
  writeFileSync(join(AVATAR_DIR, filename), buffer);
  return filename;
}

/**
 * A cache-busting version token for a stored avatar, derived from the file's
 * last-modified time. Changes whenever the avatar is overwritten, so clients
 * fetch the fresh image instead of a stale cached one (the URL is otherwise
 * stable per user).
 */
export function avatarVersion(avatarPath: string): number | null {
  const full = resolveAvatarFile(avatarPath);
  if (!full) return null;
  try {
    return Math.floor(statSync(full).mtimeMs);
  } catch {
    return null;
  }
}

/** Absolute path for a stored avatar, or null if missing on disk. */
export function resolveAvatarFile(avatarPath: string): string | null {
  if (!avatarPath) return null;
  // avatarPath is a bare filename; guard against traversal.
  const safe = avatarPath.replace(/[/\\]/g, '');
  const full = join(AVATAR_DIR, safe);
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
    default:
      return 'application/octet-stream';
  }
}

export function streamAvatar(fullPath: string) {
  const size = statSync(fullPath).size;
  return { stream: createReadStream(fullPath), size, contentType: contentTypeForFile(fullPath) };
}
