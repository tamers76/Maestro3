import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  ConnectionMode,
  Handle,
  Position,
  NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { cn } from '@/lib/utils'
import type { GraphData } from '@/services/api'
import {
  BookOpen,
  Lightbulb,
  ListChecks,
  Target,
  Brain,
  ArrowRightLeft,
  FileText,
} from 'lucide-react'

// Node type colors matching CLOGraphEditor — canonical 6 types
const NODE_TYPE_COLORS: Record<string, { 
  bg: string; 
  border: string; 
  darkBg: string;
  text: string;
  icon: React.ElementType;
  label: string;
}> = {
  concept: { 
    bg: 'bg-sky-50', border: 'border-sky-400', darkBg: 'dark:bg-sky-950', text: 'text-sky-700',
    icon: BookOpen, label: 'Concept'
  },
  principle: { 
    bg: 'bg-violet-50', border: 'border-violet-400', darkBg: 'dark:bg-violet-950', text: 'text-violet-700',
    icon: Lightbulb, label: 'Principle'
  },
  procedure: { 
    bg: 'bg-orange-50', border: 'border-orange-400', darkBg: 'dark:bg-orange-950', text: 'text-orange-700',
    icon: ListChecks, label: 'Procedure'
  },
  application: { 
    bg: 'bg-emerald-50', border: 'border-emerald-400', darkBg: 'dark:bg-emerald-950', text: 'text-emerald-700',
    icon: Target, label: 'Application'
  },
  metacognitive: { 
    bg: 'bg-amber-50', border: 'border-amber-400', darkBg: 'dark:bg-amber-950', text: 'text-amber-700',
    icon: Brain, label: 'Metacognitive'
  },
  transfer: { 
    bg: 'bg-pink-50', border: 'border-pink-400', darkBg: 'dark:bg-pink-950', text: 'text-pink-700',
    icon: ArrowRightLeft, label: 'Transfer'
  },
  // Fallback for legacy or unknown node types
  learning_node: { 
    bg: 'bg-slate-50', border: 'border-slate-400', darkBg: 'dark:bg-slate-950', text: 'text-slate-700',
    icon: BookOpen, label: 'Node'
  },
  // Topic node style
  topic: {
    bg: 'bg-teal-50', border: 'border-teal-400', darkBg: 'dark:bg-teal-950', text: 'text-teal-700',
    icon: FileText, label: 'Topic'
  },
}

interface GraphViewerProps {
  graphData: GraphData
  onNodeClick?: (node: Node) => void
}

// Helper to get node status (uses new skipping_eligibility when available, falls back to legacy booleans)
function getNodeStatus(data: Record<string, unknown>): 'required' | 'conditional' | 'skippable' {
  const skippingEligibility = data.skipping_eligibility as string | undefined
  
  // Use new 4-way enum if present
  if (skippingEligibility) {
    if (skippingEligibility === 'non_skippable' || skippingEligibility === 'not_applicable') return 'required'
    if (skippingEligibility === 'conditionally_skippable') return 'conditional'
    if (skippingEligibility === 'skippable') return 'skippable'
  }
  
  // Fallback to legacy booleans
  const mandatory = data.mandatory as boolean | undefined
  const skippable = data.skippable as boolean | undefined
  const skipConditions = data.skip_conditions as string | undefined
  
  if (mandatory && !skippable) return 'required'
  if (skippable && skipConditions && skipConditions.length > 0) return 'conditional'
  if (skippable) return 'skippable'
  return 'required'
}

// Skipping eligibility badge colors
const ELIGIBILITY_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  non_skippable: { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-700 dark:text-red-400', label: 'Required' },
  conditionally_skippable: { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-400', label: 'Conditional' },
  skippable: { bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-700 dark:text-green-400', label: 'Skippable' },
  not_applicable: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-500 dark:text-slate-400', label: 'N/A' },
}

// Stage 3 badge styles
const GATE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  strict: { bg: 'bg-red-50 dark:bg-red-900/30', text: 'text-red-600 dark:text-red-400', label: 'Strict' },
  flexible: { bg: 'bg-blue-50 dark:bg-blue-900/30', text: 'text-blue-600 dark:text-blue-400', label: 'Flex' },
}

// Custom Learning Node Component (matches CLOGraphEditor style)
function LearningNodeComponent({ data }: NodeProps) {
  const nodeType = data.nodeType || 'learning_node'
  const config = NODE_TYPE_COLORS[nodeType] || NODE_TYPE_COLORS.learning_node
  const Icon = config.icon
  const eligibility = (data.skipping_eligibility as string) || ''
  const badge = ELIGIBILITY_BADGE[eligibility]
  const gateStrictness = (data.stage3_gate_strictness as string) || ''
  const gateBadge = GATE_BADGE[gateStrictness]
  const preknowledgeEligible = data.stage3_preknowledge_eligible as boolean | undefined
  
  return (
    <div className={cn(
      'group relative rounded-xl border-2 shadow-sm transition-all duration-200 min-w-[200px] max-w-[260px]',
      config.bg, config.border, config.darkBg,
      'hover:shadow-md'
    )}>
      {/* Left Handle (target) */}
      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          '!w-3 !h-3 !bg-slate-400 dark:!bg-slate-500 !border-2 !border-white dark:!border-slate-800',
          '!-left-1.5 transition-all'
        )}
      />
      
      {/* Node Content */}
      <div className="p-3">
        {/* Header */}
        <div className="flex items-start gap-2 mb-2">
          <div className={cn('flex-shrink-0 p-1.5 rounded-lg', config.bg, config.darkBg)}>
            <Icon className={cn('h-4 w-4', config.text)} />
          </div>
          <div className="flex-1 min-w-0 flex items-center justify-between gap-1">
            <span className={cn('text-[10px] font-semibold uppercase tracking-wider', config.text)}>
              {config.label}
            </span>
            {badge && (
              <span className={cn('text-[9px] font-medium px-1.5 py-0.5 rounded-full', badge.bg, badge.text)}>
                {badge.label}
              </span>
            )}
          </div>
        </div>
        
        {/* Learning Intent */}
        <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-3 leading-relaxed">
          {data.label}
        </p>
        
        {/* Stage 3 badges row */}
        {(gateBadge || preknowledgeEligible) && (
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {gateBadge && (
              <span className={cn('text-[8px] font-medium px-1 py-0.5 rounded', gateBadge.bg, gateBadge.text)}>
                {gateBadge.label} gate
              </span>
            )}
            {preknowledgeEligible && (
              <span className="text-[8px] font-medium px-1 py-0.5 rounded bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400">
                Pre-check
              </span>
            )}
          </div>
        )}
      </div>
      
      {/* Right Handle (source) */}
      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          '!w-3 !h-3 !bg-slate-400 dark:!bg-slate-500 !border-2 !border-white dark:!border-slate-800',
          '!-right-1.5 transition-all'
        )}
      />
    </div>
  )
}

// Custom Topic Node Component
function TopicNodeComponent({ data }: NodeProps) {
  return (
    <div className="group relative rounded-xl border-2 border-teal-400 bg-teal-50 dark:bg-teal-950 shadow-sm min-w-[200px] max-w-[280px]">
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-teal-400 !border-2 !border-white !-left-1.5"
      />
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <FileText className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400">
            Topic
          </span>
        </div>
        <p className="text-xs font-medium text-teal-800 dark:text-teal-300 line-clamp-3">
          {data.label}
        </p>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-teal-400 !border-2 !border-white !-right-1.5"
      />
    </div>
  )
}

// Custom CLO Node Component
function CLONodeComponent({ data }: NodeProps) {
  return (
    <div className="group relative rounded-xl border-2 border-blue-500 bg-blue-50 dark:bg-blue-950 shadow-sm min-w-[220px] max-w-[300px]">
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-blue-400 !border-2 !border-white !-left-1.5"
      />
      <div className="p-3">
        <p className="text-xs font-medium text-blue-700 dark:text-blue-300 line-clamp-3">
          {data.label}
        </p>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-blue-400 !border-2 !border-white !-right-1.5"
      />
    </div>
  )
}

// Custom Course Node Component
function CourseNodeComponent({ data }: NodeProps) {
  return (
    <div className="group relative rounded-xl border-2 border-slate-600 bg-slate-800 shadow-lg min-w-[180px]">
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-slate-400 !border-2 !border-white !-right-1.5"
      />
      <div className="p-4">
        <p className="text-sm font-semibold text-white text-center">
          {data.label}
        </p>
      </div>
    </div>
  )
}

// Register custom node types
const nodeTypes = {
  learningNode: LearningNodeComponent,
  topicNode: TopicNodeComponent,
  cloNode: CLONodeComponent,
  courseNode: CourseNodeComponent,
}

export default function GraphViewer({ graphData, onNodeClick }: GraphViewerProps) {
  const [showHierarchyEdges, setShowHierarchyEdges] = useState(false)
  
  // Convert graph data to React Flow format with LEFT-TO-RIGHT layout
  const { initialNodes, initialEdges } = useMemo(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []
    
    // Group nodes by type
    const courseNodes = graphData.nodes.filter(n => n.type === 'course')
    const cloNodes = graphData.nodes.filter(n => n.type === 'clo')
    const topicNodes = graphData.nodes.filter(n => n.type === 'topic')
    const learningNodes = graphData.nodes.filter(n => n.type === 'learning_node')
    
    // Layout parameters for LEFT-TO-RIGHT flow
    const horizontalSpacing = 380  // Space between dependency levels (columns)
    const verticalSpacing = 180    // Space between nodes in same column
    const startX = 50              // Starting X position
    
    // Build maps for prerequisite lookup - handle multiple ID formats
    // Graph node IDs might be "node-CLO-1-N1" while prerequisite_nodes contains "CLO-1-N1"
    const nodeIdToNode = new Map<string, typeof learningNodes[0]>()
    const normalizedIdMap = new Map<string, string>() // maps any ID variant to canonical ID
    
    learningNodes.forEach(n => {
      nodeIdToNode.set(n.id, n)
      normalizedIdMap.set(n.id, n.id)
      
      // Also map without 'node-' prefix
      const rawId = n.id.replace('node-', '')
      nodeIdToNode.set(rawId, n)
      normalizedIdMap.set(rawId, n.id)
      
      // Also try the node_id from data if present
      const dataNodeId = (n.data as { node_id?: string }).node_id
      if (dataNodeId) {
        nodeIdToNode.set(dataNodeId, n)
        normalizedIdMap.set(dataNodeId, n.id)
      }
    })
    
    // Calculate depth for ALL learning nodes based on prerequisites
    const nodeDepths = new Map<string, number>()
    const processing = new Set<string>() // For cycle detection
    
    function getDepth(nodeId: string): number {
      const canonicalId = normalizedIdMap.get(nodeId) || nodeId
      
      if (nodeDepths.has(canonicalId)) return nodeDepths.get(canonicalId)!
      if (processing.has(canonicalId)) return 0 // Cycle protection
      processing.add(canonicalId)
      
      const node = nodeIdToNode.get(nodeId)
      if (!node) {
        nodeDepths.set(canonicalId, 0)
        return 0
      }
      
      const prereqIds = (node.data as { prerequisite_nodes?: string[] }).prerequisite_nodes || []
      
      if (prereqIds.length === 0) {
        nodeDepths.set(canonicalId, 0)
        processing.delete(canonicalId)
        return 0
      }
      
      // Find valid prerequisites that exist in our node set
      const validPrereqDepths: number[] = []
      for (const pid of prereqIds) {
        // Try to find this prerequisite node
        if (nodeIdToNode.has(pid) || nodeIdToNode.has(`node-${pid}`)) {
          const prereqDepth = getDepth(nodeIdToNode.has(pid) ? pid : `node-${pid}`)
          validPrereqDepths.push(prereqDepth)
        }
      }
      
      if (validPrereqDepths.length === 0) {
        nodeDepths.set(canonicalId, 0)
        processing.delete(canonicalId)
        return 0
      }
      
      const depth = Math.max(...validPrereqDepths) + 1
      nodeDepths.set(canonicalId, depth)
      processing.delete(canonicalId)
      return depth
    }
    
    // Calculate depths for all learning nodes
    learningNodes.forEach(n => getDepth(n.id))
    
    // Group learning nodes by depth using canonical IDs
    const nodesByDepth = new Map<number, typeof learningNodes>()
    learningNodes.forEach(node => {
      const canonicalId = normalizedIdMap.get(node.id) || node.id
      const depth = nodeDepths.get(canonicalId) || 0
      if (!nodesByDepth.has(depth)) nodesByDepth.set(depth, [])
      nodesByDepth.get(depth)!.push(node)
    })
    
    // Calculate total height needed
    const maxNodesInColumn = Math.max(...Array.from(nodesByDepth.values()).map(arr => arr.length), 1)
    const totalCanvasHeight = maxNodesInColumn * verticalSpacing + 100
    
    // Position learning nodes LEFT TO RIGHT by depth
    nodesByDepth.forEach((nodesAtDepth, depth) => {
      // Sort nodes at same depth by CLO for grouping
      nodesAtDepth.sort((a, b) => {
        const aClo = (a.data as { clo_id?: string }).clo_id || ''
        const bClo = (b.data as { clo_id?: string }).clo_id || ''
        return aClo.localeCompare(bClo)
      })
      
      const columnHeight = nodesAtDepth.length * verticalSpacing
      const startY = (totalCanvasHeight - columnHeight) / 2 + 50
      
      nodesAtDepth.forEach((node, i) => {
        const nodeType = (node.data as { node_type?: string }).node_type || 'learning_node'
        const status = getNodeStatus(node.data)
        
        nodes.push({
          id: node.id,
          position: { 
            x: startX + depth * horizontalSpacing,
            y: startY + i * verticalSpacing
          },
          data: { 
            label: node.label,
            nodeType,
            status,
            ...node.data 
          },
          type: 'learningNode',
        })
      })
    })
    
    // Only show Course, CLO, and Topic nodes when hierarchy edges are enabled
    // Otherwise they appear disconnected and confusing
    if (showHierarchyEdges) {
      const courseX = -700
      const canvasCenterY = totalCanvasHeight / 2
      
      courseNodes.forEach((node) => {
        nodes.push({
          id: node.id,
          position: { x: courseX, y: canvasCenterY },
          data: { 
            label: node.label,
            nodeType: 'course',
            ...node.data 
          },
          type: 'courseNode',
        })
      })
      
      // Position CLO nodes
      const cloX = -400
      const cloSpacing = 150
      const cloStartY = canvasCenterY - (cloNodes.length * cloSpacing) / 2
      
      cloNodes.forEach((node, i) => {
        nodes.push({
          id: node.id,
          position: { x: cloX, y: cloStartY + i * cloSpacing },
          data: { 
            label: node.label,
            nodeType: 'clo',
            ...node.data 
          },
          type: 'cloNode',
        })
      })
      
      // Position Topic nodes between CLO and learning nodes
      const topicX = -150
      const topicSpacing = 130
      const topicStartY = canvasCenterY - (topicNodes.length * topicSpacing) / 2
      
      topicNodes.forEach((node, i) => {
        nodes.push({
          id: node.id,
          position: { x: topicX, y: topicStartY + i * topicSpacing },
          data: { 
            label: node.label,
            nodeType: 'topic',
            ...node.data 
          },
          type: 'topicNode',
        })
      })
    }
    
    const nodeIds = new Set(nodes.map(n => n.id))

    // Create edges with BEZIER type for smooth curves
    graphData.edges.forEach(edge => {
      const isPrereq = edge.type === 'PREREQUIRES'
      const isHierarchy = edge.type === 'HAS_CLO' || edge.type === 'DECOMPOSED_TO' || edge.type === 'HAS_TOPIC'
      
      // If hierarchy nodes are not shown, don't create hierarchy edges at all.
      // Keeping edges whose endpoints aren't mounted can produce "ghost" arrows during view changes.
      if (isHierarchy && !showHierarchyEdges) return

      // For prerequisite edges, reverse direction for left-to-right flow
      // Original: source PREREQUIRES target (source depends on target)
      // Visual: arrow from target (prerequisite) to source (dependent)
      const visualSource = isPrereq ? edge.target : edge.source
      const visualTarget = isPrereq ? edge.source : edge.target

      // Only render edges when both endpoints exist in the current node set
      if (!nodeIds.has(visualSource) || !nodeIds.has(visualTarget)) return
      
      edges.push({
        id: edge.id,
        source: visualSource,
        target: visualTarget,
        type: 'bezier',  // Smooth bezier curves
        animated: false,
        style: {
          stroke: isPrereq ? 'hsl(var(--primary))' : '#94a3b8',
          strokeWidth: 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isPrereq ? 'hsl(var(--primary))' : '#94a3b8',
          width: 20,
          height: 20,
        },
      })
    })
    
    return { initialNodes: nodes, initialEdges: edges }
  }, [graphData, showHierarchyEdges])
  
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Sync React Flow state when the underlying graph data changes
  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, setNodes])

  useEffect(() => {
    setEdges(initialEdges)
  }, [initialEdges, setEdges])
  
  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    onNodeClick?.(node)
  }, [onNodeClick])
  
  return (
    <div className="h-[700px] w-full rounded-lg border bg-slate-50 dark:bg-slate-900 relative overflow-hidden">
      <ReactFlow
        key={showHierarchyEdges ? 'with-hierarchy' : 'no-hierarchy'}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background 
          color="hsl(var(--muted-foreground))" 
          gap={24} 
          size={1}
          style={{ opacity: 0.3 }}
        />
        <Controls 
          className="bg-background border shadow-sm rounded-lg"
          showInteractive={false}
        />
      </ReactFlow>
      
      {/* Controls */}
      <div className="absolute top-4 left-4 rounded-lg bg-card/95 backdrop-blur p-3 shadow-lg border text-xs space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showHierarchyEdges}
            onChange={(e) => setShowHierarchyEdges(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className="text-muted-foreground">Show hierarchy edges</span>
        </label>
      </div>
      
      {/* Node Type Legend */}
      <div className="absolute bottom-4 left-4 rounded-lg bg-card/95 backdrop-blur p-3 shadow-lg border text-xs space-y-2">
        <p className="font-semibold text-foreground mb-2">Node Types</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {Object.entries(NODE_TYPE_COLORS)
            .filter(([type]) => type !== 'learning_node' && type !== 'topic')
            .map(([type, config]) => {
              const Icon = config.icon
              return (
                <div key={type} className="flex items-center gap-2">
                  <div className={cn('p-1 rounded', config.bg, config.border, 'border')}>
                    <Icon className={cn('h-3 w-3', config.text)} />
                  </div>
                  <span className="capitalize text-muted-foreground">{config.label}</span>
                </div>
              )
            })}
        </div>
      </div>
      
      {/* Flow direction hint */}
      <div className="absolute bottom-4 right-4 rounded-lg bg-card/95 backdrop-blur p-3 shadow-lg border text-xs">
        <p className="text-muted-foreground">
          <strong className="text-foreground">Flow:</strong> Left to right (prerequisites → dependents)
        </p>
      </div>
    </div>
  )
}
