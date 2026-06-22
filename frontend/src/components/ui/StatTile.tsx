import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Gradient tile palette for the Material stat cards. Mirrors the dashboard /
 * Syllabus sequence (dark / blue / green / pink), with a color-matched glow
 * under each tile. Single source of truth so every page matches.
 */
export const STAT_TILE: Record<string, { tile: string; glow: string }> = {
  slate: {
    tile: 'bg-gradient-to-br from-slate-600 to-slate-800',
    glow: 'shadow-lg shadow-slate-500/40',
  },
  blue: {
    tile: 'bg-gradient-to-br from-[#4d88ef] to-[#024ad8]',
    glow: 'shadow-lg shadow-[#024ad8]/40',
  },
  emerald: {
    tile: 'bg-gradient-to-br from-emerald-400 to-emerald-600',
    glow: 'shadow-lg shadow-emerald-500/40',
  },
  rose: {
    tile: 'bg-gradient-to-br from-rose-400 to-pink-600',
    glow: 'shadow-lg shadow-rose-500/40',
  },
  amber: {
    tile: 'bg-gradient-to-br from-amber-400 to-orange-500',
    glow: 'shadow-lg shadow-amber-500/40',
  },
}

export type StatTileColor = keyof typeof STAT_TILE

/**
 * Material "stat card" used on the dashboard and the Course Architect wizard
 * pages. Gradient rounded-square icon tile + large value, label/hint below a
 * hairline divider.
 */
export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
  color = 'blue',
}: {
  icon: LucideIcon
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'warning'
  color?: StatTileColor
}) {
  const { tile, glow } = tone === 'warning' ? STAT_TILE.amber : STAT_TILE[color]
  return (
    <div className="md-card p-4">
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            'md-tile inline-flex h-10 w-10 items-center justify-center text-white',
            tile,
            glow
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="text-2xl font-bold tracking-tight text-foreground">{value}</span>
      </div>
      <div className="mt-3 border-t border-border/70 pt-2.5">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        {hint && (
          <p
            className={cn(
              'mt-0.5 text-xs',
              tone === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
            )}
          >
            {hint}
          </p>
        )}
      </div>
    </div>
  )
}
