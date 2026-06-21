import { useEffect, useState } from 'react'
import {
  GraduationCap,
  Target,
  ClipboardCheck,
  CalendarDays,
  BookMarked,
  Award,
  Hash,
  Clock,
  Layers,
  Scale,
  ChevronDown,
  Plus,
  Trash2,
  Loader2,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { showToast } from '@/components/ui/Toaster'
import { cn } from '@/lib/utils'
import { saveCourseReferences, type CLO, type WeeklyPlanItem } from '@/services/api'
import ReferenceMaterialsPanel from '@/components/ReferenceMaterialsPanel'

export interface IntakeAssessment {
  name: string
  type: string
  weight: number
  description: string
}

export interface IntakeSummaryProps {
  title: string
  code: string
  description?: string
  creditHours?: number
  hours?: number
  clos: CLO[]
  assessments: IntakeAssessment[]
  weeklyPlan: WeeklyPlanItem[]
  references: string[]
  accreditationTags: string[]
  assessmentStrategy?: string
  /** Fired after a grounding reference is ingested — drives the coverage re-check loop. */
  onReferenceUploaded?: () => void
  /** Fired when uploaded/linked grounding-doc count changes. */
  onReferenceDocsCountChange?: (count: number) => void
}

function bloomBadgeClass() {
  return 'bg-purple-500/10 text-purple-600 dark:text-purple-400'
}

function knowledgeBadgeClass() {
  return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
}

function riskBadgeClass(risk: string) {
  const r = (risk || '').toLowerCase()
  if (r === 'high') return 'bg-red-500/10 text-red-600 dark:text-red-400'
  if (r === 'medium') return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  return 'bg-green-500/10 text-green-600 dark:text-green-400'
}

function CollapsibleCard({
  icon: Icon,
  title,
  count,
  defaultOpen = false,
  highlightWarning = false,
  children,
}: {
  icon: typeof Target
  title: string
  count?: number
  defaultOpen?: boolean
  highlightWarning?: boolean
  children: React.ReactNode
}) {
  return (
    <Card
      className={cn(
        'overflow-hidden p-0',
        highlightWarning &&
          'border-2 border-red-500 ring-2 ring-red-500/70 ring-offset-2 ring-offset-background bg-red-50/40 dark:bg-red-950/10'
      )}
    >
      <details className="group" open={defaultOpen}>
        <summary className="flex cursor-pointer select-none list-none items-center gap-2 p-5 [&::-webkit-details-marker]:hidden">
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary',
              highlightWarning && 'bg-red-500/10 text-red-600 dark:text-red-400'
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <h3
            className={cn(
              'text-xs font-bold uppercase tracking-wide text-muted-foreground',
              highlightWarning && 'text-red-700 dark:text-red-400'
            )}
          >
            {highlightWarning && <span className="mr-1 text-red-600 dark:text-red-400">*</span>}
            {title}
          </h3>
          {typeof count === 'number' && (
            <span
              className={cn(
                'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground',
                highlightWarning && 'bg-red-500/15 text-red-700 dark:text-red-400'
              )}
            >
              {count}
            </span>
          )}
          <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-5 pb-5">{children}</div>
      </details>
    </Card>
  )
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: typeof Target
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'warning'
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-xl border bg-card p-4',
        tone === 'warning' && 'border-amber-400/60 dark:border-amber-500/50'
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <span className="text-2xl font-bold text-foreground">{value}</span>
      {hint && (
        <span
          className={cn(
            'text-xs',
            tone === 'warning'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-muted-foreground'
          )}
        >
          {hint}
        </span>
      )}
    </div>
  )
}

function ReferencesSection({
  code,
  references,
  onReferenceUploaded,
  onReferenceDocsCountChange,
}: {
  code: string
  references: string[]
  onReferenceUploaded?: () => void
  onReferenceDocsCountChange?: (count: number) => void
}) {
  const [items, setItems] = useState<string[]>(references)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [ingestedCount, setIngestedCount] = useState(0)
  // "References required" is driven by grounded docs (uploaded/linked materials),
  // not by optional free-text citations captured in the intake summary.
  const hasAtLeastOneReference = ingestedCount > 0

  useEffect(() => {
    setItems(references)
  }, [references])

  const persist = async (next: string[]) => {
    const previous = items
    setItems(next)
    setSaving(true)
    try {
      const result = await saveCourseReferences(code, next)
      setItems(result.references)
    } catch (error) {
      setItems(previous)
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save references',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const addReference = async () => {
    const value = input.trim()
    if (!value) return
    if (items.some((r) => r.toLowerCase() === value.toLowerCase())) {
      showToast({ title: 'Already added', description: 'That reference is already in the list.' })
      return
    }
    await persist([...items, value])
    setInput('')
  }

  const removeReference = (index: number) => {
    persist(items.filter((_, i) => i !== index))
  }

  return (
    <CollapsibleCard
      icon={BookMarked}
      title="References"
      count={ingestedCount}
      highlightWarning={!hasAtLeastOneReference}
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No references yet. Add references below — Maestro will use them as source material when
          generating downstream layers.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((ref, index) => (
            <li key={index} className="group flex items-start gap-2 text-sm text-foreground">
              <span className="text-muted-foreground">{index + 1}.</span>
              <span className="min-w-0 flex-1">{ref}</span>
              <button
                type="button"
                className="text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                onClick={() => removeReference(index)}
                disabled={saving}
                aria-label="Remove reference"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-start gap-2 border-t border-border pt-3">
        <Input
          className="flex-1 text-sm"
          placeholder="Add a reference (book, article, URL, citation...)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addReference()
            }
          }}
        />
        <Button size="sm" onClick={addReference} disabled={saving || !input.trim()} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add reference
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Saved references are added to this course and used as source material for downstream layers.
      </p>

      <ReferenceMaterialsPanel
        courseCode={code}
        embedded
        onDocsChange={(count) => {
          setIngestedCount(count)
          onReferenceDocsCountChange?.(count)
        }}
        onReferenceUploaded={onReferenceUploaded}
      />
    </CollapsibleCard>
  )
}

export default function IntakeSummaryView({
  title,
  code,
  description,
  creditHours,
  hours,
  clos,
  assessments,
  weeklyPlan,
  references,
  accreditationTags,
  assessmentStrategy,
  onReferenceUploaded,
  onReferenceDocsCountChange,
}: IntakeSummaryProps) {
  const totalWeight = assessments.reduce((sum, a) => sum + (Number(a.weight) || 0), 0)
  const weightIsBalanced = Math.round(totalWeight) === 100

  return (
    <div className="space-y-5">
      {/* Hero header */}
      <Card className="overflow-hidden border-2 border-primary/30">
        <div className="bg-primary/5 p-6">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <GraduationCap className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold leading-tight text-foreground">{title}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  <Hash className="h-3 w-3" />
                  {code}
                </span>
                {typeof creditHours === 'number' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    <Layers className="h-3 w-3" />
                    {creditHours} credit{creditHours === 1 ? '' : 's'}
                  </span>
                )}
                {typeof hours === 'number' && hours > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {hours} hours
                  </span>
                )}
                {accreditationTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400"
                  >
                    <Award className="h-3 w-3" />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          {description && (
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{description}</p>
          )}
        </div>
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={Target} label="Learning Outcomes" value={clos.length} />
        <StatTile icon={ClipboardCheck} label="Assessments" value={assessments.length} />
        <StatTile
          icon={Scale}
          label="Total Weight"
          value={`${totalWeight}%`}
          tone={assessments.length > 0 && !weightIsBalanced ? 'warning' : 'default'}
          hint={
            assessments.length > 0 && !weightIsBalanced
              ? 'Does not sum to 100%'
              : undefined
          }
        />
        <StatTile icon={CalendarDays} label="Weeks" value={weeklyPlan.length} />
      </div>

      {/* Course Learning Outcomes */}
      <CollapsibleCard icon={Target} title="Course Learning Outcomes" count={clos.length}>
        {clos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No learning outcomes extracted.</p>
        ) : (
          <div className="space-y-3">
            {clos.map((clo, index) => (
              <div key={clo.clo_id || index} className="rounded-lg border bg-muted/40 p-3">
                <div className="flex items-start gap-3">
                  <span className="flex h-6 min-w-[2.5rem] items-center justify-center rounded bg-primary/10 px-1.5 text-xs font-semibold text-primary">
                    {clo.clo_id || `CLO-${index + 1}`}
                  </span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="text-foreground">{clo.clo_text}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {clo.bloom_level && (
                        <span className={cn('rounded px-2 py-0.5 text-xs', bloomBadgeClass())}>
                          {clo.bloom_level}
                        </span>
                      )}
                      {clo.knowledge_type && (
                        <span className={cn('rounded px-2 py-0.5 text-xs', knowledgeBadgeClass())}>
                          {clo.knowledge_type}
                        </span>
                      )}
                      {clo.risk_level && (
                        <span className={cn('rounded px-2 py-0.5 text-xs', riskBadgeClass(clo.risk_level))}>
                          {clo.risk_level} risk
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>

      {/* Assessment Components */}
      <CollapsibleCard
        icon={ClipboardCheck}
        title="Assessment Components"
        count={assessments.length}
      >
        {assessments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assessments extracted.</p>
        ) : (
          <div className="space-y-3">
            {assessments.map((a, index) => (
              <div key={`${a.name}-${index}`} className="rounded-lg border bg-muted/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{a.name}</span>
                      {a.type && (
                        <span className="rounded bg-violet-500/10 px-2 py-0.5 text-xs text-violet-600 dark:text-violet-400">
                          {a.type}
                        </span>
                      )}
                    </div>
                    {a.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>
                    )}
                  </div>
                  <span className="flex-shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    {a.weight}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/60"
                    style={{ width: `${Math.min(Number(a.weight) || 0, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleCard>

      {/* Weekly Plan */}
      <CollapsibleCard icon={CalendarDays} title="Weekly Plan" count={weeklyPlan.length}>
        {weeklyPlan.length === 0 ? (
          <p className="text-sm text-muted-foreground">No weekly plan extracted.</p>
        ) : (
          <ol className="space-y-3">
            {weeklyPlan.map((w, index) => (
              <li key={`${w.week}-${index}`} className="flex gap-3">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {w.week}
                </span>
                <div className="min-w-0 flex-1 border-b border-border pb-3 last:border-0 last:pb-0">
                  <p className="text-sm font-medium text-foreground">{w.topic}</p>
                  {w.description && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{w.description}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {w.readings && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <BookMarked className="h-3 w-3" />
                        {w.readings}
                      </span>
                    )}
                    {w.clo_ids?.map((id) => (
                      <span
                        key={id}
                        className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
                      >
                        {id}
                      </span>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CollapsibleCard>

      {/* References (includes grounding-materials upload/link subsection) */}
      <ReferencesSection
        code={code}
        references={references}
        onReferenceUploaded={onReferenceUploaded}
        onReferenceDocsCountChange={onReferenceDocsCountChange}
      />

      {/* Delivery & Accreditation */}
      <CollapsibleCard icon={Award} title="Delivery & Accreditation">
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Accreditation Tags
              </p>
              {accreditationTags.length === 0 ? (
                <p className="mt-1 text-muted-foreground">None specified.</p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-2">
                  {accreditationTags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Assessment Strategy
              </p>
              <p className="mt-1 text-foreground">
                {assessmentStrategy || <span className="text-muted-foreground">Not specified.</span>}
              </p>
            </div>
          </div>
        </CollapsibleCard>
    </div>
  )
}
