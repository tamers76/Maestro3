import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { Input } from '@/components/ui/Input'
import { showToast } from '@/components/ui/Toaster'
import {
  fetchSubtopicArchitecture,
  saveSubtopicArchitecture,
  type ArchitectureSubtopic,
  type SubtopicArchitectureCourseSummary,
  type SubtopicArchitectureReviewSummary,
  type SubtopicCloSection,
  type SubtopicCrossCloLink,
  type SubtopicEffort,
  type SubtopicLearningFunction,
  type SubtopicRecommendation,
} from '@/services/api'
import { cn } from '@/lib/utils'
import {
  Save,
  Loader2,
  AlertCircle,
  Network,
  Check,
  XCircle,
  Pencil,
  RefreshCw,
  BookOpen,
} from 'lucide-react'

// ----------------------------------------------------------------------------
// Option lists + display helpers
// ----------------------------------------------------------------------------

const LEARNING_FUNCTION_OPTIONS: { value: SubtopicLearningFunction; label: string }[] = [
  { value: 'foundational', label: 'Foundational' },
  { value: 'applied', label: 'Applied' },
  { value: 'integrative', label: 'Integrative' },
  { value: 'bridge', label: 'Bridge' },
  { value: 'assessment_preparation', label: 'Assessment preparation' },
]

const EFFORT_OPTIONS: { value: SubtopicEffort; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
]

const RECOMMENDATION_OPTIONS: { value: SubtopicRecommendation; label: string }[] = [
  { value: 'keep', label: 'Keep' },
  { value: 'merge', label: 'Merge' },
  { value: 'split', label: 'Split' },
  { value: 'move', label: 'Move' },
  { value: 'remove', label: 'Remove' },
]

function functionLabel(v: SubtopicLearningFunction): string {
  return LEARNING_FUNCTION_OPTIONS.find((o) => o.value === v)?.label || v
}

function effortBadgeClass(v: SubtopicEffort): string {
  switch (v) {
    case 'high':
      return 'bg-red-500/10 text-red-600 dark:text-red-400'
    case 'moderate':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    default:
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
  }
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

function selectClass() {
  return 'h-8 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-70'
}

function joinList(items: string[]): string {
  return items.join(', ')
}

function parseList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function crossLinksToText(links: SubtopicCrossCloLink[]): string {
  return links.map((l) => `${l.linked_clo_id}: ${l.reason}`).join('\n')
}

function parseCrossLinks(value: string): SubtopicCrossCloLink[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(':')
      if (idx === -1) return { linked_clo_id: line, reason: '' }
      return { linked_clo_id: line.slice(0, idx).trim(), reason: line.slice(idx + 1).trim() }
    })
    .filter((l) => l.linked_clo_id)
}

// ----------------------------------------------------------------------------
// Small presentational helpers
// ----------------------------------------------------------------------------

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
      {children}
    </label>
  )
}

// ----------------------------------------------------------------------------
// Subtopic card
// ----------------------------------------------------------------------------

function SubtopicCard({
  subtopic,
  colorIndex,
  readOnly,
  saving,
  bloomLevel,
  onUpdate,
  onApprove,
}: {
  subtopic: ArchitectureSubtopic
  colorIndex: number
  readOnly: boolean
  saving?: boolean
  bloomLevel?: string
  onUpdate: (next: ArchitectureSubtopic) => void
  onApprove: (next: ArchitectureSubtopic) => void
}) {
  const editable = !readOnly && subtopic.approval_status !== 'approved'
  const update = (patch: Partial<ArchitectureSubtopic>) => onUpdate({ ...subtopic, ...patch })

  return (
    <div
      className={cn(
        'rounded-xl border-2 bg-card overflow-hidden',
        CARD_COLORS[colorIndex % CARD_COLORS.length]
      )}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-sm">{subtopic.subtopic_id}</span>
          <span className="text-sm text-muted-foreground truncate">
            — {subtopic.proposed_subtopic || 'Untitled subtopic'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {functionLabel(subtopic.learning_function)}
          </span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
              effortBadgeClass(subtopic.estimated_learning_effort)
            )}
          >
            Effort: {subtopic.estimated_learning_effort}
          </span>
          {bloomLevel && (
            <span className="rounded-full bg-purple-500/10 px-2 py-0.5 text-xs font-medium text-purple-600 dark:text-purple-400">
              {bloomLevel}
            </span>
          )}
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
              STATUS_BADGE[subtopic.approval_status] || STATUS_BADGE.pending
            )}
          >
            {subtopic.approval_status.replace('_', ' ')}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div>
          <FieldLabel>Proposed subtopic</FieldLabel>
          <Input
            className="h-8 text-sm"
            disabled={!editable}
            value={subtopic.proposed_subtopic}
            onChange={(e) => update({ proposed_subtopic: e.target.value })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel>Purpose</FieldLabel>
            <Textarea
              className="text-sm"
              rows={2}
              disabled={!editable}
              value={subtopic.purpose}
              onChange={(e) => update({ purpose: e.target.value })}
            />
          </div>
          <div>
            <FieldLabel>CLO alignment</FieldLabel>
            <Textarea
              className="text-sm"
              rows={2}
              disabled={!editable}
              value={subtopic.clo_alignment}
              onChange={(e) => update({ clo_alignment: e.target.value })}
            />
          </div>
        </div>

        <div>
          <FieldLabel>Expected learning</FieldLabel>
          <Textarea
            className="text-sm"
            rows={2}
            disabled={!editable}
            value={subtopic.expected_learning}
            onChange={(e) => update({ expected_learning: e.target.value })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <FieldLabel>Learning function</FieldLabel>
            <select
              className={selectClass()}
              disabled={!editable}
              value={subtopic.learning_function}
              onChange={(e) =>
                update({ learning_function: e.target.value as SubtopicLearningFunction })
              }
            >
              {LEARNING_FUNCTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Estimated effort</FieldLabel>
            <select
              className={selectClass()}
              disabled={!editable}
              value={subtopic.estimated_learning_effort}
              onChange={(e) =>
                update({ estimated_learning_effort: e.target.value as SubtopicEffort })
              }
            >
              {EFFORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Recommendation</FieldLabel>
            <select
              className={selectClass()}
              disabled={!editable}
              value={subtopic.recommendation}
              onChange={(e) =>
                update({ recommendation: e.target.value as SubtopicRecommendation })
              }
            >
              {RECOMMENDATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel>Assessment connection (comma separated)</FieldLabel>
            <Input
              className="h-8 text-sm"
              disabled={!editable}
              value={joinList(subtopic.assessment_connection)}
              onChange={(e) => update({ assessment_connection: parseList(e.target.value) })}
            />
          </div>
          <div>
            <FieldLabel>Source evidence (comma separated)</FieldLabel>
            <Input
              className="h-8 text-sm"
              disabled={!editable}
              value={joinList(subtopic.source_evidence)}
              onChange={(e) => update({ source_evidence: parseList(e.target.value) })}
            />
          </div>
        </div>

        <div>
          <FieldLabel>Possible node families (comma separated)</FieldLabel>
          <Input
            className="h-8 text-sm"
            disabled={!editable}
            value={joinList(subtopic.possible_node_families)}
            onChange={(e) => update({ possible_node_families: parseList(e.target.value) })}
          />
        </div>

        <div>
          <FieldLabel>Adaptive value</FieldLabel>
          <Textarea
            className="text-sm"
            rows={2}
            disabled={!editable}
            value={subtopic.adaptive_value}
            onChange={(e) => update({ adaptive_value: e.target.value })}
          />
        </div>

        <div>
          <FieldLabel>Cross-CLO links (one per line: CLO-id: reason)</FieldLabel>
          <Textarea
            className="text-sm"
            rows={2}
            disabled={!editable}
            placeholder="CLO-4: builds on change-readiness analysis"
            value={crossLinksToText(subtopic.cross_clo_links)}
            onChange={(e) => update({ cross_clo_links: parseCrossLinks(e.target.value) })}
          />
        </div>

        <div>
          <FieldLabel>SME internal note</FieldLabel>
          <Textarea
            className="text-sm"
            rows={2}
            disabled={readOnly}
            placeholder="Optional note for yourself or your team."
            value={subtopic.sme_internal_note || ''}
            onChange={(e) => update({ sme_internal_note: e.target.value })}
          />
        </div>

        {/* SME decision for this subtopic */}
        {!readOnly && (
          <div className="space-y-2 pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Approving confirms this subtopic for the self-paced architecture. Use Edit to change
              fields, Needs revision to flag it, or Regenerate to mark it for AI regeneration on the
              next run.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="default"
                disabled={subtopic.approval_status === 'approved' || saving}
                onClick={() =>
                  onApprove({ ...subtopic, sme_decision: 'approved', approval_status: 'approved' })
                }
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-2 h-4 w-4" />
                )}
                Approve subtopic
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => update({ sme_decision: 'edited', approval_status: 'pending' })}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit subtopic
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => update({ sme_decision: 'rejected', approval_status: 'needs_revision' })}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Needs revision
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  update({ sme_decision: 'needs_regeneration', approval_status: 'needs_revision' })
                }
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Regenerate
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// CLO section
// ----------------------------------------------------------------------------

function CloSectionView({
  section,
  baseColorIndex,
  readOnly,
  saving,
  onUpdateSubtopic,
  onApproveSubtopic,
}: {
  section: SubtopicCloSection
  baseColorIndex: number
  readOnly: boolean
  saving?: boolean
  onUpdateSubtopic: (subtopicId: string, next: ArchitectureSubtopic) => void
  onApproveSubtopic: (subtopicId: string, next: ArchitectureSubtopic) => void
}) {
  const approved = section.subtopics.filter((s) => s.approval_status === 'approved').length
  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-bold text-sm">{section.clo_id}</h4>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
              {section.subtopics.length} subtopics
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
              {approved}/{section.subtopics.length} approved
            </span>
          </div>
        </div>
        <p className="text-sm leading-relaxed">{section.refined_clo || 'No refined CLO wording.'}</p>
        {section.related_assessments.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Related assessments: {section.related_assessments.join(', ')}
          </p>
        )}
        {section.clo_learning_journey_summary && (
          <p className="text-xs text-muted-foreground leading-relaxed border-t border-border pt-1.5">
            {section.clo_learning_journey_summary}
          </p>
        )}
      </div>

      <div className="p-4 space-y-4">
        {section.reference_readings.length > 0 && (
          <details className="rounded-lg border border-dashed border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-primary hover:underline flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" /> Reference readings pool ({section.reference_readings.length})
            </summary>
            <ul className="list-disc pl-8 pr-3 pb-3 pt-1 space-y-1 text-xs text-muted-foreground leading-relaxed">
              {section.reference_readings.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </details>
        )}

        {section.subtopics.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subtopics generated for this CLO.</p>
        ) : (
          <div className="grid gap-4">
            {section.subtopics.map((s, i) => (
              <SubtopicCard
                key={s.subtopic_id || i}
                subtopic={s}
                colorIndex={baseColorIndex + i}
                readOnly={readOnly}
                saving={saving}
                bloomLevel={section.bloom_level}
                onUpdate={(next) => onUpdateSubtopic(s.subtopic_id, next)}
                onApprove={(next) => onApproveSubtopic(s.subtopic_id, next)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ----------------------------------------------------------------------------
// Approved subtopics overview (read-only recap once everything is approved)
// ----------------------------------------------------------------------------

function ApprovedSubtopicsOverview({ sections }: { sections: SubtopicCloSection[] }) {
  const rows = sections
    .map((s) => ({
      section: s,
      approved: s.subtopics.filter((t) => t.approval_status === 'approved'),
    }))
    .filter((r) => r.approved.length > 0)
  if (rows.length === 0) return null
  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30">
        <h4 className="font-bold text-sm">Approved Subtopics Overview</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 w-1/3 font-semibold">Refined CLO</th>
              <th className="px-4 py-2 font-semibold">Approved subtopics</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ section, approved }) => (
              <tr key={section.clo_id} className="border-b align-top last:border-0">
                <td className="px-4 py-3">
                  <span className="font-bold">{section.clo_id}</span>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {section.refined_clo}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <ul className="space-y-2">
                    {approved.map((t) => (
                      <li key={t.subtopic_id}>
                        <span className="font-medium">{t.subtopic_id}</span> — {t.proposed_subtopic}
                        {(t.purpose || t.expected_learning) && (
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {t.purpose || t.expected_learning}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ----------------------------------------------------------------------------
// Summary (mirror backend computeSubtopicSummary)
// ----------------------------------------------------------------------------

function computeSummary(
  sections: SubtopicCloSection[]
): SubtopicArchitectureReviewSummary {
  let pending_count = 0
  let approved_count = 0
  let needs_revision_count = 0
  let total_subtopics = 0
  for (const section of sections) {
    for (const s of section.subtopics) {
      total_subtopics++
      if (s.approval_status === 'approved') approved_count++
      else if (s.approval_status === 'needs_revision') needs_revision_count++
      else pending_count++
    }
  }
  return {
    total_clos: sections.length,
    total_subtopics,
    pending_count,
    approved_count,
    needs_revision_count,
    all_approved: total_subtopics > 0 && approved_count === total_subtopics,
  }
}

// ----------------------------------------------------------------------------
// Main editor
// ----------------------------------------------------------------------------

interface Layer6SubtopicEditorProps {
  courseCode: string
  layerHasOutput: boolean
  layerApproved?: boolean
  onSaved?: () => void
  onHasChanges?: (hasChanges: boolean) => void
  onSummaryChange?: (summary: SubtopicArchitectureReviewSummary) => void
  onApproveAndContinue?: () => void | Promise<void>
}

const LAYER6_EXPLANATION =
  'Layer 6 turns the approved refined CLOs and assessments into self-paced learning territories (subtopics). These are not weekly topics or textbook chapters - the weekly plan is source evidence only. Review each subtopic, then approve to build the foundation for the later mastery-node layer.'

export default function Layer6SubtopicEditor({
  courseCode,
  layerHasOutput,
  layerApproved = false,
  onSaved,
  onHasChanges,
  onSummaryChange,
  onApproveAndContinue,
}: Layer6SubtopicEditorProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [continuing, setContinuing] = useState(false)
  const [course, setCourse] = useState<SubtopicArchitectureCourseSummary | null>(null)
  const [sections, setSections] = useState<SubtopicCloSection[]>([])
  const [initialSnapshot, setInitialSnapshot] = useState('')
  const [generatedAt, setGeneratedAt] = useState<string | undefined>()

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchSubtopicArchitecture(courseCode)
      setCourse(data.course_summary)
      setSections(data.clo_sections)
      setInitialSnapshot(JSON.stringify({ c: data.course_summary, s: data.clo_sections }))
      setGeneratedAt(data.layer6GeneratedAt)
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load subtopic architecture',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    if (layerHasOutput) load()
  }, [layerHasOutput, load])

  const summary = useMemo(() => (course ? computeSummary(sections) : null), [course, sections])

  const hasChanges = useMemo(
    () => JSON.stringify({ c: course, s: sections }) !== initialSnapshot,
    [course, sections, initialSnapshot]
  )

  useEffect(() => {
    onHasChanges?.(hasChanges)
  }, [hasChanges, onHasChanges])

  useEffect(() => {
    if (summary) onSummaryChange?.(summary)
  }, [summary, onSummaryChange])

  const persist = useCallback(
    async (c: SubtopicArchitectureCourseSummary, s: SubtopicCloSection[]): Promise<boolean> => {
      try {
        setSaving(true)
        const result = await saveSubtopicArchitecture(courseCode, {
          courseSummary: c,
          cloSections: s,
        })
        setCourse(result.course_summary)
        setSections(result.clo_sections)
        setInitialSnapshot(JSON.stringify({ c: result.course_summary, s: result.clo_sections }))
        onSaved?.()
        showToast({
          title: 'Saved',
          description: layerApproved ? 'Personal notes saved' : 'Subtopic decisions saved',
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
    return persist(course, sections)
  }

  const updateSubtopic = (cloId: string, subtopicId: string, next: ArchitectureSubtopic) => {
    setSections((prev) =>
      prev.map((section) =>
        section.clo_id === cloId
          ? {
              ...section,
              subtopics: section.subtopics.map((s) => (s.subtopic_id === subtopicId ? next : s)),
            }
          : section
      )
    )
  }

  const approveSubtopic = async (cloId: string, subtopicId: string, next: ArchitectureSubtopic) => {
    if (!course) return
    const nextSections = sections.map((section) =>
      section.clo_id === cloId
        ? {
            ...section,
            subtopics: section.subtopics.map((s) => (s.subtopic_id === subtopicId ? next : s)),
          }
        : section
    )
    setSections(nextSections)
    await persist(course, nextSections)
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
        Run Layer 6 to generate the self-paced subtopic architecture.
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

  let colorCursor = 0
  const cloSectionViews = sections.map((section) => {
    const base = colorCursor
    colorCursor += section.subtopics.length
    return (
      <CloSectionView
        key={section.clo_id}
        section={section}
        baseColorIndex={base}
        readOnly={layerApproved}
        saving={saving}
        onUpdateSubtopic={(subtopicId, next) => updateSubtopic(section.clo_id, subtopicId, next)}
        onApproveSubtopic={(subtopicId, next) => approveSubtopic(section.clo_id, subtopicId, next)}
      />
    )
  })

  return (
    <div className="flex flex-col rounded-xl border bg-card shadow-sm overflow-hidden mt-4">
      <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-base">Self-Paced Subtopic Architecture</h3>
          <span className="text-sm text-muted-foreground">
            {course.total_subtopics} subtopics · {course.total_refined_clos} CLOs
          </span>
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
            <Network className="h-5 w-5 text-purple-500" />
            <h4 className="font-bold text-sm">Layer 6 — Self-Paced Subtopic Architecture</h4>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{LAYER6_EXPLANATION}</p>
          {generatedAt && (
            <p className="text-xs text-muted-foreground border-t pt-2">
              Generated {new Date(generatedAt).toLocaleString()}
            </p>
          )}
        </div>

        {/* Course-level summary */}
        <section className="rounded-xl border bg-card p-4 space-y-3">
          <h4 className="font-bold text-sm">Course-Level Subtopic Architecture Summary</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Refined CLOs covered
              </p>
              <p className="text-lg font-bold">{course.total_refined_clos}</p>
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Total proposed subtopics
              </p>
              <p className="text-lg font-bold">{course.total_subtopics}</p>
            </div>
          </div>
          {course.architecture_summary && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                How this supports self-paced learning
              </p>
              <p className="text-sm mt-0.5 leading-relaxed">{course.architecture_summary}</p>
            </div>
          )}
          <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{course.source_evidence_note}</span>
          </div>
        </section>

        {/* CLO sections — collapsed behind a toggle once everything is approved */}
        {summary?.all_approved ? (
          <details className="rounded-lg border border-dashed border-border">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-primary hover:underline">
              View / edit all {summary.total_subtopics} subtopics
            </summary>
            <div className="px-4 pb-4 border-t border-border pt-3 space-y-5">{cloSectionViews}</div>
          </details>
        ) : (
          <div className="space-y-5">{cloSectionViews}</div>
        )}

        {/* Approved subtopics overview — shown after the subtopics once approved */}
        {summary?.all_approved && <ApprovedSubtopicsOverview sections={sections} />}

        {/* Collapsible full report */}
        {course.full_report?.trim() && (
          <details className="rounded-lg border border-dashed border-border">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-primary hover:underline">
              View Full Subtopic Architecture Report
            </summary>
            <div className="px-4 pb-4 border-t border-border pt-3">
              <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-line">
                {course.full_report}
              </div>
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
                {layerApproved ? 'Layer 6 approved' : 'Layer 6 ready for approval'}
              </span>
            ) : (
              <Button
                size="sm"
                onClick={handleReadyForNextLayer}
                disabled={saving || continuing}
                className="gap-2 bg-green-600 text-white hover:bg-green-700"
              >
                {saving || continuing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                I am ready to approve Layer 6
              </Button>
            )
          ) : (
            <span className="flex items-center gap-2 px-3 py-1.5 rounded-md font-medium bg-amber-500/10 text-amber-600">
              <AlertCircle className="h-4 w-4" />
              Approve every subtopic before approving Layer 6
            </span>
          )}
        </div>
      )}
    </div>
  )
}
