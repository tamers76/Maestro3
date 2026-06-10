import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import type { Stage3Snapshot, Stage3NodeLogic, Stage3IncompleteReport } from '@/services/api'
import {
  Shield,
  AlertTriangle,
  Eye,
  GitBranch,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Filter,
  Search,
  Lock,
  Unlock,
  Zap,
  XCircle,
} from 'lucide-react'

interface Stage3LogicViewerProps {
  snapshot: Stage3Snapshot
  incompleteReport?: Stage3IncompleteReport | null
}

// Severity badge colors
const SEVERITY_COLORS: Record<string, string> = {
  high: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  low: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
}

// Gate strictness colors
const GATE_COLORS: Record<string, string> = {
  strict: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  flexible: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
}

// Strategy colors
const STRATEGY_COLORS: Record<string, string> = {
  revisit_prerequisite: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  alternative_explanation: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  contrasting_example: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  targeted_feedback: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  scaffolded_practice: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
  peer_discussion: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  other: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300',
}

type FilterType = 'all' | 'strict' | 'flexible' | 'precheck' | 'mandatory' | 'optional' | 'incomplete'

function NodeLogicCard({ logic, isExpanded, onToggle, missingElements }: { logic: Stage3NodeLogic; isExpanded: boolean; onToggle: () => void; missingElements?: string[] }) {
  const gateColor = GATE_COLORS[logic.progression_rules.gate_strictness] || GATE_COLORS.flexible
  const isIncomplete = missingElements && missingElements.length > 0
  
  return (
    <div className={cn(
      "rounded-lg border bg-card overflow-hidden",
      isIncomplete ? "border-red-400 dark:border-red-600" : "border-border"
    )}>
      {/* Collapsed header — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/50 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
        
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{logic.node_id}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {logic.diagnostic_intent || <span className="italic text-red-500 dark:text-red-400">Missing diagnostic intent</span>}
          </p>
        </div>
        
        {/* Summary badges */}
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
          {isIncomplete && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">
              INCOMPLETE
            </span>
          )}
          <span className={cn('text-[9px] font-medium px-1.5 py-0.5 rounded-full', gateColor)}>
            {logic.progression_rules.gate_strictness}
          </span>
          <span className={cn(
            'text-[9px] font-medium px-1.5 py-0.5 rounded-full',
            logic.required_status === 'mandatory' 
              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
              : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
          )}>
            {logic.required_status}
          </span>
          {logic.preknowledge_check_logic.eligible && (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400">
              pre-check
            </span>
          )}
          <span className="text-[9px] text-muted-foreground">
            {logic.failure_types.length}F / {logic.remediation_paths.length}R
          </span>
        </div>
      </button>
      
      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
          {/* Missing elements banner (for incomplete nodes) */}
          {isIncomplete && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <XCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                <span className="text-xs font-semibold text-red-700 dark:text-red-300">Stage 3 Incomplete</span>
              </div>
              <p className="text-[11px] text-red-600 dark:text-red-400">
                Missing: {missingElements!.map(e => e.replace(/_/g, ' ')).join(', ')}
              </p>
            </div>
          )}
          
          {/* Step A — Diagnostic Intent */}
          <Section icon={<Eye className="h-3.5 w-3.5" />} title="A. Diagnostic Intent">
            <p className="text-sm text-foreground">{logic.diagnostic_intent}</p>
          </Section>
          
          {/* Step B — Failure Types */}
          <Section icon={<AlertTriangle className="h-3.5 w-3.5" />} title={`B. Failure Types (${logic.failure_types.length})`}>
            <div className="space-y-2">
              {logic.failure_types.map(ft => (
                <div key={ft.id} className="rounded-md bg-muted/50 p-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono text-muted-foreground">{ft.id}</span>
                    <span className={cn('text-[9px] font-medium px-1.5 py-0.5 rounded', SEVERITY_COLORS[ft.severity] || SEVERITY_COLORS.medium)}>
                      {ft.severity}
                    </span>
                    <span className="text-[10px] text-muted-foreground italic">{ft.misconception_category}</span>
                  </div>
                  <p className="text-xs text-foreground">{ft.description}</p>
                </div>
              ))}
              {logic.failure_types.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No failure types defined</p>
              )}
            </div>
          </Section>
          
          {/* Step C — Observable Signals */}
          <Section icon={<Search className="h-3.5 w-3.5" />} title={`C. Observable Signals (${logic.observable_signals.length})`}>
            <div className="space-y-2">
              {logic.observable_signals.map(sig => (
                <div key={sig.id} className="rounded-md bg-muted/50 p-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono text-muted-foreground">{sig.id}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                      {sig.signal_type.replace(/_/g, ' ')}
                    </span>
                    {sig.failure_type_ids.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        reveals: {sig.failure_type_ids.join(', ')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-foreground">{sig.description}</p>
                </div>
              ))}
              {logic.observable_signals.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No observable signals defined</p>
              )}
            </div>
          </Section>
          
          {/* Step D — Remediation Paths */}
          <Section icon={<GitBranch className="h-3.5 w-3.5" />} title={`D. Remediation Paths (${logic.remediation_paths.length})`}>
            <div className="space-y-2">
              {logic.remediation_paths.map(rem => (
                <div key={rem.id} className="rounded-md bg-muted/50 p-2.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono text-muted-foreground">{rem.id}</span>
                    <span className={cn('text-[9px] font-medium px-1.5 py-0.5 rounded', STRATEGY_COLORS[rem.strategy] || STRATEGY_COLORS.other)}>
                      {rem.strategy.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      for {rem.failure_type_id}
                    </span>
                    {rem.target_node_id && (
                      <span className="text-[10px] text-primary">
                        &rarr; {rem.target_node_id}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-foreground">{rem.description}</p>
                </div>
              ))}
              {logic.remediation_paths.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No remediation paths defined</p>
              )}
            </div>
          </Section>
          
          {/* Step E — Progression Rules */}
          <Section icon={<CheckCircle2 className="h-3.5 w-3.5" />} title="E. Progression Rules">
            <div className="space-y-2">
              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase">Mastery Definition</p>
                <p className="text-xs text-foreground">{logic.progression_rules.mastery_definition}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className={cn('text-[9px] font-medium px-1.5 py-0.5 rounded', gateColor)}>
                  {logic.progression_rules.gate_strictness} gate
                </span>
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {logic.progression_rules.mastery_threshold} mastery
                </span>
                {logic.progression_rules.blocks_downstream && (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400">
                    blocks downstream
                  </span>
                )}
              </div>
              {logic.progression_rules.rationale && (
                <p className="text-xs text-muted-foreground italic">{logic.progression_rules.rationale}</p>
              )}
            </div>
          </Section>
          
          {/* Step F — Pre-Knowledge Check Logic */}
          <Section icon={<Zap className="h-3.5 w-3.5" />} title="F. Pre-Knowledge Check">
            {logic.preknowledge_check_logic.eligible ? (
              <div className="space-y-2">
                <p className="text-xs text-foreground">{logic.preknowledge_check_logic.check_description}</p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-400">
                    eligible
                  </span>
                  {logic.preknowledge_check_logic.reasoning_based && (
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      reasoning-based
                    </span>
                  )}
                  {logic.preknowledge_check_logic.high_risk_override && (
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400">
                      high-risk override
                    </span>
                  )}
                </div>
                {logic.preknowledge_check_logic.explainability_note && (
                  <p className="text-xs text-muted-foreground italic">{logic.preknowledge_check_logic.explainability_note}</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">Not eligible for pre-knowledge check</p>
            )}
          </Section>
        </div>
      )}
    </div>
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-muted-foreground">{icon}</span>
        <h5 className="text-xs font-semibold text-foreground">{title}</h5>
      </div>
      {children}
    </div>
  )
}

export default function Stage3LogicViewer({ snapshot, incompleteReport }: Stage3LogicViewerProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<FilterType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  
  // Build a lookup: node_id → missing_elements[]
  const incompleteLookup = useMemo(() => {
    const map = new Map<string, string[]>()
    if (incompleteReport?.nodes) {
      for (const n of incompleteReport.nodes) {
        map.set(n.node_id, n.missing_elements)
      }
    }
    return map
  }, [incompleteReport])

  const incompleteCount = incompleteReport?.incomplete_count ?? 0
  
  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }
  
  const expandAll = () => {
    setExpandedNodes(new Set(snapshot.nodes.map(n => n.node_id)))
  }
  
  const collapseAll = () => {
    setExpandedNodes(new Set())
  }
  
  // Filtered nodes
  const filteredNodes = useMemo(() => {
    let nodes = snapshot.nodes
    
    // Apply filter
    switch (filter) {
      case 'strict':
        nodes = nodes.filter(n => n.progression_rules.gate_strictness === 'strict')
        break
      case 'flexible':
        nodes = nodes.filter(n => n.progression_rules.gate_strictness === 'flexible')
        break
      case 'precheck':
        nodes = nodes.filter(n => n.preknowledge_check_logic.eligible)
        break
      case 'mandatory':
        nodes = nodes.filter(n => n.required_status === 'mandatory')
        break
      case 'optional':
        nodes = nodes.filter(n => n.required_status === 'optional')
        break
      case 'incomplete':
        nodes = nodes.filter(n => incompleteLookup.has(n.node_id))
        break
    }
    
    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      nodes = nodes.filter(n =>
        n.node_id.toLowerCase().includes(q) ||
        n.diagnostic_intent.toLowerCase().includes(q) ||
        n.failure_types.some(ft => ft.description.toLowerCase().includes(q)) ||
        n.remediation_paths.some(rem => rem.description.toLowerCase().includes(q))
      )
    }
    
    return nodes
  }, [snapshot.nodes, filter, searchQuery, incompleteLookup])
  
  return (
    <div className="space-y-4">
      {/* Incomplete nodes warning banner */}
      {incompleteCount > 0 && (
        <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-4">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <h4 className="text-sm font-semibold text-red-700 dark:text-red-300">
              {incompleteCount} node{incompleteCount !== 1 ? 's' : ''} Stage 3 Incomplete
            </h4>
          </div>
          <p className="text-xs text-red-600 dark:text-red-400 ml-7">
            These nodes are missing one or more required A-F diagnostic elements. They cannot safely proceed to Stage 4.
            Use the "Incomplete" filter below to review them.
          </p>
        </div>
      )}

      {/* Summary Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Stage 3: Assessment Intelligence
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Generated {new Date(snapshot.generated_at).toLocaleString()} — {snapshot.node_count} nodes analyzed
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              label="Mandatory"
              value={snapshot.summary.mandatory_count}
              total={snapshot.summary.total_nodes}
              color="text-red-600 dark:text-red-400"
              icon={<Lock className="h-4 w-4" />}
            />
            <StatCard
              label="Strict Gates"
              value={snapshot.summary.strict_gate_count}
              total={snapshot.summary.total_nodes}
              color="text-orange-600 dark:text-orange-400"
              icon={<Shield className="h-4 w-4" />}
            />
            <StatCard
              label="Failure Types"
              value={snapshot.summary.failure_types_total}
              total={undefined}
              color="text-amber-600 dark:text-amber-400"
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <StatCard
              label="Remediation Paths"
              value={snapshot.summary.remediation_paths_total}
              total={undefined}
              color="text-purple-600 dark:text-purple-400"
              icon={<GitBranch className="h-4 w-4" />}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-3">
            <StatCard
              label="Optional"
              value={snapshot.summary.optional_count}
              total={snapshot.summary.total_nodes}
              color="text-green-600 dark:text-green-400"
              icon={<Unlock className="h-4 w-4" />}
            />
            <StatCard
              label="Flexible Gates"
              value={snapshot.summary.flexible_gate_count}
              total={snapshot.summary.total_nodes}
              color="text-blue-600 dark:text-blue-400"
              icon={<Unlock className="h-4 w-4" />}
            />
            <StatCard
              label="Pre-Check Eligible"
              value={snapshot.summary.preknowledge_eligible_count}
              total={snapshot.summary.total_nodes}
              color="text-cyan-600 dark:text-cyan-400"
              icon={<Zap className="h-4 w-4" />}
            />
            <StatCard
              label="Total Nodes"
              value={snapshot.summary.total_nodes}
              total={undefined}
              color="text-foreground"
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
          </div>
        </CardContent>
      </Card>
      
      {/* Filters + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <div className="flex rounded-lg border bg-muted/30 overflow-hidden">
            {([
              { key: 'all', label: 'All' },
              { key: 'strict', label: 'Strict' },
              { key: 'flexible', label: 'Flexible' },
              { key: 'precheck', label: 'Pre-check' },
              { key: 'mandatory', label: 'Mandatory' },
              { key: 'optional', label: 'Optional' },
              ...(incompleteCount > 0 ? [{ key: 'incomplete' as const, label: `Incomplete (${incompleteCount})` }] : []),
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'px-2.5 py-1.5 text-xs font-medium transition-colors',
                  filter === f.key
                    ? f.key === 'incomplete' ? 'bg-red-600 text-white shadow-sm' : 'bg-primary text-primary-foreground shadow-sm'
                    : f.key === 'incomplete' ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex-1 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search nodes..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          
          <button onClick={expandAll} className="text-xs text-primary hover:underline">
            Expand all
          </button>
          <button onClick={collapseAll} className="text-xs text-muted-foreground hover:underline">
            Collapse
          </button>
        </div>
        
        <p className="text-xs text-muted-foreground">
          {filteredNodes.length} of {snapshot.nodes.length} nodes
        </p>
      </div>
      
      {/* Node List */}
      <div className="space-y-2">
        {filteredNodes.map(logic => (
          <NodeLogicCard
            key={logic.node_id}
            logic={logic}
            isExpanded={expandedNodes.has(logic.node_id)}
            onToggle={() => toggleNode(logic.node_id)}
            missingElements={incompleteLookup.get(logic.node_id)}
          />
        ))}
        
        {filteredNodes.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Shield className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No nodes match the current filter</p>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, total, color, icon }: { label: string; value: number; total?: number; color: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className={cn(color, 'opacity-70')}>{icon}</span>
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className={cn('text-xl font-bold', color)}>{value}</span>
        {total !== undefined && (
          <span className="text-xs text-muted-foreground">/ {total}</span>
        )}
      </div>
    </div>
  )
}
