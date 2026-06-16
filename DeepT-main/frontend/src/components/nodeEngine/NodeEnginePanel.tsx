import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Play,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { showToast } from '@/components/ui/Toaster'
import { cn } from '@/lib/utils'
import { useRole } from '@/contexts/RoleContext'
import {
  approveNodeSet,
  fetchNodeSet,
  fetchSubtopicArchitecture,
  generateNodeSet,
  AcademicApprovalRequiredError,
  type NodeEngineNodeSet,
  type SubtopicArchitectureResponse,
} from '@/services/api'
import { NODE_ENGINE_LAYER_MAP, type NodeEngineLayer } from './nodeEngineLayers'
import NodeSetReport from './NodeSetReport'

/**
 * Maestro Node Engine — operational layer workflow.
 *
 * Mirrors the Course Architect (Stage 1) rhythm: each layer is an expandable
 * card with a status, a job description, an output name, and run/approve
 * actions. Only Layer 1 (M7 — Node Generation) is wired to a backend in this
 * phase; Layers 2–5 are UI placeholders that unlock in sequence once the
 * previous layer is approved (their M8/M9/M10/Step 9 engines arrive later).
 *
 * Approval / unlock state:
 *  - Layer 1's approval state is the BACKEND node-set status (the source of
 *    truth, from generate/get/approve). A subtopic's node-set must be `approved`
 *    to unlock Layer 2 — no auto-proceed; a human approves the draft.
 *  - Layers 2–5 have no backend, so their unlock is DERIVED from the previous
 *    layer being approved. Since Layers 2–4 cannot be approved yet, Layers 3–5
 *    stay locked — the chain is honest, nothing is fabricated.
 *
 * Display register: product wording (Course Architect / Node Engine / Layer 1–5)
 * is user-facing; engineering names (Stage 1 / Step 9 / M*) stay in comments.
 */

type LayerStatus = 'locked' | 'available' | 'running' | 'needs_review' | 'approved' | 'completed'

const STATUS_LABELS: Record<LayerStatus, string> = {
  locked: 'Locked',
  available: 'Available',
  running: 'Running',
  needs_review: 'Needs Review',
  approved: 'Approved',
  completed: 'Completed',
}

function statusColor(status: LayerStatus): string {
  switch (status) {
    case 'approved':
    case 'completed':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    case 'needs_review':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    case 'running':
      return 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
    case 'available':
      return 'bg-primary/10 text-primary'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

interface ApprovedSubtopic {
  subtopic_id: string
  title: string
  clo_id: string
  assessment_connection: string[]
}

function collectApprovedSubtopics(arch: SubtopicArchitectureResponse | null): ApprovedSubtopic[] {
  if (!arch) return []
  const out: ApprovedSubtopic[] = []
  for (const section of arch.clo_sections) {
    for (const st of section.subtopics) {
      if (st.approval_status === 'approved') {
        out.push({
          subtopic_id: st.subtopic_id,
          title: st.proposed_subtopic,
          clo_id: section.clo_id,
          assessment_connection: st.assessment_connection ?? [],
        })
      }
    }
  }
  return out
}

export default function NodeEnginePanel({ courseCode }: { courseCode: string }) {
  const { role } = useRole()

  const [arch, setArch] = useState<SubtopicArchitectureResponse | null>(null)
  const [archLoading, setArchLoading] = useState(true)

  const [selectedSubtopicId, setSelectedSubtopicId] = useState<string>('')
  const [nodeSet, setNodeSet] = useState<NodeEngineNodeSet | null>(null)
  const [nodeSetLoading, setNodeSetLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [approving, setApproving] = useState(false)

  const [expandedLayer, setExpandedLayer] = useState<number | null>(1)
  const [reportVisible, setReportVisible] = useState(true)

  const approvedSubtopics = useMemo(() => collectApprovedSubtopics(arch), [arch])
  const selectedSubtopic = approvedSubtopics.find((s) => s.subtopic_id === selectedSubtopicId)
  const courseTitle = arch?.course_summary.course_title

  // Load the approved Course Architect (Layer 6) subtopics.
  useEffect(() => {
    let active = true
    setArchLoading(true)
    fetchSubtopicArchitecture(courseCode)
      .then((data) => {
        if (active) setArch(data)
      })
      .catch(() => {
        if (active) setArch(null)
      })
      .finally(() => {
        if (active) setArchLoading(false)
      })
    return () => {
      active = false
    }
  }, [courseCode])

  // Default to the first approved subtopic once they load.
  useEffect(() => {
    if (!selectedSubtopicId && approvedSubtopics.length > 0) {
      setSelectedSubtopicId(approvedSubtopics[0].subtopic_id)
    }
  }, [approvedSubtopics, selectedSubtopicId])

  // Load any existing node-set for the selected subtopic.
  const loadNodeSet = useCallback(
    async (subtopicId: string) => {
      if (!subtopicId) {
        setNodeSet(null)
        return
      }
      try {
        setNodeSetLoading(true)
        const existing = await fetchNodeSet(courseCode, subtopicId)
        setNodeSet(existing)
      } catch {
        setNodeSet(null)
      } finally {
        setNodeSetLoading(false)
      }
    },
    [courseCode]
  )

  useEffect(() => {
    if (selectedSubtopicId) {
      void loadNodeSet(selectedSubtopicId)
      setReportVisible(true)
    }
  }, [selectedSubtopicId, loadNodeSet])

  const layer1Approved = nodeSet?.status === 'approved'

  function layerStatus(layer: NodeEngineLayer): LayerStatus {
    if (layer.layer === 1) {
      if (approvedSubtopics.length === 0) return 'locked'
      if (generating) return 'running'
      if (!nodeSet) return 'available'
      if (nodeSet.status === 'approved') return 'approved'
      return 'needs_review'
    }
    // Layers 2–5: unlock only when the previous layer is approved. Only Layer 1
    // can be approved today, so Layer 2 may become 'available' (placeholder) and
    // Layers 3–5 stay locked.
    if (layer.layer === 2) return layer1Approved ? 'available' : 'locked'
    return 'locked'
  }

  async function handleRun() {
    if (!selectedSubtopicId) return
    try {
      setGenerating(true)
      const result = await generateNodeSet(courseCode, selectedSubtopicId)
      setNodeSet(result)
      setReportVisible(true)
      showToast({
        title: 'Node set generated',
        description: 'Draft node set ready. Review each node, then approve to unlock Layer 2.',
        variant: 'success',
      })
    } catch (error) {
      showToast({
        title: 'Generation failed',
        description: error instanceof Error ? error.message : 'Failed to generate node set',
        variant: 'destructive',
      })
    } finally {
      setGenerating(false)
    }
  }

  async function handleApprove(overrideReason?: string) {
    if (!selectedSubtopicId) return
    try {
      setApproving(true)
      const result = await approveNodeSet(courseCode, selectedSubtopicId, {
        approver: role,
        overrideReason,
      })
      setNodeSet(result)
      showToast({
        title: 'Node set approved',
        description:
          result.status === 'approved'
            ? 'Layer 1 approved. Layer 2 — Experience Blueprint is now unlocked.'
            : 'Approval recorded.',
        variant: 'success',
      })
    } catch (error) {
      // Academic-approval guard: no reference grounding attached. Offer an
      // explicit, recorded override rather than silently approving ungrounded.
      if (error instanceof AcademicApprovalRequiredError && !overrideReason) {
        const reason = window.prompt(
          'This node set has NO reference grounding and is not academically approvable.\n\n' +
            'Recommended: run Reference Alignment (Course Architect Layer 7) first.\n\n' +
            'To approve WITHOUT grounding anyway, type an override reason (it will be recorded):'
        )
        if (reason && reason.trim()) {
          setApproving(false)
          await handleApprove(reason.trim())
          return
        }
        showToast({
          title: 'Approval blocked',
          description:
            'No reference grounding attached. Run Reference Alignment (Layer 7) or provide an override reason.',
          variant: 'destructive',
        })
        return
      }
      showToast({
        title: 'Approval failed',
        description: error instanceof Error ? error.message : 'Failed to approve node set',
        variant: 'destructive',
      })
    } finally {
      setApproving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Boxes className="h-5 w-5" />
          Maestro Node Engine
        </CardTitle>
        <CardDescription>
          Course Architect prepares the approved academic structure. The Node Engine turns each
          approved subtopic into governed adaptive learning nodes for{' '}
          <span className="font-mono">{courseCode}</span>. Approve each layer to unlock the next.
          {layer1Approved && (
            <span className="ml-2 inline-flex items-center gap-1 text-emerald-600">
              <Check className="h-4 w-4" /> Layer 1 approved
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {archLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading approved subtopics…
          </div>
        ) : (
          NODE_ENGINE_LAYER_MAP.map((layer) => {
            const status = layerStatus(layer)
            const open = expandedLayer === layer.layer
            return (
              <div
                key={layer.layer}
                className={cn(
                  'rounded-lg border',
                  status === 'approved' || status === 'completed'
                    ? 'border-emerald-500/40'
                    : 'border-border'
                )}
              >
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 p-4 text-left"
                  onClick={() => setExpandedLayer(open ? null : layer.layer)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        Layer {layer.layer} — {layer.label}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          statusColor(status)
                        )}
                      >
                        {status === 'locked' && <Lock className="mr-1 inline h-3 w-3" />}
                        {STATUS_LABELS[status]}
                      </span>
                      {!layer.active && (
                        <span className="text-xs text-muted-foreground">(upcoming)</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{layer.job}</p>
                    <p className="text-xs text-muted-foreground">Output: {layer.output}</p>
                  </div>
                  {open ? (
                    <ChevronDown className="h-5 w-5 shrink-0" />
                  ) : (
                    <ChevronRight className="h-5 w-5 shrink-0" />
                  )}
                </button>

                {open && (
                  <div className="space-y-4 border-t border-border px-4 pb-4 pt-4">
                    {layer.layer === 1 ? (
                      <Layer1Body
                        status={status}
                        approvedSubtopics={approvedSubtopics}
                        selectedSubtopicId={selectedSubtopicId}
                        onSelectSubtopic={setSelectedSubtopicId}
                        selectedSubtopic={selectedSubtopic}
                        nodeSet={nodeSet}
                        nodeSetLoading={nodeSetLoading}
                        generating={generating}
                        approving={approving}
                        reportVisible={reportVisible}
                        onToggleReport={() => setReportVisible((v) => !v)}
                        onRun={handleRun}
                        onApprove={handleApprove}
                        courseCode={courseCode}
                        courseTitle={courseTitle}
                      />
                    ) : (
                      <PlaceholderLayerBody status={status} layer={layer} />
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

interface Layer1BodyProps {
  status: LayerStatus
  approvedSubtopics: ApprovedSubtopic[]
  selectedSubtopicId: string
  onSelectSubtopic: (id: string) => void
  selectedSubtopic?: ApprovedSubtopic
  nodeSet: NodeEngineNodeSet | null
  nodeSetLoading: boolean
  generating: boolean
  approving: boolean
  reportVisible: boolean
  onToggleReport: () => void
  onRun: () => void
  onApprove: () => void
  courseCode: string
  courseTitle?: string
}

function Layer1Body({
  status,
  approvedSubtopics,
  selectedSubtopicId,
  onSelectSubtopic,
  selectedSubtopic,
  nodeSet,
  nodeSetLoading,
  generating,
  approving,
  reportVisible,
  onToggleReport,
  onRun,
  onApprove,
  courseCode,
  courseTitle,
}: Layer1BodyProps) {
  if (status === 'locked') {
    return (
      <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          No approved subtopics yet. Approve at least one subtopic in Course Architect (Layer 6 —
          Self-Paced Subtopic Architecture) to begin node generation.
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Subtopic selector */}
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Approved subtopic ({approvedSubtopics.length} available)
        </label>
        <select
          value={selectedSubtopicId}
          onChange={(e) => onSelectSubtopic(e.target.value)}
          disabled={generating || approving}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {approvedSubtopics.map((s) => (
            <option key={s.subtopic_id} value={s.subtopic_id}>
              {s.clo_id} · {s.title}
            </option>
          ))}
        </select>
        {selectedSubtopic && (
          <p className="text-xs text-muted-foreground">
            CLO {selectedSubtopic.clo_id}
            {selectedSubtopic.assessment_connection.length > 0
              ? ` · prepares for ${selectedSubtopic.assessment_connection.join(', ')}`
              : ' · no assessment connection'}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onRun} disabled={generating || approving || !selectedSubtopicId}>
          {generating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : nodeSet ? (
            <RefreshCw className="mr-2 h-4 w-4" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {nodeSet ? 'Regenerate Node Set' : 'Run Layer 1'}
        </Button>

        {nodeSet && (
          <Button size="sm" variant="outline" onClick={onToggleReport}>
            {reportVisible ? (
              <>
                <EyeOff className="mr-2 h-4 w-4" /> Hide Node Set Report
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" /> View Node Set Report
              </>
            )}
          </Button>
        )}

        {nodeSet && nodeSet.status !== 'approved' && (
          <Button size="sm" variant="default" onClick={onApprove} disabled={approving || generating}>
            {approving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Approve Node Set
          </Button>
        )}
      </div>

      {/* Body */}
      {generating ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Generating governed mastery nodes for this
          subtopic…
        </div>
      ) : nodeSetLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading node set…
        </div>
      ) : nodeSet ? (
        <>
          {nodeSet.status !== 'approved' && (
            <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
              This is a DRAFT node set. Author/SME/admin review is required before any downstream
              use — auto-proceed eligibility never hides output. Approve the set to unlock Layer 2.
            </p>
          )}
          {reportVisible && (
            <NodeSetReport
              nodeSet={nodeSet}
              courseCode={courseCode}
              courseTitle={courseTitle}
              subtopicTitle={selectedSubtopic?.title}
              assessmentConnection={selectedSubtopic?.assessment_connection}
            />
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No node set yet for this subtopic. Run Layer 1 to generate 4–7 governed mastery nodes.
        </p>
      )}
    </div>
  )
}

function PlaceholderLayerBody({ status, layer }: { status: LayerStatus; layer: NodeEngineLayer }) {
  if (status === 'locked') {
    return (
      <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{layer.lockReason}</span>
      </div>
    )
  }
  // Unlocked placeholder (Layer 2 after Layer 1 approval).
  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-4 text-sm">
      <p className="font-medium text-foreground">{layer.label} is unlocked.</p>
      <p className="text-muted-foreground">{layer.job}</p>
      <p className="text-muted-foreground">
        This layer's engine is not built in this phase. Its output —{' '}
        <span className="font-medium">{layer.output}</span> — will be generated and reviewed here
        once the layer is implemented.
      </p>
    </div>
  )
}
