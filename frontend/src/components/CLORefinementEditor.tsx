import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { showToast } from '@/components/ui/Toaster'
import {
  fetchCloRefinements,
  saveCloRefinements,
  type CLO,
  type CloApprovalStatus,
  type CloRefinementItem,
  type CloRefinementReviewSummary,
  type CouncilFeedbackSummary,
  type FullCouncilAnalysis,
  type SmeRefinementDecision,
} from '@/services/api'
import { cn } from '@/lib/utils'
import {
  Save,
  Loader2,
  AlertCircle,
  Target,
  Sparkles,
  Check,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronRight,
  XCircle,
  Ban,
  Pencil,
  RefreshCw,
} from 'lucide-react'
import { StatTile, STAT_TILE } from '@/components/ui/StatTile'

/**
 * Per-CLO accent: reuses the dashboard / StatTile gradient palette (tile + glow)
 * and pairs it with a matching text color for the CLO id. The card surface stays
 * neutral grey; only the icon tile and id carry the color.
 */
const CLO_ACCENTS: { key: keyof typeof STAT_TILE; text: string }[] = [
  { key: 'blue', text: 'text-[#024ad8] dark:text-blue-300' },
  { key: 'emerald', text: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'rose', text: 'text-rose-600 dark:text-rose-400' },
  { key: 'amber', text: 'text-amber-600 dark:text-amber-400' },
  { key: 'slate', text: 'text-slate-600 dark:text-slate-300' },
]

/**
 * Semantic Bloom-level pill colors — consistent for the same level across every
 * card (unlike the old per-card rotation).
 */
const BLOOM_BADGE: Record<string, string> = {
  remember: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  understand: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  apply: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  analyze: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  evaluate: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  create: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
}

function bloomBadgeClass(level?: string): string {
  return (
    BLOOM_BADGE[(level || '').toLowerCase()] ||
    'bg-muted text-muted-foreground'
  )
}

const DECISION_LABELS: Record<SmeRefinementDecision, string> = {
  pending: 'Pending',
  keep_official: 'Keep official CLO',
  accept_ai_refinement: 'Accept AI refinement',
  custom_wording: 'Edit wording',
}

const DECISION_OPTIONS: {
  value: Exclude<SmeRefinementDecision, 'pending'>
  label: string
  icon: JSX.Element
}[] = [
  {
    value: 'accept_ai_refinement',
    label: DECISION_LABELS.accept_ai_refinement,
    icon: <Sparkles className="h-4 w-4" />,
  },
  {
    value: 'custom_wording',
    label: DECISION_LABELS.custom_wording,
    icon: <Pencil className="h-4 w-4" />,
  },
  {
    value: 'keep_official',
    label: DECISION_LABELS.keep_official,
    icon: <Ban className="h-4 w-4" />,
  },
]

/**
 * Per-CLO approval actions reuse the dashboard Material button shape (`md-btn`)
 * but swap in the page's semantic gradients: emerald for approve, rose for
 * needs-revision (matching the Approved / Needs Revision stat tiles).
 */
const ACTION_BTN_BASE =
  'md-btn inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const APPROVE_BTN = cn(ACTION_BTN_BASE, STAT_TILE.emerald.tile, 'focus-visible:ring-emerald-500/40')
const REVISION_BTN = cn(ACTION_BTN_BASE, STAT_TILE.rose.tile, 'focus-visible:ring-rose-500/40')

/**
 * SME decision buttons share a single blue family: a light blue tint at rest
 * that darkens to solid blue on hover, and the full blue gradient once selected
 * so the chosen option stays clearly distinct.
 */
const SME_BTN_BASE =
  'inline-flex w-full items-center justify-center gap-2 rounded-[12px] px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const SME_BTN_IDLE = cn(
  SME_BTN_BASE,
  'border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-600 hover:text-white hover:border-transparent'
)
const SME_BTN_SELECTED = cn(
  SME_BTN_BASE,
  'md-btn border border-transparent bg-gradient-to-br from-[#296ef9] to-[#024ad8] text-white'
)

/**
 * Regenerate button: amber so it stands out as a distinct, destructive-ish action
 * (re-runs the council and resets approvals) — a light amber tint that darkens to
 * solid amber on hover.
 */
const REGEN_BTN =
  'inline-flex items-center justify-center gap-2 rounded-[12px] border border-amber-500/40 bg-amber-500/15 font-semibold text-amber-700 transition-colors hover:border-transparent hover:bg-amber-600 hover:text-white dark:text-amber-300 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background'

const APPROVAL_LABELS: Record<CloApprovalStatus, string> = {
  pending: 'Pending approval',
  approved: 'CLO approved',
  needs_revision: 'Needs revision',
}

function approvalBadgeClass(status: CloApprovalStatus): string {
  switch (status) {
    case 'approved':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
    case 'needs_revision':
      return 'bg-red-500/15 text-red-600 dark:text-red-400'
    default:
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
  }
}

function FeedbackField({ label, value }: { label: string; value?: string }) {
  if (!value?.trim()) return null
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">{label}</p>
      <p className="text-sm leading-relaxed text-foreground/90">{value}</p>
    </div>
  )
}

function CouncilFeedbackBlock({ summary }: { summary: CouncilFeedbackSummary }) {
  const hasContent = Object.values(summary).some((v) => v?.trim())
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-bold uppercase tracking-wider label-accent hover:opacity-80 [&::-webkit-details-marker]:hidden">
        <Sparkles className="h-3.5 w-3.5" />
        Council Feedback Summary
      </summary>
      <div className="space-y-3.5 pt-3">
        {hasContent ? (
          <>
            <FeedbackField label="Strengths" value={summary.strengths} />
            <FeedbackField label="Risks / limitations" value={summary.risks_limitations} />
            <FeedbackField label="Adaptive readiness notes" value={summary.adaptive_readiness_notes} />
            <FeedbackField label="Evidence of mastery direction" value={summary.evidence_of_mastery_direction} />
            <FeedbackField label="Chairman recommendation" value={summary.chairman_recommendation} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground italic">No council summary available yet.</p>
        )}
      </div>
    </details>
  )
}

function FullAnalysisDisclosure({ analysis }: { analysis: FullCouncilAnalysis }) {
  const fields: { label: string; key: keyof FullCouncilAnalysis }[] = [
    { label: 'Learning Outcome Quality', key: 'learning_outcome_quality' },
    { label: 'Curriculum Coherence', key: 'curriculum_coherence' },
    { label: 'Adaptive Readiness', key: 'adaptive_readiness' },
    { label: 'Assessment Evidence', key: 'assessment_evidence' },
    { label: 'Discipline and Context', key: 'discipline_context' },
    { label: 'Council disagreement', key: 'council_disagreement' },
  ]
  const hasAny = fields.some((f) => analysis[f.key]?.trim())
  if (!hasAny) return null

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-bold uppercase tracking-wider label-accent hover:opacity-80 [&::-webkit-details-marker]:hidden">
        <Sparkles className="h-3.5 w-3.5" />
        View full council analysis
      </summary>
      <div className="space-y-3.5 pt-3">
        {fields.map(({ label, key }) => (
          <FeedbackField key={key} label={label} value={analysis[key]} />
        ))}
      </div>
    </details>
  )
}

function CLORefinementZone({
  clo,
  item,
  colorIndex,
  readOnlyRefinement,
  saving,
  noteChanged,
  onUpdate,
  onApproveClo,
  onSaveNote,
  expanded,
  onToggle,
}: {
  clo: CLO
  item: CloRefinementItem
  colorIndex: number
  readOnlyRefinement?: boolean
  saving?: boolean
  noteChanged?: boolean
  onUpdate: (item: CloRefinementItem) => void
  onApproveClo?: (item: CloRefinementItem) => void | Promise<void>
  onSaveNote?: () => void | Promise<void>
  expanded: boolean
  onToggle: () => void
}) {
  const accent = CLO_ACCENTS[colorIndex % CLO_ACCENTS.length]
  const accentTile = STAT_TILE[accent.key]

  const applyDecision = (decision: SmeRefinementDecision) => {
    let finalText = item.final_clo_for_adaptive_design
    if (decision === 'keep_official') finalText = item.official_clo
    else if (decision === 'accept_ai_refinement') finalText = item.ai_suggested_refined_clo
    onUpdate({
      ...item,
      sme_decision: decision,
      final_clo_for_adaptive_design: finalText,
      approval_status: item.approval_status === 'approved' ? 'pending' : item.approval_status,
    })
  }

  const finalEditable = !readOnlyRefinement && item.sme_decision === 'custom_wording'

  return (
    <div className="space-y-4">
      <div className="rounded-[8px] border border-border/60 bg-muted/40 dark:bg-slate-800/30 overflow-hidden">
      <div
        className={cn('px-5 py-4 cursor-pointer', expanded && 'border-b border-border/60')}
        onClick={onToggle}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'md-tile inline-flex h-10 w-10 items-center justify-center text-white',
              accentTile.tile,
              accentTile.glow
            )}
          >
            <Target className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={cn('text-base font-bold', accent.text)}>{clo.clo_id}</span>
              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded font-semibold',
                  bloomBadgeClass(clo.bloom_level)
                )}
              >
                {clo.bloom_level}
              </span>
              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded font-medium ml-auto',
                  approvalBadgeClass(item.approval_status)
                )}
              >
                {APPROVAL_LABELS[item.approval_status]}
              </span>
              {expanded ? (
                <ChevronDown className="h-5 w-5 text-black/40" />
              ) : (
                <ChevronRight className="h-5 w-5 text-black/40" />
              )}
            </div>
            <p className="text-sm text-black/70 dark:text-slate-400 line-clamp-2">{item.official_clo}</p>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="p-5 space-y-5">
          {/* 1. Official CLO — flat */}
          <section className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">
              Official CLO
            </p>
            <p className="text-sm leading-relaxed text-foreground/90">{item.official_clo}</p>
          </section>

          {/* 2. Council Feedback Summary + full analysis */}
          <section className="space-y-3">
            <CouncilFeedbackBlock summary={item.council_feedback_summary} />
            <FullAnalysisDisclosure analysis={item.full_council_analysis} />
          </section>

          {/* 3. AI Suggested Refinement — inline, flat */}
          <section className="space-y-3 border-t border-border/60 pt-4">
            <h4 className="text-xs font-bold uppercase tracking-wide label-accent">
              AI Suggested Refinement
            </h4>
            <p className="text-sm leading-relaxed text-foreground/90">
              {item.ai_suggested_refined_clo}
            </p>
            {item.refinement_rationale.length > 0 && (
              <div className="pt-1">
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                  Why Maestro suggests this refinement
                </p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  {item.refinement_rationale.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
      </div>

      {expanded && (
        <>
          {/* SME Decision — segmented Material buttons on one line (unchanged) */}
          {!readOnlyRefinement && (
            <section>
              <h4 className="text-xs font-bold uppercase tracking-wide text-foreground mb-2">SME Decision</h4>
              <div
                className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                role="group"
                aria-label={`Decision for ${clo.clo_id}`}
              >
                {DECISION_OPTIONS.map((opt) => {
                  const selected = item.sme_decision === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => applyDecision(opt.value)}
                      className={selected ? SME_BTN_SELECTED : SME_BTN_IDLE}
                    >
                      {opt.icon}
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* Final CLO for Adaptive Design — its own card, always expanded */}
          <div className="rounded-[8px] border border-border/60 bg-card overflow-hidden">
            <div className="border-b border-border/60 px-5 py-3">
              <h4 className="text-xs font-bold uppercase tracking-wide label-accent">
                Final CLO for Adaptive Design
              </h4>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                This wording will be used by later Maestro layers, including assessment redesign, subtopic
                architecture, mastery nodes, evidence criteria, and adaptive logic.
              </p>
            </div>
            <div className="p-5 space-y-3">
              {finalEditable ? (
                <Textarea
                  className="text-sm"
                  rows={3}
                  value={item.final_clo_for_adaptive_design}
                  onChange={(e) => {
                    const text = e.target.value
                    onUpdate({
                      ...item,
                      final_clo_for_adaptive_design: text,
                      sme_decision: 'custom_wording',
                      approval_status:
                        item.approval_status === 'approved' ? 'pending' : item.approval_status,
                    })
                  }}
                />
              ) : (
                <p className="text-sm leading-relaxed text-foreground/90">
                  {item.final_clo_for_adaptive_design}
                </p>
              )}
              {!readOnlyRefinement && item.sme_decision !== 'custom_wording' && (
                <p className="text-xs text-muted-foreground">
                  Select &quot;Edit wording&quot; to customize this text.
                </p>
              )}
            </div>
          </div>

          {/* SME Internal Note */}
          <section>
            <h4 className="text-xs font-bold uppercase tracking-wide text-foreground mb-1">
              SME Internal Note
            </h4>
            <p className="text-xs text-muted-foreground mb-2">
              Optional note for yourself or your team. This note is saved with this course but is not used by
              later Maestro layers unless explicitly included.
            </p>
            <Textarea
              className="text-sm"
              rows={2}
              placeholder="e.g. accreditation constraint, wording to revisit later..."
              value={item.sme_internal_note || ''}
              onChange={(e) => onUpdate({ ...item, sme_internal_note: e.target.value })}
              disabled={false}
            />
            {readOnlyRefinement && noteChanged && (
              <div className="mt-2 flex justify-end">
                <Button size="sm" onClick={() => onSaveNote?.()} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save note
                </Button>
              </div>
            )}
          </section>

          {/* Per-CLO approval */}
          {!readOnlyRefinement && (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={
                  item.approval_status === 'approved' ||
                  saving ||
                  item.sme_decision === 'pending'
                }
                className={APPROVE_BTN}
                title={
                  item.sme_decision === 'pending'
                    ? 'Select an SME decision first'
                    : undefined
                }
                onClick={() => {
                  if (!item.final_clo_for_adaptive_design?.trim()) {
                    showToast({
                      title: 'Final CLO required',
                      description: 'Choose a decision and ensure final wording is set.',
                      variant: 'destructive',
                    })
                    return
                  }
                  onApproveClo?.({ ...item, approval_status: 'approved' })
                }}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Approve CLO
              </button>
              <button
                type="button"
                className={REVISION_BTN}
                onClick={() => onUpdate({ ...item, approval_status: 'needs_revision' })}
              >
                <XCircle className="h-4 w-4" />
                Needs revision
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function computeDraftSummary(items: CloRefinementItem[]): CloRefinementReviewSummary | null {
  if (items.length === 0) return null
  const pending_count = items.filter((d) => d.approval_status === 'pending').length
  const approved_count = items.filter((d) => d.approval_status === 'approved').length
  const needs_revision_count = items.filter((d) => d.approval_status === 'needs_revision').length
  return {
    total_clos: items.length,
    pending_count,
    approved_count,
    needs_revision_count,
    all_approved: approved_count === items.length,
  }
}

interface CLORefinementEditorProps {
  courseCode: string
  layerHasOutput: boolean
  layerApproved?: boolean
  /**
   * Changes whenever Layer 2 is (re)generated (the layer's generatedAt). Used to
   * force a re-fetch so a regenerate clears the previously approved draft instead
   * of leaving the stale approved counter/badges on screen.
   */
  reloadSignal?: string
  /** Opens the regenerate confirmation; regenerating re-runs the council for these CLOs. */
  onRegenerate?: () => void
  /** True while the Layer 2 council is (re)running, to show a spinner and disable the button. */
  isRegenerating?: boolean
  /** Whether regenerate is currently allowed (e.g. not already running). */
  canRegenerate?: boolean
  onSaved?: () => void
  onHasChanges?: (hasChanges: boolean) => void
  onSummaryChange?: (summary: CloRefinementReviewSummary) => void
}

export default function CLORefinementEditor({
  courseCode,
  layerHasOutput,
  layerApproved = false,
  reloadSignal,
  onRegenerate,
  isRegenerating = false,
  canRegenerate = false,
  onSaved,
  onHasChanges,
  onSummaryChange,
}: CLORefinementEditorProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [clos, setClos] = useState<CLO[]>([])
  const [draft, setDraft] = useState<CloRefinementItem[]>([])
  const [initialDraft, setInitialDraft] = useState<CloRefinementItem[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | undefined>()

  const draftSummary = useMemo(() => computeDraftSummary(draft), [draft])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchCloRefinements(courseCode)
      setClos(data.clos)
      setDraft(data.refinements)
      setInitialDraft(data.refinements)
      setGeneratedAt(data.layer2GeneratedAt)
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load refinements',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    if (layerHasOutput) load()
  }, [layerHasOutput, load, reloadSignal])

  const hasChanges = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(initialDraft),
    [draft, initialDraft]
  )

  useEffect(() => {
    onHasChanges?.(hasChanges)
  }, [hasChanges, onHasChanges])

  useEffect(() => {
    if (draftSummary) onSummaryChange?.(draftSummary)
  }, [draftSummary, onSummaryChange])

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpanded = (cloId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(cloId)) next.delete(cloId)
      else next.add(cloId)
      return next
    })
  }

  const handleUpdate = (cloId: string, item: CloRefinementItem) => {
    setDraft((prev) => prev.map((r) => (r.clo_id === cloId ? item : r)))
  }

  const handleSave = async (itemsOverride?: CloRefinementItem[]): Promise<boolean> => {
    try {
      setSaving(true)
      const items = itemsOverride ?? draft
      const result = await saveCloRefinements(courseCode, items)
      setDraft(result.refinements)
      setInitialDraft(result.refinements)
      onSaved?.()
      showToast({
        title: 'Saved',
        description: layerApproved ? 'Personal notes saved' : 'CLO refinements saved',
        variant: 'success',
      })
      return true
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save',
        variant: 'destructive',
      })
      return false
    } finally {
      setSaving(false)
    }
  }

  const handleApproveClo = async (cloId: string, updated: CloRefinementItem) => {
    const next = draft.map((r) => (r.clo_id === cloId ? updated : r))
    setDraft(next)

    // Auto-advance UI: collapse the just-approved item and open the next
    // not-yet-approved CLO by rendered order (none if all later are approved).
    const approvedIndex = clos.findIndex((c) => c.clo_id === cloId)
    let nextCloId: string | null = null
    for (let i = approvedIndex + 1; i < clos.length; i++) {
      const candidate = next.find((r) => r.clo_id === clos[i].clo_id)
      if (candidate && candidate.approval_status !== 'approved') {
        nextCloId = clos[i].clo_id
        break
      }
    }
    setExpandedIds((prev) => {
      const updatedSet = new Set(prev)
      updatedSet.delete(cloId)
      if (nextCloId) updatedSet.add(nextCloId)
      return updatedSet
    })

    await handleSave(next)
  }

  if (!layerHasOutput) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        Run Layer 2 to generate CLO quality review and refinement suggestions.
      </p>
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="flex flex-col rounded-xl border bg-card shadow-sm overflow-hidden mt-4">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-base">CLO Refinement Editor</h3>
          <span className="text-sm text-muted-foreground">{clos.length} CLOs</span>
        </div>
        <div className="flex items-center gap-2">
          {!layerApproved && hasChanges && (
            <span className="text-sm text-amber-600 flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              Unsaved
            </span>
          )}
          {!layerApproved && (
            <Button size="sm" onClick={() => handleSave()} disabled={saving || !hasChanges} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save refinements
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6 p-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              <h4 className="font-bold text-sm">Layer 2 Council</h4>
            </div>
            <div className="flex items-center gap-3">
              {generatedAt && (
                <p className="text-xs text-muted-foreground">
                  Generated {new Date(generatedAt).toLocaleString()}
                </p>
              )}
              {onRegenerate && (
                <button
                  type="button"
                  className={cn(REGEN_BTN, 'h-8 px-3 text-xs')}
                  onClick={onRegenerate}
                  disabled={isRegenerating || !canRegenerate}
                >
                  {isRegenerating ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Regenerating…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-3.5 w-3.5" />
                      Regenerate
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {layerApproved
              ? 'Layer 2 is approved. You can still edit personal notes and save.'
              : 'For each CLO: review council feedback, choose a decision, set the final CLO, then Approve CLO. Save before approving the layer.'}
          </p>
        </div>

        {draftSummary && (
          <div className="md-scope grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatTile icon={Target} label="Total CLOs" value={clos.length} color="slate" />
            <StatTile
              icon={CheckCircle2}
              label="Approved"
              value={draftSummary.approved_count}
              color="emerald"
            />
            <StatTile
              icon={Clock}
              label="Pending"
              value={draftSummary.pending_count}
              color="blue"
            />
            <StatTile
              icon={AlertCircle}
              label="Needs Revision"
              value={draftSummary.needs_revision_count}
              color="rose"
              tone={draftSummary.needs_revision_count > 0 ? 'warning' : 'default'}
            />
          </div>
        )}

        <div className="grid gap-5">
          {clos.map((clo, index) => {
            const item = draft.find((r) => r.clo_id === clo.clo_id)
            if (!item) return null
            const initial = initialDraft.find((r) => r.clo_id === clo.clo_id)
            const noteChanged =
              (item.sme_internal_note || '') !== (initial?.sme_internal_note || '')
            return (
              <CLORefinementZone
                key={clo.clo_id}
                clo={clo}
                item={item}
                colorIndex={index}
                readOnlyRefinement={layerApproved}
                saving={saving}
                noteChanged={noteChanged}
                onUpdate={(updated) => handleUpdate(clo.clo_id, updated)}
                onApproveClo={(updated) => handleApproveClo(clo.clo_id, updated)}
                onSaveNote={async () => {
                  await handleSave()
                }}
                expanded={expandedIds.has(clo.clo_id)}
                onToggle={() => toggleExpanded(clo.clo_id)}
              />
            )
          })}
        </div>
      </div>

      {draftSummary && (
        <div className="px-6 py-4 border-t bg-muted/30 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {draftSummary.approved_count} approved · {draftSummary.pending_count} pending ·{' '}
            {draftSummary.needs_revision_count} need revision
          </span>
          {draftSummary.all_approved ? (
            <span className="flex items-center gap-2 px-3 py-1.5 rounded-md font-medium bg-green-500/10 text-green-600">
              <Check className="h-4 w-4" />
              {layerApproved ? 'Layer 2 approved' : 'All CLOs approved'}
            </span>
          ) : (
            <span className="flex items-center gap-2 px-3 py-1.5 rounded-md font-medium bg-amber-500/10 text-amber-600">
              <AlertCircle className="h-4 w-4" />
              Approve each CLO before approving Layer 2
            </span>
          )}
        </div>
      )}
    </div>
  )
}
