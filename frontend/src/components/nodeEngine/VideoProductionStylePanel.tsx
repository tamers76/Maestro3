import { useEffect, useState } from 'react'
import { Clapperboard, Loader2, ShieldCheck } from 'lucide-react'
import { GlassPanel, GlassProfileHeader } from '@/components/ui/GlassPanel'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import {
  fetchHeyGenStyles,
  type HeyGenVideoAgentStyle,
  type VideoBrandKit,
  type VideoSettings,
} from '@/services/api'

interface VideoProductionStylePanelProps {
  videoSettings: VideoSettings | undefined
  onPatch: (patch: Partial<VideoSettings>) => void
}

const DEFAULT_BRAND_KIT: VideoBrandKit = {
  enabled: false,
  primaryColor: '#1E40AF',
  secondaryColor: '#0F172A',
  accentColor: '#38BDF8',
  fontFamily: 'Inter',
  mediaTypeGuidance:
    'Use motion graphics for data, structure, and key terms. Use stock or AI visuals only for context that supports the approved narration — never to introduce new facts.',
}

export function VideoProductionStylePanel({
  videoSettings,
  onPatch,
}: VideoProductionStylePanelProps) {
  const renderStyle = videoSettings?.video_render_style ?? 'video_agent_produced'
  const fidelity = videoSettings?.narration_fidelity ?? 'moderate'
  const orientation = videoSettings?.orientation ?? 'landscape'
  const targetDuration = videoSettings?.target_duration_seconds ?? 180
  const styleId = videoSettings?.style_id ?? ''
  const brandKit = videoSettings?.brand_kit ?? DEFAULT_BRAND_KIT
  const apiKeyRef = videoSettings?.apiKeyRef ?? 'HEYGEN_API_KEY'

  const isAgent = renderStyle === 'video_agent_produced'

  const [styles, setStyles] = useState<HeyGenVideoAgentStyle[]>([])
  const [stylesLoading, setStylesLoading] = useState(false)
  const [stylesError, setStylesError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAgent) return
    let cancelled = false
    setStylesLoading(true)
    setStylesError(null)
    fetchHeyGenStyles({ api_key_ref: apiKeyRef, limit: 100 })
      .then((page) => {
        if (!cancelled) setStyles(page.items)
      })
      .catch((err: unknown) => {
        if (!cancelled) setStylesError(err instanceof Error ? err.message : 'Failed to load styles')
      })
      .finally(() => {
        if (!cancelled) setStylesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAgent, apiKeyRef])

  function patchBrandKit(patch: Partial<VideoBrandKit>) {
    onPatch({ brand_kit: { ...DEFAULT_BRAND_KIT, ...brandKit, ...patch } })
  }

  return (
    <GlassPanel padding="md">
      <GlassProfileHeader
        name="Video production style"
        subtitle="How HeyGen renders course videos"
        verified
        badge={<Clapperboard className="h-4 w-4 text-sky-400 shrink-0" />}
      />

      <div className="mt-4 space-y-4">
        {/* Render style */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <StyleChoice
            active={isAgent}
            title="Produced (Video Agent)"
            description="Scenes, motion graphics, on-screen text. Recommended for course videos."
            onClick={() => onPatch({ video_render_style: 'video_agent_produced' })}
          />
          <StyleChoice
            active={!isAgent}
            title="Studio Direct"
            description="Plain talking-head: avatar speaks the script verbatim."
            onClick={() => onPatch({ video_render_style: 'studio_direct' })}
          />
        </div>

        {isAgent && (
          <>
            {/* Narration fidelity */}
            <div>
              <p className="text-xs font-medium text-foreground mb-1.5 flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                Narration fidelity
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <StyleChoice
                  active={fidelity === 'relaxed'}
                  title="Relaxed"
                  description="Conversational delivery; may add everyday analogies to clarify — no new facts. Expect SME review."
                  onClick={() => onPatch({ narration_fidelity: 'relaxed' })}
                />
                <StyleChoice
                  active={fidelity === 'moderate'}
                  title="Moderate"
                  description="Natural delivery; no new facts, examples, or numbers added."
                  onClick={() => onPatch({ narration_fidelity: 'moderate' })}
                />
                <StyleChoice
                  active={fidelity === 'strict'}
                  title="Strict"
                  description="Avatar delivers the approved script verbatim."
                  onClick={() => onPatch({ narration_fidelity: 'strict' })}
                />
              </div>
            </div>

            {/* Orientation + duration */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-medium text-foreground mb-1.5">Orientation</p>
                <div className="flex gap-2">
                  {(['landscape', 'portrait'] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => onPatch({ orientation: o })}
                      className={cn(
                        'flex-1 h-8 rounded-lg border text-xs capitalize transition-colors',
                        orientation === o
                          ? 'border-sky-400 bg-sky-500/10 text-foreground'
                          : 'border-black/10 dark:border-white/10 text-muted-foreground'
                      )}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-foreground mb-1.5">Target duration (sec)</p>
                <Input
                  type="number"
                  min={10}
                  max={600}
                  value={targetDuration}
                  onChange={(e) =>
                    onPatch({ target_duration_seconds: Math.max(10, Number(e.target.value) || 180) })
                  }
                  className="h-8 text-xs bg-background/50 border-black/10 dark:border-white/10"
                />
              </div>
            </div>

            {/* Visual style */}
            <div>
              <p className="text-xs font-medium text-foreground mb-1.5">Visual style</p>
              {stylesError && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">
                  {stylesError} — using Auto.
                </p>
              )}
              {stylesLoading ? (
                <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading styles…
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <StyleTile
                    active={!styleId}
                    label="Auto / none"
                    onClick={() => onPatch({ style_id: undefined })}
                  />
                  {styles.map((s) => (
                    <StyleTile
                      key={s.style_id}
                      active={styleId === s.style_id}
                      label={s.name}
                      thumbnail={s.thumbnail_url}
                      onClick={() => onPatch({ style_id: s.style_id })}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Brand kit */}
            <div className="rounded-lg border border-black/10 dark:border-white/10 p-3">
              <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={brandKit.enabled}
                  onChange={(e) => patchBrandKit({ enabled: e.target.checked })}
                  className="h-3.5 w-3.5"
                />
                Apply HBMSU brand kit (colors, font, media guidance)
              </label>
              {brandKit.enabled && (
                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <ColorField
                      label="Primary"
                      value={brandKit.primaryColor ?? ''}
                      onChange={(v) => patchBrandKit({ primaryColor: v })}
                    />
                    <ColorField
                      label="Secondary"
                      value={brandKit.secondaryColor ?? ''}
                      onChange={(v) => patchBrandKit({ secondaryColor: v })}
                    />
                    <ColorField
                      label="Accent"
                      value={brandKit.accentColor ?? ''}
                      onChange={(v) => patchBrandKit({ accentColor: v })}
                    />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">Font family</p>
                    <Input
                      value={brandKit.fontFamily ?? ''}
                      onChange={(e) => patchBrandKit({ fontFamily: e.target.value })}
                      placeholder="Inter"
                      className="h-8 text-xs bg-background/50 border-black/10 dark:border-white/10"
                    />
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground mb-1">Media-type guidance</p>
                    <textarea
                      value={brandKit.mediaTypeGuidance ?? ''}
                      onChange={(e) => patchBrandKit({ mediaTypeGuidance: e.target.value })}
                      rows={2}
                      className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-background/50 p-2 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              The approved transcript stays the source of truth. After render, Maestro compares
              HeyGen&apos;s rendered transcript and flags academic drift for SME review.
            </p>
          </>
        )}
      </div>
    </GlassPanel>
  )
}

function StyleChoice({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-left rounded-lg border p-3 transition-colors',
        active
          ? 'border-sky-400 bg-sky-500/10'
          : 'border-black/10 dark:border-white/10 hover:border-sky-300/50'
      )}
    >
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{description}</p>
    </button>
  )
}

function StyleTile({
  active,
  label,
  thumbnail,
  onClick,
}: {
  active: boolean
  label: string
  thumbnail?: string | null
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border overflow-hidden text-left transition-colors',
        active ? 'border-sky-400 ring-1 ring-sky-400' : 'border-black/10 dark:border-white/10'
      )}
    >
      <div className="aspect-video bg-black/5 dark:bg-white/5 flex items-center justify-center">
        {thumbnail ? (
          <img src={thumbnail} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="text-[10px] text-muted-foreground">No preview</span>
        )}
      </div>
      <p className="px-2 py-1 text-[11px] text-foreground truncate">{label}</p>
    </button>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-8 rounded border border-black/10 dark:border-white/10 bg-transparent cursor-pointer"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-xs bg-background/50 border-black/10 dark:border-white/10"
        />
      </div>
    </div>
  )
}
