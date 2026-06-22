import { Link } from 'react-router-dom'
import { BookOpen, Boxes, Check, ChevronRight, Clock, Lock, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { JourneyStep, WizardPhase } from './useCourseJourney'

interface JourneyRailProps {
  courseCode: string
  currentPhase: WizardPhase
  architectSteps: JourneyStep[]
  engineSteps: JourneyStep[]
  architectComplete: boolean
  engineUnlocked: boolean
  /** Id of the layer step currently shown (highlighted in the rail). */
  activeStepId?: string
}

/** Short, rail-only titles for the Course Architect layers (order 1-6). */
const ARCHITECT_SHORT = [
  'Syllabus Extraction',
  'CLO Review',
  'Assessment Review',
  'Assessment Structure',
  'Assessment Integrity',
  'Subtopic Architect',
]

/** Strip a leading "N. " order prefix — the timeline dot conveys order. */
function stripOrder(label: string): string {
  return label.replace(/^\d+\.\s*/, '')
}

/** Build the deep-link route for a layer step. */
function stepHref(courseCode: string, step: JourneyStep): string {
  const base = `/courses/${encodeURIComponent(courseCode)}`
  if (step.phase === 'engine') return `${base}/engine/${step.id.replace('engine-', '')}`
  return `${base}/architect/${step.id}`
}

type Tone = 'done' | 'active' | 'upcoming' | 'locked'

function statusToTone(status: JourneyStep['status']): Tone {
  if (status === 'done') return 'done'
  if (status === 'current') return 'active'
  if (status === 'locked') return 'locked'
  return 'upcoming'
}

const STATUS_LABEL: Record<Tone, string> = {
  done: 'Approved',
  active: 'In progress',
  upcoming: 'Pending',
  locked: 'Locked',
}

// Ring + status-text colors sampled from the reference timeline screenshot:
// green = done, blue = in progress, amber = pending, coral = locked.
const STATUS_TEXT: Record<Tone, string> = {
  done: 'text-[#22c55e]',
  active: 'text-[#2d7ff9]',
  upcoming: 'text-[#f4b740]',
  locked: 'text-[#fb6e52]',
}

const DOT_BORDER: Record<Tone, string> = {
  done: 'border-[#22c55e]',
  active: 'border-[#2d7ff9]',
  upcoming: 'border-[#f4b740]',
  locked: 'border-[#fb6e52]',
}

/** Status icon shown inside each ring (color-not-alone + scannable flow). */
const TONE_ICON: Record<Tone, LucideIcon | null> = {
  done: Check,
  active: Clock,
  upcoming: null,
  locked: Lock,
}

function PhaseGroup({
  courseCode,
  to,
  active,
  icon,
  title,
  badge,
  steps,
  locked,
  activeStepId,
  shortLabels,
}: {
  courseCode: string
  to: string
  active: boolean
  icon: React.ReactNode
  title: string
  badge: { text: string; tone: Tone }
  steps: JourneyStep[]
  locked: boolean
  activeStepId?: string
  shortLabels?: string[]
}) {
  const badgeClass: Record<Tone, string> = {
    done: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    active: 'bg-primary/10 text-primary',
    upcoming: 'bg-muted text-muted-foreground',
    locked: 'bg-muted text-muted-foreground',
  }
  return (
    <div>
      <Link
        to={to}
        className={cn(
          'flex items-center justify-between gap-2 rounded-md px-2 py-2',
          locked && 'pointer-events-none opacity-70'
        )}
      >
        <span
          className={cn(
            'flex min-w-0 items-center gap-2 font-semibold',
            active ? 'text-foreground' : 'text-foreground/75'
          )}
        >
          {icon}
          <span className="truncate">{title}</span>
        </span>
        <span
          className={cn(
            'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-2 py-0.5 text-center text-[10px] font-medium leading-none',
            badgeClass[badge.tone]
          )}
        >
          {badge.text}
        </span>
      </Link>

      <ol className="mt-2 pl-1">
        {steps.map((step, i) => {
          const tone = statusToTone(step.status)
          const isActive = step.id === activeStepId
          const clickable = tone !== 'locked'
          const isLast = i === steps.length - 1
          const name = shortLabels?.[i] ?? stripOrder(step.label)
          const Icon = TONE_ICON[tone]

          const row = (
            <div
              className={cn(
                'grid grid-cols-[1.25rem_1fr] items-start gap-x-2.5 rounded-md px-1 transition-colors',
                clickable && 'hover:bg-muted/50'
              )}
            >
              {/* ring dot + connector (left) — fixed size keeps the flow aligned */}
              <span className="relative flex w-5 flex-col items-center self-stretch">
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 bg-card transition-shadow',
                    DOT_BORDER[tone],
                    isActive && 'ring-2 ring-primary/30'
                  )}
                >
                  {Icon && (
                    <Icon className={cn('h-2.5 w-2.5', STATUS_TEXT[tone])} strokeWidth={3} />
                  )}
                </span>
                {!isLast && <span className="w-px flex-1 bg-border" />}
              </span>

              {/* stage name (right) */}
              <span
                className={cn(
                  'pb-5 pt-0.5 text-caption leading-tight',
                  isActive || tone === 'active'
                    ? 'font-semibold text-foreground'
                    : tone === 'done'
                      ? 'text-foreground/80'
                      : tone === 'locked'
                        ? 'text-muted-foreground'
                        : 'text-foreground/70'
                )}
              >
                {name}
                <span className="sr-only"> ({STATUS_LABEL[tone]})</span>
              </span>
            </div>
          )

          return clickable ? (
            <li key={step.id}>
              <Link to={stepHref(courseCode, step)}>{row}</Link>
            </li>
          ) : (
            <li key={step.id} className="opacity-70">
              {row}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * The persistent "Course Journey" rail. Two phase groups (Course Architect,
 * Node Engine) render their layer steps as a vertical timeline: status on the
 * left, a connected ring dot in the middle, and a short stage name on the
 * right. The phase headers route between phases.
 */
export default function JourneyRail({
  courseCode,
  currentPhase,
  architectSteps,
  engineSteps,
  architectComplete,
  engineUnlocked,
  activeStepId,
}: JourneyRailProps) {
  return (
    <nav className="flex flex-col gap-4">
      <p className="px-2 text-fine-print font-medium uppercase tracking-wide text-muted-foreground">
        Course Journey
      </p>

      <PhaseGroup
        courseCode={courseCode}
        to={`/courses/${encodeURIComponent(courseCode)}/architect`}
        active={currentPhase === 'architect'}
        icon={<BookOpen className="h-4 w-4" />}
        title="Course Architect"
        badge={
          architectComplete
            ? { text: 'Complete', tone: 'done' }
            : { text: 'In progress', tone: 'active' }
        }
        steps={architectSteps}
        locked={false}
        activeStepId={activeStepId}
        shortLabels={ARCHITECT_SHORT}
      />

      <div className="flex items-center gap-1 px-2 text-muted-foreground/50">
        <ChevronRight className="h-3 w-3" />
      </div>

      <PhaseGroup
        courseCode={courseCode}
        to={`/courses/${encodeURIComponent(courseCode)}/engine`}
        active={currentPhase === 'engine'}
        icon={<Boxes className="h-4 w-4" />}
        title="Node Engine"
        badge={
          engineUnlocked ? { text: 'Available', tone: 'active' } : { text: 'Upcoming', tone: 'locked' }
        }
        steps={engineSteps}
        locked={!engineUnlocked}
        activeStepId={activeStepId}
      />
    </nav>
  )
}
