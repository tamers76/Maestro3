import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  Shield,
  Sparkles,
} from 'lucide-react'
import { StatTile } from '@/components/ui/StatTile'
import { showToast } from '@/components/ui/Toaster'
import { cn } from '@/lib/utils'
import {
  approveBlueprint,
  generateBlueprint,
  updateBlueprint,
  type BlueprintObjectPatch,
  type BlueprintVehicle,
  type NodeEngineBlueprint,
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
import { EntityCodeBadge, MasteryNodeSummary, NodeEngineFilterBar } from './NodeEngineUi'

/**
 * Decision-button styles shared with the Course Architect / Node Engine layers:
 * light tint at rest, solid on hover/selection. primary/generate = blue,
 * approve = emerald, regenerate = neutral slate.
 */
const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[12px] border px-3 py-1.5 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const PRIMARY_BTN = `${BTN_BASE} border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-600 hover:text-white hover:border-transparent focus-visible:ring-blue-500/40`
const APPROVE_BTN = `${BTN_BASE} border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500 hover:text-white hover:border-transparent focus-visible:ring-emerald-500/40`
const REGEN_BTN = `${BTN_BASE} border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300 hover:bg-slate-600 hover:text-white hover:border-transparent focus-visible:ring-slate-400/40`

interface CloBlueprintGroup {
  clo_id: string
  refined_clo: string
  nodes: ApprovedNodeRef[]
}

const VEHICLE_OPTIONS: BlueprintVehicle[] = [
  'text',
  'structured_visual',
  'pictorial_visual',
  'video',
  'interactive',
  'simulation',
  'learning_anchor',
]

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

function buildApprovedNodeGroups(
  cloGroups: Array<{
    clo_id: string
    refined_clo: string
    subtopics: Array<{ subtopic_id: string; title: string }>
  }>,
  nodeSetsBySubtopicId: Record<string, NodeEngineNodeSet | null>
): CloBlueprintGroup[] {
  return cloGroups
    .map((group) => {
      const nodes: ApprovedNodeRef[] = []
      for (const st of group.subtopics) {
        const nodeSet = nodeSetsBySubtopicId[st.subtopic_id]
        if (nodeSet?.status !== 'approved') continue
        for (const node of nodeSet.nodes) {
          if (node.status === 'approved') {
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

export interface Layer2BodyProps {
  status: 'locked' | 'available' | 'running' | 'needs_review' | 'approved' | 'completed'
  cloGroups: Array<{
    clo_id: string
    refined_clo: string
    subtopics: Array<{ subtopic_id: string; title: string }>
  }>
  nodeSetsBySubtopicId: Record<string, NodeEngineNodeSet | null>
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>
  hydrating: boolean
  busy: boolean
  generatingCloId: string | null
  approvingCloId: string | null
  onGenerateClo: (cloId: string) => Promise<void>
  onApproveClo: (cloId: string) => Promise<void>
  onBlueprintUpdated: (nodeId: string, blueprint: NodeEngineBlueprint) => void
  layer2Approved: boolean
  approverLabel: string
  courseCode: string
  filters: NodeEngineFilterState
  onFiltersChange: (filters: NodeEngineFilterState) => void
}

export function Layer2Body({
  status,
  cloGroups,
  nodeSetsBySubtopicId,
  blueprintsByNodeId,
  hydrating,
  busy,
  generatingCloId,
  approvingCloId,
  onGenerateClo,
  onApproveClo,
  onBlueprintUpdated,
  layer2Approved,
  approverLabel,
  courseCode,
  filters,
  onFiltersChange,
}: Layer2BodyProps) {
  const groups = useMemo(
    () => buildApprovedNodeGroups(cloGroups, nodeSetsBySubtopicId),
    [cloGroups, nodeSetsBySubtopicId]
  )

  const allNodes = useMemo(() => groups.flatMap((g) => g.nodes), [groups])

  const matchCount = useMemo(
    () =>
      countLayerMatches(
        allNodes,
        filters,
        'blueprint',
        (nodeId) => blueprintsByNodeId[nodeId],
        (ref) => blueprintsByNodeId[ref.node.node_id]?.objects ?? []
      ),
    [allNodes, filters, blueprintsByNodeId]
  )

  const filterActive = isFilterActive(filters)

  const totalNodes = groups.reduce((sum, g) => sum + g.nodes.length, 0)
  const generatedCount = groups.reduce(
    (sum, g) => sum + g.nodes.filter((n) => blueprintsByNodeId[n.node.node_id]).length,
    0
  )
  const approvedCount = groups.reduce(
    (sum, g) =>
      sum + g.nodes.filter((n) => blueprintsByNodeId[n.node.node_id]?.status === 'approved').length,
    0
  )

  if (status === 'locked') {
    return (
      <p className="text-sm text-muted-foreground">
        Approve all Layer 1 node sets before shaping experience blueprints.
      </p>
    )
  }

  if (hydrating) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading blueprints…
      </div>
    )
  }

  if (totalNodes === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No approved nodes yet. Complete and approve Layer 1 first.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stat cards — course-wide blueprint progress. */}
      <div className="md-scope grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 sm:px-10 xl:grid-cols-5">
        <StatTile icon={BookOpen} label="CLOs covered" value={groups.length} color="slate" size="sm" />
        <StatTile icon={Boxes} label="Mastery nodes" value={totalNodes} color="blue" size="sm" />
        <StatTile icon={Sparkles} label="Blueprinted" value={`${generatedCount}/${totalNodes}`} color="rose" size="sm" />
        <StatTile icon={CheckCircle2} label="Approved" value={approvedCount} color="emerald" size="sm" />
        <StatTile icon={Clock} label="Pending" value={totalNodes - approvedCount} color="amber" size="sm" />
      </div>

      <NodeEngineFilterBar
        layer="blueprint"
        filters={filters}
        onChange={onFiltersChange}
        matchCount={filterActive ? matchCount : undefined}
      />

      {groups.map((group) => {
        const visibleNodes = filterActive
          ? group.nodes.filter((ref) =>
              nodeIsVisible(
                ref,
                blueprintsByNodeId[ref.node.node_id]?.objects ?? [],
                filters,
                { layer: 'blueprint', blueprint: blueprintsByNodeId[ref.node.node_id] }
              )
            )
          : group.nodes
        if (filterActive && visibleNodes.length === 0) return null
        return (
        <CloBlueprintGroupCard
          key={group.clo_id}
          group={{ ...group, nodes: visibleNodes }}
          blueprintsByNodeId={blueprintsByNodeId}
          generating={generatingCloId === group.clo_id}
          approving={approvingCloId === group.clo_id}
          busy={busy}
          onGenerate={() => onGenerateClo(group.clo_id)}
          onApprove={() => onApproveClo(group.clo_id)}
          onBlueprintUpdated={onBlueprintUpdated}
          approverLabel={approverLabel}
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

interface CloBlueprintGroupCardProps {
  group: CloBlueprintGroup
  blueprintsByNodeId: Record<string, NodeEngineBlueprint | null>
  generating: boolean
  approving: boolean
  busy: boolean
  onGenerate: () => void
  onApprove: () => void
  onBlueprintUpdated: (nodeId: string, blueprint: NodeEngineBlueprint) => void
  approverLabel: string
  courseCode: string
  filters: NodeEngineFilterState
  filterActive: boolean
}

function CloBlueprintGroupCard({
  group,
  blueprintsByNodeId,
  generating,
  approving,
  busy,
  onGenerate,
  onApprove,
  onBlueprintUpdated,
  approverLabel,
  courseCode,
  filters,
  filterActive,
}: CloBlueprintGroupCardProps) {
  const [collapsed, setCollapsed] = useState(true)
  const generated = group.nodes.filter((n) => blueprintsByNodeId[n.node.node_id]).length
  const approved = group.nodes.filter(
    (n) => blueprintsByNodeId[n.node.node_id]?.status === 'approved'
  ).length
  const pendingApproval = generated > approved

  return (
    <div className="rounded-[4px] border border-border">
      <div className="space-y-3 p-4">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex w-full items-start justify-between gap-2 text-left"
          aria-expanded={!collapsed}
        >
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider label-accent">
              {group.clo_id}
            </p>
            <p className="mt-0.5 text-sm font-medium text-foreground">{group.refined_clo}</p>
          </div>
          {collapsed ? (
            <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          )}
        </button>
        <div className="flex flex-wrap gap-2">
          <Pill className="bg-blue-500/15 text-blue-600 dark:text-blue-400">
            {generated}/{group.nodes.length} generated
          </Pill>
          <Pill className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            {approved}/{group.nodes.length} approved
          </Pill>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={generated > 0 ? REGEN_BTN : PRIMARY_BTN}
            onClick={() => {
              setCollapsed(false)
              onGenerate()
            }}
            disabled={busy}
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : generated > 0 ? (
              <RefreshCw className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {generated > 0
              ? `Regenerate blueprints for ${group.clo_id}`
              : `Generate blueprints for ${group.clo_id}`}
          </button>
          {pendingApproval && (
            <button type="button" className={APPROVE_BTN} onClick={onApprove} disabled={busy}>
              {approving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Approve all for {group.clo_id}
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          {group.nodes.map((ref, nodeIndex) => (
            <NodeBlueprintCard
              key={ref.node.node_id}
              ref_={ref}
              nodeIndex={nodeIndex + 1}
              blueprint={blueprintsByNodeId[ref.node.node_id] ?? null}
              busy={busy}
              onBlueprintUpdated={onBlueprintUpdated}
              approverLabel={approverLabel}
              courseCode={courseCode}
              filters={filters}
              filterActive={filterActive}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NodeBlueprintCard({
  ref_,
  nodeIndex,
  blueprint,
  busy,
  onBlueprintUpdated,
  approverLabel,
  courseCode,
  filters,
  filterActive,
}: {
  ref_: ApprovedNodeRef
  nodeIndex: number
  blueprint: NodeEngineBlueprint | null
  busy: boolean
  onBlueprintUpdated: (nodeId: string, blueprint: NodeEngineBlueprint) => void
  approverLabel: string
  courseCode: string
  filters: NodeEngineFilterState
  filterActive: boolean
}) {
  const [generating, setGenerating] = useState(false)
  const [approving, setApproving] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const sortedObjects = useMemo(
    () =>
      [...(blueprint?.objects ?? [])].sort((a, b) => a.sequence_order - b.sequence_order),
    [blueprint?.objects]
  )

  const visibleObjects = useMemo(
    () =>
      filterVisibleObjects(sortedObjects, ref_, filters, {
        layer: 'blueprint',
        blueprint,
      }),
    [sortedObjects, ref_, filters, blueprint]
  )

  const forceOpen = filterActive && visibleObjects.length > 0

  async function handleGenerate() {
    setGenerating(true)
    try {
      const result = await generateBlueprint(courseCode, ref_.subtopicId, ref_.node.node_id)
      onBlueprintUpdated(ref_.node.node_id, result)
      showToast({ title: 'Blueprint generated', description: ref_.node.node_title, variant: 'success' })
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

  async function handleApprove() {
    setApproving(true)
    try {
      const result = await approveBlueprint(
        courseCode,
        ref_.subtopicId,
        ref_.node.node_id,
        approverLabel
      )
      onBlueprintUpdated(ref_.node.node_id, result)
      showToast({ title: 'Blueprint approved', description: ref_.node.node_title, variant: 'success' })
    } catch (error) {
      showToast({
        title: 'Approval failed',
        description: error instanceof Error ? error.message : 'Failed',
        variant: 'destructive',
      })
    } finally {
      setApproving(false)
    }
  }

  async function handleVehicleChange(objectId: string, vehicle: BlueprintVehicle) {
    if (!blueprint) return
    setSavingId(objectId)
    try {
      const patch: BlueprintObjectPatch = { object_id: objectId, suggested_vehicle: vehicle }
      const result = await updateBlueprint(courseCode, ref_.subtopicId, ref_.node.node_id, [patch])
      onBlueprintUpdated(ref_.node.node_id, result)
    } catch (error) {
      showToast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed',
        variant: 'destructive',
      })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <details className="rounded-[4px] border border-border" open={forceOpen || !blueprint}>
      <summary className="cursor-pointer px-3 py-2 text-sm">
        <MasteryNodeSummary
          nodeIndex={nodeIndex}
          title={ref_.node.node_title}
          nodeId={ref_.node.node_id}
          highlight={forceOpen}
        >
          <Pill className="bg-muted text-muted-foreground">{ref_.subtopicTitle}</Pill>
          <Pill className="bg-muted text-muted-foreground">{ref_.node.node_type}</Pill>
          {blueprint ? (
            <Pill
              className={
                blueprint.status === 'approved'
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              }
            >
              {blueprint.status === 'approved' ? (
                <>
                  <Check className="h-3 w-3" /> Approved
                </>
              ) : (
                'Draft'
              )}
            </Pill>
          ) : (
            <Pill className="bg-muted text-muted-foreground">Not generated</Pill>
          )}
        </MasteryNodeSummary>
      </summary>

      <div className="space-y-3 border-t border-border px-3 py-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={blueprint ? REGEN_BTN : PRIMARY_BTN}
            onClick={() => void handleGenerate()}
            disabled={busy || generating}
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : blueprint ? <RefreshCw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {blueprint ? 'Regenerate' : 'Generate blueprint'}
          </button>
          {blueprint && blueprint.status !== 'approved' && (
            <button type="button" className={APPROVE_BTN} onClick={() => void handleApprove()} disabled={busy || approving}>
              {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve blueprint
            </button>
          )}
        </div>

        {blueprint && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-2">#</th>
                  <th className="py-2 pr-2">Object</th>
                  <th className="py-2 pr-2">Code</th>
                  <th className="py-2 pr-2">Purpose</th>
                  <th className="py-2 pr-2">Vehicle</th>
                  <th className="py-2">Rationale</th>
                </tr>
              </thead>
              <tbody>
                {visibleObjects.map((obj) => (
                    <tr
                      key={obj.object_id}
                      className={cn(
                        'border-b border-border/60',
                        obj.is_primary_evidence_check && 'bg-amber-500/5'
                      )}
                    >
                      <td className="py-2 pr-2 align-top">{obj.sequence_order}</td>
                      <td className="py-2 pr-2 align-top">
                        <div className="font-medium">{obj.title}</div>
                        {obj.is_primary_evidence_check && (
                          <Pill className="mt-1 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                            <Shield className="h-3 w-3" /> Primary EC
                          </Pill>
                        )}
                        {obj.targets_misconception_id && (
                          <Pill className="mt-1 bg-violet-500/15 text-violet-700 dark:text-violet-400">
                            Targets {obj.targets_misconception_id}
                          </Pill>
                        )}
                      </td>
                      <td className="py-2 pr-2 align-top">
                        <EntityCodeBadge code={obj.object_id} />
                      </td>
                      <td className="py-2 pr-2 align-top">{obj.node_object_purpose ?? '—'}</td>
                      <td className="py-2 pr-2 align-top">
                        <select
                          className="rounded border border-border bg-background px-2 py-1 text-xs"
                          value={obj.suggested_vehicle}
                          disabled={savingId === obj.object_id || obj.is_primary_evidence_check}
                          onChange={(e) =>
                            void handleVehicleChange(obj.object_id, e.target.value as BlueprintVehicle)
                          }
                        >
                          {VEHICLE_OPTIONS.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 align-top text-muted-foreground">{obj.design_rationale}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {!blueprint && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Generate a blueprint to see the Level-1 object sequence (orientation → explanation →
            primary evidence check).
          </p>
        )}
      </div>
    </details>
  )
}

export function Layer2ContinueCta({
  layer2Approved,
  onContinue,
}: {
  layer2Approved: boolean
  onContinue: () => void
}) {
  if (!layer2Approved) return null
  return (
    <div className="rounded-[4px] border border-border bg-muted/20 p-4">
      <button type="button" className={PRIMARY_BTN} onClick={onContinue}>
        Continue to Layer 3 — Content Specification
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}
