import { MermaidDiagram } from '@/components/ui/MermaidDiagram'
import type { NodeEngineStructuredVisual } from '@/services/api'
import { renderEngineForVisualType } from './structuredVisualRouting'
import { structuredVisualToMermaid } from './structuredVisualToMermaid'
import { StructuredVisualRenderer } from './StructuredVisualRenderer'
import { StructuredVisualFlow } from './StructuredVisualFlow'

/**
 * Single source of truth for "draw this structured visual in its routed engine".
 * Used by both the SME review surface and the inline editor's live preview so the
 * preview always matches what reviewers see.
 */
export function StructuredVisualCanvas({
  visual,
  flowHeight,
}: {
  visual: NodeEngineStructuredVisual
  flowHeight?: number
}) {
  const engine = renderEngineForVisualType(visual.visual_type)

  if (engine === 'reactflow') {
    return <StructuredVisualFlow visual={visual} height={flowHeight} />
  }
  if (engine === 'mermaid') {
    return <MermaidDiagram chart={structuredVisualToMermaid(visual)} />
  }
  return <StructuredVisualRenderer visual={visual} />
}

export default StructuredVisualCanvas
