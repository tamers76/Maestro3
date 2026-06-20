/**
 * Curated HeyGen avatar allowlist for the Settings picker.
 */
import type { AvatarLibraryEntry } from '../models/nodeEngine.js';
import {
  heygenApprovedAvatarGroupIds,
  heygenApprovedAvatarsDefaults,
} from '../config/heygenApprovedAvatars.defaults.js';
import { listHeyGenAvatarLooksForGroup } from './heygenCatalog.service.js';
import { resolveHeyGenApiKey } from './heygenVideoRenderer.service.js';

const HEYGEN_API_BASE = 'https://api.heygen.com';

function extractCharacterName(lookName: string): string {
  const split = lookName.split(' in ');
  return split.length > 1 ? split[0].trim() : lookName.trim();
}

export function getHeyGenApprovedAvatarsConfig(): AvatarLibraryEntry[] {
  return heygenApprovedAvatarsDefaults.map((entry) => ({ ...entry }));
}

export function getHeyGenApprovedAvatarGroupIds(): string[] {
  return [...heygenApprovedAvatarGroupIds];
}

/** Group allowlist entries by group_id for character-card UI. */
export function groupApprovedAvatarsConfig(
  entries: AvatarLibraryEntry[]
): Map<string, AvatarLibraryEntry[]> {
  const map = new Map<string, AvatarLibraryEntry[]>();
  for (const entry of entries) {
    const key = entry.group_id ?? entry.character_name ?? entry.id;
    const bucket = map.get(key) ?? [];
    bucket.push(entry);
    map.set(key, bucket);
  }
  return map;
}

async function fetchCharacterName(
  apiKey: string,
  groupId: string
): Promise<string | null> {
  try {
    const response = await fetch(`${HEYGEN_API_BASE}/v3/avatars/${groupId}`, {
      headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return null;
    const data = (payload as { data?: { name?: string } }).data;
    return typeof data?.name === 'string' ? data.name : null;
  } catch {
    return null;
  }
}

async function expandGroupIdToLooks(
  groupId: string,
  options?: { apiKeyRef?: string }
): Promise<AvatarLibraryEntry[]> {
  const apiKey = resolveHeyGenApiKey(options?.apiKeyRef);
  if (!apiKey) return [];

  const [characterName, page] = await Promise.all([
    fetchCharacterName(apiKey, groupId),
    listHeyGenAvatarLooksForGroup({
      apiKeyRef: options?.apiKeyRef,
      group_id: groupId,
      ownership: 'public',
      limit: 50,
    }),
  ]);

  return page.items.map((look) => ({
    id: look.id,
    name: look.name,
    preview_image_url: look.preview_image_url,
    avatar_type: look.avatar_type,
    default_voice_id: look.default_voice_id,
    supported_api_engines: look.supported_api_engines,
    group_id: look.group_id ?? groupId,
    character_name: characterName ?? extractCharacterName(look.name),
  }));
}

/**
 * Resolve the static allowlist: explicit looks + expanded character identity IDs.
 * Fails open when HeyGen is unavailable.
 */
export async function resolveHeyGenApprovedAvatars(options?: {
  apiKeyRef?: string;
}): Promise<AvatarLibraryEntry[]> {
  const byLookId = new Map<string, AvatarLibraryEntry>();

  for (const entry of getHeyGenApprovedAvatarsConfig()) {
    byLookId.set(entry.id, { ...entry });
  }

  for (const groupId of getHeyGenApprovedAvatarGroupIds()) {
    const looks = await expandGroupIdToLooks(groupId.trim(), options);
    for (const look of looks) {
      byLookId.set(look.id, look);
    }
  }

  const base = Array.from(byLookId.values());
  if (base.length === 0) return base;

  const grouped = groupApprovedAvatarsConfig(base);
  const resolved: AvatarLibraryEntry[] = [];

  for (const [, entries] of grouped) {
    const sample = entries[0];
    const needsHydration = entries.some(
      (e) => !e.preview_image_url || !e.default_voice_id
    );
    let looksById = new Map<string, AvatarLibraryEntry>();

    if (needsHydration && sample.group_id) {
      try {
        const page = await listHeyGenAvatarLooksForGroup({
          apiKeyRef: options?.apiKeyRef,
          group_id: sample.group_id,
          ownership: 'public',
          limit: 50,
        });
        looksById = new Map(
          page.items.map((look) => [
            look.id,
            {
              id: look.id,
              name: look.name,
              preview_image_url: look.preview_image_url,
              avatar_type: look.avatar_type,
              default_voice_id: look.default_voice_id,
              supported_api_engines: look.supported_api_engines,
              group_id: look.group_id,
              character_name: sample.character_name,
            },
          ])
        );
      } catch {
        // Static config still works without HeyGen hydration.
      }
    }

    for (const entry of entries) {
      resolved.push(looksById.get(entry.id) ?? entry);
    }
  }

  return resolved;
}
