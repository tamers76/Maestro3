import { Fragment } from 'react'
import { Eye, Film, Image as ImageIcon, MousePointerClick, Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog'
import { cn } from '@/lib/utils'
import {
  producedVideoStreamUrl,
  type NodeEngineBlueprintObject,
  type NodeEngineProducedObject,
  type NodeEngineStructuredVisual,
  type NodeEngineTextSegment,
} from '@/services/api'
import { StructuredVisualCanvas } from './StructuredVisualCanvas'

export interface NodeExperiencePreviewItem {
  obj: NodeEngineBlueprintObject
  produced: NodeEngineProducedObject | null
}

export interface NodeExperiencePreviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  nodeTitle: string
  courseCode: string
  items: NodeExperiencePreviewItem[]
}

/**
 * SME-facing approximation of how a finished mastery node reads to a student.
 * Renders each produced object in sequence_order using clean, learner-styled
 * blocks (no governance chrome). This is built from the same produced artifacts
 * the eventual learner runtime would consume.
 */
export function NodeExperiencePreview({
  open,
  onOpenChange,
  nodeTitle,
  courseCode,
  items,
}: NodeExperiencePreviewProps) {
  const producedItems = items.filter((it) => it.produced)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            {nodeTitle}
          </DialogTitle>
          <DialogDescription>
            Student preview — how this node reads once published. Approximation built from produced
            content.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(88vh-6rem)] overflow-y-auto px-6 py-6">
          {producedItems.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nothing produced yet for this node. Produce its objects to preview the experience.
            </p>
          ) : (
            <article className="mx-auto max-w-2xl space-y-10">
              {items.map((item) => (
                <Fragment key={item.obj.object_id}>
                  <ObjectBlock item={item} courseCode={courseCode} />
                </Fragment>
              ))}
            </article>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ObjectBlock({
  item,
  courseCode,
}: {
  item: NodeExperiencePreviewItem
  courseCode: string
}) {
  const { obj, produced } = item

  if (!produced) {
    return (
      <PlaceholderBlock
        icon={<Sparkles className="h-4 w-4" />}
        label={`${humanizeVehicle(obj.suggested_vehicle)} — not produced yet`}
      />
    )
  }

  const modality = produced.produced_modality
  const ms = produced.envelope.modality_specific

  if (modality === 'text') {
    const segments = Array.isArray(ms.segments) ? ms.segments : []
    return <TextBlock segments={segments} />
  }

  if (modality === 'structured_visual') {
    const visual = ms.structured_visual
    if (!visual) return null
    return <StructuredVisualBlock visual={visual} />
  }

  if (modality === 'video') {
    return <VideoBlock produced={produced} courseCode={courseCode} objectId={obj.object_id} />
  }

  if (modality === 'pictorial_visual') {
    return <PictorialBlock ms={ms} />
  }

  if (modality === 'learning_anchor') {
    return <AnchorBlock ms={ms} />
  }

  if (modality === 'interactive' || modality === 'simulation') {
    return (
      <PlaceholderBlock
        icon={<MousePointerClick className="h-4 w-4" />}
        label="Interactive activity — available in the live experience"
      />
    )
  }

  // Unknown/other modality — show any text equivalent so nothing is silently dropped.
  const fallback = typeof ms.text_equivalent === 'string' ? ms.text_equivalent : null
  return fallback ? (
    <p className="text-[15px] leading-relaxed text-foreground/90">{fallback}</p>
  ) : (
    <PlaceholderBlock icon={<Sparkles className="h-4 w-4" />} label={humanizeVehicle(modality)} />
  )
}

function TextBlock({ segments }: { segments: NodeEngineTextSegment[] }) {
  return (
    <div className="space-y-4">
      {segments.map((seg, i) => (
        <Segment key={`${seg.type}-${i}`} seg={seg} />
      ))}
    </div>
  )
}

function Segment({ seg }: { seg: NodeEngineTextSegment }) {
  const text = seg.text?.trim() ?? ''
  if (!text) return null
  switch (seg.type) {
    case 'heading':
      return <h2 className="text-xl font-semibold tracking-tight text-foreground">{text}</h2>
    case 'subheading':
      return <h3 className="text-base font-semibold text-foreground">{text}</h3>
    case 'definition':
      return (
        <LabeledCard label="Definition" tone="primary">
          {text}
        </LabeledCard>
      )
    case 'example':
      return (
        <LabeledCard label="Example" tone="emerald">
          {text}
        </LabeledCard>
      )
    case 'non_example':
      return (
        <LabeledCard label="Not this" tone="amber">
          {text}
        </LabeledCard>
      )
    case 'callout':
      return (
        <div className="rounded-[4px] border-l-2 border-primary bg-primary/5 px-4 py-3 text-[15px] leading-relaxed text-foreground/90">
          {text}
        </div>
      )
    case 'quotation':
      return (
        <blockquote className="border-l-2 border-border pl-4 text-[15px] italic leading-relaxed text-foreground/80">
          {text}
        </blockquote>
      )
    case 'table':
    case 'formula':
      return (
        <pre className="overflow-x-auto rounded-[4px] border border-border bg-muted/30 px-4 py-3 text-sm text-foreground/90 whitespace-pre-wrap">
          {text}
        </pre>
      )
    case 'summary':
      return (
        <LabeledCard label="Summary" tone="muted">
          {text}
        </LabeledCard>
      )
    case 'body':
    default:
      return <p className="text-[15px] leading-relaxed text-foreground/90">{text}</p>
  }
}

function StructuredVisualBlock({ visual }: { visual: NodeEngineStructuredVisual }) {
  return (
    <figure className="space-y-2">
      {visual.title && (
        <figcaption className="text-base font-semibold text-foreground">{visual.title}</figcaption>
      )}
      <div className="rounded-[4px] border border-border bg-background p-3">
        <StructuredVisualCanvas visual={visual} flowHeight={420} />
      </div>
      {visual.learner_caption && (
        <p className="text-sm leading-relaxed text-foreground/80">{visual.learner_caption}</p>
      )}
    </figure>
  )
}

function VideoBlock({
  produced,
  courseCode,
  objectId,
}: {
  produced: NodeEngineProducedObject
  courseCode: string
  objectId: string
}) {
  const ms = produced.envelope.modality_specific
  const renderStatus = ms.render_status
  const stored = ms.maestro_video_stored === true && renderStatus === 'render_complete'
  // Match the SME panel: the stream URL is keyed by the blueprint object id.
  const streamUrl = stored ? producedVideoStreamUrl(courseCode, objectId) : null
  const externalUrl =
    renderStatus === 'render_complete' ? ms.heygen_source_url ?? ms.video_url ?? null : null
  const src = streamUrl ?? externalUrl

  if (!src) {
    const label =
      renderStatus === 'render_pending'
        ? 'Video is still rendering — check back once HeyGen finishes'
        : renderStatus === 'render_failed'
          ? 'Video render failed — re-render before previewing'
          : 'Video brief ready — render it to preview the final video'
    return <PlaceholderBlock icon={<Film className="h-4 w-4" />} label={label} />
  }

  return (
    <div className="overflow-hidden rounded-[4px] border border-border bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video src={src} controls preload="metadata" className="aspect-video w-full" />
    </div>
  )
}

function PictorialBlock({ ms }: { ms: NodeEngineProducedObject['envelope']['modality_specific'] }) {
  const loose = ms as Record<string, unknown>
  const url =
    (typeof loose.image_url === 'string' && loose.image_url) ||
    (typeof loose.asset_url === 'string' && loose.asset_url) ||
    null
  const alt = typeof loose.alt_text === 'string' ? loose.alt_text : 'Illustration'
  if (url) {
    return (
      <figure className="space-y-2">
        <img src={url} alt={alt} className="w-full rounded-[4px] border border-border" />
        {alt && <figcaption className="text-sm text-muted-foreground">{alt}</figcaption>}
      </figure>
    )
  }
  return (
    <PlaceholderBlock
      icon={<ImageIcon className="h-4 w-4" />}
      label={alt || 'Illustration — not rendered yet'}
    />
  )
}

function AnchorBlock({ ms }: { ms: NodeEngineProducedObject['envelope']['modality_specific'] }) {
  const loose = ms as Record<string, unknown>
  const anchor = loose.anchor_content ?? loose.learning_anchor
  const text =
    (typeof anchor === 'string' && anchor) ||
    (anchor && typeof anchor === 'object' && typeof (anchor as Record<string, unknown>).message === 'string'
      ? ((anchor as Record<string, unknown>).message as string)
      : null) ||
    (typeof loose.text_equivalent === 'string' ? loose.text_equivalent : null)
  if (!text) {
    return <PlaceholderBlock icon={<Sparkles className="h-4 w-4" />} label="Guidance" />
  }
  return (
    <div className="rounded-[4px] border-l-2 border-primary bg-primary/5 px-4 py-3 text-[15px] leading-relaxed text-foreground/90">
      {text}
    </div>
  )
}

function LabeledCard({
  label,
  tone,
  children,
}: {
  label: string
  tone: 'primary' | 'emerald' | 'amber' | 'muted'
  children: React.ReactNode
}) {
  const tones: Record<typeof tone, string> = {
    primary: 'border-primary/30 bg-primary/5',
    emerald: 'border-emerald-500/30 bg-emerald-500/5',
    amber: 'border-amber-500/30 bg-amber-500/5',
    muted: 'border-border bg-muted/20',
  }
  return (
    <div className={cn('rounded-[4px] border px-4 py-3', tones[tone])}>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-[15px] leading-relaxed text-foreground/90">{children}</p>
    </div>
  )
}

function PlaceholderBlock({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[4px] border border-dashed border-border bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
      {icon}
      {label}
    </div>
  )
}

function humanizeVehicle(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default NodeExperiencePreview
