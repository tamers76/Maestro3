import type {
  NodeEngineSemanticElement,
  NodeEngineSemanticRelationship,
  NodeEngineStructuredVisual,
  StructuredVisualType,
} from '@/services/api'

/**
 * Deterministic JSON -> Mermaid conversion for the flow/tree family
 * (process_map, decision_tree, cause_effect_map, concept_map).
 *
 * The structured JSON stays the governed source of truth; this only derives a
 * always-valid Mermaid string for display. Node ids are remapped to safe tokens
 * and all label text is escaped so LLM/SME content can never break the render.
 */

const DIRECTION_BY_TYPE: Partial<Record<StructuredVisualType, 'TD' | 'LR'>> = {
  process_map: 'TD',
  decision_tree: 'TD',
  cause_effect_map: 'LR',
  concept_map: 'LR',
}

/** Escape label text for use inside a quoted Mermaid node/edge label. */
function escapeLabel(text: string | undefined): string {
  const cleaned = (text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, "'")
    .replace(/\|/g, '/')
    .replace(/`/g, "'")
    .trim()
  const truncated = cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned
  return truncated || ' '
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ')
}

/** Shape a node by its semantic element type. All labels are quoted. */
function nodeLine(id: string, element: NodeEngineSemanticElement): string {
  const label = `"${escapeLabel(element.label)}"`
  switch (element.element_type) {
    case 'decision_point':
      return `${id}{${label}}`
    case 'concept':
      return `${id}(${label})`
    case 'evidence':
    case 'example':
      return `${id}([${label}])`
    default:
      return `${id}[${label}]`
  }
}

function edgeLine(
  fromId: string,
  toId: string,
  rel: Pick<NodeEngineSemanticRelationship, 'relationship_type' | 'label'>
): string {
  const raw = rel.label?.trim() || humanize(rel.relationship_type)
  const label = escapeLabel(raw)
  return label ? `${fromId} -->|"${label}"| ${toId}` : `${fromId} --> ${toId}`
}

/**
 * Convert a structured visual into a Mermaid flowchart string. Falls back to
 * chaining nodes by reading order when no relationships are present (so a
 * sequential visual still renders as a connected flow).
 */
export function structuredVisualToMermaid(visual: NodeEngineStructuredVisual): string {
  const direction = DIRECTION_BY_TYPE[visual.visual_type] ?? 'TD'

  // Stable, render-safe id per element_id.
  const idByElement = new Map<string, string>()
  visual.semantic_elements.forEach((el, i) => idByElement.set(el.element_id, `n${i}`))

  // Order elements by reading_order, then any not referenced there.
  const ordered: NodeEngineSemanticElement[] = []
  const seen = new Set<string>()
  for (const elementId of visual.reading_order) {
    const el = visual.semantic_elements.find((e) => e.element_id === elementId)
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

  const lines: string[] = [`flowchart ${direction}`]

  // Declare every node so isolated elements still appear.
  for (const el of ordered) {
    const id = idByElement.get(el.element_id)
    if (id) lines.push(`  ${nodeLine(id, el)}`)
  }

  const validRels = visual.relationships.filter(
    (r) => idByElement.has(r.from_element_id) && idByElement.has(r.to_element_id)
  )

  if (validRels.length > 0) {
    for (const rel of validRels) {
      const fromId = idByElement.get(rel.from_element_id)!
      const toId = idByElement.get(rel.to_element_id)!
      lines.push(`  ${edgeLine(fromId, toId, rel)}`)
    }
  } else if (ordered.length > 1) {
    // No relationships: chain by reading order so the flow is still connected.
    for (let i = 0; i < ordered.length - 1; i++) {
      const fromId = idByElement.get(ordered[i].element_id)!
      const toId = idByElement.get(ordered[i + 1].element_id)!
      lines.push(`  ${fromId} --> ${toId}`)
    }
  }

  return lines.join('\n')
}
