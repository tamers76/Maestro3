import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookMarked, Check, ChevronDown, ChevronRight, Loader2, Lock, Sparkles, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { showToast } from '@/components/ui/Toaster'
import { cn } from '@/lib/utils'
import { useRole } from '@/contexts/RoleContext'
import {
  fetchAlignment,
  proposeAlignment,
  updateAlignmentMapping,
  approveAlignment,
  type AlignmentStateSummary,
  type ReferenceAlignmentArtifact,
  type AlignmentChunkMapping,
} from '@/services/api'

const COURSE_LEVEL = '__course_level__'

function StatusBadge({ status }: { status: AlignmentStateSummary['status'] }) {
  const map: Record<AlignmentStateSummary['status'], { label: string; cls: string }> = {
    locked: { label: 'Locked', cls: 'bg-muted text-muted-foreground' },
    no_references: { label: 'No references', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
    available: { label: 'Ready to align', cls: 'bg-primary/10 text-primary' },
    proposed: { label: 'Proposed — review', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
    approved: { label: 'Approved', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  }
  const s = map[status]
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', s.cls)}>{s.label}</span>
}

/** One reviewable chunk → subtopic mapping row. */
function MappingRow({
  mapping,
  disabled,
  onReassign,
}: {
  mapping: AlignmentChunkMapping
  disabled: boolean
  onReassign: (chunkId: string, subtopicId: string | null) => void
}) {
  const decided = mapping.decided_subtopic_ids[0] ?? COURSE_LEVEL
  // Build option set: top subtopic candidates + course-level.
  const options = mapping.subtopic_candidates
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-border py-2 last:border-b-0 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground" title={mapping.citation}>
          {mapping.citation}
        </p>
        <p className="line-clamp-2 text-xs text-muted-foreground">{mapping.text_preview}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          confidence {mapping.confidence.toFixed(3)}
          {mapping.edited && <span className="ml-1 text-primary">· edited</span>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <select
          value={decided}
          disabled={disabled}
          onChange={(e) => onReassign(mapping.chunk_id, e.target.value === COURSE_LEVEL ? null : e.target.value)}
          className="max-w-[16rem] rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value={COURSE_LEVEL}>Course-level (no tag)</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({c.score.toFixed(2)})
            </option>
          ))}
          {/* Keep a currently-decided id selectable even if it dropped out of the top candidates. */}
          {decided !== COURSE_LEVEL && !options.some((c) => c.id === decided) && (
            <option value={decided}>{decided}</option>
          )}
        </select>
      </div>
    </div>
  )
}

export default function ReferenceAlignmentPanel({ courseCode }: { courseCode: string }) {
  const { role } = useRole()
  const [state, setState] = useState<AlignmentStateSummary | null>(null)
  const [proposal, setProposal] = useState<ReferenceAlignmentArtifact | null>(null)
  const [loading, setLoading] = useState(true)
  const [proposing, setProposing] = useState(false)
  const [approving, setApproving] = useState(false)
  const [open, setOpen] = useState(false)
  const [showUntagged, setShowUntagged] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchAlignment(courseCode)
      setState(data.state)
      setProposal(data.proposal)
    } catch {
      setState(null)
      setProposal(null)
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void load()
  }, [load])

  const taggedMappings = useMemo(
    () => (proposal?.mappings ?? []).filter((m) => m.decided_subtopic_ids.length > 0),
    [proposal]
  )
  const untaggedMappings = useMemo(
    () => (proposal?.mappings ?? []).filter((m) => m.decided_subtopic_ids.length === 0),
    [proposal]
  )

  async function handlePropose() {
    try {
      setProposing(true)
      const result = await proposeAlignment(courseCode)
      setProposal(result)
      setOpen(true)
      showToast({
        title: 'Alignment proposed',
        description: `${result.tagged_chunk_count} of ${result.chunk_count} chunks proposed for tagging. Review, then approve.`,
        variant: 'success',
      })
      await load()
    } catch (error) {
      showToast({
        title: 'Propose failed',
        description: error instanceof Error ? error.message : 'Failed to propose alignment',
        variant: 'destructive',
      })
    } finally {
      setProposing(false)
    }
  }

  async function handleReassign(chunkId: string, subtopicId: string | null) {
    if (!proposal) return
    // Optimistic local update; persist the single edit.
    try {
      const updated = await updateAlignmentMapping(courseCode, [
        { chunk_id: chunkId, subtopic_ids: subtopicId ? [subtopicId] : [] },
      ])
      setProposal(updated)
    } catch (error) {
      showToast({
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'Failed to update mapping',
        variant: 'destructive',
      })
    }
  }

  async function handleApprove() {
    try {
      setApproving(true)
      const result = await approveAlignment(courseCode, role)
      setProposal(result)
      showToast({
        title: 'Reference alignment approved',
        description: `Tagged ${result.tagged_chunk_count} chunk(s). Scoped retrieval will now return real passages.`,
        variant: 'success',
      })
      await load()
    } catch (error) {
      showToast({
        title: 'Approve failed',
        description: error instanceof Error ? error.message : 'Failed to approve alignment',
        variant: 'destructive',
      })
    } finally {
      setApproving(false)
    }
  }

  const status = state?.status ?? 'available'
  const locked = status === 'locked' || status === 'no_references'
  const approved = status === 'approved'
  const disabledEdits = approving || proposing

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookMarked className="h-5 w-5" />
              Layer 7 — Reference Alignment
            </CardTitle>
            <CardDescription>
              Tag reference passages to CLOs/subtopics so node generation grounds on the right
              source material. Cautious + reviewable — nothing is written until you approve.
            </CardDescription>
          </div>
          {state && <StatusBadge status={state.status} />}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading alignment…
          </div>
        ) : (
          <>
            {/* Dependency / counts */}
            {state && (
              <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs sm:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">Approved subtopics</p>
                  <p className="font-medium text-foreground">{state.subtopic_count}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Reference docs</p>
                  <p className="font-medium text-foreground">{state.reference_doc_count}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Chunks</p>
                  <p className="font-medium text-foreground">{state.chunk_count}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Tagged</p>
                  <p className="font-medium text-foreground">{state.tagged_chunk_count}</p>
                </div>
              </div>
            )}

            {/* Lock / dependency messaging */}
            {locked && state?.lock_reason && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
                {status === 'no_references' ? (
                  <Upload className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{state.lock_reason}</span>
              </div>
            )}

            {/* Actions */}
            {!locked && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={handlePropose} disabled={proposing || approving}>
                  {proposing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  {proposal ? 'Re-propose Alignment' : 'Propose Alignment'}
                </Button>
                {proposal && proposal.mappings.length > 0 && !approved && (
                  <Button size="sm" variant="default" onClick={handleApprove} disabled={approving || proposing}>
                    {approving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    Approve Alignment
                  </Button>
                )}
                {approved && (
                  <span className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                    <Check className="h-4 w-4" /> Approved
                    {proposal?.approved_by ? ` by ${proposal.approved_by}` : ''}
                  </span>
                )}
              </div>
            )}

            {/* Reviewable mapping */}
            {proposal && proposal.mappings.length > 0 && (
              <div className="rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium"
                >
                  <span>
                    Reviewable mapping · {taggedMappings.length} tagged, {untaggedMappings.length}{' '}
                    course-level
                  </span>
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {open && (
                  <div className="border-t border-border p-3">
                    <p className="mb-2 text-xs text-muted-foreground">
                      Promote a chunk to a subtopic, reassign it, or demote it to course-level
                      (no tag). Approve to write the tags and re-index.
                    </p>
                    <div className="max-h-[28rem] overflow-auto">
                      {taggedMappings.map((m) => (
                        <MappingRow
                          key={m.chunk_id}
                          mapping={m}
                          disabled={disabledEdits || approved}
                          onReassign={handleReassign}
                        />
                      ))}
                      {taggedMappings.length === 0 && (
                        <p className="py-2 text-xs text-muted-foreground">
                          No chunks met the confidence threshold. All references stay course-level —
                          node generation will still ground via the course-level safety net. Promote
                          chunks below to scope them precisely.
                        </p>
                      )}
                    </div>

                    {untaggedMappings.length > 0 && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => setShowUntagged((v) => !v)}
                          className="text-xs font-medium text-muted-foreground hover:text-foreground"
                        >
                          {showUntagged ? 'Hide' : 'Show'} {untaggedMappings.length} course-level
                          (untagged) chunks
                        </button>
                        {showUntagged && (
                          <div className="mt-2 max-h-[28rem] overflow-auto">
                            {untaggedMappings.slice(0, 200).map((m) => (
                              <MappingRow
                                key={m.chunk_id}
                                mapping={m}
                                disabled={disabledEdits || approved}
                                onReassign={handleReassign}
                              />
                            ))}
                            {untaggedMappings.length > 200 && (
                              <p className="py-2 text-xs text-muted-foreground">
                                Showing first 200 of {untaggedMappings.length}.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
