import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { Markdown } from '@/components/ui/Markdown'
import { mdBtn, mdBtnSoft } from '@/components/ui/materialButton'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { showToast } from '@/components/ui/Toaster'
import {
  fetchStage1Layers,
  runStage1Layer,
  approveStage1Layer,
  rejectStage1Layer,
  fetchAlignment,
  listReferences,
  type Stage1LayerStateView,
  type StageExecutionMode,
} from '@/services/api'
import { Loader2, ChevronDown, ChevronRight, Check, Lock, Play, RefreshCw, Eye, EyeOff, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import CLORefinementEditor from '@/components/CLORefinementEditor'
import AssessmentRedesignEditor from '@/components/AssessmentRedesignEditor'
import Layer4WeightingRubricEditor from '@/components/Layer4WeightingRubricEditor'
import Layer5IntegrityEditor from '@/components/Layer5IntegrityEditor'
import Layer6SubtopicEditor from '@/components/Layer6SubtopicEditor'
import IntakeSummaryView, { type IntakeSummaryProps } from '@/components/IntakeSummaryView'
import ReferenceCoveragePanel from '@/components/ReferenceCoveragePanel'
import ReferenceAlignmentPanel from '@/components/ReferenceAlignmentPanel'
import type {
  CloRefinementReviewSummary,
  AssessmentRedesignReviewSummary,
  WeightingRubricReviewSummary,
  IntegrityReviewReviewSummary,
  SubtopicArchitectureReviewSummary,
} from '@/services/api'

function FormattedReport({ markdown }: { markdown: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <Markdown>{markdown}</Markdown>
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not Started',
  locked: 'Locked',
  running: 'Running',
  generated: 'Generated',
  needs_review: 'Needs SME Review',
  approved: 'Approved',
  needs_revision: 'Needs Revision',
  blocked: 'Blocked',
}

function statusColor(status: string): string {
  switch (status) {
    case 'approved':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    case 'needs_review':
    case 'generated':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    case 'running':
      return 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
    case 'locked':
      return 'bg-muted text-muted-foreground'
    case 'blocked':
    case 'needs_revision':
      return 'bg-red-500/15 text-red-600 dark:text-red-400'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

/**
 * Snapshot of a solo (wizard) layer's primary actions, lifted to the shell so
 * the sticky WizardActionBar can render Approve / Regenerate alongside the
 * existing "Next layer" navigation. Currently published only for Layer 2.
 */
export interface SoloLayerActions {
  layerId: string
  approved: boolean
  canApprove: boolean
  approve: () => void
  canRegenerate: boolean
  isRunning: boolean
  hasOutput: boolean
  regenerate: () => void
  /** Layer 2 only: whether the SME has approved reference coverage. */
  coverageConfirmed: boolean
  /** Layer 2 only: why Approve is disabled (CLOs pending, unsaved, or coverage). */
  approveHint?: string
}

interface Stage1LayersProps {
  courseCode: string
  onAllApproved?: (allApproved: boolean) => void
  /** Wizard mode: publishes the solo layer's Approve/Regenerate actions to the shell. */
  onSoloActionsChange?: (actions: SoloLayerActions | null) => void
  /** Called after Layer 6 approval to auto-preview alignment tags. */
  onAlignmentAutoPropose?: () => void
  /** Called when a reference document is uploaded (any layer). */
  onReferenceUploaded?: () => void
  /** Increment to refetch alignment readiness (no auto-preview). */
  alignmentFetchSignal?: number
  /** Increment to auto-preview alignment tags (reference upload / Layer 6 only). */
  alignmentAutoProposeSignal?: number
  /** Called once alignment tags are activated — page can scroll to Node Engine. */
  onAlignmentApproved?: () => void
  intake?: IntakeSummaryProps
  /** Wizard mode: render ONLY this layer as a focused step (others hidden). */
  soloLayerId?: string
  /** Wizard mode: forward navigation routes instead of expanding in-place. */
  onNavigateLayer?: (layerId: string) => void
  /** Fired when uploaded/linked grounding-doc count changes. */
  onReferenceDocsCountChange?: (count: number) => void
}

export default function Stage1Layers({
  courseCode,
  onAllApproved,
  onSoloActionsChange,
  onAlignmentAutoPropose,
  onReferenceUploaded,
  alignmentFetchSignal = 0,
  alignmentAutoProposeSignal = 0,
  onAlignmentApproved,
  intake,
  soloLayerId,
  onNavigateLayer,
  onReferenceDocsCountChange,
}: Stage1LayersProps) {
  const [layers, setLayers] = useState<Stage1LayerStateView[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [viewingReportId, setViewingReportId] = useState<string | null>(null)
  const [layer2HasChanges, setLayer2HasChanges] = useState(false)
  const [layer2Summary, setLayer2Summary] = useState<CloRefinementReviewSummary | null>(null)
  // SME has measured + signed off on reference coverage (gates Layer 2 approval).
  const [layer2CoverageConfirmed, setLayer2CoverageConfirmed] = useState(false)
  const [layer3HasChanges, setLayer3HasChanges] = useState(false)
  const [layer3Summary, setLayer3Summary] = useState<AssessmentRedesignReviewSummary | null>(null)
  const [layer4HasChanges, setLayer4HasChanges] = useState(false)
  const [layer4Summary, setLayer4Summary] = useState<WeightingRubricReviewSummary | null>(null)
  const [layer5HasChanges, setLayer5HasChanges] = useState(false)
  const [layer5Summary, setLayer5Summary] = useState<IntegrityReviewReviewSummary | null>(null)
  const [layer6HasChanges, setLayer6HasChanges] = useState(false)
  const [layer6Summary, setLayer6Summary] = useState<SubtopicArchitectureReviewSummary | null>(null)
  const layerRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const referenceAlignmentRef = useRef<HTMLDivElement | null>(null)
  const [nodeGenReady, setNodeGenReady] = useState(false)
  const coverageRef = useRef<HTMLDivElement | null>(null)
  const autoRunAttempted = useRef<Set<string>>(new Set())
  // Bumped whenever a reference is ingested (Layer 1 intake) so the sibling
  // Reference Coverage panel auto-re-runs and surfaces before/after deltas.
  const [coverageRefreshSignal, setCoverageRefreshSignal] = useState(0)
  const [referenceDocsCount, setReferenceDocsCount] = useState(0)
  // Layer 2 regenerate is triggered from inside the CLO editor; this confirms it.
  const [confirmRegenLayer2, setConfirmRegenLayer2] = useState(false)
  // Layer 3 regenerate is triggered from inside the assessment editor; this confirms it.
  const [confirmRegenLayer3, setConfirmRegenLayer3] = useState(false)

  const refreshReferenceDocsCount = useCallback(async () => {
    try {
      const docs = await listReferences(courseCode)
      setReferenceDocsCount(docs.length)
      onReferenceDocsCountChange?.(docs.length)
    } catch {
      // Non-fatal: the intake panel itself also publishes this count when loaded.
    }
  }, [courseCode, onReferenceDocsCountChange])

  // When a layer is expanded, bring its header to the top of the viewport so the
  // newly revealed content opens in place instead of leaving the user scrolled away.
  // Defer until after the layout settles (e.g. when approving a layer collapses a
  // large editor above the target) so the scroll lands on the correct layer.
  useEffect(() => {
    // In wizard (solo) mode each layer is its own full page, so the shell scrolls
    // to the very top on navigation. The per-layer scroll below is only for the
    // legacy stacked-list view where expanding one layer should bring it into view.
    if (!expandedId || soloLayerId) return
    const scrollToLayer = () => {
      const el = layerRefs.current[expandedId]
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'start' })
      }
    }
    // Re-scroll while the previous layer collapses and the new layer's
    // editor mounts/loads/grows, so we reliably land on the target layer.
    const raf = requestAnimationFrame(scrollToLayer)
    const timers = [120, 300, 550, 800].map((ms) => setTimeout(scrollToLayer, ms))
    return () => {
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
    }
  }, [expandedId, soloLayerId])

  // Auto-run a layer the first time it is opened and has no output yet.
  // Manual Run/Regenerate still handles every later run. Remove this whole
  // block to revert to button-only behavior.
  useEffect(() => {
    if (!expandedId) return
    const layer = layers.find((l) => l.layerId === expandedId)
    if (!layer) return
    const runnable =
      layer.canRun &&
      !layer.reportMarkdown &&
      layer.status !== 'running' &&
      layer.status !== 'approved' &&
      !layer.error &&
      runningId !== layer.layerId
    if (runnable && !autoRunAttempted.current.has(layer.layerId)) {
      autoRunAttempted.current.add(layer.layerId)
      void handleRun(layer.layerId)
    }
  }, [expandedId, layers, runningId])

  const loadLayers = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchStage1Layers(courseCode)
      setLayers(data.layers)
      const layersApproved = data.layers.length > 0 && data.layers.every((l) => l.status === 'approved')
      if (layersApproved) {
        try {
          const alignment = await fetchAlignment(courseCode)
          setNodeGenReady(alignment.state.node_gen_ready)
          onAllApproved?.(alignment.state.node_gen_ready)
        } catch {
          setNodeGenReady(false)
          onAllApproved?.(false)
        }
      } else {
        setNodeGenReady(false)
        onAllApproved?.(false)
      }
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load Course Architect layers',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [courseCode, onAllApproved])

  const refreshAlignmentReadiness = useCallback(async () => {
    const layersApproved = layers.length > 0 && layers.every((l) => l.status === 'approved')
    if (!layersApproved) {
      setNodeGenReady(false)
      onAllApproved?.(false)
      return
    }
    try {
      const alignment = await fetchAlignment(courseCode)
      setNodeGenReady(alignment.state.node_gen_ready)
      onAllApproved?.(alignment.state.node_gen_ready)
    } catch {
      setNodeGenReady(false)
      onAllApproved?.(false)
    }
  }, [courseCode, layers, onAllApproved])

  useEffect(() => {
    if (alignmentFetchSignal > 0) void refreshAlignmentReadiness()
  }, [alignmentFetchSignal, refreshAlignmentReadiness])

  // Load once per course. We intentionally depend on `courseCode` (not the
  // `loadLayers` identity) so that an unstable `onAllApproved` callback from a
  // parent — which `loadLayers` invokes and which may itself trigger a parent
  // re-render — cannot create an infinite fetch loop. A ref keeps the latest
  // implementation without re-running the effect.
  const loadLayersRef = useRef(loadLayers)
  useEffect(() => {
    loadLayersRef.current = loadLayers
  }, [loadLayers])
  useEffect(() => {
    void loadLayersRef.current()
  }, [courseCode])
  useEffect(() => {
    void refreshReferenceDocsCount()
  }, [refreshReferenceDocsCount])

  // Wizard solo mode: keep the rendered layer expanded so its editor + auto-run
  // and scroll effects behave exactly as in the accordion.
  useEffect(() => {
    if (soloLayerId && expandedId !== soloLayerId) setExpandedId(soloLayerId)
  }, [soloLayerId, expandedId])

  // Forward navigation: route between layer screens in wizard mode, otherwise
  // expand the target layer in-place (legacy accordion behavior).
  const goToLayer = useCallback(
    (layerId: string) => {
      if (onNavigateLayer) onNavigateLayer(layerId)
      else setExpandedId(layerId)
    },
    [onNavigateLayer]
  )

  async function handleRun(layerId: string, execution?: StageExecutionMode) {
    try {
      setRunningId(layerId)
      const result = await runStage1Layer(courseCode, layerId, execution)
      setLayers(result.layers)
      const layersApproved = result.layers.every((l) => l.status === 'approved')
      if (layersApproved) void refreshAlignmentReadiness()
      else onAllApproved?.(false)
      setExpandedId(layerId)
      showToast({
        title: result.success ? 'Layer complete' : 'Layer failed',
        description: result.success ? 'Review the output and approve when ready.' : 'See layer error details.',
        variant: result.success ? 'success' : 'destructive',
      })
    } catch (error) {
      showToast({
        title: 'Run failed',
        description: error instanceof Error ? error.message : 'Failed to run layer',
        variant: 'destructive',
      })
    } finally {
      setRunningId(null)
      await loadLayers()
    }
  }

  async function handleApprove(layerId: string, options?: { skipUnsavedCheck?: boolean }) {
    if (layerId === 'layer1-intake' && referenceDocsCount === 0) {
      showToast({
        title: 'Reference required',
        description: 'Upload or link at least one grounding reference before approving Layer 1.',
        variant: 'destructive',
      })
      return false
    }
    if (layerId === 'layer2-clo-review') {
      if (layer2HasChanges && !options?.skipUnsavedCheck) {
        showToast({
          title: 'Save required',
          description: 'Save CLO refinements before approving Layer 2.',
          variant: 'destructive',
        })
        return false
      }
      if (layer2Summary && !layer2Summary.all_approved) {
        showToast({
          title: 'CLO approvals required',
          description: `Approve each CLO before approving Layer 2 (${layer2Summary.pending_count} pending, ${layer2Summary.needs_revision_count} need revision).`,
          variant: 'destructive',
        })
        return false
      }
      if (!layer2CoverageConfirmed) {
        showToast({
          title: 'Coverage approval required',
          description: 'Measure and approve reference coverage before approving Layer 2.',
          variant: 'destructive',
        })
        return false
      }
    }
    if (layerId === 'layer3-assessment-redesign') {
      if (layer3HasChanges && !options?.skipUnsavedCheck) {
        showToast({
          title: 'Save required',
          description: 'Save assessment redesigns before approving Layer 3.',
          variant: 'destructive',
        })
        return false
      }
      if (layer3Summary && !layer3Summary.all_approved) {
        showToast({
          title: 'Assessment approvals required',
          description: `Approve each assessment before approving Layer 3 (${layer3Summary.pending_count} pending, ${layer3Summary.needs_revision_count} need revision).`,
          variant: 'destructive',
        })
        return false
      }
    }
    if (layerId === 'layer4-weighting-rubric') {
      if (layer4HasChanges && !options?.skipUnsavedCheck) {
        showToast({
          title: 'Save required',
          description: 'Save the weighting and rubric decisions before approving Layer 4.',
          variant: 'destructive',
        })
        return false
      }
      if (layer4Summary && !layer4Summary.all_approved) {
        showToast({
          title: 'Layer 4 not ready',
          description: !layer4Summary.weighting_decided
            ? 'Complete the course-level weighting decision (weights must total 100%) first.'
            : `Approve each assessment structure before approving Layer 4 (${layer4Summary.pending_count} pending, ${layer4Summary.needs_revision_count} need revision).`,
          variant: 'destructive',
        })
        return false
      }
    }
    if (layerId === 'layer5-integrity-ai') {
      if (layer5HasChanges && !options?.skipUnsavedCheck) {
        showToast({
          title: 'Save required',
          description: 'Save the integrity decisions before approving Layer 5.',
          variant: 'destructive',
        })
        return false
      }
      if (layer5Summary && !layer5Summary.all_approved) {
        showToast({
          title: 'Layer 5 not ready',
          description: `Approve each assessment integrity design before approving Layer 5 (${layer5Summary.pending_count} pending, ${layer5Summary.needs_revision_count} need revision).`,
          variant: 'destructive',
        })
        return false
      }
    }
    if (layerId === 'layer6-subtopic-architecture') {
      if (layer6HasChanges && !options?.skipUnsavedCheck) {
        showToast({
          title: 'Save required',
          description: 'Save the subtopic decisions before approving Layer 6.',
          variant: 'destructive',
        })
        return false
      }
      if (layer6Summary && !layer6Summary.all_approved) {
        showToast({
          title: 'Layer 6 not ready',
          description: `Approve every subtopic before approving Layer 6 (${layer6Summary.pending_count} pending, ${layer6Summary.needs_revision_count} need revision).`,
          variant: 'destructive',
        })
        return false
      }
    }
    try {
      const result = await approveStage1Layer(courseCode, layerId)
      setLayers(result.layers)
      const layersApproved = result.layers.every((l) => l.status === 'approved')
      let alignmentReady = false
      if (layersApproved) {
        try {
          const alignment = await fetchAlignment(courseCode)
          alignmentReady = alignment.state.node_gen_ready
          setNodeGenReady(alignmentReady)
          onAllApproved?.(alignmentReady)
        } catch {
          setNodeGenReady(false)
          onAllApproved?.(false)
        }
      } else {
        setNodeGenReady(false)
        onAllApproved?.(false)
      }
      showToast({
        title: 'Approved',
        description:
          layersApproved && alignmentReady
            ? 'Course Architect complete — alignment active. You can proceed to the Node Engine.'
            : layersApproved
              ? 'All six layers approved. Complete Reference Alignment (Step B) to unlock node generation.'
              : 'Layer approved. Next layer unlocked.',
        variant: 'success',
      })
      return true
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to approve',
        variant: 'destructive',
      })
      return false
    }
  }

  async function handleApproveLayer2AndContinue() {
    const approved = await handleApprove('layer2-clo-review', { skipUnsavedCheck: true })
    if (approved) {
      goToLayer('layer3-assessment-redesign')
    }
  }

  async function handleApproveLayer3AndContinue() {
    const approved = await handleApprove('layer3-assessment-redesign', { skipUnsavedCheck: true })
    if (approved) {
      goToLayer('layer4-weighting-rubric')
    }
  }

  async function handleApproveLayer4AndContinue() {
    const approved = await handleApprove('layer4-weighting-rubric', { skipUnsavedCheck: true })
    if (approved) {
      goToLayer('layer5-integrity-ai')
    }
  }

  async function handleApproveLayer5AndContinue() {
    const approved = await handleApprove('layer5-integrity-ai', { skipUnsavedCheck: true })
    if (approved) {
      goToLayer('layer6-subtopic-architecture')
    }
  }

  async function handleApproveLayer6AndContinue() {
    const approved = await handleApprove('layer6-subtopic-architecture', { skipUnsavedCheck: true })
    if (approved) {
      onAlignmentAutoPropose?.()
    }
  }

  async function handleReject(layerId: string) {
    try {
      const result = await rejectStage1Layer(courseCode, layerId)
      setLayers(result.layers)
      showToast({ title: 'Marked for revision', variant: 'default' })
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to reject',
        variant: 'destructive',
      })
    }
  }

  // Keep the latest handler closures reachable from the published solo actions
  // so the publish effect can depend on primitive state only (no re-publish loop).
  const handleApproveRef = useRef(handleApprove)
  const handleRunRef = useRef(handleRun)
  const handleApproveLayer2AndContinueRef = useRef(handleApproveLayer2AndContinue)
  const handleApproveLayer3AndContinueRef = useRef(handleApproveLayer3AndContinue)
  const handleApproveLayer6AndContinueRef = useRef(handleApproveLayer6AndContinue)
  handleApproveLayer2AndContinueRef.current = handleApproveLayer2AndContinue
  handleApproveLayer3AndContinueRef.current = handleApproveLayer3AndContinue
  handleApproveLayer6AndContinueRef.current = handleApproveLayer6AndContinue
  handleApproveRef.current = handleApprove
  handleRunRef.current = handleRun

  // Publish Layer 2's Approve/Regenerate state to the wizard shell so the sticky
  // WizardActionBar can own them, mirroring the "Next layer" placement.
  useEffect(() => {
    if (!onSoloActionsChange) return
    if (soloLayerId === 'layer2-clo-review') {
      const layer = layers.find((l) => l.layerId === 'layer2-clo-review')
      if (!layer) {
        onSoloActionsChange(null)
        return
      }
      const running = runningId === 'layer2-clo-review'
      const staleRunning = layer.status === 'running' && !running
      const allClosApproved = !!layer2Summary?.all_approved
      // Approve requires: all CLOs approved + saved + SME signed off on coverage.
      const canApprove =
        !!layer.canApprove && allClosApproved && !layer2HasChanges && layer2CoverageConfirmed
      let approveHint: string | undefined
      if (!canApprove && layer.status !== 'approved') {
        if (layer2HasChanges) approveHint = 'Save CLO refinements before approving.'
        else if (!allClosApproved) approveHint = 'Approve every CLO refinement below to enable approval.'
        else if (!layer2CoverageConfirmed)
          approveHint = 'Measure and approve reference coverage below to enable approval.'
      }
      onSoloActionsChange({
        layerId: 'layer2-clo-review',
        approved: layer.status === 'approved',
        canApprove,
        approve: () => void handleApproveLayer2AndContinueRef.current(),
        canRegenerate: layer.canRun || staleRunning,
        isRunning: running,
        hasOutput: !!layer.reportMarkdown,
        regenerate: () => void handleRunRef.current('layer2-clo-review'),
        coverageConfirmed: layer2CoverageConfirmed,
        approveHint,
      })
      return
    }
    if (soloLayerId === 'layer3-assessment-redesign') {
      const layer = layers.find((l) => l.layerId === 'layer3-assessment-redesign')
      if (!layer) {
        onSoloActionsChange(null)
        return
      }
      const running = runningId === 'layer3-assessment-redesign'
      const staleRunning = layer.status === 'running' && !running
      const allApproved = !!layer3Summary?.all_approved
      const canApprove = !!layer.canApprove && allApproved && !layer3HasChanges
      let approveHint: string | undefined
      if (!canApprove && layer.status !== 'approved') {
        if (layer3HasChanges) approveHint = 'Save assessment redesigns before approving.'
        else if (!allApproved) approveHint = 'Approve every assessment below to enable approval.'
      }
      onSoloActionsChange({
        layerId: 'layer3-assessment-redesign',
        approved: layer.status === 'approved',
        canApprove,
        approve: () => void handleApproveLayer3AndContinueRef.current(),
        canRegenerate: layer.canRun || staleRunning,
        isRunning: running,
        hasOutput: !!layer.reportMarkdown,
        regenerate: () => void handleRunRef.current('layer3-assessment-redesign'),
        coverageConfirmed: true,
        approveHint,
      })
      return
    }
    if (soloLayerId === 'layer6-subtopic-architecture') {
      const layer = layers.find((l) => l.layerId === 'layer6-subtopic-architecture')
      if (!layer) {
        onSoloActionsChange(null)
        return
      }
      const running = runningId === 'layer6-subtopic-architecture'
      const staleRunning = layer.status === 'running' && !running
      const allApproved = !!layer6Summary?.all_approved
      const canApprove = !!layer.canApprove && allApproved && !layer6HasChanges
      let approveHint: string | undefined
      if (!canApprove && layer.status !== 'approved') {
        if (layer6HasChanges) approveHint = 'Save subtopic changes before approving.'
        else if (!allApproved) approveHint = 'Approve every subtopic below to enable approval.'
      }
      onSoloActionsChange({
        layerId: 'layer6-subtopic-architecture',
        approved: layer.status === 'approved',
        canApprove,
        approve: () => void handleApproveLayer6AndContinueRef.current(),
        canRegenerate: layer.canRun || staleRunning,
        isRunning: running,
        hasOutput: !!layer.reportMarkdown,
        regenerate: () => void handleRunRef.current('layer6-subtopic-architecture'),
        coverageConfirmed: true,
        approveHint,
      })
      return
    }
    onSoloActionsChange(null)
  }, [
    onSoloActionsChange,
    soloLayerId,
    layers,
    layer2Summary,
    layer2HasChanges,
    layer2CoverageConfirmed,
    layer3Summary,
    layer3HasChanges,
    layer6Summary,
    layer6HasChanges,
    runningId,
  ])

  // Clear published actions when the layers view unmounts.
  useEffect(() => () => onSoloActionsChange?.(null), [onSoloActionsChange])

  if (loading && layers.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const allLayersApproved = layers.length > 0 && layers.every((l) => l.status === 'approved')
  const architectComplete = allLayersApproved && nodeGenReady
  const solo = !!soloLayerId
  const visibleLayers = solo ? layers.filter((l) => l.layerId === soloLayerId) : layers

  const layersList = (
    <div className="md-scope space-y-3">
        {visibleLayers.map((layer) => {
          const open = solo ? layer.layerId === soloLayerId : expandedId === layer.layerId
          const clientRunning = runningId === layer.layerId
          // Server says "running" but this client did not start it -> stale (e.g. interrupted run)
          const staleRunning = layer.status === 'running' && !clientRunning
          const isRunning = clientRunning
          // Any running state we should surface with an animated indicator. Stale
          // server-running (interrupted) is handled separately with a regenerate hint.
          const showRunning = clientRunning
          const showRunButton = layer.canRun || staleRunning

          // Once a layer is approved, surface a "continue" affordance to the next
          // not-yet-approved layer so the frontier layer (e.g. Layer 5 -> Layer 6)
          // always has the same forward navigation the approve-and-continue buttons
          // provide at approval time. In the wizard (solo) view the sticky
          // WizardActionBar already owns "Next layer" navigation, so this in-card
          // affordance would be redundant — only show it in the legacy list view.
          const layerIndex = layers.findIndex((l) => l.layerId === layer.layerId)
          const nextLayer = layerIndex >= 0 ? layers[layerIndex + 1] : undefined
          const showContinueToNext =
            !solo && layer.status === 'approved' && !!nextLayer && nextLayer.status !== 'approved'
          const layer1BlockedByMissingReferences =
            layer.layerId === 'layer1-intake' && referenceDocsCount === 0

          const actionButtons = (
            <div className="flex flex-wrap gap-2">
              {showContinueToNext && nextLayer && (
                <button
                  type="button"
                  onClick={() => goToLayer(nextLayer.layerId)}
                  disabled={layer1BlockedByMissingReferences}
                  className={cn(mdBtn, 'group order-first')}
                >
                  Continue to Layer {nextLayer.config.order}
                  <ChevronRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </button>
              )}
              {layer1BlockedByMissingReferences && (
                <p className="w-full rounded-md bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">
                  Add at least one grounding reference to unlock approval and continue.
                </p>
              )}
              {staleRunning && (
                <p className="w-full rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
                  This layer was left in a running state (the previous run may have been interrupted). You can
                  regenerate it.
                </p>
              )}
              {layer.canApprove &&
                layer.layerId !== 'layer4-weighting-rubric' &&
                layer.layerId !== 'layer5-integrity-ai' &&
                layer.layerId !== 'layer6-subtopic-architecture' &&
                !(solo && layer.layerId === 'layer2-clo-review') &&
                !(solo && layer.layerId === 'layer3-assessment-redesign') && (
                  <button
                    type="button"
                    className={mdBtn}
                    disabled={layer1BlockedByMissingReferences}
                    onClick={() => handleApprove(layer.layerId)}
                  >
                    <Check className="h-4 w-4" />
                    Approve
                  </button>
                )}
              {showRunButton &&
                !(solo && layer.layerId === 'layer2-clo-review') &&
                !(solo && layer.layerId === 'layer3-assessment-redesign') && (
                <button
                  type="button"
                  className={layer.status === 'approved' ? mdBtnSoft : mdBtn}
                  disabled={isRunning}
                  onClick={() => handleRun(layer.layerId)}
                >
                  {isRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : layer.reportMarkdown ? (
                    <RefreshCw className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {layer.reportMarkdown ? 'Regenerate' : 'Run'}
                </button>
              )}
              {(layer.status === 'needs_review' || layer.status === 'generated') && (
                <button type="button" className={mdBtnSoft} onClick={() => handleReject(layer.layerId)}>
                  <XCircle className="h-4 w-4" />
                  Request revision
                </button>
              )}
              {(layer.layerId === 'layer2-clo-review' ||
                layer.layerId === 'layer3-assessment-redesign' ||
                layer.layerId === 'layer4-weighting-rubric' ||
                layer.layerId === 'layer5-integrity-ai' ||
                layer.layerId === 'layer6-subtopic-architecture') &&
                layer.reportMarkdown && (
                  <button
                    type="button"
                    className={mdBtnSoft}
                    onClick={() =>
                      setViewingReportId((prev) => (prev === layer.layerId ? null : layer.layerId))
                    }
                  >
                    {viewingReportId === layer.layerId ? (
                      <>
                        <EyeOff className="h-4 w-4" />
                        Hide council report
                      </>
                    ) : (
                      <>
                        <Eye className="h-4 w-4" />
                        View council report
                      </>
                    )}
                  </button>
                )}
              {layer.layerId === 'layer1-intake' && intake && layer.reportMarkdown && (
                <button
                  type="button"
                  className={mdBtnSoft}
                  onClick={() =>
                    setViewingReportId((prev) => (prev === layer.layerId ? null : layer.layerId))
                  }
                >
                  {viewingReportId === layer.layerId ? (
                    <>
                      <EyeOff className="h-4 w-4" />
                      Hide raw summary
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4" />
                      View raw extraction summary
                    </>
                  )}
                </button>
              )}
            </div>
          )

          return (
            <Fragment key={layer.layerId}>
            <div
              ref={(el) => {
                layerRefs.current[layer.layerId] = el
              }}
              className={cn(
                'scroll-mt-4 md-card',
                layer.status === 'approved' && 'border-emerald-500/40'
              )}
            >
              {/* In-card header. Hidden in wizard (solo) mode because the
                  WizardStepShell already shows the layer title/status above. */}
              {!solo && (
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 p-4 text-left"
                  onClick={() => {
                    setExpandedId(open ? null : layer.layerId)
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {layer.config.order}. {layer.config.name}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          statusColor(showRunning ? 'running' : layer.status),
                          showRunning && 'animate-pulse'
                        )}
                      >
                        {showRunning ? (
                          <>
                            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                            Running…
                          </>
                        ) : (
                          <>
                            {layer.status === 'locked' && <Lock className="mr-1 inline h-3 w-3" />}
                            {STATUS_LABELS[layer.status] || layer.status}
                          </>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize">
                        {layer.config.mode === 'council' ? 'LLM Council' : 'Single Agent'}
                      </span>
                    </div>
                    {layer.layerId !== 'layer6-subtopic-architecture' && layer.config.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{layer.config.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Output: {layer.config.productOutput}
                    </p>
                  </div>
                  {open ? (
                    <ChevronDown className="h-5 w-5 shrink-0" />
                  ) : (
                    <ChevronRight className="h-5 w-5 shrink-0" />
                  )}
                </button>
              )}

              {open && (
                <div
                  className={cn(
                    'space-y-4 px-4 pb-4',
                    solo ? 'pt-4' : 'border-t border-border'
                  )}
                >
                  {layer.error && (
                    <p className="rounded-md bg-red-500/10 p-2 text-sm text-red-600">{layer.error}</p>
                  )}

                  {showRunning && (
                    <div className="mt-4 flex items-center gap-3 overflow-hidden rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                          Running {layer.config.mode === 'council' ? 'LLM Council' : 'AI agent'}…
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Generating {layer.config.productOutput}. This can take up to a minute — you can stay
                          on this step while it works.
                        </p>
                      </div>
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500/60" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
                      </span>
                    </div>
                  )}

                  {layer.layerId !== 'layer1-intake' && actionButtons}

                  {layer.layerId === 'layer2-clo-review' &&
                  (layer.reportMarkdown ||
                    layer.status === 'needs_review' ||
                    layer.status === 'generated' ||
                    layer.status === 'needs_revision' ||
                    layer.status === 'approved') ? (
                    <>
                      {viewingReportId === layer.layerId && layer.reportMarkdown && (
                        <FormattedReport markdown={layer.reportMarkdown} />
                      )}
                      <CLORefinementEditor
                        courseCode={courseCode}
                        layerApproved={layer.status === 'approved'}
                        layerHasOutput={
                          !!layer.reportMarkdown ||
                          layer.status === 'needs_review' ||
                          layer.status === 'approved'
                        }
                        reloadSignal={layer.generatedAt}
                        onRegenerate={() => setConfirmRegenLayer2(true)}
                        isRegenerating={runningId === 'layer2-clo-review'}
                        canRegenerate={layer.canRun || (layer.status === 'running' && runningId !== 'layer2-clo-review')}
                        onHasChanges={setLayer2HasChanges}
                        onSummaryChange={setLayer2Summary}
                        onSaved={() => loadLayers()}
                      />
                    </>
                  ) : layer.layerId === 'layer3-assessment-redesign' &&
                    (layer.reportMarkdown ||
                      layer.status === 'needs_review' ||
                      layer.status === 'generated' ||
                      layer.status === 'needs_revision' ||
                      layer.status === 'approved') ? (
                    <>
                      {viewingReportId === layer.layerId && layer.reportMarkdown && (
                        <FormattedReport markdown={layer.reportMarkdown} />
                      )}
                      <AssessmentRedesignEditor
                        courseCode={courseCode}
                        layerApproved={layer.status === 'approved'}
                        layerHasOutput={
                          !!layer.reportMarkdown ||
                          layer.status === 'needs_review' ||
                          layer.status === 'approved'
                        }
                        reloadSignal={layer.generatedAt}
                        onRegenerate={() => setConfirmRegenLayer3(true)}
                        isRegenerating={runningId === 'layer3-assessment-redesign'}
                        canRegenerate={layer.canRun || (layer.status === 'running' && runningId !== 'layer3-assessment-redesign')}
                        onHasChanges={setLayer3HasChanges}
                        onSummaryChange={setLayer3Summary}
                        onSaved={() => loadLayers()}
                      />
                    </>
                  ) : layer.layerId === 'layer4-weighting-rubric' &&
                    (layer.reportMarkdown ||
                      layer.status === 'needs_review' ||
                      layer.status === 'generated' ||
                      layer.status === 'needs_revision' ||
                      layer.status === 'approved') ? (
                    <>
                      {viewingReportId === layer.layerId && layer.reportMarkdown && (
                        <FormattedReport markdown={layer.reportMarkdown} />
                      )}
                      <Layer4WeightingRubricEditor
                        courseCode={courseCode}
                        layerApproved={layer.status === 'approved'}
                        layerHasOutput={
                          !!layer.reportMarkdown ||
                          layer.status === 'needs_review' ||
                          layer.status === 'approved'
                        }
                        onHasChanges={setLayer4HasChanges}
                        onSummaryChange={setLayer4Summary}
                        onSaved={() => loadLayers()}
                        onApproveAndContinue={handleApproveLayer4AndContinue}
                      />
                    </>
                  ) : layer.layerId === 'layer5-integrity-ai' &&
                    (layer.reportMarkdown ||
                      layer.status === 'needs_review' ||
                      layer.status === 'generated' ||
                      layer.status === 'needs_revision' ||
                      layer.status === 'approved') ? (
                    <>
                      {viewingReportId === layer.layerId && layer.reportMarkdown && (
                        <FormattedReport markdown={layer.reportMarkdown} />
                      )}
                      <Layer5IntegrityEditor
                        courseCode={courseCode}
                        layerApproved={layer.status === 'approved'}
                        layerHasOutput={
                          !!layer.reportMarkdown ||
                          layer.status === 'needs_review' ||
                          layer.status === 'approved'
                        }
                        onHasChanges={setLayer5HasChanges}
                        onSummaryChange={setLayer5Summary}
                        onSaved={() => loadLayers()}
                        onApproveAndContinue={handleApproveLayer5AndContinue}
                      />
                    </>
                  ) : layer.layerId === 'layer6-subtopic-architecture' &&
                    (layer.reportMarkdown ||
                      layer.status === 'needs_review' ||
                      layer.status === 'generated' ||
                      layer.status === 'needs_revision' ||
                      layer.status === 'approved') ? (
                    <>
                      {viewingReportId === layer.layerId && layer.reportMarkdown && (
                        <FormattedReport markdown={layer.reportMarkdown} />
                      )}
                      <Layer6SubtopicEditor
                        courseCode={courseCode}
                        layerApproved={layer.status === 'approved'}
                        layerHasOutput={
                          !!layer.reportMarkdown ||
                          layer.status === 'needs_review' ||
                          layer.status === 'approved'
                        }
                        onHasChanges={setLayer6HasChanges}
                        onSummaryChange={setLayer6Summary}
                        onSaved={() => loadLayers()}
                      />
                      {layer.status === 'approved' && (
                        <div ref={referenceAlignmentRef} className="scroll-mt-4 border-t border-border pt-4">
                          <ReferenceAlignmentPanel
                            embedded
                            courseCode={courseCode}
                            autoProposeSignal={alignmentAutoProposeSignal}
                            onAlignmentApproved={() => {
                              void refreshAlignmentReadiness()
                              onAlignmentApproved?.()
                            }}
                          />
                        </div>
                      )}
                    </>
                  ) : layer.layerId === 'layer1-intake' &&
                    intake &&
                    (layer.status === 'generated' ||
                      layer.status === 'needs_review' ||
                      layer.status === 'needs_revision' ||
                      layer.status === 'approved') ? (
                    <>
                      <IntakeSummaryView
                        {...intake}
                        onReferenceDocsCountChange={(count) => {
                          setReferenceDocsCount(count)
                          onReferenceDocsCountChange?.(count)
                        }}
                        onReferenceUploaded={() => {
                          setCoverageRefreshSignal((n) => n + 1)
                          void refreshReferenceDocsCount()
                          onReferenceUploaded?.()
                        }}
                      />
                      {viewingReportId === layer.layerId && layer.reportMarkdown && (
                        <FormattedReport markdown={layer.reportMarkdown} />
                      )}
                    </>
                  ) : (
                    layer.reportMarkdown && <FormattedReport markdown={layer.reportMarkdown} />
                  )}

                  {layer.layerId === 'layer1-intake' && (
                    <div className="border-t border-border pt-4">{actionButtons}</div>
                  )}

                  {!layer.reportMarkdown && layer.status !== 'locked' && layer.status !== 'running' && (
                    <p className="text-sm text-muted-foreground">No report yet. Run this layer to generate output.</p>
                  )}
                </div>
              )}
            </div>

            {/* Reference Coverage Check — read-only corpus-adequacy measurement
                that appears once CLO Refinement (Layer 2) is approved. It does
                NOT tag references or alter Reference Alignment. */}
            {layer.layerId === 'layer2-clo-review' &&
              (!!layer.reportMarkdown ||
                layer.status === 'needs_review' ||
                layer.status === 'generated' ||
                layer.status === 'needs_revision' ||
                layer.status === 'approved') && (
                <div ref={coverageRef} className="scroll-mt-4">
                  <ReferenceCoveragePanel
                    courseCode={courseCode}
                    refreshSignal={coverageRefreshSignal}
                    closApproved={!!layer2Summary?.all_approved}
                    onGateChange={setLayer2CoverageConfirmed}
                  />
                </div>
              )}
            </Fragment>
          )
        })}

      <Dialog open={confirmRegenLayer2} onOpenChange={setConfirmRegenLayer2}>
        <DialogContent className="md-scope">
          <DialogHeader>
            <DialogTitle>Regenerate CLO refinement?</DialogTitle>
            <DialogDescription>
              This re-runs the AI council and replaces the current CLO review, including any unsaved
              refinements. Approved CLOs reset to pending for re-review. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              className={cn(mdBtnSoft, 'px-4 py-2 text-sm')}
              onClick={() => setConfirmRegenLayer2(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={cn(mdBtn, 'px-4 py-2 text-sm')}
              onClick={() => {
                setConfirmRegenLayer2(false)
                void handleRun('layer2-clo-review')
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Regenerate
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRegenLayer3} onOpenChange={setConfirmRegenLayer3}>
        <DialogContent className="md-scope">
          <DialogHeader>
            <DialogTitle>Regenerate assessment redesign?</DialogTitle>
            <DialogDescription>
              This re-runs the AI council and replaces the current assessment redesigns, including any
              unsaved edits. Approved assessments reset to pending for re-review. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              className={cn(mdBtnSoft, 'px-4 py-2 text-sm')}
              onClick={() => setConfirmRegenLayer3(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className={cn(mdBtn, 'px-4 py-2 text-sm')}
              onClick={() => {
                setConfirmRegenLayer3(false)
                void handleRun('layer3-assessment-redesign')
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Regenerate
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )

  // Wizard solo mode: render just the focused layer (the shell supplies the
  // header/chrome). Legacy mode keeps the full accordion inside a titled Card.
  if (solo) return layersList

  return (
    <Card>
      <CardHeader>
        <CardTitle>Course Architect</CardTitle>
        <CardDescription>
          Complete all six layers in order, then Reference Alignment (Layer 6 Step B) to activate
          grounding tags — the Node Engine unlocks when alignment is active.
          {architectComplete && (
            <span className="ml-2 inline-flex items-center gap-1 text-emerald-600">
              <Check className="h-4 w-4" /> Course Architect complete
            </span>
          )}
          {allLayersApproved && !nodeGenReady && (
            <span className="ml-2 inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              Step B pending — activate alignment tags
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>{layersList}</CardContent>
    </Card>
  )
}
