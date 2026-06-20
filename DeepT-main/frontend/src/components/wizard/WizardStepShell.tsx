import { type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StageStepper, type StageStep } from './StageStepper'

export interface BreadcrumbItem {
  label: string
}

export type StepStatusTone = 'needs_review' | 'approved' | 'running' | 'locked' | 'neutral'

interface WizardStepShellProps {
  breadcrumb: BreadcrumbItem[]
  counter?: string
  title: string
  subtitle?: string
  statusBadge?: { label: string; tone: StepStatusTone }
  steps?: StageStep[]
  onSelectStep?: (id: string) => void
  children: ReactNode
}

function StatusBadge({ label, tone }: { label: string; tone: StepStatusTone }) {
  const dot: Record<StepStatusTone, string> = {
    needs_review: 'bg-amber-500',
    approved: 'bg-emerald-500',
    running: 'bg-primary',
    locked: 'bg-muted-foreground',
    neutral: 'bg-muted-foreground',
  }
  const text: Record<StepStatusTone, string> = {
    needs_review: 'text-amber-600 dark:text-amber-400',
    approved: 'text-emerald-600 dark:text-emerald-400',
    running: 'text-primary',
    locked: 'text-muted-foreground',
    neutral: 'text-muted-foreground',
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-caption font-medium', text[tone])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dot[tone])} />
      {label}
    </span>
  )
}

/**
 * Consistent frame for a single wizard step: breadcrumb + step counter, a clean
 * header (title, status, one-line purpose), an optional dots-&-labels stepper,
 * then the focused step content. The sticky action bar is rendered separately by
 * the step so it can pin to the viewport bottom.
 */
export default function WizardStepShell({
  breadcrumb,
  counter,
  title,
  subtitle,
  statusBadge,
  steps,
  onSelectStep,
  children,
}: WizardStepShellProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <nav className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          {breadcrumb.map((item, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />}
              <span className={cn('truncate', i === breadcrumb.length - 1 && 'text-foreground')}>
                {item.label}
              </span>
            </span>
          ))}
        </nav>
        {counter && (
          <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-fine-print text-muted-foreground">
            {counter}
          </span>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold text-foreground">{title}</h1>
          {statusBadge && <StatusBadge label={statusBadge.label} tone={statusBadge.tone} />}
        </div>
        {subtitle && <p className="text-caption text-muted-foreground">{subtitle}</p>}
      </div>

      {steps && steps.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <StageStepper steps={steps} onSelect={onSelectStep} />
        </div>
      )}

      <div>{children}</div>
    </div>
  )
}
