import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BadgeCheck, Check, Loader2, Play, Search, Sparkles, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { GlassPanel, GlassProfileHeader } from '@/components/ui/GlassPanel'
import { cn } from '@/lib/utils'
import {
  fetchHeyGenApprovedAvatars,
  fetchHeyGenCatalogStatus,
  fetchHeyGenVoices,
  type AvatarLibraryEntry,
  type HeyGenAvatarCharacter,
  type HeyGenAvatarLookOption,
  type HeyGenVoiceOption,
  type VideoSettings,
} from '@/services/api'
import {
  avatarOptionToLibraryEntry,
  groupApprovedIntoCharacters,
  isSameAvatarCharacter,
  libraryEntryToAvatarOption,
  normalizeRotationPool,
  rotationIdsForCharacter,
} from '@/components/nodeEngine/heygenAvatarGroups'
import { HeyGenCharacterCard } from '@/components/nodeEngine/HeyGenCharacterCard'
import { HeyGenCharacterLooksPanel } from '@/components/nodeEngine/HeyGenCharacterLooksPanel'
import { CourseVideoAvatarCard } from '@/components/nodeEngine/CourseVideoAvatarCard'
import { VideoProductionStylePanel } from '@/components/nodeEngine/VideoProductionStylePanel'

interface HeyGenRenderSettingsPickerProps {
  videoSettings: VideoSettings | undefined
  onPatch: (patch: Partial<VideoSettings>) => void
}

export function HeyGenRenderSettingsPicker({
  videoSettings,
  onPatch,
}: HeyGenRenderSettingsPickerProps) {
  const [catalogReady, setCatalogReady] = useState<boolean | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [approvedAvatars, setApprovedAvatars] = useState<AvatarLibraryEntry[]>([])
  const [avatarsLoading, setAvatarsLoading] = useState(false)
  const [voices, setVoices] = useState<HeyGenVoiceOption[]>([])
  const [voiceLoading, setVoiceLoading] = useState(false)
  const [voiceNextToken, setVoiceNextToken] = useState<string | null>(null)
  const [avatarSearch, setAvatarSearch] = useState('')
  const [voiceSearch, setVoiceSearch] = useState('')
  const [openedCharacter, setOpenedCharacter] = useState<HeyGenAvatarCharacter | null>(null)
  const [voiceTab, setVoiceTab] = useState<'public' | 'private'>('public')
  const [voiceGenderFilter, setVoiceGenderFilter] = useState<'all' | 'male' | 'female'>('all')
  const [previewVoiceId, setPreviewVoiceId] = useState<string | null>(null)
  const voiceScrollRef = useRef<HTMLDivElement>(null)
  const librarySectionRef = useRef<HTMLDivElement>(null)
  const voiceLoadingMoreRef = useRef(false)

  const selectedAvatarId = videoSettings?.avatar_id ?? ''
  const selectedVoiceId = videoSettings?.voice_id ?? ''
  const apiKeyRef = videoSettings?.apiKeyRef ?? 'HEYGEN_API_KEY'

  const rotationPool = useMemo(
    () => normalizeRotationPool(videoSettings?.avatar_rotation_pool ?? []),
    [videoSettings?.avatar_rotation_pool]
  )
  const rotationIds = useMemo(
    () => new Set(rotationPool.map((entry) => entry.id)),
    [rotationPool]
  )

  const libraryCharacters = useMemo(
    () => groupApprovedIntoCharacters(approvedAvatars),
    [approvedAvatars]
  )

  const savedLooks = useMemo((): AvatarLibraryEntry[] => {
    if (rotationPool.length > 0) return rotationPool
    if (!selectedAvatarId) return []
    const entry = approvedAvatars.find((item) => item.id === selectedAvatarId)
    return entry ? [entry] : []
  }, [rotationPool, selectedAvatarId, approvedAvatars])

  const savedCharacter = useMemo((): HeyGenAvatarCharacter | null => {
    if (savedLooks.length === 0) return null
    const sample = savedLooks[0]
    const groupId = sample.group_id ?? sample.id
    const fromLibrary = libraryCharacters.find(
      (character) =>
        character.group_id === groupId ||
        character.name === sample.character_name
    )
    if (fromLibrary) return fromLibrary
    if (!sample.character_name && !sample.group_id) return null
    return {
      group_id: groupId,
      name: sample.character_name ?? sample.name,
      gender: null,
      default_voice_id: sample.default_voice_id ?? null,
      looks_count: savedLooks.length,
      preview_image_url: sample.preview_image_url ?? null,
      preview_video_url: null,
      preview_looks: savedLooks.map(libraryEntryToAvatarOption),
    }
  }, [savedLooks, libraryCharacters])

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.voice_id === selectedVoiceId) ?? null,
    [voices, selectedVoiceId]
  )

  const voiceMeta = selectedVoice
    ? [selectedVoice.language, selectedVoice.gender].filter(Boolean).join(' · ')
    : undefined

  function scrollToLibrary() {
    setOpenedCharacter(null)
    setAvatarSearch('')
    librarySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleEditLooks() {
    if (!savedCharacter) {
      scrollToLibrary()
      return
    }
    setOpenedCharacter(savedCharacter)
    librarySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const displayCharacters = useMemo(() => {
    const q = avatarSearch.trim().toLowerCase()
    if (!q) return libraryCharacters
    return libraryCharacters.filter(
      (character) =>
        character.name.toLowerCase().includes(q) ||
        character.preview_looks.some((look) => look.name.toLowerCase().includes(q))
    )
  }, [libraryCharacters, avatarSearch])

  const openedCharacterLooks = useMemo(() => {
    if (!openedCharacter) return []
    return approvedAvatars
      .filter(
        (entry) =>
          entry.group_id === openedCharacter.group_id ||
          entry.character_name === openedCharacter.name
      )
      .map(libraryEntryToAvatarOption)
  }, [openedCharacter, approvedAvatars])

  const filteredVoices = useMemo(() => {
    const q = voiceSearch.trim().toLowerCase()
    return voices.filter((voice) => {
      if (voiceGenderFilter !== 'all') {
        const gender = (voice.gender ?? '').toLowerCase()
        if (gender !== voiceGenderFilter) return false
      }
      if (!q) return true
      return (
        voice.name.toLowerCase().includes(q) ||
        (voice.language?.toLowerCase().includes(q) ?? false) ||
        (voice.gender?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [voices, voiceSearch, voiceGenderFilter])

  const loadApprovedAvatars = useCallback(async () => {
    setAvatarsLoading(true)
    setCatalogError(null)
    try {
      const { items } = await fetchHeyGenApprovedAvatars(apiKeyRef)
      setApprovedAvatars(items)
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'Failed to load HBMSU Avatar Library')
      setApprovedAvatars([])
    } finally {
      setAvatarsLoading(false)
    }
  }, [apiKeyRef])

  const loadVoices = useCallback(
    async (append = false, token?: string | null) => {
      setVoiceLoading(true)
      try {
        const page = await fetchHeyGenVoices({
          api_key_ref: apiKeyRef,
          type: voiceTab,
          language: 'English',
          limit: 40,
          token: token ?? undefined,
        })
        setVoices((prev) => (append ? [...prev, ...page.items] : page.items))
        setVoiceNextToken(page.next_token)
      } catch (error) {
        if (!append) {
          setCatalogError(error instanceof Error ? error.message : 'Failed to load voices')
          setVoices([])
        }
      } finally {
        setVoiceLoading(false)
      }
    },
    [apiKeyRef, voiceTab]
  )

  useEffect(() => {
    void (async () => {
      try {
        const status = await fetchHeyGenCatalogStatus(apiKeyRef)
        setCatalogReady(status.configured)
        await Promise.all([loadApprovedAvatars(), loadVoices(false)])
      } catch {
        setCatalogReady(false)
        await loadApprovedAvatars()
      }
    })()
  }, [apiKeyRef, loadApprovedAvatars, loadVoices])

  useEffect(() => {
    if (catalogReady) void loadVoices(false)
  }, [voiceTab, catalogReady, loadVoices])

  const loadMoreVoices = useCallback(() => {
    if (!voiceNextToken || voiceLoading || voiceLoadingMoreRef.current) return
    voiceLoadingMoreRef.current = true
    void loadVoices(true, voiceNextToken).finally(() => {
      voiceLoadingMoreRef.current = false
    })
  }, [voiceNextToken, voiceLoading, loadVoices])

  function handleVoiceScroll() {
    const el = voiceScrollRef.current
    if (!el) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80
    if (nearBottom) loadMoreVoices()
  }

  useEffect(() => {
    if (voiceLoading || !voiceNextToken) return
    const id = requestAnimationFrame(() => {
      const el = voiceScrollRef.current
      if (!el) return
      if (el.scrollHeight <= el.clientHeight + 16) loadMoreVoices()
    })
    return () => cancelAnimationFrame(id)
  }, [voices.length, voiceNextToken, voiceLoading, loadMoreVoices, voiceTab])

  function toggleRotationLook(look: HeyGenAvatarLookOption, character: HeyGenAvatarCharacter) {
    const entry = avatarOptionToLibraryEntry(look, character)
    const exists = rotationIds.has(look.id)
    const sameCharacterPool = rotationPool.filter((item) =>
      isSameAvatarCharacter(item, character)
    )
    const nextPool = exists
      ? sameCharacterPool.filter((item) => item.id !== look.id)
      : [...sameCharacterPool, entry]
    const patch: Partial<VideoSettings> = { avatar_rotation_pool: nextPool }
    if (nextPool.length > 0) {
      const primary = nextPool[0]
      patch.avatar_id = primary.id
      if (primary.default_voice_id) patch.voice_id = primary.default_voice_id
      if (primary.supported_api_engines?.includes('avatar_v')) {
        patch.engine = 'avatar_v'
      } else if (primary.supported_api_engines?.includes('avatar_iv')) {
        patch.engine = 'avatar_iv'
      }
    } else {
      patch.avatar_id = undefined
    }
    onPatch(patch)
  }

  function selectVoice(voice: HeyGenVoiceOption) {
    onPatch({ voice_id: voice.voice_id })
  }

  function playVoicePreview(voice: HeyGenVoiceOption) {
    if (!voice.preview_audio_url) return
    setPreviewVoiceId(voice.voice_id)
    const audio = new Audio(voice.preview_audio_url)
    audio.play().catch(() => setPreviewVoiceId(null))
    audio.onended = () => setPreviewVoiceId(null)
  }

  if (catalogReady === false && approvedAvatars.length === 0 && !avatarsLoading) {
    return (
      <GlassPanel padding="sm">
        <p className="text-xs text-amber-700 dark:text-amber-300">
          HeyGen catalog unavailable — set <code className="font-mono">HEYGEN_API_KEY</code> in{' '}
          <code className="font-mono">.env</code> for voice previews. Configure the HBMSU Avatar
          Library in <code className="font-mono">heygenApprovedAvatars.defaults.ts</code> and
          restart the backend. You can still type IDs manually below.
        </p>
      </GlassPanel>
    )
  }

  return (
    <div className="space-y-4">
      {catalogError && (
        <GlassPanel padding="sm" hoverGlow={false}>
          <p className="text-xs text-red-700 dark:text-red-400">{catalogError}</p>
        </GlassPanel>
      )}

      <VideoProductionStylePanel videoSettings={videoSettings} onPatch={onPatch} />

      <CourseVideoAvatarCard
        savedLooks={savedLooks}
        character={savedCharacter}
        voiceName={selectedVoice?.name}
        voiceMeta={voiceMeta}
        voiceId={selectedVoiceId || undefined}
        onEditLooks={handleEditLooks}
        onChangeAvatar={scrollToLibrary}
      />

      <div ref={librarySectionRef}>
      <GlassPanel padding={openedCharacter ? 'none' : 'md'} innerClassName={openedCharacter ? 'p-0' : undefined}>
        {!openedCharacter && (
          <div className="space-y-3 mb-4">
            <GlassProfileHeader
              imageUrl={libraryCharacters[0]?.preview_image_url}
              name="HBMSU Avatar Library"
              subtitle={`${libraryCharacters.length} character${libraryCharacters.length === 1 ? '' : 's'} · ${
                rotationPool.length > 0
                  ? `${rotationPool.length} rotating look${rotationPool.length === 1 ? '' : 's'}`
                  : `${approvedAvatars.length} look${approvedAvatars.length === 1 ? '' : 's'}`
              }`}
              verified
              badge={<BadgeCheck className="h-4 w-4 text-sky-400 shrink-0" />}
              action={
                <div className="h-8 w-8 rounded-lg border border-black/10 dark:border-white/10 flex items-center justify-center text-muted-foreground">
                  <Sparkles className="h-4 w-4" />
                </div>
              }
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Click a character to browse looks — select multiple for rotation across course videos.
            </p>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={avatarSearch}
                onChange={(e) => setAvatarSearch(e.target.value)}
                placeholder="Search HBMSU avatars…"
                className="h-8 pl-8 text-xs bg-background/50 border-black/10 dark:border-white/10"
              />
            </div>
          </div>
        )}

        {avatarsLoading ? (
          <div className="flex items-center gap-2 py-10 text-xs text-muted-foreground justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading HBMSU Avatar Library…
          </div>
        ) : approvedAvatars.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <p className="text-xs text-muted-foreground">HBMSU Avatar Library is empty.</p>
            <p className="text-[11px] text-muted-foreground">
              Add entries to{' '}
              <code className="font-mono">
                backend/src/config/heygenApprovedAvatars.defaults.ts
              </code>
            </p>
          </div>
        ) : openedCharacter ? (
          <HeyGenCharacterLooksPanel
            character={openedCharacter}
            selectedRotationIds={rotationIdsForCharacter(rotationPool, openedCharacter)}
            apiKeyRef={apiKeyRef}
            replacingOtherCharacter={
              savedCharacter !== null &&
              savedCharacter.group_id !== openedCharacter.group_id &&
              rotationPool.length > 0
            }
            fallbackLooks={
              openedCharacterLooks.length > 0
                ? openedCharacterLooks
                : openedCharacter.preview_looks
            }
            onBack={() => setOpenedCharacter(null)}
            onToggleRotationLook={(look) => toggleRotationLook(look, openedCharacter)}
            embedded
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {displayCharacters.map((character) => (
              <HeyGenCharacterCard
                key={character.group_id}
                character={character}
                selected={savedCharacter?.group_id === character.group_id}
                onOpen={() => setOpenedCharacter(character)}
              />
            ))}
            {displayCharacters.length === 0 && (
              <p className="col-span-full py-8 text-center text-xs text-muted-foreground">
                No characters match your search.
              </p>
            )}
          </div>
        )}
      </GlassPanel>
      </div>

      <GlassPanel>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <GlassProfileHeader
              name="Voice"
              subtitle="HeyGen voice catalog"
              verified={Boolean(selectedVoiceId)}
              badge={<BadgeCheck className="h-4 w-4 text-sky-400 shrink-0" />}
              action={
                <div className="flex rounded-lg border border-black/10 dark:border-white/10 p-0.5 text-[10px] bg-background/40">
                  {(['public', 'private'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      className={cn(
                        'rounded-md px-2.5 py-1 capitalize transition-colors',
                        voiceTab === tab
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => setVoiceTab(tab)}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              }
            />
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={voiceSearch}
              onChange={(e) => setVoiceSearch(e.target.value)}
              placeholder="Search voices…"
              className="h-8 pl-8 text-xs bg-background/50 border-black/10 dark:border-white/10"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-lg border border-black/10 dark:border-white/10 p-0.5 text-[10px] bg-background/40">
              {(['all', 'male', 'female'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={cn(
                    'rounded-md px-2.5 py-1 capitalize transition-colors',
                    voiceGenderFilter === filter
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setVoiceGenderFilter(filter)}
                >
                  {filter === 'all' ? 'All' : filter}
                </button>
              ))}
            </div>
            {voices.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {filteredVoices.length === voices.length
                  ? `${voices.length} voice${voices.length === 1 ? '' : 's'}`
                  : `${filteredVoices.length} of ${voices.length}`}
              </p>
            )}
          </div>

          <div
            ref={voiceScrollRef}
            onScroll={handleVoiceScroll}
            className="max-h-52 overflow-y-auto rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06] bg-background/30"
          >
            {voiceLoading && voices.length === 0 ? (
              <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading voices…
              </div>
            ) : filteredVoices.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">
                {voices.length === 0
                  ? 'No voices in this catalog.'
                  : 'No voices match your filters.'}
              </p>
            ) : (
              filteredVoices.map((voice) => {
                  const selected = voice.voice_id === selectedVoiceId
                  return (
                    <div
                      key={voice.voice_id}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2.5 text-xs transition-colors',
                        selected && 'bg-primary/10'
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => selectVoice(voice)}
                      >
                        <span className={cn('font-medium', selected && 'text-primary')}>
                          {voice.name}
                        </span>
                        <span className="ml-2 text-muted-foreground">
                          {voice.language}
                          {voice.gender ? ` · ${voice.gender}` : ''}
                        </span>
                      </button>
                      {voice.preview_audio_url && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 shrink-0"
                          onClick={() => playVoicePreview(voice)}
                        >
                          {previewVoiceId === voice.voice_id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="h-3 w-3" />
                          )}
                        </Button>
                      )}
                      {selected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </div>
                  )
                })
            )}
            {voiceLoading && voices.length > 0 && (
              <div className="flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading more voices…
              </div>
            )}
          </div>
          {voiceNextToken && !voiceLoading && (
            <p className="text-center text-[10px] text-muted-foreground">Scroll down for more voices</p>
          )}
        </div>
      </GlassPanel>

      <GlassPanel padding="sm">
        <details className="text-xs group">
          <summary className="cursor-pointer text-muted-foreground list-none flex items-center gap-2">
            <Volume2 className="h-3.5 w-3.5" />
            Advanced: edit IDs manually
          </summary>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground">Avatar ID</label>
              <Input
                value={selectedAvatarId}
                onChange={(e) => onPatch({ avatar_id: e.target.value || undefined })}
                className="h-8 text-xs font-mono bg-background/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground">Voice ID</label>
              <Input
                value={selectedVoiceId}
                onChange={(e) => onPatch({ voice_id: e.target.value || undefined })}
                className="h-8 text-xs font-mono bg-background/50"
              />
            </div>
          </div>
        </details>
      </GlassPanel>
    </div>
  )
}
