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
        'glass-strong w-full rounded-2xl relative isolate overflow-hidden',
        hoverGlow && 'clay-card-interactive',
        className
      )}
    >
      <div
        className={cn('w-full rounded-xl relative text-foreground', paddingMap[padding], innerClassName)}
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
