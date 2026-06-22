import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { Input } from '@/components/ui/Input'
import { Markdown } from '@/components/ui/Markdown'
import { showToast } from '@/components/ui/Toaster'
import { STAT_TILE, StatTile } from '@/components/ui/StatTile'
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
  Loader2,
  AlertCircle,
  Network,
  Check,
  CheckCircle2,
  Clock,
  XCircle,
  Pencil,
  RefreshCw,
  BookOpen,
  ChevronRight,
  ChevronDown,
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

/**
 * Per-subtopic accent: reuses the StatTile gradient palette (tile + glow) with a
 * matching text color for the id. Card surface stays neutral grey; only the icon
 * tile and id carry color (matches Layers 3/4/5).
 */
const ACCENTS: { key: keyof typeof STAT_TILE; text: string }[] = [
  { key: 'blue', text: 'text-[#024ad8] dark:text-blue-300' },
  { key: 'emerald', text: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'rose', text: 'text-rose-600 dark:text-rose-400' },
  { key: 'amber', text: 'text-amber-600 dark:text-amber-400' },
  { key: 'slate', text: 'text-slate-600 dark:text-slate-300' },
]

/**
 * Decision-button styles shared with Layers 3/4/5 (app convention): each colored
 * button shows a light tint at rest and turns solid on hover/selection. Edit = amber,
 * approve = emerald, needs-revision = magenta/pink, regenerate = neutral slate.
 */
const EDIT_BTN =
  'inline-flex items-center justify-center gap-2 rounded-[12px] border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-700 dark:text-amber-300 transition-colors hover:bg-amber-500 hover:text-white hover:border-transparent disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const APPROVE_BTN =
  'inline-flex items-center justify-center gap-2 rounded-[12px] border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300 transition-colors hover:bg-emerald-500 hover:text-white hover:border-transparent disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const REVISION_BTN =
  'inline-flex items-center justify-center gap-2 rounded-[12px] border border-pink-500/30 bg-pink-500/10 px-4 py-2 text-sm font-semibold text-pink-700 dark:text-pink-300 transition-colors hover:bg-pink-600 hover:text-white hover:border-transparent disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const REGEN_BTN =
  'inline-flex items-center justify-center gap-2 rounded-[12px] border border-slate-400/30 bg-slate-400/10 px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-600 hover:text-white hover:border-transparent disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background'

// Edit fields use a slightly tighter corner than the card (rounded-[6px]).
const FIELD_RADIUS = 'rounded-[4px]'

function selectClass() {
  return 'h-8 w-full rounded-[4px] border border-input bg-background px-2 text-sm disabled:opacity-70'
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
    <label className="text-[11px] font-bold uppercase tracking-wider field-label mb-1 block">
      {children}
    </label>
  )
}

/** Read-only value paragraph that aligns with its FieldLabel. */
function ReadValue({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-foreground/90 break-words">{children}</p>
}

/** Look up the display label for a select value (used in read-only view). */
function optionLabel(options: { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value
}

/**
 * Textarea that grows to fit its content so the full text is visible (no inner
 * scrollbar, no wasted empty rows). Matches Layers 3/4/5.
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
  onAutoSave,
}: {
  subtopic: ArchitectureSubtopic
  colorIndex: number
  readOnly: boolean
  saving?: boolean
  bloomLevel?: string
  onUpdate: (next: ArchitectureSubtopic) => void
  onApprove: (next: ArchitectureSubtopic) => void
  onAutoSave?: () => void
}) {
  const canEdit = !readOnly && subtopic.approval_status !== 'approved'
  // Cards open in read-only text mode; fields only become editable after the SME
  // clicks "Edit subtopic" (or if a prior edit decision was saved).
  const [editingState, setEditingState] = useState(subtopic.sme_decision === 'edited')
  const editing = canEdit && editingState
  const accent = ACCENTS[colorIndex % ACCENTS.length]
  const accentTile = STAT_TILE[accent.key]
  const update = (patch: Partial<ArchitectureSubtopic>) => onUpdate({ ...subtopic, ...patch })

  return (
    <div className="rounded-[6px] border border-border/40 bg-muted/40 dark:bg-slate-800/30 overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              'md-tile inline-flex h-10 w-10 shrink-0 items-center justify-center text-white',
              accentTile.tile,
              accentTile.glow
            )}
          >
            <Network className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('text-base font-bold', accent.text)}>{subtopic.subtopic_id}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                  effortBadgeClass(subtopic.estimated_learning_effort)
                )}
              >
                Effort: {subtopic.estimated_learning_effort}
              </span>
            </div>
            <p className="text-sm text-black/70 dark:text-slate-400 truncate">
              {subtopic.proposed_subtopic || 'Untitled subtopic'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {functionLabel(subtopic.learning_function)}
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
          {editing ? (
            <Input
              className={cn('h-8 px-2 py-1 text-sm', FIELD_RADIUS)}
              value={subtopic.proposed_subtopic}
              onBlur={onAutoSave}
              onChange={(e) => update({ proposed_subtopic: e.target.value })}
            />
          ) : (
            <ReadValue>{subtopic.proposed_subtopic || '—'}</ReadValue>
          )}
        </div>

        <div>
          <FieldLabel>Purpose</FieldLabel>
          {editing ? (
            <AutoTextarea
              className="text-sm"
              value={subtopic.purpose}
              onBlur={onAutoSave}
              onChange={(e) => update({ purpose: e.target.value })}
            />
          ) : (
            <ReadValue>{subtopic.purpose || '—'}</ReadValue>
          )}
        </div>

        <div>
          <FieldLabel>Expected learning</FieldLabel>
          {editing ? (
            <AutoTextarea
              className="text-sm"
              value={subtopic.expected_learning}
              onBlur={onAutoSave}
              onChange={(e) => update({ expected_learning: e.target.value })}
            />
          ) : (
            <ReadValue>{subtopic.expected_learning || '—'}</ReadValue>
          )}
        </div>

        <div>
          <FieldLabel>Learning function</FieldLabel>
          {editing ? (
            <select
              className={selectClass()}
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
          ) : (
            <ReadValue>{functionLabel(subtopic.learning_function)}</ReadValue>
          )}
        </div>

        <div>
          <FieldLabel>Recommendation</FieldLabel>
          {editing ? (
            <select
              className={selectClass()}
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
          ) : (
            <ReadValue>{optionLabel(RECOMMENDATION_OPTIONS, subtopic.recommendation)}</ReadValue>
          )}
        </div>

        <div>
          <FieldLabel>Assessment connection</FieldLabel>
          {editing ? (
            <Input
              className={cn('h-8 px-2 py-1 text-sm', FIELD_RADIUS)}
              placeholder="Comma separated"
              value={joinList(subtopic.assessment_connection)}
              onBlur={onAutoSave}
              onChange={(e) => update({ assessment_connection: parseList(e.target.value) })}
            />
          ) : (
            <ReadValue>{joinList(subtopic.assessment_connection) || '—'}</ReadValue>
          )}
        </div>

        <div>
          <FieldLabel>Source evidence</FieldLabel>
          {editing ? (
            <Input
              className={cn('h-8 px-2 py-1 text-sm', FIELD_RADIUS)}
              placeholder="Comma separated"
              value={joinList(subtopic.source_evidence)}
              onBlur={onAutoSave}
              onChange={(e) => update({ source_evidence: parseList(e.target.value) })}
            />
          ) : (
            <ReadValue>{joinList(subtopic.source_evidence) || '—'}</ReadValue>
          )}
        </div>

        <div>
          <FieldLabel>Possible node families</FieldLabel>
          {editing ? (
            <Input
              className={cn('h-8 px-2 py-1 text-sm', FIELD_RADIUS)}
              placeholder="Comma separated"
              value={joinList(subtopic.possible_node_families)}
              onBlur={onAutoSave}
              onChange={(e) => update({ possible_node_families: parseList(e.target.value) })}
            />
          ) : (
            <ReadValue>{joinList(subtopic.possible_node_families) || '—'}</ReadValue>
          )}
        </div>

        <div>
          <FieldLabel>Adaptive value</FieldLabel>
          {editing ? (
            <AutoTextarea
              className="text-sm"
              value={subtopic.adaptive_value}
              onBlur={onAutoSave}
              onChange={(e) => update({ adaptive_value: e.target.value })}
            />
          ) : (
            <ReadValue>{subtopic.adaptive_value || '—'}</ReadValue>
          )}
        </div>

        <div>
          <FieldLabel>Cross-CLO links</FieldLabel>
          {editing ? (
            <AutoTextarea
              className="text-sm"
              placeholder="One per line: CLO-4: builds on change-readiness analysis"
              value={crossLinksToText(subtopic.cross_clo_links)}
              onBlur={onAutoSave}
              onChange={(e) => update({ cross_clo_links: parseCrossLinks(e.target.value) })}
            />
          ) : subtopic.cross_clo_links.length === 0 ? (
            <ReadValue>—</ReadValue>
          ) : (
            <ul className="list-disc pl-5 space-y-0.5 text-sm leading-relaxed text-foreground/90">
              {subtopic.cross_clo_links.map((l, i) => (
                <li key={i}>
                  <span className="font-medium">{l.linked_clo_id}</span>
                  {l.reason ? `: ${l.reason}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <FieldLabel>SME internal note</FieldLabel>
          {editing ? (
            <AutoTextarea
              className="text-sm"
              placeholder="Optional note for yourself or your team."
              value={subtopic.sme_internal_note || ''}
              onBlur={onAutoSave}
              onChange={(e) => update({ sme_internal_note: e.target.value })}
            />
          ) : (
            <ReadValue>{subtopic.sme_internal_note?.trim() || 'No note yet.'}</ReadValue>
          )}
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
              <button
                type="button"
                className={APPROVE_BTN}
                disabled={subtopic.approval_status === 'approved' || saving}
                onClick={() => {
                  setEditingState(false)
                  onApprove({ ...subtopic, sme_decision: 'approved', approval_status: 'approved' })
                }}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Approve subtopic
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
                    update({ sme_decision: 'edited', approval_status: 'pending' })
                  }}
                >
                  <Pencil className="h-4 w-4" />
                  Edit subtopic
                </button>
              )}
              <button
                type="button"
                className={REVISION_BTN}
                onClick={() => {
                  setEditingState(false)
                  update({ sme_decision: 'rejected', approval_status: 'needs_revision' })
                }}
              >
                <XCircle className="h-4 w-4" />
                Needs revision
              </button>
              <button
                type="button"
                className={REGEN_BTN}
                onClick={() => {
                  setEditingState(false)
                  update({ sme_decision: 'needs_regeneration', approval_status: 'needs_revision' })
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Regenerate
              </button>
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
  onAutoSave,
  expanded,
  onToggle,
}: {
  section: SubtopicCloSection
  baseColorIndex: number
  readOnly: boolean
  saving?: boolean
  onUpdateSubtopic: (subtopicId: string, next: ArchitectureSubtopic) => void
  onApproveSubtopic: (subtopicId: string, next: ArchitectureSubtopic) => void
  onAutoSave?: () => void
  expanded: boolean
  onToggle: () => void
}) {
  const approved = section.subtopics.filter((s) => s.approval_status === 'approved').length
  return (
    <section className="rounded-[6px] border border-border/50 bg-card overflow-hidden">
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-muted/30 cursor-pointer',
          expanded && 'border-b border-border/60'
        )}
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <h4 className="font-bold text-sm shrink-0">{section.clo_id}</h4>
          <span className={cn('min-w-0 flex-1 text-sm text-muted-foreground', !expanded && 'truncate')}>
            {section.refined_clo || 'No refined CLO wording.'}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground shrink-0">
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
            {section.subtopics.length} subtopics
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
            {approved}/{section.subtopics.length} approved
          </span>
        </div>
      </div>

      {expanded && (
        <>
          {(section.related_assessments.length > 0 || section.clo_learning_journey_summary) && (
            <div className="px-4 py-2 border-b border-border/60 bg-muted/20 space-y-1.5">
              {section.related_assessments.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Related assessments: {section.related_assessments.join(', ')}
                </p>
              )}
              {section.clo_learning_journey_summary && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {section.clo_learning_journey_summary}
                </p>
              )}
            </div>
          )}

          <div className="p-4 space-y-4">
            {section.reference_readings.length > 0 && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold uppercase tracking-wide label-accent hover:opacity-80">
              <BookOpen className="h-3.5 w-3.5" /> Suggested readings — preview ({section.reference_readings.length})
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            </summary>
            <p className="pt-2 text-[11px] italic text-muted-foreground">
              A preview of likely readings for this CLO. Confirm which passages actually ground each
              subtopic in Reference Alignment (below) after approving Layer 6.
            </p>
            <ul className="list-disc pl-5 pt-1 space-y-1 text-xs text-muted-foreground leading-relaxed">
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
                onAutoSave={onAutoSave}
              />
            ))}
          </div>
        )}
          </div>
        </>
      )}
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
    <section className="rounded-[6px] border border-border/50 bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60 bg-muted/30">
        <h4 className="font-bold text-sm">Approved Subtopics Overview</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/20 text-left">
              <th className="px-4 py-2 w-1/3 text-[11px] font-bold uppercase tracking-wider field-label">Refined CLO</th>
              <th className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider field-label">Approved subtopics</th>
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
  const [expandedClos, setExpandedClos] = useState<Set<string>>(new Set())

  const toggleClo = (cloId: string) => {
    setExpandedClos((prev) => {
      const next = new Set(prev)
      if (next.has(cloId)) next.delete(cloId)
      else next.add(cloId)
      return next
    })
  }

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
    async (
      c: SubtopicArchitectureCourseSummary,
      s: SubtopicCloSection[],
      opts?: { silent?: boolean }
    ): Promise<boolean> => {
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
        if (!opts?.silent) {
          showToast({
            title: 'Saved',
            description: layerApproved ? 'Personal notes saved' : 'Subtopic decisions saved',
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
    return persist(course, sections)
  }

  // Silent autosave fired from field onBlur — only persists when there are pending
  // changes, so tabbing through untouched fields doesn't spam the server.
  const handleAutoSave = useCallback(() => {
    if (!course || saving || !hasChanges) return
    void persist(course, sections, { silent: true })
  }, [course, sections, saving, hasChanges, persist])

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
        onAutoSave={handleAutoSave}
        expanded={expandedClos.has(section.clo_id)}
        onToggle={() => toggleClo(section.clo_id)}
      />
    )
  })

  return (
    <div className="flex flex-col rounded-[6px] border border-border/50 bg-card shadow-sm overflow-hidden mt-4">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-muted/30">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-base">Self-Paced Subtopic Architecture</h3>
          <span className="text-sm text-muted-foreground">
            {course.total_subtopics} subtopics · {course.total_refined_clos} CLOs
          </span>
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

        {summary && (
          <div className="md-scope grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            <StatTile
              icon={BookOpen}
              label="Refined CLOs covered"
              value={course.total_refined_clos}
              color="slate"
            />
            <StatTile
              icon={Network}
              label="Total subtopics"
              value={course.total_subtopics}
              color="blue"
            />
            <StatTile
              icon={CheckCircle2}
              label="Approved"
              value={summary.approved_count}
              color="emerald"
            />
            <StatTile icon={Clock} label="Pending" value={summary.pending_count} color="amber" />
            <StatTile
              icon={AlertCircle}
              label="Needs Revision"
              value={summary.needs_revision_count}
              color="rose"
              tone={summary.needs_revision_count > 0 ? 'warning' : 'default'}
            />
          </div>
        )}

        {/* Course-level summary */}
        <section className="rounded-[6px] border border-border/50 bg-card p-4 space-y-3">
          <h4 className="font-bold text-sm">Course-Level Subtopic Architecture Summary</h4>
          {course.architecture_summary && (
            <div>
              <FieldLabel>How this supports self-paced learning</FieldLabel>
              <p className="text-sm mt-0.5 leading-relaxed text-foreground/90">{course.architecture_summary}</p>
            </div>
          )}
          <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{course.source_evidence_note}</span>
          </div>
        </section>

        {/* CLO sections — collapsed behind a toggle once everything is approved */}
        {summary?.all_approved ? (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold uppercase tracking-wide label-accent hover:opacity-80">
              View / edit all {summary.total_subtopics} subtopics
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            </summary>
            <div className="pt-3 space-y-5">{cloSectionViews}</div>
          </details>
        ) : (
          <div className="space-y-5">{cloSectionViews}</div>
        )}

        {/* Approved subtopics overview — shown after the subtopics once approved */}
        {summary?.all_approved && <ApprovedSubtopicsOverview sections={sections} />}

        {/* Collapsible full report */}
        {course.full_report?.trim() && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold uppercase tracking-wide label-accent hover:opacity-80">
              View Full Subtopic Architecture Report
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            </summary>
            <div className="pt-3">
              <Markdown>{course.full_report}</Markdown>
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
                {layerApproved ? 'Subtopics approved — complete Reference Alignment (Step B)' : 'Layer 6 ready for approval'}
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
                Approve Layer 6
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
