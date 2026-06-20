import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface GlassPanelProps {
  children: ReactNode
  className?: string
  innerClassName?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hoverGlow?: boolean
}

const paddingMap = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4 sm:p-5',
  lg: 'p-5 sm:p-6',
} as const

export function GlassPanel({
  children,
  className,
  innerClassName,
  padding = 'md',
  hoverGlow = true,
}: GlassPanelProps) {
  return (
    <div
      className={cn(
        'w-full rounded-2xl relative isolate overflow-hidden p-1.5',
        'bg-white/5 dark:bg-black/90',
        'bg-gradient-to-br from-black/5 to-black/[0.02] dark:from-white/5 dark:to-white/[0.02]',
        'backdrop-blur-xl backdrop-saturate-[180%]',
        'border border-black/10 dark:border-white/10',
        'shadow-[0_8px_16px_rgb(0_0_0_/_0.15)] dark:shadow-[0_8px_16px_rgb(0_0_0_/_0.25)]',
        className
      )}
    >
      <div
        className={cn(
          'w-full rounded-xl relative',
          paddingMap[padding],
          'bg-gradient-to-br from-black/[0.05] to-transparent dark:from-white/[0.08] dark:to-transparent',
          'backdrop-blur-md backdrop-saturate-150',
          'border border-black/[0.05] dark:border-white/[0.08]',
          'text-foreground shadow-sm',
          hoverGlow &&
            'before:absolute before:inset-0 before:rounded-xl before:bg-gradient-to-br before:from-black/[0.02] before:to-black/[0.01] dark:before:from-white/[0.03] dark:before:to-white/[0.01] before:opacity-0 before:transition-opacity before:pointer-events-none hover:before:opacity-100',
          innerClassName
        )}
      >
        {children}
      </div>
    </div>
  )
}

interface GlassProfileHeaderProps {
  imageUrl?: string | null
  name: string
  subtitle: string
  verified?: boolean
  badge?: ReactNode
  action?: ReactNode
}

export function GlassProfileHeader({
  imageUrl,
  name,
  subtitle,
  verified = false,
  badge,
  action,
}: GlassProfileHeaderProps) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0">
        <div className="h-10 w-10 rounded-full overflow-hidden border border-black/10 dark:border-white/10 bg-muted">
          {imageUrl ? (
            <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground text-xs font-medium">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-semibold text-foreground truncate">{name}</span>
              {verified && badge}
            </div>
            <span className="text-muted-foreground text-sm truncate block">{subtitle}</span>
          </div>
          {action}
        </div>
      </div>
    </div>
  )
}

interface GlassReplyStripProps {
  children: ReactNode
  className?: string
}

export function GlassReplyStrip({ children, className }: GlassReplyStripProps) {
  return (
    <div
      className={cn(
        'mt-4 pt-4 border-t border-black/[0.08] dark:border-white/[0.08]',
        className
      )}
    >
      {children}
    </div>
  )
}
