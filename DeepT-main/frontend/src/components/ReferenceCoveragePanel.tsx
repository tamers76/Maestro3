import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  ExternalLink,
  FileText,
  Gauge,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Upload,
  Wrench,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { showToast } from '@/components/ui/Toaster'
import { cn } from '@/lib/utils'
import ReferenceMaterialsPanel from '@/components/ReferenceMaterialsPanel'
import {
  fetchCoverage,
  computeCoverage,
  suggestSources,
  uploadReferenceFromLink,
  type CoverageBand,
  type CoverageCloResult,
  type CoverageDelta,
  type CoverageDeltaEntry,
  type CoverageDocRef,
  type CoverageSourceSuggestion,
  type CoverageStateSummary,
  type ReferenceCoverageReport,
  type ReferenceSourceType,
} from '@/services/api'

const BAND_META: Record<CoverageBand, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  well_covered: {
    label: 'Well covered',
    cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    icon: CheckCircle2,
  },
  partial: {
    label: 'Partial',
    cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    icon: AlertTriangle,
  },
  not_covered: {
    label: 'Not covered',
    cls: 'bg-red-500/15 text-red-600 dark:text-red-400',
    icon: CircleSlash,
  },
}

// ---------------------------------------------------------------------------
// Graceful-degradation accessors — older persisted reports may predate the
// short_label / coverage_pct / covered_by fields, so derive sane fallbacks.
// ---------------------------------------------------------------------------

function deriveShortLabel(statement: string): string {
  const words = statement.trim().split(/\s+/).filter(Boolean).slice(0, 4)
  return words.join(' ') || 'Untitled CLO'
}

function shortLabelOf(clo: CoverageCloResult): string {
  return clo.short_label?.trim() || deriveShortLabel(clo.statement)
}

function coveredByOf(clo: CoverageCloResult): CoverageDocRef[] {
  return Array.isArray(clo.covered_by) ? clo.covered_by : []
}

/**
 * Plain-language explanation of the rating, in SME terms (no "band"/"evidence
 * gate"/"judgment" jargon). Derived from band + verdict + evidence_gate_passed.
 */
function ratingExplanation(clo: CoverageCloResult): string {
  if (clo.band === 'well_covered') {
    return 'Assessed from your corpus · the material substantively teaches this CLO.'
  }
  if (clo.band === 'partial') {
    return 'Assessed from your corpus · the material partially supports this CLO.'
  }
  // not_covered: distinguish "no source material found" from the override case
  // (passages cleared the relevance floor but don't substantively teach the CLO).
  if (!clo.evidence_gate_passed || clo.supporting_passages.length === 0) {
    return 'Assessed from your corpus · not enough source material was found to teach this CLO.'
  }
  return "Assessed from your corpus · the material doesn't substantively teach this CLO."
}

/**
 * Short, verdict-AGREEING descriptor for the collapsed row — replaces the raw
 * similarity %, which can contradict the verdict (e.g. "Not covered · 96%").
 */
function rowDescriptor(clo: CoverageCloResult): string {
  const { supporting_count, retrieved_count } = clo.signals
  if (clo.band === 'not_covered') {
    if (supporting_count === 0) return 'no teaching passages'
    return `${retrieved_count} passages · none teaching this`
  }
  if (clo.band === 'partial') {
    return `${supporting_count} partial passage${supporting_count === 1 ? '' : 's'}`
  }
  return `${supporting_count} supporting passage${supporting_count === 1 ? '' : 's'}`
}

function BandChip({ band }: { band: CoverageBand }) {
  const meta = BAND_META[band]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        meta.cls
      )}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  )
}

/** Small "improved/regressed" pill showing a CLO's band move since last measurement. */
function DeltaPill({ entry }: { entry: CoverageDeltaEntry }) {
  if (entry.direction === 'unchanged' || entry.from_band === null) return null
  const improved = entry.direction === 'improved'
  const Icon = improved ? TrendingUp : TrendingDown
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        improved
          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
          : 'bg-red-500/15 text-red-600 dark:text-red-400'
      )}
      title={`${improved ? 'Improved' : 'Regressed'}: ${BAND_META[entry.from_band].label} → ${BAND_META[entry.to_band].label}`}
    >
      <Icon className="h-3 w-3" />
      {BAND_META[entry.from_band].label} → {BAND_META[entry.to_band].label}
    </span>
  )
}

function StatusBadge({ status }: { status: CoverageStateSummary['status'] }) {
  const map: Record<CoverageStateSummary['status'], { label: string; cls: string }> = {
    locked: { label: 'Locked', cls: 'bg-muted text-muted-foreground' },
    no_references: { label: 'No references', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
    available: { label: 'Ready to measure', cls: 'bg-primary/10 text-primary' },
    computed: { label: 'Measured', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  }
  const s = map[status]
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', s.cls)}>{s.label}</span>
}

/** The "Covered by" cell — one line per supporting document, or an empty-state. */
function CoveredByCell({ refs }: { refs: CoverageDocRef[] }) {
  if (refs.length === 0) {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <CircleSlash className="h-3.5 w-3.5 shrink-0" />
        No references cover this
      </span>
    )
  }
  return (
    <div className="space-y-1">
      {refs.map((ref) => (
        <div key={ref.doc_id} className="flex items-center gap-1.5">
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              ref.strength === 'strong' ? 'bg-emerald-500' : 'bg-amber-500'
            )}
          />
          <span className="truncate text-foreground" title={ref.title}>
            {ref.title}
          </span>
          <span className="shrink-0 text-muted-foreground">({ref.strength})</span>
        </div>
      ))}
    </div>
  )
}

/** A url that points directly at a PDF can be ingested via the link path. */
function isDirectPdfUrl(url: string): boolean {
  return /\.pdf(\?|#|$)/i.test(url.trim())
}

const SOURCE_TYPE_LABEL: Record<ReferenceSourceType, string> = {
  textbook_chapter: 'Textbook chapter',
  paper: 'Paper',
  other: 'Other',
}

/**
 * AI source suggestions for a weak/uncovered CLO (Phase C). AI PROPOSES, SME
 * APPROVES: fetches candidate sources on demand; SME approves each one.
 */
function useSuggestedSources(
  clo: CoverageCloResult,
  courseCode: string,
  onApproveLink: (suggestion: CoverageSourceSuggestion) => Promise<boolean>,
  onApproveViaDialog: (clo: CoverageCloResult, suggestion: CoverageSourceSuggestion) => void
) {
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [suggestions, setSuggestions] = useState<CoverageSourceSuggestion[]>([])
  const [reason, setReason] = useState<string | undefined>()
  const [approvingUrl, setApprovingUrl] = useState<string | null>(null)
  const [ingestedUrls, setIngestedUrls] = useState<Set<string>>(new Set())

  async function handleSuggest() {
    try {
      setLoading(true)
      const result = await suggestSources(courseCode, clo.clo_id)
      setSuggestions(result.suggestions)
      setReason(result.reason)
      setLoaded(true)
    } catch (error) {
      showToast({
        title: 'Could not get suggestions',
        description: error instanceof Error ? error.message : 'Failed to suggest sources',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleApprove(suggestion: CoverageSourceSuggestion) {
    if (isDirectPdfUrl(suggestion.url)) {
      setApprovingUrl(suggestion.url)
      try {
        const ok = await onApproveLink(suggestion)
        if (ok) setIngestedUrls((prev) => new Set(prev).add(suggestion.url))
      } finally {
        setApprovingUrl(null)
      }
    } else {
      onApproveViaDialog(clo, suggestion)
    }
  }

  return {
    loading,
    loaded,
    suggestions,
    reason,
    approvingUrl,
    ingestedUrls,
    handleSuggest,
    handleApprove,
  }
}

function SuggestedSourcesResults({
  loading,
  loaded,
  suggestions,
  reason,
  approvingUrl,
  ingestedUrls,
  onApprove,
}: {
  loading: boolean
  loaded: boolean
  suggestions: CoverageSourceSuggestion[]
  reason?: string
  approvingUrl: string | null
  ingestedUrls: Set<string>
  onApprove: (suggestion: CoverageSourceSuggestion) => void
}) {
  return (
    <>
      {loading && !loaded && (
        <p className="text-xs text-muted-foreground">
          Searching the web for candidate sources that teach this gap…
        </p>
      )}

      {loaded && suggestions.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {reason ?? 'No new sources were proposed for this CLO.'}
        </p>
      )}

      {suggestions.length > 0 && (
        <ul className="space-y-2">
          {suggestions.map((s, i) => {
            const ingested = ingestedUrls.has(s.url)
            const approving = approvingUrl === s.url
            const directPdf = isDirectPdfUrl(s.url)
            return (
              <li key={`${s.url}-${i}`} className="rounded-md border border-border p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      title={s.url}
                    >
                      <span className="truncate">{s.title}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.why}</p>
                    <span className="mt-1 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {SOURCE_TYPE_LABEL[s.source_type]}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={ingested ? 'outline' : 'default'}
                    className="h-7 shrink-0 px-2 text-xs"
                    disabled={approving || ingested}
                    onClick={() => onApprove(s)}
                    title={
                      directPdf
                        ? 'Ingest this PDF via the existing link ingest path, then re-check coverage'
                        : 'Open the upload dialog prefilled with this source (download + upload or paste a direct link)'
                    }
                  >
                    {ingested ? (
                      <>
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                        Ingested
                      </>
                    ) : approving ? (
                      <>
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        Ingesting…
                      </>
                    ) : (
                      <>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Approve &amp; ingest
                      </>
                    )}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

/** The expanded body for one CLO (full statement + signals + rationale + evidence). */
function CloExpandedBody({
  clo,
  courseCode,
  onUploadReference,
  onApproveLink,
  onApproveViaDialog,
}: {
  clo: CoverageCloResult
  courseCode: string
  onUploadReference: (clo: CoverageCloResult) => void
  onApproveLink: (suggestion: CoverageSourceSuggestion) => Promise<boolean>
  onApproveViaDialog: (clo: CoverageCloResult, suggestion: CoverageSourceSuggestion) => void
}) {
  const flagged = clo.band !== 'well_covered'
  const [passagesOpen, setPassagesOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const suggested = useSuggestedSources(clo, courseCode, onApproveLink, onApproveViaDialog)

  // "Full report" toggles everything we have for this CLO: show/hide the
  // supporting passages, scrolling the full detail into view when opening.
  function handleFullReport() {
    setPassagesOpen((o) => {
      const next = !o
      if (next) {
        requestAnimationFrame(() => {
          bodyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        })
      }
      return next
    })
  }

  return (
    <div ref={bodyRef} className="space-y-3">
      {/* Full CLO statement — lives here now that the row header only shows the label. */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          CLO statement
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
          {clo.statement}
        </p>
      </div>

      {/* Signals row */}
      <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/30 p-2 text-xs sm:grid-cols-5">
        <div>
          <p className="text-muted-foreground">Top similarity</p>
          <p className="font-medium text-foreground">{clo.signals.top_score.toFixed(3)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Median similarity</p>
          <p className="font-medium text-foreground">{clo.signals.median_score.toFixed(3)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Passages</p>
          <p className="font-medium text-foreground">{clo.signals.retrieved_count}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Supporting</p>
          <p className="font-medium text-foreground">{clo.signals.supporting_count}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Distinct sources</p>
          <p className="font-medium text-foreground">{clo.signals.distinct_sources}</p>
        </div>
      </div>

      {/* Rating rationale */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Why this rating
        </p>
        <p className="text-xs text-foreground">{clo.rationale}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{ratingExplanation(clo)}</p>
      </div>

      {/* Gaps */}
      {clo.gaps.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Gaps</p>
          <ul className="list-disc pl-4 text-xs text-foreground">
            {clo.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Supporting passages — collapsed by default; SME expands to verify. */}
      <div>
        <button
          type="button"
          onClick={() => setPassagesOpen((o) => !o)}
          className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={passagesOpen}
        >
          {passagesOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Supporting passages ({clo.supporting_passages.length})
        </button>
        {passagesOpen &&
          (clo.supporting_passages.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              No supporting passages cleared the relevance floor in the uploaded corpus.
            </p>
          ) : (
            <div className="mt-1 space-y-2">
              {clo.supporting_passages.map((p) => (
                <div key={p.chunk_id} className="rounded-md border border-border p-2">
                  <p className="truncate text-[11px] font-medium text-foreground" title={p.citation}>
                    {p.citation} <span className="text-muted-foreground">· score {p.score.toFixed(3)}</span>
                  </p>
                  <p className="line-clamp-3 text-xs text-muted-foreground">{p.text_preview}</p>
                </div>
              ))}
            </div>
          ))}
      </div>

      {/* Gap-closing actions — all three buttons on one row (suggestions list below). */}
      {flagged && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onUploadReference(clo)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload reference
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void suggested.handleSuggest()}
              disabled={suggested.loading}
            >
              {suggested.loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              {suggested.loaded ? 'Re-suggest sources' : 'Suggest sources'}
            </Button>
            <Button size="sm" variant="outline" onClick={handleFullReport}>
              <FileText className="mr-2 h-4 w-4" />
              Full report
            </Button>
          </div>
          {suggested.loaded && (
            <p className="text-[11px] text-muted-foreground">
              AI-proposed sources — verify before adding; nothing is ingested until you approve.
            </p>
          )}
          <SuggestedSourcesResults
            loading={suggested.loading}
            loaded={suggested.loaded}
            suggestions={suggested.suggestions}
            reason={suggested.reason}
            approvingUrl={suggested.approvingUrl}
            ingestedUrls={suggested.ingestedUrls}
            onApprove={(s) => void suggested.handleApprove(s)}
          />
        </div>
      )}
    </div>
  )
}

/** One per-CLO table row (collapsed) plus its in-place expanded body. */
function CloRows({
  clo,
  courseCode,
  open,
  onToggle,
  deltaEntry,
  onUploadReference,
  onApproveLink,
  onApproveViaDialog,
}: {
  clo: CoverageCloResult
  courseCode: string
  open: boolean
  onToggle: () => void
  deltaEntry?: CoverageDeltaEntry
  onUploadReference: (clo: CoverageCloResult) => void
  onApproveLink: (suggestion: CoverageSourceSuggestion) => Promise<boolean>
  onApproveViaDialog: (clo: CoverageCloResult, suggestion: CoverageSourceSuggestion) => void
}) {
  const flagged = clo.band !== 'well_covered'
  const label = shortLabelOf(clo)
  const descriptor = rowDescriptor(clo)
  const refs = coveredByOf(clo)

  return (
    <>
      <tr
        className={cn(
          'cursor-pointer border-b-[0.5px] border-border align-top transition-colors hover:bg-muted/30',
          open && 'bg-muted/20'
        )}
        onClick={onToggle}
      >
        <td className="px-3 py-2.5">
          <div className="font-medium text-foreground">{clo.clo_id}</div>
          <div className="mt-0.5 truncate text-muted-foreground" title={label}>
            {label}
          </div>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex flex-col gap-1">
            <BandChip band={clo.band} />
            <span className="text-[11px] text-muted-foreground">{descriptor}</span>
            {deltaEntry && <DeltaPill entry={deltaEntry} />}
          </div>
        </td>
        <td className="px-3 py-2.5">
          <CoveredByCell refs={refs} />
        </td>
        <td className="px-3 py-2.5">
          {flagged ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation()
                onToggle()
              }}
            >
              <Wrench className="mr-1 h-3.5 w-3.5" />
              Fix gap
              {open ? (
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              )}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Adequate
            </span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b-[0.5px] border-border bg-muted/10">
          <td colSpan={4} className="px-3 py-3">
            <CloExpandedBody
              clo={clo}
              courseCode={courseCode}
              onUploadReference={onUploadReference}
              onApproveLink={onApproveLink}
              onApproveViaDialog={onApproveViaDialog}
            />
          </td>
        </tr>
      )}
    </>
  )
}

export default function ReferenceCoveragePanel({
  courseCode,
  refreshSignal = 0,
}: {
  courseCode: string
  /** Bumped by the parent after a reference is ingested to auto-re-run coverage. */
  refreshSignal?: number
}) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [state, setState] = useState<CoverageStateSummary | null>(null)
  const [report, setReport] = useState<ReferenceCoverageReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [computing, setComputing] = useState(false)
  const [openCloId, setOpenCloId] = useState<string | null>(null)
  const [delta, setDelta] = useState<CoverageDelta | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  // The CLO whose gap the SME is closing via the upload dialog (null = closed).
  const [uploadClo, setUploadClo] = useState<CoverageCloResult | null>(null)
  // Prefill for the upload dialog when opened from an approved AI suggestion.
  const [uploadPrefill, setUploadPrefill] = useState<{
    title?: string
    url?: string
    sourceType?: ReferenceSourceType
  } | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchCoverage(courseCode)
      setState(data.state)
      setReport(data.report)
    } catch {
      setState(null)
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    void load()
  }, [load])

  const handleCompute = useCallback(async () => {
    try {
      setComputing(true)
      const { report: result, delta: resultDelta } = await computeCoverage(courseCode)
      setReport(result)
      setDelta(resultDelta)
      setBannerDismissed(false)
      const deltaNote =
        resultDelta && (resultDelta.improved > 0 || resultDelta.regressed > 0)
          ? ` · ${resultDelta.improved} improved, ${resultDelta.regressed} regressed`
          : ''
      showToast({
        title: 'Coverage measured',
        description: `${result.summary.well_covered} well covered · ${result.summary.partial} partial · ${result.summary.not_covered} not covered, across ${result.summary.total_clos} CLO(s)${deltaNote}.`,
        variant: 'success',
      })
      await load()
    } catch (error) {
      showToast({
        title: 'Coverage failed',
        description: error instanceof Error ? error.message : 'Failed to measure coverage',
        variant: 'destructive',
      })
    } finally {
      setComputing(false)
    }
  }, [courseCode, load])

  const status = state?.status ?? 'available'
  const locked = status === 'locked' || status === 'no_references'

  // Auto re-run coverage when the parent signals that a reference was ingested,
  // so the SME immediately sees the before/after deltas. Skips the initial mount.
  const prevSignal = useRef(refreshSignal)
  useEffect(() => {
    if (refreshSignal === prevSignal.current) return
    prevSignal.current = refreshSignal
    if (!locked && !computing) void handleCompute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal])

  // Map of clo_id -> band-change entry for the per-row pills.
  const deltaByClo = new Map<string, CoverageDeltaEntry>(
    (delta?.entries ?? []).map((e) => [e.clo_id, e])
  )
  const hasDeltaToShow =
    !!report?.generated_at && !!delta && (delta.improved > 0 || delta.regressed > 0) && !bannerDismissed

  function handleUploadDone() {
    setUploadClo(null)
    setUploadPrefill(null)
    if (!locked) void handleCompute()
  }

  // Approve a direct-PDF suggestion: ingest it through the EXISTING link ingest
  // path, then re-run coverage (the Phase B re-check loop). Returns whether the
  // ingest succeeded so the row can show an "Ingested" state. NEVER auto-called —
  // only on an explicit Approve click.
  const handleApproveLink = useCallback(
    async (suggestion: CoverageSourceSuggestion): Promise<boolean> => {
      try {
        const doc = await uploadReferenceFromLink(courseCode, suggestion.url, {
          title: suggestion.title,
          source_type: suggestion.source_type,
        })
        showToast({
          title: 'Source ingested',
          description: `${doc.title} — ${doc.chunk_count} passages indexed. Re-running coverage…`,
          variant: 'success',
        })
        if (!locked) void handleCompute()
        return true
      } catch (error) {
        showToast({
          title: 'Ingest failed',
          description:
            error instanceof Error
              ? `${error.message} — try downloading the file and uploading it instead.`
              : 'Failed to ingest the source link.',
          variant: 'destructive',
        })
        return false
      }
    },
    [courseCode, locked, handleCompute]
  )

  // Approve a non-PDF suggestion: open the existing upload dialog prefilled with
  // the title/url so the SME can download+upload or paste a direct link. The
  // actual ingest happens inside ReferenceMaterialsPanel (existing path).
  function handleApproveViaDialog(clo: CoverageCloResult, suggestion: CoverageSourceSuggestion) {
    setUploadPrefill({
      title: suggestion.title,
      url: suggestion.url,
      sourceType: suggestion.source_type,
    })
    setUploadClo(clo)
  }
  const summary = report?.summary
  const totalClos = summary?.total_clos ?? state?.approved_clo_count ?? 0
  const wellCovered = summary?.well_covered ?? 0
  const needAttention = (summary?.partial ?? 0) + (summary?.not_covered ?? 0)
  const referenceCount = report?.reference_doc_count ?? state?.reference_doc_count ?? 0

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
        onClick={() => setPanelOpen((open) => !open)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2 font-medium">
              <Gauge className="h-4 w-4 shrink-0" />
              Reference Coverage Check
            </span>
            {state && <StatusBadge status={state.status} />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Course Architect · After CLO Refinement
            {!panelOpen && !loading && totalClos > 0 && (
              <>
                {' '}
                · {wellCovered} of {totalClos} covered · {needAttention} need attention · {referenceCount}{' '}
                reference{referenceCount === 1 ? '' : 's'}
              </>
            )}
          </p>
          {panelOpen && (
            <p className="mt-2 text-sm text-muted-foreground">
              A read-only measurement of how well your uploaded reference corpus teaches each approved
              CLO. The model judges only the passages actually retrieved from your corpus, so model
              knowledge can never stand in for real sources. This does{' '}
              <span className="font-medium text-foreground">not</span> tag references or alter Reference
              Alignment; it only tells you where the corpus is thin.
            </p>
          )}
        </div>
        {panelOpen ? (
          <ChevronDown className="h-5 w-5 shrink-0" />
        ) : (
          <ChevronRight className="h-5 w-5 shrink-0" />
        )}
      </button>

      {panelOpen && (
        <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading coverage…
          </div>
        ) : (
          <>
            {/* Summary metrics row */}
            <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
              <div>
                <p className="text-muted-foreground">CLOs covered</p>
                <p className="font-medium text-emerald-600 dark:text-emerald-400">
                  {summary ? `${wellCovered} of ${totalClos}` : '—'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Need attention</p>
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  {summary ? needAttention : '—'}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">References</p>
                <p className="font-medium text-foreground">{referenceCount}</p>
              </div>
            </div>

            {/* Lock / dependency messaging */}
            {locked && state?.lock_reason && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
                {status === 'no_references' ? (
                  <Upload className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span>{state.lock_reason}</span>
              </div>
            )}

            {/* Re-run coverage bar */}
            {!locked && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={handleCompute} disabled={computing}>
                  {computing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  {report?.generated_at ? 'Re-run coverage' : 'Measure coverage'}
                </Button>
                {report?.generated_at && (
                  <span className="text-xs text-muted-foreground">
                    Last measured {new Date(report.generated_at).toLocaleString()}
                  </span>
                )}
              </div>
            )}

            {/* Before/after delta banner — subtle + dismissible; the table stays
                the source of truth. Only shows when a recompute changed bands. */}
            {hasDeltaToShow && delta && (
              <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-primary/5 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-foreground">
                    References changed —{' '}
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {delta.improved} CLO{delta.improved === 1 ? '' : 's'} improved
                    </span>
                    {delta.regressed > 0 && (
                      <>
                        {' · '}
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          {delta.regressed} regressed
                        </span>
                      </>
                    )}
                    {' · '}
                    {delta.unchanged} unchanged
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setBannerDismissed(true)}
                  className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Per-CLO coverage table */}
            {report && report.clos.length > 0 && (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full table-fixed border-collapse text-xs">
                  <colgroup>
                    <col className="w-[24%]" />
                    <col className="w-[18%]" />
                    <col className="w-[36%]" />
                    <col className="w-[22%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b-[0.5px] border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-semibold">CLO</th>
                      <th className="px-3 py-2 font-semibold">Coverage</th>
                      <th className="px-3 py-2 font-semibold">Covered by</th>
                      <th className="px-3 py-2 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.clos.map((clo) => (
                      <CloRows
                        key={clo.clo_id}
                        clo={clo}
                        courseCode={courseCode}
                        open={openCloId === clo.clo_id}
                        onToggle={() =>
                          setOpenCloId((cur) => (cur === clo.clo_id ? null : clo.clo_id))
                        }
                        deltaEntry={deltaByClo.get(clo.clo_id)}
                        onUploadReference={(c) => {
                          setUploadPrefill(null)
                          setUploadClo(c)
                        }}
                        onApproveLink={handleApproveLink}
                        onApproveViaDialog={handleApproveViaDialog}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        </div>
      )}

      {/* Fix-gap upload — reuses the real reference ingestion flow. A successful
          upload closes the dialog and re-runs coverage (the WS1 re-check loop). */}
      <Dialog
        open={!!uploadClo}
        onOpenChange={(open) => {
          if (!open) {
            setUploadClo(null)
            setUploadPrefill(null)
          }
        }}
      >
        <DialogContent className="w-[95vw] max-w-4xl grid-cols-1 max-h-[85vh] overflow-y-auto">
          <DialogHeader className="min-w-0">
            <DialogTitle>Upload a reference to close this gap</DialogTitle>
            <DialogDescription className="whitespace-normal break-words">
              {uploadClo
                ? `Ingest a reference that teaches ${uploadClo.clo_id} — ${shortLabelOf(uploadClo)}. Coverage re-runs automatically after ingest so you can see the change.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {uploadPrefill && (
            <div className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
              Prefilled from an AI-proposed source —{' '}
              <span className="font-medium text-foreground">verify it before adding</span>. If you have
              a direct PDF link, paste it under "Add from link"; otherwise download the file and upload
              it. Nothing is ingested until you confirm here.
              {uploadPrefill.url && (
                <>
                  {' '}
                  <a
                    href={uploadPrefill.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Open source <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </div>
          )}
          {uploadClo && (
            <div className="min-w-0">
              <ReferenceMaterialsPanel
                courseCode={courseCode}
                embedded
                onReferenceUploaded={handleUploadDone}
                initialTitle={uploadPrefill?.title}
                initialLinkUrl={
                  uploadPrefill?.url && isDirectPdfUrl(uploadPrefill.url)
                    ? uploadPrefill.url
                    : undefined
                }
                initialSourceType={uploadPrefill?.sourceType}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
