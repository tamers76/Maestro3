import { type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { mdBtn, mdBtnSoft } from '@/components/ui/materialButton'
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
  // Nothing to show (e.g. first layer, not yet approved, no hint) → render nothing
  // so there's no empty bar / leftover chrome on the page.
  if (!back && !secondary && !primary && !hint) return null

  return (
    <div className={cn('md-scope mt-6', className)}>
      {hint && <p className="mb-2 text-right text-fine-print text-muted-foreground">{hint}</p>}
      <div className="flex items-center justify-between gap-3">
        <div>
          {back && (
            <button type="button" className={mdBtnSoft} onClick={back.onClick} disabled={back.disabled}>
              <ChevronLeft className="h-4 w-4" />
              {back.label}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {secondary && (
            <button
              type="button"
              className={mdBtnSoft}
              onClick={secondary.onClick}
              disabled={secondary.disabled}
            >
              {secondary.icon}
              {secondary.label}
            </button>
          )}
          {primary && (
            <button
              type="button"
              className={mdBtn}
              onClick={primary.onClick}
              disabled={primary.disabled}
            >
              {primary.label}
              {primary.icon}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
