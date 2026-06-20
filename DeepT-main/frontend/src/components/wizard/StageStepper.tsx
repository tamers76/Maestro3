import { Check, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StageStatus = 'done' | 'current' | 'upcoming' | 'locked'

export interface StageStep {
  id: string
  label: string
  status: StageStatus
}

interface StageStepperProps {
  steps: StageStep[]
  onSelect?: (id: string) => void
  className?: string
}

/**
 * Option B — minimal "dots & labels" stepper. Each step owns an equal-width
 * slot with symmetric half-connectors so dots and labels stay centred. Completed
 * connectors fill with an emerald→primary gradient, the current dot gets a soft
 * ring, upcoming/locked dots stay hollow. Apple-neat: one accent, soft states.
 */
export function StageStepper({ steps, onSelect, className }: StageStepperProps) {
  if (steps.length === 0) return null

  return (
    <div className={cn('w-full', className)}>
      <ol className="flex items-start">
        {steps.map((step, i) => {
          const isFirst = i === 0
          const isLast = i === steps.length - 1
          const prev = steps[i - 1]
          const leftFilled = !isFirst && prev.status === 'done'
          const rightFilled = step.status === 'done'
          const clickable = !!onSelect && step.status !== 'locked'

          return (
            <li key={step.id} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                {/* Left half-connector */}
                <span
                  className={cn(
                    'h-0.5 flex-1 rounded-full transition-colors',
                    isFirst ? 'opacity-0' : leftFilled ? 'bg-emerald-500' : 'bg-border'
                  )}
                />

                {/* Dot */}
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onSelect?.(step.id)}
                  aria-current={step.status === 'current' ? 'step' : undefined}
                  className={cn(
                    'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-fine-print font-semibold transition-all',
                    clickable && 'cursor-pointer',
                    step.status === 'done' && 'border-emerald-500 bg-emerald-500 text-white',
                    step.status === 'current' &&
                      'border-primary bg-primary text-primary-foreground ring-4 ring-primary/15',
                    step.status === 'upcoming' && 'border-border bg-card text-muted-foreground',
                    step.status === 'locked' && 'border-border bg-muted text-muted-foreground/60'
                  )}
                >
                  {step.status === 'done' ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : step.status === 'locked' ? (
                    <Lock className="h-3 w-3" />
                  ) : (
                    i + 1
                  )}
                </button>

                {/* Right half-connector */}
                <span
                  className={cn(
                    'h-0.5 flex-1 rounded-full transition-colors',
                    isLast
                      ? 'opacity-0'
                      : rightFilled
                        ? 'bg-gradient-to-r from-emerald-500 to-primary'
                        : 'bg-border'
                  )}
                />
              </div>

              {/* Label */}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onSelect?.(step.id)}
                className={cn(
                  'mt-2 max-w-[8rem] text-center text-fine-print leading-tight transition-colors',
                  clickable && 'cursor-pointer hover:text-foreground',
                  step.status === 'current'
                    ? 'font-semibold text-foreground'
                    : step.status === 'done'
                      ? 'text-foreground/80'
                      : 'text-muted-foreground'
                )}
              >
                {step.label}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
