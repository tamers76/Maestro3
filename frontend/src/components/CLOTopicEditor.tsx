import { useCallback, useMemo, useState, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { showToast } from '@/components/ui/Toaster'
import { 
  saveCloTopics,
  type CLO, 
  type CloTopics,
  type TopicItem,
  type CloTopicCoverage,
  type SuggestedCloTopics,
  type SuggestedTopicItem,
} from '@/services/api'
import { cn } from '@/lib/utils'
import { 
  Save, 
  Loader2,
  AlertCircle,
  Target,
  Sparkles,
  BookOpen,
  ExternalLink,
  Info,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Check,
  ListPlus,
} from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'

// Color palette for CLOs
const CLO_COLORS = [
  { 
    bg: 'bg-blue-100 dark:bg-blue-900/40', 
    border: 'border-blue-400 dark:border-blue-500',
    borderActive: 'border-blue-500 dark:border-blue-400',
    text: 'text-blue-700 dark:text-blue-300',
    badge: 'bg-blue-500 text-white',
    ring: 'ring-blue-400',
    aiBg: 'bg-sky-50 dark:bg-sky-900/25',
    aiBorder: 'border-sky-300 dark:border-sky-600',
    aiText: 'text-sky-700 dark:text-sky-300',
    aiTextMuted: 'text-sky-600 dark:text-sky-400',
  },
  { 
    bg: 'bg-emerald-100 dark:bg-emerald-900/40', 
    border: 'border-emerald-400 dark:border-emerald-500',
    borderActive: 'border-emerald-500 dark:border-emerald-400',
    text: 'text-emerald-700 dark:text-emerald-300',
    badge: 'bg-emerald-500 text-white',
    ring: 'ring-emerald-400',
    aiBg: 'bg-teal-50 dark:bg-teal-900/25',
    aiBorder: 'border-teal-300 dark:border-teal-600',
    aiText: 'text-teal-700 dark:text-teal-300',
    aiTextMuted: 'text-teal-600 dark:text-teal-400',
  },
  { 
    bg: 'bg-violet-100 dark:bg-violet-900/40', 
    border: 'border-violet-400 dark:border-violet-500',
    borderActive: 'border-violet-500 dark:border-violet-400',
    text: 'text-violet-700 dark:text-violet-300',
    badge: 'bg-violet-500 text-white',
    ring: 'ring-violet-400',
    aiBg: 'bg-purple-50 dark:bg-purple-900/25',
    aiBorder: 'border-purple-300 dark:border-purple-600',
    aiText: 'text-purple-700 dark:text-purple-300',
    aiTextMuted: 'text-purple-600 dark:text-purple-400',
  },
  { 
    bg: 'bg-orange-100 dark:bg-orange-900/40', 
    border: 'border-orange-400 dark:border-orange-500',
    borderActive: 'border-orange-500 dark:border-orange-400',
    text: 'text-orange-700 dark:text-orange-300',
    badge: 'bg-orange-500 text-white',
    ring: 'ring-orange-400',
    aiBg: 'bg-amber-50 dark:bg-amber-900/25',
    aiBorder: 'border-amber-300 dark:border-amber-600',
    aiText: 'text-amber-700 dark:text-amber-300',
    aiTextMuted: 'text-amber-600 dark:text-amber-400',
  },
  { 
    bg: 'bg-pink-100 dark:bg-pink-900/40', 
    border: 'border-pink-400 dark:border-pink-500',
    borderActive: 'border-pink-500 dark:border-pink-400',
    text: 'text-pink-700 dark:text-pink-300',
    badge: 'bg-pink-500 text-white',
    ring: 'ring-pink-400',
    aiBg: 'bg-rose-50 dark:bg-rose-900/25',
    aiBorder: 'border-rose-300 dark:border-rose-600',
    aiText: 'text-rose-700 dark:text-rose-300',
    aiTextMuted: 'text-rose-600 dark:text-rose-400',
  },
  { 
    bg: 'bg-cyan-100 dark:bg-cyan-900/40', 
    border: 'border-cyan-400 dark:border-cyan-500',
    borderActive: 'border-cyan-500 dark:border-cyan-400',
    text: 'text-cyan-700 dark:text-cyan-300',
    badge: 'bg-cyan-500 text-white',
    ring: 'ring-cyan-400',
    aiBg: 'bg-sky-50 dark:bg-sky-900/25',
    aiBorder: 'border-sky-300 dark:border-sky-600',
    aiText: 'text-sky-700 dark:text-sky-300',
    aiTextMuted: 'text-sky-600 dark:text-sky-400',
  },
  { 
    bg: 'bg-amber-100 dark:bg-amber-900/40', 
    border: 'border-amber-400 dark:border-amber-500',
    borderActive: 'border-amber-500 dark:border-amber-400',
    text: 'text-amber-700 dark:text-amber-300',
    badge: 'bg-amber-500 text-white',
    ring: 'ring-amber-400',
    aiBg: 'bg-yellow-50 dark:bg-yellow-900/25',
    aiBorder: 'border-yellow-300 dark:border-yellow-600',
    aiText: 'text-yellow-700 dark:text-yellow-300',
    aiTextMuted: 'text-yellow-600 dark:text-yellow-400',
  },
  { 
    bg: 'bg-rose-100 dark:bg-rose-900/40', 
    border: 'border-rose-400 dark:border-rose-500',
    borderActive: 'border-rose-500 dark:border-rose-400',
    text: 'text-rose-700 dark:text-rose-300',
    badge: 'bg-rose-500 text-white',
    ring: 'ring-rose-400',
    aiBg: 'bg-pink-50 dark:bg-pink-900/25',
    aiBorder: 'border-pink-300 dark:border-pink-600',
    aiText: 'text-pink-700 dark:text-pink-300',
    aiTextMuted: 'text-pink-600 dark:text-pink-400',
  },
]

interface CLOTopicEditorProps {
  courseCode: string
  clos: CLO[]
  cloTopics: CloTopics
  onSave?: () => void
  onHasChanges?: (hasChanges: boolean) => void
  onCoverageChange?: (coverage: CloTopicCoverage) => void
  /** Full AI-suggested topics from deep research */
  suggestedCloTopics?: SuggestedCloTopics | null
  /** Whether AI generation is currently running */
  generatingSuggestions?: boolean
  /** Trigger AI generation */
  onGenerateSuggestions?: () => void
}

// Editable Topic Card
function TopicCard({
  topic,
  index,
  colorIndex,
  isFromAI,
  onUpdate,
  onRemove,
}: {
  topic: TopicItem
  index: number
  colorIndex: number
  isFromAI?: boolean
  onUpdate: (updated: TopicItem) => void
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const colors = CLO_COLORS[colorIndex % CLO_COLORS.length]

  return (
    <div className={cn(
      'rounded-lg border-2 transition-all',
      colors.bg, colors.border
    )}>
      {/* Collapsed view */}
      <div 
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <GripVertical className="h-4 w-4 text-black/30 dark:text-slate-400 flex-shrink-0" />
        <span className={cn('text-sm font-bold flex-shrink-0', colors.text)}>
          Topic {index + 1}
        </span>
        {isFromAI && (
          <span title="From AI suggestion"><Sparkles className="h-4 w-4 flex-shrink-0 text-purple-400" /></span>
        )}
        <span className="text-sm text-black/70 dark:text-slate-400 truncate flex-1">
          {topic.title || 'Untitled'}
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-black/40 dark:text-slate-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-black/40 dark:text-slate-400 flex-shrink-0" />
        )}
      </div>

      {/* Expanded edit view */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-200 dark:border-slate-700">
          <div className="pt-3">
            <label className="text-xs font-semibold text-black/60 dark:text-slate-500 uppercase tracking-wide">Title</label>
            <Input
              value={topic.title}
              onChange={(e) => onUpdate({ ...topic, title: e.target.value })}
              className="mt-1 text-sm h-10"
              placeholder="Topic title"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-black/60 dark:text-slate-500 uppercase tracking-wide">Description</label>
            <Textarea
              value={topic.description}
              onChange={(e) => onUpdate({ ...topic, description: e.target.value })}
              className="mt-1 text-sm min-h-[60px]"
              placeholder="What the student will learn..."
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-black/60 dark:text-slate-500 uppercase tracking-wide">Readings</label>
            <Input
              value={topic.readings || ''}
              onChange={(e) => onUpdate({ ...topic, readings: e.target.value })}
              className="mt-1 text-sm h-10"
              placeholder="e.g. Chapter 3, pp. 45-78"
            />
          </div>
          <div className="flex justify-end">
            <Button
              variant="destructive"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              className="gap-1.5 text-sm h-9 px-4"
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// AI Suggested Topic Card (click to apply)
function AISuggestedTopicCard({
  topic,
  index,
  colorIndex,
  onApply,
}: {
  topic: SuggestedTopicItem
  index: number
  colorIndex: number
  onApply: () => void
}) {
  const colors = CLO_COLORS[colorIndex % CLO_COLORS.length]
  
  return (
    <div className={cn(
      'group flex items-start gap-3 px-4 py-3 rounded-lg border-2 transition-all',
      'hover:shadow-md cursor-pointer',
      colors.aiBg, colors.aiBorder
    )}
      onClick={onApply}
      title="Click to add this topic"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Sparkles className={cn('h-4 w-4 flex-shrink-0', colors.aiTextMuted)} />
          <span className={cn('text-sm font-bold', colors.aiText)}>
            Topic {index + 1}
          </span>
          <span className={cn('text-sm font-medium truncate', colors.aiText)}>
            {topic.title}
          </span>
        </div>
        <p className={cn('text-xs mt-1 ml-6 line-clamp-2', colors.aiTextMuted)}>
          {topic.description}
        </p>
        {topic.readings && (
          <p className={cn('text-xs mt-0.5 ml-6 truncate', colors.aiTextMuted)}>
            <BookOpen className="h-3.5 w-3.5 inline mr-1" />
            {topic.readings}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="opacity-0 group-hover:opacity-100 h-8 w-8 p-0 flex-shrink-0"
        title="Add this topic"
      >
        <Plus className="h-5 w-5 text-green-600" />
      </Button>
    </div>
  )
}

// Per-CLO Topic Zone
function CLOTopicZone({
  clo,
  colorIndex,
  topics,
  aiSuggestedTopics,
  aiLoading,
  appliedTopicTitles,
  onUpdateTopics,
  onApplyAITopic,
}: {
  clo: CLO
  colorIndex: number
  topics: TopicItem[]
  aiSuggestedTopics: SuggestedTopicItem[]
  aiLoading?: boolean
  appliedTopicTitles: Set<string>
  onUpdateTopics: (topics: TopicItem[]) => void
  onApplyAITopic: (topic: SuggestedTopicItem) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const colors = CLO_COLORS[colorIndex % CLO_COLORS.length]
  
  const handleUpdateTopic = (index: number, updated: TopicItem) => {
    const newTopics = [...topics]
    newTopics[index] = updated
    onUpdateTopics(newTopics)
  }
  
  const handleRemoveTopic = (index: number) => {
    const newTopics = topics.filter((_, i) => i !== index)
    onUpdateTopics(newTopics)
  }
  
  const handleAddTopic = () => {
    const newTopic: TopicItem = {
      topic_id: uuidv4(),
      title: '',
      description: '',
      readings: '',
    }
    onUpdateTopics([...topics, newTopic])
  }

  // Filter out AI suggestions that have already been applied
  const remainingAISuggestions = aiSuggestedTopics.filter(
    t => !appliedTopicTitles.has(t.title)
  )
  
  return (
    <div className={cn('rounded-xl border-2 transition-all duration-200 overflow-hidden', colors.border)}>
      {/* CLO Header */}
      <div 
        className={cn('px-5 py-4 border-b cursor-pointer', colors.border, colors.bg)}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-3">
          <div className={cn('p-2.5 rounded-lg', colors.badge)}>
            <Target className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={cn('text-base font-bold', colors.text)}>
                {clo.clo_id}
              </span>
              <span className={cn('text-xs px-2 py-0.5 rounded font-semibold', colors.badge)}>
                {clo.bloom_level}
              </span>
              <span className="text-sm text-black/50 dark:text-slate-400 ml-auto font-medium">
                {topics.length} topic{topics.length !== 1 ? 's' : ''}
              </span>
              {expanded ? (
                <ChevronDown className="h-5 w-5 text-black/40 dark:text-slate-400" />
              ) : (
                <ChevronRight className="h-5 w-5 text-black/40 dark:text-slate-400" />
              )}
            </div>
            <p className="text-sm text-black/70 dark:text-slate-400 line-clamp-2">
              {clo.clo_text}
            </p>
          </div>
        </div>
      </div>
      
      {expanded && (
        <>
          {/* Current Topics */}
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Target className={cn('h-4 w-4', colors.text)} />
              <span className="text-xs font-bold uppercase tracking-wide text-black/50 dark:text-slate-400">
                Topics
              </span>
            </div>
            {topics.length > 0 ? (
              <div className="space-y-2.5">
                {topics.map((topic, index) => (
                  <TopicCard
                    key={topic.topic_id}
                    topic={topic}
                    index={index}
                    colorIndex={colorIndex}
                    isFromAI={appliedTopicTitles.has(topic.title)}
                    onUpdate={(updated) => handleUpdateTopic(index, updated)}
                    onRemove={() => handleRemoveTopic(index)}
                  />
                ))}
              </div>
            ) : (
              <div className="py-5 text-center text-sm text-black/40 dark:text-slate-400 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600">
                No topics yet. Add manually or apply AI suggestions below.
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddTopic}
              className="mt-3 w-full gap-1.5 text-sm h-9"
            >
              <Plus className="h-4 w-4" />
              Add Topic
            </Button>
          </div>

          {/* AI loading state */}
          {aiLoading && aiSuggestedTopics.length === 0 && (
            <div className={cn('p-4 border-t', colors.border, colors.aiBg)}>
              <div className="flex items-center gap-2 py-4 justify-center">
                <Loader2 className={cn('h-5 w-5 animate-spin', colors.aiTextMuted)} />
                <span className={cn('text-sm font-medium', colors.aiText)}>
                  AI is researching suggestions...
                </span>
              </div>
            </div>
          )}
          
          {/* AI Suggested Topics */}
          {remainingAISuggestions.length > 0 && (
            <div className={cn('p-4 border-t', colors.border, colors.aiBg)}>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className={cn('h-4 w-4', colors.aiTextMuted)} />
                <span className={cn('text-xs font-bold uppercase tracking-wide', colors.aiText)}>
                  AI Suggested Topics
                </span>
                <span className={cn('text-xs opacity-60', colors.aiTextMuted)}>
                  — click to add
                </span>
              </div>
              <div className="space-y-2.5">
                {remainingAISuggestions.map((topic, index) => (
                  <AISuggestedTopicCard
                    key={`ai-${index}-${topic.title}`}
                    topic={topic}
                    index={index}
                    colorIndex={colorIndex}
                    onApply={() => onApplyAITopic(topic)}
                  />
                ))}
              </div>
              {/* Rationale */}
              {remainingAISuggestions.some(t => t.rationale) && (
                <details className="mt-3">
                  <summary className="text-xs text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1.5 hover:underline">
                    <Info className="h-3.5 w-3.5" />
                    View rationale
                  </summary>
                  <div className="mt-2 space-y-1.5 pl-5">
                    {remainingAISuggestions.filter(t => t.rationale).map((topic, i) => (
                      <p key={i} className="text-xs text-muted-foreground leading-relaxed">
                        <span className={cn('font-semibold', colors.aiText)}>{topic.title}:</span>{' '}
                        {topic.rationale}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function CLOTopicEditor({
  courseCode,
  clos,
  cloTopics: initialCloTopics,
  onSave,
  onHasChanges,
  onCoverageChange,
  suggestedCloTopics,
  generatingSuggestions,
  onGenerateSuggestions,
}: CLOTopicEditorProps) {
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [draftTopics, setDraftTopics] = useState<CloTopics>(initialCloTopics)
  // Track which topic titles came from AI
  const [aiAppliedTitles, setAiAppliedTitles] = useState<Set<string>>(new Set())
  
  // Normalize CLO IDs for AI suggestions
  const cloIdLookup = useMemo(() => {
    const lookup = new Map<string, string>()
    const normStr = (s: string) => s.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D-]/g, '-').trim()
    clos.forEach(clo => {
      lookup.set(clo.clo_id, clo.clo_id)
      lookup.set(normStr(clo.clo_id), clo.clo_id)
      lookup.set(clo.clo_id.replace(/-/g, ''), clo.clo_id)
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

  // Build AI suggestions map: clo_id -> SuggestedTopicItem[]
  const aiSuggestionsMap = useMemo(() => {
    const map = new Map<string, SuggestedTopicItem[]>()
    clos.forEach(clo => map.set(clo.clo_id, []))
    
    if (suggestedCloTopics && !suggestedCloTopics.stale) {
      suggestedCloTopics.topics_by_clo.forEach(group => {
        const actualId = normalizeCloId(group.clo_id)
        if (actualId && map.has(actualId)) {
          map.set(actualId, group.topics)
        }
      })
    }
    
    return map
  }, [clos, suggestedCloTopics, normalizeCloId])
  
  // Reset draft when props change
  useEffect(() => {
    setDraftTopics(initialCloTopics)
    setHasChanges(false)
    setAiAppliedTitles(new Set())
  }, [initialCloTopics])
  
  // Notify parent of changes
  useEffect(() => {
    onHasChanges?.(hasChanges)
  }, [hasChanges, onHasChanges])
  
  // Compute coverage
  const draftCoverage = useMemo((): CloTopicCoverage => {
    const perClo = clos.map(clo => {
      const group = draftTopics.find(g => g.clo_id === clo.clo_id)
      const count = group ? group.topics.length : 0
      return {
        clo_id: clo.clo_id,
        clo_text: clo.clo_text,
        topic_count: count,
        has_topics: count > 0,
      }
    })
    const totalTopics = perClo.reduce((sum, s) => sum + s.topic_count, 0)
    return {
      total_clos: clos.length,
      total_topics: totalTopics,
      per_clo: perClo,
      all_clos_covered: perClo.every(s => s.has_topics),
      computed_at: new Date().toISOString(),
    }
  }, [draftTopics, clos])

  // Notify parent of coverage changes
  useEffect(() => {
    if (hasChanges && onCoverageChange) {
      onCoverageChange(draftCoverage)
    }
  }, [draftCoverage, hasChanges, onCoverageChange])
  
  // Update topics for a CLO
  const handleUpdateTopics = useCallback((cloId: string, topics: TopicItem[]) => {
    setDraftTopics(prev => {
      const existing = prev.find(g => g.clo_id === cloId)
      if (existing) {
        return prev.map(g => g.clo_id === cloId ? { ...g, topics } : g)
      } else {
        return [...prev, { clo_id: cloId, topics }]
      }
    })
    setHasChanges(true)
  }, [])
  
  // Apply a single AI suggested topic to a CLO
  const handleApplyAITopic = useCallback((cloId: string, aiTopic: SuggestedTopicItem) => {
    const newTopic: TopicItem = {
      topic_id: uuidv4(),
      title: aiTopic.title,
      description: aiTopic.description,
      readings: aiTopic.readings,
      rationale: aiTopic.rationale,
    }
    
    setDraftTopics(prev => {
      const existing = prev.find(g => g.clo_id === cloId)
      if (existing) {
        return prev.map(g => g.clo_id === cloId 
          ? { ...g, topics: [...g.topics, newTopic] } 
          : g
        )
      } else {
        return [...prev, { clo_id: cloId, topics: [newTopic] }]
      }
    })
    
    setAiAppliedTitles(prev => new Set(prev).add(aiTopic.title))
    setHasChanges(true)
  }, [])
  
  // Apply ALL AI suggestions — replaces existing topics entirely
  const handleApplyAllAI = useCallback(() => {
    if (!suggestedCloTopics) return
    
    const newTitles = new Set<string>()
    
    setDraftTopics(() => {
      // Build a fresh list from AI suggestions only, discarding all existing topics
      const result: typeof draftTopics = []
      
      suggestedCloTopics.topics_by_clo.forEach(group => {
        const actualCloId = normalizeCloId(group.clo_id)
        if (!actualCloId) return
        
        const aiTopics = group.topics.map(t => {
          newTitles.add(t.title)
          return {
            topic_id: uuidv4(),
            title: t.title,
            description: t.description,
            readings: t.readings,
            rationale: t.rationale,
          } as TopicItem
        })
        
        result.push({ clo_id: actualCloId, topics: aiTopics })
      })
      
      return result
    })
    
    setAiAppliedTitles(newTitles)
    setHasChanges(true)
    
    const totalNew = suggestedCloTopics.topics_by_clo.reduce((s, g) => s + g.topics.length, 0)
    showToast({
      title: 'AI Topics Applied',
      description: `Replaced with ${totalNew} AI-suggested topics. Review and Save.`,
      variant: 'success',
    })
  }, [suggestedCloTopics, normalizeCloId])
  
  // Append AI suggestions — keeps existing topics and adds new AI ones that aren't duplicates
  const handleAppendAI = useCallback(() => {
    if (!suggestedCloTopics) return
    
    const newTitles = new Set<string>(aiAppliedTitles)
    let addedCount = 0
    
    setDraftTopics(prev => {
      // Build a lookup of existing topic titles per CLO (lowercase for dedup)
      const existingByClO = new Map<string, Set<string>>()
      for (const group of prev) {
        const titleSet = new Set(group.topics.map(t => t.title.toLowerCase().trim()))
        existingByClO.set(group.clo_id, titleSet)
      }
      
      // Clone existing topics
      const result: typeof prev = prev.map(g => ({
        clo_id: g.clo_id,
        topics: [...g.topics],
      }))
      
      suggestedCloTopics.topics_by_clo.forEach(group => {
        const actualCloId = normalizeCloId(group.clo_id)
        if (!actualCloId) return
        
        // Find or create the CLO group in the result
        let targetGroup = result.find(g => g.clo_id === actualCloId)
        if (!targetGroup) {
          targetGroup = { clo_id: actualCloId, topics: [] }
          result.push(targetGroup)
        }
        
        const existingTitles = existingByClO.get(actualCloId) || new Set<string>()
        
        for (const t of group.topics) {
          // Skip duplicates (case-insensitive)
          if (existingTitles.has(t.title.toLowerCase().trim())) continue
          
          newTitles.add(t.title)
          existingTitles.add(t.title.toLowerCase().trim())
          targetGroup.topics.push({
            topic_id: uuidv4(),
            title: t.title,
            description: t.description,
            readings: t.readings,
            rationale: t.rationale,
          } as TopicItem)
          addedCount++
        }
      })
      
      return result
    })
    
    setAiAppliedTitles(newTitles)
    setHasChanges(true)
    
    showToast({
      title: 'AI Topics Appended',
      description: addedCount > 0
        ? `Added ${addedCount} new AI-suggested topics (duplicates skipped). Review and Save.`
        : 'No new topics to add — all AI suggestions already exist.',
      variant: addedCount > 0 ? 'success' : 'default',
    })
  }, [suggestedCloTopics, normalizeCloId, aiAppliedTitles])
  
  // Save
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await saveCloTopics(courseCode, draftTopics)
      showToast({
        title: 'Saved',
        description: 'CLO topics saved successfully',
        variant: 'success',
      })
      setHasChanges(false)
      onSave?.()
    } catch (error) {
      showToast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Failed to save topics',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }, [courseCode, draftTopics, onSave])
  
  // Reset
  const handleReset = useCallback(() => {
    setDraftTopics(initialCloTopics)
    setHasChanges(false)
    setAiAppliedTitles(new Set())
  }, [initialCloTopics])
  
  const totalTopics = draftCoverage.total_topics
  const uncoveredClos = draftCoverage.per_clo.filter(s => !s.has_topics)

  return (
    <div className="flex flex-col rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <h3 className="font-bold text-base text-black dark:text-foreground">CLO Topic Editor</h3>
          <span className="text-sm text-black/50 dark:text-muted-foreground">
            {clos.length} CLOs — {totalTopics} topics
          </span>
        </div>
        
        <div className="flex items-center gap-3">
          {hasChanges && (
            <span className="text-sm font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500/10">
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
              className="text-sm h-9 px-4"
            >
              Reset
            </Button>
          )}
          <Button 
            onClick={handleSave} 
            disabled={saving || !hasChanges}
            size="sm"
            className="gap-2 text-sm h-9 px-5"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Topics
          </Button>
        </div>
      </div>
      
      {/* Main Content — Two columns */}
      <div className="flex gap-6 p-6">
        {/* Left Column — AI Deep Research Panel */}
        <div className="w-[300px] flex-shrink-0">
          <div className="sticky top-4 space-y-5">
            {/* AI Deep Research Panel */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-5 w-5 text-purple-500" />
                <h4 className="text-base font-bold text-black dark:text-slate-300">
                  AI Deep Research
                </h4>
              </div>
              
              <div className="rounded-xl border-2 border-purple-300 dark:border-purple-600 bg-purple-50/50 dark:bg-purple-900/20 p-4 space-y-3">
                {/* Generate / Regenerate button */}
                <Button
                  onClick={onGenerateSuggestions}
                  disabled={generatingSuggestions || hasChanges}
                  size="sm"
                  variant="outline"
                  className="w-full gap-2 border-purple-400 dark:border-purple-600 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                  title={hasChanges ? 'Save topic changes first' : 'Research textbook and suggest topics per CLO'}
                >
                  {generatingSuggestions ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {generatingSuggestions ? 'Researching...' : suggestedCloTopics ? 'Regenerate Topics' : 'Generate Suggested Topics'}
                </Button>
                
                {/* Stale warning */}
                {suggestedCloTopics?.stale && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>Suggestions are outdated. Regenerate for fresh results.</span>
                  </div>
                )}
                
                {/* Apply All / Append buttons */}
                {suggestedCloTopics && !suggestedCloTopics.stale && (
                  <div className="flex flex-col gap-1.5">
                    <Button
                      onClick={handleAppendAI}
                      size="sm"
                      variant="outline"
                      className="w-full gap-2 border-purple-400 dark:border-purple-600 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-300"
                    >
                      <ListPlus className="h-4 w-4" />
                      Append AI Suggestions
                    </Button>
                    <Button
                      onClick={handleApplyAllAI}
                      size="sm"
                      variant="outline"
                      className="w-full gap-2 border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400"
                    >
                      <Sparkles className="h-4 w-4" />
                      Replace with AI Suggestions
                    </Button>
                  </div>
                )}
                
                {/* Textbook info */}
                {suggestedCloTopics?.textbook && (
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
                      <BookOpen className="h-4 w-4" />
                      Identified Textbook
                    </p>
                    <p className="text-xs text-purple-600 dark:text-purple-400 leading-relaxed">
                      {suggestedCloTopics.textbook.title}
                      {suggestedCloTopics.textbook.authors && suggestedCloTopics.textbook.authors.length > 0 && (
                        <> by {suggestedCloTopics.textbook.authors.join(', ')}</>
                      )}
                    </p>
                  </div>
                )}
                
                {/* Web sources */}
                {suggestedCloTopics?.web_sources && suggestedCloTopics.web_sources.length > 0 && (
                  <details>
                    <summary className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1">
                      <ExternalLink className="h-2.5 w-2.5" />
                      {suggestedCloTopics.web_sources.length} web sources
                    </summary>
                    <ul className="mt-1 space-y-0.5 pl-3">
                      {suggestedCloTopics.web_sources.slice(0, 8).map((src, i) => (
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
                {suggestedCloTopics && (
                  <div className="text-xs text-muted-foreground pt-2 border-t border-purple-200 dark:border-purple-700">
                    {new Date(suggestedCloTopics.generated_at).toLocaleString()} — {suggestedCloTopics.model}
                  </div>
                )}
                
                {!suggestedCloTopics && !generatingSuggestions && (
                  <p className="text-xs text-muted-foreground">
                    AI will research the textbook and suggest self-paced topics for each CLO.
                  </p>
                )}
              </div>
            </div>
            
            {/* Help tip */}
            <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
              <p className="text-sm text-black/60 dark:text-muted-foreground leading-relaxed">
                <strong className="text-black dark:text-foreground">Tip:</strong> Add topics manually or use AI suggestions. Each CLO needs at least one topic. Click a topic to expand and edit. Topics with <Sparkles className="h-3.5 w-3.5 inline text-purple-400" /> came from AI.
              </p>
            </div>
          </div>
        </div>
        
        {/* Right Column — CLO Topic Zones */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-5 w-5 text-primary" />
            <h4 className="text-base font-bold text-black dark:text-slate-300">
              Course Learning Outcomes
            </h4>
          </div>
          
          <div className="grid gap-5">
            {clos.map((clo, index) => (
              <CLOTopicZone
                key={clo.clo_id}
                clo={clo}
                colorIndex={index}
                topics={draftTopics.find(g => g.clo_id === clo.clo_id)?.topics || []}
                aiSuggestedTopics={aiSuggestionsMap.get(clo.clo_id) || []}
                aiLoading={generatingSuggestions}
                appliedTopicTitles={aiAppliedTitles}
                onUpdateTopics={(topics) => handleUpdateTopics(clo.clo_id, topics)}
                onApplyAITopic={(topic) => handleApplyAITopic(clo.clo_id, topic)}
              />
            ))}
          </div>
        </div>
      </div>
      
      {/* Footer with coverage summary */}
      <div className="px-6 py-4 border-t bg-muted/30">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            <span className="text-black/60 dark:text-muted-foreground">
              Total: <strong className="text-black dark:text-foreground">{totalTopics}</strong> topics across {clos.length} CLOs
            </span>
            {uncoveredClos.length > 0 && (
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                Missing topics: {uncoveredClos.map(s => s.clo_id).join(', ')}
              </span>
            )}
          </div>
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md font-medium',
            draftCoverage.all_clos_covered
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          )}>
            {draftCoverage.all_clos_covered ? (
              <>
                <Check className="h-4 w-4" />
                All CLOs Covered
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4" />
                {uncoveredClos.length} CLO{uncoveredClos.length > 1 ? 's' : ''} Missing Topics
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
