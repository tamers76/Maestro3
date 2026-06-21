import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { showToast } from '@/components/ui/Toaster'
import { cn } from '@/lib/utils'
import { useRole } from '@/contexts/RoleContext'
import {
  approveNodeSet,
  fetchAlignment,
  fetchNodeSet,
  fetchSubtopicArchitecture,
  generateNodeSet,
  generateBlueprint,
  approveBlueprint,
  hydrateBlueprints,
  generateContentSpecs,
  approveContentSpec,
  hydrateContentSpecs,
  produceLayer4Object,
  hydrateProducedObjects,
  AcademicApprovalRequiredError,
  reopenNodeSet,
  type AlignmentStateSummary,
  type NodeEngineBlueprint,
  type NodeEngineContentSpec,
  type NodeEngineProducedObject,
  type NodeEngineGroundingSource,
  type NodeEngineNode,
  type NodeEngineNodeSet,
  type SubtopicArchitectureResponse,
} from '@/services/api'
import { NODE_ENGINE_LAYER_MAP, type NodeEngineLayer } from './nodeEngineLayers'
import { NodeCard, isMustReviewNode } from './NodeSetReport'
import { Layer2Body, Layer2ContinueCta } from './NodeBlueprintPanel'
import { Layer3Body, Layer3ContinueCta } from './ContentSpecPanel'
import { Layer4Body, Layer4ContinueCta } from './ModalityProductionPanel'
import { DEFAULT_NODE_ENGINE_FILTERS, type NodeEngineFilterState } from './nodeEngineFilters'

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

interface CloGroup {
  clo_id: string
  refined_clo: string
  subtopics: ApprovedSubtopic[]
}

/** Group the approved Layer 6 subtopics under their CLO, preserving CLO order
 *  and wording. CLOs with no approved subtopics are dropped. */
function buildCloGroups(arch: SubtopicArchitectureResponse | null): CloGroup[] {
  if (!arch) return []
  return arch.clo_sections
    .map((section) => ({
      clo_id: section.clo_id,
      refined_clo: section.refined_clo,
      subtopics: section.subtopics
        .filter((s) => s.approval_status === 'approved')
        .map((s) => ({
          subtopic_id: s.subtopic_id,
          title: s.proposed_subtopic,
          clo_id: section.clo_id,
          assessment_connection: s.assessment_connection ?? [],
        })),
    }))
    .filter((g) => g.subtopics.length > 0)
}

export default function NodeEnginePanel({
  courseCode,
  alignmentFetchSignal = 0,
  soloLayer,
  onNavigateLayer,
}: {
  courseCode: string
  alignmentFetchSignal?: number
  /** Wizard mode: render ONLY this layer as a focused step. */
  soloLayer?: number
  /** Wizard mode: forward navigation routes instead of expanding in-place. */
  onNavigateLayer?: (layer: number) => void
}) {
  const { role } = useRole()

  const [arch, setArch] = useState<SubtopicArchitectureResponse | null>(null)
  const [archLoading, setArchLoading] = useState(true)
  const [alignmentState, setAlignmentState] = useState<AlignmentStateSummary | null>(null)

  // Per-subtopic node sets, keyed by subtopic id (null = no set yet).
  const [nodeSetsBySubtopicId, setNodeSetsBySubtopicId] = useState<
    Record<string, NodeEngineNodeSet | null>
  >({})
  const [hydrating, setHydrating] = useState(false)
  // Which CLO is currently mid-batch (generate or approve), plus live progress.
  const [generatingCloId, setGeneratingCloId] = useState<string | null>(null)
  const [approvingCloId, setApprovingCloId] = useState<string | null>(null)
  const [batchProgress, setBatchProgress] = useState<{
    cloId: string
    done: number
    total: number
  } | null>(null)
  // Whole-course generation (every CLO's subtopics in one sequential run).
  const [generatingAll, setGeneratingAll] = useState(false)
  const [courseProgress, setCourseProgress] = useState<{ done: number; total: number } | null>(null)
  const [query, setQuery] = useState('')
  const [layerFilters, setLayerFilters] = useState<NodeEngineFilterState>(DEFAULT_NODE_ENGINE_FILTERS)

  const [expandedLayer, setExpandedLayer] = useState<number | null>(1)
  const [collapsedCloIds, setCollapsedCloIds] = useState<Set<string>>(new Set())

  const [blueprintsByNodeId, setBlueprintsByNodeId] = useState<
    Record<string, NodeEngineBlueprint | null>
  >({})
  const [blueprintsHydrating, setBlueprintsHydrating] = useState(false)
  const [generatingBlueprintCloId, setGeneratingBlueprintCloId] = useState<string | null>(null)
  const [approvingBlueprintCloId, setApprovingBlueprintCloId] = useState<string | null>(null)

  const [contentSpecsByObjectId, setContentSpecsByObjectId] = useState<
    Record<string, NodeEngineContentSpec | null>
  >({})
  const [contentSpecsHydrating, setContentSpecsHydrating] = useState(false)
  const [generatingContentSpecCloId, setGeneratingContentSpecCloId] = useState<string | null>(null)
  const [approvingContentSpecCloId, setApprovingContentSpecCloId] = useState<string | null>(null)

  const [producedByObjectId, setProducedByObjectId] = useState<
    Record<string, NodeEngineProducedObject | null>
  >({})
  const [producedHydrating, setProducedHydrating] = useState(false)
  const [producingTextCloId, setProducingTextCloId] = useState<string | null>(null)

  const approverLabel = role === 'sme' ? 'SME' : role === 'admin' ? 'Admin' : 'Author'

  const cloGroups = useMemo(() => buildCloGroups(arch), [arch])

  const allApprovedSubtopicIds = useMemo(
    () => cloGroups.flatMap((g) => g.subtopics.map((s) => s.subtopic_id)),
    [cloGroups]
  )

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

  useEffect(() => {
    let active = true
    fetchAlignment(courseCode)
      .then((data) => {
        if (active) setAlignmentState(data.state)
      })
      .catch(() => {
        if (active) setAlignmentState(null)
      })
    return () => {
      active = false
    }
  }, [courseCode, alignmentFetchSignal])

  const nodeGenReady = alignmentState?.node_gen_ready === true

  // Hydrate any existing node sets for every approved subtopic so prior drafts
  // and approvals show grouped under their CLO on load.
  useEffect(() => {
    if (allApprovedSubtopicIds.length === 0) {
      setNodeSetsBySubtopicId({})
      return
    }
    let active = true
    setHydrating(true)
    Promise.all(
      allApprovedSubtopicIds.map(
        async (id) =>
          [id, await fetchNodeSet(courseCode, id).catch(() => null)] as const
      )
    )
      .then((entries) => {
        if (active) setNodeSetsBySubtopicId(Object.fromEntries(entries))
      })
      .finally(() => {
        if (active) setHydrating(false)
      })
    return () => {
      active = false
    }
  }, [courseCode, allApprovedSubtopicIds])

  // Layer 1 is honestly "approved" only when every approved subtopic course-wide
  // has an approved node set.
  const layer1Approved =
    allApprovedSubtopicIds.length > 0 &&
    allApprovedSubtopicIds.every((id) => nodeSetsBySubtopicId[id]?.status === 'approved')

  const approvedNodeRefs = useMemo(() => {
    const refs: Array<{ subtopicId: string; nodeId: string }> = []
    for (const group of cloGroups) {
      for (const st of group.subtopics) {
        const nodeSet = nodeSetsBySubtopicId[st.subtopic_id]
        if (nodeSet?.status !== 'approved') continue
        for (const node of nodeSet.nodes) {
          if (node.status === 'approved') {
            refs.push({ subtopicId: st.subtopic_id, nodeId: node.node_id })
          }
        }
      }
    }
    return refs
  }, [cloGroups, nodeSetsBySubtopicId])

  const layer2Approved =
    layer1Approved &&
    approvedNodeRefs.length > 0 &&
    approvedNodeRefs.every((r) => blueprintsByNodeId[r.nodeId]?.status === 'approved')

  const approvedBlueprintObjectIds = useMemo(() => {
    const ids: string[] = []
    for (const ref of approvedNodeRefs) {
      const bp = blueprintsByNodeId[ref.nodeId]
      if (bp?.status === 'approved') {
        for (const obj of bp.objects) ids.push(obj.object_id)
      }
    }
    return ids
  }, [approvedNodeRefs, blueprintsByNodeId])

  const layer3Approved =
    layer2Approved &&
    approvedBlueprintObjectIds.length > 0 &&
    approvedBlueprintObjectIds.every((id) => contentSpecsByObjectId[id]?.status === 'approved')

  const approvedSpecObjectIds = useMemo(
    () =>
      approvedBlueprintObjectIds.filter(
        (id) => contentSpecsByObjectId[id]?.status === 'approved'
      ),
    [approvedBlueprintObjectIds, contentSpecsByObjectId]
  )

  const layer4Complete =
    approvedSpecObjectIds.length > 0 &&
    approvedSpecObjectIds.every((id) => producedByObjectId[id])

  // Hydrate existing M8 blueprints once Layer 1 is approved.
  useEffect(() => {
    if (!layer1Approved || approvedNodeRefs.length === 0) {
      setBlueprintsByNodeId({})
      return
    }
    let active = true
    setBlueprintsHydrating(true)
    hydrateBlueprints(courseCode, approvedNodeRefs)
      .then((map) => {
        if (active) setBlueprintsByNodeId(map)
      })
      .catch(() => {
        if (active) setBlueprintsByNodeId({})
      })
      .finally(() => {
        if (active) setBlueprintsHydrating(false)
      })
    return () => {
      active = false
    }
  }, [courseCode, layer1Approved, approvedNodeRefs])

  // Hydrate existing M9 content specs once Layer 2 is approved.
  useEffect(() => {
    if (!layer2Approved || approvedNodeRefs.length === 0) {
      setContentSpecsByObjectId({})
      return
    }
    let active = true
    setContentSpecsHydrating(true)
    hydrateContentSpecs(courseCode, approvedNodeRefs)
      .then((map) => {
        if (active) setContentSpecsByObjectId(map)
      })
      .catch(() => {
        if (active) setContentSpecsByObjectId({})
      })
      .finally(() => {
        if (active) setContentSpecsHydrating(false)
      })
    return () => {
      active = false
    }
  }, [courseCode, layer2Approved, approvedNodeRefs])

  // Hydrate existing M10 produced objects for approved content specs.
  useEffect(() => {
    if (approvedSpecObjectIds.length === 0) {
      setProducedByObjectId({})
      return
    }
    let active = true
    setProducedHydrating(true)
    hydrateProducedObjects(courseCode, approvedSpecObjectIds)
      .then((map) => {
        if (active) setProducedByObjectId(map)
      })
      .catch(() => {
        if (active) setProducedByObjectId({})
      })
      .finally(() => {
        if (active) setProducedHydrating(false)
      })
    return () => {
      active = false
    }
  }, [courseCode, approvedSpecObjectIds])

  const cloFullyApprovedCount = useMemo(
    () =>
      cloGroups.filter((g) =>
        g.subtopics.every((s) => nodeSetsBySubtopicId[s.subtopic_id]?.status === 'approved')
      ).length,
    [cloGroups, nodeSetsBySubtopicId]
  )

  function handleNodeSetUpdated(subtopicId: string, nodeSet: NodeEngineNodeSet) {
    setNodeSetsBySubtopicId((prev) => ({ ...prev, [subtopicId]: nodeSet }))
    const cloId = cloGroups.find((g) => g.subtopics.some((s) => s.subtopic_id === subtopicId))?.clo_id
    if (cloId) {
      setCollapsedCloIds((prev) => {
        const next = new Set(prev)
        next.delete(cloId)
        return next
      })
    }
  }

  function layerStatus(layer: NodeEngineLayer): LayerStatus {
    if (layer.layer === 1) {
      if (allApprovedSubtopicIds.length === 0) return 'locked'
      if (generatingCloId || generatingAll) return 'running'
      if (layer1Approved) return 'approved'
      const anyGenerated = allApprovedSubtopicIds.some((id) => nodeSetsBySubtopicId[id])
      return anyGenerated ? 'needs_review' : 'available'
    }
    if (layer.layer === 2) {
      if (!layer1Approved) return 'locked'
      if (generatingBlueprintCloId) return 'running'
      if (layer2Approved) return 'approved'
      const anyBlueprint = approvedNodeRefs.some((r) => blueprintsByNodeId[r.nodeId])
      return anyBlueprint ? 'needs_review' : 'available'
    }
    if (layer.layer === 3) {
      if (!layer2Approved) return 'locked'
      if (generatingContentSpecCloId) return 'running'
      if (layer3Approved) return 'approved'
      const anySpec = approvedBlueprintObjectIds.some((id) => contentSpecsByObjectId[id])
      return anySpec ? 'needs_review' : 'available'
    }
    if (layer.layer === 4) {
      if (approvedSpecObjectIds.length === 0) return 'locked'
      if (producingTextCloId) return 'running'
      if (layer4Complete) return 'approved'
      const anyProduced = approvedSpecObjectIds.some((id) => producedByObjectId[id])
      return anyProduced ? 'needs_review' : 'available'
    }
    if (layer.layer === 5) return layer4Complete ? 'available' : 'locked'
    return 'locked'
  }

  async function handleGenerateBlueprintsClo(cloId: string) {
    const group = cloGroups.find((g) => g.clo_id === cloId)
    if (!group) return
    const targets: Array<{ subtopicId: string; node: NodeEngineNode }> = []
    for (const st of group.subtopics) {
      const nodeSet = nodeSetsBySubtopicId[st.subtopic_id]
      if (nodeSet?.status !== 'approved') continue
      for (const node of nodeSet.nodes) {
        if (node.status === 'approved') targets.push({ subtopicId: st.subtopic_id, node })
      }
    }
    if (targets.length === 0) return

    setGeneratingBlueprintCloId(cloId)
    const failures: string[] = []
    for (const { subtopicId, node } of targets) {
      try {
        const bp = await generateBlueprint(courseCode, subtopicId, node.node_id)
        setBlueprintsByNodeId((prev) => ({ ...prev, [node.node_id]: bp }))
      } catch {
        failures.push(node.node_title)
      }
    }
    setGeneratingBlueprintCloId(null)
    if (failures.length > 0) {
      showToast({
        title: 'Some blueprints failed',
        description: failures.join(', '),
        variant: 'destructive',
      })
    } else {
      showToast({
        title: `Blueprints generated for ${cloId}`,
        description: `Draft experience plans ready for ${targets.length} node(s). Review and approve.`,
        variant: 'success',
      })
    }
  }

  async function handleApproveBlueprintsClo(cloId: string) {
    const group = cloGroups.find((g) => g.clo_id === cloId)
    if (!group) return
    const targets: Array<{ subtopicId: string; node: NodeEngineNode }> = []
    for (const st of group.subtopics) {
      const nodeSet = nodeSetsBySubtopicId[st.subtopic_id]
      if (nodeSet?.status !== 'approved') continue
      for (const node of nodeSet.nodes) {
        if (node.status === 'approved' && blueprintsByNodeId[node.node_id]) {
          targets.push({ subtopicId: st.subtopic_id, node })
        }
      }
    }
    if (targets.length === 0) return

    setApprovingBlueprintCloId(cloId)
    const failures: string[] = []
    for (const { subtopicId, node } of targets) {
      const bp = blueprintsByNodeId[node.node_id]
      if (!bp || bp.status === 'approved') continue
      try {
        const approved = await approveBlueprint(courseCode, subtopicId, node.node_id, approverLabel)
        setBlueprintsByNodeId((prev) => ({ ...prev, [node.node_id]: approved }))
      } catch {
        failures.push(node.node_title)
      }
    }
    setApprovingBlueprintCloId(null)
    if (failures.length > 0) {
      showToast({
        title: 'Some approvals failed',
        description: failures.join(', '),
        variant: 'destructive',
      })
    } else {
      showToast({
        title: `Blueprints approved for ${cloId}`,
        description: layer2Approved
          ? 'Layer 2 approved. Layer 3 — Content Specification is now unlocked.'
          : 'Blueprint approvals recorded.',
        variant: 'success',
      })
    }
  }

  async function handleGenerateContentSpecsClo(cloId: string) {
    const group = cloGroups.find((g) => g.clo_id === cloId)
    if (!group) return
    const targets: Array<{ subtopicId: string; node: NodeEngineNode }> = []
    for (const st of group.subtopics) {
      const nodeSet = nodeSetsBySubtopicId[st.subtopic_id]
      if (nodeSet?.status !== 'approved') continue
      for (const node of nodeSet.nodes) {
        if (node.status === 'approved' && blueprintsByNodeId[node.node_id]?.status === 'approved') {
          targets.push({ subtopicId: st.subtopic_id, node })
        }
      }
    }
    if (targets.length === 0) return

    setGeneratingContentSpecCloId(cloId)
    const failures: string[] = []
    for (const { subtopicId, node } of targets) {
      try {
        const specs = await generateContentSpecs(courseCode, subtopicId, node.node_id)
        setContentSpecsByObjectId((prev) => {
          const next = { ...prev }
          for (const spec of specs) next[spec.object_id] = spec
          return next
        })
      } catch {
        failures.push(node.node_title)
      }
    }
    setGeneratingContentSpecCloId(null)
    if (failures.length > 0) {
      showToast({
        title: 'Some content specs failed',
        description: failures.join(', '),
        variant: 'destructive',
      })
    } else {
      showToast({
        title: `Content specs generated for ${cloId}`,
        description: `Draft specifications ready for ${targets.length} node(s). Review and approve.`,
        variant: 'success',
      })
    }
  }

  async function handleApproveContentSpecsClo(cloId: string) {
    const group = cloGroups.find((g) => g.clo_id === cloId)
    if (!group) return
    const targets: Array<{ subtopicId: string; node: NodeEngineNode; objectIds: string[] }> = []
    for (const st of group.subtopics) {
      const nodeSet = nodeSetsBySubtopicId[st.subtopic_id]
      if (nodeSet?.status !== 'approved') continue
      for (const node of nodeSet.nodes) {
        const bp = blueprintsByNodeId[node.node_id]
        if (node.status === 'approved' && bp?.status === 'approved') {
          targets.push({
            subtopicId: st.subtopic_id,
            node,
            objectIds: bp.objects.map((o) => o.object_id),
          })
        }
      }
    }
    if (targets.length === 0) return

    setApprovingContentSpecCloId(cloId)
    const failures: string[] = []
    for (const { subtopicId, node, objectIds } of targets) {
      for (const objectId of objectIds) {
        const spec = contentSpecsByObjectId[objectId]
        if (!spec || spec.status === 'approved') continue
        try {
          const approved = await approveContentSpec(
            courseCode,
            subtopicId,
            node.node_id,
            objectId,
            approverLabel
          )
          setContentSpecsByObjectId((prev) => ({ ...prev, [objectId]: approved }))
        } catch {
          failures.push(`${node.node_title} / ${objectId}`)
        }
      }
    }
    setApprovingContentSpecCloId(null)
    if (failures.length > 0) {
      showToast({
        title: 'Some spec approvals failed',
        description: failures.slice(0, 3).join(', '),
        variant: 'destructive',
      })
    } else {
      showToast({
        title: `Content specs approved for ${cloId}`,
        description: layer3Approved
          ? 'Layer 3 approved. Layer 4 — Modality Production is now unlocked.'
          : 'Content spec approvals recorded.',
        variant: 'success',
      })
    }
  }

  async function handleProduceTextClo(cloId: string, options: { regenerate?: boolean } = {}) {
    const regenerate = options.regenerate ?? false
    const group = cloGroups.find((g) => g.clo_id === cloId)
    if (!group) return
    const targets: Array<{
      subtopicId: string
      node: NodeEngineNode
      objectIds: string[]
    }> = []
    for (const st of group.subtopics) {
      const nodeSet = nodeSetsBySubtopicId[st.subtopic_id]
      if (nodeSet?.status !== 'approved') continue
      for (const node of nodeSet.nodes) {
        const bp = blueprintsByNodeId[node.node_id]
        if (node.status !== 'approved' || bp?.status !== 'approved') continue
        const objectIds = bp.objects
          .map((o) => o.object_id)
          .filter((id) => contentSpecsByObjectId[id]?.status === 'approved')
        if (objectIds.length > 0) {
          targets.push({ subtopicId: st.subtopic_id, node, objectIds })
        }
      }
    }
    if (targets.length === 0) return

    setProducingTextCloId(cloId)
    const failures: string[] = []
    for (const { subtopicId, node, objectIds } of targets) {
      for (const objectId of objectIds) {
        if (!regenerate && producedByObjectId[objectId]) continue
        try {
          const spec = contentSpecsByObjectId[objectId]
          const bp = blueprintsByNodeId[node.node_id]
          const bpObj = bp?.objects.find((o) => o.object_id === objectId)
          const vehicle = spec?.suggested_vehicle ?? bpObj?.suggested_vehicle ?? 'text'
          const produced = await produceLayer4Object(
            courseCode,
            subtopicId,
            node.node_id,
            objectId,
            vehicle
          )
          setProducedByObjectId((prev) => ({ ...prev, [objectId]: produced }))
        } catch {
          failures.push(`${node.node_title} / ${objectId}`)
        }
      }
    }
    setProducingTextCloId(null)
    if (failures.length > 0) {
      showToast({
        title: 'Some productions failed',
        description: failures.slice(0, 3).join(', '),
        variant: 'destructive',
      })
    } else {
      showToast({
        title: regenerate ? `Production regenerated for ${cloId}` : `Production complete for ${cloId}`,
        description: layer4Complete
          ? 'Layer 4 complete for all approved specs. Layer 5 unlocks when validation ships.'
          : 'Produced objects recorded — review output before publish.',
        variant: 'success',
      })
    }
  }

  // Generate node sets for every approved subtopic in one CLO, sequentially.
  // Each await advances live progress; per-subtopic errors are captured without
  // aborting the rest of the batch.
  async function handleGenerateClo(cloId: string) {
    if (!nodeGenReady) {
      showToast({
        title: 'Activate alignment tags first',
        description:
          alignmentState?.pending_activation
            ? 'Reference alignment has a preview that is not yet active. Activate tags in Layer 6 Step B before generating nodes.'
            : alignmentState?.is_stale
              ? alignmentState.stale_reason ?? 'Alignment is stale — preview and activate tags again.'
              : 'Complete Reference Alignment (Layer 6 Step B) before generating mastery nodes.',
        variant: 'destructive',
      })
      return
    }
    const group = cloGroups.find((g) => g.clo_id === cloId)
    if (!group || group.subtopics.length === 0) return
    setGeneratingCloId(cloId)
    setBatchProgress({ cloId, done: 0, total: group.subtopics.length })
    const failures: string[] = []
    for (let i = 0; i < group.subtopics.length; i++) {
      const st = group.subtopics[i]
      try {
        const result = await generateNodeSet(courseCode, st.subtopic_id)
        setNodeSetsBySubtopicId((prev) => ({ ...prev, [st.subtopic_id]: result }))
      } catch (error) {
        failures.push(st.title)
        // eslint-disable-next-line no-console
        console.error(`Node generation failed for ${st.subtopic_id}`, error)
      }
      setBatchProgress({ cloId, done: i + 1, total: group.subtopics.length })
    }
    setGeneratingCloId(null)
    setBatchProgress(null)
    if (failures.length > 0) {
      showToast({
        title: 'Some subtopics failed',
        description: `Generated ${group.subtopics.length - failures.length}/${group.subtopics.length}. Failed: ${failures.join(', ')}.`,
        variant: 'destructive',
      })
    } else {
      showToast({
        title: `Nodes generated for ${cloId}`,
        description: `Draft node sets ready for ${group.subtopics.length} subtopic(s). Review the must-review nodes, then approve.`,
        variant: 'success',
      })
    }
  }

  // Generate node sets for EVERY approved subtopic course-wide, in one sequential
  // run. Same engine + per-subtopic persistence as the per-CLO batch, so the run
  // is effectively resumable: completed subtopics are saved even if it's
  // interrupted. The tab must stay open for the duration.
  async function handleGenerateAllCourse() {
    if (!nodeGenReady) {
      showToast({
        title: 'Activate alignment tags first',
        description:
          alignmentState?.pending_activation
            ? 'Reference alignment has a preview that is not yet active. Activate tags in Layer 6 Step B before generating nodes.'
            : alignmentState?.is_stale
              ? alignmentState.stale_reason ?? 'Alignment is stale — preview and activate tags again.'
              : 'Complete Reference Alignment (Layer 6 Step B) before generating mastery nodes.',
        variant: 'destructive',
      })
      return
    }
    const allSubs = cloGroups.flatMap((g) => g.subtopics)
    if (allSubs.length === 0) return
    setGeneratingAll(true)
    setCourseProgress({ done: 0, total: allSubs.length })
    const failures: string[] = []
    for (let i = 0; i < allSubs.length; i++) {
      const st = allSubs[i]
      try {
        const result = await generateNodeSet(courseCode, st.subtopic_id)
        setNodeSetsBySubtopicId((prev) => ({ ...prev, [st.subtopic_id]: result }))
      } catch (error) {
        failures.push(st.title)
        // eslint-disable-next-line no-console
        console.error(`Node generation failed for ${st.subtopic_id}`, error)
      }
      setCourseProgress({ done: i + 1, total: allSubs.length })
    }
    setGeneratingAll(false)
    setCourseProgress(null)
    if (failures.length > 0) {
      showToast({
        title: 'Whole-course generation finished with errors',
        description: `Generated ${allSubs.length - failures.length}/${allSubs.length}. Failed: ${failures.join(', ')}.`,
        variant: 'destructive',
      })
    } else {
      showToast({
        title: 'All course nodes generated',
        description: `Draft node sets ready for ${allSubs.length} subtopic(s) across ${cloGroups.length} CLO(s). Review CLO by CLO, then approve.`,
        variant: 'success',
      })
    }
  }

  // Approve every draft node set in one CLO. Ungrounded sets surface the academic
  // guard; collect them and prompt once for a shared, recorded override reason
  // rather than silently rubber-stamping ungrounded sets.
  async function handleApproveClo(cloId: string) {
    const group = cloGroups.find((g) => g.clo_id === cloId)
    if (!group) return
    setApprovingCloId(cloId)
    const latestSets = { ...nodeSetsBySubtopicId }
    try {
      const needOverride: string[] = []
      for (const st of group.subtopics) {
        const ns = nodeSetsBySubtopicId[st.subtopic_id]
        if (!ns || ns.status === 'approved') continue
        try {
          const result = await approveNodeSet(courseCode, st.subtopic_id, { approver: role })
          latestSets[st.subtopic_id] = result
          setNodeSetsBySubtopicId((prev) => ({ ...prev, [st.subtopic_id]: result }))
        } catch (error) {
          if (error instanceof AcademicApprovalRequiredError) {
            needOverride.push(st.subtopic_id)
          } else {
            throw error
          }
        }
      }

      if (needOverride.length > 0) {
        const reason = window.prompt(
          `${needOverride.length} node set(s) in ${cloId} have NO reference grounding and are not academically approvable.\n\n` +
            'Recommended: run Reference Alignment first.\n\n' +
            'To approve them WITHOUT grounding anyway, type an override reason (it will be recorded):'
        )
        if (reason && reason.trim()) {
          for (const id of needOverride) {
            try {
              const result = await approveNodeSet(courseCode, id, {
                approver: role,
                overrideReason: reason.trim(),
              })
              latestSets[id] = result
              setNodeSetsBySubtopicId((prev) => ({ ...prev, [id]: result }))
            } catch (error) {
              // eslint-disable-next-line no-console
              console.error(`Override approval failed for ${id}`, error)
            }
          }
        } else {
          showToast({
            title: 'Some approvals skipped',
            description: `${needOverride.length} ungrounded node set(s) in ${cloId} were not approved.`,
          })
        }
      }

      showToast({
        title: `Approvals recorded for ${cloId}`,
        description: layer1Approved
          ? 'Layer 1 approved. Layer 2 — Experience Blueprint is now unlocked.'
          : 'Node sets approved.',
        variant: 'success',
      })

      const allApprovedInClo = group.subtopics.every(
        (s) => latestSets[s.subtopic_id]?.status === 'approved'
      )
      if (allApprovedInClo) {
        setCollapsedCloIds((prev) => new Set(prev).add(cloId))
      }
    } catch (error) {
      showToast({
        title: 'Approval failed',
        description: error instanceof Error ? error.message : 'Failed to approve node sets',
        variant: 'destructive',
      })
    } finally {
      setApprovingCloId(null)
    }
  }

  const solo = typeof soloLayer === 'number'
  const visibleLayers = solo
    ? NODE_ENGINE_LAYER_MAP.filter((l) => l.layer === soloLayer)
    : NODE_ENGINE_LAYER_MAP
  const goToLayer = (n: number) => {
    if (onNavigateLayer) onNavigateLayer(n)
    else setExpandedLayer(n)
  }

  return (
    <Card className={cn(solo && 'border-0 bg-transparent shadow-none')}>
      {!solo && (
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
            {layer2Approved && (
              <span className="ml-2 inline-flex items-center gap-1 text-emerald-600">
                <Check className="h-4 w-4" /> Layer 2 approved
              </span>
            )}
            {layer3Approved && (
              <span className="ml-2 inline-flex items-center gap-1 text-emerald-600">
                <Check className="h-4 w-4" /> Layer 3 approved
              </span>
            )}
          </CardDescription>
        </CardHeader>
      )}
      <CardContent className={cn('space-y-3', solo && 'p-0')}>
        {archLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading approved subtopics…
          </div>
        ) : (
          visibleLayers.map((layer) => {
            const status = layerStatus(layer)
            const open = solo ? layer.layer === soloLayer : expandedLayer === layer.layer
            return (
              <div
                key={layer.layer}
                className={cn(
                  'glass-strong rounded-xl',
                  (status === 'approved' || status === 'completed') && '!border-emerald-500/50'
                )}
              >
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 p-4 text-left"
                  onClick={() => {
                    if (solo) return
                    setExpandedLayer(open ? null : layer.layer)
                  }}
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
                      {!layer.active && layer.layer > 3 && (
                        <span className="text-xs text-muted-foreground">(upcoming)</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{layer.job}</p>
                    <p className="text-xs text-muted-foreground">Output: {layer.output}</p>
                  </div>
                  {!solo &&
                    (open ? (
                      <ChevronDown className="h-5 w-5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-5 w-5 shrink-0" />
                    ))}
                </button>

                {open && (
                  <div className="space-y-4 border-t border-border px-4 pb-4 pt-4">
                    {layer.layer === 1 ? (
                      <Layer1Body
                        status={status}
                        alignmentState={alignmentState}
                        nodeGenReady={nodeGenReady}
                        cloGroups={cloGroups}
                        nodeSetsBySubtopicId={nodeSetsBySubtopicId}
                        hydrating={hydrating}
                        generatingCloId={generatingCloId}
                        approvingCloId={approvingCloId}
                        batchProgress={batchProgress}
                        generatingAll={generatingAll}
                        courseProgress={courseProgress}
                        onGenerateAll={handleGenerateAllCourse}
                        query={query}
                        onQueryChange={setQuery}
                        onGenerateClo={handleGenerateClo}
                        onApproveClo={handleApproveClo}
                        collapsedCloIds={collapsedCloIds}
                        onToggleCloCollapsed={(cloId) =>
                          setCollapsedCloIds((prev) => {
                            const next = new Set(prev)
                            if (next.has(cloId)) next.delete(cloId)
                            else next.add(cloId)
                            return next
                          })
                        }
                        onReopenClo={async (cloId) => {
                          const group = cloGroups.find((g) => g.clo_id === cloId)
                          if (!group) return
                          for (const st of group.subtopics) {
                            if (nodeSetsBySubtopicId[st.subtopic_id]?.status === 'approved') {
                              const reopened = await reopenNodeSet(courseCode, st.subtopic_id)
                              setNodeSetsBySubtopicId((prev) => ({
                                ...prev,
                                [st.subtopic_id]: reopened,
                              }))
                            }
                          }
                          setCollapsedCloIds((prev) => {
                            const next = new Set(prev)
                            next.delete(cloId)
                            return next
                          })
                        }}
                        courseCode={courseCode}
                        onNodeSetUpdated={handleNodeSetUpdated}
                        layer1Approved={layer1Approved}
                        cloFullyApprovedCount={cloFullyApprovedCount}
                        cloTotalCount={cloGroups.length}
                        onContinueLayer2={() => goToLayer(2)}
                        solo={solo}
                      />
                    ) : layer.layer === 2 ? (
                      <>
                        <Layer2Body
                          status={status}
                          cloGroups={cloGroups}
                          nodeSetsBySubtopicId={nodeSetsBySubtopicId}
                          blueprintsByNodeId={blueprintsByNodeId}
                          hydrating={blueprintsHydrating}
                          busy={
                            generatingBlueprintCloId !== null || approvingBlueprintCloId !== null
                          }
                          generatingCloId={generatingBlueprintCloId}
                          approvingCloId={approvingBlueprintCloId}
                          onGenerateClo={handleGenerateBlueprintsClo}
                          onApproveClo={handleApproveBlueprintsClo}
                          onBlueprintUpdated={(nodeId, bp) =>
                            setBlueprintsByNodeId((prev) => ({ ...prev, [nodeId]: bp }))
                          }
                          layer2Approved={layer2Approved}
                          approverLabel={approverLabel}
                          courseCode={courseCode}
                          filters={layerFilters}
                          onFiltersChange={setLayerFilters}
                        />
                        {!solo && (
                          <Layer2ContinueCta
                            layer2Approved={layer2Approved}
                            onContinue={() => goToLayer(3)}
                          />
                        )}
                      </>
                    ) : layer.layer === 3 ? (
                      <>
                        <Layer3Body
                          status={status}
                          cloGroups={cloGroups}
                          nodeSetsBySubtopicId={nodeSetsBySubtopicId}
                          blueprintsByNodeId={blueprintsByNodeId}
                          contentSpecsByObjectId={contentSpecsByObjectId}
                          hydrating={contentSpecsHydrating}
                          busy={
                            generatingContentSpecCloId !== null || approvingContentSpecCloId !== null
                          }
                          generatingCloId={generatingContentSpecCloId}
                          approvingCloId={approvingContentSpecCloId}
                          onGenerateClo={handleGenerateContentSpecsClo}
                          onApproveClo={handleApproveContentSpecsClo}
                          onContentSpecUpdated={(objectId, spec) =>
                            setContentSpecsByObjectId((prev) => ({ ...prev, [objectId]: spec }))
                          }
                          layer3Approved={layer3Approved}
                          approverLabel={approverLabel}
                          courseCode={courseCode}
                          filters={layerFilters}
                          onFiltersChange={setLayerFilters}
                        />
                        {!solo && (
                          <Layer3ContinueCta
                            layer3Approved={layer3Approved}
                            onContinue={() => goToLayer(4)}
                          />
                        )}
                      </>
                    ) : layer.layer === 4 ? (
                      <>
                        <Layer4Body
                          status={status}
                          cloGroups={cloGroups}
                          nodeSetsBySubtopicId={nodeSetsBySubtopicId}
                          blueprintsByNodeId={blueprintsByNodeId}
                          contentSpecsByObjectId={contentSpecsByObjectId}
                          producedByObjectId={producedByObjectId}
                          hydrating={producedHydrating}
                          busy={producingTextCloId !== null}
                          producingCloId={producingTextCloId}
                          onProduceClo={handleProduceTextClo}
                          onProducedUpdated={(objectId, produced) =>
                            setProducedByObjectId((prev) => ({ ...prev, [objectId]: produced }))
                          }
                          layer4Complete={layer4Complete}
                          courseCode={courseCode}
                          filters={layerFilters}
                          onFiltersChange={setLayerFilters}
                        />
                        {!solo && (
                          <Layer4ContinueCta
                            layer4Complete={layer4Complete}
                            onContinue={() => goToLayer(5)}
                          />
                        )}
                      </>
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
  alignmentState: AlignmentStateSummary | null
  nodeGenReady: boolean
  cloGroups: CloGroup[]
  nodeSetsBySubtopicId: Record<string, NodeEngineNodeSet | null>
  hydrating: boolean
  generatingCloId: string | null
  approvingCloId: string | null
  batchProgress: { cloId: string; done: number; total: number } | null
  generatingAll: boolean
  courseProgress: { done: number; total: number } | null
  onGenerateAll: () => void
  query: string
  onQueryChange: (q: string) => void
  onGenerateClo: (cloId: string) => void
  onApproveClo: (cloId: string) => void
  collapsedCloIds: Set<string>
  onToggleCloCollapsed: (cloId: string) => void
  onReopenClo: (cloId: string) => Promise<void>
  courseCode: string
  onNodeSetUpdated: (subtopicId: string, nodeSet: NodeEngineNodeSet) => void
  layer1Approved: boolean
  cloFullyApprovedCount: number
  cloTotalCount: number
  onContinueLayer2: () => void
  solo: boolean
}

interface FlatNodeMatch {
  node: NodeEngineNode
  cloId: string
  subtopicId: string
  subtopicTitle: string
  groundingSource?: NodeEngineGroundingSource
}

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        className
      )}
    >
      {children}
    </span>
  )
}

function Layer1Body({
  status,
  alignmentState,
  nodeGenReady,
  cloGroups,
  nodeSetsBySubtopicId,
  hydrating,
  generatingCloId,
  approvingCloId,
  batchProgress,
  generatingAll,
  courseProgress,
  onGenerateAll,
  query,
  onQueryChange,
  onGenerateClo,
  onApproveClo,
  collapsedCloIds,
  onToggleCloCollapsed,
  onReopenClo,
  courseCode,
  onNodeSetUpdated,
  layer1Approved,
  cloFullyApprovedCount,
  cloTotalCount,
  onContinueLayer2,
  solo,
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

  const busy = generatingCloId !== null || approvingCloId !== null || generatingAll
  const generateBlocked = !nodeGenReady
  const totalSubtopics = cloGroups.reduce((sum, g) => sum + g.subtopics.length, 0)
  const totalGenerated = cloGroups.reduce(
    (sum, g) => sum + g.subtopics.filter((s) => nodeSetsBySubtopicId[s.subtopic_id]).length,
    0
  )

  const trimmedQuery = query.trim().toLowerCase()
  const searchMatches: FlatNodeMatch[] = trimmedQuery
    ? cloGroups.flatMap((group) =>
        group.subtopics.flatMap((st) => {
          const ns = nodeSetsBySubtopicId[st.subtopic_id]
          if (!ns) return [] as FlatNodeMatch[]
          return ns.nodes
            .filter(
              (n) =>
                n.node_id.toLowerCase().includes(trimmedQuery) ||
                n.node_title.toLowerCase().includes(trimmedQuery) ||
                n.knowledge_component.toLowerCase().includes(trimmedQuery)
            )
            .map((node) => ({
              node,
              cloId: group.clo_id,
              subtopicId: st.subtopic_id,
              subtopicTitle: st.title,
              groundingSource: ns.grounding_summary?.grounding_source,
            }))
        })
      )
    : []

  return (
    <div className="space-y-4">
      {generateBlocked && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {alignmentState?.pending_activation
              ? `Reference alignment preview is not active (node-gen uses ${alignmentState.active_tagged_chunk_count} tag(s) in the database). Activate tags in Layer 6 Step B above.`
              : alignmentState?.is_stale
                ? alignmentState.stale_reason ??
                  'Alignment is stale. Preview and activate tags again before generating nodes.'
                : 'Complete Reference Alignment (Layer 6 Step B) before generating mastery nodes.'}
          </span>
        </div>
      )}

      <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
        Generate all nodes for a whole CLO in one click, review the subtopics grouped below, then
        approve the CLO. Review by exception: only the nodes that need your judgment (assessment-blocking
        or high-severity misconceptions, weak/thin grounding, generator uncertainty, or summative prep)
        are flagged{' '}
        <span className="font-medium text-amber-700 dark:text-amber-400">Must review</span>. Every other
        node is marked{' '}
        <span className="font-medium text-foreground">Can proceed</span> — still fully open to view, just
        not gating.
      </p>

      {/* Whole-course generation: kick off every CLO's subtopics in one run.
          Review still happens CLO by CLO below. */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
        <Button
          size="sm"
          variant="default"
          onClick={onGenerateAll}
          disabled={busy || totalSubtopics === 0 || generateBlocked}
        >
          {generatingAll ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : totalGenerated > 0 ? (
            <RefreshCw className="mr-2 h-4 w-4" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {totalGenerated > 0
            ? 'Regenerate all nodes (whole course)'
            : 'Generate all nodes (whole course)'}
        </Button>
        {generatingAll && courseProgress ? (
          <span className="text-xs text-muted-foreground">
            Generating {courseProgress.done}/{courseProgress.total} subtopics across the course…
            keep this tab open.
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {totalGenerated}/{totalSubtopics} subtopics generated across {cloGroups.length} CLO(s).
            Runs sequentially; completed subtopics are saved as it goes.
          </span>
        )}
      </div>

      {/* Spot-check search across every generated node in the course. */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Spot-check: search nodes by code, title, or knowledge component…"
          className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {hydrating && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading existing node sets…
        </div>
      )}

      {trimmedQuery ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {searchMatches.length} node(s) match “{query.trim()}”.
          </p>
          {searchMatches.map(({ node, cloId, subtopicId, subtopicTitle, groundingSource }) => (
            <div key={node.node_id}>
              <p className="mb-1 text-xs text-muted-foreground">
                {cloId} · {subtopicTitle}
              </p>
              <NodeCard
                node={node}
                index={isMustReviewNode(node, groundingSource) ? 0 : 1}
                groundingSource={groundingSource}
                courseCode={courseCode}
                subtopicId={subtopicId}
                onNodeSetUpdated={(ns) => onNodeSetUpdated(subtopicId, ns)}
              />
            </div>
          ))}
        </div>
      ) : (
        <>
        {cloGroups.map((group) => (
          <CloGroupCard
            key={group.clo_id}
            group={group}
            nodeSetsBySubtopicId={nodeSetsBySubtopicId}
            generating={generatingCloId === group.clo_id}
            approving={approvingCloId === group.clo_id}
            busy={busy}
            generateBlocked={generateBlocked}
            progress={batchProgress && batchProgress.cloId === group.clo_id ? batchProgress : null}
            onGenerate={() => onGenerateClo(group.clo_id)}
            onApprove={() => onApproveClo(group.clo_id)}
            collapsed={collapsedCloIds.has(group.clo_id)}
            onToggleCollapsed={() => onToggleCloCollapsed(group.clo_id)}
            onReopen={() => onReopenClo(group.clo_id)}
            courseCode={courseCode}
            onNodeSetUpdated={onNodeSetUpdated}
          />
        ))}

        {!solo && (
          <div className="rounded-md border border-border bg-muted/20 p-4">
            <Button size="sm" variant="default" disabled={!layer1Approved} onClick={onContinueLayer2}>
              Continue to Layer 2 — Experience Blueprint
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
            {!layer1Approved && cloTotalCount > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {cloFullyApprovedCount} of {cloTotalCount} CLOs approved · approve all node sets to
                continue
              </p>
            )}
          </div>
        )}
        </>
      )}
    </div>
  )
}

interface CloGroupCardProps {
  group: CloGroup
  nodeSetsBySubtopicId: Record<string, NodeEngineNodeSet | null>
  generating: boolean
  approving: boolean
  busy: boolean
  generateBlocked: boolean
  progress: { cloId: string; done: number; total: number } | null
  onGenerate: () => void
  onApprove: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  onReopen: () => Promise<void>
  courseCode: string
  onNodeSetUpdated: (subtopicId: string, nodeSet: NodeEngineNodeSet) => void
}

function CloGroupCard({
  group,
  nodeSetsBySubtopicId,
  generating,
  approving,
  busy,
  generateBlocked,
  progress,
  onGenerate,
  onApprove,
  collapsed,
  onToggleCollapsed,
  onReopen,
  courseCode,
  onNodeSetUpdated,
}: CloGroupCardProps) {
  const entries = group.subtopics.map((s) => ({
    subtopic: s,
    nodeSet: nodeSetsBySubtopicId[s.subtopic_id] ?? null,
  }))
  const generatedCount = entries.filter((e) => e.nodeSet).length
  const approvedCount = entries.filter((e) => e.nodeSet?.status === 'approved').length
  const allNodes = entries.flatMap((e) => e.nodeSet?.nodes ?? [])
  // Count must_review vs can_proceed using each set's own grounding source.
  const mustReviewCount = entries.reduce(
    (sum, e) =>
      sum +
      (e.nodeSet?.nodes ?? []).filter((n) =>
        isMustReviewNode(n, e.nodeSet?.grounding_summary?.grounding_source)
      ).length,
    0
  )
  const canProceedCount = allNodes.length - mustReviewCount
  const pendingApproval = generatedCount > approvedCount
  const allApproved = generatedCount > 0 && approvedCount === group.subtopics.length

  if (collapsed && allApproved) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        className={cn(
          'flex w-full items-center justify-between gap-3 rounded-lg border p-4 text-left',
          'border-emerald-500/40 bg-emerald-500/5'
        )}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-foreground">{group.clo_id}</span>
          <Pill className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" /> All approved
          </Pill>
          <span className="text-muted-foreground">
            · {allNodes.length} node{allNodes.length === 1 ? '' : 's'} · {group.subtopics.length}{' '}
            subtopic{group.subtopics.length === 1 ? '' : 's'}
          </span>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
      </button>
    )
  }

  return (
    <div
      className={cn(
        'rounded-lg border',
        allApproved ? 'border-emerald-500/40' : 'border-border'
      )}
    >
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.clo_id}
            </p>
            <p className="text-sm font-medium">{group.refined_clo}</p>
          </div>
          {generatedCount > 0 && approvedCount === group.subtopics.length && (
            <Pill className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" /> All approved
            </Pill>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Pill className="bg-muted text-muted-foreground">
            {group.subtopics.length} subtopic(s)
          </Pill>
          <Pill className="bg-blue-500/15 text-blue-600 dark:text-blue-400">
            {generatedCount}/{group.subtopics.length} generated
          </Pill>
          <Pill className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            {approvedCount}/{group.subtopics.length} approved
          </Pill>
          {allNodes.length > 0 && (
            <Pill
              className={cn(
                mustReviewCount > 0
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                  : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              )}
            >
              <AlertTriangle className="h-3 w-3" />
              {mustReviewCount} need your review · {canProceedCount} can proceed
            </Pill>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onGenerate} disabled={busy || generateBlocked}>
            {generating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : generatedCount > 0 ? (
              <RefreshCw className="mr-2 h-4 w-4" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {generatedCount > 0
              ? `Regenerate all for ${group.clo_id}`
              : `Generate all nodes for ${group.clo_id}`}
          </Button>

          {pendingApproval && (
            <Button size="sm" variant="default" onClick={onApprove} disabled={busy}>
              {approving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Approve all for {group.clo_id}
            </Button>
          )}

          {progress && (
            <span className="text-xs text-muted-foreground">
              Generating {progress.done}/{progress.total} subtopics…
            </span>
          )}

          {allApproved && (
            <Button size="sm" variant="outline" onClick={() => void onReopen()} disabled={busy}>
              Reopen for review
            </Button>
          )}
        </div>
      </div>

      {/* Subtopic-grouped triage. Each subtopic collapses; critical nodes inside
          start expanded so they draw the eye first. */}
      {generatedCount > 0 && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          {entries.map(({ subtopic, nodeSet }, subIndex) => {
            const nodes = nodeSet?.nodes ?? []
            const subGroundingSource = nodeSet?.grounding_summary?.grounding_source
            const subMustReview = nodes.filter((n) => isMustReviewNode(n, subGroundingSource)).length
            return (
              <details key={subtopic.subtopic_id} className="rounded-md border border-border">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">
                    <span className="text-muted-foreground">ST{subIndex + 1}:</span>{' '}
                    {subtopic.title}
                  </span>
                  {nodeSet ? (
                    <>
                      <Pill className="bg-muted text-muted-foreground">
                        {nodes.length} node(s)
                      </Pill>
                      <Pill
                        className={
                          nodeSet.status === 'approved'
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        }
                      >
                        {nodeSet.status === 'approved' ? (
                          <>
                            <Check className="h-3 w-3" /> Approved
                          </>
                        ) : (
                          'Draft'
                        )}
                      </Pill>
                      {nodeSet.grounding_summary && (
                        <Pill
                          className={
                            nodeSet.grounding_summary.academic_ready
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          }
                        >
                          {nodeSet.grounding_summary.academic_ready
                            ? 'Grounded'
                            : 'Ungrounded'}
                        </Pill>
                      )}
                      {subMustReview > 0 && (
                        <Pill className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> {subMustReview} need your review
                        </Pill>
                      )}
                    </>
                  ) : (
                    <Pill className="bg-muted text-muted-foreground">Not generated yet</Pill>
                  )}
                </summary>
                {nodeSet && (
                  <div className="space-y-2 border-t border-border px-3 py-3">
                    {nodes.map((node) => (
                      <NodeCard
                        key={node.node_id}
                        node={node}
                        index={isMustReviewNode(node, subGroundingSource) ? 0 : 1}
                        groundingSource={subGroundingSource}
                        courseCode={courseCode}
                        subtopicId={subtopic.subtopic_id}
                        onNodeSetUpdated={(ns) => onNodeSetUpdated(subtopic.subtopic_id, ns)}
                      />
                    ))}
                  </div>
                )}
              </details>
            )
          })}
        </div>
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
