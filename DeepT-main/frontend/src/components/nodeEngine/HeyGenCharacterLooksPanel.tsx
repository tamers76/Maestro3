import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, Loader2, Search, User } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import {
  fetchHeyGenCharacterLooks,
  type HeyGenAvatarCharacter,
  type HeyGenAvatarLookOption,
} from '@/services/api'

interface HeyGenCharacterLooksPanelProps {
  character: HeyGenAvatarCharacter
  selectedRotationIds: Set<string>
  apiKeyRef?: string
  fallbackLooks?: HeyGenAvatarLookOption[]
  onBack: () => void
  onToggleRotationLook: (look: HeyGenAvatarLookOption) => void
  /** When true, panel is nested inside a parent GlassPanel (no outer chrome). */
  embedded?: boolean
  /** User opened a different character than the saved course avatar. */
  replacingOtherCharacter?: boolean
}

async function fetchAllCharacterLooks(
  groupId: string,
  apiKeyRef?: string
): Promise<HeyGenAvatarLookOption[]> {
  const all: HeyGenAvatarLookOption[] = []
  let token: string | undefined
  for (let page = 0; page < 20; page++) {
    const result = await fetchHeyGenCharacterLooks(groupId, {
      api_key_ref: apiKeyRef,
      ownership: 'public',
      limit: 50,
      token,
    })
    all.push(...result.items)
    if (!result.has_more || !result.next_token) break
    token = result.next_token
  }
  return all
}

function lookAspectClass(look: HeyGenAvatarLookOption): string {
  const name = look.name.toLowerCase()
  if (name.includes('side') || name.includes('landscape')) return 'aspect-video'
  if (name.includes('standing') || name.includes('full')) return 'aspect-[3/5]'
  return 'aspect-[3/4]'
}

export function HeyGenCharacterLooksPanel({
  character,
  selectedRotationIds,
  apiKeyRef,
  fallbackLooks = [],
  onBack,
  onToggleRotationLook,
  embedded = false,
  replacingOtherCharacter = false,
}: HeyGenCharacterLooksPanelProps) {
  const [looks, setLooks] = useState<HeyGenAvatarLookOption[]>(fallbackLooks)
  const [loading, setLoading] = useState(true)
  const [lookSearch, setLookSearch] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadLooks = useCallback(async () => {
    setLoading(true)
    try {
      const fetched = await fetchAllCharacterLooks(character.group_id, apiKeyRef)
      setLooks(fetched.length > 0 ? fetched : fallbackLooks)
    } catch {
      setLooks(fallbackLooks.length > 0 ? fallbackLooks : character.preview_looks)
    } finally {
      setLoading(false)
    }
  }, [apiKeyRef, character.group_id, character.preview_looks, fallbackLooks])

  useEffect(() => {
    void loadLooks()
  }, [loadLooks])

  const filteredLooks = useMemo(() => {
    const q = lookSearch.trim().toLowerCase()
    if (!q) return looks
    return looks.filter((look) => look.name.toLowerCase().includes(q))
  }, [looks, lookSearch])

  const rotationCount = selectedRotationIds.size
  const previewUrl =
    character.preview_image_url ?? character.preview_looks[0]?.preview_image_url ?? null

  return (
    <div
      className={cn(
        'overflow-hidden',
        embedded
          ? 'rounded-xl'
          : cn(
              'rounded-2xl p-1.5 relative isolate',
              'bg-white/5 dark:bg-black/90',
              'bg-gradient-to-br from-black/5 to-black/[0.02] dark:from-white/5 dark:to-white/[0.02]',
              'backdrop-blur-xl backdrop-saturate-[180%]',
              'border border-black/10 dark:border-white/10',
              'shadow-[0_8px_16px_rgb(0_0_0_/_0.15)] dark:shadow-[0_8px_16px_rgb(0_0_0_/_0.25)]'
            )
      )}
    >
      <div
        className={cn(
          embedded ? '' : 'rounded-xl',
          'bg-gradient-to-br from-black/[0.05] to-transparent dark:from-white/[0.08] dark:to-transparent',
          !embedded && 'border border-black/[0.05] dark:border-white/[0.08]'
        )}
      >
      <div className="flex flex-wrap items-center gap-3 border-b border-black/[0.08] dark:border-white/[0.08] px-3 py-2.5">
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={character.name}
            className="h-9 w-9 rounded-full object-cover border border-border"
          />
        ) : (
          <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center">
            <User className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{character.name}</h3>
          {rotationCount > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {rotationCount} look{rotationCount === 1 ? '' : 's'} selected for course rotation
            </p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative hidden sm:block">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={lookSearch}
              onChange={(e) => setLookSearch(e.target.value)}
              placeholder="Search looks…"
              className="h-8 w-44 pl-7 text-xs"
            />
          </div>
        </div>
      </div>

      <div className="px-3 py-2 sm:hidden">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={lookSearch}
            onChange={(e) => setLookSearch(e.target.value)}
            placeholder="Search looks…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <p className="px-3 pb-1 text-xs text-muted-foreground">
        {loading
          ? 'Loading looks…'
          : `${filteredLooks.length} look${filteredLooks.length === 1 ? '' : 's'} · click to add/remove from rotation`}
      </p>
      <p className="px-3 pb-2 text-[11px] text-muted-foreground">
        Select multiple looks from <span className="font-medium text-foreground">{character.name}</span> only
        — each course video picks one consistently (rotates across videos). Save model settings to keep
        your selection.
      </p>
      {replacingOtherCharacter && (
        <p className="mx-3 mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
          Selecting a look here replaces your current course avatar&apos;s rotation pool with looks from{' '}
          {character.name} only.
        </p>
      )}

      <div
        ref={scrollRef}
        className="max-h-[32rem] lg:max-h-[42rem] xl:max-h-[48rem] overflow-y-auto px-3 pb-3"
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading {character.name}&apos;s looks…
          </div>
        ) : filteredLooks.length === 0 ? (
          <p className="py-12 text-center text-xs text-muted-foreground">No looks match your search.</p>
        ) : (
          <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-2.5 [column-fill:balance]">
            {filteredLooks.map((look) => {
              const inRotation = selectedRotationIds.has(look.id)
              return (
                <button
                  key={look.id}
                  type="button"
                  onClick={() => onToggleRotationLook(look)}
                  className={cn(
                    'group relative mb-2.5 w-full break-inside-avoid overflow-hidden rounded-xl border text-left transition-all hover:shadow-md',
                    inRotation
                      ? 'border-primary ring-2 ring-primary/40'
                      : 'border-border hover:border-primary/30'
                  )}
                >
                  <div className={cn('relative w-full bg-muted', lookAspectClass(look))}>
                    {look.preview_image_url ? (
                      <img
                        src={look.preview_image_url}
                        alt={look.name}
                        className="h-full w-full object-cover object-top"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full min-h-[8rem] items-center justify-center text-muted-foreground">
                        <User className="h-8 w-8 opacity-40" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent px-2.5 pb-2 pt-8">
                      <p className="text-xs font-medium text-white truncate">{character.name}</p>
                      <p className="text-[10px] text-white/80 truncate">{look.name}</p>
                    </div>
                    <span
                      className={cn(
                        'absolute top-2 right-2 rounded-full p-1 shadow-sm',
                        inRotation
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-black/50 text-white opacity-0 group-hover:opacity-100'
                      )}
                    >
                      <Check className={cn('h-3 w-3', inRotation && 'stroke-[3]')} />
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
