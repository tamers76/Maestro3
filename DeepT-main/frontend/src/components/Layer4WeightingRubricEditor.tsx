import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { Input } from '@/components/ui/Input'
import { Markdown } from '@/components/ui/Markdown'
import { showToast } from '@/components/ui/Toaster'
import {
  fetchWeightingRubric,
  saveWeightingRubric,
  type AnalyticRubricCriterion,
  type AssessmentStructureReview,
  type CloApprovalStatus,
  type CourseLevelWeightingSummary,
  type ProcessEvidenceStatus,
  type WeightDecision,
  type WeightingRubricReviewSummary,
} from '@/services/api'
import { cn } from '@/lib/utils'
import {
  Save,
  Loader2,
  AlertCircle,
  ClipboardList,
  Check,
  XCircle,
  Pencil,
  Plus,
  Trash2,
  ArrowDown,
  ArrowUp,
  Minus,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function parsePct(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number.parseFloat(value.replace(/[^0-9.\-]/g, ''))
    if (Number.isFinite(n)) return n
  }
  return 0
}

function formatPct(n: number): string {
  const rounded = Math.round(n * 100) / 100
  return `${Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2)}%`
}

const EVIDENCE_STATUS_OPTIONS: { value: ProcessEvidenceStatus; label: string }[] = [
  { value: 'required', label: 'Required' },
  { value: 'graded', label: 'Graded' },
  { value: 'integrity_evidence_only', label: 'Integrity evidence only' },
  { value: 'optional', label: 'Optional' },
  { value: 'not_required', label: 'Not required' },
]

const REVISION_POLICY_PRESETS = [
  'No revision after final submission',
  'One revision allowed before final grade',
  'Revision allowed only if readiness gate was passed',
  'Revision allowed for process evidence only',
  'SME decides per assessment',
]

const AI_DISCLOSURE_PRESETS = [
  'Required but not graded',
  'Required and graded as part of process transparency',
  'Required for integrity verification only',
  'Not required',
]

const CARD_COLORS = [
  { border: 'border-blue-400 dark:border-blue-500', bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-700 dark:text-blue-300', badge: 'bg-blue-500 text-white' },
  { border: 'border-emerald-400 dark:border-emerald-500', bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-700 dark:text-emerald-300', badge: 'bg-emerald-500 text-white' },
  { border: 'border-violet-400 dark:border-violet-500', bg: 'bg-violet-100 dark:bg-violet-900/40', text: 'text-violet-700 dark:text-violet-300', badge: 'bg-violet-500 text-white' },
  { border: 'border-orange-400 dark:border-orange-500', bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-700 dark:text-orange-300', badge: 'bg-orange-500 text-white' },
  { border: 'border-pink-400 dark:border-pink-500', bg: 'bg-pink-100 dark:bg-pink-900/40', text: 'text-pink-700 dark:text-pink-300', badge: 'bg-pink-500 text-white' },
]

const APPROVAL_LABELS: Record<CloApprovalStatus, string> = {
  pending: 'Pending approval',
  approved: 'Structure approved',
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

function FieldLabel({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
      <span className="h-3 w-1 shrink-0 rounded-full bg-primary/70" />
      {label}
    </p>
  )
}

function TextField({ label, value }: { label: string; value?: string }) {
  if (!value?.trim()) return null
  return (
    <div className="space-y-1">
      <FieldLabel label={label} />
      <Markdown className="pl-2.5 text-foreground">{value}</Markdown>
    </div>
  )
}

function ListBlock({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null
  return (
    <div className="space-y-1">
      <FieldLabel label={label} />
      <ul className="ml-2.5 list-disc space-y-1 pl-4 text-sm leading-relaxed text-foreground/90 marker:text-primary">
        {items.map((it, i) => (
          <li key={i}>
            <Markdown className="[&_p]:my-0 text-foreground/90">{it}</Markdown>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChangeBadge({ current, selected }: { current: number; selected: number }) {
  const diff = Math.round((selected - current) * 100) / 100
  if (diff === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> No change
      </span>
    )
  }
  const up = diff > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        up ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400'
      )}
    >
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {up ? '+' : ''}
      {formatPct(diff)}
    </span>
  )
}

function computeSummary(
  weighting: CourseLevelWeightingSummary,
  reviews: AssessmentStructureReview[]
): WeightingRubricReviewSummary {
  const pending_count = reviews.filter((r) => r.approval_status === 'pending').length
  const approved_count = reviews.filter((r) => r.approval_status === 'approved').length
  const needs_revision_count = reviews.filter((r) => r.approval_status === 'needs_revision').length
  const selectedTotal = weighting.weights.reduce((s, w) => s + parsePct(w.selected_weight), 0)
  const weights_balanced = Math.round(selectedTotal) === 100
  // Selecting a weight option is not approval — Step 2 unlocks only after the SME
  // clicks "Approve Weight Structure & Continue" (step_1_approved) and weights total 100%.
  const weighting_decided = weighting.step_1_approved === true && weights_balanced
  return {
    total_assessments: reviews.length,
    pending_count,
    approved_count,
    needs_revision_count,
    all_approved: reviews.length > 0 && approved_count === reviews.length && weighting_decided,
    weighting_decided,
    assessment_cards_unlocked: weighting_decided,
    selected_weight_total: Math.round(selectedTotal * 100) / 100,
    weights_balanced,
  }
}

function rubricTotal(rubric: AnalyticRubricCriterion[]): number {
  return rubric.reduce((s, c) => s + parsePct(c.criterion_weight), 0)
}

// ----------------------------------------------------------------------------
// Step 1 — Course-Level Weighting Decision
// ----------------------------------------------------------------------------

const STEP1_EXPLANATION =
  'Layer 4 reviews the approved redesigned assessments and helps you decide how they should be weighted, graded, and evaluated. First, confirm the assessment weight structure. Once weights are confirmed, Maestro will show the rubric and grading structure for each assessment.'

function WeightingStep({
  weighting,
  readOnly,
  saving,
  onChange,
  onApproveStep1,
  onEditStep1,
}: {
  weighting: CourseLevelWeightingSummary
  readOnly: boolean
  saving?: boolean
  onChange: (next: CourseLevelWeightingSummary) => void
  onApproveStep1: () => void | Promise<void>
  onEditStep1: () => void | Promise<void>
}) {
  const [editing, setEditing] = useState(weighting.weight_decision === 'custom_weights')
  const step1Approved = weighting.step_1_approved

  const selectedTotal = useMemo(
    () => weighting.weights.reduce((s, w) => s + parsePct(w.selected_weight), 0),
    [weighting.weights]
  )
  const balanced = Math.round(selectedTotal) === 100

  const setDecision = (decision: WeightDecision) => {
    if (decision === 'keep_current') {
      setEditing(false)
      onChange({
        ...weighting,
        weight_decision: 'keep_current',
        weights: weighting.weights.map((w) => ({
          ...w,
          selected_weight: w.current_weight,
          change_type: 'no_change',
        })),
      })
    } else if (decision === 'approve_proposed') {
      setEditing(false)
      onChange({
        ...weighting,
        weight_decision: 'approve_proposed',
        weights: weighting.weights.map((w) => {
          const proposed = parsePct(w.proposed_weight)
          const current = parsePct(w.current_weight)
          return {
            ...w,
            selected_weight: w.proposed_weight,
            change_type:
              proposed > current ? 'increased' : proposed < current ? 'decreased' : 'no_change',
          }
        }),
      })
    } else {
      setEditing(true)
      onChange({ ...weighting, weight_decision: 'custom_weights' })
    }
  }

  const setSelected = (assessmentId: string, raw: string) => {
    onChange({
      ...weighting,
      weight_decision: 'custom_weights',
      weights: weighting.weights.map((w) =>
        w.assessment_id === assessmentId
          ? { ...w, selected_weight: raw }
          : w
      ),
    })
  }

  const decided = weighting.weight_decision !== 'pending'

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 p-4">
        <p className="text-sm text-muted-foreground leading-relaxed">{STEP1_EXPLANATION}</p>
      </div>

      {/* Progression overview */}
      {weighting.assessment_progression_overview.some((p) => p.role_in_progression?.trim()) && (
        <section>
          <h4 className="text-xs font-bold uppercase tracking-wide text-foreground mb-2">
            Assessment Progression Overview
          </h4>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-2 font-semibold">Assessment</th>
                  <th className="px-3 py-2 font-semibold">Role in Learning Progression</th>
                </tr>
              </thead>
              <tbody>
                {weighting.assessment_progression_overview.map((p) => (
                  <tr key={p.assessment_id} className="border-t">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{p.assessment_id}</td>
                    <td className="px-3 py-2 leading-relaxed">{p.role_in_progression}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Weight comparison table */}
      <section>
        <h4 className="text-xs font-bold uppercase tracking-wide text-foreground mb-2">
          Course-Level Weight Comparison
        </h4>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="px-3 py-2 font-semibold">Assessment</th>
                <th className="px-3 py-2 font-semibold text-right">Current</th>
                <th className="px-3 py-2 font-semibold text-right">Proposed</th>
                <th className="px-3 py-2 font-semibold text-right">Selected</th>
                <th className="px-3 py-2 font-semibold">Change</th>
              </tr>
            </thead>
            <tbody>
              {weighting.weights.map((w) => {
                const current = parsePct(w.current_weight)
                const selected = parsePct(w.selected_weight)
                return (
                  <tr key={w.assessment_id} className="border-t">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{w.assessment_id}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{w.current_weight}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{w.proposed_weight}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {editing && !readOnly && !step1Approved ? (
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          className="h-8 w-20 text-right ml-auto"
                          value={selected || ''}
                          onChange={(e) => setSelected(w.assessment_id, e.target.value)}
                        />
                      ) : (
                        <span className="font-semibold">{w.selected_weight}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ChangeBadge current={current} selected={selected} />
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{weighting.current_total_weight}</td>
                <td className="px-3 py-2 text-right tabular-nums">{weighting.proposed_total_weight}</td>
                <td
                  className={cn(
                    'px-3 py-2 text-right tabular-nums',
                    balanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                  )}
                >
                  {formatPct(selectedTotal)}
                </td>
                <td className="px-3 py-2 text-xs">{balanced ? 'Balanced' : 'Must total 100%'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {weighting.weighting_rationale?.trim() && (
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            {weighting.weighting_rationale}
          </p>
        )}

        {editing && !readOnly && !balanced && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-2 flex items-center gap-1">
            <AlertCircle className="h-4 w-4" />
            Assessment weights must total 100% before continuing to rubric review (currently{' '}
            {formatPct(selectedTotal)}).
          </p>
        )}
      </section>

      {/* Decision buttons + Step 1 approval gate */}
      {!readOnly && (
        <section className="space-y-3">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-foreground mb-2">
              Weight Decision
            </h4>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={weighting.weight_decision === 'keep_current' ? 'default' : 'outline'}
                disabled={step1Approved}
                onClick={() => setDecision('keep_current')}
              >
                Keep current weights
              </Button>
              <Button
                size="sm"
                variant={weighting.weight_decision === 'approve_proposed' ? 'default' : 'outline'}
                disabled={step1Approved}
                onClick={() => setDecision('approve_proposed')}
              >
                Approve proposed weights
              </Button>
              <Button
                size="sm"
                variant={weighting.weight_decision === 'custom_weights' ? 'default' : 'outline'}
                disabled={step1Approved}
                onClick={() => setDecision('custom_weights')}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit weights
              </Button>
            </div>
          </div>

          {!step1Approved ? (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Confirm the selected assessment weights before reviewing rubrics. These weights will
                be used in the assessment cards below.
              </p>
              <Button
                onClick={() => onApproveStep1()}
                disabled={!decided || !balanced || saving}
                className="gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Approve Weight Structure &amp; Continue
              </Button>
              {!decided ? (
                <p className="text-xs text-muted-foreground">
                  Select a weight option above to continue.
                </p>
              ) : !balanced ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Selected weights must total 100% before you can approve.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2 border-t border-border pt-3">
              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium text-sm">
                <Check className="h-4 w-4" />
                Step 1 approved — assessment rubric cards are now unlocked below.
              </span>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEditStep1()}
                  disabled={saving}
                  className="gap-1.5"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit Weight Structure
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Rubric table
// ----------------------------------------------------------------------------

const RUBRIC_LEVELS: {
  key: keyof AnalyticRubricCriterion
  label: string
  headClass: string
  dotClass: string
}[] = [
  {
    key: 'exceeds_standard',
    label: 'Exceeds Standard',
    headClass: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    dotClass: 'bg-emerald-500',
  },
  {
    key: 'meets_standard',
    label: 'Meets Standard',
    headClass: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
    dotClass: 'bg-blue-500',
  },
  {
    key: 'developing',
    label: 'Developing',
    headClass: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    dotClass: 'bg-amber-500',
  },
  {
    key: 'not_yet_evident',
    label: 'Not Yet Evident',
    headClass: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
    dotClass: 'bg-rose-500',
  },
]

function emptyCriterion(): AnalyticRubricCriterion {
  return {
    rubric_criterion: '',
    criterion_weight: '',
    exceeds_standard: '',
    meets_standard: '',
    developing: '',
    not_yet_evident: '',
    evidence_required: '',
    ai_scoring_guidance: '',
  }
}

function RubricTable({
  rubric,
  editable,
  onChange,
}: {
  rubric: AnalyticRubricCriterion[]
  editable: boolean
  onChange: (next: AnalyticRubricCriterion[]) => void
}) {
  const total = rubricTotal(rubric)
  const balanced = Math.round(total) === 100

  const updateRow = (index: number, patch: Partial<AnalyticRubricCriterion>) => {
    onChange(rubric.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }
  const removeRow = (index: number) => onChange(rubric.filter((_, i) => i !== index))
  const addRow = () => onChange([...rubric, emptyCriterion()])

  if (!rubric.length && !editable) {
    return (
      <p className="text-sm text-muted-foreground italic">No rubric generated yet.</p>
    )
  }

  return (
    <div className="min-w-0 space-y-2">
      <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs min-w-[1100px] border-collapse">
          <thead>
            <tr className="text-left align-top">
              <th className="border-b border-border bg-muted/60 px-2.5 py-2.5 font-bold uppercase tracking-wide text-foreground w-40">
                Rubric Criterion
              </th>
              <th className="border-b border-l border-border bg-muted/60 px-2.5 py-2.5 font-bold uppercase tracking-wide text-foreground w-16 text-right">
                Weight
              </th>
              {RUBRIC_LEVELS.map((l) => (
                <th
                  key={l.key}
                  className={cn(
                    'border-b border-l border-border px-2.5 py-2.5 font-bold uppercase tracking-wide w-44',
                    l.headClass
                  )}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', l.dotClass)} />
                    {l.label}
                  </span>
                </th>
              ))}
              <th className="border-b border-l border-border bg-muted/60 px-2.5 py-2.5 font-bold uppercase tracking-wide text-foreground w-44">
                Evidence Required
              </th>
              <th className="border-b border-l border-border bg-muted/60 px-2.5 py-2.5 font-bold uppercase tracking-wide text-foreground w-44">
                AI Scoring Guidance
              </th>
              {editable && <th className="border-b border-l border-border bg-muted/60 px-2 py-2.5 w-8" />}
            </tr>
          </thead>
          <tbody>
            {rubric.map((c, i) => (
              <tr key={i} className="border-t border-border align-top even:bg-muted/20">
                <td className="border-l-2 border-l-primary/50 px-2.5 py-2.5">
                  {editable ? (
                    <Textarea
                      rows={2}
                      className="text-xs min-h-0"
                      value={c.rubric_criterion}
                      onChange={(e) => updateRow(i, { rubric_criterion: e.target.value })}
                    />
                  ) : (
                    <span className="font-semibold text-foreground">{c.rubric_criterion}</span>
                  )}
                </td>
                <td className="border-l border-border px-2.5 py-2.5 text-right">
                  {editable ? (
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      className="h-8 w-16 text-right text-xs"
                      value={parsePct(c.criterion_weight) || ''}
                      onChange={(e) => updateRow(i, { criterion_weight: e.target.value })}
                    />
                  ) : (
                    <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 font-semibold tabular-nums text-primary">
                      {c.criterion_weight}
                    </span>
                  )}
                </td>
                {RUBRIC_LEVELS.map((l) => (
                  <td key={l.key} className="border-l border-border px-2.5 py-2.5">
                    {editable ? (
                      <Textarea
                        rows={3}
                        className="text-xs min-h-0"
                        value={(c[l.key] as string) || ''}
                        onChange={(e) => updateRow(i, { [l.key]: e.target.value })}
                      />
                    ) : (
                      <span className="leading-relaxed whitespace-pre-line text-foreground/90">
                        {c[l.key] as string}
                      </span>
                    )}
                  </td>
                ))}
                <td className="border-l border-border px-2.5 py-2.5">
                  {editable ? (
                    <Textarea
                      rows={3}
                      className="text-xs min-h-0"
                      value={c.evidence_required}
                      onChange={(e) => updateRow(i, { evidence_required: e.target.value })}
                    />
                  ) : (
                    <span className="leading-relaxed whitespace-pre-line text-foreground/90">
                      {c.evidence_required}
                    </span>
                  )}
                </td>
                <td className="border-l border-border px-2.5 py-2.5">
                  {editable ? (
                    <Textarea
                      rows={3}
                      className="text-xs min-h-0"
                      value={c.ai_scoring_guidance}
                      onChange={(e) => updateRow(i, { ai_scoring_guidance: e.target.value })}
                    />
                  ) : (
                    <span className="leading-relaxed whitespace-pre-line text-muted-foreground">
                      {c.ai_scoring_guidance}
                    </span>
                  )}
                </td>
                {editable && (
                  <td className="border-l border-border px-2 py-2.5">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-red-600"
                      onClick={() => removeRow(i)}
                      aria-label="Remove criterion"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            <tr className="border-t-2 border-border bg-muted/40 font-bold">
              <td className="px-2.5 py-2.5 uppercase tracking-wide text-foreground">Total</td>
              <td
                className={cn(
                  'border-l border-border px-2.5 py-2.5 text-right tabular-nums',
                  balanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                )}
              >
                {formatPct(total)}
              </td>
              <td
                className={cn(
                  'border-l border-border px-2.5 py-2.5 text-xs font-medium',
                  balanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                )}
                colSpan={editable ? 7 : 6}
              >
                {balanced ? 'Criterion weights total 100%' : 'Criterion weights must total 100%'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {editable && (
        <Button size="sm" variant="outline" onClick={addRow} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add criterion
        </Button>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Assessment structure card (Step 2)
// ----------------------------------------------------------------------------

function AssessmentStructureCard({
  review,
  colorIndex,
  selectedWeight,
  currentWeight,
  readOnly,
  saving,
  noteChanged,
  onUpdate,
  onApprove,
  onSaveNote,
  expanded,
  onToggle,
}: {
  review: AssessmentStructureReview
  colorIndex: number
  selectedWeight: string
  currentWeight: string
  readOnly: boolean
  saving?: boolean
  noteChanged?: boolean
  onUpdate: (next: AssessmentStructureReview) => void
  onApprove: (next: AssessmentStructureReview) => void | Promise<void>
  onSaveNote: () => void | Promise<void>
  expanded: boolean
  onToggle: () => void
}) {
  const colors = CARD_COLORS[colorIndex % CARD_COLORS.length]
  const ref = review.final_assessment_from_layer_3
  const rubricEditable = !readOnly && review.rubric_decision === 'edit'
  const structureEditable = !readOnly && review.assessment_structure_decision === 'edit'
  const rubricBalanced = Math.round(rubricTotal(review.ai_assisted_analytic_rubric)) === 100

  const setRubricDecision = (decision: AssessmentStructureReview['rubric_decision']) => {
    onUpdate({
      ...review,
      rubric_decision: decision,
      approval_status:
        decision === 'needs_revision'
          ? 'needs_revision'
          : review.approval_status === 'approved'
            ? 'pending'
            : review.approval_status,
    })
  }

  const setEvidenceStatus = (index: number, status: ProcessEvidenceStatus) => {
    onUpdate({
      ...review,
      process_evidence_requirements: review.process_evidence_requirements.map((e, i) =>
        i === index ? { ...e, status } : e
      ),
    })
  }

  const updateEvidenceItem = (index: number, evidence_item: string) => {
    onUpdate({
      ...review,
      process_evidence_requirements: review.process_evidence_requirements.map((e, i) =>
        i === index ? { ...e, evidence_item } : e
      ),
    })
  }

  const addEvidence = () => {
    onUpdate({
      ...review,
      process_evidence_requirements: [
        ...review.process_evidence_requirements,
        { evidence_item: '', status: 'required' as ProcessEvidenceStatus },
      ],
    })
  }

  const removeEvidence = (index: number) => {
    onUpdate({
      ...review,
      process_evidence_requirements: review.process_evidence_requirements.filter(
        (_, i) => i !== index
      ),
    })
  }

  return (
    <div className={cn('min-w-0 rounded-xl border-2 overflow-hidden', colors.border)}>
      {/* Header */}
      <div
        className={cn('px-5 py-4 border-b cursor-pointer', colors.border, colors.bg)}
        onClick={onToggle}
      >
        <div className="flex items-start gap-3">
          <div className={cn('p-2.5 rounded-lg', colors.badge)}>
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={cn('text-base font-bold', colors.text)}>{review.assessment_id}</span>
              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded font-medium ml-auto',
                  approvalBadgeClass(review.approval_status)
                )}
              >
                {APPROVAL_LABELS[review.approval_status]}
              </span>
              {expanded ? (
                <ChevronDown className="h-5 w-5 text-black/40" />
              ) : (
                <ChevronRight className="h-5 w-5 text-black/40" />
              )}
            </div>
            <p className={cn('text-sm font-semibold', colors.text)}>{ref.title}</p>
            <div className="flex items-center gap-3 mt-1 text-xs text-black/70 dark:text-slate-400">
              <span>Original weight: {currentWeight}</span>
              <span>Selected weight: <strong>{selectedWeight}</strong></span>
              <ChangeBadge current={parsePct(currentWeight)} selected={parsePct(selectedWeight)} />
            </div>
          </div>
        </div>
      </div>

      {expanded && (
      <div className="p-4 space-y-5">
        {/* Approved assessment from Layer 3 (reference only, collapsed by default) */}
        <details className="group rounded-lg border border-border bg-card overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 bg-primary/5 px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-primary hover:bg-primary/10 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-[[open]]:rotate-90" />
            <ClipboardList className="h-4 w-4 shrink-0" />
            Approved Assessment from Layer 3 (reference only)
          </summary>
          <div className="px-4 pb-4 space-y-3.5 border-t border-border pt-3">
            <TextField label="Final assessment title" value={ref.title} />
            <TextField label="Short description" value={ref.description} />
            <TextField label="Required artifact" value={ref.required_artifact} />
            <ListBlock label="Refined CLO alignment" items={ref.refined_clo_alignment} />
            <ListBlock
              label="Suggested evaluation criteria (from Layer 3)"
              items={ref.suggested_evaluation_criteria}
            />
          </div>
        </details>

        {/* AI-Assisted Analytic Rubric */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-primary">
              <ClipboardList className="h-4 w-4" />
              AI-Assisted Analytic Rubric
            </h4>
            {!readOnly && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={review.rubric_decision === 'approve' ? 'default' : 'outline'}
                  onClick={() => setRubricDecision('approve')}
                  disabled={!rubricBalanced}
                  title={rubricBalanced ? undefined : 'Criterion weights must total 100%'}
                >
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  Approve rubric
                </Button>
                <Button
                  size="sm"
                  variant={review.rubric_decision === 'edit' ? 'default' : 'outline'}
                  onClick={() => setRubricDecision('edit')}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Edit rubric
                </Button>
                <Button
                  size="sm"
                  variant={review.rubric_decision === 'needs_revision' ? 'default' : 'outline'}
                  onClick={() => setRubricDecision('needs_revision')}
                >
                  <XCircle className="mr-1.5 h-3.5 w-3.5" />
                  Needs revision
                </Button>
              </div>
            )}
          </div>
          <RubricTable
            rubric={review.ai_assisted_analytic_rubric}
            editable={rubricEditable}
            onChange={(next) => onUpdate({ ...review, ai_assisted_analytic_rubric: next })}
          />
        </section>

        {/* Process evidence requirements */}
        <section className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wide text-foreground">
            Process Evidence Requirements
          </h4>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-2 font-semibold">Process Evidence</th>
                  <th className="px-3 py-2 font-semibold w-56">Status</th>
                  {structureEditable && <th className="px-3 py-2 w-8" />}
                </tr>
              </thead>
              <tbody>
                {review.process_evidence_requirements.length === 0 && (
                  <tr className="border-t">
                    <td className="px-3 py-2 text-muted-foreground italic" colSpan={2}>
                      No process evidence defined.
                    </td>
                  </tr>
                )}
                {review.process_evidence_requirements.map((e, i) => (
                  <tr key={i} className="border-t align-top">
                    <td className="px-3 py-2">
                      {structureEditable ? (
                        <Input
                          className="h-8 text-sm"
                          value={e.evidence_item}
                          onChange={(ev) => updateEvidenceItem(i, ev.target.value)}
                        />
                      ) : (
                        e.evidence_item
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {structureEditable ? (
                        <select
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                          value={e.status}
                          onChange={(ev) =>
                            setEvidenceStatus(i, ev.target.value as ProcessEvidenceStatus)
                          }
                        >
                          {EVIDENCE_STATUS_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        EVIDENCE_STATUS_OPTIONS.find((o) => o.value === e.status)?.label || e.status
                      )}
                    </td>
                    {structureEditable && (
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-red-600"
                          onClick={() => removeEvidence(i)}
                          aria-label="Remove evidence"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {structureEditable && (
            <Button size="sm" variant="outline" onClick={addEvidence} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add process evidence
            </Button>
          )}
        </section>

        {/* AI-use disclosure rule */}
        <section className="space-y-1.5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-foreground">
            AI-Use Disclosure Rule
          </h4>
          {structureEditable ? (
            <>
              <Textarea
                rows={2}
                className="text-sm"
                value={review.ai_use_disclosure_rule}
                onChange={(e) => onUpdate({ ...review, ai_use_disclosure_rule: e.target.value })}
              />
              <div className="flex flex-wrap gap-1.5">
                {AI_DISCLOSURE_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="text-xs px-2 py-1 rounded border border-border hover:bg-accent"
                    onClick={() => onUpdate({ ...review, ai_use_disclosure_rule: p })}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </>
          ) : review.ai_use_disclosure_rule?.trim() ? (
            <Markdown>{review.ai_use_disclosure_rule}</Markdown>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">—</p>
          )}
        </section>

        {/* Revision policy */}
        <section className="space-y-1.5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-foreground">Revision Policy</h4>
          {structureEditable ? (
            <>
              <Textarea
                rows={2}
                className="text-sm"
                value={review.revision_policy}
                onChange={(e) => onUpdate({ ...review, revision_policy: e.target.value })}
              />
              <div className="flex flex-wrap gap-1.5">
                {REVISION_POLICY_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="text-xs px-2 py-1 rounded border border-border hover:bg-accent"
                    onClick={() => onUpdate({ ...review, revision_policy: p })}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </>
          ) : review.revision_policy?.trim() ? (
            <Markdown>{review.revision_policy}</Markdown>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">—</p>
          )}
        </section>

        {/* Grading policy */}
        <section className="space-y-1.5">
          <h4 className="text-xs font-bold uppercase tracking-wide text-foreground">Grading Policy</h4>
          {structureEditable ? (
            <Textarea
              rows={2}
              className="text-sm"
              value={review.grading_policy}
              onChange={(e) => onUpdate({ ...review, grading_policy: e.target.value })}
            />
          ) : review.grading_policy?.trim() ? (
            <Markdown>{review.grading_policy}</Markdown>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">—</p>
          )}
        </section>

        {/* SME internal note */}
        <section>
          <h4 className="text-xs font-bold uppercase tracking-wide text-foreground mb-1">
            SME Internal Note
          </h4>
          <Textarea
            className="text-sm"
            rows={2}
            placeholder="Optional note for yourself or your team..."
            value={review.sme_internal_note || ''}
            onChange={(e) => onUpdate({ ...review, sme_internal_note: e.target.value })}
          />
          {readOnly && noteChanged && (
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={() => onSaveNote()} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save note
              </Button>
            </div>
          )}
        </section>

        {/* Assessment-level decision */}
        {!readOnly && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <Button
              size="sm"
              variant="default"
              disabled={review.approval_status === 'approved' || saving}
              onClick={() => {
                if (!review.ai_assisted_analytic_rubric.length) {
                  showToast({
                    title: 'Rubric required',
                    description: 'Add at least one rubric criterion before approving.',
                    variant: 'destructive',
                  })
                  return
                }
                if (!rubricBalanced) {
                  showToast({
                    title: 'Rubric weights must total 100%',
                    description: `Currently ${formatPct(rubricTotal(review.ai_assisted_analytic_rubric))}.`,
                    variant: 'destructive',
                  })
                  return
                }
                onApprove({
                  ...review,
                  rubric_decision: review.rubric_decision === 'pending' ? 'approve' : review.rubric_decision,
                  assessment_structure_decision: 'approve',
                  approval_status: 'approved',
                })
              }}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Approve assessment structure
            </Button>
            <Button
              size="sm"
              variant={review.assessment_structure_decision === 'edit' ? 'default' : 'outline'}
              onClick={() =>
                onUpdate({
                  ...review,
                  assessment_structure_decision: 'edit',
                  approval_status:
                    review.approval_status === 'approved' ? 'pending' : review.approval_status,
                })
              }
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit structure
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onUpdate({
                  ...review,
                  assessment_structure_decision: 'needs_revision',
                  approval_status: 'needs_revision',
                })
              }
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

// ----------------------------------------------------------------------------
// Main editor
// ----------------------------------------------------------------------------

interface Layer4WeightingRubricEditorProps {
  courseCode: string
  layerHasOutput: boolean
  layerApproved?: boolean
  onSaved?: () => void
  onHasChanges?: (hasChanges: boolean) => void
  onSummaryChange?: (summary: WeightingRubricReviewSummary) => void
  onApproveAndContinue?: () => void | Promise<void>
}

export default function Layer4WeightingRubricEditor({
  courseCode,
  layerHasOutput,
  layerApproved = false,
  onSaved,
  onHasChanges,
  onSummaryChange,
  onApproveAndContinue,
}: Layer4WeightingRubricEditorProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [continuing, setContinuing] = useState(false)
  const [weighting, setWeighting] = useState<CourseLevelWeightingSummary | null>(null)
  const [reviews, setReviews] = useState<AssessmentStructureReview[]>([])
  const [initialReviews, setInitialReviews] = useState<AssessmentStructureReview[]>([])
  const [fullReport, setFullReport] = useState<string | undefined>()
  const [initialSnapshot, setInitialSnapshot] = useState<string>('')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchWeightingRubric(courseCode)
      setWeighting(data.course_level_weighting_summary)
      setReviews(data.assessment_structure_reviews)
      setInitialReviews(data.assessment_structure_reviews)
      setFullReport(data.full_assessment_structure_report)
      setInitialSnapshot(
        JSON.stringify({
          w: data.course_level_weighting_summary,
          r: data.assessment_structure_reviews,
        })
      )
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load weighting & rubric',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    if (layerHasOutput) load()
  }, [layerHasOutput, load])

  const summary = useMemo(
    () => (weighting ? computeSummary(weighting, reviews) : null),
    [weighting, reviews]
  )

  const hasChanges = useMemo(
    () => JSON.stringify({ w: weighting, r: reviews }) !== initialSnapshot,
    [weighting, reviews, initialSnapshot]
  )

  useEffect(() => {
    onHasChanges?.(hasChanges)
  }, [hasChanges, onHasChanges])

  useEffect(() => {
    if (summary) onSummaryChange?.(summary)
  }, [summary, onSummaryChange])

  const persist = useCallback(
    async (
      w: CourseLevelWeightingSummary,
      r: AssessmentStructureReview[]
    ): Promise<boolean> => {
      try {
        setSaving(true)
        const result = await saveWeightingRubric(courseCode, {
          courseLevelWeightingSummary: w,
          assessmentStructureReviews: r,
          fullAssessmentStructureReport: fullReport,
        })
        setWeighting(result.course_level_weighting_summary)
        setReviews(result.assessment_structure_reviews)
        setInitialReviews(result.assessment_structure_reviews)
        setInitialSnapshot(
          JSON.stringify({
            w: result.course_level_weighting_summary,
            r: result.assessment_structure_reviews,
          })
        )
        onSaved?.()
        showToast({
          title: 'Saved',
          description: layerApproved ? 'Personal notes saved' : 'Weighting & rubric saved',
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
    },
    [courseCode, fullReport, layerApproved, onSaved]
  )

  const handleSave = () => {
    if (!weighting) return Promise.resolve(false)
    return persist(weighting, reviews)
  }

  const approveStep1 = async () => {
    if (!weighting) return
    const next = { ...weighting, step_1_approved: true }
    setWeighting(next)
    await persist(next, reviews)
  }

  const editStep1 = async () => {
    if (!weighting) return
    const next = { ...weighting, step_1_approved: false }
    setWeighting(next)
    await persist(next, reviews)
  }

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const zoneRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const updateReview = (id: string, next: AssessmentStructureReview) => {
    setReviews((prev) => prev.map((r) => (r.assessment_id === id ? next : r)))
  }

  const approveReview = async (id: string, next: AssessmentStructureReview) => {
    if (!weighting) return
    const nextReviews = reviews.map((r) => (r.assessment_id === id ? next : r))
    setReviews(nextReviews)

    // Auto-advance UI: collapse the just-approved assessment and open the next
    // not-yet-approved assessment by rendered order (none if all later are approved).
    const approvedIndex = nextReviews.findIndex((r) => r.assessment_id === id)
    let nextId: string | null = null
    for (let i = approvedIndex + 1; i < nextReviews.length; i++) {
      if (nextReviews[i].approval_status !== 'approved') {
        nextId = nextReviews[i].assessment_id
        break
      }
    }
    setExpandedIds((prev) => {
      const updatedSet = new Set(prev)
      updatedSet.delete(id)
      if (nextId) updatedSet.add(nextId)
      return updatedSet
    })

    // When a next item auto-expands, scroll its header to the top of the viewport.
    // Defer past the collapse/expand re-render and layout shift so the scroll lands
    // on the correct zone even as the approved body collapses above it.
    if (nextId) {
      const scrollToNext = () => {
        const el = zoneRefs.current[nextId]
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      requestAnimationFrame(scrollToNext)
      ;[120, 300].forEach((ms) => setTimeout(scrollToNext, ms))
    }

    await persist(weighting, nextReviews)
  }

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
        Run Layer 4 to generate the assessment weighting and rubric structure.
      </p>
    )
  }

  if (loading || !weighting) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  const cardsUnlocked = summary?.assessment_cards_unlocked ?? false
  const selectedById = new Map(weighting.weights.map((w) => [w.assessment_id, w]))

  return (
    <div className="flex flex-col rounded-xl border bg-card shadow-sm overflow-hidden mt-4">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-base">Weighting &amp; Rubric Editor</h3>
          <span className="text-sm text-muted-foreground">{reviews.length} assessments</span>
        </div>
        <div className="flex items-center gap-2">
          {!layerApproved && hasChanges && (
            <span className="text-sm text-amber-600 flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              Unsaved
            </span>
          )}
          {!layerApproved && (
            <Button size="sm" onClick={handleSave} disabled={saving || !hasChanges} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          )}
        </div>
      </div>

      <div className="p-6 space-y-8">
        {/* Step 1 */}
        <WeightingStep
          weighting={weighting}
          readOnly={layerApproved}
          saving={saving}
          onChange={(next) => setWeighting(next)}
          onApproveStep1={approveStep1}
          onEditStep1={editStep1}
        />

        {/* Step 2 — shown only after Step 1 is approved */}
        {cardsUnlocked && (
          <section className="space-y-4">
            <h4 className="font-bold text-sm">
              Step 2 — Assessment-Level Rubric and Structure Review
            </h4>
            <div className="grid min-w-0 grid-cols-1 gap-5">
              {reviews.map((review, index) => {
                const w = selectedById.get(review.assessment_id)
                const initial = initialReviews.find(
                  (r) => r.assessment_id === review.assessment_id
                )
                const noteChanged =
                  (review.sme_internal_note || '') !== (initial?.sme_internal_note || '')
                return (
                  <div
                    key={review.assessment_id}
                    ref={(el) => {
                      zoneRefs.current[review.assessment_id] = el
                    }}
                    style={{ scrollMarginTop: 16 }}
                    className="min-w-0"
                  >
                    <AssessmentStructureCard
                      review={review}
                      colorIndex={index}
                      selectedWeight={w?.selected_weight || review.selected_weight_from_step_1}
                      currentWeight={w?.current_weight || ''}
                      readOnly={layerApproved}
                      saving={saving}
                      noteChanged={noteChanged}
                      onUpdate={(next) => updateReview(review.assessment_id, next)}
                      onApprove={(next) => approveReview(review.assessment_id, next)}
                      onSaveNote={async () => {
                        await handleSave()
                      }}
                      expanded={expandedIds.has(review.assessment_id)}
                      onToggle={() => toggleExpanded(review.assessment_id)}
                    />
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Full report */}
        {fullReport?.trim() && (
          <details className="rounded-lg border border-dashed border-border">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-primary hover:underline">
              View Full Assessment Structure Report
            </summary>
            <div className="px-4 pb-4 border-t border-border pt-3">
              <Markdown>{fullReport}</Markdown>
            </div>
          </details>
        )}
      </div>

      {summary && (
        <div className="px-6 py-4 border-t bg-muted/30 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {summary.approved_count} approved · {summary.pending_count} pending ·{' '}
            {summary.needs_revision_count} need revision
          </span>
          {summary.all_approved ? (
            layerApproved || !onApproveAndContinue ? (
              <span className="flex items-center gap-2 px-3 py-1.5 rounded-md font-medium bg-green-500/10 text-green-600">
                <Check className="h-4 w-4" />
                {layerApproved ? 'Layer 4 approved' : 'All assessment structures approved'}
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
                Approve Layer 4
              </Button>
            )
          ) : (
            <span className="flex items-center gap-2 px-3 py-1.5 rounded-md font-medium bg-amber-500/10 text-amber-600">
              <AlertCircle className="h-4 w-4" />
              {!summary.weighting_decided
                ? 'Complete the weighting decision (total 100%) first'
                : 'Approve each assessment structure before approving Layer 4'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
