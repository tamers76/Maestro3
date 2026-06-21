import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookMarked, Check, ChevronDown, ChevronRight, Loader2, Lock, Search, Sparkles, Upload, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { showToast } from '@/components/ui/Toaster'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
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

/** Default for the next propose run — tighter than the backend legacy 0.34 for multi-source corpora. */
const DEFAULT_PROPOSE_THRESHOLD = 0.42
const MIN_PROPOSE_THRESHOLD = 0.2
const MAX_PROPOSE_THRESHOLD = 0.9

function clampProposeThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PROPOSE_THRESHOLD
  return Math.min(MAX_PROPOSE_THRESHOLD, Math.max(MIN_PROPOSE_THRESHOLD, value))
}

/** Cosine score for a specific subtopic on this mapping (best candidate match). */
function subtopicMatchScore(mapping: AlignmentChunkMapping, subtopicId: string): number {
  return mapping.subtopic_candidates.find((c) => c.id === subtopicId)?.score ?? mapping.confidence
}

function StatusBadge({ state }: { state: AlignmentStateSummary }) {
  if (state.is_stale) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-center text-xs font-medium leading-none text-amber-600 dark:text-amber-400">
        Stale — re-activate
      </span>
    )
  }
  if (state.pending_activation) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-center text-xs font-medium leading-none text-amber-600 dark:text-amber-400">
        Preview — not active
      </span>
    )
  }
  const map: Record<AlignmentStateSummary['status'], { label: string; cls: string }> = {
    locked: { label: 'Locked', cls: 'bg-muted text-muted-foreground' },
    no_references: { label: 'No references', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
    available: { label: 'Ready to align', cls: 'bg-primary/10 text-primary' },
    proposed: { label: 'Preview ready', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
    approved: { label: 'Active', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  }
  const s = map[state.status]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full px-2 py-0.5 text-center text-xs font-medium leading-none',
        s.cls
      )}
    >
      {s.label}
    </span>
  )
}

function AlignmentGateBanner({ state }: { state: AlignmentStateSummary }) {
  if (state.node_gen_ready) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
        <Check className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Alignment tags are <span className="font-medium">active</span> ({state.active_tagged_chunk_count}{' '}
          chunk{state.active_tagged_chunk_count === 1 ? '' : 's'}). Safe to generate mastery nodes in the Node
          Engine.
        </span>
      </div>
    )
  }

  if (state.is_stale && state.stale_reason) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{state.stale_reason}</span>
      </div>
    )
  }

  if (state.pending_activation && state.proposed_tagged_chunk_count != null) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <span className="font-medium">{state.proposed_tagged_chunk_count}</span> passage
          {state.proposed_tagged_chunk_count === 1 ? '' : 's'} in the preview —{' '}
          <span className="font-medium">not active</span> for node generation. Node-gen currently uses{' '}
          <span className="font-medium">{state.active_tagged_chunk_count}</span> active tag
          {state.active_tagged_chunk_count === 1 ? '' : 's'} in the database. Click{' '}
          <span className="font-medium">Activate alignment tags</span> to write the preview.
        </span>
      </div>
    )
  }

  if (state.status === 'available') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Preview tag changes to see how references map to subtopics, then activate tags before generating
          mastery nodes.
        </span>
      </div>
    )
  }

  return null
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

export default function ReferenceAlignmentPanel({
  courseCode,
  onAlignmentApproved,
  autoProposeSignal = 0,
  embedded = false,
}: {
  courseCode: string
  /** Called once alignment is approved, so the page can guide the SME to the Node Engine. */
  onAlignmentApproved?: () => void
  /** Increment to auto-preview tag changes (Layer 6 exit, new reference upload). */
  autoProposeSignal?: number
  /** When true, render inside Layer 6 without an outer Card wrapper. */
  embedded?: boolean
}) {
  const { user } = useAuth()
  const approverLabel = user ? user.name || user.email : 'unknown'
  const [state, setState] = useState<AlignmentStateSummary | null>(null)
  const [proposal, setProposal] = useState<ReferenceAlignmentArtifact | null>(null)
  const [loading, setLoading] = useState(true)
  const [proposing, setProposing] = useState(false)
  const [approving, setApproving] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [proposeThreshold, setProposeThreshold] = useState(DEFAULT_PROPOSE_THRESHOLD)
  const lastAutoProposeSignal = useRef(0)

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

  // Resolve a subtopic id -> human label using the candidate labels carried on the mappings.
  const subtopicLabelById = useMemo(() => {
    const m = new Map<string, string>()
    for (const mapping of proposal?.mappings ?? []) {
      for (const c of mapping.subtopic_candidates) if (!m.has(c.id)) m.set(c.id, c.label)
    }
    return m
  }, [proposal])

  // Group the tagged passages under the subtopic they were assigned to, so the SME
  // reviews ~N subtopics instead of hundreds of flat rows.
  const groupedBySubtopic = useMemo(() => {
    const groups = new Map<string, AlignmentChunkMapping[]>()
    for (const m of taggedMappings) {
      const id = m.decided_subtopic_ids[0]
      if (!id) continue
      const arr = groups.get(id) ?? []
      arr.push(m)
      groups.set(id, arr)
    }
    return Array.from(groups.entries())
      .map(([id, mappings]) => ({
        id,
        label: subtopicLabelById.get(id) ?? id,
        // Lowest subtopic-specific scores first — spot-check floor rows before raising threshold.
        mappings: [...mappings].sort(
          (a, b) => subtopicMatchScore(a, id) - subtopicMatchScore(b, id)
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [taggedMappings, subtopicLabelById])

  // Spot-check search: flat matches across all passages (by citation or text).
  const queryLower = query.trim().toLowerCase()
  const searchMatches = useMemo(() => {
    if (!queryLower) return []
    return (proposal?.mappings ?? [])
      .filter(
        (m) =>
          m.citation.toLowerCase().includes(queryLower) ||
          m.text_preview.toLowerCase().includes(queryLower)
      )
      .slice(0, 100)
  }, [proposal, queryLower])

  async function handlePropose(opts: { silent?: boolean } = {}) {
    const threshold = clampProposeThreshold(proposeThreshold)
    try {
      setProposing(true)
      const result = await proposeAlignment(courseCode, { threshold })
      setProposal(result)
      setOpen(true)
      if (!opts.silent) {
        showToast({
          title: 'Alignment preview ready',
          description: `${result.tagged_chunk_count} of ${result.chunk_count} chunks in preview at ${threshold.toFixed(2)}. Activate tags when ready.`,
          variant: 'success',
        })
      }
      await load()
    } catch (error) {
      if (!opts.silent) {
        showToast({
          title: 'Preview failed',
          description: error instanceof Error ? error.message : 'Failed to preview alignment tags',
          variant: 'destructive',
        })
      }
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
      const result = await approveAlignment(courseCode, approverLabel)
      setProposal(result)
      showToast({
        title: 'Alignment tags activated',
        description: `${result.tagged_chunk_count} chunk(s) now active for scoped node grounding.`,
        variant: 'success',
      })
      await load()
      // Guide the SME onward to the Node Engine now that grounding is in place.
      onAlignmentApproved?.()
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
  const tagsLocked = state?.node_gen_ready === true
  const disabledEdits = approving || proposing
  const activePct =
    state && state.chunk_count > 0
      ? Math.round((state.active_tagged_chunk_count / state.chunk_count) * 100)
      : null
  const proposedPct =
    state && state.proposed_tagged_chunk_count != null && state.chunk_count > 0
      ? Math.round((state.proposed_tagged_chunk_count / state.chunk_count) * 100)
      : null
  const activeProposalThreshold = proposal?.threshold ?? state?.threshold

  // Auto-preview when Layer 6 completes or a new reference is uploaded — never after activation.
  useEffect(() => {
    if (autoProposeSignal <= 0 || autoProposeSignal <= lastAutoProposeSignal.current) return
    lastAutoProposeSignal.current = autoProposeSignal
    if (loading || proposing || approving) return
    if (status === 'locked' || status === 'no_references') return
    if (state?.node_gen_ready || status === 'approved' || proposal?.status === 'approved') return
    void handlePropose({ silent: true }).then(() => {
      showToast({
        title: 'Alignment preview updated',
        description: 'Reference passages were re-mapped to subtopics. Review the preview, then activate tags.',
        variant: 'success',
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signal edge only
  }, [autoProposeSignal])

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Layer 6 — Step B · Course Architect exit gate
        </p>
        <h3 className={cn('flex items-center gap-2 font-semibold', embedded ? 'text-base' : 'text-lg')}>
          <BookMarked className="h-5 w-5" />
          Reference Alignment
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          After subtopics are approved, map reference passages to each subtopic.{' '}
          <span className="font-medium text-foreground">Preview</span> shows proposed tags;{' '}
          <span className="font-medium text-foreground">Activate</span> writes them to the database for node
          generation. Preview alone does not change what node-gen uses.
        </p>
      </div>
      {state && <StatusBadge state={state} />}
    </div>
  )

  const body = (
    <div className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading alignment…
          </div>
        ) : (
          <>
            {state && <AlignmentGateBanner state={state} />}

            {/* Dependency / counts */}
            {state && (
              <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs sm:grid-cols-6">
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
                  <p className="text-muted-foreground">Active tags (DB)</p>
                  <p className="font-medium text-foreground">
                    {state.active_tagged_chunk_count}
                    {activePct !== null ? ` (${activePct}%)` : ''}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Preview tags</p>
                  <p className="font-medium text-foreground">
                    {state.proposed_tagged_chunk_count ?? '—'}
                    {proposedPct !== null ? ` (${proposedPct}%)` : ''}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Preview threshold</p>
                  <p className="font-medium text-foreground">
                    {activeProposalThreshold != null ? activeProposalThreshold.toFixed(2) : '—'}
                  </p>
                </div>
              </div>
            )}

            {state?.per_document_tag_summary && state.per_document_tag_summary.length > 0 && (
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <h3 className="text-sm font-semibold text-foreground">Tags by source</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Spot-check each reference — e.g. UbD should show preview tags before you activate.
                </p>
                <ul className="mt-2 space-y-1 text-xs">
                  {state.per_document_tag_summary.map((doc) => (
                    <li key={doc.doc_id} className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-foreground">{doc.title}</span>
                      <span className="text-muted-foreground">
                        {doc.active_tagged_chunks} active
                        {doc.proposed_tagged_chunks != null
                          ? ` → ${doc.proposed_tagged_chunks} preview`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
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

            {/* Alignment threshold — used on the next preview run */}
            {!locked && !state?.node_gen_ready && (
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <h3 className="text-sm font-semibold text-foreground">Alignment threshold</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cosine similarity a passage must clear to be tagged to a subtopic. Lower values tag
                  more passages (multi-source corpora often over-tag at 0.34). Spot-check an existing
                  proposal, then set the threshold just above generic noise and re-propose.
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <div className="min-w-[8rem] space-y-1.5">
                    <label htmlFor="alignment-threshold" className="text-sm font-medium text-foreground">
                      Threshold for next propose
                    </label>
                    <Input
                      id="alignment-threshold"
                      type="number"
                      step="0.01"
                      min={MIN_PROPOSE_THRESHOLD}
                      max={MAX_PROPOSE_THRESHOLD}
                      value={proposeThreshold}
                      disabled={proposing || approving}
                      onChange={(e) =>
                        setProposeThreshold(clampProposeThreshold(Number(e.target.value)))
                      }
                      className="h-8 text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Typical range 0.40–0.48 for multi-source courses.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={proposing || approving}
                      onClick={() => setProposeThreshold(0.34)}
                    >
                      Calibration (0.34)
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={proposing || approving}
                      onClick={() => setProposeThreshold(DEFAULT_PROPOSE_THRESHOLD)}
                    >
                      Recommended (0.42)
                    </Button>
                  </div>
                </div>
                {activeProposalThreshold != null && activeProposalThreshold !== proposeThreshold && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Current proposal was generated at{' '}
                    <span className="font-medium text-foreground">
                      {activeProposalThreshold.toFixed(2)}
                    </span>
                    . Re-propose to apply {proposeThreshold.toFixed(2)}.
                  </p>
                )}
              </div>
            )}

            {/* Actions */}
            {!locked && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => void handlePropose()} disabled={proposing || approving}>
                  {proposing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  {proposal ? 'Preview tag changes' : 'Preview alignment tags'}
                </Button>
                {proposal && proposal.mappings.length > 0 && !state?.node_gen_ready && (
                  <Button size="sm" variant="default" onClick={handleApprove} disabled={approving || proposing}>
                    {approving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    Activate alignment tags
                  </Button>
                )}
                {state?.node_gen_ready && (
                  <>
                    <span className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                      <Check className="h-4 w-4" /> Tags active
                      {proposal?.approved_by ? ` · ${proposal.approved_by}` : ''}
                    </span>
                    {onAlignmentApproved && (
                      <Button size="sm" variant="default" onClick={() => onAlignmentApproved()}>
                        Continue to Node Engine
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    )}
                  </>
                )}
                {state?.status === 'approved' && !state?.node_gen_ready && (
                  <span className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                    <Check className="h-4 w-4" /> Tags active
                  </span>
                )}
              </div>
            )}

            {/* Review & spot-check — approve all in one click, then verify under each subtopic */}
            {proposal && proposal.mappings.length > 0 && (
              <div className="rounded-md border border-border">
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium"
                >
                  <span>
                    Review &amp; spot-check · {taggedMappings.length} tagged to{' '}
                    {groupedBySubtopic.length} subtopic{groupedBySubtopic.length === 1 ? '' : 's'},{' '}
                    {untaggedMappings.length} course-level
                    {activeProposalThreshold != null
                      ? ` · threshold ${activeProposalThreshold.toFixed(2)}`
                      : ''}
                  </span>
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {open && (
                  <div className="space-y-3 border-t border-border p-3">
                    {!tagsLocked && (
                      <p className="text-xs text-muted-foreground">
                        Tags are pre-filled from the reference — you don't need to check every
                        passage. Expand a subtopic to spot-check: passages are sorted{' '}
                        <span className="font-medium text-foreground">lowest score first</span> (floor
                        rows at the top). Compare ~0.34–0.40 noise with ~0.45+ on-topic rows, set your
                        threshold above the noise, re-propose, then{' '}
                        <span className="font-medium text-foreground">Approve all proposed tags</span>.
                      </p>
                    )}

                    {/* Spot-check search */}
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search passages by citation or text to spot-check…"
                        className="w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>

                    {queryLower ? (
                      // Flat search results across all subtopics, each labeled with its assignment.
                      <div className="max-h-[28rem] overflow-auto">
                        <p className="mb-1 text-[11px] text-muted-foreground">
                          {searchMatches.length} match{searchMatches.length === 1 ? '' : 'es'}
                        </p>
                        {searchMatches.map((m) => (
                          <div key={m.chunk_id}>
                            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              {m.decided_subtopic_ids[0]
                                ? subtopicLabelById.get(m.decided_subtopic_ids[0]) ??
                                  m.decided_subtopic_ids[0]
                                : 'Course-level (no tag)'}
                            </p>
                            <MappingRow
                              mapping={m}
                              disabled={disabledEdits || tagsLocked}
                              onReassign={handleReassign}
                            />
                          </div>
                        ))}
                        {searchMatches.length === 0 && (
                          <p className="py-2 text-xs text-muted-foreground">
                            No passages match “{query}”.
                          </p>
                        )}
                      </div>
                    ) : (
                      // Grouped under each subtopic (collapsed by default).
                      <div className="space-y-2">
                        {groupedBySubtopic.map((g) => (
                          <details key={g.id} className="rounded-md border border-border">
                            <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-medium">
                              <span className="truncate">{g.label}</span>
                              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                                {g.mappings.length} passage{g.mappings.length === 1 ? '' : 's'}
                              </span>
                            </summary>
                            <div className="max-h-[24rem] overflow-auto border-t border-border px-3 pb-2">
                              {g.mappings.map((m) => (
                                <MappingRow
                                  key={m.chunk_id}
                                  mapping={m}
                                  disabled={disabledEdits || tagsLocked}
                                  onReassign={handleReassign}
                                />
                              ))}
                            </div>
                          </details>
                        ))}
                        {groupedBySubtopic.length === 0 && (
                          <p className="py-2 text-xs text-muted-foreground">
                            No chunks met the confidence threshold. All references stay course-level
                            — node generation will still ground via the course-level safety net. Use
                            search to find and promote specific passages.
                          </p>
                        )}

                        {/* Course-level (untagged) group */}
                        {untaggedMappings.length > 0 && (
                          <details className="rounded-md border border-dashed border-border">
                            <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
                              <span>Course-level (untagged)</span>
                              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px]">
                                {untaggedMappings.length}
                              </span>
                            </summary>
                            <div className="max-h-[24rem] overflow-auto border-t border-border px-3 pb-2">
                              {untaggedMappings.slice(0, 200).map((m) => (
                                <MappingRow
                                  key={m.chunk_id}
                                  mapping={m}
                                  disabled={disabledEdits || tagsLocked}
                                  onReassign={handleReassign}
                                />
                              ))}
                              {untaggedMappings.length > 200 && (
                                <p className="py-2 text-xs text-muted-foreground">
                                  Showing first 200 of {untaggedMappings.length}. Use search to find
                                  a specific passage.
                                </p>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
    </div>
  )

  if (embedded) {
    return (
      <div className="space-y-3">
        {header}
        {body}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>{header}</CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
