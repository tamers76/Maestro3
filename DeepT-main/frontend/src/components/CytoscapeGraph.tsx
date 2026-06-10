import { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape, { Core, NodeSingular } from 'cytoscape'
// @ts-ignore - no types available
import d3Force from 'cytoscape-d3-force'
import type { GraphData } from '@/services/api'
import { cn } from '@/lib/utils'

// Register the d3-force layout extension
cytoscape.use(d3Force)

// Node type colors matching your existing design
const NODE_TYPE_COLORS: Record<string, { bg: string; border: string }> = {
  concept: { bg: '#e0f2fe', border: '#0ea5e9' },
  principle: { bg: '#ede9fe', border: '#8b5cf6' },
  procedure: { bg: '#ffedd5', border: '#f97316' },
  application: { bg: '#d1fae5', border: '#10b981' },
  practice: { bg: '#fef3c7', border: '#f59e0b' },
  assessment: { bg: '#fee2e2', border: '#ef4444' },
  remediation: { bg: '#fce7f3', border: '#ec4899' },
  metacognitive: { bg: '#fef3c7', border: '#f59e0b' },
  transfer: { bg: '#fce7f3', border: '#ec4899' },
  learning_node: { bg: '#f1f5f9', border: '#64748b' },
  topic: { bg: '#ccfbf1', border: '#14b8a6' },
  clo: { bg: '#dbeafe', border: '#3b82f6' },
  course: { bg: '#1e293b', border: '#334155' },
}

interface CytoscapeGraphProps {
  graphData: GraphData
  onNodeClick?: (nodeId: string, nodeData: Record<string, unknown>) => void
  className?: string
}

export default function CytoscapeGraph({ 
  graphData, 
  onNodeClick,
  className 
}: CytoscapeGraphProps) {
  const cyRef = useRef<Core | null>(null)
  const layoutRef = useRef<any>(null)
  const nodeTapHandlerRef = useRef<((evt: any) => void) | null>(null)
  const backgroundTapHandlerRef = useRef<((evt: any) => void) | null>(null)
  const [isSimulationRunning, setIsSimulationRunning] = useState(true)

  // Convert graph data to Cytoscape format
  const elements = useMemo(() => {
    const nodes = graphData.nodes.map(node => {
      const nodeType = (node.data as { node_type?: string }).node_type || node.type || 'learning_node'
      const colors = NODE_TYPE_COLORS[nodeType] || NODE_TYPE_COLORS.learning_node
      const nodeId = (node.data as { node_id?: string }).node_id || node.id
      
      // Use human-readable label from backend; fall back to short node ID for learning nodes
      let shortLabel: string
      if (node.label && node.label !== node.id) {
        // Use the human-readable label (topic title, CLO text, course title, etc.)
        shortLabel = node.label.length > 40 ? node.label.substring(0, 40) + '…' : node.label
      } else {
        // Fallback: strip prefixes for a compact ID label
        shortLabel = nodeId.replace(/^(node-|ln-|topic-|clo-|course-)/, '')
      }
      
      return {
        data: {
          id: node.id,
          label: shortLabel,
          fullLabel: node.label,
          nodeType,
          bgColor: colors.bg,
          borderColor: colors.border,
          ...node.data,
        },
      }
    })

    const edges = graphData.edges.map(edge => {
      const isPrereq = edge.type === 'PREREQUIRES'
      const isHierarchy = edge.type === 'HAS_CLO' || edge.type === 'DECOMPOSED_TO'
      
      return {
        data: {
          id: edge.id,
          source: isPrereq ? edge.target : edge.source,
          target: isPrereq ? edge.source : edge.target,
          edgeType: edge.type,
          isHierarchy,
        },
      }
    })

    return [...nodes, ...edges]
  }, [graphData])

  // Cytoscape stylesheet
  // Cytoscape's TS surface for stylesheet types is inconsistent across versions.
  // Keep this as `any[]` to avoid brittle type errors while preserving runtime behavior.
  const stylesheet: any[] = [
    {
      selector: 'node',
      style: {
        'background-color': 'data(bgColor)',
        'border-color': 'data(borderColor)',
        'border-width': 2,
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '10px',
        'font-weight': 500,
        'color': '#1e293b',
        'text-wrap': 'wrap',
        'text-max-width': '80px',
        'width': 60,
        'height': 60,
        'text-outline-color': '#ffffff',
        'text-outline-width': 1,
      },
    },
    {
      selector: 'node[nodeType = "course"]',
      style: {
        'background-color': '#1e293b',
        'color': '#ffffff',
        'text-outline-color': '#1e293b',
        'width': 80,
        'height': 80,
        'font-size': '11px',
        'font-weight': 600,
      },
    },
    {
      selector: 'node[nodeType = "clo"]',
      style: {
        'background-color': '#3b82f6',
        'border-color': '#2563eb',
        'color': '#ffffff',
        'text-outline-color': '#3b82f6',
        'width': 70,
        'height': 70,
      },
    },
    {
      selector: 'node[nodeType = "topic"]',
      style: {
        'background-color': '#ccfbf1',
        'border-color': '#14b8a6',
        'color': '#0f766e',
        'text-outline-color': '#ffffff',
        'width': 65,
        'height': 65,
        'font-size': '9px',
        'text-max-width': '90px',
      },
    },
    {
      selector: 'edge',
      style: {
        'width': 2,
        'line-color': '#94a3b8',
        'target-arrow-color': '#94a3b8',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'arrow-scale': 1,
      },
    },
    {
      selector: 'edge[edgeType = "PREREQUIRES"]',
      style: {
        'line-color': '#6366f1',
        'target-arrow-color': '#6366f1',
        'width': 2,
      },
    },
    {
      selector: 'edge[isHierarchy]',
      style: {
        'line-style': 'dashed',
        'line-color': '#cbd5e1',
        'target-arrow-color': '#cbd5e1',
        'width': 1,
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-width': 4,
        'border-color': '#6366f1',
      },
    },
    {
      selector: 'node.highlighted',
      style: {
        'border-width': 4,
        'border-color': '#f59e0b',
      },
    },
    {
      selector: 'edge.highlighted',
      style: {
        'line-color': '#f59e0b',
        'target-arrow-color': '#f59e0b',
        'width': 3,
      },
    },
    {
      selector: 'node:grabbed',
      style: {
        'border-width': 4,
        'border-color': '#22c55e',
      },
    },
  ]

  // Start the d3-force layout
  const startLayout = useCallback((cy: Core) => {
    if (layoutRef.current) {
      layoutRef.current.stop()
    }

    layoutRef.current = cy.layout({
      name: 'd3-force',
      animate: true,
      fixedAfterDragging: false,
      linkId: function id(d: any) { return d.id },
      linkDistance: 200,           // Increased distance between connected nodes
      manyBodyStrength: -800,      // Stronger repulsion between all nodes
      collideRadius: 80,           // Prevent node overlap
      collideStrength: 0.7,        // Collision force strength
      xStrength: 0.05,             // Gentle pull toward center X
      yStrength: 0.05,             // Gentle pull toward center Y
      ready: function(){},
      stop: function(){},
      tick: function(){},
      randomize: false,
      infinite: true,
    } as any)
    
    layoutRef.current.run()
  }, [])

  // Handle cytoscape initialization
  const handleCyInit = useCallback((cy: Core) => {
    cyRef.current = cy

    // In React 18 StrictMode, this init path can run more than once in dev.
    // Ensure we don't accumulate listeners across mounts/renders.
    if (nodeTapHandlerRef.current) {
      cy.off('tap', 'node', nodeTapHandlerRef.current)
      nodeTapHandlerRef.current = null
    }
    if (backgroundTapHandlerRef.current) {
      cy.off('tap', backgroundTapHandlerRef.current)
      backgroundTapHandlerRef.current = null
    }

    const onNodeTap = (evt: any) => {
      const node = evt.target as NodeSingular
      const nodeData = node.data()
      
      cy.elements().removeClass('highlighted')
      node.addClass('highlighted')
      node.connectedEdges().addClass('highlighted')
      node.neighborhood('node').addClass('highlighted')
      
      if (onNodeClick) {
        onNodeClick(nodeData.id, nodeData)
      }
    }

    const onBackgroundTap = (evt: any) => {
      if (evt.target === cy) {
        cy.elements().removeClass('highlighted')
      }
    }

    nodeTapHandlerRef.current = onNodeTap
    backgroundTapHandlerRef.current = onBackgroundTap

    // Node click handler
    cy.on('tap', 'node', onNodeTap)

    // Background click to deselect
    cy.on('tap', onBackgroundTap)

    // Start physics simulation
    if (isSimulationRunning) {
      startLayout(cy)
    }
  }, [onNodeClick, startLayout, isSimulationRunning])

  // Cleanup on unmount / view switch (prevents lingering layouts/canvas/handlers)
  useEffect(() => {
    return () => {
      try {
        if (layoutRef.current?.stop) {
          layoutRef.current.stop()
        }
      } catch {
        // ignore
      } finally {
        layoutRef.current = null
      }

      const cy = cyRef.current
      if (cy) {
        try {
          if (nodeTapHandlerRef.current) {
            cy.off('tap', 'node', nodeTapHandlerRef.current)
          }
          if (backgroundTapHandlerRef.current) {
            cy.off('tap', backgroundTapHandlerRef.current)
          }
          cy.destroy()
        } catch {
          // ignore
        }
      }

      cyRef.current = null
      nodeTapHandlerRef.current = null
      backgroundTapHandlerRef.current = null
    }
  }, [])

  // Handle simulation toggle
  useEffect(() => {
    if (cyRef.current) {
      if (isSimulationRunning) {
        startLayout(cyRef.current)
      } else if (layoutRef.current) {
        layoutRef.current.stop()
      }
    }
  }, [isSimulationRunning, startLayout])

  // Toggle simulation
  const toggleSimulation = useCallback(() => {
    setIsSimulationRunning(prev => !prev)
  }, [])

  // Restart layout
  const restartLayout = useCallback(() => {
    if (cyRef.current) {
      // Randomize positions with more spread
      const nodeCount = cyRef.current.nodes().length
      const spread = Math.max(1200, nodeCount * 40)
      cyRef.current.nodes().forEach(node => {
        node.position({
          x: Math.random() * spread + 100,
          y: Math.random() * (spread * 0.6) + 100
        })
      })
      startLayout(cyRef.current)
      setIsSimulationRunning(true)
    }
  }, [startLayout])

  return (
    <div className={cn('relative w-full h-[700px] rounded-lg border bg-slate-50 dark:bg-slate-900 overflow-hidden', className)}>
      <CytoscapeComponent
        elements={elements}
        stylesheet={stylesheet}
        layout={{ name: 'random' }}
        cy={handleCyInit}
        className="w-full h-full"
        wheelSensitivity={0.3}
        boxSelectionEnabled={false}
        autounselectify={false}
      />
      
      {/* Legend */}
      <div className="absolute bottom-4 left-4 rounded-lg bg-card/95 backdrop-blur p-3 shadow-lg border text-xs space-y-2">
        <p className="font-semibold text-foreground mb-2">Node Types</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {Object.entries(NODE_TYPE_COLORS)
            .filter(([type]) => !['learning_node'].includes(type))
            .map(([type, colors]) => (
              <div key={type} className="flex items-center gap-2">
                <div 
                  className="w-4 h-4 rounded-full border-2" 
                  style={{ backgroundColor: colors.bg, borderColor: colors.border }}
                />
                <span className="capitalize text-muted-foreground">{type}</span>
              </div>
            ))}
        </div>
      </div>

      {/* Controls hint */}
      <div className="absolute bottom-4 right-4 rounded-lg bg-card/95 backdrop-blur p-3 shadow-lg border text-xs max-w-[220px]">
        <p className="text-muted-foreground">
          <strong className="text-foreground">Drag any node</strong> - connected nodes will react and move!
        </p>
      </div>

      {/* Toolbar */}
      <div className="absolute top-4 right-4 flex gap-2">
        <button
          onClick={toggleSimulation}
          className={cn(
            "px-3 py-1.5 text-xs backdrop-blur border rounded-lg shadow-sm transition-colors",
            isSimulationRunning 
              ? "bg-green-500/20 border-green-500/50 text-green-700 dark:text-green-300" 
              : "bg-red-500/20 border-red-500/50 text-red-700 dark:text-red-300"
          )}
        >
          {isSimulationRunning ? '● Physics ON' : '○ Physics OFF'}
        </button>
        <button
          onClick={() => cyRef.current?.fit(undefined, 50)}
          className="px-3 py-1.5 text-xs bg-card/95 backdrop-blur border rounded-lg shadow-sm hover:bg-accent transition-colors"
        >
          Fit
        </button>
        <button
          onClick={restartLayout}
          className="px-3 py-1.5 text-xs bg-card/95 backdrop-blur border rounded-lg shadow-sm hover:bg-accent transition-colors"
        >
          Shuffle
        </button>
      </div>
    </div>
  )
}
