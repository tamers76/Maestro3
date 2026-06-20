import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { Input } from '@/components/ui/Input'
import { Markdown } from '@/components/ui/Markdown'
import { showToast } from '@/components/ui/Toaster'
import {
  fetchIntegrityReview,
  saveIntegrityReview,
  type AiUseAllowedStatus,
  type AiUseFrameworkItem,
  type AssessmentIntegrityReview,
  type CourseLevelIntegritySummary,
  type IntegrityReviewReviewSummary,
  type OwnershipRequiredStatus,
  type OwnershipUseStatus,
  type PassiveAiRiskLevel,
  type ReflectionDefenseRequirement,
} from '@/services/api'
import { cn } from '@/lib/utils'
import {
  Save,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Check,
  XCircle,
  Pencil,
  Plus,
  Trash2,
  Flag,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

// ----------------------------------------------------------------------------
// Option lists + display helpers
// ----------------------------------------------------------------------------

const RISK_LEVEL_OPTIONS: { value: PassiveAiRiskLevel; label: string }[] = [
  { value: 'very_low', label: 'Very low' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

const REQUIRED_STATUS_OPTIONS: { value: OwnershipRequiredStatus; label: string }[] = [
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
  { value: 'not_required', label: 'Not required' },
]

const USE_STATUS_OPTIONS: { value: OwnershipUseStatus; label: string }[] = [
  { value: 'graded', label: 'Graded' },
  { value: 'integrity_evidence', label: 'Integrity evidence' },
  { value: 'support_only', label: 'Support only' },
]

const REFLECTION_OPTIONS: { value: ReflectionDefenseRequirement; label: string }[] = [
  { value: 'none', label: 'No defense required' },
  { value: 'written_reflection', label: 'Written reflection required' },
  { value: 'video_audio_explanation', label: 'Short video/audio explanation required' },
  { value: 'oral_defense_if_flagged', label: 'Oral defense only if flagged' },
  { value: 'sme_review_for_publication', label: 'SME/faculty review for publication candidates' },
]

function riskBadgeClass(level: PassiveAiRiskLevel): string {
  switch (level) {
    case 'high':
      return 'bg-red-500/10 text-red-600 dark:text-red-400'
    case 'medium':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    default:
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  }
}

function riskLabel(level: PassiveAiRiskLevel): string {
  return RISK_LEVEL_OPTIONS.find((o) => o.value === level)?.label || level
}

function allowedBadgeClass(status: AiUseAllowedStatus): string {
  switch (status) {
    case 'not_acceptable':
      return 'bg-red-500/10 text-red-600 dark:text-red-400'
    case 'allowed_with_caution':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    default:
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  }
}

function allowedLabel(status: AiUseAllowedStatus): string {
  if (status === 'not_acceptable') return 'Not acceptable'
  if (status === 'allowed_with_caution') return 'Allowed with caution'
  return 'Allowed'
}

const STATUS_BADGE: Record<string, string> = {
  approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  needs_revision: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  pending: 'bg-muted text-muted-foreground',
}

const CARD_COLORS = [
  'border-blue-400 dark:border-blue-500',
  'border-emerald-400 dark:border-emerald-500',
  'border-violet-400 dark:border-violet-500',
  'border-orange-400 dark:border-orange-500',
  'border-pink-400 dark:border-pink-500',
]

// ----------------------------------------------------------------------------
// Small presentational helpers
// ----------------------------------------------------------------------------

function LabeledList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-0.5">None specified.</p>
      ) : (
        <ul className="list-disc pl-5 space-y-0.5 text-sm mt-1 leading-relaxed">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// AI Use Framework table
// ----------------------------------------------------------------------------

function AiUseFrameworkTable({ framework }: { framework: AiUseFrameworkItem[] }) {
  if (framework.length === 0) return null
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b bg-muted/30">
        <h4 className="font-bold text-sm">AI Use Framework</h4>
        <p className="text-xs text-muted-foreground">
          Maestro supports active AI use, not passive outsourcing.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-3 py-2 font-semibold">AI Use Category</th>
              <th className="px-3 py-2 font-semibold">Meaning</th>
              <th className="px-3 py-2 font-semibold">Allowed?</th>
              <th className="px-3 py-2 font-semibold">Disclosure?</th>
            </tr>
          </thead>
          <tbody>
            {framework.map((f, i) => (
              <tr key={i} className="border-t border-border align-top">
                <td className="px-3 py-2 font-medium">{f.ai_use_category}</td>
                <td className="px-3 py-2 text-muted-foreground">{f.meaning}</td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                      allowedBadgeClass(f.allowed_status)
                    )}
                  >
                    {allowedLabel(f.allowed_status)}
                  </span>
                </td>
                <td className="px-3 py-2">{f.disclosure_required ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// Assessment integrity card
// ----------------------------------------------------------------------------

function selectClass() {
  return 'h-8 w-full rounded-md border border-input bg-background px-2 text-sm'
}

function AssessmentIntegrityCard({
  review,
  colorIndex,
  readOnly,
  saving,
  noteChanged,
  onUpdate,
  onApprove,
  onSaveNote,
  expanded,
  onToggle,
}: {
  review: AssessmentIntegrityReview
  colorIndex: number
  readOnly: boolean
  saving?: boolean
  noteChanged: boolean
  onUpdate: (next: AssessmentIntegrityReview) => void
  onApprove: (next: AssessmentIntegrityReview) => void
  onSaveNote: () => void | Promise<void>
  expanded: boolean
  onToggle: () => void
}) {
  const editable = !readOnly && review.approval_status !== 'approved'
  const ref = review.final_assessment_reference
  const risk = review.passive_ai_risk_summary

  const update = (patch: Partial<AssessmentIntegrityReview>) => onUpdate({ ...review, ...patch })

  return (
    <div className={cn('rounded-xl border-2 bg-card overflow-hidden', CARD_COLORS[colorIndex % CARD_COLORS.length])}>
      {/* Header */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b bg-muted/30 cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="font-bold text-sm">{review.assessment_id}</span>
          <span className="text-sm text-muted-foreground truncate">— {ref.title || 'Untitled assessment'}</span>
        </div>
        <div className="flex items-center gap-2">
          {ref.selected_weight && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Weight: {ref.selected_weight}
            </span>
          )}
          <span
            className={cn('rounded-full px-2 py-0.5 text-xs font-medium', riskBadgeClass(risk.risk_level))}
          >
            Passive AI risk: {riskLabel(risk.risk_level)}
          </span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
              STATUS_BADGE[review.approval_status] || STATUS_BADGE.pending
            )}
          >
            {review.approval_status.replace('_', ' ')}
          </span>
        </div>
      </div>

      {expanded && (
      <div className="p-4 space-y-4">
        {/* Approved assessment reference (collapsed) */}
        <details className="rounded-lg border border-dashed border-border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-primary hover:underline">
            Approved Assessment Reference
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-2 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Title</p>
              <p className="mt-0.5">{ref.title || 'n/a'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Required artifact</p>
              <p className="mt-0.5">{ref.required_artifact || 'n/a'}</p>
            </div>
            <LabeledList label="Refined CLO alignment" items={ref.refined_clo_alignment} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Selected weight</p>
              <p className="mt-0.5">{ref.selected_weight || 'n/a'}</p>
            </div>
            <LabeledList label="Rubric criteria summary" items={ref.rubric_summary} />
          </div>
        </details>

        {/* Passive AI risk summary */}
        <section className="space-y-2">
          <h5 className="text-xs font-bold uppercase tracking-wide text-foreground">Passive AI Risk Summary</h5>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">Risk level</label>
              <select
                className={selectClass()}
                value={risk.risk_level}
                disabled={!editable}
                onChange={(e) =>
                  update({ passive_ai_risk_summary: { ...risk, risk_level: e.target.value as PassiveAiRiskLevel } })
                }
              >
                {RISK_LEVEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">Why passive AI could happen</label>
            <Textarea
              className="text-sm"
              rows={2}
              disabled={!editable}
              value={risk.why_passive_ai_could_happen}
              onChange={(e) =>
                update({ passive_ai_risk_summary: { ...risk, why_passive_ai_could_happen: e.target.value } })
              }
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              Why the assessment resists passive AI
            </label>
            <Textarea
              className="text-sm"
              rows={2}
              disabled={!editable}
              value={risk.why_assessment_resists_passive_ai}
              onChange={(e) =>
                update({ passive_ai_risk_summary: { ...risk, why_assessment_resists_passive_ai: e.target.value } })
              }
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1 block">
              What must be protected (one per line)
            </label>
            <Textarea
              className="text-sm"
              rows={2}
              disabled={!editable}
              value={risk.what_must_be_protected.join('\n')}
              onChange={(e) =>
                update({
                  passive_ai_risk_summary: {
                    ...risk,
                    what_must_be_protected: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                  },
                })
              }
            />
          </div>
        </section>

        {/* Required learner ownership evidence */}
        <section className="space-y-2">
          <h5 className="text-xs font-bold uppercase tracking-wide text-foreground">Required Learner Ownership Evidence</h5>
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-2 font-semibold">Ownership Evidence</th>
                  <th className="px-3 py-2 font-semibold">Purpose</th>
                  <th className="px-3 py-2 font-semibold w-40">Required?</th>
                  <th className="px-3 py-2 font-semibold w-44">Used for?</th>
                </tr>
              </thead>
              <tbody>
                {review.learner_ownership_evidence.map((e, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium leading-relaxed">{e.evidence_item}</td>
                    <td className="px-3 py-2 text-muted-foreground leading-relaxed">{e.purpose}</td>
                    <td className="px-3 py-2">
                      <select
                        className={selectClass()}
                        value={e.required_status}
                        disabled={!editable}
                        onChange={(ev) => {
                          const next = [...review.learner_ownership_evidence]
                          next[i] = { ...e, required_status: ev.target.value as OwnershipRequiredStatus }
                          update({ learner_ownership_evidence: next })
                        }}
                      >
                        {REQUIRED_STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className={selectClass()}
                        value={e.use_status}
                        disabled={!editable}
                        onChange={(ev) => {
                          const next = [...review.learner_ownership_evidence]
                          next[i] = { ...e, use_status: ev.target.value as OwnershipUseStatus }
                          update({ learner_ownership_evidence: next })
                        }}
                      >
                        {USE_STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* AI-use disclosure requirements */}
        <section className="space-y-2">
          <h5 className="text-xs font-bold uppercase tracking-wide text-foreground">AI-Use Disclosure Requirements</h5>
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-2 font-semibold w-64">Disclosure Field</th>
                  <th className="px-3 py-2 font-semibold">Learner Must Explain</th>
                  {editable && <th className="px-2 py-2 w-8" />}
                </tr>
              </thead>
              <tbody>
                {review.ai_use_disclosure_requirements.map((d, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="px-3 py-2 align-top">
                      {editable ? (
                        <Input
                          className="h-8 text-sm"
                          value={d.field}
                          onChange={(ev) => {
                            const next = [...review.ai_use_disclosure_requirements]
                            next[i] = { ...d, field: ev.target.value }
                            update({ ai_use_disclosure_requirements: next })
                          }}
                        />
                      ) : (
                        <span className="font-medium leading-relaxed">{d.field}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {editable ? (
                        <Input
                          className="h-8 text-sm"
                          value={d.learner_must_explain}
                          onChange={(ev) => {
                            const next = [...review.ai_use_disclosure_requirements]
                            next[i] = { ...d, learner_must_explain: ev.target.value }
                            update({ ai_use_disclosure_requirements: next })
                          }}
                        />
                      ) : (
                        <span className="text-muted-foreground leading-relaxed">{d.learner_must_explain}</span>
                      )}
                    </td>
                    {editable && (
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-red-600"
                          onClick={() =>
                            update({
                              ai_use_disclosure_requirements: review.ai_use_disclosure_requirements.filter(
                                (_, j) => j !== i
                              ),
                            })
                          }
                          aria-label="Remove row"
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
          {editable && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() =>
                update({
                  ai_use_disclosure_requirements: [
                    ...review.ai_use_disclosure_requirements,
                    { field: '', learner_must_explain: '' },
                  ],
                })
              }
            >
              <Plus className="h-4 w-4" />
              Add disclosure field
            </Button>
          )}
        </section>

        {/* Context verification requirements */}
        <section className="space-y-2">
          <h5 className="text-xs font-bold uppercase tracking-wide text-foreground">Context Verification Requirements</h5>
          <div className="space-y-1.5">
            {review.context_verification_requirements.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                {editable ? (
                  <Input
                    className="h-8 text-sm flex-1"
                    value={c.check_item}
                    onChange={(ev) => {
                      const next = [...review.context_verification_requirements]
                      next[i] = { ...c, check_item: ev.target.value }
                      update({ context_verification_requirements: next })
                    }}
                  />
                ) : (
                  <span className="text-sm flex-1">{c.check_item}</span>
                )}
                {editable && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-red-600"
                    onClick={() =>
                      update({
                        context_verification_requirements: review.context_verification_requirements.filter(
                          (_, j) => j !== i
                        ),
                      })
                    }
                    aria-label="Remove check"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {editable && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() =>
                update({
                  context_verification_requirements: [
                    ...review.context_verification_requirements,
                    { check_item: '', required: true },
                  ],
                })
              }
            >
              <Plus className="h-4 w-4" />
              Add check
            </Button>
          )}
        </section>

        {/* Reflection / defense requirement */}
        <section className="space-y-1.5">
          <h5 className="text-xs font-bold uppercase tracking-wide text-foreground">Reflection or Defense Requirement</h5>
          <select
            className={selectClass()}
            value={review.reflection_or_defense_requirement}
            disabled={!editable}
            onChange={(e) =>
              update({ reflection_or_defense_requirement: e.target.value as ReflectionDefenseRequirement })
            }
          >
            {REFLECTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </section>

        {/* Integrity flags */}
        <section className="space-y-1.5">
          <h5 className="text-xs font-bold uppercase tracking-wide text-foreground flex items-center gap-1.5">
            <Flag className="h-3.5 w-3.5" /> Integrity Flags
          </h5>
          {editable ? (
            <Textarea
              className="text-sm"
              rows={3}
              placeholder="One flag per line (signals later AI/faculty review should detect)"
              value={review.integrity_flags.join('\n')}
              onChange={(e) =>
                update({ integrity_flags: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })
              }
            />
          ) : review.integrity_flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No flags defined.</p>
          ) : (
            <ul className="list-disc pl-5 space-y-0.5 text-sm leading-relaxed">
              {review.integrity_flags.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
        </section>

        {/* SME internal note */}
        <section className="space-y-1.5">
          <h5 className="text-xs font-bold uppercase tracking-wide text-foreground">SME Internal Note</h5>
          <Textarea
            className="text-sm"
            rows={2}
            placeholder="Optional note for yourself or your team."
            value={review.sme_internal_note || ''}
            onChange={(e) => update({ sme_internal_note: e.target.value })}
          />
          {readOnly && noteChanged && (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => onSaveNote()} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save note
              </Button>
            </div>
          )}
        </section>

        {/* Single SME decision for the full integrity design */}
        {!readOnly && (
          <div className="space-y-2 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Approving confirms the full integrity design for this assessment - ownership evidence, AI-use
              disclosure, context verification, reflection/defense, flags, and notes.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="default"
                disabled={review.approval_status === 'approved' || saving}
                onClick={() => onApprove({ ...review, sme_decision: 'approve', approval_status: 'approved' })}
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Approve integrity design
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => update({ sme_decision: 'edit', approval_status: 'pending' })}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit integrity requirements
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => update({ sme_decision: 'needs_revision', approval_status: 'needs_revision' })}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Needs revision
              </Button>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Summary (mirror backend computeIntegritySummary)
// ----------------------------------------------------------------------------

function computeSummary(
  reviews: AssessmentIntegrityReview[]
): IntegrityReviewReviewSummary {
  const pending_count = reviews.filter((r) => r.approval_status === 'pending').length
  const approved_count = reviews.filter((r) => r.approval_status === 'approved').length
  const needs_revision_count = reviews.filter((r) => r.approval_status === 'needs_revision').length

  return {
    total_assessments: reviews.length,
    pending_count,
    approved_count,
    needs_revision_count,
    all_approved: reviews.length > 0 && approved_count === reviews.length,
  }
}

// ----------------------------------------------------------------------------
// Main editor
// ----------------------------------------------------------------------------

interface Layer5IntegrityEditorProps {
  courseCode: string
  layerHasOutput: boolean
  layerApproved?: boolean
  onSaved?: () => void
  onHasChanges?: (hasChanges: boolean) => void
  onSummaryChange?: (summary: IntegrityReviewReviewSummary) => void
  onApproveAndContinue?: () => void | Promise<void>
}

const LAYER5_EXPLANATION =
  'Layer 5 reviews each approved assessment and defines how learner ownership, process evidence, and transparent AI use will be protected. Maestro does not prohibit AI use. It designs assessments so AI can support thinking, but cannot replace the learner\u2019s context, judgment, decisions, and evidence.'

export default function Layer5IntegrityEditor({
  courseCode,
  layerHasOutput,
  layerApproved = false,
  onSaved,
  onHasChanges,
  onSummaryChange,
  onApproveAndContinue,
}: Layer5IntegrityEditorProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [continuing, setContinuing] = useState(false)
  const [course, setCourse] = useState<CourseLevelIntegritySummary | null>(null)
  const [reviews, setReviews] = useState<AssessmentIntegrityReview[]>([])
  const [initialReviews, setInitialReviews] = useState<AssessmentIntegrityReview[]>([])
  const [initialSnapshot, setInitialSnapshot] = useState('')
  const [generatedAt, setGeneratedAt] = useState<string | undefined>()

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchIntegrityReview(courseCode)
      setCourse(data.course_level_integrity_summary)
      setReviews(data.assessment_integrity_reviews)
      setInitialReviews(data.assessment_integrity_reviews)
      setInitialSnapshot(
        JSON.stringify({ c: data.course_level_integrity_summary, r: data.assessment_integrity_reviews })
      )
      setGeneratedAt(data.layer5GeneratedAt)
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load integrity review',
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
    () => (course ? computeSummary(reviews) : null),
    [course, reviews]
  )

  const hasChanges = useMemo(
    () => JSON.stringify({ c: course, r: reviews }) !== initialSnapshot,
    [course, reviews, initialSnapshot]
  )

  useEffect(() => {
    onHasChanges?.(hasChanges)
  }, [hasChanges, onHasChanges])

  useEffect(() => {
    if (summary) onSummaryChange?.(summary)
  }, [summary, onSummaryChange])

  const persist = useCallback(
    async (c: CourseLevelIntegritySummary, r: AssessmentIntegrityReview[]): Promise<boolean> => {
      try {
        setSaving(true)
        const result = await saveIntegrityReview(courseCode, {
          courseLevelIntegritySummary: c,
          assessmentIntegrityReviews: r,
        })
        setCourse(result.course_level_integrity_summary)
        setReviews(result.assessment_integrity_reviews)
        setInitialReviews(result.assessment_integrity_reviews)
        setInitialSnapshot(
          JSON.stringify({
            c: result.course_level_integrity_summary,
            r: result.assessment_integrity_reviews,
          })
        )
        onSaved?.()
        showToast({
          title: 'Saved',
          description: layerApproved ? 'Personal notes saved' : 'Integrity decisions saved',
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
    [courseCode, layerApproved, onSaved]
  )

  const handleSave = () => {
    if (!course) return Promise.resolve(false)
    return persist(course, reviews)
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

  const updateReview = (id: string, next: AssessmentIntegrityReview) => {
    setReviews((prev) => prev.map((r) => (r.assessment_id === id ? next : r)))
  }

  const approveReview = async (id: string, next: AssessmentIntegrityReview) => {
    if (!course) return
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

    await persist(course, nextReviews)
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
        Run Layer 5 to generate the assessment integrity and active AI-use design.
      </p>
    )
  }

  if (loading || !course) {
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
          <h3 className="font-bold text-base">Assessment Integrity Editor</h3>
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

      <div className="p-6 space-y-6">
        {/* Short layer explanation */}
        <div className="rounded-xl border-2 border-purple-300 dark:border-purple-600 bg-purple-50/50 dark:bg-purple-900/20 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-purple-500" />
            <h4 className="font-bold text-sm">Layer 5 — Assessment Integrity and Active AI Use</h4>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{LAYER5_EXPLANATION}</p>
          {generatedAt && (
            <p className="text-xs text-muted-foreground border-t pt-2">
              Generated {new Date(generatedAt).toLocaleString()}
            </p>
          )}
        </div>

        {/* Course-level integrity summary */}
        <section className="rounded-xl border bg-card p-4 space-y-3">
          <h4 className="font-bold text-sm">Course-Level Integrity Summary</h4>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Overall integrity position
            </p>
            <p className="text-sm mt-0.5 leading-relaxed">
              {course.overall_integrity_position || 'Not generated.'}
            </p>
          </div>
          <div className="space-y-4">
            <LabeledList label="Main strengths" items={course.main_strengths} />
            <LabeledList label="Main risks" items={course.main_risks} />
            <LabeledList label="SME attention points" items={course.sme_attention_points} />
          </div>
        </section>

        {/* AI use framework */}
        <AiUseFrameworkTable framework={course.ai_use_framework} />

        {/* Assessment integrity cards */}
        <section className="space-y-4">
          <h4 className="font-bold text-sm">Assessment Integrity Cards</h4>
          <div className="grid gap-5">
            {reviews.map((review, index) => {
              const initial = initialReviews.find((r) => r.assessment_id === review.assessment_id)
              const noteChanged = (review.sme_internal_note || '') !== (initial?.sme_internal_note || '')
              return (
                <div
                  key={review.assessment_id}
                  ref={(el) => {
                    zoneRefs.current[review.assessment_id] = el
                  }}
                  style={{ scrollMarginTop: 16 }}
                >
                  <AssessmentIntegrityCard
                    review={review}
                    colorIndex={index}
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

        {/* Course-level SME decision summary — final checklist before completion */}
        {summary && (
          <section className="rounded-xl border bg-card p-4 space-y-4">
            <h4 className="font-bold text-sm">SME Decisions Required</h4>

            {/* A. Assessment-level approvals */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Assessment Integrity Designs
              </p>
              <ul className="space-y-1 text-sm">
                {reviews.map((r) => (
                  <li key={r.assessment_id} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      {r.approval_status === 'approved' && (
                        <Check className="h-4 w-4 text-emerald-600" />
                      )}
                      <span className={cn(r.approval_status !== 'approved' && 'text-muted-foreground')}>
                        {r.assessment_id} integrity design
                      </span>
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                        STATUS_BADGE[r.approval_status] || STATUS_BADGE.pending
                      )}
                    >
                      {r.approval_status.replace('_', ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Collapsible full report */}
        {course.full_integrity_report?.trim() && (
          <details className="rounded-lg border border-dashed border-border">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-primary hover:underline">
              View Full Assessment Integrity Report
            </summary>
            <div className="px-4 pb-4 border-t border-border pt-3">
              <Markdown>{course.full_integrity_report}</Markdown>
            </div>
          </details>
        )}
      </div>

      {/* Footer */}
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
                {layerApproved ? 'Layer 5 approved' : 'Layer 5 ready for approval'}
              </span>
            ) : (
              <Button
                size="sm"
                onClick={handleReadyForNextLayer}
                disabled={saving || continuing}
                className="gap-2"
              >
                {saving || continuing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Approve Layer 5
              </Button>
            )
          ) : (
            <span className="flex items-center gap-2 px-3 py-1.5 rounded-md font-medium bg-amber-500/10 text-amber-600">
              <AlertCircle className="h-4 w-4" />
              Approve each assessment integrity design before approving Layer 5
            </span>
          )}
        </div>
      )}
    </div>
  )
}
