import { Loader2, CheckCircle2, Circle, AlertTriangle } from 'lucide-react'
import type { IngestionProgress } from '@/services/api'
import { cn } from '@/lib/utils'

interface IngestionProgressCardProps {
  progress: IngestionProgress
}

/**
 * One activity row for a single reference-ingestion job. Files ingest one at a
 * time: the active row spins a circular indicator and shows a green "Ingesting"
 * label, finished rows flip to a green check + "Ingested", and the rest wait.
 */
export default function IngestionProgressCard({ progress }: IngestionProgressCardProps) {
  const isError = progress.status === 'error' || progress.phase === 'error'
  const isDone = progress.status === 'completed' || progress.phase === 'done'
  // Seeded jobs carry phase 'queued' until the backend emits their first phase,
  // which only happens once that file's turn comes up in the sequential queue.
  const isWaiting = !isError && !isDone && progress.phase === 'queued'
  const isActive = !isError && !isDone && !isWaiting

  const title = progress.docTitle || progress.filename || 'Reference'

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
        isError
          ? 'border-destructive/40 bg-destructive/5'
          : isActive
            ? 'border-emerald-500/40 bg-emerald-500/5'
            : 'border-border bg-muted/20'
      )}
    >
      {/* Left: circular activity / status graphic */}
      {isActive ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-500" />
      ) : isDone ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
      ) : isError ? (
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
      ) : (
        <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
      )}

      {/* Middle: material name (+ result detail once ingested) */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-xs font-medium',
            isWaiting ? 'text-muted-foreground' : 'text-foreground'
          )}
        >
          {title}
        </p>
        {isError ? (
          <p className="truncate text-[11px] text-destructive">
            {progress.error || 'Failed to ingest'}
          </p>
        ) : isDone && typeof progress.chunkCount === 'number' && progress.chunkCount > 0 ? (
          <p className="truncate text-[11px] text-muted-foreground">
            {progress.chunkCount} passages indexed
          </p>
        ) : null}
      </div>

      {/* Right: status word */}
      <span
        className={cn(
          'shrink-0 text-xs font-semibold',
          isError
            ? 'text-destructive'
            : isActive
              ? 'animate-pulse text-emerald-600 dark:text-emerald-400'
              : isDone
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground'
        )}
      >
        {isError ? 'Failed' : isActive ? 'Ingesting' : isDone ? 'Ingested' : 'Waiting'}
      </span>
    </div>
  )
}
