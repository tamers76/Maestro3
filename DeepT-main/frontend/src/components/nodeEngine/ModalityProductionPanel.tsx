import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  Video,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { showToast } from '@/components/ui/Toaster'
import { cn } from '@/lib/utils'
import {
  produceLayer4Object,
  producedVideoStreamUrl,
  refreshVideoRender,
  renderVideoObject,
  type BlueprintVehicle,
  type NodeEngineBlueprint,
  type NodeEngineBlueprintObject,
  type NodeEngineContentSpec,
  type NodeEngineNodeSet,
  type NodeEngineProducedObject,
  type NodeEngineStructuredVisual,
  type NodeEngineTextSegment,
  type RenderStyleOverride,
  type VideoRenderStyle,
} from '@/services/api'
import { StructuredVisualRenderer } from './StructuredVisualRenderer'
import {
  countLayerMatches,
  filterVisibleObjects,
  isFilterActive,
  nodeIsVisible,
  type ApprovedNodeRef,
  type NodeEngineFilterState,
} from './nodeEngineFilters'
import { MasteryNodeSummary, NodeEngineFilterBar, ObjectRowHeader } from './NodeEngineUi'

interface CloProductionGroup {
  clo_id: string
  refined_clo: string
  nodes: ApprovedNodeRef[]
}

interface SubtopicProductionGroup {
  subtopicId: string
  subtopicTitle: string
  nodes: ApprovedNodeRef[]
}

function Pill({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
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

function groupNodesBySubtopic(nodes: ApprovedNodeRef[]): SubtopicProductionGroup[] {
  const byId = new Map<string, SubtopicProductionGroup>()
  for (const ref of nodes) {
    const existing = byId.get(ref.subtopicId)
    if (existing) {
      existing.nodes.push(ref)
    } else {
      byId.set(ref.subtopicId, {
        subtopicId: ref.subtopicId,
        subtopicTitle: ref.subtopicTitle,
        nodes: [ref],
      })
    }
  }
  return [...byId.values()]
    .sort((a, b) => a.subtopicId.localeCompare(b.subtopicId))
    .map((group) => ({
      ...group,
      nodes: [...group.nodes].sort((a, b) => a.node.order - b.node.order),
    }))
}

function approvedSpecObjects(
  refs: ApprovedNodeRef[],
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>,
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>
): string[] {
  const ids: string[] = []
  for (const ref of refs) {
    const bp = blueprintsByNodeId[ref.node.node_id]
    if (!bp) continue
    for (const obj of bp.objects) {
      if (contentSpecsByObjectId[obj.object_id]?.status === 'approved') {
        ids.push(obj.object_id)
      }
    }
  }
  return ids
}

function countProduced(
  objectIds: string[],
  producedByObjectId: Record<string, NodeEngineProducedObject | null>
): number {
  return objectIds.filter((id) => producedByObjectId[id]).length
}

function findFirstIncompleteSubtopic(
  groups: CloProductionGroup[],
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>,
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>,
  producedByObjectId: Record<string, NodeEngineProducedObject | null>
): { cloId: string; subtopicId: string } | null {
  for (const group of groups) {
    for (const st of groupNodesBySubtopic(group.nodes)) {
      const approvedIds = approvedSpecObjects(st.nodes, blueprintsByNodeId, contentSpecsByObjectId)
      if (approvedIds.length === 0) continue
      const produced = countProduced(approvedIds, producedByObjectId)
      if (produced < approvedIds.length) {
        return { cloId: group.clo_id, subtopicId: st.subtopicId }
      }
    }
  }
  return null
}

function buildProductionGroups(
  cloGroups: Array<{
    clo_id: string
    refined_clo: string
    subtopics: Array<{ subtopic_id: string; title: string }>
  }>,
  nodeSetsBySubtopicId: Record<string, NodeEngineNodeSet | null>,
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>,
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>
): CloProductionGroup[] {
  return cloGroups
    .map((group) => {
      const nodes: ApprovedNodeRef[] = []
      for (const st of group.subtopics) {
        const nodeSet = nodeSetsBySubtopicId[st.subtopic_id]
        if (nodeSet?.status !== 'approved') continue
        for (const node of nodeSet.nodes) {
          if (node.status !== 'approved') continue
          const bp = blueprintsByNodeId[node.node_id]
          if (bp?.status !== 'approved') continue
          const hasApprovedSpec = bp.objects.some(
            (o) => contentSpecsByObjectId[o.object_id]?.status === 'approved'
          )
          if (hasApprovedSpec) {
            nodes.push({
              node,
              subtopicId: st.subtopic_id,
              subtopicTitle: st.title,
              cloId: group.clo_id,
            })
          }
        }
      }
      return { clo_id: group.clo_id, refined_clo: group.refined_clo, nodes }
    })
    .filter((g) => g.nodes.length > 0)
}

function extractSegments(produced: NodeEngineProducedObject | null): NodeEngineTextSegment[] {
  const raw = produced?.envelope?.modality_specific?.segments
  return Array.isArray(raw) ? raw : []
}

function resolveProductionVehicle(
  spec: NodeEngineContentSpec | null | undefined,
  obj: NodeEngineBlueprintObject
): BlueprintVehicle {
  return spec?.suggested_vehicle ?? obj.suggested_vehicle
}

function extractHeyGenPrompt(produced: NodeEngineProducedObject | null): string | null {
  const ms = produced?.envelope?.modality_specific
  if (!ms) return null
  return ms.heygen_prompt ?? ms.video_brief?.heygen_prompt_payload?.prompt ?? null
}

function extractTranscript(produced: NodeEngineProducedObject | null): string | null {
  const ms = produced?.envelope?.modality_specific
  if (!ms) return null
  return ms.transcript ?? ms.video_brief?.narration?.full_script ?? null
}

function extractFidelityNotes(produced: NodeEngineProducedObject | null): string[] {
  const ms = produced?.envelope?.modality_specific
  if (!ms) return []
  const notes =
    ms.fidelity_check?.notes ??
    ms.video_brief?.fidelity_check?.notes ??
    []
  return Array.isArray(notes) ? notes : []
}

function countScriptWords(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length
}

const VIDEO_SCRIPT_MAX_WORDS = 420

function extractScriptWordCount(produced: NodeEngineProducedObject | null): number | null {
  const ms = produced?.envelope?.modality_specific
  if (!ms) return null
  if (typeof ms.script_word_count === 'number') return ms.script_word_count
  const script = ms.transcript ?? ms.video_brief?.narration?.full_script
  return typeof script === 'string' ? countScriptWords(script) : null
}

async function produceObject(
  courseCode: string,
  subtopicId: string,
  nodeId: string,
  objectId: string,
  spec: NodeEngineContentSpec | null | undefined,
  obj: NodeEngineBlueprintObject,
  renderStyleOverride?: RenderStyleOverride
): Promise<NodeEngineProducedObject> {
  const vehicle = resolveProductionVehicle(spec, obj)
  return produceLayer4Object(courseCode, subtopicId, nodeId, objectId, vehicle, renderStyleOverride)
}

/** Video spec still holding Phase A text placeholder (or any vehicle ≠ produced modality). */
export function isModalityProductionMismatch(
  spec: NodeEngineContentSpec | null | undefined,
  produced: NodeEngineProducedObject | null | undefined
): boolean {
  if (!spec || !produced) return false
  return spec.suggested_vehicle !== produced.produced_modality
}

function isLegacyTextEquivalentMessage(text: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes('text equivalent') || lower.includes('produced as text equivalent')
}

/** True when Layer 3 spec was updated after production, or output modality no longer matches spec. */
export function isProductionStale(
  spec: NodeEngineContentSpec | null | undefined,
  produced: NodeEngineProducedObject | null | undefined
): boolean {
  if (!spec || !produced) return false
  if (isModalityProductionMismatch(spec, produced)) return true
  return new Date(spec.updated_at).getTime() > new Date(produced.produced_at).getTime()
}

function countStaleProductions(
  objectIds: string[],
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>,
  producedByObjectId: Record<string, NodeEngineProducedObject | null>
): number {
  return objectIds.filter((id) =>
    isProductionStale(contentSpecsByObjectId[id], producedByObjectId[id])
  ).length
}

interface StaleProductionTarget {
  subtopicId: string
  nodeId: string
  objectId: string
  spec: NodeEngineContentSpec
  obj: NodeEngineBlueprintObject
}

function collectStaleProductionTargets(
  groups: CloProductionGroup[],
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>,
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>,
  producedByObjectId: Record<string, NodeEngineProducedObject | null>
): StaleProductionTarget[] {
  const targets: StaleProductionTarget[] = []
  for (const group of groups) {
    for (const ref of group.nodes) {
      const bp = blueprintsByNodeId[ref.node.node_id]
      if (!bp) continue
      for (const obj of bp.objects) {
        if (contentSpecsByObjectId[obj.object_id]?.status !== 'approved') continue
        if (!isProductionStale(contentSpecsByObjectId[obj.object_id], producedByObjectId[obj.object_id])) {
          continue
        }
        targets.push({
          subtopicId: ref.subtopicId,
          nodeId: ref.node.node_id,
          objectId: obj.object_id,
          spec: contentSpecsByObjectId[obj.object_id]!,
          obj,
        })
      }
    }
  }
  return targets
}

export interface ProduceTextBatchOptions {
  regenerate?: boolean
}

export interface Layer4BodyProps {
  status: 'locked' | 'available' | 'running' | 'needs_review' | 'approved' | 'completed'
  cloGroups: Array<{
    clo_id: string
    refined_clo: string
    subtopics: Array<{ subtopic_id: string; title: string }>
  }>
  nodeSetsBySubtopicId: Record<string, NodeEngineNodeSet | null>
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>
  producedByObjectId: Record<string, NodeEngineProducedObject | null>
  hydrating: boolean
  busy: boolean
  producingCloId: string | null
  onProduceClo: (cloId: string, options?: ProduceTextBatchOptions) => Promise<void>
  onProducedUpdated: (objectId: string, produced: NodeEngineProducedObject) => void
  layer4Complete: boolean
  courseCode: string
  filters: NodeEngineFilterState
  onFiltersChange: (filters: NodeEngineFilterState) => void
}

export function Layer4Body({
  status,
  cloGroups,
  nodeSetsBySubtopicId,
  blueprintsByNodeId,
  contentSpecsByObjectId,
  producedByObjectId,
  hydrating,
  busy,
  producingCloId,
  onProduceClo,
  onProducedUpdated,
  layer4Complete,
  courseCode,
  filters,
  onFiltersChange,
}: Layer4BodyProps) {
  const [regeneratingStale, setRegeneratingStale] = useState(false)
  const groups = useMemo(
    () =>
      buildProductionGroups(
        cloGroups,
        nodeSetsBySubtopicId,
        blueprintsByNodeId,
        contentSpecsByObjectId
      ),
    [cloGroups, nodeSetsBySubtopicId, blueprintsByNodeId, contentSpecsByObjectId]
  )

  const allApprovedObjectIds = useMemo(() => {
    const ids: string[] = []
    for (const group of groups) {
      ids.push(...approvedSpecObjects(group.nodes, blueprintsByNodeId, contentSpecsByObjectId))
    }
    return ids
  }, [groups, blueprintsByNodeId, contentSpecsByObjectId])

  const producedCount = countProduced(allApprovedObjectIds, producedByObjectId)
  const staleCount = countStaleProductions(
    allApprovedObjectIds,
    contentSpecsByObjectId,
    producedByObjectId
  )

  const staleTargets = useMemo(
    () =>
      collectStaleProductionTargets(
        groups,
        blueprintsByNodeId,
        contentSpecsByObjectId,
        producedByObjectId
      ),
    [groups, blueprintsByNodeId, contentSpecsByObjectId, producedByObjectId]
  )

  const layerBusy = busy || regeneratingStale

  async function handleRegenerateStale() {
    if (staleTargets.length === 0) return
    setRegeneratingStale(true)
    const failures: string[] = []
    for (const target of staleTargets) {
      try {
        const record = await produceObject(
          courseCode,
          target.subtopicId,
          target.nodeId,
          target.objectId,
          target.spec,
          target.obj
        )
        onProducedUpdated(target.objectId, record)
      } catch {
        failures.push(target.objectId)
      }
    }
    setRegeneratingStale(false)
    if (failures.length > 0) {
      showToast({
        title: 'Some stale objects failed to regenerate',
        description: failures.slice(0, 3).join(', '),
        variant: 'destructive',
      })
    } else {
      showToast({
        title: 'Stale production updated',
        description: `Regenerated ${staleTargets.length} object(s) from newer Layer 3 specs.`,
        variant: 'success',
      })
    }
  }

  const firstIncomplete = useMemo(
    () =>
      findFirstIncompleteSubtopic(
        groups,
        blueprintsByNodeId,
        contentSpecsByObjectId,
        producedByObjectId
      ),
    [groups, blueprintsByNodeId, contentSpecsByObjectId, producedByObjectId]
  )

  const allNodes = useMemo(() => groups.flatMap((g) => g.nodes), [groups])

  const matchCount = useMemo(
    () =>
      countLayerMatches(
        allNodes,
        filters,
        'production',
        (nodeId) => blueprintsByNodeId[nodeId],
        (ref) => {
          const bp = blueprintsByNodeId[ref.node.node_id]
          return (
            bp?.objects.filter(
              (o) => contentSpecsByObjectId[o.object_id]?.status === 'approved'
            ) ?? []
          )
        },
        (objectId) => contentSpecsByObjectId[objectId],
        (objectId) => producedByObjectId[objectId]
      ),
    [allNodes, filters, blueprintsByNodeId, contentSpecsByObjectId, producedByObjectId]
  )

  const filterActive = isFilterActive(filters)

  if (status === 'locked') {
    return (
      <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Approve at least one content specification in Layer 3 before producing learning objects.
      </div>
    )
  }

  if (hydrating) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading produced objects…
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No approved content specs yet. Generate and approve Layer 3 specs first (subtopic by
        subtopic).
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <NodeEngineFilterBar
        layer="production"
        filters={filters}
        onChange={onFiltersChange}
        matchCount={filterActive ? matchCount : undefined}
      />

      <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Layer 4 — modality production</p>
        <p className="mt-1">
          Each subtopic starts <strong className="font-medium text-foreground">collapsed</strong> —
          only the next subtopic needing production opens automatically.{' '}
          <strong className="font-medium text-foreground">Text</strong> objects produce structured
          segments; <strong className="font-medium text-foreground">video</strong> objects produce a{' '}
          <strong className="font-medium text-foreground">HeyGen-ready prompt</strong> and transcript
          (render when the HeyGen API is connected). After Layer 2 or Layer 3 changes, use{' '}
          <strong className="font-medium text-foreground">Regenerate</strong> at CLO, subtopic, node,
          or object level.
        </p>
      </div>

      {staleCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-medium">{staleCount}</span> object
              {staleCount === 1 ? '' : 's'} need regeneration (newer Layer 3 specs or video brief upgrade).
            </span>
          </div>
          <Button
            size="sm"
            variant="default"
            className="shrink-0"
            onClick={() => void handleRegenerateStale()}
            disabled={layerBusy}
          >
            {regeneratingStale ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Regenerate {staleCount} stale
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill className="bg-muted text-muted-foreground">
          {allApprovedObjectIds.length} approved spec(s)
        </Pill>
        <Pill
          className={
            layer4Complete
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
              : 'bg-amber-500/15 text-amber-800 dark:text-amber-400'
          }
        >
          {producedCount}/{allApprovedObjectIds.length} produced
        </Pill>
      </div>

      {groups.map((group) => {
        const cloApprovedIds = approvedSpecObjects(
          group.nodes,
          blueprintsByNodeId,
          contentSpecsByObjectId
        )
        const cloProduced = countProduced(cloApprovedIds, producedByObjectId)
        return (
        <CloProductionSection
          key={group.clo_id}
          group={group}
          defaultOpen={firstIncomplete?.cloId === group.clo_id}
          firstIncompleteSubtopicId={firstIncomplete?.subtopicId ?? null}
          blueprintsByNodeId={blueprintsByNodeId}
          contentSpecsByObjectId={contentSpecsByObjectId}
          producedByObjectId={producedByObjectId}
          busy={layerBusy}
          producing={producingCloId === group.clo_id}
          onProduce={() =>
            void onProduceClo(group.clo_id, { regenerate: cloProduced > 0 })
          }
          cloProducedCount={cloProduced}
          cloStaleCount={countStaleProductions(
            cloApprovedIds,
            contentSpecsByObjectId,
            producedByObjectId
          )}
          onProducedUpdated={onProducedUpdated}
          courseCode={courseCode}
          filters={filters}
          filterActive={filterActive}
        />
        )
      })}

      {filterActive && matchCount.nodes === 0 && (
        <p className="text-sm text-muted-foreground">No nodes or objects match the current filters.</p>
      )}
    </div>
  )
}

function CloProductionSection({
  group,
  defaultOpen,
  firstIncompleteSubtopicId,
  blueprintsByNodeId,
  contentSpecsByObjectId,
  producedByObjectId,
  busy,
  producing,
  onProduce,
  cloProducedCount,
  cloStaleCount,
  onProducedUpdated,
  courseCode,
  filters,
  filterActive,
}: {
  group: CloProductionGroup
  defaultOpen: boolean
  firstIncompleteSubtopicId: string | null
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>
  producedByObjectId: Record<string, NodeEngineProducedObject | null>
  busy: boolean
  producing: boolean
  onProduce: () => void
  cloProducedCount: number
  cloStaleCount: number
  onProducedUpdated: (objectId: string, produced: NodeEngineProducedObject) => void
  courseCode: string
  filters: NodeEngineFilterState
  filterActive: boolean
}) {
  const approvedIds = approvedSpecObjects(group.nodes, blueprintsByNodeId, contentSpecsByObjectId)
  const produced = countProduced(approvedIds, producedByObjectId)
  const allProduced = approvedIds.length > 0 && produced === approvedIds.length
  const subtopicGroups = groupNodesBySubtopic(group.nodes)

  return (
    <details
      className={cn(
        'rounded-lg border',
        allProduced ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border bg-card'
      )}
      open={defaultOpen}
    >
      <summary className="cursor-pointer px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {group.clo_id}
        </span>
        <p className="mt-0.5 text-sm font-medium leading-snug">{group.refined_clo}</p>
        <span className="text-xs text-muted-foreground">
          {produced}/{approvedIds.length} object(s) produced
        </span>
        {allProduced && (
          <Pill className="ml-2 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            <Check className="h-3 w-3" /> CLO complete
          </Pill>
        )}
      </summary>
      <div className="space-y-3 border-t border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onProduce} disabled={busy}>
            {producing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : cloProducedCount > 0 ? (
              <RefreshCw className="mr-2 h-4 w-4" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {cloProducedCount > 0
              ? `Regenerate entire ${group.clo_id}`
              : `Produce all for ${group.clo_id} (optional batch)`}
          </Button>
          {cloStaleCount > 0 && (
            <span className="text-xs text-amber-700 dark:text-amber-400">
              {cloStaleCount} stale in this CLO — use the banner button above or expand subtopics.
            </span>
          )}
        </div>

        {subtopicGroups.map((subtopic, subtopicIndex) => {
          const visibleNodes = filterActive
            ? subtopic.nodes.filter((ref) => {
                const bp = blueprintsByNodeId[ref.node.node_id]
                const approvedObjects =
                  bp?.objects.filter(
                    (o) => contentSpecsByObjectId[o.object_id]?.status === 'approved'
                  ) ?? []
                return nodeIsVisible(ref, approvedObjects, filters, {
                  layer: 'production',
                  blueprint: bp,
                  getContentSpec: (id) => contentSpecsByObjectId[id],
                  getProduced: (id) => producedByObjectId[id],
                })
              })
            : subtopic.nodes
          if (filterActive && visibleNodes.length === 0) return null
          const stApprovedIds = approvedSpecObjects(
            visibleNodes,
            blueprintsByNodeId,
            contentSpecsByObjectId
          )
          const stStale = countStaleProductions(
            stApprovedIds,
            contentSpecsByObjectId,
            producedByObjectId
          )
          return (
          <SubtopicProductionSection
            key={subtopic.subtopicId}
            subtopic={{ ...subtopic, nodes: visibleNodes }}
            subtopicIndex={subtopicIndex + 1}
            defaultOpen={
              firstIncompleteSubtopicId === subtopic.subtopicId ||
              stStale > 0 ||
              (filterActive && visibleNodes.length > 0)
            }
            staleCount={stStale}
            blueprintsByNodeId={blueprintsByNodeId}
            contentSpecsByObjectId={contentSpecsByObjectId}
            producedByObjectId={producedByObjectId}
            busy={busy}
            onProducedUpdated={onProducedUpdated}
            courseCode={courseCode}
            filters={filters}
            filterActive={filterActive}
          />
          )
        })}
      </div>
    </details>
  )
}

function SubtopicProductionSection({
  subtopic,
  subtopicIndex,
  defaultOpen,
  staleCount,
  blueprintsByNodeId,
  contentSpecsByObjectId,
  producedByObjectId,
  busy,
  onProducedUpdated,
  courseCode,
  filters,
  filterActive,
}: {
  subtopic: SubtopicProductionGroup
  subtopicIndex: number
  defaultOpen: boolean
  staleCount: number
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>
  producedByObjectId: Record<string, NodeEngineProducedObject | null>
  busy: boolean
  onProducedUpdated: (objectId: string, produced: NodeEngineProducedObject) => void
  courseCode: string
  filters: NodeEngineFilterState
  filterActive: boolean
}) {
  const [producing, setProducing] = useState(false)
  const [regeneratingStale, setRegeneratingStale] = useState(false)
  const approvedIds = approvedSpecObjects(subtopic.nodes, blueprintsByNodeId, contentSpecsByObjectId)
  const produced = countProduced(approvedIds, producedByObjectId)
  const allProduced = approvedIds.length > 0 && produced === approvedIds.length

  async function handleRegenerateStaleSubtopic() {
    setRegeneratingStale(true)
    const failures: string[] = []
    for (const ref of subtopic.nodes) {
      const bp = blueprintsByNodeId[ref.node.node_id]
      if (!bp) continue
      for (const obj of bp.objects) {
        if (contentSpecsByObjectId[obj.object_id]?.status !== 'approved') continue
        if (!isProductionStale(contentSpecsByObjectId[obj.object_id], producedByObjectId[obj.object_id])) {
          continue
        }
        try {
          const record = await produceObject(
            courseCode,
            ref.subtopicId,
            ref.node.node_id,
            obj.object_id,
            contentSpecsByObjectId[obj.object_id],
            obj
          )
          onProducedUpdated(obj.object_id, record)
        } catch {
          failures.push(obj.object_id)
        }
      }
    }
    setRegeneratingStale(false)
    if (failures.length > 0) {
      showToast({
        title: 'Some stale objects failed',
        description: failures.slice(0, 3).join(', '),
        variant: 'destructive',
      })
    } else {
      showToast({
        title: `Stale output regenerated for ${subtopic.subtopicId}`,
        variant: 'success',
      })
    }
  }

  async function handleProduceSubtopic(regenerate: boolean) {
    setProducing(true)
    const failures: string[] = []
    for (const ref of subtopic.nodes) {
      const bp = blueprintsByNodeId[ref.node.node_id]
      if (!bp) continue
      for (const obj of bp.objects) {
        if (contentSpecsByObjectId[obj.object_id]?.status !== 'approved') continue
        if (!regenerate && producedByObjectId[obj.object_id]) continue
        try {
          const record = await produceObject(
            courseCode,
            ref.subtopicId,
            ref.node.node_id,
            obj.object_id,
            contentSpecsByObjectId[obj.object_id],
            obj
          )
          onProducedUpdated(obj.object_id, record)
        } catch (error) {
          failures.push(obj.object_id)
          // eslint-disable-next-line no-console
          console.error('Produce failed', obj.object_id, error)
        }
      }
    }
    setProducing(false)
    if (failures.length > 0) {
      showToast({
        title: regenerate ? 'Some regenerations failed' : 'Some productions failed',
        description: failures.slice(0, 3).join(', '),
        variant: 'destructive',
      })
    } else {
      showToast({
        title: regenerate
          ? `Output regenerated for ${subtopic.subtopicId}`
          : `Produced for ${subtopic.subtopicId}`,
        description: 'Review output — SME review recommended before publish.',
        variant: 'success',
      })
    }
  }

  const subtopicBusy = busy || producing || regeneratingStale

  return (
    <details
      className={cn(
        'rounded-md border',
        allProduced ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-border bg-muted/10'
      )}
      open={defaultOpen}
    >
      <summary className="cursor-pointer px-3 py-2 text-sm">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Subtopic {subtopicIndex}: {subtopic.subtopicTitle}
        </span>
        <span className="ml-2 text-xs text-muted-foreground">
          {produced}/{approvedIds.length} produced
        </span>
        {allProduced && (
          <Pill className="ml-2 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            <Check className="h-3 w-3" /> Subtopic complete
          </Pill>
        )}
        {staleCount > 0 && (
          <Pill className="ml-2 bg-amber-500/15 text-amber-800 dark:text-amber-400">
            {staleCount} stale
          </Pill>
        )}
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => void handleProduceSubtopic(produced > 0)}
            disabled={subtopicBusy}
          >
            {producing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : produced > 0 ? (
              <RefreshCw className="mr-2 h-4 w-4" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {produced > 0
              ? `Regenerate all for ${subtopic.subtopicId}`
              : `Produce all for ${subtopic.subtopicId}`}
          </Button>
          {staleCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleRegenerateStaleSubtopic()}
              disabled={subtopicBusy}
            >
              {regeneratingStale ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Regenerate {staleCount} stale
            </Button>
          )}
        </div>

        <div className="space-y-2 border-l-2 border-primary/20 pl-3">
          {subtopic.nodes.map((ref, nodeIndex) => (
            <NodeProductionCard
              key={ref.node.node_id}
              ref_={ref}
              nodeIndex={nodeIndex + 1}
              blueprint={blueprintsByNodeId[ref.node.node_id]!}
              contentSpecsByObjectId={contentSpecsByObjectId}
              producedByObjectId={producedByObjectId}
              busy={subtopicBusy}
              onProducedUpdated={onProducedUpdated}
              courseCode={courseCode}
              filters={filters}
              filterActive={filterActive}
            />
          ))}
        </div>
      </div>
    </details>
  )
}

function NodeProductionCard({
  ref_,
  nodeIndex,
  blueprint,
  contentSpecsByObjectId,
  producedByObjectId,
  busy,
  onProducedUpdated,
  courseCode,
  filters,
  filterActive,
}: {
  ref_: ApprovedNodeRef
  nodeIndex: number
  blueprint: NodeEngineBlueprint
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>
  producedByObjectId: Record<string, NodeEngineProducedObject | null>
  busy: boolean
  onProducedUpdated: (objectId: string, produced: NodeEngineProducedObject) => void
  courseCode: string
  filters: NodeEngineFilterState
  filterActive: boolean
}) {
  const [nodeProducing, setNodeProducing] = useState(false)
  const objects = useMemo(() => {
    const approved = [...blueprint.objects]
      .filter((o) => contentSpecsByObjectId[o.object_id]?.status === 'approved')
      .sort((a, b) => a.sequence_order - b.sequence_order)
    return filterVisibleObjects(approved, ref_, filters, {
      layer: 'production',
      blueprint,
      getContentSpec: (id) => contentSpecsByObjectId[id],
      getProduced: (id) => producedByObjectId[id],
    })
  }, [blueprint, ref_, filters, contentSpecsByObjectId, producedByObjectId])

  const producedCount = objects.filter((o) => producedByObjectId[o.object_id]).length
  const allProduced = objects.length > 0 && producedCount === objects.length
  const forceOpen = filterActive && objects.length > 0
  const nodeBusy = busy || nodeProducing

  async function handleProduceNode(regenerate: boolean) {
    setNodeProducing(true)
    const failures: string[] = []
    for (const obj of objects) {
      if (!regenerate && producedByObjectId[obj.object_id]) continue
      try {
        const record = await produceObject(
          courseCode,
          ref_.subtopicId,
          ref_.node.node_id,
          obj.object_id,
          contentSpecsByObjectId[obj.object_id],
          obj
        )
        onProducedUpdated(obj.object_id, record)
      } catch {
        failures.push(obj.object_id)
      }
    }
    setNodeProducing(false)
    if (failures.length > 0) {
      showToast({
        title: regenerate ? 'Some regenerations failed' : 'Some productions failed',
        description: failures.slice(0, 3).join(', '),
        variant: 'destructive',
      })
    } else {
      showToast({
        title: regenerate ? 'Node output regenerated' : 'Node output produced',
        description: ref_.node.node_title,
        variant: 'success',
      })
    }
  }

  return (
    <details
      className={cn(
        'rounded-md border bg-muted/10',
        allProduced ? 'border-emerald-500/25' : 'border-border'
      )}
      open={forceOpen}
    >
      <summary className="cursor-pointer px-3 py-2 text-sm">
        <MasteryNodeSummary
          nodeIndex={nodeIndex}
          title={ref_.node.node_title}
          nodeId={ref_.node.node_id}
          highlight={forceOpen}
        >
          <Pill
            className={
              allProduced
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground'
            }
          >
            {producedCount}/{objects.length} produced
          </Pill>
        </MasteryNodeSummary>
      </summary>
      <div className="space-y-2 border-t border-border px-3 py-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleProduceNode(producedCount > 0)}
            disabled={nodeBusy || objects.length === 0}
          >
            {nodeProducing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : producedCount > 0 ? (
              <RefreshCw className="mr-2 h-4 w-4" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {producedCount > 0 ? 'Regenerate node' : 'Produce node'}
          </Button>
        </div>
        {objects.map((obj, objIndex) => (
          <ObjectProductionRow
            key={obj.object_id}
            ref_={ref_}
            obj={obj}
            objectIndex={objIndex + 1}
            objectTotal={objects.length}
            spec={contentSpecsByObjectId[obj.object_id]}
            produced={producedByObjectId[obj.object_id]}
            busy={nodeBusy}
            onProducedUpdated={onProducedUpdated}
            courseCode={courseCode}
            highlight={filterActive}
          />
        ))}
      </div>
    </details>
  )
}

function ObjectProductionRow({
  ref_,
  obj,
  objectIndex,
  objectTotal,
  spec,
  produced,
  busy,
  onProducedUpdated,
  courseCode,
  highlight,
}: {
  ref_: ApprovedNodeRef
  obj: NodeEngineBlueprintObject
  objectIndex: number
  objectTotal: number
  spec: NodeEngineContentSpec | null | undefined
  produced: NodeEngineProducedObject | null | undefined
  busy: boolean
  onProducedUpdated: (objectId: string, produced: NodeEngineProducedObject) => void
  courseCode: string
  highlight?: boolean
}) {
  const [producing, setProducing] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const vehicle = resolveProductionVehicle(spec, obj)
  const isVideo = vehicle === 'video'
  const isStructuredVisual = vehicle === 'structured_visual'
  const modalityMismatch = isModalityProductionMismatch(spec, produced)
  const structuredVisual: NodeEngineStructuredVisual | null =
    produced?.produced_modality === 'structured_visual'
      ? produced?.envelope?.modality_specific?.structured_visual ?? null
      : null
  const segments = extractSegments(produced ?? null)
  const heygenPrompt = extractHeyGenPrompt(produced ?? null)
  const transcript = extractTranscript(produced ?? null)
  const scriptWordCount = extractScriptWordCount(produced ?? null)
  const wordBudget =
    produced?.envelope?.modality_specific?.script_word_budget ?? VIDEO_SCRIPT_MAX_WORDS
  const overWordLimit = scriptWordCount !== null && scriptWordCount > wordBudget
  const rawFidelityNotes = extractFidelityNotes(produced ?? null)
  const fidelityNotes =
    isVideo && modalityMismatch
      ? rawFidelityNotes.filter((n) => !isLegacyTextEquivalentMessage(n))
      : rawFidelityNotes
  const productionNote =
    isVideo && modalityMismatch
      ? null
      : produced?.envelope?.modality_specific?.production_note
  const renderStatus = produced?.envelope?.modality_specific?.render_status
  const heygenSourceUrl =
    produced?.envelope?.modality_specific?.heygen_source_url ??
    produced?.envelope?.modality_specific?.video_url
  const maestroVideoAssetId = produced?.envelope?.modality_specific?.maestro_video_asset_id
  const maestroVideoStored = produced?.envelope?.modality_specific?.maestro_video_stored === true
  const maestroVideoIngestError = produced?.envelope?.modality_specific?.maestro_video_ingest_error
  const maestroVideoStream =
    maestroVideoStored && renderStatus === 'render_complete'
      ? producedVideoStreamUrl(courseCode, obj.object_id)
      : null
  const renderMock = produced?.envelope?.modality_specific?.render_mock
  const renderFailure = produced?.envelope?.modality_specific?.render_failure_message
  const ms = produced?.envelope?.modality_specific
  const savedOverride: RenderStyleOverride =
    ms?.video_render_style_override ?? 'inherit'
  const [renderStyleOverride, setRenderStyleOverride] =
    useState<RenderStyleOverride>(savedOverride)
  const effectiveRenderStyle: VideoRenderStyle =
    ms?.video_render_style ?? ms?.video_brief?.video_render_style ?? 'video_agent_produced'
  const agentProduction =
    ms?.agent_production ?? ms?.video_brief?.agent_production ?? null
  const transcriptFidelity = ms?.transcript_fidelity
  const renderedTranscript = ms?.rendered_transcript
  const transcriptFidelityNotes = ms?.transcript_fidelity_notes ?? []
  const overrideDiffersFromSaved = renderStyleOverride !== savedOverride
  const stale = isProductionStale(spec, produced)
  const hasVideoBrief = isVideo && produced?.produced_modality === 'video'
  const canRender =
    hasVideoBrief &&
    !overWordLimit &&
    renderStatus !== 'render_pending' &&
    renderStatus !== 'render_complete' &&
    (!renderStatus || renderStatus === 'brief_ready' || renderStatus === 'render_failed')
  const renderPending = renderStatus === 'render_pending'

  async function handleProduce() {
    setProducing(true)
    try {
      const record = await produceObject(
        courseCode,
        ref_.subtopicId,
        ref_.node.node_id,
        obj.object_id,
        spec,
        obj,
        isVideo ? renderStyleOverride : undefined
      )
      onProducedUpdated(obj.object_id, record)
      setExpanded(true)
      showToast({
        title: produced
          ? isVideo
            ? 'Video brief regenerated'
            : 'Text regenerated'
          : isVideo
            ? 'Video brief produced'
            : 'Text produced',
        description: `${obj.object_id} — recommended SME review`,
        variant: 'success',
      })
    } catch (error) {
      showToast({
        title: 'Production failed',
        description: error instanceof Error ? error.message : 'Failed',
        variant: 'destructive',
      })
    } finally {
      setProducing(false)
    }
  }

  async function handleCopyHeyGenPrompt() {
    if (!heygenPrompt) return
    try {
      await navigator.clipboard.writeText(heygenPrompt)
      showToast({ title: 'HeyGen prompt copied', variant: 'success' })
    } catch {
      showToast({ title: 'Copy failed', variant: 'destructive' })
    }
  }

  async function handleRenderVideo() {
    setRendering(true)
    try {
      const record = await renderVideoObject(
        courseCode,
        ref_.subtopicId,
        ref_.node.node_id,
        obj.object_id
      )
      onProducedUpdated(obj.object_id, record)
      const status = record.envelope?.modality_specific?.render_status
      const mock = record.envelope?.modality_specific?.render_mock
      showToast({
        title:
          status === 'render_complete'
            ? mock
              ? 'Mock video render complete'
              : 'HeyGen render complete'
            : 'HeyGen render submitted',
        description:
          status === 'render_pending'
            ? 'Rendering — click Check render status to poll HeyGen.'
            : 'Video URL saved on produced object.',
        variant: 'success',
      })
    } catch (error) {
      showToast({
        title: 'Render failed',
        description: error instanceof Error ? error.message : 'Failed',
        variant: 'destructive',
      })
    } finally {
      setRendering(false)
    }
  }

  async function handleRefreshRender() {
    setRendering(true)
    try {
      const record = await refreshVideoRender(
        courseCode,
        ref_.subtopicId,
        ref_.node.node_id,
        obj.object_id
      )
      onProducedUpdated(obj.object_id, record)
      const status = record.envelope?.modality_specific?.render_status
      showToast({
        title:
          status === 'render_complete'
            ? 'Video ready'
            : status === 'render_failed'
              ? 'Render failed'
              : 'Still rendering',
        variant: status === 'render_failed' ? 'destructive' : 'success',
      })
    } catch (error) {
      showToast({
        title: 'Status check failed',
        description: error instanceof Error ? error.message : 'Failed',
        variant: 'destructive',
      })
    } finally {
      setRendering(false)
    }
  }

  const produceLabel = isVideo
    ? modalityMismatch
      ? 'Create HeyGen video brief'
      : produced
        ? 'Regenerate brief'
        : 'Produce video brief'
    : isStructuredVisual
      ? modalityMismatch
        ? 'Create structured visual'
        : produced
          ? 'Regenerate visual'
          : 'Produce structured visual'
      : produced
        ? 'Regenerate'
        : 'Produce text'

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-xs',
        modalityMismatch
          ? 'border-amber-500/35 bg-amber-500/5'
          : produced
            ? 'border-emerald-500/20 bg-emerald-500/5'
            : 'border-border bg-background'
      )}
    >
      <ObjectRowHeader
        objectIndex={objectIndex}
        objectTotal={objectTotal}
        title={`${obj.sequence_order}. ${obj.title}`}
        objectId={obj.object_id}
        highlight={highlight}
      >
        {isVideo ? (
          <Video className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <Pill className="bg-muted text-muted-foreground">
          spec: {spec?.suggested_vehicle ?? obj.suggested_vehicle}
        </Pill>
        {produced && (
          <Pill
            className={
              modalityMismatch
                ? 'bg-amber-500/15 text-amber-800 dark:text-amber-400'
                : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
            }
          >
            produced: {produced.produced_modality}
          </Pill>
        )}
        {isVideo && modalityMismatch && (
          <Pill className="bg-amber-500/15 text-amber-800 dark:text-amber-400">
            text placeholder — needs video brief
          </Pill>
        )}
        {hasVideoBrief && (
          <Pill
            className={
              effectiveRenderStyle === 'video_agent_produced'
                ? 'bg-violet-500/15 text-violet-700 dark:text-violet-400'
                : 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
            }
          >
            {effectiveRenderStyle === 'video_agent_produced'
              ? 'Produced (Video Agent)'
              : 'Studio Direct'}
          </Pill>
        )}
        {hasVideoBrief && transcriptFidelity && transcriptFidelity !== 'matched' && (
          <Pill
            className={
              transcriptFidelity === 'needs_review'
                ? 'bg-red-500/15 text-red-700 dark:text-red-400'
                : 'bg-amber-500/15 text-amber-800 dark:text-amber-400'
            }
          >
            transcript: {transcriptFidelity.replace('_', ' ')}
          </Pill>
        )}
        {hasVideoBrief && renderStatus === 'brief_ready' && (
          <Pill className="bg-sky-500/15 text-sky-700 dark:text-sky-400">HeyGen prompt ready</Pill>
        )}
        {hasVideoBrief && scriptWordCount !== null && (
          <Pill
            className={
              overWordLimit
                ? 'bg-red-500/15 text-red-700 dark:text-red-400'
                : 'bg-muted text-muted-foreground'
            }
          >
            {scriptWordCount}/{wordBudget} words
          </Pill>
        )}
        {renderStatus === 'render_complete' && maestroVideoStored && (
          <Pill className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            stored in Maestro
          </Pill>
        )}
        {renderStatus === 'render_complete' && (
          <Pill className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            {renderMock ? 'mock render' : 'video rendered'}
          </Pill>
        )}
        {renderPending && (
          <Pill className="bg-amber-500/15 text-amber-800 dark:text-amber-400">rendering…</Pill>
        )}
        {renderStatus === 'render_failed' && (
          <Pill className="bg-red-500/15 text-red-700 dark:text-red-400">render failed</Pill>
        )}
        {stale && !modalityMismatch && (
          <Pill className="bg-amber-500/15 text-amber-800 dark:text-amber-400">
            spec updated — regenerate
          </Pill>
        )}
      </ObjectRowHeader>

      {isVideo && modalityMismatch && (
        <p className="mt-2 text-amber-800 dark:text-amber-300">
          This object was produced earlier as a <strong className="font-medium">text placeholder</strong>{' '}
          (Phase A). Click <strong className="font-medium">Create HeyGen video brief</strong> to replace
          it with the real video brief and copy-paste prompt.
        </p>
      )}

      {isStructuredVisual && modalityMismatch && (
        <p className="mt-2 text-amber-800 dark:text-amber-300">
          This object was produced earlier as a <strong className="font-medium">text placeholder</strong>.
          Click <strong className="font-medium">Create structured visual</strong> to replace it with the
          semantic visual specification.
        </p>
      )}

      {isVideo && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Render style
          </span>
          <select
            value={renderStyleOverride}
            onChange={(e) => setRenderStyleOverride(e.target.value as RenderStyleOverride)}
            disabled={busy || producing || rendering}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
          >
            <option value="inherit">Course default (Produced)</option>
            <option value="video_agent_produced">Produced (Video Agent)</option>
            <option value="studio_direct">Studio Direct</option>
          </select>
          {overrideDiffersFromSaved && (
            <span className="text-[10px] text-amber-700 dark:text-amber-400">
              Regenerate brief to apply this style.
            </span>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={produced && !modalityMismatch ? 'outline' : 'default'}
          onClick={() => void handleProduce()}
          disabled={busy || producing || rendering}
        >
          {producing ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          ) : produced ? (
            <RefreshCw className="mr-2 h-3 w-3" />
          ) : (
            <Play className="mr-2 h-3 w-3" />
          )}
          {produceLabel}
        </Button>
        {isVideo && heygenPrompt && hasVideoBrief && (
          <Button size="sm" variant="ghost" onClick={() => void handleCopyHeyGenPrompt()}>
            <Copy className="mr-2 h-3 w-3" />
            Copy HeyGen prompt
          </Button>
        )}
        {!isVideo && !isStructuredVisual && segments.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide segments' : `Preview ${segments.length} segment(s)`}
          </Button>
        )}
        {isStructuredVisual && structuredVisual && (
          <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide visual' : 'Preview visual'}
          </Button>
        )}
        {isVideo && hasVideoBrief && (heygenPrompt || transcript) && (
          <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Hide brief' : 'Preview video brief'}
          </Button>
        )}
        {canRender && (
          <Button
            size="sm"
            variant="default"
            onClick={() => void handleRenderVideo()}
            disabled={busy || producing || rendering}
          >
            {rendering ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <Video className="mr-2 h-3 w-3" />
            )}
            Render with HeyGen
          </Button>
        )}
        {renderPending && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleRefreshRender()}
            disabled={busy || producing || rendering}
          >
            {rendering ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3 w-3" />
            )}
            Check render status
          </Button>
        )}
        {renderStatus === 'render_complete' && maestroVideoStream && (
          <Button size="sm" variant="outline" asChild>
            <a href={maestroVideoStream} target="_blank" rel="noreferrer">
              Download from Maestro
            </a>
          </Button>
        )}
        {renderStatus === 'render_complete' && heygenSourceUrl && !maestroVideoStored && (
          <Button size="sm" variant="outline" asChild>
            <a href={heygenSourceUrl} target="_blank" rel="noreferrer">
              Open HeyGen source
            </a>
          </Button>
        )}
      </div>

      {maestroVideoAssetId && hasVideoBrief && (
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">
          Maestro video asset: <span className="text-foreground">{maestroVideoAssetId}</span>
        </p>
      )}

      {renderStatus === 'render_complete' && maestroVideoStream && (
        <div className="mt-3 w-fit max-w-full rounded-lg border border-border bg-black/90 p-2">
          <video
            controls
            preload="metadata"
            className="block max-h-80 w-auto max-w-full rounded-md bg-black"
            src={maestroVideoStream}
          >
            Your browser does not support inline video playback.
          </video>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Review in Maestro — stored under this course for SME approval.
          </p>
        </div>
      )}

      {maestroVideoIngestError && (
        <p className="mt-2 text-amber-700 dark:text-amber-400">
          Maestro ingest failed: {maestroVideoIngestError}. Try Check render status again while the
          HeyGen link is still valid.
        </p>
      )}

      {overWordLimit && hasVideoBrief && (
        <p className="mt-2 text-red-700 dark:text-red-400">
          Script exceeds {wordBudget} words — shorten the brief or raise the target duration before HeyGen render.
        </p>
      )}
      {renderFailure && (
        <p className="mt-2 text-red-700 dark:text-red-400">{renderFailure}</p>
      )}

      {productionNote && (
        <p className="mt-2 text-amber-700 dark:text-amber-400">{productionNote}</p>
      )}
      {fidelityNotes.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-amber-700 dark:text-amber-400">
          {fidelityNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {expanded && !isVideo && !isStructuredVisual && segments.length > 0 && (
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto rounded-md border border-border bg-muted/20 p-2">
          {segments.map((seg, i) => (
            <div key={`${seg.type}-${i}`} className="border-b border-border/50 pb-2 last:border-0">
              <span className="font-mono text-[9px] uppercase text-muted-foreground">
                {seg.type}
              </span>
              <p className="mt-0.5 whitespace-pre-wrap text-foreground">{seg.text}</p>
            </div>
          ))}
        </div>
      )}

      {expanded && isStructuredVisual && structuredVisual && (
        <div className="mt-3 max-h-[28rem] overflow-y-auto rounded-md border border-border bg-muted/10 p-3">
          <StructuredVisualRenderer visual={structuredVisual} />
        </div>
      )}

      {transcriptFidelity && transcriptFidelity !== 'matched' && transcriptFidelityNotes.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-amber-700 dark:text-amber-400">
          {transcriptFidelityNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {expanded && isVideo && hasVideoBrief && agentProduction && agentProduction.sections.length > 0 && (
        <div className="mt-3 space-y-2 rounded-md border border-violet-500/20 bg-violet-500/5 p-2">
          <span className="font-mono text-[9px] uppercase text-muted-foreground">
            Produced scenes ({agentProduction.sections.length})
          </span>
          {agentProduction.sections.map((section) => (
            <div
              key={section.section_number}
              className="border-b border-border/50 pb-2 last:border-0"
            >
              <p className="text-[11px] font-medium text-foreground">
                {section.section_number}. {section.title}
                {section.duration_seconds ? (
                  <span className="ml-1 text-muted-foreground">· {section.duration_seconds}s</span>
                ) : null}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-foreground">{section.narration}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Visual: {section.visual_description}
              </p>
              {section.on_screen_text && section.on_screen_text.length > 0 && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  On-screen: {section.on_screen_text.join(' · ')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {expanded && isVideo && hasVideoBrief && renderedTranscript &&
        transcriptFidelity && transcriptFidelity !== 'matched' && (
          <div className="mt-3 grid grid-cols-1 gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 md:grid-cols-2">
            <div>
              <span className="font-mono text-[9px] uppercase text-muted-foreground">
                Approved transcript (canonical)
              </span>
              <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-foreground">
                {transcript}
              </p>
            </div>
            <div>
              <span className="font-mono text-[9px] uppercase text-muted-foreground">
                Rendered transcript (HeyGen)
              </span>
              <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-foreground">
                {renderedTranscript}
              </p>
            </div>
          </div>
        )}

      {expanded && isVideo && hasVideoBrief && (
        <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/20 p-2">
          {heygenPrompt && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[9px] uppercase text-muted-foreground">
                  HeyGen prompt — single block with full script (paste into Video Agent; API uses script separately)
                </span>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => void handleCopyHeyGenPrompt()}>
                  <Copy className="mr-1 h-3 w-3" />
                  Copy
                </Button>
              </div>
              <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-foreground">
                {heygenPrompt}
              </pre>
            </div>
          )}
          {transcript && (
            <div>
              <span className="font-mono text-[9px] uppercase text-muted-foreground">Transcript</span>
              <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-foreground">
                {transcript}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Layer4ContinueCta({
  layer4Complete,
  onContinue,
}: {
  layer4Complete: boolean
  onContinue: () => void
}) {
  if (!layer4Complete) return null
  return (
    <div className="rounded-md border border-border bg-muted/20 p-4">
      <Button size="sm" variant="default" onClick={onContinue}>
        Continue to Layer 5 — Validation & Review
        <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  )
}
