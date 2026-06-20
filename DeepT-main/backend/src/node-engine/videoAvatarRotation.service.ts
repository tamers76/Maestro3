/**
 * Pick which HeyGen look to use per produced video object (stable rotation across a course).
 */
import type { AvatarLibraryEntry, VideoSettings } from '../models/nodeEngine.js';

/** Stable bucket for rotation — same objectId always gets the same look. */
export function stableRotationIndex(key: string, size: number): number {
  if (size <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % size;
}

export function getAvatarRotationPool(settings: VideoSettings): AvatarLibraryEntry[] {
  const pool = settings.avatar_rotation_pool ?? [];
  return pool.filter((entry) => entry.id?.trim());
}

function rotationCharacterKey(entry: AvatarLibraryEntry): string {
  return entry.group_id ?? entry.character_name ?? entry.id;
}

/** Enforce single-character pools at render time (defensive). */
export function normalizeAvatarRotationPool(entries: AvatarLibraryEntry[]): AvatarLibraryEntry[] {
  if (entries.length <= 1) return entries;
  const key = rotationCharacterKey(entries[0]);
  return entries.filter((entry) => rotationCharacterKey(entry) === key);
}

function engineFromLook(entry: AvatarLibraryEntry): VideoSettings['engine'] | undefined {
  const engines = entry.supported_api_engines ?? [];
  if (engines.includes('avatar_v')) return 'avatar_v';
  if (engines.includes('avatar_iv')) return 'avatar_iv';
  return undefined;
}

/**
 * Resolve avatar_id (and per-look voice/engine when set) for one video object.
 * Uses avatar_rotation_pool when present; otherwise returns settings unchanged.
 */
export function resolveVideoAvatarForObject(
  settings: VideoSettings,
  objectId: string
): VideoSettings {
  const pool = normalizeAvatarRotationPool(getAvatarRotationPool(settings));
  if (pool.length === 0) return settings;

  const pick = pool.length === 1 ? pool[0] : pool[stableRotationIndex(objectId, pool.length)];
  const resolved: VideoSettings = {
    ...settings,
    avatar_id: pick.id,
  };
  if (pick.default_voice_id) {
    resolved.voice_id = pick.default_voice_id;
  }
  const engine = engineFromLook(pick);
  if (engine) resolved.engine = engine;
  return resolved;
}

export function describeAvatarRotation(settings: VideoSettings, objectId?: string): string {
  const pool = normalizeAvatarRotationPool(getAvatarRotationPool(settings));
  if (pool.length === 0) return '';
  if (pool.length === 1) return pool[0].name;
  if (!objectId) return `${pool.length} looks (rotating across course videos)`;
  const pick = pool[stableRotationIndex(objectId, pool.length)];
  return `${pick.name} (${pool.length}-look rotation)`;
}
