import { cn } from '@/lib/utils'
import { Check, BookOpen, Boxes, ChevronRight, Lock } from 'lucide-react'
import { NODE_ENGINE_LAYER_MAP } from '@/components/nodeEngine/nodeEngineLayers'

/**
 * Two-half product progress indicator (V1 default, LEGACY_STAGES_ENABLED=false).
 *
 * Presents the user-facing product model in two named halves — Course Architect
 * (the six academic design layers) → Node Engine (Layers 1–5) — mirroring the
 * approve-before-next rhythm. This is a DISPLAY/structure reframe only: it does
 * not run anything, change behaviour, or key off any engineering identifier. The
 * legacy five-stage stepper (Stage 1–5) still renders behind LEGACY_STAGES_ENABLED.
 */

/**
 * Course Architect layer display names — UI DISPLAY ONLY.
 * Mirrors the six academic design layers; not a rename of any service/config key.
 */
export const COURSE_ARCHITECT_LAYERS = [
  'Course Intake & Academic Contract',
  'CLO Quality Review & Refinement',
  'Assessment Redesign for Contribution',
  'Assessment Structure, Weighting & Rubric Review',
  'Assessment Integrity & Active AI Use',
  'Self-Paced Subtopic Architecture',
]

interface ProductProgressProps {
  /** Legacy stage counter; used only as a fallback signal for completion state. */
  currentStage: number
  /** Precise "all six Course Architect layers approved" signal when available. */
  courseArchitectComplete?: boolean
  compact?: boolean
}

export default function ProductProgress({ currentStage, courseArchitectComplete, compact }: ProductProgressProps) {
  // Prefer the precise approval signal; fall back to the legacy stage counter
  // (a course that advanced past the first half) when it isn't supplied.
  const architectDone = courseArchitectComplete ?? currentStage >= 2
  const engineUnlocked = architectDone

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <HalfPill name="Course Architect" state={architectDone ? 'done' : 'active'} />
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        <HalfPill name="Node Engine" state={engineUnlocked ? 'active' : 'upcoming'} />
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-stretch">
      <HalfPanel
        icon={<BookOpen className="h-4 w-4" />}
        name="Course Architect"
        caption="Prepares the approved academic structure."
        badge={architectDone ? { text: 'Complete', tone: 'done' } : { text: 'In progress', tone: 'active' }}
      >
        {COURSE_ARCHITECT_LAYERS.map((label, i) => (
          <LayerRow
            key={i}
            index={i + 1}
            label={label}
            state={architectDone ? 'done' : 'pending'}
          />
        ))}
      </HalfPanel>

      <div className="hidden items-center justify-center sm:flex">
        <ChevronRight className="h-5 w-5 text-muted-foreground/50" />
      </div>

      <HalfPanel
        icon={<Boxes className="h-4 w-4" />}
        name="Node Engine"
        caption="Turns that structure into governed adaptive learning nodes."
        badge={
          engineUnlocked
            ? { text: 'Layer 1 active', tone: 'active' }
            : { text: 'Upcoming', tone: 'locked' }
        }
      >
        {NODE_ENGINE_LAYER_MAP.map((l) => (
          <LayerRow
            key={l.layer}
            index={l.layer}
            label={l.label}
            caption={l.active ? '(active now)' : '(upcoming)'}
            state={!engineUnlocked ? 'locked' : l.active ? 'active' : 'upcoming'}
          />
        ))}
      </HalfPanel>
    </div>
  )
}

type Tone = 'done' | 'active' | 'locked'

function HalfPanel({
  icon,
  name,
  caption,
  badge,
  children,
}: {
  icon: React.ReactNode
  name: string
  caption: string
  badge: { text: string; tone: Tone }
  children: React.ReactNode
}) {
  const toneClasses: Record<Tone, string> = {
    done: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    active: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    locked: 'bg-muted text-muted-foreground',
  }
  return (
    <div className="flex-1 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold text-foreground">
          {icon}
          {name}
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', toneClasses[badge.tone])}>
          {badge.text}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
      <ul className="mt-3 space-y-1.5">{children}</ul>
    </div>
  )
}

function LayerRow({
  index,
  label,
  caption,
  state,
}: {
  index: number
  label: string
  caption?: string
  state: 'done' | 'active' | 'upcoming' | 'pending' | 'locked'
}) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
          state === 'done' && 'bg-emerald-500 text-white',
          state === 'active' && 'bg-violet-500 text-white',
          state === 'upcoming' && 'bg-slate-200 text-black/40 dark:bg-muted dark:text-muted-foreground',
          state === 'pending' && 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
          state === 'locked' && 'bg-slate-200 text-black/30 dark:bg-muted dark:text-muted-foreground/70'
        )}
      >
        {state === 'done' ? <Check className="h-3 w-3" /> : state === 'locked' ? <Lock className="h-3 w-3" /> : index}
      </span>
      <span className={cn(state === 'active' || state === 'done' ? 'text-foreground' : 'text-muted-foreground')}>
        {label}
        {caption && <span className="ml-1.5 text-xs text-muted-foreground">{caption}</span>}
      </span>
    </li>
  )
}

function HalfPill({ name, state }: { name: string; state: 'done' | 'active' | 'upcoming' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
        state === 'done' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        state === 'active' && 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
        state === 'upcoming' && 'bg-muted text-muted-foreground'
      )}
    >
      {state === 'done' && <Check className="h-2.5 w-2.5" />}
      {name}
    </span>
  )
}
