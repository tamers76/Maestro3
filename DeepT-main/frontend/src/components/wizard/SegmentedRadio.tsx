import { type ReactNode, useId } from 'react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { GlassFilter } from '@/components/ui/liquid-radio'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: string
  icon?: ReactNode
  disabled?: boolean
}

interface SegmentedRadioProps<T extends string = string> {
  options: SegmentedOption<T>[]
  value: T
  onValueChange: (value: T) => void
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

/**
 * Apple-neat segmented control built on the liquid-glass radio. A single white
 * indicator slides under the selected segment with a subtle primary glow; the
 * `#radio-glass` displacement filter adds a quiet refraction. Generalised to any
 * number of segments — the indicator width/offset is derived from the count.
 */
export function SegmentedRadio<T extends string = string>({
  options,
  value,
  onValueChange,
  className,
  disabled,
  'aria-label': ariaLabel,
}: SegmentedRadioProps<T>) {
  const groupId = useId()
  const count = Math.max(options.length, 1)
  const matchedIndex = options.findIndex((o) => o.value === value)
  const hasSelection = matchedIndex >= 0
  const selectedIndex = hasSelection ? matchedIndex : 0
  const segmentWidthPct = 100 / count

  return (
    <div
      className={cn(
        'relative inline-flex h-11 w-full rounded-lg bg-muted/60 p-1',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
    >
      {/* Liquid-glass refraction layer (subtle) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 isolate -z-10 overflow-hidden rounded-lg"
        style={{ filter: 'url("#radio-glass")' }}
      />

      {/* Sliding indicator — white pill with a subtle primary glow */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-1 left-1 rounded-md bg-card',
          'shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.04)]',
          'ring-1 ring-primary/30',
          'transition-all duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]',
          !hasSelection && 'opacity-0'
        )}
        style={{
          width: `calc(${segmentWidthPct}% - 0.25rem)`,
          transform: `translateX(calc(${selectedIndex} * (100% + 0.5rem)))`,
          boxShadow:
            '0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04), 0 0 12px hsl(var(--primary) / 0.18)',
        }}
      />

      <RadioGroup
        value={value}
        onValueChange={(v) => onValueChange(v as T)}
        className="relative z-10 grid w-full gap-0"
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
        aria-label={ariaLabel}
      >
        {options.map((option) => {
          const selected = option.value === value
          const itemId = `${groupId}-${option.value}`
          return (
            <label
              key={option.value}
              htmlFor={itemId}
              className={cn(
                'inline-flex h-full cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-caption font-medium transition-colors duration-200',
                selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                option.disabled && 'cursor-not-allowed opacity-50'
              )}
            >
              {option.icon}
              <span>{option.label}</span>
              <RadioGroupItem
                id={itemId}
                value={option.value}
                disabled={option.disabled}
                className="sr-only"
              />
            </label>
          )
        })}
      </RadioGroup>

      <GlassFilter />
    </div>
  )
}
