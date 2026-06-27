import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Loader2, Plus, Quote, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { showToast } from '@/components/ui/Toaster'
import { cn } from '@/lib/utils'
import {
  saveStructuredVisualEdits,
  type NodeEngineProducedObject,
  type NodeEngineSemanticElement,
  type NodeEngineSemanticRelationship,
  type NodeEngineStructuredVisual,
  type SemanticElementType,
  type SemanticRelationshipType,
} from '@/services/api'
import { StructuredVisualCanvas } from './StructuredVisualCanvas'

const ELEMENT_TYPES: SemanticElementType[] = [
  'concept',
  'criterion',
  'step',
  'example',
  'non_example',
  'misconception',
  'correction',
  'evidence',
  'decision_point',
  'rubric_level',
  'checklist_item',
]

const RELATIONSHIP_TYPES: SemanticRelationshipType[] = [
  'contrasts_with',
  'leads_to',
  'depends_on',
  'supports',
  'violates',
  'maps_to',
  'prepares_for',
  'corrects',
  'exemplifies',
]

/** element_type values whose label carries academic meaning that requires a citation. */
const CITATION_REQUIRED: ReadonlySet<SemanticElementType> = new Set([
  'criterion',
  'rubric_level',
  'evidence',
])

const INPUT = 'h-8 w-full rounded-[4px] border border-border bg-background px-2 text-xs text-foreground'
const SELECT = 'h-8 rounded-[4px] border border-border bg-background px-2 text-xs text-foreground'
const TEXTAREA = 'min-h-[48px] w-full rounded-[4px] border border-border bg-background px-2 py-1.5 text-xs text-foreground'

function humanize(value: string): string {
  return value.replace(/_/g, ' ')
}

function newElementId(): string {
  return `sme-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export interface StructuredVisualEditorProps {
  visual: NodeEngineStructuredVisual
  courseCode: string
  subtopicId: string
  nodeId: string
  objectId: string
  busy?: boolean
  onSaved: (produced: NodeEngineProducedObject) => void
  onCancel: () => void
}

export function StructuredVisualEditor({
  visual,
  courseCode,
  subtopicId,
  nodeId,
  objectId,
  busy = false,
  onSaved,
  onCancel,
}: StructuredVisualEditorProps) {
  const [draft, setDraft] = useState<NodeEngineStructuredVisual>(() =>
    structuredClone(visual)
  )
  const [saving, setSaving] = useState(false)

  // Element ids present in the original visual — anything new is an SME addition
  // (ungrounded until a citation is added by the producer).
  const originalIds = useMemo(
    () => new Set(visual.semantic_elements.map((e) => e.element_id)),
    [visual.semantic_elements]
  )

  const elementOptions = draft.semantic_elements.map((e) => ({
    id: e.element_id,
    label: e.label || e.element_id,
  }))

  function updateElement(index: number, patch: Partial<NodeEngineSemanticElement>) {
    setDraft((prev) => {
      const elements = prev.semantic_elements.map((el, i) =>
        i === index ? { ...el, ...patch } : el
      )
      return { ...prev, semantic_elements: elements }
    })
  }

  function moveElement(index: number, direction: -1 | 1) {
    setDraft((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.semantic_elements.length) return prev
      const elements = [...prev.semantic_elements]
      ;[elements[index], elements[target]] = [elements[target], elements[index]]
      return { ...prev, semantic_elements: elements }
    })
  }

  function addElement() {
    setDraft((prev) => ({
      ...prev,
      semantic_elements: [
        ...prev.semantic_elements,
        {
          element_id: newElementId(),
          element_type: 'concept',
          label: 'New element',
        },
      ],
    }))
  }

  function removeElement(index: number) {
    setDraft((prev) => {
      const removed = prev.semantic_elements[index]
      if (!removed) return prev
      const elements = prev.semantic_elements.filter((_, i) => i !== index)
      return {
        ...prev,
        semantic_elements: elements,
        relationships: prev.relationships.filter(
          (r) => r.from_element_id !== removed.element_id && r.to_element_id !== removed.element_id
        ),
        annotations: prev.annotations.filter((a) => a.target_element_id !== removed.element_id),
        reading_order: prev.reading_order.filter((id) => id !== removed.element_id),
      }
    })
  }

  function updateRelationship(index: number, patch: Partial<NodeEngineSemanticRelationship>) {
    setDraft((prev) => ({
      ...prev,
      relationships: prev.relationships.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }))
  }

  function addRelationship() {
    setDraft((prev) => {
      const first = prev.semantic_elements[0]?.element_id
      const second = prev.semantic_elements[1]?.element_id ?? first
      if (!first) return prev
      return {
        ...prev,
        relationships: [
          ...prev.relationships,
          {
            from_element_id: first,
            to_element_id: second,
            relationship_type: 'leads_to',
          },
        ],
      }
    })
  }

  function removeRelationship(index: number) {
    setDraft((prev) => ({
      ...prev,
      relationships: prev.relationships.filter((_, i) => i !== index),
    }))
  }

  // Live preview reflects element order as the reading order.
  const preview = useMemo<NodeEngineStructuredVisual>(
    () => ({ ...draft, reading_order: draft.semantic_elements.map((e) => e.element_id) }),
    [draft]
  )

  async function persist(approve: boolean) {
    if (draft.semantic_elements.some((e) => !e.label.trim())) {
      showToast({ title: 'Every element needs a label', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const produced = await saveStructuredVisualEdits(
        courseCode,
        subtopicId,
        nodeId,
        objectId,
        preview,
        { approve }
      )
      showToast({
        title: approve ? 'Visual approved' : 'Edits saved',
        description: `${objectId} — schema re-validated`,
        variant: 'success',
      })
      onSaved(produced)
    } catch (error) {
      showToast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed to save',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const disabled = busy || saving

  return (
    <div className="space-y-4 rounded-[4px] border border-primary/30 bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Edit visual</p>
        <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {humanize(draft.visual_type)}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- Form ---- */}
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Title
            </label>
            <input
              className={INPUT}
              value={draft.title}
              onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
              disabled={disabled}
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Student description
            </label>
            <textarea
              className={TEXTAREA}
              value={draft.learner_caption ?? ''}
              placeholder="Short caption (teacher voice) that helps a student read and understand this visual"
              onChange={(e) => setDraft((prev) => ({ ...prev, learner_caption: e.target.value }))}
              disabled={disabled}
            />
          </div>

          {/* Elements */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Elements ({draft.semantic_elements.length})
              </p>
              <Button size="sm" variant="ghost" onClick={addElement} disabled={disabled}>
                <Plus className="mr-1 h-3 w-3" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {draft.semantic_elements.map((el, i) => {
                const smeAdded = !originalIds.has(el.element_id)
                const needsCitation = CITATION_REQUIRED.has(el.element_type) && !el.citation
                return (
                  <div
                    key={el.element_id}
                    className="space-y-1.5 rounded-[4px] border border-border bg-muted/20 p-2"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        className={SELECT}
                        value={el.element_type}
                        onChange={(e) =>
                          updateElement(i, { element_type: e.target.value as SemanticElementType })
                        }
                        disabled={disabled}
                      >
                        {ELEMENT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {humanize(t)}
                          </option>
                        ))}
                      </select>
                      {smeAdded && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
                          SME-added · ungrounded
                        </span>
                      )}
                      {needsCitation && !smeAdded && (
                        <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-red-700 dark:text-red-300">
                          needs citation
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-0.5">
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                          onClick={() => moveElement(i, -1)}
                          disabled={disabled || i === 0}
                          aria-label="Move up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                          onClick={() => moveElement(i, 1)}
                          disabled={disabled || i === draft.semantic_elements.length - 1}
                          aria-label="Move down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-1 text-red-600 hover:bg-red-500/10 disabled:opacity-40"
                          onClick={() => removeElement(i)}
                          disabled={disabled}
                          aria-label="Remove element"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <input
                      className={INPUT}
                      value={el.label}
                      placeholder="Label"
                      onChange={(e) => updateElement(i, { label: e.target.value })}
                      disabled={disabled}
                    />
                    <textarea
                      className={TEXTAREA}
                      value={el.description ?? ''}
                      placeholder="Description (optional)"
                      onChange={(e) => updateElement(i, { description: e.target.value })}
                      disabled={disabled}
                    />
                    {el.citation && (
                      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                        <Quote className="h-2.5 w-2.5" />
                        {el.citation}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Relationships */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Connections ({draft.relationships.length})
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={addRelationship}
                disabled={disabled || draft.semantic_elements.length < 1}
              >
                <Plus className="mr-1 h-3 w-3" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {draft.relationships.map((rel, i) => (
                <div
                  key={`${rel.from_element_id}-${rel.to_element_id}-${i}`}
                  className="flex flex-wrap items-center gap-1.5 rounded-[4px] border border-border bg-muted/20 p-2"
                >
                  <select
                    className={SELECT}
                    value={rel.from_element_id}
                    onChange={(e) => updateRelationship(i, { from_element_id: e.target.value })}
                    disabled={disabled}
                  >
                    {elementOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className={SELECT}
                    value={rel.relationship_type}
                    onChange={(e) =>
                      updateRelationship(i, {
                        relationship_type: e.target.value as SemanticRelationshipType,
                      })
                    }
                    disabled={disabled}
                  >
                    {RELATIONSHIP_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {humanize(t)}
                      </option>
                    ))}
                  </select>
                  <select
                    className={SELECT}
                    value={rel.to_element_id}
                    onChange={(e) => updateRelationship(i, { to_element_id: e.target.value })}
                    disabled={disabled}
                  >
                    {elementOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className={cn(INPUT, 'flex-1 basis-32')}
                    value={rel.label ?? ''}
                    placeholder="Label (optional)"
                    onChange={(e) => updateRelationship(i, { label: e.target.value })}
                    disabled={disabled}
                  />
                  <button
                    type="button"
                    className="rounded p-1 text-red-600 hover:bg-red-500/10 disabled:opacity-40"
                    onClick={() => removeRelationship(i)}
                    disabled={disabled}
                    aria-label="Remove connection"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {draft.relationships.length === 0 && (
                <p className="text-[11px] text-muted-foreground">No connections yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* ---- Live preview ---- */}
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Live preview
          </p>
          <div className="rounded-[4px] border border-border bg-muted/10 p-2">
            <StructuredVisualCanvas visual={preview} flowHeight={360} />
          </div>
          {preview.learner_caption && (
            <p className="rounded-[4px] border border-border bg-muted/10 p-2.5 text-xs leading-relaxed text-foreground/80">
              {preview.learner_caption}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="sm" variant="default" onClick={() => void persist(false)} disabled={disabled}>
          {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Check className="mr-2 h-3 w-3" />}
          Save edits
        </Button>
        <Button size="sm" variant="outline" onClick={() => void persist(true)} disabled={disabled}>
          <Check className="mr-2 h-3 w-3" />
          Save &amp; approve
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={disabled}>
          <X className="mr-2 h-3 w-3" />
          Cancel
        </Button>
      </div>
    </div>
  )
}

export default StructuredVisualEditor
