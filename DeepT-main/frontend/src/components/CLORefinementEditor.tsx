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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Save,
  Loader2,
  AlertCircle,
  Target,
  Sparkles,
  Check,
  ChevronDown,
  ChevronRight,
  XCircle,
  Lock,
  Pencil,
} from 'lucide-react'

const CLO_COLORS = [
  { bg: 'bg-blue-100 dark:bg-blue-900/40', border: 'border-blue-400 dark:border-blue-500', text: 'text-blue-700 dark:text-blue-300', badge: 'bg-blue-500 text-white' },
  { bg: 'bg-emerald-100 dark:bg-emerald-900/40', border: 'border-emerald-400 dark:border-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', badge: 'bg-emerald-500 text-white' },
  { bg: 'bg-violet-100 dark:bg-violet-900/40', border: 'border-violet-400 dark:border-violet-500', text: 'text-violet-700 dark:text-violet-300', badge: 'bg-violet-500 text-white' },
  { bg: 'bg-orange-100 dark:bg-orange-900/40', border: 'border-orange-400 dark:border-orange-500', text: 'text-orange-700 dark:text-orange-300', badge: 'bg-orange-500 text-white' },
  { bg: 'bg-pink-100 dark:bg-pink-900/40', border: 'border-pink-400 dark:border-pink-500', text: 'text-pink-700 dark:text-pink-300', badge: 'bg-pink-500 text-white' },
]

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
  selectedClass: string
  iconClass: string
}[] = [
  {
    value: 'keep_official',
    label: DECISION_LABELS.keep_official,
    icon: <Lock className="h-4 w-4" />,
    selectedClass: 'border-slate-500 bg-slate-500/10',
    iconClass: 'text-slate-600 dark:text-slate-300',
  },
  {
    value: 'accept_ai_refinement',
    label: DECISION_LABELS.accept_ai_refinement,
    icon: <Sparkles className="h-4 w-4" />,
    selectedClass: 'border-purple-500 bg-purple-500/10',
    iconClass: 'text-purple-600 dark:text-purple-400',
  },
  {
    value: 'custom_wording',
    label: DECISION_LABELS.custom_wording,
    icon: <Pencil className="h-4 w-4" />,
    selectedClass: 'border-blue-500 bg-blue-500/10',
    iconClass: 'text-blue-600 dark:text-blue-400',
  },
]

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
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm mt-0.5 leading-relaxed">{value}</p>
    </div>
  )
}

function CouncilFeedbackBlock({ summary }: { summary: CouncilFeedbackSummary }) {
  const hasContent = Object.values(summary).some((v) => v?.trim())
  return (
    <details className="rounded-lg border border-dashed border-border">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-primary hover:underline">
        Council Feedback Summary
      </summary>
      <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
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
    <details className="rounded-lg border border-dashed border-border">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-primary hover:underline">
        View full council analysis
      </summary>
      <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
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
  const colors = CLO_COLORS[colorIndex % CLO_COLORS.length]

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
    <div className={cn('rounded-xl border-2 overflow-hidden', colors.border)}>
      <div
        className={cn('px-5 py-4 border-b cursor-pointer', colors.border, colors.bg)}
        onClick={onToggle}
      >
        <div className="flex items-start gap-3">
          <div className={cn('p-2.5 rounded-lg', colors.badge)}>
            <Target className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={cn('text-base font-bold', colors.text)}>{clo.clo_id}</span>
              <span className={cn('text-xs px-2 py-0.5 rounded font-semibold', colors.badge)}>
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
        <div className="p-4 space-y-5">
          {/* 1. Official CLO */}
          <section>
            <h4 className="text-xs font-bold uppercase tracking-wide text-foreground mb-2">Official CLO</h4>
            <p className="text-sm p-3 rounded-md bg-muted/50 border leading-relaxed">{item.official_clo}</p>
          </section>

          {/* 2. Council Feedback Summary + full analysis */}
          <section className="space-y-3">
            <CouncilFeedbackBlock summary={item.council_feedback_summary} />
            <FullAnalysisDisclosure analysis={item.full_council_analysis} />
          </section>

          {/* 3. AI Suggested Refinement */}
          <section>
            <h4 className="text-xs font-bold uppercase tracking-wide text-foreground mb-2">
              AI Suggested Refinement
            </h4>
            <p className="text-sm p-3 rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/20 leading-relaxed">
              {item.ai_suggested_refined_clo}
            </p>
            {item.refinement_rationale.length > 0 && (
              <div className="mt-3">
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

          {/* 4. Final CLO for Adaptive Design */}
          <section>
            <h4 className="text-xs font-bold uppercase tracking-wide text-foreground mb-1">
              Final CLO for Adaptive Design
            </h4>
            <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
              This wording will be used by later Maestro layers, including assessment redesign, subtopic
              architecture, mastery nodes, evidence criteria, and adaptive logic.
            </p>
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
              <p className="text-sm p-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 leading-relaxed">
                {item.final_clo_for_adaptive_design}
              </p>
            )}
            {!readOnlyRefinement && item.sme_decision !== 'custom_wording' && (
              <p className="text-xs text-muted-foreground mt-1">
                Select &quot;Edit wording&quot; to customize this text.
              </p>
            )}
          </section>

          {/* 5. SME Internal Note */}
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

          {/* 6. SME Decision — radio buttons, directly above approval */}
          {!readOnlyRefinement && (
            <section className="pt-2 border-t border-border">
              <h4 className="text-xs font-bold uppercase tracking-wide text-foreground mb-2">SME Decision</h4>
              <RadioGroup
                value={item.sme_decision === 'pending' ? '' : item.sme_decision}
                onValueChange={(d) => applyDecision(d as SmeRefinementDecision)}
                aria-label={`Decision for ${clo.clo_id}`}
                className="gap-2"
              >
                {DECISION_OPTIONS.map((opt) => {
                  const selected = item.sme_decision === opt.value
                  const itemId = `${clo.clo_id}-${opt.value}`
                  return (
                    <label
                      key={opt.value}
                      htmlFor={itemId}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border-2 px-4 py-3 cursor-pointer transition-colors',
                        selected
                          ? opt.selectedClass
                          : 'border-border bg-card hover:bg-muted/50'
                      )}
                    >
                      <RadioGroupItem id={itemId} value={opt.value} className="size-5" />
                      <span className={cn('flex items-center justify-center', selected ? opt.iconClass : 'text-muted-foreground')}>
                        {opt.icon}
                      </span>
                      <span className="text-sm font-semibold">{opt.label}</span>
                    </label>
                  )
                })}
              </RadioGroup>
            </section>
          )}

          {/* Per-CLO approval */}
          {!readOnlyRefinement && (
            <div className="flex flex-wrap gap-3 pt-2">
              <Button
                size="sm"
                disabled={item.approval_status === 'approved' || saving}
                className="bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:opacity-60"
                onClick={() => {
                  if (!item.final_clo_for_adaptive_design?.trim()) {
                    showToast({
                      title: 'Final CLO required',
                      description: 'Choose a decision and ensure final wording is set.',
                      variant: 'destructive',
                    })
                    return
                  }
                  if (item.sme_decision === 'pending') {
                    showToast({
                      title: 'Decision required',
                      description: 'Select Keep official, Accept AI, or Edit wording first.',
                      variant: 'destructive',
                    })
                    return
                  }
                  onApproveClo?.({ ...item, approval_status: 'approved' })
                }}
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Approve CLO
              </Button>
              <Button
                size="sm"
                className="bg-red-600 text-white hover:bg-red-700 shadow-sm"
                onClick={() => onUpdate({ ...item, approval_status: 'needs_revision' })}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Needs revision
              </Button>
            </div>
          )}
        </div>
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
  onSaved?: () => void
  onHasChanges?: (hasChanges: boolean) => void
  onSummaryChange?: (summary: CloRefinementReviewSummary) => void
  onApproveAndContinue?: () => void | Promise<void>
}

export default function CLORefinementEditor({
  courseCode,
  layerHasOutput,
  layerApproved = false,
  onSaved,
  onHasChanges,
  onSummaryChange,
  onApproveAndContinue,
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
  }, [layerHasOutput, load])

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

  const [continuing, setContinuing] = useState(false)

  const handleReadyForNextLayer = async () => {
    if (!onApproveAndContinue) return
    setContinuing(true)
    try {
      if (hasChanges) {
        const saved = await handleSave()
        if (!saved) return
      }
      await onApproveAndContinue()
    } finally {
      setContinuing(false)
    }
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
        <div className="rounded-xl border-2 border-purple-300 dark:border-purple-600 bg-purple-50/50 dark:bg-purple-900/20 p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              <h4 className="font-bold text-sm">Layer 2 Council</h4>
            </div>
            {generatedAt && (
              <p className="text-xs text-muted-foreground">
                Generated {new Date(generatedAt).toLocaleString()}
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {layerApproved
              ? 'Layer 2 is approved. You can still edit personal notes and save.'
              : 'For each CLO: review council feedback, choose a decision, set the final CLO, then Approve CLO. Save before approving the layer.'}
          </p>
        </div>

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
            layerApproved || !onApproveAndContinue ? (
              <span className="flex items-center gap-2 px-3 py-1.5 rounded-md font-medium bg-green-500/10 text-green-600">
                <Check className="h-4 w-4" />
                {layerApproved ? 'Layer 2 approved' : 'All CLOs approved'}
              </span>
            ) : (
              <Button
                size="sm"
                onClick={handleReadyForNextLayer}
                disabled={saving || continuing}
                className="gap-2"
              >
                {saving || continuing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Approve Layer 2
              </Button>
            )
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
