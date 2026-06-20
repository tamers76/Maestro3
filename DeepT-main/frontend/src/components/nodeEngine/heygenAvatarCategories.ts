import type { HeyGenAvatarLookOption } from '@/services/api'

export type AvatarCategoryFilter =
  | 'all'
  | 'professional'
  | 'lifestyle'
  | 'ugc'
  | 'community'

export const AVATAR_CATEGORY_CHIPS: { id: AvatarCategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'professional', label: 'Professional' },
  { id: 'lifestyle', label: 'Lifestyle' },
  { id: 'ugc', label: 'UGC' },
  { id: 'community', label: 'Community' },
]

const PROFESSIONAL_RE =
  /\b(blazer|suit|shirt|tie|office|formal|business|blouse|vest|jacket|corporate|professional|dress shirt)\b/i
const LIFESTYLE_RE =
  /\b(casual|yoga|lifestyle|hoodie|denim|outdoor|sport|polo|sweater|dress|tee|t-shirt|coffee|park|beach|gym|knit|cardigan)\b/i

/** HeyGen v3 has no category query param — map chips to avatar_type fetches where possible. */
export function avatarTypeForCategory(
  filter: AvatarCategoryFilter
): 'studio_avatar' | 'photo_avatar' | 'digital_twin' | undefined {
  if (filter === 'ugc') return 'photo_avatar'
  if (filter === 'community' || filter === 'all') return undefined
  if (filter === 'professional' || filter === 'lifestyle') return 'studio_avatar'
  return undefined
}

export function inferStudioCategory(avatar: HeyGenAvatarLookOption): 'professional' | 'lifestyle' {
  if (PROFESSIONAL_RE.test(avatar.name)) return 'professional'
  if (LIFESTYLE_RE.test(avatar.name)) return 'lifestyle'
  return 'professional'
}

export function matchesCategoryFilter(
  avatar: HeyGenAvatarLookOption,
  filter: AvatarCategoryFilter
): boolean {
  if (filter === 'all') return true
  if (filter === 'ugc') return avatar.avatar_type === 'photo_avatar'
  if (filter === 'community') return avatar.avatar_type === 'digital_twin'
  if (filter === 'professional') {
    return avatar.avatar_type === 'studio_avatar' && inferStudioCategory(avatar) === 'professional'
  }
  if (filter === 'lifestyle') {
    return avatar.avatar_type === 'studio_avatar' && inferStudioCategory(avatar) === 'lifestyle'
  }
  return true
}
