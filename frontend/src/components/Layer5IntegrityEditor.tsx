import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { Input } from '@/components/ui/Input'
import { Markdown } from '@/components/ui/Markdown'
import { showToast } from '@/components/ui/Toaster'
import { STAT_TILE } from '@/components/ui/StatTile'
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

/**
 * Per-assessment accent: reuses the StatTile gradient palette (tile + glow) with a
 * matching text color for the assessment id. Card surface stays neutral grey; only
 * the icon tile and id carry color (matches Layers 3/4).
 */
const ACCENTS: { key: keyof typeof STAT_TILE; text: string }[] = [
  { key: 'blue', text: 'text-[#024ad8] dark:text-blue-300' },
  { key: 'emerald', text: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'rose', text: 'text-rose-600 dark:text-rose-400' },
  { key: 'amber', text: 'text-amber-600 dark:text-amber-400' },
  { key: 'slate', text: 'text-slate-600 dark:text-slate-300' },
]

/**
 * Decision-button styles shared with Layers 3/4 (app convention): every colored
 * button shows a light tint at rest and turns solid on hover/selection. Edit = amber,
 * approve = emerald, needs-revision = magenta/pink, "approve (blue)" = light blue.
 */
const EDIT_BTN =
  'inline-flex items-center justify-center gap-2 rounded-[12px] border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-700 dark:text-amber-300 transition-colors hover:bg-amber-500 hover:text-white hover:border-transparent disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const APPROVE_BTN =
  'inline-flex items-center justify-center gap-2 rounded-[12px] border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-500 hover:text-white hover:border-transparent disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const REVISION_BTN =
  'inline-flex items-center justify-center gap-2 rounded-[12px] border border-pink-500/30 bg-pink-500/10 px-4 py-2 text-sm font-semibold text-pink-700 dark:text-pink-300 transition-colors hover:bg-pink-600 hover:text-white hover:border-transparent disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background'

// Edit fields use a slightly tighter corner than the card (rounded-[6px]).
const FIELD_RADIUS = 'rounded-[4px]'

// ----------------------------------------------------------------------------
// Small presentational helpers
// ----------------------------------------------------------------------------

function FieldLabel({ label }: { label: string }) {
  return <p className="text-[11px] font-bold uppercase tracking-wider field-label">{label}</p>
}

/** Look up the display label for a select value (used in read-only view). */
function optionLabel(options: { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value
}

/** Read-only value paragraph that aligns with its FieldLabel. */
function ReadValue({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-foreground/90">{children}</p>
}

/**
 * Textarea that grows to fit its content so the full text is visible (no inner
 * scrollbar, no wasted empty rows). Matches Layers 3/4.
 */
function AutoTextarea({
  value,
  onChange,
  onBlur,
  className,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onBlur?: () => void
  className?: string
  placeholder?: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fit = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])
  useLayoutEffect(() => {
    fit()
  }, [value, fit])
  return (
    <Textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={onChange}
      onInput={fit}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
      className={cn('min-h-0 resize-none overflow-hidden leading-relaxed', FIELD_RADIUS, className)}
    />
  )
}

function LabeledList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <FieldLabel label={label} />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-0.5">None specified.</p>
      ) : (
        <ul className="list-disc pl-5 space-y-0.5 text-sm mt-1 leading-relaxed text-foreground/90">
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
    <div className="rounded-[6px] border border-border/50 bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/60 bg-muted/30">
        <h4 className="font-bold text-sm">AI Use Framework</h4>
        <p className="text-xs text-muted-foreground">
          Maestro supports active AI use, not passive outsourcing.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider field-label">AI Use Category</th>
              <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider field-label">Meaning</th>
              <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider field-label">Allowed?</th>
              <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider field-label">Disclosure?</th>
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
  return 'h-8 w-full rounded-[4px] border border-input bg-background px-2 text-sm'
}

function AssessmentIntegrityCard({
  review,
  colorIndex,
  readOnly,
  saving,
  onUpdate,
  onApprove,
  onAutoSave,
  expanded,
  onToggle,
}: {
  review: AssessmentIntegrityReview
  colorIndex: number
  readOnly: boolean
  saving?: boolean
  onUpdate: (next: AssessmentIntegrityReview) => void
  onApprove: (next: AssessmentIntegrityReview) => void
  onAutoSave?: () => void
  expanded: boolean
  onToggle: () => void
}) {
  const canEdit = !readOnly && review.approval_status !== 'approved'
  // Cards open in read-only text mode; fields only become editable after the SME
  // clicks "Edit integrity requirements" (or if a prior edit decision was saved).
  const [editingState, setEditingState] = useState(review.sme_decision === 'edit')
  const editing = canEdit && editingState
  const ref = review.final_assessment_reference
  const risk = review.passive_ai_risk_summary
  const accent = ACCENTS[colorIndex % ACCENTS.length]
  const accentTile = STAT_TILE[accent.key]

  const update = (patch: Partial<AssessmentIntegrityReview>) => onUpdate({ ...review, ...patch })

  return (
    <div className="rounded-[6px] border border-border/40 bg-muted/40 dark:bg-slate-800/30 overflow-hidden">
      {/* Header */}
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 px-4 py-3 cursor-pointer',
          expanded && 'border-b border-border/60'
        )}
        onClick={onToggle}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              'md-tile inline-flex h-10 w-10 shrink-0 items-center justify-center text-white',
              accentTile.tile,
              accentTile.glow
            )}
          >
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn('text-base font-bold', accent.text)}>{review.assessment_id}</span>
              {expanded ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-black/40" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-black/40" />
              )}
            </div>
            <p className="text-sm text-black/70 dark:text-slate-400 truncate">
              {ref.title || 'Untitled assessment'}
            </p>
          </div>
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
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold uppercase tracking-wide label-accent hover:opacity-80">
            Approved Assessment Reference
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
          </summary>
          <div className="pt-2 space-y-2 text-sm">
            <div>
              <FieldLabel label="Title" />
              <p className="mt-0.5 text-foreground/90">{ref.title || 'n/a'}</p>
            </div>
            <div>
              <FieldLabel label="Required artifact" />
              <p className="mt-0.5 text-foreground/90">{ref.required_artifact || 'n/a'}</p>
            </div>
            <LabeledList label="Refined CLO alignment" items={ref.refined_clo_alignment} />
            <div>
              <FieldLabel label="Selected weight" />
              <p className="mt-0.5 text-foreground/90">{ref.selected_weight || 'n/a'}</p>
            </div>
            <LabeledList label="Rubric criteria summary" items={ref.rubric_summary} />
          </div>
        </details>

        {/* Passive AI risk summary */}
        <section className="space-y-2">
          <h5 className="text-xs font-bold uppercase tracking-wide label-accent">Passive AI Risk Summary</h5>
          <div>
            <FieldLabel label="Risk level" />
            {editing ? (
              <select
                className={selectClass()}
                value={risk.risk_level}
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
            ) : (
              <ReadValue>{riskLabel(risk.risk_level)}</ReadValue>
            )}
          </div>
          <div>
            <FieldLabel label="Why passive AI could happen" />
            {editing ? (
              <AutoTextarea
                className="text-sm"
                value={risk.why_passive_ai_could_happen}
                onBlur={onAutoSave}
                onChange={(e) =>
                  update({ passive_ai_risk_summary: { ...risk, why_passive_ai_could_happen: e.target.value } })
                }
              />
            ) : (
              <ReadValue>{risk.why_passive_ai_could_happen || '—'}</ReadValue>
            )}
          </div>
          <div>
            <FieldLabel label="Why the assessment resists passive AI" />
            {editing ? (
              <AutoTextarea
                className="text-sm"
                value={risk.why_assessment_resists_passive_ai}
                onBlur={onAutoSave}
                onChange={(e) =>
                  update({ passive_ai_risk_summary: { ...risk, why_assessment_resists_passive_ai: e.target.value } })
                }
              />
            ) : (
              <ReadValue>{risk.why_assessment_resists_passive_ai || '—'}</ReadValue>
            )}
          </div>
          <div>
            <FieldLabel label="What must be protected" />
            {editing ? (
              <AutoTextarea
                className="text-sm"
                placeholder="One item per line"
                value={risk.what_must_be_protected.join('\n')}
                onBlur={onAutoSave}
                onChange={(e) =>
                  update({
                    passive_ai_risk_summary: {
                      ...risk,
                      what_must_be_protected: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                    },
                  })
                }
              />
            ) : risk.what_must_be_protected.length === 0 ? (
              <ReadValue>—</ReadValue>
            ) : (
              <ul className="list-disc pl-5 space-y-0.5 text-sm leading-relaxed text-foreground/90">
                {risk.what_must_be_protected.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Required learner ownership evidence */}
        <section className="space-y-2">
          <h5 className="text-xs font-bold uppercase tracking-wide label-accent">Required Learner Ownership Evidence</h5>
          <div className="rounded-[6px] border border-border/50 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider field-label">Ownership Evidence</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider field-label">Purpose</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider field-label w-40">Required?</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider field-label w-44">Used for?</th>
                </tr>
              </thead>
              <tbody>
                {review.learner_ownership_evidence.map((e, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium leading-relaxed">{e.evidence_item}</td>
                    <td className="px-3 py-2 text-muted-foreground leading-relaxed">{e.purpose}</td>
                    <td className="px-3 py-2">
                      {editing ? (
                        <select
                          className={selectClass()}
                          value={e.required_status}
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
                      ) : (
                        <span className="leading-relaxed">
                          {optionLabel(REQUIRED_STATUS_OPTIONS, e.required_status)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editing ? (
                        <select
                          className={selectClass()}
                          value={e.use_status}
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
                      ) : (
                        <span className="leading-relaxed">
                          {optionLabel(USE_STATUS_OPTIONS, e.use_status)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* AI-use disclosure requirements */}
        <section className="space-y-2">
          <h5 className="text-xs font-bold uppercase tracking-wide label-accent">AI-Use Disclosure Requirements</h5>
          <div className="rounded-[6px] border border-border/50 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider field-label w-64">Disclosure Field</th>
                  <th className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider field-label">Learner Must Explain</th>
                  {editing && <th className="px-2 py-2 w-8" />}
                </tr>
              </thead>
              <tbody>
                {review.ai_use_disclosure_requirements.map((d, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="px-3 py-2 align-top">
                      {editing ? (
                        <Input
                          className="h-8 px-2 py-1 text-sm rounded-[4px]"
                          value={d.field}
                          onBlur={onAutoSave}
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
                      {editing ? (
                        <Input
                          className="h-8 px-2 py-1 text-sm rounded-[4px]"
                          value={d.learner_must_explain}
                          onBlur={onAutoSave}
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
                    {editing && (
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
          {editing && (
            <button
              type="button"
              className={cn(EDIT_BTN, 'h-8 px-3 text-xs')}
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
            </button>
          )}
        </section>

        {/* Context verification requirements */}
        <section className="space-y-2">
          <h5 className="text-xs font-bold uppercase tracking-wide label-accent">Context Verification Requirements</h5>
          <div className="space-y-1.5">
            {review.context_verification_requirements.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                {editing ? (
                  <Input
                    className="h-8 px-2 py-1 text-sm flex-1 rounded-[4px]"
                    value={c.check_item}
                    onBlur={onAutoSave}
                    onChange={(ev) => {
                      const next = [...review.context_verification_requirements]
                      next[i] = { ...c, check_item: ev.target.value }
                      update({ context_verification_requirements: next })
                    }}
                  />
                ) : (
                  <span className="text-sm flex-1">{c.check_item}</span>
                )}
                {editing && (
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
          {editing && (
            <button
              type="button"
              className={cn(EDIT_BTN, 'h-8 px-3 text-xs')}
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
            </button>
          )}
        </section>

        {/* Reflection / defense requirement */}
        <section className="space-y-1.5">
          <h5 className="text-xs font-bold uppercase tracking-wide label-accent">Reflection or Defense Requirement</h5>
          {editing ? (
            <select
              className={selectClass()}
              value={review.reflection_or_defense_requirement}
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
          ) : (
            <ReadValue>
              {optionLabel(REFLECTION_OPTIONS, review.reflection_or_defense_requirement)}
            </ReadValue>
          )}
        </section>

        {/* Integrity flags */}
        <section className="space-y-1.5">
          <h5 className="text-xs font-bold uppercase tracking-wide label-accent flex items-center gap-1.5">
            <Flag className="h-3.5 w-3.5" /> Integrity Flags
          </h5>
          {editing ? (
            <AutoTextarea
              className="text-sm"
              placeholder="One flag per line (signals later AI/faculty review should detect)"
              value={review.integrity_flags.join('\n')}
              onBlur={onAutoSave}
              onChange={(e) =>
                update({ integrity_flags: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })
              }
            />
          ) : review.integrity_flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No flags defined.</p>
          ) : (
            <ul className="list-disc pl-5 space-y-0.5 text-sm leading-relaxed text-foreground/90">
              {review.integrity_flags.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
        </section>

        {/* SME internal note */}
        <section className="space-y-1.5">
          <h5 className="text-xs font-bold uppercase tracking-wide label-accent">SME Internal Note</h5>
          {editing ? (
            <AutoTextarea
              className="text-sm"
              placeholder="Optional note for yourself or your team."
              value={review.sme_internal_note || ''}
              onBlur={onAutoSave}
              onChange={(e) => update({ sme_internal_note: e.target.value })}
            />
          ) : (
            <ReadValue>{review.sme_internal_note?.trim() || 'No note yet.'}</ReadValue>
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
              <button
                type="button"
                className={APPROVE_BTN}
                disabled={review.approval_status === 'approved' || saving}
                onClick={() => {
                  setEditingState(false)
                  onApprove({ ...review, sme_decision: 'approve', approval_status: 'approved' })
                }}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Approve integrity design
              </button>
              {editing ? (
                <button
                  type="button"
                  className={EDIT_BTN}
                  onClick={() => {
                    setEditingState(false)
                    onAutoSave?.()
                  }}
                >
                  <Check className="h-4 w-4" />
                  Done editing
                </button>
              ) : (
                <button
                  type="button"
                  className={EDIT_BTN}
                  onClick={() => {
                    setEditingState(true)
                    update({ sme_decision: 'edit', approval_status: 'pending' })
                  }}
                >
                  <Pencil className="h-4 w-4" />
                  Edit integrity requirements
                </button>
              )}
              <button
                type="button"
                className={REVISION_BTN}
                onClick={() => {
                  setEditingState(false)
                  update({ sme_decision: 'needs_revision', approval_status: 'needs_revision' })
                }}
              >
                <XCircle className="h-4 w-4" />
                Needs revision
              </button>
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
  const [initialSnapshot, setInitialSnapshot] = useState('')
  const [generatedAt, setGeneratedAt] = useState<string | undefined>()

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchIntegrityReview(courseCode)
      setCourse(data.course_level_integrity_summary)
      setReviews(data.assessment_integrity_reviews)
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
    async (
      c: CourseLevelIntegritySummary,
      r: AssessmentIntegrityReview[],
      opts?: { silent?: boolean }
    ): Promise<boolean> => {
      try {
        setSaving(true)
        const result = await saveIntegrityReview(courseCode, {
          courseLevelIntegritySummary: c,
          assessmentIntegrityReviews: r,
        })
        setCourse(result.course_level_integrity_summary)
        setReviews(result.assessment_integrity_reviews)
        setInitialSnapshot(
          JSON.stringify({
            c: result.course_level_integrity_summary,
            r: result.assessment_integrity_reviews,
          })
        )
        onSaved?.()
        if (!opts?.silent) {
          showToast({
            title: 'Saved',
            description: layerApproved ? 'Personal notes saved' : 'Integrity decisions saved',
            variant: 'success',
          })
        }
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

  // Silent autosave fired from field onBlur — only persists when there are
  // pending changes, so tabbing through untouched fields doesn't spam the server.
  const handleAutoSave = useCallback(() => {
    if (!course || saving || !hasChanges) return
    void persist(course, reviews, { silent: true })
  }, [course, reviews, saving, hasChanges, persist])

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
    const scrollToNext = () => {
      if (!nextId) return
      const el = zoneRefs.current[nextId]
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    if (nextId) {
      requestAnimationFrame(scrollToNext)
      ;[120, 300].forEach((ms) => setTimeout(scrollToNext, ms))
    }

    await persist(course, nextReviews)

    // The save replaces `reviews` with the server result and re-renders the cards,
    // which can shift layout after the timed scrolls above. Re-run the scroll once
    // the new content has painted so the next assessment's title stays in view.
    if (nextId) {
      requestAnimationFrame(scrollToNext)
      ;[120, 320].forEach((ms) => setTimeout(scrollToNext, ms))
    }
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
    <div className="flex flex-col rounded-[6px] border border-border/50 bg-card shadow-sm overflow-hidden mt-4">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-muted/30">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-base">Assessment Integrity Editor</h3>
          <span className="text-sm text-muted-foreground">{reviews.length} assessments</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {saving ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </span>
          ) : hasChanges ? (
            <span className="flex items-center gap-1.5 text-amber-600">
              <AlertCircle className="h-4 w-4" />
              Unsaved changes
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-emerald-600">
              <Check className="h-4 w-4" />
              All changes saved
            </span>
          )}
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Short layer explanation */}
        <div className="rounded-[6px] border border-purple-300/70 dark:border-purple-600/70 bg-purple-50/50 dark:bg-purple-900/20 p-4 space-y-2">
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
        <section className="rounded-[6px] border border-border/50 bg-card p-4 space-y-3">
          <h4 className="font-bold text-sm">Course-Level Integrity Summary</h4>
          <div>
            <FieldLabel label="Overall integrity position" />
            <p className="text-sm mt-0.5 leading-relaxed text-foreground/90">
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
            {reviews.map((review, index) => (
              <div
                key={review.assessment_id}
                ref={(el) => {
                  zoneRefs.current[review.assessment_id] = el
                }}
                style={{ scrollMarginTop: 120 }}
              >
                <AssessmentIntegrityCard
                  review={review}
                  colorIndex={index}
                  readOnly={layerApproved}
                  saving={saving}
                  onUpdate={(next) => updateReview(review.assessment_id, next)}
                  onApprove={(next) => approveReview(review.assessment_id, next)}
                  onAutoSave={handleAutoSave}
                  expanded={expandedIds.has(review.assessment_id)}
                  onToggle={() => toggleExpanded(review.assessment_id)}
                />
              </div>
            ))}
          </div>
        </section>

        {/* Course-level SME decision summary — final checklist before completion */}
        {summary && (
          <section className="rounded-[6px] border border-border/50 bg-card p-4 space-y-4">
            <h4 className="font-bold text-sm">SME Decisions Required</h4>

            {/* A. Assessment-level approvals */}
            <div className="space-y-2">
              <FieldLabel label="Assessment Integrity Designs" />
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
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold uppercase tracking-wide label-accent hover:opacity-80">
              View Full Assessment Integrity Report
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            </summary>
            <div className="pt-3">
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
