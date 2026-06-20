import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom'
import { ArrowLeft, Boxes, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { showToast } from '@/components/ui/Toaster'
import { fetchCourse, type CourseDetail as CourseDetailType } from '@/services/api'
import Stage1Layers from '@/components/Stage1Layers'
import NodeEnginePanel from '@/components/nodeEngine/NodeEnginePanel'
import JourneyRail from './JourneyRail'
import WizardStepShell from './WizardStepShell'
import WizardActionBar from './WizardActionBar'
import { useCourseJourney, type WizardPhase } from './useCourseJourney'
import type { StageStep } from './StageStepper'

/**
 * The routed Course Architect → Node Engine wizard shell. Owns the course data,
 * the persistent journey rail, and phase-level routing. Each phase renders the
 * existing engine panels inside the shared step chrome (breadcrumb, dots stepper,
 * sticky action bar) so the design language is identical end-to-end.
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

  const journey = useCourseJourney(code)

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

  const engineUnlocked = journey.architectComplete && journey.nodeGenReady
  const defaultPhase: WizardPhase = engineUnlocked ? 'engine' : 'architect'
  const currentPhase: WizardPhase = location.pathname.endsWith('/engine') ? 'engine' : 'architect'

  const intake = {
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

  const architectStep: StageStep | undefined = journey.architectSteps.find((s) => s.status === 'current')
  const goEngine = () => navigate(`/courses/${encodeURIComponent(code)}/engine`)
  const goArchitect = () => navigate(`/courses/${encodeURIComponent(code)}/architect`)

  const architectPhase = (
    <>
      <WizardStepShell
        breadcrumb={[{ label: 'Course Architect' }, { label: architectStep?.label ?? 'Layers' }]}
        counter={`Phase 1 of 2 · ${journey.architectSteps.filter((s) => s.status === 'done').length}/${journey.architectSteps.length} approved`}
        title="Course Architect"
        subtitle="Prepare the approved academic structure. Complete each layer in order, then activate reference alignment."
        statusBadge={
          journey.architectComplete
            ? { label: 'Complete', tone: 'approved' }
            : { label: 'In progress', tone: 'running' }
        }
        steps={journey.architectSteps.map((s) => ({ id: s.id, label: s.label, status: s.status }))}
      >
        <Stage1Layers
          courseCode={course.course_code}
          onAllApproved={(v) => {
            setArchitectAllApproved(v)
            void journey.refresh()
          }}
          onAlignmentAutoPropose={() => {
            setAlignmentAutoProposeSignal((n) => n + 1)
            setAlignmentFetchSignal((n) => n + 1)
          }}
          onReferenceUploaded={() => {
            setAlignmentAutoProposeSignal((n) => n + 1)
            setAlignmentFetchSignal((n) => n + 1)
          }}
          alignmentFetchSignal={alignmentFetchSignal}
          alignmentAutoProposeSignal={alignmentAutoProposeSignal}
          onAlignmentApproved={() => {
            setAlignmentFetchSignal((n) => n + 1)
            void journey.refresh()
          }}
          intake={intake}
        />
      </WizardStepShell>
      <WizardActionBar
        primary={{
          label: 'Continue to Node Engine',
          onClick: goEngine,
          disabled: !engineUnlocked,
          icon: <ChevronRight className="h-4 w-4" />,
        }}
        hint={
          !engineUnlocked
            ? 'Approve all six layers and activate reference alignment to unlock the Node Engine.'
            : undefined
        }
      />
    </>
  )

  const enginePhase = (
    <>
      <WizardStepShell
        breadcrumb={[{ label: 'Node Engine' }]}
        counter="Phase 2 of 2"
        title="Maestro Node Engine"
        subtitle="Turn each approved subtopic into governed adaptive learning nodes. Approve each layer to unlock the next."
        statusBadge={
          engineUnlocked ? { label: 'Available', tone: 'running' } : { label: 'Locked', tone: 'locked' }
        }
        steps={journey.engineSteps.map((s) => ({ id: s.id, label: s.label, status: s.status }))}
      >
        {engineUnlocked ? (
          <NodeEnginePanel courseCode={course.course_code} alignmentFetchSignal={alignmentFetchSignal} />
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
            <Boxes className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-caption font-medium text-foreground">Node Engine is locked</p>
            <p className="mt-1 max-w-md text-fine-print text-muted-foreground">
              Complete all six Course Architect layers and activate reference alignment to begin
              node generation.
            </p>
            <Button className="mt-4" onClick={goArchitect}>
              Go to Course Architect
            </Button>
          </div>
        )}
      </WizardStepShell>
      <WizardActionBar
        back={{ label: 'Back to Course Architect', onClick: goArchitect }}
      />
    </>
  )

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

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="lg:sticky lg:top-[68px] lg:h-fit lg:w-[264px] lg:shrink-0">
          <div className="rounded-xl border border-border bg-card p-3">
            <JourneyRail
              courseCode={course.course_code}
              currentPhase={currentPhase}
              architectSteps={journey.architectSteps}
              engineSteps={journey.engineSteps}
              architectComplete={journey.architectComplete}
              engineUnlocked={engineUnlocked}
            />
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <Routes>
            <Route index element={<Navigate to={defaultPhase} replace />} />
            <Route path="architect" element={architectPhase} />
            <Route path="engine" element={enginePhase} />
            <Route path="*" element={<Navigate to="architect" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}
