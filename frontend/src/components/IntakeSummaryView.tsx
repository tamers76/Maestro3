import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
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
  Library,
  Scale,
} from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/Accordion'
import { cn } from '@/lib/utils'
import { listReferences, type CLO, type WeeklyPlanItem } from '@/services/api'
import ReferenceMaterialsPanel from '@/components/ReferenceMaterialsPanel'
import { StatTile, STAT_TILE } from '@/components/ui/StatTile'

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

/* ------------------------------------------------------------------ *
 * Course Learning Outcome row — expandable list item (replaces the
 * old separate cards). Spring-animated entrance + chevron-toggled
 * details, adapted from the provided reference pattern.
 * ------------------------------------------------------------------ */
const cloRowVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 30, mass: 0.8 },
  },
} as const

function CloRow({ clo, index, isLast }: { clo: CLO; index: number; isLast: boolean }) {
  const id = clo.clo_id || `CLO-${index + 1}`

  return (
    <motion.div
      variants={cloRowVariants}
      className={cn('py-4', !isLast && 'border-b border-border')}
    >
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground">{id}</h4>
            {(clo.bloom_level || clo.knowledge_type || clo.risk_level) && (
              <span className="h-3 w-px bg-border" />
            )}
            {clo.bloom_level && (
              <span
                className={cn('rounded-full px-2 py-0.5 text-xs font-medium', bloomBadgeClass())}
              >
                {clo.bloom_level}
              </span>
            )}
            {clo.knowledge_type && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  knowledgeBadgeClass()
                )}
              >
                {clo.knowledge_type}
              </span>
            )}
            {clo.risk_level && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  riskBadgeClass(clo.risk_level)
                )}
              >
                {clo.risk_level} risk
              </span>
            )}
          </div>

          <p className="text-sm text-foreground">{clo.clo_text}</p>
        </div>
      </div>
    </motion.div>
  )
}

/**
 * One section inside the intake Accordion. Renders the shared Radix accordion
 * item/trigger/content while keeping the original icon chip, uppercase title,
 * count pill, and "references required" warning treatment.
 */
function AccordionSection({
  value,
  icon: Icon,
  title,
  count,
  highlightWarning = false,
  color = 'blue',
  children,
}: {
  value: string
  icon: typeof Target
  title: string
  count?: number
  highlightWarning?: boolean
  color?: 'slate' | 'blue' | 'emerald' | 'rose' | 'amber'
  children: React.ReactNode
}) {
  return (
    <AccordionItem
      value={value}
      className={cn(
        'border-border px-5 last:border-b-0',
        highlightWarning && 'bg-red-50/40 dark:bg-red-950/10'
      )}
    >
      <AccordionTrigger className="hover:no-underline">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md',
              highlightWarning
                ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                : cn('text-white shadow-sm', STAT_TILE[color].tile)
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <span
            className={cn(
              'text-xs font-bold uppercase tracking-wide text-muted-foreground',
              highlightWarning && 'text-red-700 dark:text-red-400'
            )}
          >
            {highlightWarning && <span className="mr-1 text-red-600 dark:text-red-400">*</span>}
            {title}
          </span>
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
        </span>
      </AccordionTrigger>
      <AccordionContent className="pb-5">{children}</AccordionContent>
    </AccordionItem>
  )
}

/**
 * Read-only list of the bibliographic citations extracted from the syllabus.
 * These are metadata only — they are NOT chunked/indexed for RAG, so this is a
 * quiet sub-header block under the course description. The actual source corpus
 * that grounds generation lives in the dedicated Grounding Materials section.
 */
function ReferencesBlock({ references }: { references: string[] }) {
  if (references.length === 0) return null

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <BookMarked className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          References
        </h3>
        <span className="text-xs font-medium text-muted-foreground">{references.length}</span>
      </div>
      <ul className="space-y-1.5">
        {references.map((ref, index) => (
          <li key={index} className="flex items-start gap-2 text-sm text-foreground">
            <span className="text-muted-foreground">{index + 1}.</span>
            <span className="min-w-0 flex-1">{ref}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Dedicated accordion section for the source corpus that actually grounds
 * generation: uploaded/linked files plus admin-approved library books. Owns the
 * ingested-document count and the "required" warning, since this — not the
 * free-text citation list — is what gates grounded generation.
 */
function GroundingMaterialsSection({
  code,
  onReferenceUploaded,
  onReferenceDocsCountChange,
}: {
  code: string
  onReferenceUploaded?: () => void
  onReferenceDocsCountChange?: (count: number) => void
}) {
  const [ingestedCount, setIngestedCount] = useState<number | null>(null)
  const hasGrounding = (ingestedCount ?? 0) > 0

  // The panel only loads its docs once this accordion section is expanded
  // (Radix unmounts collapsed content), so fetch the count independently on
  // mount to keep the badge/warning accurate while collapsed. Once expanded,
  // the panel's onDocsChange keeps it in sync (uploads/deletes).
  useEffect(() => {
    let cancelled = false
    listReferences(code)
      .then((docs) => {
        if (!cancelled) {
          setIngestedCount(docs.length)
          onReferenceDocsCountChange?.(docs.length)
        }
      })
      .catch(() => {
        if (!cancelled) setIngestedCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [code, onReferenceDocsCountChange])

  return (
    <AccordionSection
      value="grounding"
      icon={Library}
      title="Grounding Materials"
      count={ingestedCount ?? undefined}
      highlightWarning={ingestedCount !== null && !hasGrounding}
      color="rose"
    >
      <ReferenceMaterialsPanel
        courseCode={code}
        embedded
        onDocsChange={(count) => {
          setIngestedCount(count)
          onReferenceDocsCountChange?.(count)
        }}
        onReferenceUploaded={onReferenceUploaded}
      />
    </AccordionSection>
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
    <div className="md-scope space-y-6">
      {/* Course header — plain (no card / colored background) */}
      <div>
        <div className="flex items-start gap-4">
          <span className="md-tile inline-flex h-12 w-12 flex-shrink-0 items-center justify-center bg-gradient-to-br from-[#296ef9] to-[#024ad8] text-white">
            <GraduationCap className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold leading-tight tracking-tight text-foreground">
              {title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="md-pill inline-flex items-center gap-1 bg-[#eef4ff] px-2.5 py-1 text-xs font-semibold text-[#0e3191] dark:bg-[#024ad8]/20 dark:text-[#7aabf5]">
                <Hash className="h-3 w-3" />
                {code}
              </span>
              {typeof creditHours === 'number' && (
                <span className="md-pill inline-flex items-center gap-1 bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  <Layers className="h-3 w-3" />
                  {creditHours} credit{creditHours === 1 ? '' : 's'}
                </span>
              )}
              {typeof hours === 'number' && hours > 0 && (
                <span className="md-pill inline-flex items-center gap-1 bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {hours} hours
                </span>
              )}
              {accreditationTags.map((tag) => (
                <span
                  key={tag}
                  className="md-pill inline-flex items-center gap-1 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400"
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

      {/* References — quiet syllabus citation list (metadata only; grounding lives below) */}
      <ReferencesBlock references={references} />

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile icon={Target} label="Learning Outcomes" value={clos.length} color="slate" />
        <StatTile
          icon={ClipboardCheck}
          label="Assessments"
          value={assessments.length}
          color="blue"
        />
        <StatTile
          icon={Scale}
          label="Total Weight"
          value={`${totalWeight}%`}
          color="emerald"
          tone={assessments.length > 0 && !weightIsBalanced ? 'warning' : 'default'}
          hint={
            assessments.length > 0 && !weightIsBalanced
              ? 'Does not sum to 100%'
              : undefined
          }
        />
        <StatTile icon={CalendarDays} label="Weeks" value={weeklyPlan.length} color="rose" />
      </div>

      {/* Intake sections — single accordion from Course Learning Outcomes to the end */}
      <Accordion type="multiple" className="md-card overflow-hidden">

      {/* Course Learning Outcomes */}
      <AccordionSection value="clos" icon={Target} title="Course Learning Outcomes" count={clos.length} color="slate">
        {clos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No learning outcomes extracted.</p>
        ) : (
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
          >
            {clos.map((clo, index) => (
              <CloRow
                key={clo.clo_id || index}
                clo={clo}
                index={index}
                isLast={index === clos.length - 1}
              />
            ))}
          </motion.div>
        )}
      </AccordionSection>

      {/* Assessment Components */}
      <AccordionSection
        value="assessments"
        icon={ClipboardCheck}
        title="Assessment Components"
        count={assessments.length}
        color="blue"
      >
        {assessments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assessments extracted.</p>
        ) : (
          <div>
            {assessments.map((a, index) => (
              <div
                key={`${a.name}-${index}`}
                className={cn('py-4', index !== assessments.length - 1 && 'border-b border-border')}
              >
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
      </AccordionSection>

      {/* Weekly Plan */}
      <AccordionSection value="weekly" icon={CalendarDays} title="Weekly Plan" count={weeklyPlan.length} color="emerald">
        {weeklyPlan.length === 0 ? (
          <p className="text-sm text-muted-foreground">No weekly plan extracted.</p>
        ) : (
          <ol>
            {weeklyPlan.map((w, index) => (
              <li
                key={`${w.week}-${index}`}
                className={cn('py-4', index !== weeklyPlan.length - 1 && 'border-b border-border')}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-foreground">
                    <span className="font-semibold">Week {w.week}:</span>{' '}
                    <span className="font-medium">{w.topic}</span>
                  </p>
                  {w.clo_ids?.map((id) => (
                    <span
                      key={id}
                      className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
                    >
                      {id}
                    </span>
                  ))}
                </div>
                {w.description && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{w.description}</p>
                )}
                {w.readings && (
                  <div className="mt-1">
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <BookMarked className="h-3 w-3" />
                      {w.readings}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </AccordionSection>

      {/* Grounding Materials — uploaded/linked/library source corpus for RAG */}
      <GroundingMaterialsSection
        code={code}
        onReferenceUploaded={onReferenceUploaded}
        onReferenceDocsCountChange={onReferenceDocsCountChange}
      />

      {/* Delivery & Accreditation */}
      <AccordionSection value="delivery" icon={Award} title="Delivery & Accreditation" color="amber">
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
        </AccordionSection>
      </Accordion>
    </div>
  )
}
