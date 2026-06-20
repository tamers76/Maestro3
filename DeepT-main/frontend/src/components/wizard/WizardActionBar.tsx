import { type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

export interface WizardAction {
  label: string
  onClick: () => void
  disabled?: boolean
  icon?: ReactNode
}

interface WizardActionBarProps {
  back?: WizardAction
  secondary?: WizardAction
  primary?: WizardAction
  /** Optional hint shown above the bar (e.g. why the primary is disabled). */
  hint?: string
  className?: string
}

/**
 * Sticky bottom action bar shared by every wizard step. Back on the left; a
 * de-emphasised secondary action and a single vivid primary on the right. Keeps
 * the action language identical across the whole journey.
 */
export default function WizardActionBar({
  back,
  secondary,
  primary,
  hint,
  className,
}: WizardActionBarProps) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-30 -mx-6 mt-6 border-t border-border bg-card/95 px-6 py-3 backdrop-blur md:-mx-8 md:px-8',
        className
      )}
    >
      {hint && <p className="mb-2 text-right text-fine-print text-muted-foreground">{hint}</p>}
      <div className="flex items-center justify-between gap-3">
        <div>
          {back && (
            <Button variant="ghost" onClick={back.onClick} disabled={back.disabled}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              {back.label}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {secondary && (
            <Button variant="outline" size="sm" onClick={secondary.onClick} disabled={secondary.disabled}>
              {secondary.icon}
              {secondary.label}
            </Button>
          )}
          {primary && (
            <Button onClick={primary.onClick} disabled={primary.disabled} className="gap-2">
              {primary.label}
              {primary.icon}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
