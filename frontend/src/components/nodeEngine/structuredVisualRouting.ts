import type { StructuredVisualType } from '@/services/api'

/**
 * Which render engine draws a given structured visual. One source of truth used by
 * both the review surface and the inline editor's live preview.
 *
 * - html      : grid/list-shaped types — tables and lists, not graphs. Exact labels,
 *               trivially grounded; a diagram library would be the wrong tool.
 * - mermaid   : flow/tree-shaped types where clarity + auto-layout beat branding.
 *               Sequential / branching logic — Mermaid's sweet spot.
 * - reactflow : hero, brand-facing centerpiece visuals that get custom node styling
 *               and the calm "blueprint" look.
 */
export type RenderEngine = 'html' | 'mermaid' | 'reactflow'

const ENGINE_BY_TYPE: Record<StructuredVisualType, RenderEngine> = {
  // HTML table / CSS — grids and lists.
  comparison_table: 'html',
  criteria_matrix: 'html',
  rubric_map: 'html',
  checklist_visual: 'html',
  timeline: 'html',

  // Mermaid — flow / tree / network diagrams with auto-layout.
  process_map: 'mermaid',
  decision_tree: 'mermaid',
  cause_effect_map: 'mermaid',
  concept_map: 'mermaid',

  // ReactFlow — premium, brand-facing hero visuals (dagre layered layout).
  framework_diagram: 'reactflow',
  hierarchy: 'reactflow',
  annotated_example: 'reactflow',
  infographic: 'reactflow',
}

/** Resolve the render engine for a visual type (defaults to html as the safe, exact fallback). */
export function renderEngineForVisualType(type: StructuredVisualType): RenderEngine {
  return ENGINE_BY_TYPE[type] ?? 'html'
}
