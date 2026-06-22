import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Textarea } from '@/components/ui/Textarea'
import { Markdown } from '@/components/ui/Markdown'
import { showToast } from '@/components/ui/Toaster'
import {
  fetchAssessmentRedesigns,
  saveAssessmentRedesigns,
  type AiSuggestedRedesign,
  type AssessmentRedesignItem,
  type AssessmentRedesignReviewSummary,
  type AssessmentSmeDecision,
  type CloApprovalStatus,
  type FinalAssessmentForMaestro,
  type FullAssessmentCouncilAnalysis,
  type OriginalAssessment,
} from '@/services/api'
import { cn } from '@/lib/utils'
import {
  Loader2,
  AlertCircle,
  ClipboardList,
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
 * Per-assessment accent: reuses the dashboard / StatTile gradient palette (tile +
 * glow) and pairs it with a matching text color for the assessment id. The card
 * surface stays neutral grey; only the icon tile and id carry the color.
 */
const ACCENTS: { key: keyof typeof STAT_TILE; text: string }[] = [
  { key: 'blue', text: 'text-[#024ad8] dark:text-blue-300' },
  { key: 'emerald', text: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'rose', text: 'text-rose-600 dark:text-rose-400' },
  { key: 'amber', text: 'text-amber-600 dark:text-amber-400' },
  { key: 'slate', text: 'text-slate-600 dark:text-slate-300' },
]

const DECISION_LABELS: Record<AssessmentSmeDecision, string> = {
  pending: 'Pending',
  keep_original: 'Keep original assessment',
  accept_ai_redesign: 'Accept AI redesign',
  custom_redesign: 'Edit redesign',
}

const DECISION_OPTIONS: {
  value: Exclude<AssessmentSmeDecision, 'pending'>
  label: string
  icon: JSX.Element
}[] = [
  {
    value: 'accept_ai_redesign',
    label: DECISION_LABELS.accept_ai_redesign,
    icon: <Sparkles className="h-4 w-4" />,
  },
  {
    value: 'custom_redesign',
    label: DECISION_LABELS.custom_redesign,
    icon: <Pencil className="h-4 w-4" />,
  },
  {
    value: 'keep_original',
    label: DECISION_LABELS.keep_original,
    icon: <Ban className="h-4 w-4" />,
  },
]

/**
 * Per-assessment approval actions reuse the dashboard Material button shape
 * (`md-btn`) with the page's semantic gradients: emerald for approve, rose for
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
 * Regenerate button: amber so it stands out as a distinct action (re-runs the
 * council) — a light amber tint that darkens to solid amber on hover.
 */
const REGEN_BTN =
  'inline-flex items-center justify-center gap-2 rounded-[12px] border border-amber-500/40 bg-amber-500/15 font-semibold text-amber-700 transition-colors hover:border-transparent hover:bg-amber-600 hover:text-white dark:text-amber-300 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background'

const APPROVAL_LABELS: Record<CloApprovalStatus, string> = {
  pending: 'Pending approval',
  approved: 'Assessment approved',
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
    <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">{label}</p>
  )
}

function TextField({ label, value }: { label: string; value?: string }) {
  if (!value?.trim()) return null
  return (
    <div className="space-y-1">
      <FieldLabel label={label} />
      <Markdown className="text-sm leading-relaxed text-foreground/90">{value}</Markdown>
    </div>
  )
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-bold uppercase tracking-wider text-foreground mb-1 block">
        {label}
      </label>
      {children}
    </div>
  )
}

function ListBlock({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null
  return (
    <div className="space-y-1">
      <FieldLabel label={label} />
      <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground/90">
        {items.map((it, i) => (
          <li key={i} className="text-foreground/90">
            <Markdown className="[&_p]:my-0 text-foreground/90">{it}</Markdown>
          </li>
        ))}
      </ul>
    </div>
  )
}

function toLines(items: string[]): string {
  return items.join('\n')
}

function fromLines(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => !!s)
}

function FullAnalysisDisclosure({ analysis }: { analysis: FullAssessmentCouncilAnalysis }) {
  const textFields: { label: string; key: keyof FullAssessmentCouncilAnalysis }[] = [
    { label: '1. CLO Alignment Reasoning', key: 'clo_alignment_reasoning' },
    { label: '2. Authentic Contribution Reasoning', key: 'authentic_contribution_reasoning' },
    { label: '3. Personalization and Fairness Reasoning', key: 'personalization_fairness_reasoning' },
    { label: '4. Evaluation Criteria Validity Reasoning', key: 'rubric_validity_reasoning' },
    { label: '5. AI Integrity Reasoning', key: 'ai_integrity_reasoning' },
    { label: '6. Publication and Impact Reasoning', key: 'publication_impact_reasoning' },
    { label: '7. Council Disagreements', key: 'council_disagreements' },
    { label: '8. Chairman Synthesis', key: 'chairman_synthesis' },
  ]
  const hasAny =
    textFields.some((f) => (analysis[f.key] as string | undefined)?.trim()) ||
    analysis.sme_risks_to_review?.length > 0 ||
    analysis.sme_questions?.length > 0
  if (!hasAny) return null

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-bold uppercase tracking-wider label-accent hover:opacity-80 [&::-webkit-details-marker]:hidden">
        <Sparkles className="h-3.5 w-3.5" />
        View Full Council Analysis
      </summary>
      <div className="space-y-3.5 pt-3">
        {textFields.map(({ label, key }) => (
          <TextField key={key} label={label} value={analysis[key] as string | undefined} />
        ))}
        <ListBlock label="9. SME Risks to Review" items={analysis.sme_risks_to_review} />
        <ListBlock label="10. Questions for SME" items={analysis.sme_questions} />
      </div>
    </details>
  )
}

function AssessmentRedesignZone({
  item,
  colorIndex,
  readOnlyRedesign,
  saving,
  onUpdate,
  onApproveItem,
  onAutoSave,
  expanded,
  onToggle,
}: {
  item: AssessmentRedesignItem
  colorIndex: number
  readOnlyRedesign?: boolean
  saving?: boolean
  onUpdate: (item: AssessmentRedesignItem) => void
  onApproveItem?: (item: AssessmentRedesignItem) => void | Promise<void>
  onAutoSave?: () => void
  expanded: boolean
  onToggle: () => void
}) {
  const accent = ACCENTS[colorIndex % ACCENTS.length]
  const accentTile = STAT_TILE[accent.key]
  const original = item.original_assessment
  const ai = item.ai_suggested_redesign
  const final = item.final_assessment_for_maestro
  const cs = item.council_summary
  const hasCouncilSummary = Boolean(
    cs.what_works_well?.trim() ||
      cs.what_may_limit_the_assessment?.trim() ||
      cs.why_contribution_redesign_helps?.trim() ||
      cs.recommendation?.trim()
  )

  const finalFromRedesign = (r: AiSuggestedRedesign): FinalAssessmentForMaestro => ({
    title: r.redesigned_title,
    description: r.redesigned_description,
    refined_clo_alignment: r.refined_clo_alignment,
    required_artifact: r.required_artifact,
    output_format_options: r.output_format_options,
    fixed_academic_core: r.fixed_academic_core,
    personalized_context_variables: r.personalized_context_variables,
    suggested_evaluation_criteria: r.suggested_evaluation_criteria,
    readiness_gate_needs: r.readiness_gate_needs,
    ai_integrity_features: r.ai_integrity_features,
    publication_potential: r.publication_potential,
  })

  const finalFromOriginal = (o: OriginalAssessment): FinalAssessmentForMaestro => ({
    title: o.title,
    description: o.description,
    refined_clo_alignment: [],
    required_artifact: '',
    output_format_options: [],
    fixed_academic_core: '',
    personalized_context_variables: [],
    suggested_evaluation_criteria: [],
    readiness_gate_needs: [],
    ai_integrity_features: [],
    publication_potential: 'private',
  })

  const applyDecision = (decision: AssessmentSmeDecision) => {
    let nextFinal = item.final_assessment_for_maestro
    if (decision === 'keep_original') nextFinal = finalFromOriginal(original)
    else if (decision === 'accept_ai_redesign') nextFinal = finalFromRedesign(ai)
    onUpdate({
      ...item,
      sme_decision: decision,
      final_assessment_for_maestro: nextFinal,
      approval_status: item.approval_status === 'approved' ? 'pending' : item.approval_status,
    })
  }

  const finalEditable = !readOnlyRedesign && item.sme_decision === 'custom_redesign'

  const updateFinal = (patch: Partial<FinalAssessmentForMaestro>) => {
    onUpdate({
      ...item,
      final_assessment_for_maestro: { ...item.final_assessment_for_maestro, ...patch },
      sme_decision: 'custom_redesign',
      approval_status: item.approval_status === 'approved' ? 'pending' : item.approval_status,
    })
  }

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
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={cn('text-base font-bold', accent.text)}>{item.assessment_id}</span>
              {original.type_or_format && (
                <span className="text-xs px-2 py-0.5 rounded font-semibold bg-muted text-muted-foreground">
                  {original.type_or_format}
                </span>
              )}
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
            <p className="text-sm text-black/70 dark:text-slate-400 line-clamp-2">{original.title}</p>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="p-5 space-y-5">
          {/* 1. Original Assessment — title + type/weight badges on one line, then description */}
          <section className="space-y-2">
            <FieldLabel label="Original Assessment" />
            <div className="flex flex-wrap items-center gap-2">
              {original.title && (
                <h5 className="text-sm font-semibold text-foreground">{original.title}</h5>
              )}
              {original.type_or_format && (
                <span className="text-xs px-2 py-0.5 rounded font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-300">
                  {original.type_or_format}
                </span>
              )}
              {original.weight && (
                <span className="text-xs px-2 py-0.5 rounded font-semibold bg-violet-500/10 text-violet-700 dark:text-violet-300">
                  Weight: {original.weight}
                </span>
              )}
            </div>
            {original.description?.trim() && (
              <Markdown className="text-sm leading-relaxed text-foreground/90">
                {original.description}
              </Markdown>
            )}
          </section>

          {/* 2. Council Summary — collapsible, only if the SME wants to read it */}
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[11px] font-bold uppercase tracking-wider label-accent hover:opacity-80 [&::-webkit-details-marker]:hidden">
              <Sparkles className="h-3.5 w-3.5" />
              Council Summary
            </summary>
            <div className="space-y-3.5 pt-3">
              {hasCouncilSummary ? (
                <>
                  <TextField label="What works well" value={item.council_summary.what_works_well} />
                  <TextField label="What may limit the assessment" value={item.council_summary.what_may_limit_the_assessment} />
                  <TextField label="Why contribution redesign helps" value={item.council_summary.why_contribution_redesign_helps} />
                  <TextField label="Recommendation" value={item.council_summary.recommendation} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground italic">No council summary available yet.</p>
              )}
            </div>
          </details>

          {/* 3. Full council analysis — collapsible */}
          <FullAnalysisDisclosure analysis={item.full_council_analysis} />

          {/* 4. AI Suggested Contribution Redesign — inline, all details */}
          <section className="space-y-3 border-t border-border/60 pt-4">
            <h4 className="text-xs font-bold uppercase tracking-wide label-accent">
              AI Suggested Contribution Redesign
            </h4>
            <TextField label="Redesigned title" value={ai.redesigned_title} />
            <TextField label="Redesigned description" value={ai.redesigned_description} />
            <ListBlock label="Refined CLO alignment" items={ai.refined_clo_alignment} />
            <TextField label="Contribution purpose" value={ai.contribution_purpose} />
            <TextField label="Fixed academic core" value={ai.fixed_academic_core} />
            <ListBlock label="Personalized context variables" items={ai.personalized_context_variables} />
            <TextField label="Required artifact" value={ai.required_artifact} />
            <ListBlock label="Output format options" items={ai.output_format_options} />
            <div>
              <ListBlock label="Suggested Evaluation Criteria" items={ai.suggested_evaluation_criteria} />
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                These are the criteria Maestro suggests this redesigned assessment should evaluate. The full grading rubric and criterion weights will be developed in the next layer.
              </p>
            </div>
            <ListBlock label="Readiness gate needs" items={ai.readiness_gate_needs} />
            <ListBlock label="AI integrity features" items={ai.ai_integrity_features} />
            <TextField label="Publication potential" value={ai.publication_potential} />
            {item.redesign_rationale.length > 0 && (
              <div className="pt-1">
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                  Why Maestro suggests this redesign
                </p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                  {item.redesign_rationale.map((r, i) => (
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
          {!readOnlyRedesign && (
            <section>
              <h4 className="text-xs font-bold uppercase tracking-wide text-foreground mb-2">
                SME Decision
                <span className="ml-1.5 font-medium text-destructive">*</span>
              </h4>
              <div
                className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                role="group"
                aria-label={`Decision for ${item.assessment_id}`}
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
              {item.sme_decision === 'pending' && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Choose a decision above to enable approval.
                </p>
              )}
            </section>
          )}

          {/* Final Assessment for Maestro — its own card, always expanded */}
          <div className="rounded-[8px] border border-border/60 bg-card overflow-hidden">
            <div className="border-b border-border/60 px-5 py-3">
              <h4 className="text-xs font-bold uppercase tracking-wide label-accent">
                Final Assessment for Maestro
              </h4>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                This is the version later Maestro layers (weighting, integrity, subtopics) will use.
              </p>
            </div>
            <div className="p-5 space-y-3">
              {finalEditable ? (
                <div className="space-y-3" onBlur={() => onAutoSave?.()}>
                  <EditField label="Redesigned title">
                    <Textarea
                      className="text-sm"
                      rows={1}
                      placeholder="Final title"
                      value={final.title}
                      onChange={(e) => updateFinal({ title: e.target.value })}
                    />
                  </EditField>
                  <EditField label="Redesigned description">
                    <Textarea
                      className="text-sm"
                      rows={2}
                      placeholder="Final description"
                      value={final.description}
                      onChange={(e) => updateFinal({ description: e.target.value })}
                    />
                  </EditField>
                  <EditField label="Refined CLO alignment">
                    <Textarea
                      className="text-sm"
                      rows={2}
                      placeholder="Refined CLO alignment (one per line)"
                      value={toLines(final.refined_clo_alignment)}
                      onChange={(e) => updateFinal({ refined_clo_alignment: fromLines(e.target.value) })}
                    />
                  </EditField>
                  <EditField label="Required artifact">
                    <Textarea
                      className="text-sm"
                      rows={1}
                      placeholder="Required artifact"
                      value={final.required_artifact}
                      onChange={(e) => updateFinal({ required_artifact: e.target.value })}
                    />
                  </EditField>
                  <EditField label="Output format options">
                    <Textarea
                      className="text-sm"
                      rows={2}
                      placeholder="Output format options (one per line)"
                      value={toLines(final.output_format_options)}
                      onChange={(e) => updateFinal({ output_format_options: fromLines(e.target.value) })}
                    />
                  </EditField>
                  <EditField label="Fixed academic core">
                    <Textarea
                      className="text-sm"
                      rows={2}
                      placeholder="Fixed academic core"
                      value={final.fixed_academic_core}
                      onChange={(e) => updateFinal({ fixed_academic_core: e.target.value })}
                    />
                  </EditField>
                  <EditField label="Personalized context variables">
                    <Textarea
                      className="text-sm"
                      rows={2}
                      placeholder="Personalized context variables (one per line)"
                      value={toLines(final.personalized_context_variables)}
                      onChange={(e) =>
                        updateFinal({ personalized_context_variables: fromLines(e.target.value) })
                      }
                    />
                  </EditField>
                  <EditField label="Suggested Evaluation Criteria">
                    <Textarea
                      className="text-sm"
                      rows={2}
                      placeholder="Suggested Evaluation Criteria (one per line)"
                      value={toLines(final.suggested_evaluation_criteria)}
                      onChange={(e) => updateFinal({ suggested_evaluation_criteria: fromLines(e.target.value) })}
                    />
                  </EditField>
                  <EditField label="Readiness gate needs">
                    <Textarea
                      className="text-sm"
                      rows={2}
                      placeholder="Readiness gate needs (one per line)"
                      value={toLines(final.readiness_gate_needs)}
                      onChange={(e) => updateFinal({ readiness_gate_needs: fromLines(e.target.value) })}
                    />
                  </EditField>
                  <EditField label="AI integrity features">
                    <Textarea
                      className="text-sm"
                      rows={2}
                      placeholder="AI integrity features (one per line)"
                      value={toLines(final.ai_integrity_features)}
                      onChange={(e) => updateFinal({ ai_integrity_features: fromLines(e.target.value) })}
                    />
                  </EditField>
                  <EditField label="Publication potential">
                    <Textarea
                      className="text-sm"
                      rows={1}
                      placeholder="Publication potential"
                      value={final.publication_potential}
                      onChange={(e) => updateFinal({ publication_potential: e.target.value })}
                    />
                  </EditField>
                </div>
              ) : (
                <div className="space-y-3.5">
                  <TextField label="Title" value={final.title} />
                  <TextField label="Description" value={final.description} />
                  <ListBlock label="Refined CLO alignment" items={final.refined_clo_alignment} />
                  <TextField label="Required artifact" value={final.required_artifact} />
                  <ListBlock label="Output format options" items={final.output_format_options} />
                  <TextField label="Fixed academic core" value={final.fixed_academic_core} />
                  <ListBlock label="Personalized context variables" items={final.personalized_context_variables} />
                  <ListBlock label="Suggested Evaluation Criteria" items={final.suggested_evaluation_criteria} />
                  <ListBlock label="Readiness gate needs" items={final.readiness_gate_needs} />
                  <ListBlock label="AI integrity features" items={final.ai_integrity_features} />
                  <TextField label="Publication potential" value={final.publication_potential} />
                </div>
              )}
              {!readOnlyRedesign && item.sme_decision !== 'custom_redesign' && (
                <p className="text-xs text-muted-foreground">
                  Select &quot;Edit redesign&quot; above to customize the final assessment.
                </p>
              )}
            </div>
          </div>

          {/* SME Internal Note */}
          <section>
            <h4 className="text-xs font-bold uppercase tracking-wide text-foreground mb-1">SME Internal Note</h4>
            <p className="text-xs text-muted-foreground mb-2">
              Optional note for yourself or your team. Saved with this course; not used by later Maestro layers unless explicitly included.
            </p>
            <Textarea
              className="text-sm"
              rows={2}
              placeholder="e.g. scope boundary to define, criteria to revisit later..."
              value={item.sme_internal_note || ''}
              onChange={(e) => onUpdate({ ...item, sme_internal_note: e.target.value })}
              onBlur={() => onAutoSave?.()}
            />
          </section>

          {/* Per-assessment approval */}
          {!readOnlyRedesign && (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={
                  item.approval_status === 'approved' ||
                  item.sme_decision === 'pending' ||
                  saving
                }
                className={APPROVE_BTN}
                title={
                  item.sme_decision === 'pending'
                    ? 'Select an SME decision first'
                    : undefined
                }
                onClick={() => {
                  if (item.sme_decision === 'pending') {
                    showToast({
                      title: 'Decision required',
                      description: 'Select Keep original, Accept AI redesign, or Edit redesign first.',
                      variant: 'destructive',
                    })
                    return
                  }
                  if (!item.final_assessment_for_maestro?.title?.trim()) {
                    showToast({
                      title: 'Final assessment required',
                      description: 'Ensure the final assessment title is set.',
                      variant: 'destructive',
                    })
                    return
                  }
                  onApproveItem?.({ ...item, approval_status: 'approved' })
                }}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Approve assessment
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

function computeDraftSummary(
  items: AssessmentRedesignItem[]
): AssessmentRedesignReviewSummary | null {
  if (items.length === 0) return null
  const pending_count = items.filter((d) => d.approval_status === 'pending').length
  const approved_count = items.filter((d) => d.approval_status === 'approved').length
  const needs_revision_count = items.filter((d) => d.approval_status === 'needs_revision').length
  return {
    total_assessments: items.length,
    pending_count,
    approved_count,
    needs_revision_count,
    all_approved: approved_count === items.length,
  }
}

interface AssessmentRedesignEditorProps {
  courseCode: string
  layerHasOutput: boolean
  layerApproved?: boolean
  reloadSignal?: string
  onSaved?: () => void
  onHasChanges?: (hasChanges: boolean) => void
  onSummaryChange?: (summary: AssessmentRedesignReviewSummary) => void
  onRegenerate?: () => void
  isRegenerating?: boolean
  canRegenerate?: boolean
}

export default function AssessmentRedesignEditor({
  courseCode,
  layerHasOutput,
  layerApproved = false,
  reloadSignal,
  onSaved,
  onHasChanges,
  onSummaryChange,
  onRegenerate,
  isRegenerating,
  canRegenerate,
}: AssessmentRedesignEditorProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<AssessmentRedesignItem[]>([])
  const [initialDraft, setInitialDraft] = useState<AssessmentRedesignItem[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | undefined>()

  const draftSummary = useMemo(() => computeDraftSummary(draft), [draft])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchAssessmentRedesigns(courseCode)
      setDraft(data.redesigns)
      setInitialDraft(data.redesigns)
      setGeneratedAt(data.layer3GeneratedAt)
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load assessment redesigns',
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
  const zoneRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleUpdate = (id: string, item: AssessmentRedesignItem) => {
    setDraft((prev) => prev.map((r) => (r.assessment_id === id ? item : r)))
  }

  const handleSave = async (
    itemsOverride?: AssessmentRedesignItem[],
    opts?: { silent?: boolean }
  ): Promise<boolean> => {
    try {
      setSaving(true)
      const items = itemsOverride ?? draft
      const result = await saveAssessmentRedesigns(courseCode, items)
      setDraft(result.redesigns)
      setInitialDraft(result.redesigns)
      onSaved?.()
      if (!opts?.silent) {
        showToast({
          title: 'Saved',
          description: layerApproved ? 'Personal notes saved' : 'Assessment redesigns saved',
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
  }

  // Autosave on blur of free-text fields (internal note, custom final-assessment
  // edits). Saves silently so the "unsaved changes" gate on Next layer clears
  // itself without the SME needing a manual Save button.
  const handleAutoSave = () => {
    if (!hasChanges || saving) return
    void handleSave(undefined, { silent: true })
  }

  const handleApproveItem = async (id: string, updated: AssessmentRedesignItem) => {
    const next = draft.map((r) => (r.assessment_id === id ? updated : r))
    setDraft(next)

    // Auto-advance UI: collapse the just-approved item and open the next
    // not-yet-approved assessment by rendered order (none if all later are approved).
    const approvedIndex = next.findIndex((r) => r.assessment_id === id)
    let nextId: string | null = null
    for (let i = approvedIndex + 1; i < next.length; i++) {
      if (next[i].approval_status !== 'approved') {
        nextId = next[i].assessment_id
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
      // Land a little ABOVE the next assessment title (not flush to the top edge)
      // so the SME gets some breathing room and clearly perceives they've moved
      // on to the next assessment.
      const SCROLL_OFFSET = 100
      const scrollToNext = () => {
        const el = zoneRefs.current[nextId]
        if (!el) return
        const top = el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET
        window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' })
      }
      requestAnimationFrame(scrollToNext)
      ;[120, 300].forEach((ms) => setTimeout(scrollToNext, ms))
    }

    await handleSave(next)
  }

  if (!layerHasOutput) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        Run Layer 3 to generate assessment redesign suggestions.
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
          <h3 className="font-bold text-base">Assessment Redesign Editor</h3>
          <span className="text-sm text-muted-foreground">{draft.length} assessments</span>
        </div>
        <div className="flex items-center gap-2">
          {saving ? (
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </span>
          ) : hasChanges ? (
            <span className="text-sm text-amber-600 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" />
              Unsaved changes
            </span>
          ) : (
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Check className="h-4 w-4" />
              All changes saved
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6 p-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              <h4 className="font-bold text-sm">Layer 3 Council</h4>
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
              ? 'Layer 3 is approved. You can still edit personal notes; changes save automatically.'
              : 'For each assessment: review council summary, choose a decision, set the final assessment, then Approve assessment. Your edits save automatically.'}
          </p>
        </div>

        {draftSummary && (
          <div className="md-scope grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatTile icon={ClipboardList} label="Total assessments" value={draft.length} color="slate" />
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
          {draft.map((item, index) => (
            <div
              key={item.assessment_id}
              ref={(el) => {
                zoneRefs.current[item.assessment_id] = el
              }}
              style={{ scrollMarginTop: 16 }}
            >
              <AssessmentRedesignZone
                item={item}
                colorIndex={index}
                readOnlyRedesign={layerApproved}
                saving={saving}
                onUpdate={(updated) => handleUpdate(item.assessment_id, updated)}
                onApproveItem={(updated) => handleApproveItem(item.assessment_id, updated)}
                onAutoSave={handleAutoSave}
                expanded={expandedIds.has(item.assessment_id)}
                onToggle={() => toggleExpanded(item.assessment_id)}
              />
            </div>
          ))}
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
              {layerApproved ? 'Layer 3 approved' : 'All assessments approved'}
            </span>
          ) : (
            <span className="flex items-center gap-2 px-3 py-1.5 rounded-md font-medium bg-amber-500/10 text-amber-600">
              <AlertCircle className="h-4 w-4" />
              Approve each assessment before approving Layer 3
            </span>
          )}
        </div>
      )}
    </div>
  )
}
