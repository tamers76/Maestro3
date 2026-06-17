import { useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Link2,
  ListChecks,
  ShieldAlert,
  Target,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  NodeEngineNode,
  NodeEngineNodeSet,
  NodeEngineRiskClassification,
} from '@/services/api'

/** Humanize an enum-ish token: `apply_to_case` -> `Apply to case`. */
function humanize(value: string): string {
  if (!value) return ''
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function riskColor(risk: NodeEngineRiskClassification): string {
  switch (risk) {
    case 'high_risk':
    case 'critical':
      return 'bg-red-500/15 text-red-600 dark:text-red-400'
    case 'bridge':
      return 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function nodeTypeColor(): string {
  return 'bg-primary/10 text-primary'
}

function Pill({
  children,
  className,
  title,
}: {
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        className
      )}
    >
      {children}
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  )
}

/**
 * Why a node should draw SME attention during batch review. Used to triage which
 * nodes need a look before approving an entire CLO. Returns an empty list when the
 * node is clean.
 */
export function criticalNodeReasons(node: NodeEngineNode): string[] {
  const reasons: string[] = []
  if (node.risk_classification.some((r) => r === 'critical' || r === 'high_risk')) {
    reasons.push('High-risk')
  }
  if (node.grounding_references.length === 0 || node.grounding_strength === 'weak') {
    reasons.push('Weak grounding')
  }
  if (node.misconception_slots === 'pending' && node.candidate_misconceptions.length > 0) {
    reasons.push('Misconceptions pending')
  }
  if (node.evidence_map?.some((c) => c.critical)) {
    reasons.push('Critical evidence')
  }
  return reasons
}

export function isCriticalNode(node: NodeEngineNode): boolean {
  return criticalNodeReasons(node).length > 0
}

export function NodeCard({ node, index }: { node: NodeEngineNode; index: number }) {
  const [open, setOpen] = useState(index === 0)
  const ec = node.primary_evidence_check_requirement
  const attentionReasons = criticalNodeReasons(node)

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary/10 text-xs font-semibold text-primary">
              {node.order + 1}
            </span>
            <span className="font-medium">{node.node_title}</span>
            <Pill className={nodeTypeColor()}>{humanize(node.node_type)}</Pill>
            {node.is_core && (
              <Pill className="bg-primary/10 text-primary">Core</Pill>
            )}
            {node.risk_classification.map((r) => (
              <Pill key={r} className={riskColor(r)}>
                {r === 'standard' ? null : <ShieldAlert className="h-3 w-3" />}
                {humanize(r)}
              </Pill>
            ))}
            {attentionReasons.length > 0 && (
              <Pill
                className="bg-amber-500/15 text-amber-600 dark:text-amber-400"
                title={attentionReasons.join(' · ')}
              >
                <AlertTriangle className="h-3 w-3" />
                Needs review
              </Pill>
            )}
            {node.status === 'approved' && (
              <Pill className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Check className="h-3 w-3" />
                Approved
              </Pill>
            )}
          </div>
          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
            {node.knowledge_component}
          </p>
        </div>
        {open ? (
          <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-4 border-t border-border px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Knowledge component">{node.knowledge_component || '—'}</Field>
            <Field label="Node type">{humanize(node.node_type)}</Field>
            <Field label="Mastery statement">{node.mastery_statement || '—'}</Field>
            <Field label="Why it matters">{node.why_it_matters || '—'}</Field>
            <Field label="Assessment connection">{node.assessment_connection || '—'}</Field>
            <Field label="Prerequisite order">
              Position {node.order + 1}
              {node.prerequisite_node_ids.length > 0 ? (
                <span className="text-muted-foreground">
                  {' '}
                  · after {node.prerequisite_node_ids.join(', ')}
                </span>
              ) : (
                <span className="text-muted-foreground"> · no prerequisites</span>
              )}
            </Field>
          </div>

          {/* Primary Evidence Check requirement */}
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Primary Evidence Check</span>
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="Evidence check ID">
                <code className="rounded bg-background px-1 py-0.5 text-xs">
                  {ec.evidence_check_id}
                </code>
              </Field>
              <Field label="Preferred evidence mode">
                {humanize(ec.preferred_evidence_mode)}
              </Field>
              <Field label="Must capture signals">
                <div className="flex flex-wrap gap-1">
                  {ec.must_capture_signals.map((s) => (
                    <Pill key={s} className="bg-blue-500/15 text-blue-600 dark:text-blue-400">
                      {humanize(s)}
                    </Pill>
                  ))}
                </div>
              </Field>
              <Field label="Diagnostic bands">
                <div className="flex flex-wrap gap-1">
                  {ec.diagnostic_bands.map((b) => (
                    <Pill key={b} className="bg-muted text-muted-foreground">
                      {humanize(b)}
                    </Pill>
                  ))}
                </div>
              </Field>
            </div>
          </div>

          {/* Candidate misconceptions */}
          <div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium">
                Candidate misconceptions ({node.candidate_misconceptions.length})
              </span>
              <Pill className="bg-muted text-muted-foreground">
                slots: {humanize(node.misconception_slots)}
              </Pill>
            </div>
            {node.candidate_misconceptions.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {node.candidate_misconceptions.map((m) => (
                  <li
                    key={m.candidate_misconception_id}
                    className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-sm"
                  >
                    <p className="font-medium">{m.statement || m.candidate_misconception_id}</p>
                    {m.reason && <p className="text-muted-foreground">{m.reason}</p>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.severity && (
                        <Pill className="bg-amber-500/15 text-amber-600 dark:text-amber-400">
                          {humanize(m.severity)}
                        </Pill>
                      )}
                      {m.suggested_trap && (
                        <span className="text-xs text-muted-foreground">
                          Trap: {m.suggested_trap}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                No candidate misconceptions proposed.
              </p>
            )}
            {node.misconception_bindings.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {node.misconception_bindings.length} approved misconception binding(s) attached.
              </p>
            )}
          </div>

          {/* Grounding */}
          <div>
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Grounding</span>
              <Pill
                className={cn(
                  node.grounding_strength === 'strong'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                )}
              >
                {node.grounding_strength ? humanize(node.grounding_strength) : 'Ungrounded'}
              </Pill>
            </div>
            {node.grounding_references.length > 0 ? (
              <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">
                {node.grounding_references.map((c, i) => (
                  <li key={`${c.citation}-${i}`}>{c.citation || c.passage_ref}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                No grounding references attached (additive — acceptable in V1).
              </p>
            )}
          </div>

          {/* Generator divergence note */}
          {node.generator_divergence_note && (
            <div className="flex items-start gap-2 rounded-md border border-purple-500/20 bg-purple-500/5 p-2 text-sm">
              <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" />
              <span>
                <span className="font-medium">Generator divergence note: </span>
                {node.generator_divergence_note}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface NodeSetReportProps {
  nodeSet: NodeEngineNodeSet
  courseCode: string
  courseTitle?: string
  subtopicTitle?: string
  assessmentConnection?: string[]
}

export default function NodeSetReport({
  nodeSet,
  courseCode,
  courseTitle,
  subtopicTitle,
  assessmentConnection,
}: NodeSetReportProps) {
  const [showJson, setShowJson] = useState(false)

  const riskCounts = nodeSet.nodes.reduce<Record<string, number>>((acc, n) => {
    for (const r of n.risk_classification) acc[r] = (acc[r] ?? 0) + 1
    return acc
  }, {})
  const flaggedRisks = Object.entries(riskCounts).filter(([r]) => r !== 'standard')
  const candidateCount = nodeSet.nodes.reduce(
    (sum, n) => sum + n.candidate_misconceptions.length,
    0
  )
  const evidenceCheckIds = nodeSet.nodes.map((n) => n.primary_evidence_check_requirement.evidence_check_id)
  const stronglyGrounded = nodeSet.nodes.filter((n) => n.grounding_strength === 'strong').length

  const statusColor =
    nodeSet.status === 'approved'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : nodeSet.status === 'needs_review'
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        : 'bg-muted text-muted-foreground'

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
      {/* Header / summary */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Boxes className="h-5 w-5" />
              Node Set Report
            </h3>
            <p className="text-sm text-muted-foreground">
              {courseTitle ? `${courseTitle} · ` : ''}
              <span className="font-mono">{courseCode}</span>
            </p>
          </div>
          <Pill className={statusColor}>
            {nodeSet.status === 'approved' && <Check className="h-3 w-3" />}
            {humanize(nodeSet.status)}
          </Pill>
        </div>

        <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Selected subtopic">
            {subtopicTitle || nodeSet.subtopic_id}
            <div className="font-mono text-xs text-muted-foreground">{nodeSet.subtopic_id}</div>
          </Field>
          <Field label="CLO alignment">
            {nodeSet.clo_ids.length > 0 ? nodeSet.clo_ids.join(', ') : '—'}
          </Field>
          <Field label="Assessment connection">
            {(assessmentConnection && assessmentConnection.length > 0
              ? assessmentConnection
              : nodeSet.prepares_for_assessment_ids
            ).join(', ') || 'None'}
          </Field>
          <Field label="Node count">
            {nodeSet.nodes.length}{' '}
            <span className="text-muted-foreground">
              ({nodeSet.nodes.length >= 4 && nodeSet.nodes.length <= 7 ? 'within' : 'outside'} 4–7
              grain)
            </span>
          </Field>
        </div>

        {/* At-a-glance flags */}
        <div className="flex flex-wrap gap-2">
          <Pill className="bg-blue-500/15 text-blue-600 dark:text-blue-400">
            <ListChecks className="h-3 w-3" />
            {evidenceCheckIds.length} evidence checks
          </Pill>
          <Pill
            className={cn(
              stronglyGrounded === nodeSet.nodes.length && nodeSet.nodes.length > 0
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            )}
          >
            <BookOpen className="h-3 w-3" />
            {stronglyGrounded}/{nodeSet.nodes.length} strongly grounded
          </Pill>
          <Pill
            className={cn(
              candidateCount > 0
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                : 'bg-muted text-muted-foreground'
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            {candidateCount} candidate misconceptions
          </Pill>
          {flaggedRisks.map(([r, count]) => (
            <Pill key={r} className={riskColor(r as NodeEngineRiskClassification)}>
              <ShieldAlert className="h-3 w-3" />
              {count} {humanize(r)}
            </Pill>
          ))}
        </div>

        {/* Reference grounding transparency (Workstream 4) */}
        {nodeSet.grounding_summary && (
          <div
            className={cn(
              'rounded-md border p-3 text-sm',
              nodeSet.grounding_summary.academic_ready
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-amber-500/30 bg-amber-500/10'
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Reference grounding</span>
              <Pill
                className={
                  nodeSet.grounding_summary.academic_ready
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                }
              >
                {humanize(nodeSet.grounding_summary.grounding_source)}
              </Pill>
              <Pill className="bg-muted text-muted-foreground">
                {nodeSet.grounding_summary.citations_count} citation(s)
              </Pill>
              <Pill className="bg-muted text-muted-foreground">
                scoped {nodeSet.grounding_summary.scoped_chunk_count} · course-level{' '}
                {nodeSet.grounding_summary.course_level_chunk_count}
              </Pill>
            </div>
            <p className="mt-2 text-muted-foreground">{nodeSet.grounding_summary.grounding_note}</p>
            {!nodeSet.grounding_summary.academic_ready && (
              <p className="mt-2 flex items-start gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Not ready for academic approval — no reference grounding attached.
              </p>
            )}
            {nodeSet.academic_override_reason && (
              <p className="mt-2 text-xs text-muted-foreground">
                Approved without grounding · override by{' '}
                <span className="font-medium">{nodeSet.academic_override_by}</span>: “
                {nodeSet.academic_override_reason}”
              </p>
            )}
          </div>
        )}

        {/* Grain justification */}
        {nodeSet.grain_justification && (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-sm">
            <span className="font-medium">Grain justification: </span>
            {nodeSet.grain_justification}
          </div>
        )}

        {/* Set-level generator divergence notes */}
        {nodeSet.generator_divergence_notes.length > 0 && (
          <div className="rounded-md border border-purple-500/20 bg-purple-500/5 p-3 text-sm">
            <p className="font-medium">Generator divergence notes</p>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {nodeSet.generator_divergence_notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}

        {nodeSet.approved_by && (
          <p className="text-xs text-muted-foreground">
            Approved by <span className="font-medium">{nodeSet.approved_by}</span>
            {nodeSet.approved_at ? ` · ${new Date(nodeSet.approved_at).toLocaleString()}` : ''}
          </p>
        )}
      </div>

      {/* Generated node list (readable cards) */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Generated nodes ({nodeSet.nodes.length})</h4>
        {nodeSet.nodes.map((node, i) => (
          <NodeCard key={node.node_id} node={node} index={i} />
        ))}
      </div>

      {/* Developer/debug raw JSON drawer */}
      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setShowJson((v) => !v)}
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <Code2 className="h-4 w-4" />
          {showJson ? 'Hide' : 'Show'} raw node-set JSON (developer)
          {showJson ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        {showJson && (
          <pre className="mt-2 max-h-96 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
            {JSON.stringify(nodeSet, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}
