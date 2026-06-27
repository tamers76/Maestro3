import { useMemo, useState } from 'react'
import { ArrowDown, BookOpen, Check, Quote } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  NodeEngineSemanticAnnotation,
  NodeEngineSemanticElement,
  NodeEngineStructuredVisual,
  SemanticElementType,
  StructuredVisualType,
} from '@/services/api'

/** Visual families that share a rendering treatment. */
type RenderFamily = 'sequential' | 'columnar' | 'checklist' | 'graph'

const FAMILY_BY_TYPE: Record<StructuredVisualType, RenderFamily> = {
  process_map: 'sequential',
  decision_tree: 'sequential',
  cause_effect_map: 'sequential',
  timeline: 'sequential',
  comparison_table: 'columnar',
  criteria_matrix: 'columnar',
  rubric_map: 'columnar',
  checklist_visual: 'checklist',
  concept_map: 'graph',
  framework_diagram: 'graph',
  hierarchy: 'graph',
  annotated_example: 'graph',
  infographic: 'graph',
}

const ELEMENT_BADGE: Record<SemanticElementType, string> = {
  concept: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  criterion: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  step: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  example: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  non_example: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  misconception: 'bg-red-500/15 text-red-700 dark:text-red-300',
  correction: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  evidence: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  decision_point: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  rubric_level: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
  checklist_item: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
}

function readableType(value: string): string {
  return value.replace(/_/g, ' ')
}

function Citation({ value }: { value: string }) {
  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
      <Quote className="h-2.5 w-2.5" />
      {value}
    </span>
  )
}

function AnnotationChips({ annotations }: { annotations: NodeEngineSemanticAnnotation[] }) {
  if (annotations.length === 0) return null
  return (
    <div className="mt-1 space-y-1">
      {annotations.map((a) => {
        const danger = a.annotation_type === 'warning' || a.annotation_type === 'misconception_alert'
        return (
          <div
            key={a.annotation_id}
            className={cn(
              'rounded border-l-2 px-2 py-1 text-[10px]',
              danger
                ? 'border-red-500 bg-red-500/5 text-red-700 dark:text-red-300'
                : 'border-border bg-muted/40 text-muted-foreground'
            )}
          >
            <span className="font-medium uppercase tracking-wide">{readableType(a.annotation_type)}: </span>
            {a.text}
            {a.citation ? <Citation value={a.citation} /> : null}
          </div>
        )
      })}
    </div>
  )
}

function ElementCard({
  element,
  annotations,
  index,
}: {
  element: NodeEngineSemanticElement
  annotations: NodeEngineSemanticAnnotation[]
  index?: number
}) {
  return (
    <div className="rounded-[4px] border border-border bg-background p-2">
      <div className="flex flex-wrap items-center gap-2">
        {typeof index === 'number' && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
            {index}
          </span>
        )}
        <span
          className={cn(
            'rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide',
            ELEMENT_BADGE[element.element_type]
          )}
        >
          {readableType(element.element_type)}
        </span>
        <span className="text-xs font-medium text-foreground">{element.label}</span>
        {element.importance && (
          <span className="ml-auto text-[9px] uppercase tracking-wide text-muted-foreground">
            {element.importance}
          </span>
        )}
      </div>
      {element.description && (
        <p className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">{element.description}</p>
      )}
      {element.citation && <Citation value={element.citation} />}
      <AnnotationChips annotations={annotations} />
    </div>
  )
}

export function StructuredVisualRenderer({ visual }: { visual: NodeEngineStructuredVisual }) {
  const [showText, setShowText] = useState(false)
  const family = FAMILY_BY_TYPE[visual.visual_type] ?? 'graph'

  const elementsById = useMemo(() => {
    const map = new Map<string, NodeEngineSemanticElement>()
    for (const el of visual.semantic_elements) map.set(el.element_id, el)
    return map
  }, [visual.semantic_elements])

  const annotationsByElement = useMemo(() => {
    const map = new Map<string, NodeEngineSemanticAnnotation[]>()
    for (const a of visual.annotations) {
      const list = map.get(a.target_element_id) ?? []
      list.push(a)
      map.set(a.target_element_id, list)
    }
    return map
  }, [visual.annotations])

  // Ordered elements per reading_order, falling back to declared order.
  const orderedElements = useMemo(() => {
    const ordered = visual.reading_order
      .map((id) => elementsById.get(id))
      .filter((e): e is NodeEngineSemanticElement => Boolean(e))
    for (const el of visual.semantic_elements) {
      if (!ordered.includes(el)) ordered.push(el)
    }
    return ordered
  }, [visual.reading_order, visual.semantic_elements, elementsById])

  const columns = useMemo(() => {
    if (family !== 'columnar') return []
    const groups = new Map<SemanticElementType, NodeEngineSemanticElement[]>()
    for (const el of orderedElements) {
      const list = groups.get(el.element_type) ?? []
      list.push(el)
      groups.set(el.element_type, list)
    }
    return Array.from(groups.entries())
  }, [family, orderedElements])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
          {readableType(visual.visual_type)}
        </span>
        {visual.title && <span className="text-xs font-medium text-foreground">{visual.title}</span>}
      </div>

      {family === 'sequential' && (
        <div className="space-y-1">
          {orderedElements.map((el, i) => (
            <div key={el.element_id}>
              <ElementCard
                element={el}
                index={i + 1}
                annotations={annotationsByElement.get(el.element_id) ?? []}
              />
              {i < orderedElements.length - 1 && (
                <div className="flex justify-center py-0.5 text-muted-foreground">
                  <ArrowDown className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {family === 'columnar' && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {columns.map(([type, els]) => (
            <div key={type} className="rounded-[4px] border border-border bg-muted/20 p-2">
              <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                {readableType(type)}
              </p>
              <div className="space-y-2">
                {els.map((el) => (
                  <ElementCard
                    key={el.element_id}
                    element={el}
                    annotations={annotationsByElement.get(el.element_id) ?? []}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {family === 'checklist' && (
        <div className="space-y-1">
          {orderedElements.map((el) => (
            <div key={el.element_id} className="flex items-start gap-2 rounded-[4px] border border-border bg-background p-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-foreground">{el.label}</span>
                {el.description && (
                  <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-muted-foreground">{el.description}</p>
                )}
                {el.citation && <Citation value={el.citation} />}
                <AnnotationChips annotations={annotationsByElement.get(el.element_id) ?? []} />
              </div>
            </div>
          ))}
        </div>
      )}

      {family === 'graph' && (
        <div className="space-y-2">
          {orderedElements.map((el) => (
            <ElementCard
              key={el.element_id}
              element={el}
              annotations={annotationsByElement.get(el.element_id) ?? []}
            />
          ))}
        </div>
      )}

      {/* Relationships — shown for non-sequential families (sequential implies order). */}
      {family !== 'sequential' && visual.relationships.length > 0 && (
        <div className="rounded-[4px] border border-border bg-muted/20 p-2">
          <p className="mb-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
            Connections ({visual.relationships.length})
          </p>
          <ul className="space-y-1 text-[11px] text-muted-foreground">
            {visual.relationships.map((r, i) => (
              <li key={`${r.from_element_id}-${r.to_element_id}-${i}`}>
                <span className="text-foreground">{elementsById.get(r.from_element_id)?.label ?? r.from_element_id}</span>
                {' — '}
                <span className="italic">{readableType(r.relationship_type)}</span>
                {r.label ? ` (${r.label})` : ''}
                {' → '}
                <span className="text-foreground">{elementsById.get(r.to_element_id)?.label ?? r.to_element_id}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Text equivalent (accessibility) */}
      {visual.text_equivalent && (
        <div>
          <button
            type="button"
            onClick={() => setShowText((v) => !v)}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
          >
            <BookOpen className="h-3 w-3" />
            {showText ? 'Hide text equivalent' : 'Text equivalent (accessibility)'}
          </button>
          {showText && (
            <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-background p-2 text-[11px] text-foreground">
              {visual.text_equivalent}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
