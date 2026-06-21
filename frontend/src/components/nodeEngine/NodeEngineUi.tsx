import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { showToast } from '@/components/ui/Toaster'
import type { BlueprintVehicle } from '@/services/api'
import {
  DEFAULT_NODE_ENGINE_FILTERS,
  PURPOSE_FILTER_OPTIONS,
  VEHICLE_FILTER_OPTIONS,
  isFilterActive,
  statusOptionsForLayer,
  type LayerFilterKind,
  type NodeEngineFilterState,
} from './nodeEngineFilters'

export function EntityCodeBadge({
  code,
  className,
}: {
  code: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      showToast({ title: 'Copied', description: code, variant: 'success' })
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      showToast({ title: 'Copy failed', variant: 'destructive' })
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        void handleCopy()
      }}
      title={`Copy ${code}`}
      className={cn(
        'shrink-0 rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground',
        className
      )}
    >
      {copied ? 'Copied' : code}
    </button>
  )
}

export function MasteryNodeSummary({
  nodeIndex,
  title,
  nodeId,
  children,
  highlight,
}: {
  nodeIndex: number
  title: string
  nodeId: string
  children?: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2',
        highlight && 'rounded-md ring-1 ring-primary/30'
      )}
    >
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Mastery node {nodeIndex}
        </span>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          {children}
        </div>
      </div>
      <EntityCodeBadge code={nodeId} />
    </div>
  )
}

export function ObjectRowHeader({
  objectIndex,
  objectTotal,
  title,
  objectId,
  children,
  highlight,
}: {
  objectIndex?: number
  objectTotal?: number
  title: string
  objectId: string
  children?: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'mb-2 flex items-start gap-2',
        highlight && 'rounded-md ring-1 ring-primary/30'
      )}
    >
      <div className="min-w-0 flex-1">
        {objectIndex != null && objectTotal != null && (
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Learning object {objectIndex} of {objectTotal}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          {children}
        </div>
      </div>
      <EntityCodeBadge code={objectId} />
    </div>
  )
}

interface NodeEngineFilterBarProps {
  layer: LayerFilterKind
  filters: NodeEngineFilterState
  onChange: (filters: NodeEngineFilterState) => void
  matchCount?: { nodes: number; objects: number }
}

export function NodeEngineFilterBar({
  layer,
  filters,
  onChange,
  matchCount,
}: NodeEngineFilterBarProps) {
  const active = isFilterActive(filters)
  const statusOptions = statusOptionsForLayer(layer)

  function patch(partial: Partial<NodeEngineFilterState>) {
    onChange({ ...filters, ...partial })
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={filters.query}
          onChange={(e) => patch({ query: e.target.value })}
          placeholder="Search nodes & objects by title, code, subtopic, purpose…"
          className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {filters.query && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => patch({ query: '' })}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          className="rounded-md border border-border bg-background px-2 py-1.5"
          value={filters.vehicle}
          onChange={(e) => patch({ vehicle: e.target.value as BlueprintVehicle | 'all' })}
        >
          <option value="all">All vehicles</option>
          {VEHICLE_FILTER_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>

        <select
          className="rounded-md border border-border bg-background px-2 py-1.5"
          value={filters.purpose}
          onChange={(e) => patch({ purpose: e.target.value })}
        >
          <option value="all">All purposes</option>
          {PURPOSE_FILTER_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <select
          className="rounded-md border border-border bg-background px-2 py-1.5"
          value={filters.artifactStatus}
          onChange={(e) =>
            patch({ artifactStatus: e.target.value as NodeEngineFilterState['artifactStatus'] })
          }
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {active && (
          <button
            type="button"
            className="text-muted-foreground underline hover:text-foreground"
            onClick={() => onChange(DEFAULT_NODE_ENGINE_FILTERS)}
          >
            Clear filters
          </button>
        )}
      </div>

      {active && matchCount && (
        <p className="text-xs text-muted-foreground">
          {matchCount.objects > 0
            ? `${matchCount.objects} object(s) in ${matchCount.nodes} node(s) match`
            : 'No matches — try clearing a filter or broadening your search'}
        </p>
      )}
    </div>
  )
}
