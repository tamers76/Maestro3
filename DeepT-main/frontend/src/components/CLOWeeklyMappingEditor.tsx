import { useCallback, useMemo, useState, useEffect, DragEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { showToast } from '@/components/ui/Toaster'
import { 
  saveWeeklyPlanMapping,
  type CLO, 
  type WeeklyPlanItem,
  type CLODistribution,
  type WeeklyPlanMappingUpdate,
  type SuggestedWeeklyPlan,
  type SuggestedWeeklyPlanItem,
} from '@/services/api'
import { computeCLODistribution } from '@/lib/cloDistribution'
import { cn } from '@/lib/utils'
import { 
  Save, 
  Loader2,
  AlertCircle,
  Calendar,
  Target,
  GripVertical,
  X,
  Sparkles,
  BookOpen,
  ExternalLink,
  Info,
} from 'lucide-react'

// Color palette for CLOs - each CLO gets a distinct color
// "ai" variants use the same hue shifted lighter (50 shade) for the AI suggestion section
const CLO_COLORS = [
  { 
    bg: 'bg-blue-100 dark:bg-blue-900/40', 
    bgHover: 'bg-blue-200 dark:bg-blue-800/60',
    bgDragOver: 'bg-blue-300 dark:bg-blue-700/80',
    border: 'border-blue-400 dark:border-blue-500',
    borderActive: 'border-blue-500 dark:border-blue-400',
    text: 'text-blue-700 dark:text-blue-300',
    badge: 'bg-blue-500 text-white',
    ring: 'ring-blue-400',
    aiBg: 'bg-sky-50 dark:bg-sky-900/25',
    aiBgChip: 'bg-sky-100 dark:bg-sky-900/40',
    aiBorder: 'border-sky-300 dark:border-sky-600',
    aiText: 'text-sky-700 dark:text-sky-300',
    aiTextMuted: 'text-sky-600 dark:text-sky-400',
  },
  { 
    bg: 'bg-emerald-100 dark:bg-emerald-900/40', 
    bgHover: 'bg-emerald-200 dark:bg-emerald-800/60',
    bgDragOver: 'bg-emerald-300 dark:bg-emerald-700/80',
    border: 'border-emerald-400 dark:border-emerald-500',
    borderActive: 'border-emerald-500 dark:border-emerald-400',
    text: 'text-emerald-700 dark:text-emerald-300',
    badge: 'bg-emerald-500 text-white',
    ring: 'ring-emerald-400',
    aiBg: 'bg-teal-50 dark:bg-teal-900/25',
    aiBgChip: 'bg-teal-100 dark:bg-teal-900/40',
    aiBorder: 'border-teal-300 dark:border-teal-600',
    aiText: 'text-teal-700 dark:text-teal-300',
    aiTextMuted: 'text-teal-600 dark:text-teal-400',
  },
  { 
    bg: 'bg-violet-100 dark:bg-violet-900/40', 
    bgHover: 'bg-violet-200 dark:bg-violet-800/60',
    bgDragOver: 'bg-violet-300 dark:bg-violet-700/80',
    border: 'border-violet-400 dark:border-violet-500',
    borderActive: 'border-violet-500 dark:border-violet-400',
    text: 'text-violet-700 dark:text-violet-300',
    badge: 'bg-violet-500 text-white',
    ring: 'ring-violet-400',
    aiBg: 'bg-purple-50 dark:bg-purple-900/25',
    aiBgChip: 'bg-purple-100 dark:bg-purple-900/40',
    aiBorder: 'border-purple-300 dark:border-purple-600',
    aiText: 'text-purple-700 dark:text-purple-300',
    aiTextMuted: 'text-purple-600 dark:text-purple-400',
  },
  { 
    bg: 'bg-orange-100 dark:bg-orange-900/40', 
    bgHover: 'bg-orange-200 dark:bg-orange-800/60',
    bgDragOver: 'bg-orange-300 dark:bg-orange-700/80',
    border: 'border-orange-400 dark:border-orange-500',
    borderActive: 'border-orange-500 dark:border-orange-400',
    text: 'text-orange-700 dark:text-orange-300',
    badge: 'bg-orange-500 text-white',
    ring: 'ring-orange-400',
    aiBg: 'bg-amber-50 dark:bg-amber-900/25',
    aiBgChip: 'bg-amber-100 dark:bg-amber-900/40',
    aiBorder: 'border-amber-300 dark:border-amber-600',
    aiText: 'text-amber-700 dark:text-amber-300',
    aiTextMuted: 'text-amber-600 dark:text-amber-400',
  },
  { 
    bg: 'bg-pink-100 dark:bg-pink-900/40', 
    bgHover: 'bg-pink-200 dark:bg-pink-800/60',
    bgDragOver: 'bg-pink-300 dark:bg-pink-700/80',
    border: 'border-pink-400 dark:border-pink-500',
    borderActive: 'border-pink-500 dark:border-pink-400',
    text: 'text-pink-700 dark:text-pink-300',
    badge: 'bg-pink-500 text-white',
    ring: 'ring-pink-400',
    aiBg: 'bg-rose-50 dark:bg-rose-900/25',
    aiBgChip: 'bg-rose-100 dark:bg-rose-900/40',
    aiBorder: 'border-rose-300 dark:border-rose-600',
    aiText: 'text-rose-700 dark:text-rose-300',
    aiTextMuted: 'text-rose-600 dark:text-rose-400',
  },
  { 
    bg: 'bg-cyan-100 dark:bg-cyan-900/40', 
    bgHover: 'bg-cyan-200 dark:bg-cyan-800/60',
    bgDragOver: 'bg-cyan-300 dark:bg-cyan-700/80',
    border: 'border-cyan-400 dark:border-cyan-500',
    borderActive: 'border-cyan-500 dark:border-cyan-400',
    text: 'text-cyan-700 dark:text-cyan-300',
    badge: 'bg-cyan-500 text-white',
    ring: 'ring-cyan-400',
    aiBg: 'bg-sky-50 dark:bg-sky-900/25',
    aiBgChip: 'bg-sky-100 dark:bg-sky-900/40',
    aiBorder: 'border-sky-300 dark:border-sky-600',
    aiText: 'text-sky-700 dark:text-sky-300',
    aiTextMuted: 'text-sky-600 dark:text-sky-400',
  },
  { 
    bg: 'bg-amber-100 dark:bg-amber-900/40', 
    bgHover: 'bg-amber-200 dark:bg-amber-800/60',
    bgDragOver: 'bg-amber-300 dark:bg-amber-700/80',
    border: 'border-amber-400 dark:border-amber-500',
    borderActive: 'border-amber-500 dark:border-amber-400',
    text: 'text-amber-700 dark:text-amber-300',
    badge: 'bg-amber-500 text-white',
    ring: 'ring-amber-400',
    aiBg: 'bg-yellow-50 dark:bg-yellow-900/25',
    aiBgChip: 'bg-yellow-100 dark:bg-yellow-900/40',
    aiBorder: 'border-yellow-300 dark:border-yellow-600',
    aiText: 'text-yellow-700 dark:text-yellow-300',
    aiTextMuted: 'text-yellow-600 dark:text-yellow-400',
  },
  { 
    bg: 'bg-rose-100 dark:bg-rose-900/40', 
    bgHover: 'bg-rose-200 dark:bg-rose-800/60',
    bgDragOver: 'bg-rose-300 dark:bg-rose-700/80',
    border: 'border-rose-400 dark:border-rose-500',
    borderActive: 'border-rose-500 dark:border-rose-400',
    text: 'text-rose-700 dark:text-rose-300',
    badge: 'bg-rose-500 text-white',
    ring: 'ring-rose-400',
    aiBg: 'bg-pink-50 dark:bg-pink-900/25',
    aiBgChip: 'bg-pink-100 dark:bg-pink-900/40',
    aiBorder: 'border-pink-300 dark:border-pink-600',
    aiText: 'text-pink-700 dark:text-pink-300',
    aiTextMuted: 'text-pink-600 dark:text-pink-400',
  },
]

interface CLOWeeklyMappingEditorProps {
  courseCode: string
  clos: CLO[]
  weeklyPlan: WeeklyPlanItem[]
  cloDistribution: CLODistribution
  onSave?: () => void
  onHasChanges?: (hasChanges: boolean) => void
  onDistributionChange?: (distribution: CLODistribution) => void
  /** Full AI-suggested weekly plan from deep research */
  suggestedWeeklyPlan?: SuggestedWeeklyPlan | null
  /** Whether AI generation is currently running */
  generatingSuggestions?: boolean
  /** Trigger AI generation */
  onGenerateSuggestions?: () => void
}

// Draggable Week Chip Component
function WeekChip({ 
  week, 
  colorIndex,
  isFromAI,
  onRemove,
}: { 
  week: WeeklyPlanItem
  colorIndex?: number
  isFromAI?: boolean
  onRemove?: () => void
}) {
  const colors = colorIndex !== undefined ? CLO_COLORS[colorIndex % CLO_COLORS.length] : null
  
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('weekNumber', week.week.toString())
    e.dataTransfer.effectAllowed = 'move'
  }
  
  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className={cn(
        'group flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-grab active:cursor-grabbing transition-all',
        'hover:shadow-md active:shadow-lg active:scale-105',
        colors 
          ? cn(colors.bg, colors.border, 'hover:' + colors.bgHover)
          : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 border-dashed hover:bg-slate-200 dark:hover:bg-slate-700'
      )}
    >
      <GripVertical className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Calendar className={cn('h-3.5 w-3.5 flex-shrink-0', colors?.text || 'text-slate-500')} />
        <span className={cn('text-xs font-semibold whitespace-nowrap', colors?.text || 'text-slate-600 dark:text-slate-400')}>
          W{week.week}
        </span>
        {isFromAI && (
          <span title="From AI suggestion" className="flex-shrink-0">
            <Sparkles className={cn('h-3 w-3', colors?.aiTextMuted || 'text-purple-400')} />
          </span>
        )}
        <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
          {week.topic}
        </span>
      </div>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-opacity"
          title="Remove from CLO"
        >
          <X className="h-3.5 w-3.5 text-slate-500" />
        </button>
      )}
    </div>
  )
}

// AI Suggested Week Chip (draggable, uses same-hue shifted colors)
function AISuggestedWeekChip({ 
  week,
  colorIndex,
}: { 
  week: SuggestedWeeklyPlanItem
  colorIndex: number
}) {
  const colors = CLO_COLORS[colorIndex % CLO_COLORS.length]
  
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('weekNumber', week.week.toString())
    e.dataTransfer.setData('fromAI', 'true')
    e.dataTransfer.effectAllowed = 'move'
  }
  
  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className={cn(
        'group flex items-start gap-2 px-3 py-2 rounded-lg border-2 cursor-grab active:cursor-grabbing transition-all',
        'hover:shadow-md active:shadow-lg active:scale-105',
        colors.aiBgChip, colors.aiBorder
      )}
    >
      <GripVertical className={cn('h-3.5 w-3.5 flex-shrink-0 mt-0.5', colors.aiTextMuted)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Sparkles className={cn('h-3 w-3 flex-shrink-0', colors.aiTextMuted)} />
          <span className={cn('text-xs font-semibold whitespace-nowrap', colors.aiText)}>
            W{week.week}
          </span>
          <span className={cn('text-[11px] font-medium truncate', colors.aiText)}>
            {week.topic}
          </span>
        </div>
        {week.readings && (
          <p className={cn('text-[10px] mt-0.5 ml-5 truncate', colors.aiTextMuted)}>
            <BookOpen className="h-2.5 w-2.5 inline mr-0.5" />
            {week.readings}
          </p>
        )}
      </div>
    </div>
  )
}

// CLO Drop Zone Component - with integrated AI suggestions below
function CLODropZone({
  clo,
  colorIndex,
  mappedWeeks,
  weeklyPlan,
  aiSuggestedWeeks,
  aiLoading,
  aiAppliedWeeks,
  onDropWeek,
  onRemoveWeek,
}: {
  clo: CLO
  colorIndex: number
  mappedWeeks: number[]
  weeklyPlan: WeeklyPlanItem[]
  aiSuggestedWeeks: SuggestedWeeklyPlanItem[]
  aiLoading?: boolean
  aiAppliedWeeks: Set<number>
  onDropWeek: (weekNum: number) => void
  onRemoveWeek: (weekNum: number) => void
}) {
  const [isDragOver, setIsDragOver] = useState(false)
  const colors = CLO_COLORS[colorIndex % CLO_COLORS.length]
  
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }
  
  const handleDragLeave = () => {
    setIsDragOver(false)
  }
  
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    const weekNum = parseInt(e.dataTransfer.getData('weekNumber'))
    if (!isNaN(weekNum)) {
      onDropWeek(weekNum)
    }
  }
  
  // Get the actual week objects for mapped weeks
  const mappedWeekObjects = mappedWeeks
    .map(wn => weeklyPlan.find(w => w.week === wn))
    .filter((w): w is WeeklyPlanItem => w !== undefined)
    .sort((a, b) => a.week - b.week)
  
  // Filter out AI suggestions that the user has explicitly applied (via drag or Apply All)
  const remainingAISuggestions = aiSuggestedWeeks.filter(w => !aiAppliedWeeks.has(w.week))
  
  return (
    <div className={cn(
      'rounded-xl border-2 transition-all duration-200 overflow-hidden',
      isDragOver 
        ? cn(colors.bgDragOver, colors.borderActive, 'ring-2', colors.ring, 'scale-[1.02]')
        : cn(colors.border)
    )}>
      {/* CLO Header */}
      <div className={cn('px-4 py-3 border-b', colors.border, colors.bg)}>
        <div className="flex items-start gap-3">
          <div className={cn('p-2 rounded-lg', colors.badge)}>
            <Target className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn('text-sm font-bold', colors.text)}>
                {clo.clo_id}
              </span>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', colors.badge)}>
                {clo.bloom_level}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
                {mappedWeeks.length} week{mappedWeeks.length !== 1 ? 's' : ''}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
              {clo.clo_text}
            </p>
          </div>
        </div>
      </div>
      
      {/* Current Mapping (drop zone) */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'p-3 min-h-[60px] transition-colors',
          isDragOver && 'bg-white/50 dark:bg-black/20'
        )}
      >
        <div className="flex items-center gap-1.5 mb-2">
          <Target className={cn('h-3 w-3', colors.text)} />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Current Mapping
          </span>
        </div>
        {mappedWeekObjects.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {mappedWeekObjects.map(week => (
              <WeekChip 
                key={week.week}
                week={week}
                colorIndex={colorIndex}
                isFromAI={aiAppliedWeeks.has(week.week)}
                onRemove={() => onRemoveWeek(week.week)}
              />
            ))}
          </div>
        ) : (
          <div className={cn(
            'h-full flex items-center justify-center text-xs py-4 rounded-lg border-2 border-dashed',
            isDragOver 
              ? cn('border-current', colors.text)
              : 'border-slate-300 dark:border-slate-600 text-slate-400'
          )}>
            {isDragOver ? 'Drop week here!' : 'Drag weeks here to assign'}
          </div>
        )}
      </div>
      
      {/* AI loading state */}
      {aiLoading && aiSuggestedWeeks.length === 0 && (
        <div className={cn('p-3 border-t', colors.border, colors.aiBg)}>
          <div className="flex items-center gap-2 py-3 justify-center">
            <Loader2 className={cn('h-4 w-4 animate-spin', colors.aiTextMuted)} />
            <span className={cn('text-xs font-medium', colors.aiText)}>
              AI is researching suggestions...
            </span>
          </div>
        </div>
      )}
      
      {/* AI Suggested Weeks (below current mapping, same-hue shifted colors) */}
      {remainingAISuggestions.length > 0 && (
        <div className={cn('p-3 border-t', colors.border, colors.aiBg)}>
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className={cn('h-3 w-3', colors.aiTextMuted)} />
            <span className={cn('text-[10px] font-semibold uppercase tracking-wide', colors.aiText)}>
              AI Suggested
            </span>
            <span className={cn('text-[10px] opacity-60', colors.aiTextMuted)}>
              — drag to current mapping above
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {remainingAISuggestions.sort((a, b) => a.week - b.week).map(week => (
              <AISuggestedWeekChip key={week.week} week={week} colorIndex={colorIndex} />
            ))}
          </div>
          {/* Rationale */}
          {remainingAISuggestions.some(w => w.rationale) && (
            <details className="mt-2">
              <summary className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1 hover:underline">
                <Info className="h-2.5 w-2.5" />
                View rationale
              </summary>
              <div className="mt-1 space-y-1 pl-3.5">
                {remainingAISuggestions.filter(w => w.rationale).map(week => (
                  <p key={week.week} className="text-[10px] text-muted-foreground leading-relaxed">
                    <span className={cn('font-semibold', colors.aiText)}>W{week.week}:</span>{' '}
                    {week.rationale}
                  </p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

export default function CLOWeeklyMappingEditor({ 
  courseCode, 
  clos, 
  weeklyPlan,
  cloDistribution: _cloDistribution,
  onSave,
  onHasChanges,
  onDistributionChange,
  suggestedWeeklyPlan,
  generatingSuggestions,
  onGenerateSuggestions,
}: CLOWeeklyMappingEditorProps) {
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [draftWeeklyPlan, setDraftWeeklyPlan] = useState<WeeklyPlanItem[]>(weeklyPlan)
  // Track which weeks came from AI suggestions (for showing the sparkles icon)
  const [aiAppliedWeeks, setAiAppliedWeeks] = useState<Set<number>>(new Set())
  
  // Normalize CLO IDs: AI sometimes returns unicode en-dashes instead of regular hyphens
  const cloIdLookup = useMemo(() => {
    const lookup = new Map<string, string>()
    const normStr = (s: string) => s.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D-]/g, '-').trim()
    clos.forEach(clo => {
      lookup.set(clo.clo_id, clo.clo_id) // exact
      lookup.set(normStr(clo.clo_id), clo.clo_id) // normalized
      lookup.set(clo.clo_id.replace(/-/g, ''), clo.clo_id) // no hyphens
    })
    return lookup
  }, [clos])
  
  const normalizeCloId = useCallback((rawId: string): string | undefined => {
    if (cloIdLookup.has(rawId)) return cloIdLookup.get(rawId)
    const norm = rawId.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D-]/g, '-').trim()
    if (cloIdLookup.has(norm)) return cloIdLookup.get(norm)
    const stripped = norm.replace(/-/g, '')
    if (cloIdLookup.has(stripped)) return cloIdLookup.get(stripped)
    return undefined
  }, [cloIdLookup])
  
  // Build a lookup of AI suggested weeks by week number
  const aiSuggestedByWeek = useMemo(() => {
    const map = new Map<number, SuggestedWeeklyPlanItem>()
    if (suggestedWeeklyPlan && !suggestedWeeklyPlan.stale) {
      suggestedWeeklyPlan.weekly_plan.forEach(w => map.set(w.week, w))
    }
    return map
  }, [suggestedWeeklyPlan])
  
  // Reset draft when props change (e.g., after save or course reload)
  useEffect(() => {
    setDraftWeeklyPlan(weeklyPlan)
    setHasChanges(false)
    setAiAppliedWeeks(new Set())
  }, [weeklyPlan])
  
  // Notify parent when hasChanges state changes
  useEffect(() => {
    onHasChanges?.(hasChanges)
  }, [hasChanges, onHasChanges])
  
  // Compute draft distribution whenever draft changes
  const draftDistribution = useMemo(() => {
    return computeCLODistribution(draftWeeklyPlan, clos)
  }, [draftWeeklyPlan, clos])
  
  // Notify parent of distribution changes for live preview - only when there are changes
  useEffect(() => {
    if (hasChanges && onDistributionChange) {
      onDistributionChange(draftDistribution)
    }
  }, [draftDistribution, hasChanges, onDistributionChange])
  
  // Build mapping of CLO ID -> week numbers (supports multiple CLOs per week)
  const cloWeeksMap = useMemo(() => {
    const map = new Map<string, number[]>()
    clos.forEach(clo => map.set(clo.clo_id, []))
    
    draftWeeklyPlan.forEach(week => {
      (week.clo_ids || []).forEach(cloId => {
        if (map.has(cloId)) {
          map.get(cloId)!.push(week.week)
        }
      })
    })
    
    return map
  }, [clos, draftWeeklyPlan])
  
  // Build AI suggestions CLO -> weeks map (with CLO ID normalization)
  const aiCloWeeksMap = useMemo(() => {
    const map = new Map<string, SuggestedWeeklyPlanItem[]>()
    clos.forEach(clo => map.set(clo.clo_id, []))
    
    if (suggestedWeeklyPlan && !suggestedWeeklyPlan.stale) {
      suggestedWeeklyPlan.weekly_plan.forEach(week => {
        (week.clo_ids || []).forEach(rawCloId => {
          const actualId = normalizeCloId(rawCloId)
          if (actualId) {
            const existing = map.get(actualId)
            if (existing) {
              existing.push(week)
            }
          }
        })
      })
    }
    
    return map
  }, [clos, suggestedWeeklyPlan, normalizeCloId])
  
  // Get unmapped weeks
  const unmappedWeeks = useMemo(() => {
    return draftWeeklyPlan
      .filter(w => !w.clo_ids || w.clo_ids.length === 0)
      .sort((a, b) => a.week - b.week)
  }, [draftWeeklyPlan])
  

  
  // Handle dropping a week onto a CLO
  // If the week comes from AI suggestion, also apply topic/description/readings
  const handleDropWeek = useCallback((cloId: string, weekNum: number) => {
    const aiSuggested = aiSuggestedByWeek.get(weekNum)
    
    setDraftWeeklyPlan(prev =>
      prev.map(week => {
        if (week.week !== weekNum) return week
        
        if (aiSuggested) {
          // Apply AI content along with the CLO assignment
          return {
            ...week,
            topic: aiSuggested.topic,
            description: aiSuggested.description,
            readings: aiSuggested.readings,
            clo_ids: [cloId],
          }
        }
        return { ...week, clo_ids: [cloId] }
      })
    )
    
    if (aiSuggested) {
      setAiAppliedWeeks(prev => new Set(prev).add(weekNum))
    }
    setHasChanges(true)
  }, [aiSuggestedByWeek])
  
  // Handle removing a week from a specific CLO (keeps other CLO assignments intact)
  const handleRemoveWeekFromCLO = useCallback((cloId: string, weekNum: number) => {
    setDraftWeeklyPlan(prev =>
      prev.map(week => {
        if (week.week !== weekNum) return week
        const newCloIds = (week.clo_ids || []).filter(id => id !== cloId)
        return { ...week, clo_ids: newCloIds }
      })
    )
    setHasChanges(true)
  }, [])
  
  // Apply entire AI-suggested plan to draft (ALL weeks get assigned)
  const handleApplyAllAI = useCallback(() => {
    if (!suggestedWeeklyPlan) return
    
    const suggestedMap = new Map(suggestedWeeklyPlan.weekly_plan.map(s => [s.week, s]))
    const appliedWeekNums = new Set<number>()
    
    setDraftWeeklyPlan(prev => {
      return prev.map(week => {
        const suggested = suggestedMap.get(week.week)
        if (suggested) {
          // Normalize AI CLO IDs (AI may use unicode en-dashes) — keep ALL CLO assignments
          const normalizedCloIds = suggested.clo_ids
            .map(id => normalizeCloId(id))
            .filter((id): id is string => id !== undefined)
          const newCloIds = normalizedCloIds.length > 0 ? normalizedCloIds : week.clo_ids
          // Only mark as AI-applied if the AI actually changes the content
          const topicChanged = suggested.topic !== week.topic
          const cloChanged = JSON.stringify(newCloIds) !== JSON.stringify(week.clo_ids)
          if (topicChanged || cloChanged) {
            appliedWeekNums.add(week.week)
          }
          return {
            ...week,
            topic: suggested.topic,
            description: suggested.description,
            readings: suggested.readings,
            clo_ids: newCloIds,
          }
        }
        return week
      })
    })
    
    setAiAppliedWeeks(prev => {
      const merged = new Set(prev)
      appliedWeekNums.forEach(w => merged.add(w))
      return merged
    })
    setHasChanges(true)
    showToast({
      title: 'AI Plan Applied',
      description: `Applied AI suggestions to all ${suggestedMap.size} weeks. Review and Save.`,
      variant: 'success',
    })
  }, [suggestedWeeklyPlan, normalizeCloId])
  
  // Save changes to backend
  const handleSave = useCallback(async () => {
    setSaving(true)
    
    try {
      // Build mappings from draft (supports multiple CLOs per week)
      const mappings: WeeklyPlanMappingUpdate[] = draftWeeklyPlan.map(week => ({
        week: week.week,
        clo_ids: week.clo_ids || [],
      }))
      
      await saveWeeklyPlanMapping(courseCode, mappings)
      
      showToast({
        title: 'Saved',
        description: 'CLO-Week mapping saved successfully',
        variant: 'success',
      })
      
      setHasChanges(false)
      onSave?.()
    } catch (error) {
      showToast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Failed to save mapping',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }, [courseCode, draftWeeklyPlan, onSave])
  
  // Reset to original mapping
  const handleReset = useCallback(() => {
    setDraftWeeklyPlan(weeklyPlan)
    setHasChanges(false)
    setAiAppliedWeeks(new Set())
  }, [weeklyPlan])
  
  return (
    <div className="flex flex-col rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-sm">CLO → Week Mapping Editor</h3>
          <span className="text-xs text-muted-foreground">
            {clos.length} CLOs • {draftWeeklyPlan.length} Weeks
          </span>
        </div>
        
        <div className="flex items-center gap-3">
          {hasChanges && (
            <span className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10">
              <AlertCircle className="h-4 w-4" />
              Unsaved changes
            </span>
          )}
          {hasChanges && (
            <Button 
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={saving}
            >
              Reset
            </Button>
          )}
          <Button 
            onClick={handleSave} 
            disabled={saving || !hasChanges}
            size="sm"
            className="gap-2"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Mapping
          </Button>
        </div>
      </div>
      
      {/* Main Content - Two Columns */}
      <div className="flex gap-6 p-4">
        {/* Left Column - Unmapped Weeks + AI Controls */}
        <div className="w-[280px] flex-shrink-0">
          <div className="sticky top-4 space-y-4">
            {/* Unmapped Weeks */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="h-4 w-4 text-slate-500" />
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Unmapped Weeks
                </h4>
                <span className="text-xs text-slate-500 ml-auto">
                  {unmappedWeeks.length} remaining
                </span>
              </div>
              
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 p-3 min-h-[120px]">
                {unmappedWeeks.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {unmappedWeeks.map(week => (
                      <WeekChip key={week.week} week={week} isFromAI={aiAppliedWeeks.has(week.week)} />
                    ))}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400 py-8">
                    All weeks are mapped!
                  </div>
                )}
              </div>
            </div>
            
            {/* AI Deep Research Panel */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-purple-500" />
                <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  AI Deep Research
                </h4>
              </div>
              
              <div className="rounded-xl border-2 border-purple-300 dark:border-purple-600 bg-purple-50/50 dark:bg-purple-900/20 p-3 space-y-3">
                {/* Generate / Regenerate button */}
                <Button
                  onClick={onGenerateSuggestions}
                  disabled={generatingSuggestions || hasChanges}
                  size="sm"
                  variant="outline"
                  className="w-full gap-2 border-purple-400 dark:border-purple-600 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                  title={hasChanges ? 'Save mapping changes first' : 'Research textbook and suggest a weekly plan'}
                >
                  {generatingSuggestions ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {generatingSuggestions ? 'Researching...' : suggestedWeeklyPlan ? 'Regenerate Plan' : 'Generate Suggested Plan'}
                </Button>
                
                {/* Stale warning */}
                {suggestedWeeklyPlan?.stale && (
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-3 w-3 flex-shrink-0" />
                    <span>Suggestions are outdated. Regenerate for fresh results.</span>
                  </div>
                )}
                
                {/* Apply All button */}
                {suggestedWeeklyPlan && !suggestedWeeklyPlan.stale && (
                  <Button
                    onClick={handleApplyAllAI}
                    size="sm"
                    variant="outline"
                    className="w-full gap-2 border-purple-400 dark:border-purple-600 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                  >
                    <Sparkles className="h-4 w-4" />
                    Apply All AI Suggestions
                  </Button>
                )}
                
                {/* Textbook info */}
                {suggestedWeeklyPlan?.textbook && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-1">
                      <BookOpen className="h-3 w-3" />
                      Identified Textbook
                    </p>
                    <p className="text-[10px] text-purple-600 dark:text-purple-400 leading-relaxed">
                      {suggestedWeeklyPlan.textbook.title}
                      {suggestedWeeklyPlan.textbook.authors && suggestedWeeklyPlan.textbook.authors.length > 0 && (
                        <> by {suggestedWeeklyPlan.textbook.authors.join(', ')}</>
                      )}
                    </p>
                  </div>
                )}
                
                {/* Web sources */}
                {suggestedWeeklyPlan?.web_sources && suggestedWeeklyPlan.web_sources.length > 0 && (
                  <details>
                    <summary className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1">
                      <ExternalLink className="h-2.5 w-2.5" />
                      {suggestedWeeklyPlan.web_sources.length} web sources
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-3">
                      {suggestedWeeklyPlan.web_sources.slice(0, 8).map((src, i) => (
                        <li key={i}>
                          <a href={src.url} target="_blank" rel="noopener noreferrer"
                            className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline line-clamp-1">
                            {src.title || src.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                
                {/* Metadata */}
                {suggestedWeeklyPlan && (
                  <div className="text-[9px] text-muted-foreground pt-1 border-t border-purple-200 dark:border-purple-700">
                    {new Date(suggestedWeeklyPlan.generated_at).toLocaleString()} • {suggestedWeeklyPlan.model}
                  </div>
                )}
                
                {!suggestedWeeklyPlan && !generatingSuggestions && (
                  <p className="text-[10px] text-muted-foreground">
                    AI will research the textbook and suggest topics, readings, and CLO assignments for each week.
                  </p>
                )}
              </div>
            </div>
            
            {/* Help tip */}
            <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">Tip:</strong> Drag weeks from the unmapped list or from the AI suggestions onto a CLO to assign. Weeks with <Sparkles className="h-3 w-3 inline text-purple-400" /> came from AI. Click × to unassign.
              </p>
            </div>
          </div>
        </div>
        
        {/* Right Column - CLO Drop Zones */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-4 w-4 text-primary" />
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Course Learning Outcomes
            </h4>
          </div>
          
          <div className="grid gap-4">
            {clos.map((clo, index) => (
              <CLODropZone
                key={clo.clo_id}
                clo={clo}
                colorIndex={index}
                mappedWeeks={cloWeeksMap.get(clo.clo_id) || []}
                weeklyPlan={draftWeeklyPlan}
                aiSuggestedWeeks={aiCloWeeksMap.get(clo.clo_id) || []}
                aiLoading={generatingSuggestions}
                aiAppliedWeeks={aiAppliedWeeks}
                onDropWeek={(weekNum) => handleDropWeek(clo.clo_id, weekNum)}
                onRemoveWeek={(weekNum) => handleRemoveWeekFromCLO(clo.clo_id, weekNum)}
              />
            ))}
          </div>
        </div>
      </div>
      
      {/* Footer with distribution summary */}
      <div className="px-4 py-3 border-t bg-muted/30">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground">
              Mapped: <strong className="text-foreground">{draftDistribution.mapped_weeks}</strong> / {draftDistribution.total_weeks} weeks
            </span>
            {draftDistribution.unmapped_weeks.length > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                Unmapped: Week{draftDistribution.unmapped_weeks.length > 1 ? 's' : ''} {draftDistribution.unmapped_weeks.join(', ')}
              </span>
            )}
          </div>
          <div className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded-md',
            draftDistribution.overall_is_fair 
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          )}>
            {draftDistribution.overall_is_fair ? '✓ Fairly Distributed' : '⚠ Unbalanced Distribution'}
          </div>
        </div>
      </div>
    </div>
  )
}
