import type {
  AvatarLibraryEntry,
  HeyGenAvatarCharacter,
  HeyGenAvatarLookOption,
} from '@/services/api'
import { inferStudioCategory, type AvatarCategoryFilter } from '@/components/nodeEngine/heygenAvatarCategories'

export function extractCharacterName(lookName: string): string {
  const split = lookName.split(' in ')
  return split.length > 1 ? split[0].trim() : lookName.trim()
}

/** Stable key for grouping looks under one HeyGen character. */
export function avatarCharacterKey(
  entry: Pick<AvatarLibraryEntry, 'group_id' | 'character_name' | 'id'>
): string {
  return entry.group_id ?? entry.character_name ?? entry.id
}

export function isSameAvatarCharacter(
  entry: Pick<AvatarLibraryEntry, 'group_id' | 'character_name'>,
  character: Pick<HeyGenAvatarCharacter, 'group_id' | 'name'>
): boolean {
  if (entry.group_id && entry.group_id === character.group_id) return true
  if (entry.character_name && entry.character_name === character.name) return true
  return false
}

/** Keep only looks belonging to the first character in the pool. */
export function normalizeRotationPool(entries: AvatarLibraryEntry[]): AvatarLibraryEntry[] {
  if (entries.length <= 1) return entries
  const key = avatarCharacterKey(entries[0])
  return entries.filter((entry) => avatarCharacterKey(entry) === key)
}

export function rotationIdsForCharacter(
  pool: AvatarLibraryEntry[],
  character: Pick<HeyGenAvatarCharacter, 'group_id' | 'name'>
): Set<string> {
  return new Set(
    pool.filter((entry) => isSameAvatarCharacter(entry, character)).map((entry) => entry.id)
  )
}

export function groupApprovedIntoCharacters(
  entries: AvatarLibraryEntry[]
): HeyGenAvatarCharacter[] {
  const map = new Map<string, HeyGenAvatarCharacter>()
  for (const entry of entries) {
    const groupId = entry.group_id ?? entry.id
    const look = libraryEntryToAvatarOption(entry)
    let character = map.get(groupId)
    if (!character) {
      character = {
        group_id: groupId,
        name: entry.character_name ?? extractCharacterName(entry.name),
        gender: null,
        default_voice_id: entry.default_voice_id ?? null,
        looks_count: 0,
        preview_image_url: entry.preview_image_url ?? null,
        preview_video_url: null,
        preview_looks: [],
      }
      map.set(groupId, character)
    }
    character.looks_count += 1
    if (character.preview_looks.length < 3) {
      character.preview_looks.push(look)
    }
    if (!character.preview_image_url && entry.preview_image_url) {
      character.preview_image_url = entry.preview_image_url
    }
  }
  return Array.from(map.values())
}

export function libraryEntryToAvatarOption(entry: AvatarLibraryEntry): HeyGenAvatarLookOption {
  return {
    id: entry.id,
    name: entry.name,
    gender: null,
    avatar_type: entry.avatar_type ?? null,
    preview_image_url: entry.preview_image_url ?? null,
    preview_video_url: null,
    default_voice_id: entry.default_voice_id ?? null,
    supported_api_engines: entry.supported_api_engines ?? [],
    tags: [],
    group_id: entry.group_id ?? null,
  }
}

export function avatarOptionToLibraryEntry(
  look: HeyGenAvatarLookOption,
  character?: Pick<HeyGenAvatarCharacter, 'group_id' | 'name'>
): AvatarLibraryEntry {
  return {
    id: look.id,
    name: look.name,
    preview_image_url: look.preview_image_url,
    avatar_type: look.avatar_type,
    default_voice_id: look.default_voice_id,
    supported_api_engines: look.supported_api_engines,
    group_id: character?.group_id ?? look.group_id,
    character_name: character?.name ?? extractCharacterName(look.name),
  }
}

export function characterMatchesCategory(
  character: HeyGenAvatarCharacter,
  filter: AvatarCategoryFilter
): boolean {
  if (filter === 'all') return true
  const sample = character.preview_looks[0]
  if (!sample) return true
  if (filter === 'community') return true
  if (filter === 'ugc') return sample.avatar_type === 'photo_avatar'
  if (filter === 'professional') {
    return sample.avatar_type === 'studio_avatar' && inferStudioCategory(sample) === 'professional'
  }
  if (filter === 'lifestyle') {
    return sample.avatar_type === 'studio_avatar' && inferStudioCategory(sample) === 'lifestyle'
  }
  return true
}

export function getCharacterPreviewImages(character: HeyGenAvatarCharacter): {
  main: string | null
  thumbs: string[]
} {
  const looks = character.preview_looks
  const main =
    character.preview_image_url ?? looks[0]?.preview_image_url ?? null
  const thumbs = looks
    .map((look) => look.preview_image_url)
    .filter((url): url is string => Boolean(url))
    .filter((url) => url !== main)
    .slice(0, 2)
  return { main, thumbs }
}
