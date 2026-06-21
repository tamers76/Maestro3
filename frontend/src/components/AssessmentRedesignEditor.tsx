import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
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
  Save,
  Loader2,
  AlertCircle,
  ClipboardList,
  Sparkles,
  Check,
  ChevronDown,
  ChevronRight,
  XCircle,
} from 'lucide-react'

const CARD_COLORS = [
  { bg: 'bg-blue-100 dark:bg-blue-900/40', border: 'border-blue-400 dark:border-blue-500', text: 'text-blue-700 dark:text-blue-300', badge: 'bg-blue-500 text-white' },
  { bg: 'bg-emerald-100 dark:bg-emerald-900/40', border: 'border-emerald-400 dark:border-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', badge: 'bg-emerald-500 text-white' },
  { bg: 'bg-violet-100 dark:bg-violet-900/40', border: 'border-violet-400 dark:border-violet-500', text: 'text-violet-700 dark:text-violet-300', badge: 'bg-violet-500 text-white' },
  { bg: 'bg-orange-100 dark:bg-orange-900/40', border: 'border-orange-400 dark:border-orange-500', text: 'text-orange-700 dark:text-orange-300', badge: 'bg-orange-500 text-white' },
  { bg: 'bg-pink-100 dark:bg-pink-900/40', border: 'border-pink-400 dark:border-pink-500', text: 'text-pink-700 dark:text-pink-300', badge: 'bg-pink-500 text-white' },
]

const DECISION_LABELS: Record<AssessmentSmeDecision, string> = {
  pending: 'Pending',
  keep_original: 'Keep original assessment',
  accept_ai_redesign: 'Accept AI redesign',
  custom_redesign: 'Edit redesign',
}

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

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 block">
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
      <ul className="ml-2.5 list-disc space-y-1 pl-4 text-sm leading-relaxed marker:text-primary">
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

/**
 * A section whose body can be expanded/collapsed via a disclosure triangle.
 * Used to keep long blocks (AI redesign, final assessment) compact by default.
 */
function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left rounded-md border-l-2 border-primary/60 bg-primary/5 px-2.5 py-1.5 hover:bg-primary/10 transition-colors"
      >
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 text-primary transition-transform duration-200',
            open && 'rotate-90'
          )}
        />
        <h4 className="text-sm font-bold uppercase tracking-wide text-primary">{title}</h4>
        {!open && <span className="ml-auto text-[11px] font-semibold text-primary/80">Show</span>}
      </button>
      {open && <div className="space-y-2 pl-6">{children}</div>}
    </section>
  )
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
    <details className="rounded-lg border border-border bg-card overflow-hidden">
      <summary className="flex cursor-pointer items-center gap-2 bg-primary/5 px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-primary hover:bg-primary/10">
        <Sparkles className="h-4 w-4" />
        View Full Council Analysis
      </summary>
      <div className="px-4 pb-4 space-y-3.5 border-t border-border pt-3">
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
  noteChanged,
  onUpdate,
  onApproveItem,
  onSaveNote,
  expanded,
  onToggle,
}: {
  item: AssessmentRedesignItem
  colorIndex: number
  readOnlyRedesign?: boolean
  saving?: boolean
  noteChanged?: boolean
  onUpdate: (item: AssessmentRedesignItem) => void
  onApproveItem?: (item: AssessmentRedesignItem) => void | Promise<void>
  onSaveNote?: () => void | Promise<void>
  expanded: boolean
  onToggle: () => void
}) {
  const colors = CARD_COLORS[colorIndex % CARD_COLORS.length]
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
    <div className={cn('rounded-xl border-2 overflow-hidden', colors.border)}>
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
              <span className={cn('text-base font-bold', colors.text)}>{item.assessment_id}</span>
              {original.type_or_format && (
                <span className={cn('text-xs px-2 py-0.5 rounded font-semibold', colors.badge)}>
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
        <div className="p-4 space-y-5">
          {/* 1. Original Assessment (read-only, sourced from syllabus snapshot) */}
          <section className="space-y-2">
            <h4 className="flex items-center gap-2 rounded-md border-l-2 border-muted-foreground/40 bg-muted/60 px-2.5 py-1.5 text-sm font-bold uppercase tracking-wide text-foreground">
              Original Assessment
            </h4>
            <div className="p-3 rounded-md bg-muted/40 border space-y-3">
              <TextField label="Title" value={original.title} />
              <TextField label="Type or format" value={original.type_or_format} />
              <TextField label="Weight" value={original.weight} />
              <TextField label="Description" value={original.description} />
            </div>
          </section>

          {/* 2. Council Summary */}
          <details className="rounded-lg border border-border bg-card overflow-hidden">
            <summary className="flex cursor-pointer items-center gap-2 bg-primary/5 px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-primary hover:bg-primary/10">
              <Sparkles className="h-4 w-4" />
              Council Summary
            </summary>
            <div className="px-4 pb-4 space-y-3.5 border-t border-border pt-3">
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

          {/* 3. AI Suggested Contribution Redesign (collapsible) */}
          <CollapsibleSection title="AI Suggested Contribution Redesign">
            <div className="p-4 rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-900/20 space-y-3.5">
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
            </div>
            {item.redesign_rationale.length > 0 && (
              <div className="mt-2">
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
          </CollapsibleSection>

          {/* 4. Final Assessment for Maestro (collapsible) */}
          <CollapsibleSection
            key={finalEditable ? 'final-edit' : 'final-view'}
            title="Final Assessment for Maestro"
            defaultOpen={finalEditable}
          >
            <p className="text-xs text-muted-foreground leading-relaxed">
              This is the version later Maestro layers (weighting, integrity, subtopics) will use.
            </p>
            {finalEditable ? (
              <div className="space-y-3">
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
              <div className="p-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 space-y-3.5">
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
                Select &quot;Edit redesign&quot; below to customize the final assessment.
              </p>
            )}
          </CollapsibleSection>

          {/* 6. SME Internal Note */}
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
            />
            {readOnlyRedesign && noteChanged && (
              <div className="mt-2 flex justify-end">
                <Button size="sm" onClick={() => onSaveNote?.()} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save note
                </Button>
              </div>
            )}
          </section>

          {/* Full council analysis (reasoning only) */}
          <FullAnalysisDisclosure analysis={item.full_council_analysis} />

          {/* SME Decision + per-assessment approval — the decision sits directly
              above the approval action and gates it. */}
          {!readOnlyRedesign && (
            <div className="space-y-3 pt-3 border-t border-border">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wide text-foreground mb-2">
                  SME Decision
                  <span className="ml-1.5 font-medium text-destructive">*</span>
                </h4>
                <div className="flex flex-wrap gap-2">
                  {(['keep_original', 'accept_ai_redesign', 'custom_redesign'] as const).map((d) => (
                    <Button
                      key={d}
                      size="sm"
                      variant={item.sme_decision === d ? 'default' : 'outline'}
                      onClick={() => applyDecision(d)}
                    >
                      {item.sme_decision === d && <Check className="mr-2 h-4 w-4" />}
                      {DECISION_LABELS[d]}
                    </Button>
                  ))}
                </div>
                {item.sme_decision === 'pending' && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Choose a decision above to enable approval.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="default"
                  disabled={
                    item.approval_status === 'approved' ||
                    item.sme_decision === 'pending' ||
                    saving
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
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  Approve assessment
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onUpdate({ ...item, approval_status: 'needs_revision' })}
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
  onSaved?: () => void
  onHasChanges?: (hasChanges: boolean) => void
  onSummaryChange?: (summary: AssessmentRedesignReviewSummary) => void
  onApproveAndContinue?: () => void | Promise<void>
}

export default function AssessmentRedesignEditor({
  courseCode,
  layerHasOutput,
  layerApproved = false,
  onSaved,
  onHasChanges,
  onSummaryChange,
  onApproveAndContinue,
}: AssessmentRedesignEditorProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [continuing, setContinuing] = useState(false)
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

  const handleSave = async (itemsOverride?: AssessmentRedesignItem[]): Promise<boolean> => {
    try {
      setSaving(true)
      const items = itemsOverride ?? draft
      const result = await saveAssessmentRedesigns(courseCode, items)
      setDraft(result.redesigns)
      setInitialDraft(result.redesigns)
      onSaved?.()
      showToast({
        title: 'Saved',
        description: layerApproved ? 'Personal notes saved' : 'Assessment redesigns saved',
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
      const scrollToNext = () => {
        const el = zoneRefs.current[nextId]
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      requestAnimationFrame(scrollToNext)
      ;[120, 300].forEach((ms) => setTimeout(scrollToNext, ms))
    }

    await handleSave(next)
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
          {!layerApproved && hasChanges && (
            <span className="text-sm text-amber-600 flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              Unsaved
            </span>
          )}
          {!layerApproved && (
            <Button size="sm" onClick={() => handleSave()} disabled={saving || !hasChanges} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save redesigns
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6 p-6">
        <div className="rounded-xl border-2 border-purple-300 dark:border-purple-600 bg-purple-50/50 dark:bg-purple-900/20 p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              <h4 className="font-bold text-sm">Layer 3 Council</h4>
            </div>
            {generatedAt && (
              <p className="text-xs text-muted-foreground">
                Generated {new Date(generatedAt).toLocaleString()}
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {layerApproved
              ? 'Layer 3 is approved. You can still edit personal notes and save.'
              : 'For each assessment: review council summary, choose a decision, set the final assessment, then Approve assessment. Save before approving the layer.'}
          </p>
        </div>

        <div className="grid gap-5">
          {draft.map((item, index) => {
            const initial = initialDraft.find((r) => r.assessment_id === item.assessment_id)
            const noteChanged =
              (item.sme_internal_note || '') !== (initial?.sme_internal_note || '')
            return (
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
                  noteChanged={noteChanged}
                  onUpdate={(updated) => handleUpdate(item.assessment_id, updated)}
                  onApproveItem={(updated) => handleApproveItem(item.assessment_id, updated)}
                  onSaveNote={async () => {
                    await handleSave()
                  }}
                  expanded={expandedIds.has(item.assessment_id)}
                  onToggle={() => toggleExpanded(item.assessment_id)}
                />
              </div>
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
                {layerApproved ? 'Layer 3 approved' : 'All assessments approved'}
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
                Approve Layer 3
              </Button>
            )
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
