import { useState } from 'react'
import { AlertTriangle, Check, Loader2, MessageSquare, Pencil, Send, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { showToast } from '@/components/ui/Toaster'
import { cn } from '@/lib/utils'
import {
  produceStructuredVisualObject,
  saveStructuredVisualEdits,
  type NodeEngineProducedObject,
  type NodeEngineStructuredVisual,
} from '@/services/api'
import { renderEngineForVisualType } from './structuredVisualRouting'
import { StructuredVisualCanvas } from './StructuredVisualCanvas'
import { StructuredVisualRenderer } from './StructuredVisualRenderer'
import { StructuredVisualEditor } from './StructuredVisualEditor'

const ENGINE_LABEL: Record<ReturnType<typeof renderEngineForVisualType>, string> = {
  html: 'Table / list',
  mermaid: 'Diagram',
  reactflow: 'Blueprint',
}

export interface StructuredVisualReviewProps {
  visual: NodeEngineStructuredVisual
  produced: NodeEngineProducedObject
  courseCode: string
  subtopicId: string
  nodeId: string
  objectId: string
  busy?: boolean
  onProducedUpdated: (objectId: string, produced: NodeEngineProducedObject) => void
}

export function StructuredVisualReview({
  visual,
  produced,
  courseCode,
  subtopicId,
  nodeId,
  objectId,
  busy = false,
  onProducedUpdated,
}: StructuredVisualReviewProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [working, setWorking] = useState<null | 'approve' | 'regenerate'>(null)
  const [showDetails, setShowDetails] = useState(false)

  const engine = renderEngineForVisualType(visual.visual_type)
  const governance = produced.envelope.governance_status
  const approved = governance === 'sme_approved'
  const fidelity = visual.fidelity_check
  const disabled = busy || working !== null

  async function handleApprove() {
    setWorking('approve')
    try {
      const updated = await saveStructuredVisualEdits(
        courseCode,
        subtopicId,
        nodeId,
        objectId,
        visual,
        { approve: true }
      )
      showToast({ title: 'Visual approved', variant: 'success' })
      onProducedUpdated(objectId, updated)
    } catch (error) {
      showToast({
        title: 'Approve failed',
        description: error instanceof Error ? error.message : 'Failed',
        variant: 'destructive',
      })
    } finally {
      setWorking(null)
    }
  }

  async function handleRegenerate() {
    if (!feedback.trim()) {
      showToast({ title: 'Add feedback first', variant: 'destructive' })
      return
    }
    setWorking('regenerate')
    try {
      const updated = await produceStructuredVisualObject(
        courseCode,
        subtopicId,
        nodeId,
        objectId,
        feedback
      )
      showToast({
        title: 'Visual regenerated with your feedback',
        description: 'Recommended SME review before publish',
        variant: 'success',
      })
      onProducedUpdated(objectId, updated)
      setFeedback('')
      setFeedbackOpen(false)
    } catch (error) {
      showToast({
        title: 'Regenerate failed',
        description: error instanceof Error ? error.message : 'Failed',
        variant: 'destructive',
      })
    } finally {
      setWorking(null)
    }
  }

  if (mode === 'edit') {
    return (
      <StructuredVisualEditor
        visual={visual}
        courseCode={courseCode}
        subtopicId={subtopicId}
        nodeId={nodeId}
        objectId={objectId}
        busy={busy}
        onSaved={(updated) => {
          onProducedUpdated(objectId, updated)
          setMode('view')
        }}
        onCancel={() => setMode('view')}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {visual.title && <span className="text-xs font-medium text-foreground">{visual.title}</span>}
        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
          {ENGINE_LABEL[engine]}
        </span>
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
            approved
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
              : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
          )}
        >
          {approved ? 'SME approved' : 'Needs review'}
        </span>
      </div>

      {/* Routed engine render — what the learner-facing visual looks like */}
      <div className="rounded-[4px] border border-border bg-background p-3">
        <StructuredVisualCanvas visual={visual} flowHeight={440} />
      </div>

      {/* Student-facing caption (teacher voice) shown directly under the visual */}
      {visual.learner_caption && (
        <p className="rounded-[4px] border border-border bg-muted/10 p-2.5 text-xs leading-relaxed text-foreground/80">
          {visual.learner_caption}
        </p>
      )}

      {fidelity && fidelity.status === 'needs_review' && fidelity.notes.length > 0 && (
        <div className="space-y-1 rounded-[4px] border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-300">
          <div className="flex items-center gap-1 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" /> Review notes
          </div>
          <ul className="list-inside list-disc">
            {fidelity.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setMode('edit')} disabled={disabled}>
          <Pencil className="mr-2 h-3 w-3" /> Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setFeedbackOpen((v) => !v)}
          disabled={disabled}
        >
          <MessageSquare className="mr-2 h-3 w-3" /> Request change
        </Button>
        <Button
          size="sm"
          variant={approved ? 'ghost' : 'default'}
          onClick={() => void handleApprove()}
          disabled={disabled || approved}
        >
          {working === 'approve' ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          ) : (
            <Check className="mr-2 h-3 w-3" />
          )}
          {approved ? 'Approved' : 'Approve'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowDetails((v) => !v)} disabled={disabled}>
          {showDetails ? 'Hide details' : 'Details & citations'}
        </Button>
      </div>

      {feedbackOpen && (
        <div className="space-y-2 rounded-[4px] border border-border bg-muted/20 p-2">
          <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            What should change? (the AI will regenerate the visual)
          </label>
          <textarea
            className="min-h-[64px] w-full rounded-[4px] border border-border bg-background px-2 py-1.5 text-xs text-foreground"
            value={feedback}
            placeholder="e.g. Split the third step into two, and lead with the definition instead of the example."
            onChange={(e) => setFeedback(e.target.value)}
            disabled={disabled}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => void handleRegenerate()}
              disabled={disabled || !feedback.trim()}
            >
              {working === 'regenerate' ? (
                <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              ) : (
                <Send className="mr-2 h-3 w-3" />
              )}
              Regenerate with feedback
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setFeedbackOpen(false)
                setFeedback('')
              }}
              disabled={disabled}
            >
              <X className="mr-2 h-3 w-3" /> Cancel
            </Button>
          </div>
        </div>
      )}

      {showDetails && (
        <div className="rounded-[4px] border border-border bg-muted/10 p-3">
          <StructuredVisualRenderer visual={visual} />
        </div>
      )}
    </div>
  )
}

export default StructuredVisualReview
