import { BadgeCheck, Pencil, RefreshCw, User, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { GlassPanel, GlassReplyStrip } from '@/components/ui/GlassPanel'
import { cn } from '@/lib/utils'
import type { AvatarLibraryEntry, HeyGenAvatarCharacter } from '@/services/api'
import { extractCharacterName } from '@/components/nodeEngine/heygenAvatarGroups'

interface CourseVideoAvatarCardProps {
  savedLooks: AvatarLibraryEntry[]
  character: HeyGenAvatarCharacter | null
  voiceName?: string | null
  voiceMeta?: string | null
  voiceId?: string
  onEditLooks: () => void
  onChangeAvatar: () => void
}

export function CourseVideoAvatarCard({
  savedLooks,
  character,
  voiceName,
  voiceMeta,
  voiceId,
  onEditLooks,
  onChangeAvatar,
}: CourseVideoAvatarCardProps) {
  const hasAvatar = savedLooks.length > 0
  const characterName =
    character?.name ?? savedLooks[0]?.character_name ?? extractCharacterName(savedLooks[0]?.name ?? '')
  const heroImage =
    character?.preview_image_url ??
    savedLooks[0]?.preview_image_url ??
    null
  const rotationCount = savedLooks.length
  const hasVoice = Boolean(voiceId || voiceName)

  return (
    <GlassPanel
      className={cn(hasAvatar && 'ring-1 ring-primary/20')}
      innerClassName={hasAvatar ? 'border-primary/15' : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Avatar for this course</h4>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {hasAvatar
              ? 'Saved in model settings — used when rendering course videos.'
              : 'Choose an avatar and voice below, then click Save model settings.'}
          </p>
        </div>
        {hasAvatar && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
            <BadgeCheck className="h-3 w-3" />
            Configured
          </span>
        )}
      </div>

      {hasAvatar ? (
        <div className="mt-4 flex flex-col sm:flex-row gap-4">
          <div className="shrink-0">
            <div className="h-28 w-24 sm:h-32 sm:w-28 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-muted shadow-sm">
              {heroImage ? (
                <img
                  src={heroImage}
                  alt={characterName}
                  className="h-full w-full object-cover object-top"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <User className="h-10 w-10 opacity-40" />
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-base font-semibold text-foreground">{characterName}</p>
              <p className="text-xs text-muted-foreground">
                {rotationCount === 1
                  ? '1 look selected'
                  : `${rotationCount} looks rotate across course videos`}
              </p>
            </div>

            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                Selected looks
              </p>
              <div className="flex flex-wrap gap-2">
                {savedLooks.map((look) => (
                  <div
                    key={look.id}
                    className="group relative w-14 h-[4.5rem] rounded-lg overflow-hidden border-2 border-primary/40 ring-1 ring-primary/20 bg-muted"
                    title={look.name}
                  >
                    {look.preview_image_url ? (
                      <img
                        src={look.preview_image_url}
                        alt={look.name}
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground px-1 text-center">
                        {look.name}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" className="h-8 gap-1.5 text-xs" onClick={onEditLooks}>
                <Pencil className="h-3.5 w-3.5" />
                Edit looks
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onChangeAvatar}>
                <RefreshCw className="h-3.5 w-3.5" />
                Change avatar
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-black/15 dark:border-white/15 bg-background/30 px-4 py-6 text-center">
          <User className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No avatar selected yet</p>
          <Button type="button" size="sm" variant="secondary" className="mt-3 h-8 text-xs" onClick={onChangeAvatar}>
            Browse HBMSU Avatar Library
          </Button>
        </div>
      )}

      <GlassReplyStrip>
        <div className="flex gap-3 items-start">
          <div className="shrink-0 h-10 w-10 rounded-full border border-black/10 dark:border-white/10 bg-muted/80 flex items-center justify-center">
            <Volume2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Voice</p>
            {hasVoice ? (
              <>
                <p className="text-sm font-semibold text-foreground mt-0.5">
                  {voiceName ?? 'Selected voice'}
                </p>
                {voiceMeta && <p className="text-xs text-muted-foreground">{voiceMeta}</p>}
                {voiceId && (
                  <p className="text-[10px] font-mono text-muted-foreground truncate mt-1">{voiceId}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground mt-0.5">No voice selected — choose one below.</p>
            )}
          </div>
        </div>
      </GlassReplyStrip>
    </GlassPanel>
  )
}
