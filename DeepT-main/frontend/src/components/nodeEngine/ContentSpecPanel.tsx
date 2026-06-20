import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  Loader2,
  Play,
  RefreshCw,
  Shield,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { showToast } from '@/components/ui/Toaster'
import { cn } from '@/lib/utils'
import {
  approveContentSpec,
  generateContentSpecs,
  updateContentSpec,
  type NodeEngineBlueprint,
  type NodeEngineBlueprintObject,
  type NodeEngineContentSpec,
  type NodeEngineNodeSet,
} from '@/services/api'
import {
  countLayerMatches,
  filterVisibleObjects,
  isFilterActive,
  nodeIsVisible,
  type ApprovedNodeRef,
  type NodeEngineFilterState,
} from './nodeEngineFilters'
import { MasteryNodeSummary, NodeEngineFilterBar, ObjectRowHeader } from './NodeEngineUi'

interface CloContentSpecGroup {
  clo_id: string
  refined_clo: string
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

interface SubtopicContentSpecGroup {
  subtopicId: string
  subtopicTitle: string
  nodes: ApprovedNodeRef[]
}

function groupNodesBySubtopic(nodes: ApprovedNodeRef[]): SubtopicContentSpecGroup[] {
  const byId = new Map<string, SubtopicContentSpecGroup>()
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

function countSpecs(
  refs: ApprovedNodeRef[],
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>,
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>,
  filter: 'total' | 'generated' | 'approved'
): number {
  return refs.reduce((sum, ref) => {
    const bp = blueprintsByNodeId[ref.node.node_id]
    if (!bp) return sum
    if (filter === 'total') return sum + bp.objects.length
    return (
      sum +
      bp.objects.filter((o) => {
        const spec = contentSpecsByObjectId[o.object_id]
        if (filter === 'generated') return Boolean(spec)
        return spec?.status === 'approved'
      }).length
    )
  }, 0)
}

/** First subtopic that still needs work — only this one starts expanded. */
function findFirstIncompleteSubtopic(
  groups: CloContentSpecGroup[],
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>,
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>
): { cloId: string; subtopicId: string } | null {
  for (const group of groups) {
    for (const st of groupNodesBySubtopic(group.nodes)) {
      const total = countSpecs(st.nodes, blueprintsByNodeId, contentSpecsByObjectId, 'total')
      const approved = countSpecs(st.nodes, blueprintsByNodeId, contentSpecsByObjectId, 'approved')
      if (total === 0 || approved < total) {
        return { cloId: group.clo_id, subtopicId: st.subtopicId }
      }
    }
  }
  return null
}

function buildContentSpecGroups(
  cloGroups: Array<{
    clo_id: string
    refined_clo: string
    subtopics: Array<{ subtopic_id: string; title: string }>
  }>,
  nodeSetsBySubtopicId: Record<string, NodeEngineNodeSet | null>,
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>
): CloContentSpecGroup[] {
  return cloGroups
    .map((group) => {
      const nodes: ApprovedNodeRef[] = []
      for (const st of group.subtopics) {
        const nodeSet = nodeSetsBySubtopicId[st.subtopic_id]
        if (nodeSet?.status !== 'approved') continue
        for (const node of nodeSet.nodes) {
          if (node.status === 'approved' && blueprintsByNodeId[node.node_id]?.status === 'approved') {
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

export interface Layer3BodyProps {
  status: 'locked' | 'available' | 'running' | 'needs_review' | 'approved' | 'completed'
  cloGroups: Array<{
    clo_id: string
    refined_clo: string
    subtopics: Array<{ subtopic_id: string; title: string }>
  }>
  nodeSetsBySubtopicId: Record<string, NodeEngineNodeSet | null>
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>
  hydrating: boolean
  busy: boolean
  generatingCloId: string | null
  approvingCloId: string | null
  onGenerateClo: (cloId: string) => Promise<void>
  onApproveClo: (cloId: string) => Promise<void>
  onContentSpecUpdated: (objectId: string, spec: NodeEngineContentSpec) => void
  layer3Approved: boolean
  approverLabel: string
  courseCode: string
  filters: NodeEngineFilterState
  onFiltersChange: (filters: NodeEngineFilterState) => void
}

export function Layer3Body({
  status,
  cloGroups,
  nodeSetsBySubtopicId,
  blueprintsByNodeId,
  contentSpecsByObjectId,
  hydrating,
  busy,
  generatingCloId,
  approvingCloId,
  onGenerateClo,
  onApproveClo,
  onContentSpecUpdated,
  layer3Approved,
  approverLabel,
  courseCode,
  filters,
  onFiltersChange,
}: Layer3BodyProps) {
  const groups = useMemo(
    () => buildContentSpecGroups(cloGroups, nodeSetsBySubtopicId, blueprintsByNodeId),
    [cloGroups, nodeSetsBySubtopicId, blueprintsByNodeId]
  )

  const allNodes = useMemo(() => groups.flatMap((g) => g.nodes), [groups])

  const matchCount = useMemo(
    () =>
      countLayerMatches(
        allNodes,
        filters,
        'contentSpec',
        (nodeId) => blueprintsByNodeId[nodeId],
        (ref) => blueprintsByNodeId[ref.node.node_id]?.objects ?? [],
        (objectId) => contentSpecsByObjectId[objectId]
      ),
    [allNodes, filters, blueprintsByNodeId, contentSpecsByObjectId]
  )

  const filterActive = isFilterActive(filters)

  const totalObjects = groups.reduce(
    (sum, g) =>
      sum +
      g.nodes.reduce(
        (nSum, ref) => nSum + (blueprintsByNodeId[ref.node.node_id]?.objects.length ?? 0),
        0
      ),
    0
  )
  const generatedCount = Object.values(contentSpecsByObjectId).filter(Boolean).length
  const approvedCount = Object.values(contentSpecsByObjectId).filter((s) => s?.status === 'approved').length

  const firstIncomplete = useMemo(
    () => findFirstIncompleteSubtopic(groups, blueprintsByNodeId, contentSpecsByObjectId),
    [groups, blueprintsByNodeId, contentSpecsByObjectId]
  )

  if (status === 'locked') {
    return (
      <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Approve Layer 2 — Experience Blueprint for all nodes before content specification.
      </div>
    )
  }

  if (hydrating) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading content specifications…
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No approved blueprints yet. Complete and approve Layer 2 first.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <NodeEngineFilterBar
        layer="contentSpec"
        filters={filters}
        onChange={onFiltersChange}
        matchCount={filterActive ? matchCount : undefined}
      />

      <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Work subtopic by subtopic</p>
        <p className="mt-1">
          Each subtopic starts <strong className="font-medium text-foreground">collapsed</strong> — only
          the next subtopic needing work opens automatically. Expand a mastery node to see its
          learning objects. Use <strong className="font-medium text-foreground">Generate / Approve
          all for this subtopic</strong> on each subtopic card.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill className="bg-muted text-muted-foreground">{totalObjects} learning object(s)</Pill>
        <Pill className="bg-muted text-muted-foreground">
          {generatedCount}/{totalObjects} generated
        </Pill>
        <Pill className={layer3Approved ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-800 dark:text-amber-400'}>
          {approvedCount}/{totalObjects} approved
        </Pill>
      </div>

      {groups.map((group) => (
        <CloContentSpecSection
          key={group.clo_id}
          group={group}
          defaultOpen={firstIncomplete?.cloId === group.clo_id}
          firstIncompleteSubtopicId={firstIncomplete?.subtopicId ?? null}
          blueprintsByNodeId={blueprintsByNodeId}
          contentSpecsByObjectId={contentSpecsByObjectId}
          busy={busy}
          generating={generatingCloId === group.clo_id}
          approving={approvingCloId === group.clo_id}
          onGenerate={() => void onGenerateClo(group.clo_id)}
          onApprove={() => void onApproveClo(group.clo_id)}
          onContentSpecUpdated={onContentSpecUpdated}
          approverLabel={approverLabel}
          courseCode={courseCode}
          filters={filters}
          filterActive={filterActive}
        />
      ))}

      {filterActive && matchCount.nodes === 0 && (
        <p className="text-sm text-muted-foreground">No nodes or objects match the current filters.</p>
      )}
    </div>
  )
}

function CloContentSpecSection({
  group,
  defaultOpen,
  firstIncompleteSubtopicId,
  blueprintsByNodeId,
  contentSpecsByObjectId,
  busy,
  generating,
  approving,
  onGenerate,
  onApprove,
  onContentSpecUpdated,
  approverLabel,
  courseCode,
  filters,
  filterActive,
}: {
  group: CloContentSpecGroup
  defaultOpen: boolean
  firstIncompleteSubtopicId: string | null
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>
  busy: boolean
  generating: boolean
  approving: boolean
  onGenerate: () => void
  onApprove: () => void
  onContentSpecUpdated: (objectId: string, spec: NodeEngineContentSpec) => void
  approverLabel: string
  courseCode: string
  filters: NodeEngineFilterState
  filterActive: boolean
}) {
  const objectCount = countSpecs(group.nodes, blueprintsByNodeId, contentSpecsByObjectId, 'total')
  const generated = countSpecs(group.nodes, blueprintsByNodeId, contentSpecsByObjectId, 'generated')
  const approved = countSpecs(group.nodes, blueprintsByNodeId, contentSpecsByObjectId, 'approved')
  const pendingApproval = generated > approved
  const subtopicGroups = groupNodesBySubtopic(group.nodes)
  const nodeCount = group.nodes.length
  const subtopicCount = subtopicGroups.length

  return (
    <details className="rounded-md border border-border" open={defaultOpen}>
      <summary className="cursor-pointer px-3 py-2 font-medium">
        {group.clo_id}
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          {approved}/{objectCount} specs approved
        </span>
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3">
        <div>
          <p className="text-sm text-muted-foreground">{group.refined_clo}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {subtopicCount} subtopic{subtopicCount === 1 ? '' : 's'} · {nodeCount} mastery node
            {nodeCount === 1 ? '' : 's'} · {objectCount} learning object
            {objectCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={onGenerate} disabled={busy || generating}>
            {generating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {generated > 0 ? `Regenerate entire ${group.clo_id}` : `Generate entire ${group.clo_id}`}
          </Button>
          {pendingApproval && (
            <Button size="sm" variant="outline" onClick={onApprove} disabled={busy || approving}>
              {approving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Approve entire {group.clo_id} (optional)
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Recommended: expand a subtopic below, generate specs, review nodes, then approve that
          subtopic before moving to the next.
        </p>

        <div className="space-y-3">
        {subtopicGroups.map((subtopic, stIndex) => {
          const visibleNodes = filterActive
            ? subtopic.nodes.filter((ref) => {
                const bp = blueprintsByNodeId[ref.node.node_id]
                return nodeIsVisible(ref, bp?.objects ?? [], filters, {
                  layer: 'contentSpec',
                  blueprint: bp,
                  getContentSpec: (id) => contentSpecsByObjectId[id],
                })
              })
            : subtopic.nodes
          if (filterActive && visibleNodes.length === 0) return null
          return (
          <SubtopicContentSpecSection
            key={subtopic.subtopicId}
            subtopic={{ ...subtopic, nodes: visibleNodes }}
            subtopicIndex={stIndex + 1}
            defaultOpen={subtopic.subtopicId === firstIncompleteSubtopicId || (filterActive && visibleNodes.length > 0)}
            blueprintsByNodeId={blueprintsByNodeId}
            contentSpecsByObjectId={contentSpecsByObjectId}
            busy={busy}
            onContentSpecUpdated={onContentSpecUpdated}
            approverLabel={approverLabel}
            courseCode={courseCode}
            filters={filters}
            filterActive={filterActive}
          />
          )
        })}
        </div>
      </div>
    </details>
  )
}

function SubtopicContentSpecSection({
  subtopic,
  subtopicIndex,
  defaultOpen,
  blueprintsByNodeId,
  contentSpecsByObjectId,
  busy,
  onContentSpecUpdated,
  approverLabel,
  courseCode,
  filters,
  filterActive,
}: {
  subtopic: SubtopicContentSpecGroup
  subtopicIndex: number
  defaultOpen: boolean
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>
  busy: boolean
  onContentSpecUpdated: (objectId: string, spec: NodeEngineContentSpec) => void
  approverLabel: string
  courseCode: string
  filters: NodeEngineFilterState
  filterActive: boolean
}) {
  const [generating, setGenerating] = useState(false)
  const [approving, setApproving] = useState(false)

  const objectCount = countSpecs(subtopic.nodes, blueprintsByNodeId, contentSpecsByObjectId, 'total')
  const generated = countSpecs(subtopic.nodes, blueprintsByNodeId, contentSpecsByObjectId, 'generated')
  const approved = countSpecs(subtopic.nodes, blueprintsByNodeId, contentSpecsByObjectId, 'approved')
  const allApproved = approved === objectCount && objectCount > 0
  const pendingApproval = generated > approved
  const subtopicBusy = busy || generating || approving

  async function handleGenerateSubtopic() {
    setGenerating(true)
    const failures: string[] = []
    try {
      for (const ref of subtopic.nodes) {
        try {
          const specs = await generateContentSpecs(courseCode, ref.subtopicId, ref.node.node_id)
          for (const spec of specs) onContentSpecUpdated(spec.object_id, spec)
        } catch {
          failures.push(ref.node.node_title)
        }
      }
      if (failures.length > 0) {
        showToast({
          title: 'Some nodes failed',
          description: failures.join(', '),
          variant: 'destructive',
        })
      } else {
        showToast({
          title: `Specs generated for ${subtopic.subtopicId}`,
          description: `${subtopic.nodes.length} mastery node(s) — review learning objects below.`,
          variant: 'success',
        })
      }
    } finally {
      setGenerating(false)
    }
  }

  async function handleApproveSubtopic() {
    setApproving(true)
    const failures: string[] = []
    try {
      for (const ref of subtopic.nodes) {
        const bp = blueprintsByNodeId[ref.node.node_id]
        if (!bp) continue
        for (const obj of bp.objects) {
          const spec = contentSpecsByObjectId[obj.object_id]
          if (!spec || spec.status === 'approved') continue
          try {
            const approvedSpec = await approveContentSpec(
              courseCode,
              ref.subtopicId,
              ref.node.node_id,
              obj.object_id,
              approverLabel
            )
            onContentSpecUpdated(obj.object_id, approvedSpec)
          } catch {
            failures.push(`${ref.node.node_title} / ${obj.title}`)
          }
        }
      }
      if (failures.length > 0) {
        showToast({
          title: 'Some approvals failed',
          description: failures.slice(0, 2).join(', '),
          variant: 'destructive',
        })
      } else {
        showToast({
          title: `${subtopic.subtopicId} approved`,
          description: 'All content specs in this subtopic are approved.',
          variant: 'success',
        })
      }
    } finally {
      setApproving(false)
    }
  }

  return (
    <details
      className={cn(
        'rounded-md border bg-muted/5',
        allApproved ? 'border-emerald-500/30' : 'border-primary/20'
      )}
      open={defaultOpen}
    >
      <summary className="cursor-pointer px-3 py-2">
        <span className="font-mono text-xs font-semibold text-primary">{subtopic.subtopicId}</span>
        <span className="ml-2 text-sm font-medium">
          Subtopic {subtopicIndex}: {subtopic.subtopicTitle}
        </span>
        <span className="ml-2 text-xs text-muted-foreground">
          {subtopic.nodes.length} node{subtopic.nodes.length === 1 ? '' : 's'} · {approved}/
          {objectCount} specs approved
        </span>
        {allApproved && (
          <Pill className="ml-2 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            <Check className="h-3 w-3" /> Subtopic complete
          </Pill>
        )}
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => void handleGenerateSubtopic()}
            disabled={subtopicBusy}
          >
            {generating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : generated > 0 ? (
              <RefreshCw className="mr-2 h-4 w-4" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {generated > 0
              ? `Regenerate all for ${subtopic.subtopicId}`
              : `Generate all for ${subtopic.subtopicId}`}
          </Button>
          {pendingApproval && (
            <Button
              size="sm"
              variant="default"
              onClick={() => void handleApproveSubtopic()}
              disabled={subtopicBusy}
            >
              {approving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Approve all for {subtopic.subtopicId}
            </Button>
          )}
        </div>

        <div className="space-y-2 border-l-2 border-primary/20 pl-3">
        {subtopic.nodes.map((ref, nodeIndex) => (
          <NodeContentSpecCard
            key={ref.node.node_id}
            ref_={ref}
            nodeIndex={nodeIndex + 1}
            blueprint={blueprintsByNodeId[ref.node.node_id]!}
            contentSpecsByObjectId={contentSpecsByObjectId}
            busy={subtopicBusy}
            onContentSpecUpdated={onContentSpecUpdated}
            approverLabel={approverLabel}
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

function NodeContentSpecCard({
  ref_,
  nodeIndex,
  blueprint,
  contentSpecsByObjectId,
  busy,
  onContentSpecUpdated,
  approverLabel,
  courseCode,
  filters,
  filterActive,
}: {
  ref_: ApprovedNodeRef
  nodeIndex: number
  blueprint: NodeEngineBlueprint
  contentSpecsByObjectId: Record<string, NodeEngineContentSpec | null>
  busy: boolean
  onContentSpecUpdated: (objectId: string, spec: NodeEngineContentSpec) => void
  approverLabel: string
  courseCode: string
  filters: NodeEngineFilterState
  filterActive: boolean
}) {
  const [generating, setGenerating] = useState(false)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const objects = useMemo(
    () =>
      filterVisibleObjects(
        [...blueprint.objects].sort((a, b) => a.sequence_order - b.sequence_order),
        ref_,
        filters,
        {
          layer: 'contentSpec',
          blueprint,
          getContentSpec: (id) => contentSpecsByObjectId[id],
        }
      ),
    [blueprint, ref_, filters, contentSpecsByObjectId]
  )

  const forceOpen = filterActive && objects.length > 0
  const specCount = objects.filter((o) => contentSpecsByObjectId[o.object_id]).length
  const approvedCount = objects.filter((o) => contentSpecsByObjectId[o.object_id]?.status === 'approved').length

  async function handleGenerateAll() {
    setGenerating(true)
    try {
      const specs = await generateContentSpecs(courseCode, ref_.subtopicId, ref_.node.node_id)
      for (const spec of specs) onContentSpecUpdated(spec.object_id, spec)
      showToast({ title: 'Content specs generated', description: ref_.node.node_title, variant: 'success' })
    } catch (error) {
      showToast({
        title: 'Generation failed',
        description: error instanceof Error ? error.message : 'Failed',
        variant: 'destructive',
      })
    } finally {
      setGenerating(false)
    }
  }

  async function handleApproveAll() {
    for (const obj of objects) {
      const spec = contentSpecsByObjectId[obj.object_id]
      if (!spec || spec.status === 'approved') continue
      setApprovingId(obj.object_id)
      try {
        const approved = await approveContentSpec(
          courseCode,
          ref_.subtopicId,
          ref_.node.node_id,
          obj.object_id,
          approverLabel
        )
        onContentSpecUpdated(obj.object_id, approved)
      } catch (error) {
        showToast({
          title: 'Approval failed',
          description: error instanceof Error ? error.message : 'Failed',
          variant: 'destructive',
        })
        break
      } finally {
        setApprovingId(null)
      }
    }
  }

  const allApproved = approvedCount === objects.length && objects.length > 0

  return (
    <details
      className={cn(
        'rounded-md border bg-muted/10',
        allApproved ? 'border-emerald-500/25' : 'border-border'
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
          <Pill className="bg-muted text-muted-foreground">{ref_.node.node_type}</Pill>
          <Pill
            className={
              allApproved
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground'
            }
          >
            {approvedCount}/{blueprint.objects.length} specs approved
          </Pill>
        </MasteryNodeSummary>
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void handleGenerateAll()} disabled={busy || generating}>
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            {specCount > 0 ? 'Regenerate node specs' : 'Generate node specs'}
          </Button>
          {specCount > approvedCount && (
            <Button size="sm" variant="outline" onClick={() => void handleApproveAll()} disabled={busy || approvingId !== null}>
              <Check className="mr-2 h-4 w-4" /> Approve node specs
            </Button>
          )}
        </div>

        <div className="space-y-2 border-l border-dashed border-border pl-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Learning objects ({objects.length})
          </p>
        {objects.map((obj, objIndex) => (
          <ObjectContentSpecRow
            key={obj.object_id}
            ref_={ref_}
            obj={obj}
            objectIndex={objIndex + 1}
            objectTotal={objects.length}
            spec={contentSpecsByObjectId[obj.object_id]}
            busy={busy || approvingId === obj.object_id}
            saving={savingId === obj.object_id}
            onSaveStart={() => setSavingId(obj.object_id)}
            onSaveEnd={() => setSavingId(null)}
            onContentSpecUpdated={onContentSpecUpdated}
            approverLabel={approverLabel}
            courseCode={courseCode}
            highlight={filterActive}
          />
        ))}
        </div>
      </div>
    </details>
  )
}

function ObjectContentSpecRow({
  ref_,
  obj,
  objectIndex,
  objectTotal,
  spec,
  busy,
  saving,
  onSaveStart,
  onSaveEnd,
  onContentSpecUpdated,
  approverLabel,
  courseCode,
  highlight,
}: {
  ref_: ApprovedNodeRef
  obj: NodeEngineBlueprintObject
  objectIndex: number
  objectTotal: number
  spec: NodeEngineContentSpec | null
  busy: boolean
  saving: boolean
  onSaveStart: () => void
  onSaveEnd: () => void
  onContentSpecUpdated: (objectId: string, spec: NodeEngineContentSpec) => void
  approverLabel: string
  courseCode: string
  highlight?: boolean
}) {
  const [explanation, setExplanation] = useState(spec?.required_explanation ?? '')

  useEffect(() => {
    setExplanation(spec?.required_explanation ?? '')
  }, [spec?.object_id, spec?.updated_at, spec?.required_explanation])

  async function handleGenerate() {
    try {
      const specs = await generateContentSpecs(
        courseCode,
        ref_.subtopicId,
        ref_.node.node_id,
        obj.object_id
      )
      const created = specs[0]
      if (created) {
        onContentSpecUpdated(created.object_id, created)
        setExplanation(created.required_explanation)
      }
      showToast({ title: 'Content spec generated', description: obj.title, variant: 'success' })
    } catch (error) {
      showToast({
        title: 'Generation failed',
        description: error instanceof Error ? error.message : 'Failed',
        variant: 'destructive',
      })
    }
  }

  async function handleSave() {
    if (!spec) return
    onSaveStart()
    try {
      const updated = await updateContentSpec(
        courseCode,
        ref_.subtopicId,
        ref_.node.node_id,
        obj.object_id,
        { required_explanation: explanation }
      )
      onContentSpecUpdated(updated.object_id, updated)
      showToast({ title: 'Saved', description: obj.title, variant: 'success' })
    } catch (error) {
      showToast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed',
        variant: 'destructive',
      })
    } finally {
      onSaveEnd()
    }
  }

  async function handleApprove() {
    if (!spec) return
    try {
      const approved = await approveContentSpec(
        courseCode,
        ref_.subtopicId,
        ref_.node.node_id,
        obj.object_id,
        approverLabel
      )
      onContentSpecUpdated(approved.object_id, approved)
      showToast({ title: 'Content spec approved', description: obj.title, variant: 'success' })
    } catch (error) {
      showToast({
        title: 'Approval failed',
        description: error instanceof Error ? error.message : 'Failed',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="rounded-md border border-border bg-background p-3 text-xs">
      <ObjectRowHeader
        objectIndex={objectIndex}
        objectTotal={objectTotal}
        title={`${obj.sequence_order}. ${obj.title}`}
        objectId={obj.object_id}
        highlight={highlight}
      >
        <Pill className="bg-muted text-muted-foreground">{obj.node_object_purpose ?? '—'}</Pill>
        <Pill className="bg-muted text-muted-foreground">{obj.suggested_vehicle}</Pill>
        {obj.is_primary_evidence_check && (
          <Pill className="bg-amber-500/15 text-amber-800 dark:text-amber-400">
            <Shield className="h-3 w-3" /> Primary EC
          </Pill>
        )}
        {spec ? (
          <Pill
            className={
              spec.grounding_strength === 'weak'
                ? 'bg-amber-500/15 text-amber-800 dark:text-amber-400'
                : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
            }
          >
            <BookOpen className="h-3 w-3" /> {spec.grounding_strength} grounding
          </Pill>
        ) : null}
        {spec && (
          <Pill
            className={
              spec.status === 'approved'
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground'
            }
          >
            {spec.status === 'approved' ? 'Approved' : 'Draft'}
          </Pill>
        )}
      </ObjectRowHeader>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void handleGenerate()} disabled={busy}>
          <Play className="mr-2 h-3 w-3" />
          {spec ? 'Regenerate' : 'Generate'}
        </Button>
        {spec && spec.status !== 'approved' && (
          <>
            <Button size="sm" variant="outline" onClick={() => void handleSave()} disabled={busy || saving}>
              {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
              Save explanation
            </Button>
            <Button size="sm" onClick={() => void handleApprove()} disabled={busy}>
              <Check className="mr-2 h-3 w-3" /> Approve
            </Button>
          </>
        )}
      </div>

      {spec ? (
        <div className="mt-3 space-y-2">
          <label className="block text-muted-foreground">Required explanation</label>
          <textarea
            className="min-h-[80px] w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            disabled={spec.status === 'approved'}
          />
          {spec.preservation_rules.length > 0 && (
            <div>
              <p className="mb-1 text-muted-foreground">Preservation rules</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {spec.preservation_rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>
          )}
          {spec.grounding_note && (
            <p className="text-amber-700 dark:text-amber-400">{spec.grounding_note}</p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-muted-foreground">No content spec yet — generate from the approved blueprint.</p>
      )}
    </div>
  )
}

export function Layer3ContinueCta({
  layer3Approved,
  onContinue,
}: {
  layer3Approved: boolean
  onContinue: () => void
}) {
  if (!layer3Approved) return null
  return (
    <div className="rounded-md border border-border bg-muted/20 p-4">
      <Button size="sm" variant="default" onClick={onContinue}>
        Continue to Layer 4 — Modality Production
        <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  )
}
