import { useCallback, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom'
import { ArrowLeft, Boxes, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { showToast } from '@/components/ui/Toaster'
import { fetchCourse, listReferences, type CourseDetail as CourseDetailType } from '@/services/api'
import Stage1Layers, { type SoloLayerActions } from '@/components/Stage1Layers'
import { type IntakeSummaryProps } from '@/components/IntakeSummaryView'
import NodeEnginePanel from '@/components/nodeEngine/NodeEnginePanel'
import JourneyRail from './JourneyRail'
import WizardStepShell, { type StepStatusTone } from './WizardStepShell'
import WizardActionBar from './WizardActionBar'
import { useCourseJourney, type CourseJourney, type JourneyStep, type WizardPhase } from './useCourseJourney'

/** Map a journey step status to the step-shell status badge tone. */
function stepBadge(status: JourneyStep['status'] | undefined): { label: string; tone: StepStatusTone } {
  switch (status) {
    case 'done':
      return { label: 'Approved', tone: 'approved' }
    case 'current':
      return { label: 'In progress', tone: 'running' }
    case 'locked':
      return { label: 'Locked', tone: 'locked' }
    default:
      return { label: 'Not started', tone: 'neutral' }
  }
}

interface ArchitectScreenProps {
  courseCode: string
  journey: CourseJourney
  intake: IntakeSummaryProps
  alignmentFetchSignal: number
  alignmentAutoProposeSignal: number
  onAlignmentFetch: () => void
  onAlignmentAutoPropose: () => void
  onArchitectAllApproved: (v: boolean) => void
}

/** One Course Architect layer, rendered as a focused, route-driven step. */
function ArchitectScreen({
  courseCode,
  journey,
  intake,
  alignmentFetchSignal,
  alignmentAutoProposeSignal,
  onAlignmentFetch,
  onAlignmentAutoPropose,
  onArchitectAllApproved,
}: ArchitectScreenProps) {
  const { layerId } = useParams<{ layerId: string }>()
  const navigate = useNavigate()
  const base = `/courses/${encodeURIComponent(courseCode)}`
  const steps = journey.architectSteps
  const idx = steps.findIndex((s) => s.id === layerId)

  // Keep the rail/stepper statuses in sync whenever a layer is opened.
  useEffect(() => {
    void journey.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId])

  // Each layer is a full page; landing on a new layer should start at the top
  // (router navigation alone preserves the previous scroll position).
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [layerId])

  // Unknown / not-yet-loaded layer id → bounce to the resume frontier.
  if (steps.length > 0 && idx === -1) {
    return <Navigate to={`${base}/architect/${journey.architectFrontierId ?? steps[0].id}`} replace />
  }

  const active = idx >= 0 ? steps[idx] : undefined
  const prev = idx > 0 ? steps[idx - 1] : undefined
  const next = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1] : undefined
  // The forward action only appears once the current layer is approved.
  const approved = active?.status === 'done'
  const goLayer = (id: string) => navigate(`${base}/architect/${id}`)
  const goEngine = () => navigate(`${base}/engine/${journey.engineFrontierLayer}`)
  const [referenceDocsCount, setReferenceDocsCount] = useState(0)
  // Layer 2 (CLO review) lifts its Approve/Regenerate actions up so the sticky
  // action bar can own them, alongside the "Next layer" navigation.
  const [soloActions, setSoloActions] = useState<SoloLayerActions | null>(null)

  // Stabilize the callbacks handed to Stage1Layers. These are invoked from
  // inside Stage1Layers' data-loading effects; an unstable identity here would
  // re-trigger those effects on every parent re-render (refetch loop).
  const journeyRefresh = journey.refresh
  const handleAllApproved = useCallback(
    (v: boolean) => {
      onArchitectAllApproved(v)
      void journeyRefresh()
    },
    [onArchitectAllApproved, journeyRefresh]
  )
  const handleAlignmentSignals = useCallback(() => {
    onAlignmentAutoPropose()
    onAlignmentFetch()
  }, [onAlignmentAutoPropose, onAlignmentFetch])
  const handleAlignmentApproved = useCallback(() => {
    onAlignmentFetch()
    void journeyRefresh()
  }, [onAlignmentFetch, journeyRefresh])
  const refreshReferenceDocsCount = useCallback(async () => {
    try {
      const docs = await listReferences(courseCode)
      setReferenceDocsCount(docs.length)
    } catch {
      // Non-fatal; Stage 1 still enforces gating locally.
    }
  }, [courseCode])
  useEffect(() => {
    void refreshReferenceDocsCount()
  }, [refreshReferenceDocsCount])

  const layer1BlockedByMissingReferences = active?.id === 'layer1-intake' && referenceDocsCount === 0

  return (
    <>
      <WizardStepShell
        breadcrumb={[{ label: 'Course Architect' }, { label: active?.label ?? 'Layer' }]}
        counter={`Phase 1 of 2 · Step ${Math.max(idx, 0) + 1} of ${steps.length || 6}`}
        title={active?.label ?? 'Course Architect'}
        subtitle="Review, run, and approve this layer. Approving unlocks the next step in the journey."
        statusBadge={stepBadge(active?.status)}
      >
        <Stage1Layers
          courseCode={courseCode}
          soloLayerId={layerId}
          onNavigateLayer={goLayer}
          onAllApproved={handleAllApproved}
          onSoloActionsChange={setSoloActions}
          onAlignmentAutoPropose={handleAlignmentSignals}
          onReferenceUploaded={handleAlignmentSignals}
          alignmentFetchSignal={alignmentFetchSignal}
          alignmentAutoProposeSignal={alignmentAutoProposeSignal}
          onAlignmentApproved={handleAlignmentApproved}
          intake={intake}
          onReferenceDocsCountChange={setReferenceDocsCount}
        />
      </WizardStepShell>
      <WizardActionBar
        back={prev ? { label: `Back: ${prev.label}`, onClick: () => goLayer(prev.id) } : undefined}
        primary={
          approved
            ? next
              ? {
                  label: 'Next layer',
                  onClick: () => goLayer(next.id),
                  icon: <ChevronRight className="h-4 w-4" />,
                }
              : {
                  label: 'Continue to Node Engine',
                  onClick: goEngine,
                  disabled: !journey.engineUnlocked,
                  icon: <ChevronRight className="h-4 w-4" />,
                }
            : soloActions
              ? {
                  label: 'Next layer',
                  onClick: soloActions.approve,
                  disabled: !soloActions.canApprove,
                  icon: <ChevronRight className="h-4 w-4" />,
                }
              : undefined
        }
        hint={
          layer1BlockedByMissingReferences
            ? 'Upload at least one grounding reference before moving to the next layer.'
            : soloActions && !approved && !soloActions.canApprove
            ? soloActions.approveHint ?? 'Approve every CLO refinement below to enable approval.'
            : next && next.status === 'locked'
            ? 'Approve this layer to unlock the next step.'
            : !next && !journey.engineUnlocked
              ? 'Approve all six layers and activate reference alignment to unlock the Node Engine.'
              : undefined
        }
      />
    </>
  )
}

interface EngineScreenProps {
  courseCode: string
  journey: CourseJourney
  alignmentFetchSignal: number
  onEngineApprovalsChange: (approvals: {
    layer1: boolean
    layer2: boolean
    layer3: boolean
    layer4: boolean
  }) => void
}

/** One Node Engine layer, rendered as a focused, route-driven step. */
function EngineScreen({
  courseCode,
  journey,
  alignmentFetchSignal,
  onEngineApprovalsChange,
}: EngineScreenProps) {
  const { layerNum } = useParams<{ layerNum: string }>()
  const navigate = useNavigate()
  const base = `/courses/${encodeURIComponent(courseCode)}`
  const num = Number(layerNum)

  useEffect(() => {
    void journey.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerNum])

  // Land at the top of the page when moving to a new engine layer.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [layerNum])

  const goArchitect = () =>
    navigate(`${base}/architect/${journey.architectFrontierId ?? journey.architectSteps[0]?.id ?? ''}`)

  if (!journey.engineUnlocked) {
    return (
      <>
        <WizardStepShell
          breadcrumb={[{ label: 'Node Engine' }]}
          counter="Phase 2 of 2"
          title="Maestro Node Engine"
          subtitle="Turn each approved subtopic into governed adaptive learning nodes."
          statusBadge={{ label: 'Locked', tone: 'locked' }}
        >
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
            <Boxes className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-caption font-medium text-foreground">Node Engine is locked</p>
            <p className="mt-1 max-w-md text-fine-print text-muted-foreground">
              Complete all six Course Architect layers and activate reference alignment to begin node
              generation.
            </p>
            <Button className="mt-4" onClick={goArchitect}>
              Go to Course Architect
            </Button>
          </div>
        </WizardStepShell>
        <WizardActionBar back={{ label: 'Back to Course Architect', onClick: goArchitect }} />
      </>
    )
  }

  const steps = journey.engineSteps
  const idx = steps.findIndex((s) => s.id === `engine-${num}`)
  if (steps.length > 0 && (Number.isNaN(num) || idx === -1)) {
    return <Navigate to={`${base}/engine/${journey.engineFrontierLayer}`} replace />
  }

  const active = idx >= 0 ? steps[idx] : undefined
  const prev = idx > 0 ? steps[idx - 1] : undefined
  const next = idx >= 0 && idx < steps.length - 1 ? steps[idx + 1] : undefined
  const layerOf = (id: string) => Number(id.replace('engine-', ''))
  const goLayer = (n: number) => navigate(`${base}/engine/${n}`)

  return (
    <>
      <WizardStepShell
        breadcrumb={[{ label: 'Node Engine' }, { label: active?.label ?? 'Layer' }]}
        counter={`Phase 2 of 2 · Step ${Math.max(idx, 0) + 1} of ${steps.length}`}
        title={active?.label ?? 'Maestro Node Engine'}
        subtitle="Generate and approve this layer's output. Approving unlocks the next layer."
        statusBadge={stepBadge(active?.status)}
      >
        <NodeEnginePanel
          courseCode={courseCode}
          soloLayer={num}
          onNavigateLayer={goLayer}
          alignmentFetchSignal={alignmentFetchSignal}
          onLayerApprovalsChange={onEngineApprovalsChange}
        />
      </WizardStepShell>
      <WizardActionBar
        back={
          prev
            ? { label: `Back: ${prev.label}`, onClick: () => goLayer(layerOf(prev.id)) }
            : { label: 'Back to Course Architect', onClick: goArchitect }
        }
        primary={
          next
            ? {
                label: 'Next layer',
                onClick: () => goLayer(layerOf(next.id)),
                icon: <ChevronRight className="h-4 w-4" />,
              }
            : undefined
        }
      />
    </>
  )
}

/**
 * The routed Course Architect → Node Engine wizard shell. Owns the course data,
 * the persistent journey rail, and per-layer routing. Each layer renders the
 * existing engine panels in "solo" mode inside the shared step chrome
 * (breadcrumb, dots stepper, sticky action bar) so the design language is
 * identical end-to-end.
 */
export default function CourseWizard() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const location = useLocation()

  const [course, setCourse] = useState<CourseDetailType | null>(null)
  const [loading, setLoading] = useState(true)

  // Alignment coordination signals (mirrors the legacy CourseDetail wiring).
  const [alignmentFetchSignal, setAlignmentFetchSignal] = useState(0)
  const [alignmentAutoProposeSignal, setAlignmentAutoProposeSignal] = useState(0)
  const [, setArchitectAllApproved] = useState(false)

  // Per-engine-layer approval state, published by the Node Engine panel so the
  // Course Journey rail can lock each engine stage until its predecessor is
  // approved. Defaults to all-locked until the panel reports otherwise.
  const [engineApprovals, setEngineApprovals] = useState({
    layer1: false,
    layer2: false,
    layer3: false,
    layer4: false,
  })

  const journey = useCourseJourney(code)

  // Stable signal bumpers so child screens/panels don't see new callback
  // identities on every render.
  const bumpAlignmentFetch = useCallback(() => setAlignmentFetchSignal((n) => n + 1), [])
  const bumpAlignmentAutoPropose = useCallback(() => setAlignmentAutoProposeSignal((n) => n + 1), [])

  useEffect(() => {
    if (!code) return
    let active = true
    setLoading(true)
    fetchCourse(code)
      .then((data) => {
        if (active) setCourse(data)
      })
      .catch(() => {
        if (active) {
          showToast({ title: 'Error', description: 'Failed to load course', variant: 'destructive' })
          navigate('/dashboard')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [code, navigate])

  if (loading || !code) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!course) {
    return (
      <div className="text-center">
        <p>Course not found</p>
        <Button onClick={() => navigate('/dashboard')}>Go Back</Button>
      </div>
    )
  }

  const engineUnlocked = journey.engineUnlocked
  const currentPhase: WizardPhase = /\/engine(\/|$)/.test(location.pathname) ? 'engine' : 'architect'

  // Derive the active layer id from the URL so the rail can highlight it.
  const architectMatch = location.pathname.match(/\/architect\/([^/]+)/)
  const engineMatch = location.pathname.match(/\/engine\/([^/]+)/)
  const activeStepId = engineMatch
    ? `engine-${engineMatch[1]}`
    : architectMatch
      ? architectMatch[1]
      : undefined

  // Gate the rail's engine steps: once the engine phase is unlocked, each stage
  // stays locked until the layer before it is approved; approved layers show as
  // done. (engineSteps[i] is layer i+1, so its predecessor is index i-1.)
  const engineApprovedByLayer = [
    engineApprovals.layer1,
    engineApprovals.layer2,
    engineApprovals.layer3,
    engineApprovals.layer4,
  ]
  const gatedEngineSteps = journey.engineSteps.map((step, i) => {
    if (!engineUnlocked) return step
    const approved = engineApprovedByLayer[i] ?? false
    const prevApproved = i === 0 ? true : (engineApprovedByLayer[i - 1] ?? false)
    let status = step.status
    if (approved) status = 'done'
    else if (!prevApproved) status = 'locked'
    return status === step.status ? step : { ...step, status }
  })

  const intake: IntakeSummaryProps = {
    title: course.title,
    code: course.course_code,
    description: course.description,
    creditHours: course.credit_hours,
    hours: course.contract?.course_metadata.hours,
    clos: course.clos ?? [],
    assessments: course.snapshot?.assessments ?? [],
    weeklyPlan: course.snapshot?.weekly_plan ?? [],
    references: course.snapshot?.references ?? [],
    accreditationTags: course.contract?.course_metadata.accreditation_tags ?? [],
    assessmentStrategy: course.contract?.assessment_strategy,
  }

  // Landing target: resume in the engine if unlocked, else the architect frontier.
  const architectLanding = `architect/${journey.architectFrontierId ?? journey.architectSteps[0]?.id ?? ''}`
  const indexTarget = engineUnlocked ? `engine/${journey.engineFrontierLayer}` : architectLanding

  return (
    <div className="space-y-5">
      {/* Course header */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')} className="mb-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
        <p className="text-fine-print font-medium uppercase tracking-wider text-primary">
          {course.course_code}
        </p>
        <h1 className="font-display text-2xl font-semibold text-foreground">{course.title}</h1>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        <aside className="lg:sticky lg:top-[68px] lg:h-fit lg:w-[220px] lg:shrink-0">
          <div className="glass-strong rounded-xl p-3">
            <JourneyRail
              courseCode={course.course_code}
              currentPhase={currentPhase}
              architectSteps={journey.architectSteps}
              engineSteps={gatedEngineSteps}
              architectComplete={journey.architectComplete}
              engineUnlocked={engineUnlocked}
              activeStepId={activeStepId}
            />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {journey.loading && journey.architectSteps.length === 0 ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <Routes>
              <Route index element={<Navigate to={indexTarget} replace />} />
              <Route path="architect" element={<Navigate to={architectLanding} replace />} />
              <Route
                path="architect/:layerId"
                element={
                  <ArchitectScreen
                    courseCode={course.course_code}
                    journey={journey}
                    intake={intake}
                    alignmentFetchSignal={alignmentFetchSignal}
                    alignmentAutoProposeSignal={alignmentAutoProposeSignal}
                    onAlignmentFetch={bumpAlignmentFetch}
                    onAlignmentAutoPropose={bumpAlignmentAutoPropose}
                    onArchitectAllApproved={setArchitectAllApproved}
                  />
                }
              />
              <Route
                path="engine"
                element={<Navigate to={`engine/${journey.engineFrontierLayer}`} replace />}
              />
              <Route
                path="engine/:layerNum"
                element={
                  <EngineScreen
                    courseCode={course.course_code}
                    journey={journey}
                    alignmentFetchSignal={alignmentFetchSignal}
                    onEngineApprovalsChange={setEngineApprovals}
                  />
                }
              />
              <Route path="*" element={<Navigate to={indexTarget} replace />} />
            </Routes>
          )}
        </div>
      </div>
    </div>
  )
}
