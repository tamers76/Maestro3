import { Link } from 'react-router-dom'
import { BookOpen, Boxes, Check, ChevronRight, Lock } from 'lucide-react'
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

/** Build the deep-link route for a layer step. */
function stepHref(courseCode: string, step: JourneyStep): string {
  const base = `/courses/${encodeURIComponent(courseCode)}`
  if (step.phase === 'engine') return `${base}/engine/${step.id.replace('engine-', '')}`
  return `${base}/architect/${step.id}`
}

type Tone = 'done' | 'active' | 'upcoming' | 'locked'

function StatusDot({ tone, index }: { tone: Tone; index: number }) {
  return (
    <span
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold',
        tone === 'done' && 'border-emerald-500 bg-emerald-500 text-white',
        tone === 'active' && 'border-primary bg-primary text-primary-foreground',
        tone === 'upcoming' && 'border-border bg-card text-muted-foreground',
        tone === 'locked' && 'border-border bg-muted text-muted-foreground/60'
      )}
    >
      {tone === 'done' ? (
        <Check className="h-3 w-3" />
      ) : tone === 'locked' ? (
        <Lock className="h-2.5 w-2.5" />
      ) : (
        index
      )}
    </span>
  )
}

function statusToTone(status: JourneyStep['status']): Tone {
  if (status === 'done') return 'done'
  if (status === 'current') return 'active'
  if (status === 'locked') return 'locked'
  return 'upcoming'
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
          'flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors',
          active ? 'bg-primary/5' : 'hover:bg-muted/60',
          locked && 'pointer-events-none opacity-70'
        )}
      >
        <span className="flex items-center gap-2 font-semibold text-foreground">
          {icon}
          {title}
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', badgeClass[badge.tone])}>
          {badge.text}
        </span>
      </Link>
      <ol className="mt-1 space-y-0.5 pl-2">
        {steps.map((step, i) => {
          const tone = statusToTone(step.status)
          const isActive = step.id === activeStepId
          const clickable = tone !== 'locked'
          const label = (
            <>
              <StatusDot tone={isActive ? 'active' : tone} index={i + 1} />
              <span
                className={cn(
                  'truncate',
                  isActive || tone === 'active'
                    ? 'font-medium text-foreground'
                    : tone === 'done'
                      ? 'text-foreground/80'
                      : 'text-muted-foreground'
                )}
              >
                {step.label}
              </span>
            </>
          )
          const rowClass = cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-caption transition-colors',
            isActive && 'border-l-2 border-primary bg-primary/5',
            clickable && !isActive && 'hover:bg-muted/60'
          )
          return clickable ? (
            <li key={step.id}>
              <Link to={stepHref(courseCode, step)} className={rowClass}>
                {label}
              </Link>
            </li>
          ) : (
            <li key={step.id} className={cn(rowClass, 'opacity-70')}>
              {label}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * The persistent "Course Journey" rail. Two collapsible-feeling phase groups
 * (Course Architect, Node Engine) each list their layer steps with status. The
 * phase headers route between phases; per-step routing arrives in a later phase.
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
