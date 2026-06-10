import { useState, useEffect, useCallback, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { showToast } from '@/components/ui/Toaster'
import {
  fetchStage1Layers,
  runStage1Layer,
  approveStage1Layer,
  rejectStage1Layer,
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
      <div
        className={cn(
          'prose prose-sm dark:prose-invert max-w-none',
          'prose-headings:font-semibold prose-headings:text-foreground',
          'prose-h1:text-lg prose-h1:mb-3 prose-h1:pb-2 prose-h1:border-b prose-h1:border-border',
          'prose-h2:text-base prose-h2:mt-6 prose-h2:mb-2',
          'prose-h3:text-xs prose-h3:mt-4 prose-h3:mb-1 prose-h3:uppercase prose-h3:tracking-wide prose-h3:text-muted-foreground',
          'prose-p:leading-relaxed prose-li:my-0.5 prose-strong:text-foreground',
          'prose-table:text-sm prose-table:my-3',
          'prose-th:bg-muted/60 prose-th:p-2 prose-th:text-left prose-th:border prose-th:border-border',
          'prose-td:p-2 prose-td:border prose-td:border-border prose-td:align-top'
        )}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </div>
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

interface Stage1LayersProps {
  courseCode: string
  onAllApproved?: (allApproved: boolean) => void
  intake?: IntakeSummaryProps
}

export default function Stage1Layers({ courseCode, onAllApproved, intake }: Stage1LayersProps) {
  const [layers, setLayers] = useState<Stage1LayerStateView[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [viewingReportId, setViewingReportId] = useState<string | null>(null)
  const [layer2HasChanges, setLayer2HasChanges] = useState(false)
  const [layer2Summary, setLayer2Summary] = useState<CloRefinementReviewSummary | null>(null)
  const [layer3HasChanges, setLayer3HasChanges] = useState(false)
  const [layer3Summary, setLayer3Summary] = useState<AssessmentRedesignReviewSummary | null>(null)
  const [layer4HasChanges, setLayer4HasChanges] = useState(false)
  const [layer4Summary, setLayer4Summary] = useState<WeightingRubricReviewSummary | null>(null)
  const [layer5HasChanges, setLayer5HasChanges] = useState(false)
  const [layer5Summary, setLayer5Summary] = useState<IntegrityReviewReviewSummary | null>(null)
  const [layer6HasChanges, setLayer6HasChanges] = useState(false)
  const [layer6Summary, setLayer6Summary] = useState<SubtopicArchitectureReviewSummary | null>(null)
  const layerRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const autoRunAttempted = useRef<Set<string>>(new Set())

  // When a layer is expanded, bring its header to the top of the viewport so the
  // newly revealed content opens in place instead of leaving the user scrolled away.
  // Defer until after the layout settles (e.g. when approving a layer collapses a
  // large editor above the target) so the scroll lands on the correct layer.
  useEffect(() => {
    if (!expandedId) return
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
  }, [expandedId])

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
      onAllApproved?.(data.allApproved)
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load Stage 1 layers',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [courseCode, onAllApproved])

  useEffect(() => {
    loadLayers()
  }, [loadLayers])

  async function handleRun(layerId: string, execution?: StageExecutionMode) {
    try {
      setRunningId(layerId)
      const result = await runStage1Layer(courseCode, layerId, execution)
      setLayers(result.layers)
      onAllApproved?.(result.layers.every((l) => l.status === 'approved'))
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
      onAllApproved?.(result.allApproved)
      showToast({
        title: 'Approved',
        description: result.allApproved
          ? 'All Stage 1 layers approved. You can proceed to Stage 2.'
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
      setExpandedId('layer3-assessment-redesign')
    }
  }

  async function handleApproveLayer3AndContinue() {
    const approved = await handleApprove('layer3-assessment-redesign', { skipUnsavedCheck: true })
    if (approved) {
      setExpandedId('layer4-weighting-rubric')
    }
  }

  async function handleApproveLayer4AndContinue() {
    const approved = await handleApprove('layer4-weighting-rubric', { skipUnsavedCheck: true })
    if (approved) {
      setExpandedId('layer5-integrity-ai')
    }
  }

  async function handleApproveLayer5AndContinue() {
    const approved = await handleApprove('layer5-integrity-ai', { skipUnsavedCheck: true })
    if (approved) {
      setExpandedId('layer6-subtopic-architecture')
    }
  }

  async function handleApproveLayer6AndContinue() {
    await handleApprove('layer6-subtopic-architecture', { skipUnsavedCheck: true })
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

  if (loading && layers.length === 0) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const allApproved = layers.length > 0 && layers.every((l) => l.status === 'approved')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage 1 — Academic Contract Layers</CardTitle>
        <CardDescription>
          Complete all six internal layers in order. Stage 2 unlocks when every layer is approved.
          {allApproved && (
            <span className="ml-2 inline-flex items-center gap-1 text-emerald-600">
              <Check className="h-4 w-4" /> Stage 1 complete
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {layers.map((layer) => {
          const open = expandedId === layer.layerId
          const clientRunning = runningId === layer.layerId
          // Server says "running" but this client did not start it -> stale (e.g. interrupted run)
          const staleRunning = layer.status === 'running' && !clientRunning
          const isRunning = clientRunning
          const showRunButton = layer.canRun || staleRunning

          const actionButtons = (
            <div className="flex flex-wrap gap-2">
              {staleRunning && (
                <p className="w-full rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
                  This layer was left in a running state (the previous run may have been interrupted). You can
                  regenerate it.
                </p>
              )}
              {showRunButton && (
                <Button size="sm" disabled={isRunning} onClick={() => handleRun(layer.layerId)}>
                  {isRunning ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : layer.reportMarkdown ? (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  {layer.reportMarkdown ? 'Regenerate' : 'Run'}
                </Button>
              )}
              {layer.canApprove &&
                layer.layerId !== 'layer4-weighting-rubric' &&
                layer.layerId !== 'layer5-integrity-ai' &&
                layer.layerId !== 'layer6-subtopic-architecture' && (
                  <Button size="sm" variant="default" onClick={() => handleApprove(layer.layerId)}>
                    <Check className="mr-2 h-4 w-4" />
                    Approve
                  </Button>
                )}
              {(layer.status === 'needs_review' || layer.status === 'generated') && (
                <Button size="sm" variant="outline" onClick={() => handleReject(layer.layerId)}>
                  <XCircle className="mr-2 h-4 w-4" />
                  Request revision
                </Button>
              )}
              {(layer.layerId === 'layer2-clo-review' ||
                layer.layerId === 'layer3-assessment-redesign' ||
                layer.layerId === 'layer4-weighting-rubric' ||
                layer.layerId === 'layer5-integrity-ai' ||
                layer.layerId === 'layer6-subtopic-architecture') &&
                layer.reportMarkdown && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setViewingReportId((prev) => (prev === layer.layerId ? null : layer.layerId))
                    }
                  >
                    {viewingReportId === layer.layerId ? (
                      <>
                        <EyeOff className="mr-2 h-4 w-4" />
                        Hide council report
                      </>
                    ) : (
                      <>
                        <Eye className="mr-2 h-4 w-4" />
                        View council report
                      </>
                    )}
                  </Button>
                )}
              {layer.layerId === 'layer1-intake' && intake && layer.reportMarkdown && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setViewingReportId((prev) => (prev === layer.layerId ? null : layer.layerId))
                  }
                >
                  {viewingReportId === layer.layerId ? (
                    <>
                      <EyeOff className="mr-2 h-4 w-4" />
                      Hide raw summary
                    </>
                  ) : (
                    <>
                      <Eye className="mr-2 h-4 w-4" />
                      View raw extraction summary
                    </>
                  )}
                </Button>
              )}
            </div>
          )

          return (
            <div
              key={layer.layerId}
              ref={(el) => {
                layerRefs.current[layer.layerId] = el
              }}
              className={cn(
                'scroll-mt-4 rounded-lg border',
                layer.status === 'approved' ? 'border-emerald-500/40' : 'border-border'
              )}
            >
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 p-4 text-left"
                onClick={() => setExpandedId(open ? null : layer.layerId)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {layer.config.order}. {layer.config.name}
                    </span>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusColor(layer.status))}>
                      {layer.status === 'locked' && <Lock className="mr-1 inline h-3 w-3" />}
                      {STATUS_LABELS[layer.status] || layer.status}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize">
                      {layer.config.mode === 'council' ? 'LLM Council' : 'Single Agent'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{layer.config.description}</p>
                  <p className="text-xs text-muted-foreground">Output: {layer.config.productOutput}</p>
                </div>
                {open ? <ChevronDown className="h-5 w-5 shrink-0" /> : <ChevronRight className="h-5 w-5 shrink-0" />}
              </button>

              {open && (
                <div className="space-y-4 border-t border-border px-4 pb-4">
                  {layer.error && (
                    <p className="rounded-md bg-red-500/10 p-2 text-sm text-red-600">{layer.error}</p>
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
                        onHasChanges={setLayer2HasChanges}
                        onSummaryChange={setLayer2Summary}
                        onSaved={() => loadLayers()}
                        onApproveAndContinue={handleApproveLayer2AndContinue}
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
                        onHasChanges={setLayer3HasChanges}
                        onSummaryChange={setLayer3Summary}
                        onSaved={() => loadLayers()}
                        onApproveAndContinue={handleApproveLayer3AndContinue}
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
                        onApproveAndContinue={handleApproveLayer6AndContinue}
                      />
                    </>
                  ) : layer.layerId === 'layer1-intake' &&
                    intake &&
                    (layer.status === 'generated' ||
                      layer.status === 'needs_review' ||
                      layer.status === 'needs_revision' ||
                      layer.status === 'approved') ? (
                    <>
                      <IntakeSummaryView {...intake} />
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
          )
        })}
      </CardContent>
    </Card>
  )
}
