import { useCallback, useMemo, useState, useEffect, DragEvent, useRef, forwardRef, useImperativeHandle } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Connection,
  addEdge,
  MarkerType,
  ConnectionMode,
  Panel,
  Handle,
  Position,
  NodeProps,
  type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/Select'
import { showToast } from '@/components/ui/Toaster'
import { 
  saveCloNodes, 
  saveCloPrerequisites,
  type CLO, 
  type LearningNode,
  type LearningNodeUpsert,
  type CloTopics,
} from '@/services/api'
import { cn } from '@/lib/utils'
import { 
  Plus, 
  Save, 
  Trash2, 
  X, 
  Loader2,
  GitBranch,
  AlertCircle,
  GripVertical,
  BookOpen,
  Lightbulb,
  ListChecks,
  Target,
  Brain,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  FileText,
  Layers,
} from 'lucide-react'

// Canonical Node Type configurations with icons (6 permitted types)
const NODE_TYPE_CONFIG: Record<string, { 
  bg: string; 
  border: string; 
  text: string;
  darkBg: string;
  darkBorder: string;
  darkText: string;
  icon: React.ElementType;
  label: string;
}> = {
  concept: { 
    bg: 'bg-sky-50', border: 'border-sky-400', text: 'text-sky-700',
    darkBg: 'dark:bg-sky-950', darkBorder: 'dark:border-sky-600', darkText: 'dark:text-sky-300',
    icon: BookOpen, label: 'Concept'
  },
  principle: { 
    bg: 'bg-violet-50', border: 'border-violet-400', text: 'text-violet-700',
    darkBg: 'dark:bg-violet-950', darkBorder: 'dark:border-violet-600', darkText: 'dark:text-violet-300',
    icon: Lightbulb, label: 'Principle'
  },
  procedure: { 
    bg: 'bg-orange-50', border: 'border-orange-400', text: 'text-orange-700',
    darkBg: 'dark:bg-orange-950', darkBorder: 'dark:border-orange-600', darkText: 'dark:text-orange-300',
    icon: ListChecks, label: 'Procedure'
  },
  application: { 
    bg: 'bg-emerald-50', border: 'border-emerald-400', text: 'text-emerald-700',
    darkBg: 'dark:bg-emerald-950', darkBorder: 'dark:border-emerald-600', darkText: 'dark:text-emerald-300',
    icon: Target, label: 'Application'
  },
  metacognitive: { 
    bg: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-700',
    darkBg: 'dark:bg-amber-950', darkBorder: 'dark:border-amber-600', darkText: 'dark:text-amber-300',
    icon: Brain, label: 'Metacognitive'
  },
  transfer: { 
    bg: 'bg-pink-50', border: 'border-pink-400', text: 'text-pink-700',
    darkBg: 'dark:bg-pink-950', darkBorder: 'dark:border-pink-600', darkText: 'dark:text-pink-300',
    icon: ArrowRightLeft, label: 'Transfer'
  },
}

const NODE_TYPES_LIST = Object.entries(NODE_TYPE_CONFIG).map(([value, config]) => ({
  value,
  label: config.label,
  icon: config.icon,
}))

const RISK_LEVELS = [
  { value: 'low', label: 'Low', color: 'bg-green-500' },
  { value: 'medium', label: 'Medium', color: 'bg-amber-500' },
  { value: 'high', label: 'High', color: 'bg-red-500' },
]

// CLO color palette
const CLO_COLORS = [
  { bg: 'bg-blue-500/10', border: 'border-blue-500/40', text: 'text-blue-700 dark:text-blue-300', accent: 'bg-blue-500', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' },
  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', text: 'text-emerald-700 dark:text-emerald-300', accent: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300' },
  { bg: 'bg-violet-500/10', border: 'border-violet-500/40', text: 'text-violet-700 dark:text-violet-300', accent: 'bg-violet-500', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300' },
  { bg: 'bg-amber-500/10', border: 'border-amber-500/40', text: 'text-amber-700 dark:text-amber-300', accent: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' },
  { bg: 'bg-rose-500/10', border: 'border-rose-500/40', text: 'text-rose-700 dark:text-rose-300', accent: 'bg-rose-500', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' },
  { bg: 'bg-cyan-500/10', border: 'border-cyan-500/40', text: 'text-cyan-700 dark:text-cyan-300', accent: 'bg-cyan-500', badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300' },
  { bg: 'bg-orange-500/10', border: 'border-orange-500/40', text: 'text-orange-700 dark:text-orange-300', accent: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300' },
  { bg: 'bg-pink-500/10', border: 'border-pink-500/40', text: 'text-pink-700 dark:text-pink-300', accent: 'bg-pink-500', badge: 'bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300' },
]

// Topic color palette for CLO-wide view (to visually distinguish topics)
const TOPIC_COLORS = [
  { badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300', ring: 'ring-blue-400/50' },
  { badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300', ring: 'ring-emerald-400/50' },
  { badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300', ring: 'ring-violet-400/50' },
  { badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300', ring: 'ring-amber-400/50' },
  { badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300', ring: 'ring-rose-400/50' },
  { badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300', ring: 'ring-cyan-400/50' },
  { badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300', ring: 'ring-orange-400/50' },
  { badge: 'bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300', ring: 'ring-pink-400/50' },
]

// Custom Node Component
function LearningNodeComponent({ data, selected }: NodeProps) {
  const config = NODE_TYPE_CONFIG[data.node_type] || NODE_TYPE_CONFIG.concept
  const Icon = config.icon
  const riskLevel = RISK_LEVELS.find(r => r.value === data.risk_level)
  
  return (
    <div className={cn(
      'group relative rounded-xl border-2 shadow-sm transition-all duration-200 min-w-[220px] max-w-[280px]',
      config.bg, config.border, config.darkBg, config.darkBorder,
      selected && 'ring-2 ring-primary ring-offset-2 shadow-lg',
      data.topicRing && !selected && `ring-1 ${data.topicRing}`,
      'hover:shadow-md'
    )}>
      <Handle type="target" position={Position.Left}
        className="!w-3 !h-3 !bg-slate-400 dark:!bg-slate-500 !border-2 !border-white dark:!border-slate-800 !-left-1.5 transition-all hover:!bg-primary hover:scale-125"
      />
      <div className="p-3">
        <div className="flex items-start gap-2 mb-2">
          <div className={cn('flex-shrink-0 p-1.5 rounded-lg', config.bg, config.darkBg)}>
            <Icon className={cn('h-4 w-4', config.text, config.darkText)} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={cn('text-[10px] font-semibold uppercase tracking-wider', config.text, config.darkText)}>
                {config.label}
              </span>
              {riskLevel && (
                <span className={cn('w-2 h-2 rounded-full', riskLevel.color)} title={`${riskLevel.label} risk`} />
              )}
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-3 leading-relaxed">
          {data.learning_intent || data.label}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">{data.node_id}</span>
          {data.topicBadge && (
            <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-medium', data.topicBadge)}>
              {data.topicLabel}
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right}
        className="!w-3 !h-3 !bg-slate-400 dark:!bg-slate-500 !border-2 !border-white dark:!border-slate-800 !-right-1.5 transition-all hover:!bg-primary hover:scale-125"
      />
    </div>
  )
}

const nodeTypes = { learningNode: LearningNodeComponent }

// Resolved topic with node count
interface ResolvedTopic {
  topic_id: string
  title: string
  clo_id: string
  node_count: number
}

interface CLOGraphEditorProps {
  courseCode: string
  clos: CLO[]
  nodes: LearningNode[]
  cloTopics?: CloTopics
  onSave?: () => void
}

interface EditingNode {
  id: string
  node_type: string
  learning_intent: string
  risk_level: string
  failure_meaning: string
  diagnostic_intent: string
  isNew?: boolean
}

// =============================================================================
// GraphCanvas — isolated sub-component that owns all ReactFlow hooks.
// When the parent changes the `key`, React destroys this entire tree (hooks,
// internal ReactFlow store, SVG elements) and creates a fresh instance.
// This is the definitive fix for "ghost arrows" left over from a previous view.
// =============================================================================
// Imperative API exposed by GraphCanvas to the parent
interface GraphCanvasHandle {
  save: () => void
  addNode: () => void
  topologyInfo: { sources: number; sinks: number; branching: number; merging: number; topology: string }
  nodeCount: number
  edgeCount: number
  crossTopicCount: number
}

interface GraphCanvasProps {
  initialNodes: Node[]
  initialEdges: Edge[]
  topicNodes: LearningNode[]
  viewMode: 'topic' | 'clo-wide'
  selectedCloId: string
  selectedTopicId: string
  courseCode: string
  deletedNodeIds: string[]
  onDeletedNodeIdsChange: React.Dispatch<React.SetStateAction<string[]>>
  editingNode: EditingNode | null
  onEditingNodeChange: React.Dispatch<React.SetStateAction<EditingNode | null>>
  onHasChangesChange: React.Dispatch<React.SetStateAction<boolean>>
  onSavingChange: React.Dispatch<React.SetStateAction<boolean>>
  onSave?: () => void
  selectedClo?: CLO
  selectedTopic?: ResolvedTopic
}

const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas({
  initialNodes: initNodes,
  initialEdges: initEdges,
  topicNodes,
  viewMode,
  selectedCloId,
  selectedTopicId,
  courseCode,
  deletedNodeIds,
  onDeletedNodeIdsChange,
  editingNode,
  onEditingNodeChange,
  onHasChangesChange,
  onSavingChange,
  onSave,
}, ref) {
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null)
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(initNodes)
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(initEdges)

  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => { onNodesChange(changes); onHasChangesChange(true) }, [onNodesChange, onHasChangesChange])
  const handleEdgesChange = useCallback((changes: Parameters<typeof onEdgesChange>[0]) => { onEdgesChange(changes); onHasChangesChange(true) }, [onEdgesChange, onHasChangesChange])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) {
      showToast({ title: 'Invalid Connection', description: 'A node cannot depend on itself', variant: 'destructive' }); return
    }
    setRfEdges(eds => {
      if (eds.some(e => e.source === connection.source && e.target === connection.target)) {
        showToast({ title: 'Connection Exists', description: 'This dependency already exists', variant: 'destructive' })
        return eds
      }
      return addEdge({ ...connection, type: 'bezier', animated: false, style: { stroke: 'hsl(var(--primary))', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--primary))', width: 20, height: 20 } }, eds)
    })
    onHasChangesChange(true)
  }, [setRfEdges, onHasChangesChange])

  const onDragOver = useCallback((event: DragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }, [])

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault()
    const nodeType = event.dataTransfer.getData('application/reactflow/type')
    if (!nodeType) return
    const rf = reactFlowInstanceRef.current
    const position = rf
      ? rf.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      : { x: event.clientX, y: event.clientY }
    const newId = `${selectedCloId}-N${Date.now()}`
    setRfNodes(nds => [...nds, { id: newId, type: 'learningNode', position, data: { label: 'New node - click to edit', node_id: newId, node_type: nodeType, learning_intent: 'New node - click to edit', risk_level: 'medium', failure_meaning: '', diagnostic_intent: '', clo_id: selectedCloId, topic_id: selectedTopicId, isNew: true } }])
    onEditingNodeChange({ id: newId, node_type: nodeType, learning_intent: '', risk_level: 'medium', failure_meaning: '', diagnostic_intent: '', isNew: true })
    onHasChangesChange(true)
  }, [selectedCloId, selectedTopicId, setRfNodes, onEditingNodeChange, onHasChangesChange])

  const handleAddNode = useCallback(() => {
    const newId = `${selectedCloId}-N${Date.now()}`
    const x = 100 + (rfNodes.length % 3) * 300, y = 100 + Math.floor(rfNodes.length / 3) * 180
    setRfNodes(nds => [...nds, { id: newId, type: 'learningNode', position: { x, y }, data: { label: 'New node - click to edit', node_id: newId, node_type: 'concept', learning_intent: 'New node - click to edit', risk_level: 'medium', failure_meaning: '', diagnostic_intent: '', clo_id: selectedCloId, topic_id: selectedTopicId, isNew: true } }])
    onEditingNodeChange({ id: newId, node_type: 'concept', learning_intent: '', risk_level: 'medium', failure_meaning: '', diagnostic_intent: '', isNew: true })
    onHasChangesChange(true)
  }, [selectedCloId, selectedTopicId, rfNodes.length, setRfNodes, onEditingNodeChange, onHasChangesChange])

  const handleSaveEditingNode = useCallback(() => {
    if (!editingNode || !editingNode.learning_intent.trim()) {
      showToast({ title: 'Validation Error', description: 'Learning intent is required', variant: 'destructive' }); return
    }
    setRfNodes(nds => nds.map(n => n.id === editingNode.id ? { ...n, data: { ...n.data, label: editingNode.learning_intent, node_type: editingNode.node_type, learning_intent: editingNode.learning_intent, risk_level: editingNode.risk_level, failure_meaning: editingNode.failure_meaning, diagnostic_intent: editingNode.diagnostic_intent } } : n))
    onEditingNodeChange(null); onHasChangesChange(true)
  }, [editingNode, setRfNodes, onEditingNodeChange, onHasChangesChange])

  const handleDeleteNode = useCallback((nodeId: string) => {
    if (topicNodes.find(n => n.node_id === nodeId)) onDeletedNodeIdsChange(prev => [...prev, nodeId])
    setRfNodes(nds => nds.filter(n => n.id !== nodeId))
    setRfEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId))
    onHasChangesChange(true)
    if (editingNode?.id === nodeId) onEditingNodeChange(null)
  }, [topicNodes, editingNode, setRfNodes, setRfEdges, onDeletedNodeIdsChange, onEditingNodeChange, onHasChangesChange])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    onEditingNodeChange({ id: node.id, node_type: node.data.node_type || 'concept', learning_intent: node.data.learning_intent || '', risk_level: node.data.risk_level || 'medium', failure_meaning: node.data.failure_meaning || '', diagnostic_intent: node.data.diagnostic_intent || '', isNew: node.data.isNew || false })
  }, [onEditingNodeChange])

  const handleSave = useCallback(async () => {
    onSavingChange(true)
    try {
      const effectiveTopicId = viewMode === 'clo-wide' ? undefined : selectedTopicId
      const upserts: LearningNodeUpsert[] = rfNodes.map(n => ({
        node_id: n.data.isNew ? undefined : n.id,
        node_type: n.data.node_type,
        learning_intent: n.data.learning_intent || n.data.label,
        risk_level: n.data.risk_level,
        failure_meaning: n.data.failure_meaning || '',
        diagnostic_intent: n.data.diagnostic_intent || '',
        topic_id: n.data.topic_id || effectiveTopicId || selectedTopicId,
        ui_x: n.position.x,
        ui_y: n.position.y,
      }))
      const nodeResult = await saveCloNodes(courseCode, selectedCloId, { upserts, deletes: deletedNodeIds })
      const idMapping = new Map<string, string>()
      rfNodes.forEach((n, idx) => { if (n.data.isNew) { const k = `temp-${idx}`; if (nodeResult.created[k]) idMapping.set(n.id, nodeResult.created[k]) } else idMapping.set(n.id, n.id) })
      const edges = rfEdges.map(e => ({ source_node_id: idMapping.get(e.target) || e.target, target_node_id: idMapping.get(e.source) || e.source }))
      await saveCloPrerequisites(courseCode, selectedCloId, edges)
      const edgeLabel = viewMode === 'clo-wide' ? 'CLO-wide node graph changes saved (including cross-topic edges)' : 'Node graph changes saved successfully'
      showToast({ title: 'Saved', description: edgeLabel, variant: 'success' })
      onHasChangesChange(false); onDeletedNodeIdsChange([]); onSave?.()
    } catch (error) {
      showToast({ title: 'Save Failed', description: error instanceof Error ? error.message : 'Failed to save changes', variant: 'destructive' })
    } finally { onSavingChange(false) }
  }, [courseCode, selectedCloId, selectedTopicId, viewMode, rfNodes, rfEdges, deletedNodeIds, onSave, onHasChangesChange, onDeletedNodeIdsChange, onSavingChange])

  const topologyInfo = useMemo(() => {
    const nodeIds = new Set(rfNodes.map(n => n.id))
    const inDeg = new Map<string, number>(), outDeg = new Map<string, number>()
    nodeIds.forEach(id => { inDeg.set(id, 0); outDeg.set(id, 0) })
    rfEdges.forEach(e => { if (nodeIds.has(e.source) && nodeIds.has(e.target)) { outDeg.set(e.source, (outDeg.get(e.source) || 0) + 1); inDeg.set(e.target, (inDeg.get(e.target) || 0) + 1) } })
    const sources = [...nodeIds].filter(id => !inDeg.get(id)), sinks = [...nodeIds].filter(id => !outDeg.get(id))
    const branching = [...nodeIds].filter(id => (outDeg.get(id) || 0) > 1), merging = [...nodeIds].filter(id => (inDeg.get(id) || 0) > 1)
    let topology = 'Complex'
    if (!rfEdges.length) topology = 'Parallel'
    else if (!branching.length && !merging.length) topology = 'Sequential'
    else if (merging.length && !branching.length) topology = 'Converging'
    else if (branching.length && !merging.length) topology = 'Branching'
    return { sources: sources.length, sinks: sinks.length, branching: branching.length, merging: merging.length, topology }
  }, [rfNodes, rfEdges])

  // Expose imperative API to parent
  useImperativeHandle(ref, () => ({
    save: handleSave,
    addNode: handleAddNode,
    topologyInfo,
    nodeCount: rfNodes.length,
    edgeCount: rfEdges.length,
    crossTopicCount: rfEdges.filter(e => e.animated).length,
  }), [handleSave, handleAddNode, topologyInfo, rfNodes.length, rfEdges.length])

  return (
    <>
      {/* Graph canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange}
          onConnect={onConnect} onNodeClick={onNodeClick}
          onDragOver={onDragOver} onDrop={onDrop}
          onInit={(instance) => { reactFlowInstanceRef.current = instance }}
          connectionMode={ConnectionMode.Loose} fitView fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2} maxZoom={2} deleteKeyCode={['Backspace', 'Delete']}
          onNodesDelete={(nodes) => nodes.forEach(n => handleDeleteNode(n.id))}
          proOptions={{ hideAttribution: true }}
          className="bg-slate-50 dark:bg-slate-900"
        >
          <Background color="hsl(var(--muted-foreground))" gap={24} size={1} style={{ opacity: 0.3 }} />
          <Controls className="bg-background border shadow-sm rounded-lg" showInteractive={false} />
          <Panel position="bottom-right" className="bg-card/95 backdrop-blur rounded-lg p-3 shadow-lg border text-xs max-w-[260px]">
            <p className="text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> Drag from a prerequisite's right handle to a dependent's left handle.
            </p>
            {viewMode === 'clo-wide' && (
              <p className="text-muted-foreground mt-1.5">
                <span className="inline-block w-6 h-0.5 bg-red-500 mr-1 align-middle" style={{borderTop: '2px dashed'}} /> = cross-topic prerequisite
              </p>
            )}
          </Panel>
        </ReactFlow>
      </div>

      {/* Right Sidebar - Node Editor */}
      {editingNode && (
        <div className="w-80 border-l p-4 overflow-y-auto bg-background">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg">{editingNode.isNew ? 'New Node' : 'Edit Node'}</h3>
            <Button variant="ghost" size="sm" onClick={() => onEditingNodeChange(null)}><X className="h-4 w-4" /></Button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Node Type</label>
              <Select value={editingNode.node_type} onValueChange={v => onEditingNodeChange(prev => prev ? {...prev, node_type: v} : null)}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NODE_TYPES_LIST.map(({ value, label, icon: Icon }) => (
                    <SelectItem key={value} value={value}><div className="flex items-center gap-2"><Icon className="h-4 w-4" />{label}</div></SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Learning Intent <span className="text-red-500">*</span></label>
              <Textarea className="mt-1.5 min-h-[80px]" value={editingNode.learning_intent}
                onChange={e => onEditingNodeChange(prev => prev ? {...prev, learning_intent: e.target.value} : null)}
                placeholder="What will the learner be able to do after completing this node?" />
            </div>
            <div>
              <label className="text-sm font-medium">Risk Level</label>
              <Select value={editingNode.risk_level} onValueChange={v => onEditingNodeChange(prev => prev ? {...prev, risk_level: v} : null)}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RISK_LEVELS.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      <div className="flex items-center gap-2"><span className={cn('w-2 h-2 rounded-full', r.color)} />{r.label}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Failure Meaning</label>
              <Textarea className="mt-1.5 min-h-[60px]" value={editingNode.failure_meaning}
                onChange={e => onEditingNodeChange(prev => prev ? {...prev, failure_meaning: e.target.value} : null)}
                placeholder="What does failing this node indicate about the learner?" />
            </div>
            <div>
              <label className="text-sm font-medium">Diagnostic Intent</label>
              <Textarea className="mt-1.5 min-h-[60px]" value={editingNode.diagnostic_intent}
                onChange={e => onEditingNodeChange(prev => prev ? {...prev, diagnostic_intent: e.target.value} : null)}
                placeholder="What can we diagnose about learner understanding?" />
            </div>
            <div className="flex gap-2 pt-4">
              <Button onClick={handleSaveEditingNode} className="flex-1">{editingNode.isNew ? 'Create Node' : 'Update Node'}</Button>
              {!editingNode.isNew && <Button variant="destructive" onClick={() => handleDeleteNode(editingNode.id)}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>
          {!editingNode.isNew && (
            <div className="mt-6 pt-4 border-t">
              <p className="text-xs text-muted-foreground">Node ID: <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{editingNode.id}</code></p>
            </div>
          )}
        </div>
      )}
    </>
  )
})

// =============================================================================
// Main editor component
// =============================================================================
function CLOGraphEditorInner({ 
  courseCode, clos, nodes: initialNodes, cloTopics, onSave 
}: CLOGraphEditorProps) {
  const canvasRef = useRef<GraphCanvasHandle>(null)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [editingNode, setEditingNode] = useState<EditingNode | null>(null)
  const [deletedNodeIds, setDeletedNodeIds] = useState<string[]>([])
  const [expandedClos, setExpandedClos] = useState<Set<string>>(new Set())
  
  // Build topic list: merge snapshot cloTopics with node-derived topics
  const topicsByClo = useMemo(() => {
    const result = new Map<string, ResolvedTopic[]>()
    
    // Start with snapshot topics (authoritative list)
    if (cloTopics && cloTopics.length > 0) {
      for (const group of cloTopics) {
        const topics: ResolvedTopic[] = group.topics.map(t => ({
          topic_id: t.topic_id,
          title: t.title,
          clo_id: group.clo_id,
          node_count: initialNodes.filter(n => n.topic_id === t.topic_id).length,
        }))
        result.set(group.clo_id, topics)
      }
    }
    
    // Also gather topics from nodes that might not be in snapshot
    for (const node of initialNodes) {
      const tid = node.topic_id
      if (!tid) continue
      const cloId = node.clo_id
      if (!result.has(cloId)) result.set(cloId, [])
      const existing = result.get(cloId)!
      if (!existing.find(t => t.topic_id === tid)) {
        existing.push({
          topic_id: tid,
          title: node.topic_title || tid,
          clo_id: cloId,
          node_count: initialNodes.filter(n => n.topic_id === tid).length,
        })
      }
    }
    
    // Handle legacy nodes without topic_id
    for (const node of initialNodes) {
      if (node.topic_id) continue
      const synId = `${node.clo_id}__legacy`
      if (!result.has(node.clo_id)) result.set(node.clo_id, [])
      const existing = result.get(node.clo_id)!
      if (!existing.find(t => t.topic_id === synId)) {
        existing.push({
          topic_id: synId,
          title: '(Ungrouped nodes)',
          clo_id: node.clo_id,
          node_count: initialNodes.filter(n => n.clo_id === node.clo_id && !n.topic_id).length,
        })
      }
    }
    
    // Recount nodes
    for (const [, topics] of result) {
      for (const t of topics) {
        if (t.topic_id.endsWith('__legacy')) {
          t.node_count = initialNodes.filter(n => n.clo_id === t.clo_id && !n.topic_id).length
        } else {
          t.node_count = initialNodes.filter(n => n.topic_id === t.topic_id).length
        }
      }
    }
    
    return result
  }, [initialNodes, cloTopics])
  
  // Flatten all topics
  const allTopics = useMemo(() => {
    const flat: ResolvedTopic[] = []
    for (const [, topics] of topicsByClo) flat.push(...topics)
    return flat
  }, [topicsByClo])
  
  // Total topic count
  const totalTopics = allTopics.length
  
  const [selectedTopicId, setSelectedTopicId] = useState<string>('')
  // 'topic' = view single topic; 'clo-wide' = view all topics under one CLO
  const [viewMode, setViewMode] = useState<'topic' | 'clo-wide'>('topic')
  const [cloWideTargetId, setCloWideTargetId] = useState<string>('')
  
  // Initialize: expand first CLO and select first topic
  useEffect(() => {
    if (allTopics.length > 0 && !allTopics.find(t => t.topic_id === selectedTopicId) && viewMode === 'topic') {
      const first = allTopics[0]
      setSelectedTopicId(first.topic_id)
      setExpandedClos(new Set([first.clo_id]))
    }
  }, [allTopics, selectedTopicId, viewMode])
  
  const selectedTopic = allTopics.find(t => t.topic_id === selectedTopicId)
  const selectedCloId = viewMode === 'clo-wide' ? cloWideTargetId : (selectedTopic?.clo_id || clos[0]?.clo_id || '')
  const selectedClo = clos.find(c => c.clo_id === selectedCloId)
  
  // Switch to CLO-wide view
  const enterCloWideView = useCallback((cloId: string) => {
    setCloWideTargetId(cloId)
    setViewMode('clo-wide')
    setExpandedClos(prev => {
      const next = new Set(prev)
      next.add(cloId)
      return next
    })
  }, [])
  
  // Switch back to topic view
  const exitCloWideView = useCallback(() => {
    setViewMode('topic')
  }, [])
  
  // Toggle CLO expand
  const toggleClo = useCallback((cloId: string) => {
    setExpandedClos(prev => {
      const next = new Set(prev)
      if (next.has(cloId)) next.delete(cloId)
      else next.add(cloId)
      return next
    })
  }, [])
  
  // Select a topic (also expand its CLO)
  const selectTopic = useCallback((topic: ResolvedTopic) => {
    setSelectedTopicId(topic.topic_id)
    setExpandedClos(prev => {
      const next = new Set(prev)
      next.add(topic.clo_id)
      return next
    })
  }, [])
  
  // Build topic index → color mapping for CLO-wide view
  const topicColorMap = useMemo(() => {
    const map = new Map<string, { badge: string; ring: string; label: string }>()
    for (const [, topics] of topicsByClo) {
      topics.forEach((t, idx) => {
        const color = TOPIC_COLORS[idx % TOPIC_COLORS.length]
        const shortLabel = t.title.length > 20 ? t.title.substring(0, 20) + '…' : t.title
        map.set(t.topic_id, { badge: color.badge, ring: color.ring, label: shortLabel })
      })
    }
    return map
  }, [topicsByClo])

  // Filter nodes for selected topic OR entire CLO in wide view
  const topicNodes = useMemo(() => {
    if (viewMode === 'clo-wide' && cloWideTargetId) {
      return initialNodes.filter(n => n.clo_id === cloWideTargetId)
    }
    if (!selectedTopicId) return []
    if (selectedTopicId.endsWith('__legacy')) {
      const cloId = selectedTopicId.replace('__legacy', '')
      return initialNodes.filter(n => n.clo_id === cloId && !n.topic_id)
    }
    return initialNodes.filter(n => n.topic_id === selectedTopicId)
  }, [initialNodes, selectedTopicId, viewMode, cloWideTargetId])
  
  // Convert to ReactFlow format
  const { initialRfNodes, initialRfEdges } = useMemo(() => {
    const rfNodes: Node[] = []
    const rfEdges: Edge[] = []
    const horizontalSpacing = 400
    const verticalSpacing = 200
    const nodeDepths = new Map<string, number>()
    const processed = new Set<string>()
    const isCloWide = viewMode === 'clo-wide'
    
    // Build topic_id lookup for cross-topic edge detection
    const nodeTopicLookup = new Map<string, string>()
    topicNodes.forEach(n => nodeTopicLookup.set(n.node_id, n.topic_id || ''))
    
    function getDepth(nodeId: string): number {
      if (nodeDepths.has(nodeId)) return nodeDepths.get(nodeId)!
      if (processed.has(nodeId)) return 0
      processed.add(nodeId)
      const node = topicNodes.find(n => n.node_id === nodeId)
      if (!node || node.prerequisite_nodes.length === 0) { nodeDepths.set(nodeId, 0); return 0 }
      const visiblePrereqs = node.prerequisite_nodes.filter(pid => topicNodes.some(n => n.node_id === pid))
      if (visiblePrereqs.length === 0) { nodeDepths.set(nodeId, 0); return 0 }
      const depth = Math.max(...visiblePrereqs.map(pid => getDepth(pid))) + 1
      nodeDepths.set(nodeId, depth)
      return depth
    }
    
    topicNodes.forEach(n => getDepth(n.node_id))
    const nodesByDepth = new Map<number, LearningNode[]>()
    topicNodes.forEach(node => {
      const depth = nodeDepths.get(node.node_id) || 0
      if (!nodesByDepth.has(depth)) nodesByDepth.set(depth, [])
      nodesByDepth.get(depth)!.push(node)
    })
    
    const centerY = 300
    nodesByDepth.forEach((nodesAtDepth, depth) => {
      const totalHeight = nodesAtDepth.length * verticalSpacing
      const startY = centerY - totalHeight / 2 + verticalSpacing / 2
      nodesAtDepth.forEach((node, index) => {
        // In CLO-wide view, add topic badge + ring
        const topicColor = isCloWide ? topicColorMap.get(node.topic_id || '') : undefined
        rfNodes.push({
          id: node.node_id,
          type: 'learningNode',
          position: { x: node.ui_x ?? (depth * horizontalSpacing + 50), y: node.ui_y ?? (startY + index * verticalSpacing) },
          data: {
            label: node.learning_intent, node_id: node.node_id, node_type: node.node_type,
            learning_intent: node.learning_intent, risk_level: node.risk_level,
            failure_meaning: node.failure_meaning, diagnostic_intent: node.diagnostic_intent,
            clo_id: node.clo_id, topic_id: node.topic_id,
            // CLO-wide view extras
            topicBadge: topicColor?.badge || undefined,
            topicRing: topicColor?.ring || undefined,
            topicLabel: topicColor?.label || undefined,
          },
        })
      })
    })
    
    const topicNodeIds = new Set(topicNodes.map(n => n.node_id))
    topicNodes.forEach(node => {
      node.prerequisite_nodes.forEach(prereqId => {
        if (topicNodeIds.has(prereqId)) {
          const isCrossTopic = isCloWide &&
            nodeTopicLookup.get(node.node_id) !== nodeTopicLookup.get(prereqId)
          rfEdges.push({
            id: `edge-${prereqId}-${node.node_id}`, source: prereqId, target: node.node_id,
            type: 'bezier',
            animated: isCrossTopic,
            style: {
              stroke: isCrossTopic ? 'hsl(var(--destructive))' : 'hsl(var(--primary))',
              strokeWidth: isCrossTopic ? 2.5 : 2,
              strokeDasharray: isCrossTopic ? '6 3' : undefined,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isCrossTopic ? 'hsl(var(--destructive))' : 'hsl(var(--primary))',
              width: 20, height: 20
            },
            label: isCrossTopic ? 'cross-topic' : undefined,
            labelStyle: isCrossTopic ? { fontSize: 9, fill: 'hsl(var(--destructive))' } : undefined,
          })
        }
      })
    })
    return { initialRfNodes: rfNodes, initialRfEdges: rfEdges }
  }, [topicNodes, viewMode, topicColorMap])

  // Unique key that changes on every view switch, forcing a full GraphCanvas remount
  const canvasKey = `${viewMode}-${viewMode === 'clo-wide' ? cloWideTargetId : selectedTopicId}`
  
  // Callbacks passed down to GraphCanvas — lifted so they don't depend on canvas-local state
  const onDragStart = useCallback((event: DragEvent, nodeType: string) => { event.dataTransfer.setData('application/reactflow/type', nodeType); event.dataTransfer.effectAllowed = 'move' }, [])
  
  return (
    <div className="flex flex-col h-[750px] rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-teal-600" />
          <span className="text-sm font-medium text-foreground">
            {totalTopics} topic{totalTopics !== 1 ? 's' : ''} across {clos.length} CLO{clos.length !== 1 ? 's' : ''}
          </span>
          {viewMode === 'clo-wide' && selectedClo ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
              <Layers className="h-3 w-3" />
              CLO-wide: {selectedClo.clo_id}
              <button onClick={exitCloWideView} className="ml-1 hover:bg-indigo-200 dark:hover:bg-indigo-800 rounded-full p-0.5">
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : selectedTopic ? (
            <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
              Viewing: {selectedTopic.title.length > 40 ? selectedTopic.title.substring(0, 40) + '...' : selectedTopic.title}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {hasChanges && (
            <span className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10">
              <AlertCircle className="h-4 w-4" />
              Unsaved changes
            </span>
          )}
          <Button onClick={() => canvasRef.current?.save()} disabled={saving || !hasChanges} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Changes
          </Button>
        </div>
      </div>
      
      {/* Main content: left sidebar + canvas + right editor */}
      <div className="flex flex-1 min-h-0">
        
        {/* Left sidebar: CLO accordion with topic list */}
        <div className="w-64 border-r bg-muted/10 flex flex-col overflow-hidden">
          {/* Topic navigator */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {clos.map((clo, cloIdx) => {
              const color = CLO_COLORS[cloIdx % CLO_COLORS.length]
              const topics = topicsByClo.get(clo.clo_id) || []
              const isExpanded = expandedClos.has(clo.clo_id)
              const cloNodeCount = topics.reduce((s, t) => s + t.node_count, 0)
              
              return (
                <div key={clo.clo_id}>
                  {/* CLO header */}
                  <button
                    onClick={() => toggleClo(clo.clo_id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors',
                      'hover:bg-muted/60',
                      isExpanded && color.bg
                    )}
                  >
                    <div className={cn('w-1 h-8 rounded-full flex-shrink-0', color.accent)} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={cn('text-xs font-bold', color.text)}>
                          CLO-{cloIdx + 1}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {cloNodeCount} nodes
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                        {clo.clo_text.length > 60 ? clo.clo_text.substring(0, 60) + '...' : clo.clo_text}
                      </p>
                    </div>
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                  </button>
                  
                  {/* Topics under this CLO */}
                  {isExpanded && (
                    <div className="ml-4 mt-1 mb-2 space-y-0.5">
                      {/* CLO-wide view button */}
                      {topics.length >= 2 && (
                        <button
                          onClick={() => enterCloWideView(clo.clo_id)}
                          className={cn(
                            'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-all text-xs mb-1',
                            viewMode === 'clo-wide' && cloWideTargetId === clo.clo_id
                              ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 font-medium shadow-sm'
                              : 'hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-dashed border-indigo-300 dark:border-indigo-700'
                          )}
                        >
                          <Layers className="h-3 w-3 flex-shrink-0" />
                          <span className="flex-1 min-w-0 truncate">All Topics (CLO-wide)</span>
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0',
                            viewMode === 'clo-wide' && cloWideTargetId === clo.clo_id
                              ? 'bg-indigo-200/60 dark:bg-indigo-800/40 text-indigo-700 dark:text-indigo-300'
                              : 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400'
                          )}>
                            {cloNodeCount}
                          </span>
                        </button>
                      )}
                      {topics.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground italic px-2 py-1">No topics yet</p>
                      ) : (
                        topics.map(topic => {
                          const isActive = viewMode === 'topic' && topic.topic_id === selectedTopicId
                          return (
                            <button
                              key={topic.topic_id}
                              onClick={() => { setViewMode('topic'); selectTopic(topic) }}
                              className={cn(
                                'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-all text-xs',
                                isActive
                                  ? cn('bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200 font-medium shadow-sm')
                                  : 'hover:bg-muted/50 text-foreground/80'
                              )}
                            >
                              <FileText className={cn('h-3 w-3 flex-shrink-0', isActive ? 'text-teal-600 dark:text-teal-400' : 'text-muted-foreground')} />
                              <span className="flex-1 min-w-0 truncate">
                                {topic.title}
                              </span>
                              <span className={cn(
                                'text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0',
                                isActive ? 'bg-teal-200/60 dark:bg-teal-800/40 text-teal-700 dark:text-teal-300' : 'bg-muted text-muted-foreground'
                              )}>
                                {topic.node_count}
                              </span>
                            </button>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          
          {/* Drag-to-add + topology info (below the topic nav) */}
          <div className="border-t p-3 space-y-3">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Drag to add</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {NODE_TYPES_LIST.map(({ value, label, icon: Icon }) => {
                const config = NODE_TYPE_CONFIG[value]
                return (
                  <div key={value} draggable onDragStart={(e) => onDragStart(e, value)}
                    className={cn('flex items-center gap-1.5 px-2 py-1.5 rounded-md border cursor-grab active:cursor-grabbing transition-all hover:shadow-sm hover:scale-[1.02] text-[11px]', config.bg, config.border, config.darkBg, config.darkBorder)}>
                    <GripVertical className="h-2.5 w-2.5 text-muted-foreground" />
                    <Icon className={cn('h-3 w-3', config.text, config.darkText)} />
                    <span className={cn('font-medium', config.text, config.darkText)}>{label}</span>
                  </div>
                )
              })}
            </div>
            <Button onClick={() => canvasRef.current?.addNode()} size="sm" variant="outline" className="w-full gap-1.5 text-xs h-8">
              <Plus className="h-3.5 w-3.5" /> Add Node
            </Button>
            <div className="pt-2 border-t">
              <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground mb-1">
                <GitBranch className="h-3 w-3" /> Topology: <span className="text-foreground">{canvasRef.current?.topologyInfo.topology ?? '—'}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-2 text-[10px] text-muted-foreground">
                <span>Sources: {canvasRef.current?.topologyInfo.sources ?? 0}</span>
                <span>Sinks: {canvasRef.current?.topologyInfo.sinks ?? 0}</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Graph canvas — key forces full remount (including hooks) on view change */}
        <GraphCanvas
          ref={canvasRef}
          key={canvasKey}
          initialNodes={initialRfNodes}
          initialEdges={initialRfEdges}
          topicNodes={topicNodes}
          viewMode={viewMode}
          selectedCloId={selectedCloId}
          selectedTopicId={selectedTopicId}
          courseCode={courseCode}
          deletedNodeIds={deletedNodeIds}
          onDeletedNodeIdsChange={setDeletedNodeIds}
          editingNode={editingNode}
          onEditingNodeChange={setEditingNode}
          onHasChangesChange={setHasChanges}
          onSavingChange={setSaving}
          onSave={onSave}
          selectedClo={selectedClo}
          selectedTopic={selectedTopic}
        />
      </div>
      
      {/* Footer */}
      {selectedClo && (selectedTopic || viewMode === 'clo-wide') && (
        <div className="px-4 py-2.5 border-t bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {viewMode === 'clo-wide' ? (
                <>
                  <Layers className="h-4 w-4 text-indigo-600 flex-shrink-0" />
                  <span className="font-semibold text-indigo-600 text-sm truncate">CLO-wide view</span>
                </>
              ) : selectedTopic ? (
                <span className="font-semibold text-teal-600 text-sm truncate">{selectedTopic.title}</span>
              ) : null}
              <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted flex-shrink-0">{selectedClo.clo_id}</span>
            </div>
            <div className="flex items-center gap-2 ml-4 flex-shrink-0">
              <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[11px] font-medium">{selectedClo.bloom_level}</span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium">{selectedClo.knowledge_type}</span>
              <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-medium',
                selectedClo.risk_level === 'high' ? 'bg-red-500/10 text-red-600' : selectedClo.risk_level === 'medium' ? 'bg-amber-500/10 text-amber-600' : 'bg-green-500/10 text-green-600'
              )}>{selectedClo.risk_level} risk</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CLOGraphEditor(props: CLOGraphEditorProps) {
  return <CLOGraphEditorInner {...props} />
}
