import { useMemo } from 'react'
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Edge,
  type Node,
  type NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from '@dagrejs/dagre'
import { Quote } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  NodeEngineSemanticElement,
  NodeEngineStructuredVisual,
  SemanticElementType,
} from '@/services/api'

/**
 * ReactFlow renderer for the hero / brand-facing structured visuals
 * (framework_diagram, hierarchy, annotated_example, infographic).
 *
 * Layout is dagre layered/tree (tidy "blueprint" look) — never force-directed.
 * The structured JSON is the source of truth; this only draws it read-only.
 */

const NODE_WIDTH = 240
const NODE_HEIGHT = 96

/** Left-accent + dot colour per semantic element type (calm palette). */
const ELEMENT_ACCENT: Record<SemanticElementType, { bar: string; dot: string; chip: string }> = {
  concept: { bar: 'bg-sky-500', dot: 'bg-sky-500', chip: 'text-sky-700 dark:text-sky-300' },
  criterion: { bar: 'bg-violet-500', dot: 'bg-violet-500', chip: 'text-violet-700 dark:text-violet-300' },
  step: { bar: 'bg-blue-500', dot: 'bg-blue-500', chip: 'text-blue-700 dark:text-blue-300' },
  example: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', chip: 'text-emerald-700 dark:text-emerald-300' },
  non_example: { bar: 'bg-rose-500', dot: 'bg-rose-500', chip: 'text-rose-700 dark:text-rose-300' },
  misconception: { bar: 'bg-red-500', dot: 'bg-red-500', chip: 'text-red-700 dark:text-red-300' },
  correction: { bar: 'bg-teal-500', dot: 'bg-teal-500', chip: 'text-teal-700 dark:text-teal-300' },
  evidence: { bar: 'bg-amber-500', dot: 'bg-amber-500', chip: 'text-amber-700 dark:text-amber-300' },
  decision_point: { bar: 'bg-indigo-500', dot: 'bg-indigo-500', chip: 'text-indigo-700 dark:text-indigo-300' },
  rubric_level: { bar: 'bg-fuchsia-500', dot: 'bg-fuchsia-500', chip: 'text-fuchsia-700 dark:text-fuchsia-300' },
  checklist_item: { bar: 'bg-slate-500', dot: 'bg-slate-500', chip: 'text-slate-700 dark:text-slate-300' },
}

interface HeroNodeData {
  label: string
  description?: string
  elementType: SemanticElementType
  citation?: string
  importance?: string
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ')
}

/** Branded "blueprint" node card. */
function HeroNode({ data }: NodeProps<HeroNodeData>) {
  const accent = ELEMENT_ACCENT[data.elementType] ?? ELEMENT_ACCENT.concept
  return (
    <div
      className="relative flex overflow-hidden rounded-[8px] border border-border/70 bg-card shadow-sm"
      style={{ width: NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-muted-foreground/40" />
      <span className={cn('w-1 shrink-0', accent.bar)} aria-hidden />
      <div className="min-w-0 flex-1 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', accent.dot)} aria-hidden />
          <span className={cn('truncate text-[9px] font-bold uppercase tracking-wider', accent.chip)}>
            {humanize(data.elementType)}
          </span>
          {data.importance && (
            <span className="ml-auto text-[9px] uppercase tracking-wide text-muted-foreground">
              {data.importance}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm font-semibold text-foreground" title={data.label}>
          {data.label}
        </p>
        {data.description && (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            {data.description}
          </p>
        )}
        {data.citation && (
          <span className="mt-1 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
            <Quote className="h-2.5 w-2.5" />
            {data.citation}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-muted-foreground/40" />
    </div>
  )
}

const nodeTypes = { hero: HeroNode }

/** Run dagre layered layout (top-to-bottom) and return positioned nodes. */
function layoutWithDagre(nodes: Node<HeroNodeData>[], edges: Edge[]): Node<HeroNodeData>[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 72, marginx: 16, marginy: 16 })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }
  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    return {
      ...node,
      position: { x: (pos?.x ?? 0) - NODE_WIDTH / 2, y: (pos?.y ?? 0) - NODE_HEIGHT / 2 },
    }
  })
}

export function StructuredVisualFlow({
  visual,
  height = 480,
}: {
  visual: NodeEngineStructuredVisual
  height?: number
}) {
  const { nodes, edges } = useMemo(() => {
    const idByElement = new Map<string, string>()
    visual.semantic_elements.forEach((el, i) => idByElement.set(el.element_id, `n${i}`))

    const ordered: NodeEngineSemanticElement[] = []
    const seen = new Set<string>()
    for (const id of visual.reading_order) {
      const el = visual.semantic_elements.find((e) => e.element_id === id)
      if (el && !seen.has(el.element_id)) {
        ordered.push(el)
        seen.add(el.element_id)
      }
    }
    for (const el of visual.semantic_elements) {
      if (!seen.has(el.element_id)) {
        ordered.push(el)
        seen.add(el.element_id)
      }
    }

    const rawNodes: Node<HeroNodeData>[] = ordered.map((el) => ({
      id: idByElement.get(el.element_id)!,
      type: 'hero',
      position: { x: 0, y: 0 },
      data: {
        label: el.label,
        description: el.description,
        elementType: el.element_type,
        citation: el.citation,
        importance: el.importance,
      },
    }))

    const rawEdges: Edge[] = visual.relationships
      .filter((r) => idByElement.has(r.from_element_id) && idByElement.has(r.to_element_id))
      .map((r, i) => ({
        id: `e${i}`,
        source: idByElement.get(r.from_element_id)!,
        target: idByElement.get(r.to_element_id)!,
        label: r.label?.trim() || humanize(r.relationship_type),
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        style: { strokeWidth: 1.5 },
      }))

    return { nodes: layoutWithDagre(rawNodes, rawEdges), edges: rawEdges }
  }, [visual])

  return (
    <div className="rounded-[6px] border border-border/50 bg-muted/10" style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.2}
        maxZoom={1.5}
      >
        <Background gap={20} size={1} className="opacity-50" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export default StructuredVisualFlow
