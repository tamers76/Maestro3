/**
 * HeyGen catalog — avatar looks + voices for Settings UI pickers.
 */
import { resolveHeyGenApiKey } from './heygenVideoRenderer.service.js';

const HEYGEN_API_BASE = 'https://api.heygen.com';

export class HeyGenCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeyGenCatalogError';
  }
}

function heygenHeaders(apiKey: string): Record<string, string> {
  return {
    'X-Api-Key': apiKey,
    Accept: 'application/json',
  };
}

function requireApiKey(apiKeyRef?: string): string {
  const key = resolveHeyGenApiKey(apiKeyRef);
  if (!key) {
    throw new HeyGenCatalogError(
      'HeyGen API key not configured. Set HEYGEN_API_KEY in .env and restart the backend.'
    );
  }
  return key;
}

function parsePaginatedList<T>(
  payload: unknown,
  mapItem: (raw: Record<string, unknown>) => T
): { items: T[]; has_more: boolean; next_token: string | null } {
  if (typeof payload !== 'object' || payload === null) {
    throw new HeyGenCatalogError('HeyGen returned an invalid response.');
  }
  const root = payload as Record<string, unknown>;
  const data = root.data;
  const itemsRaw = Array.isArray(data) ? data : [];
  return {
    items: itemsRaw.map((item) => mapItem(item as Record<string, unknown>)),
    has_more: root.has_more === true,
    next_token: typeof root.next_token === 'string' ? root.next_token : null,
  };
}

export interface HeyGenAvatarLookOption {
  id: string;
  name: string;
  gender: string | null;
  avatar_type: string | null;
  preview_image_url: string | null;
  preview_video_url: string | null;
  default_voice_id: string | null;
  supported_api_engines: string[];
  tags: string[];
  group_id: string | null;
}

/** HeyGen avatar group (character) with preview looks for the composite card UI. */
export interface HeyGenAvatarCharacter {
  group_id: string;
  name: string;
  gender: string | null;
  default_voice_id: string | null;
  looks_count: number;
  preview_image_url: string | null;
  preview_video_url: string | null;
  preview_looks: HeyGenAvatarLookOption[];
}

export interface HeyGenVoiceOption {
  voice_id: string;
  name: string;
  language: string | null;
  gender: string | null;
  type: string | null;
  preview_audio_url: string | null;
  support_pause: boolean;
  support_locale: boolean;
}

export interface HeyGenVideoAgentStyle {
  style_id: string;
  name: string;
  thumbnail_url: string | null;
  preview_video_url: string | null;
  tags: string[];
  aspect_ratio: string | null;
}

export interface HeyGenCatalogPage<T> {
  items: T[];
  has_more: boolean;
  next_token: string | null;
}

export function getHeyGenCatalogStatus(apiKeyRef?: string): {
  configured: boolean;
  api_key_ref: string;
} {
  const ref = apiKeyRef?.trim() || 'HEYGEN_API_KEY';
  return {
    configured: Boolean(resolveHeyGenApiKey(ref)),
    api_key_ref: ref,
  };
}

function mapHeyGenLook(raw: Record<string, unknown>): HeyGenAvatarLookOption {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? raw.display_name ?? 'Avatar'),
    gender: typeof raw.gender === 'string' ? raw.gender : null,
    avatar_type: typeof raw.avatar_type === 'string' ? raw.avatar_type : null,
    preview_image_url:
      typeof raw.preview_image_url === 'string' ? raw.preview_image_url : null,
    preview_video_url:
      typeof raw.preview_video_url === 'string' ? raw.preview_video_url : null,
    default_voice_id:
      typeof raw.default_voice_id === 'string' ? raw.default_voice_id : null,
    supported_api_engines: Array.isArray(raw.supported_api_engines)
      ? (raw.supported_api_engines as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    tags: Array.isArray(raw.tags)
      ? (raw.tags as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    group_id: typeof raw.group_id === 'string' ? raw.group_id : null,
  };
}

function extractCharacterName(lookName: string): string {
  const split = lookName.split(' in ');
  return split.length > 1 ? split[0].trim() : lookName.trim();
}

function groupLooksIntoCharacters(looks: HeyGenAvatarLookOption[]): HeyGenAvatarCharacter[] {
  const map = new Map<string, HeyGenAvatarCharacter>();
  for (const look of looks) {
    const groupId = look.group_id ?? look.id;
    let character = map.get(groupId);
    if (!character) {
      character = {
        group_id: groupId,
        name: extractCharacterName(look.name),
        gender: look.gender,
        default_voice_id: look.default_voice_id,
        looks_count: 0,
        preview_image_url: look.preview_image_url,
        preview_video_url: look.preview_video_url,
        preview_looks: [],
      };
      map.set(groupId, character);
    }
    character.looks_count += 1;
    if (character.preview_looks.length < 3) {
      character.preview_looks.push(look);
    }
    if (!character.preview_image_url && look.preview_image_url) {
      character.preview_image_url = look.preview_image_url;
    }
    if (!character.default_voice_id && look.default_voice_id) {
      character.default_voice_id = look.default_voice_id;
    }
  }
  return Array.from(map.values());
}

async function fetchPreviewLooksForCharacter(
  apiKey: string,
  groupId: string,
  ownership?: 'public' | 'private',
  limit = 3
): Promise<HeyGenAvatarLookOption[]> {
  const params = new URLSearchParams();
  params.set('group_id', groupId);
  params.set('limit', String(Math.min(50, Math.max(1, limit))));
  if (ownership) params.set('ownership', ownership);
  const url = `${HEYGEN_API_BASE}/v3/avatars/looks?${params.toString()}`;
  const response = await fetch(url, { headers: heygenHeaders(apiKey) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return [];
  const page = parsePaginatedList(payload, mapHeyGenLook);
  return page.items.filter((a) => a.id);
}

export async function listHeyGenAvatarCharacters(options: {
  apiKeyRef?: string;
  ownership?: 'public' | 'private';
  avatar_type?: 'studio_avatar' | 'digital_twin' | 'photo_avatar';
  limit?: number;
  token?: string;
} = {}): Promise<HeyGenCatalogPage<HeyGenAvatarCharacter>> {
  const apiKey = requireApiKey(options.apiKeyRef);
  const useCharacterEndpoint = options.avatar_type === undefined;

  if (useCharacterEndpoint) {
    const params = new URLSearchParams();
    if (options.ownership) params.set('ownership', options.ownership);
    params.set('limit', String(Math.min(50, Math.max(1, options.limit ?? 24))));
    if (options.token) params.set('token', options.token);

    const url = `${HEYGEN_API_BASE}/v3/avatars?${params.toString()}`;
    const response = await fetch(url, { headers: heygenHeaders(apiKey) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg =
        typeof payload === 'object' && payload && 'error' in payload
          ? JSON.stringify((payload as { error?: unknown }).error)
          : `HeyGen avatar character list failed (${response.status})`;
      throw new HeyGenCatalogError(msg);
    }

    const page = parsePaginatedList(payload, (raw) => ({
      group_id: String(raw.id ?? ''),
      name: String(raw.name ?? 'Avatar'),
      gender: typeof raw.gender === 'string' ? raw.gender : null,
      default_voice_id:
        typeof raw.default_voice_id === 'string' ? raw.default_voice_id : null,
      looks_count: typeof raw.looks_count === 'number' ? raw.looks_count : 0,
      preview_image_url:
        typeof raw.preview_image_url === 'string' ? raw.preview_image_url : null,
      preview_video_url:
        typeof raw.preview_video_url === 'string' ? raw.preview_video_url : null,
      preview_looks: [] as HeyGenAvatarLookOption[],
    }));

    const characters = await Promise.all(
      page.items
        .filter((c) => c.group_id)
        .map(async (character) => {
          const previewLooks = await fetchPreviewLooksForCharacter(
            apiKey,
            character.group_id,
            options.ownership,
            3
          );
          return {
            ...character,
            preview_looks: previewLooks,
            looks_count: character.looks_count || previewLooks.length,
          };
        })
    );

    return {
      items: characters,
      has_more: page.has_more,
      next_token: page.next_token,
    };
  }

  const looksPage = await listHeyGenAvatarLooks({
    apiKeyRef: options.apiKeyRef,
    ownership: options.ownership,
    avatar_type: options.avatar_type,
    limit: options.limit,
    token: options.token,
  });

  return {
    items: groupLooksIntoCharacters(looksPage.items),
    has_more: looksPage.has_more,
    next_token: looksPage.next_token,
  };
}

export async function listHeyGenAvatarLooksForGroup(options: {
  apiKeyRef?: string;
  group_id: string;
  ownership?: 'public' | 'private';
  limit?: number;
  token?: string;
}): Promise<HeyGenCatalogPage<HeyGenAvatarLookOption>> {
  const apiKey = requireApiKey(options.apiKeyRef);
  const params = new URLSearchParams();
  params.set('group_id', options.group_id);
  params.set('limit', String(Math.min(50, Math.max(1, options.limit ?? 30))));
  if (options.ownership) params.set('ownership', options.ownership);
  if (options.token) params.set('token', options.token);

  const url = `${HEYGEN_API_BASE}/v3/avatars/looks?${params.toString()}`;
  const response = await fetch(url, { headers: heygenHeaders(apiKey) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg =
      typeof payload === 'object' && payload && 'error' in payload
        ? JSON.stringify((payload as { error?: unknown }).error)
        : `HeyGen avatar looks failed (${response.status})`;
    throw new HeyGenCatalogError(msg);
  }

  const page = parsePaginatedList(payload, mapHeyGenLook);
  return {
    items: page.items.filter((a) => a.id),
    has_more: page.has_more,
    next_token: page.next_token,
  };
}

export async function listHeyGenAvatarLooks(options: {
  apiKeyRef?: string;
  ownership?: 'public' | 'private';
  avatar_type?: 'studio_avatar' | 'digital_twin' | 'photo_avatar';
  group_id?: string;
  limit?: number;
  token?: string;
} = {}): Promise<HeyGenCatalogPage<HeyGenAvatarLookOption>> {
  const apiKey = requireApiKey(options.apiKeyRef);
  const params = new URLSearchParams();
  if (options.ownership) params.set('ownership', options.ownership);
  if (options.avatar_type) params.set('avatar_type', options.avatar_type);
  if (options.group_id) params.set('group_id', options.group_id);
  params.set('limit', String(Math.min(50, Math.max(1, options.limit ?? 24))));
  if (options.token) params.set('token', options.token);

  const url = `${HEYGEN_API_BASE}/v3/avatars/looks?${params.toString()}`;
  const response = await fetch(url, { headers: heygenHeaders(apiKey) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg =
      typeof payload === 'object' && payload && 'error' in payload
        ? JSON.stringify((payload as { error?: unknown }).error)
        : `HeyGen avatar list failed (${response.status})`;
    throw new HeyGenCatalogError(msg);
  }

  const page = parsePaginatedList(payload, mapHeyGenLook);

  return {
    items: page.items.filter((a) => a.id),
    has_more: page.has_more,
    next_token: page.next_token,
  };
}

export async function listHeyGenVoices(options: {
  apiKeyRef?: string;
  type?: 'public' | 'private';
  language?: string;
  gender?: string;
  limit?: number;
  token?: string;
} = {}): Promise<HeyGenCatalogPage<HeyGenVoiceOption>> {
  const apiKey = requireApiKey(options.apiKeyRef);
  const params = new URLSearchParams();
  if (options.type) params.set('type', options.type);
  if (options.language) params.set('language', options.language);
  if (options.gender) params.set('gender', options.gender);
  params.set('limit', String(Math.min(100, Math.max(1, options.limit ?? 30))));
  if (options.token) params.set('token', options.token);

  const url = `${HEYGEN_API_BASE}/v3/voices?${params.toString()}`;
  const response = await fetch(url, { headers: heygenHeaders(apiKey) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg =
      typeof payload === 'object' && payload && 'error' in payload
        ? JSON.stringify((payload as { error?: unknown }).error)
        : `HeyGen voice list failed (${response.status})`;
    throw new HeyGenCatalogError(msg);
  }

  const page = parsePaginatedList(payload, (raw) => ({
    voice_id: String(raw.voice_id ?? ''),
    name: String(raw.name ?? 'Voice').trim(),
    language: typeof raw.language === 'string' ? raw.language : null,
    gender: typeof raw.gender === 'string' ? raw.gender : null,
    type: typeof raw.type === 'string' ? raw.type : null,
    preview_audio_url:
      typeof raw.preview_audio_url === 'string' ? raw.preview_audio_url : null,
    support_pause: raw.support_pause === true,
    support_locale: raw.support_locale === true,
  }));

  return {
    items: page.items.filter((v) => v.voice_id),
    has_more: page.has_more,
    next_token: page.next_token,
  };
}

/** GET /v3/video-agents/styles — curated Video Agent visual templates. */
export async function listHeyGenVideoAgentStyles(options: {
  apiKeyRef?: string;
  tag?: string;
  limit?: number;
  token?: string;
} = {}): Promise<HeyGenCatalogPage<HeyGenVideoAgentStyle>> {
  const apiKey = requireApiKey(options.apiKeyRef);
  const params = new URLSearchParams();
  if (options.tag) params.set('tag', options.tag);
  params.set('limit', String(Math.min(100, Math.max(1, options.limit ?? 100))));
  if (options.token) params.set('token', options.token);

  const url = `${HEYGEN_API_BASE}/v3/video-agents/styles?${params.toString()}`;
  const response = await fetch(url, { headers: heygenHeaders(apiKey) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg =
      typeof payload === 'object' && payload && 'error' in payload
        ? JSON.stringify((payload as { error?: unknown }).error)
        : `HeyGen style list failed (${response.status})`;
    throw new HeyGenCatalogError(msg);
  }

  const page = parsePaginatedList(payload, (raw) => ({
    style_id: String(raw.style_id ?? raw.id ?? ''),
    name: String(raw.name ?? 'Style').trim(),
    thumbnail_url: typeof raw.thumbnail_url === 'string' ? raw.thumbnail_url : null,
    preview_video_url: typeof raw.preview_video_url === 'string' ? raw.preview_video_url : null,
    tags: Array.isArray(raw.tags)
      ? (raw.tags as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    aspect_ratio: typeof raw.aspect_ratio === 'string' ? raw.aspect_ratio : null,
  }));

  return {
    items: page.items.filter((s) => s.style_id),
    has_more: page.has_more,
    next_token: page.next_token,
  };
}
