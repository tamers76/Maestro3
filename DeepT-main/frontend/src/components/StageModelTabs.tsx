import { useState, useMemo, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { fetchAvailableModels, fetchRecommendedPrompts, type AIModel, type AIProvider, type StageConfigs, type StageModelConfig, type RecommendedPrompts } from '@/services/api'
import { showToast } from '@/components/ui/Toaster'
import { 
  Loader2, 
  RefreshCw,
  ChevronDown,
  Plus,
  Trash2,
  User,
  Users,
  Copy,
  Wand2
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Stage labels with task prompt names
const STAGE_LABELS = [
  { key: 'stage1' as const, label: 'Stage 1', description: 'Extraction & Contract', taskPromptLabel: 'Extraction Prompt', taskPrompt2Label: 'CLO Analysis Prompt' },
  { key: 'stage2' as const, label: 'Stage 2', description: 'Node Decomposition', taskPromptLabel: 'Decomposition Prompt' },
  { key: 'stage3' as const, label: 'Stage 3', description: 'Adaptive Logic', taskPromptLabel: 'Adaptive Logic Prompt' },
  { key: 'stage4' as const, label: 'Stage 4', description: 'Content Generation', taskPromptLabel: 'Content Generation Prompt' },
  { key: 'stage5' as const, label: 'Stage 5', description: 'Final Assembly' }, // No task prompt for stage 5
]

// Helper to get a display name for a model
function getModelDisplayName(model: AIModel): string {
  if (model.shortName) return model.shortName
  const parts = model.id.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : model.id
}

// Format context length for display
function formatContext(length: number): string {
  if (length >= 1000000) return `${(length / 1000000).toFixed(1)}M`
  if (length >= 1000) return `${Math.round(length / 1000)}K`
  return `${length}`
}

interface ModelDropdownProps {
  value: string
  onChange: (value: string) => void
  label?: string
  models: AIModel[]
  freeOnly: boolean
  selectedProvider: string
  placeholder?: string
  showRemove?: boolean
  onRemove?: () => void
  hasLoaded: boolean
}

function ModelDropdown({ 
  value, 
  onChange, 
  label, 
  models, 
  freeOnly, 
  selectedProvider,
  placeholder = 'Select a model...',
  showRemove = false,
  onRemove,
  hasLoaded
}: ModelDropdownProps) {
  const filteredModels = useMemo(() => {
    let filtered = models
    if (freeOnly) {
      filtered = filtered.filter(m => m.isFree)
    }
    if (selectedProvider) {
      filtered = filtered.filter(m => m.provider === selectedProvider)
    }
    return [...filtered].sort((a, b) => {
      const nameA = getModelDisplayName(a)
      const nameB = getModelDisplayName(b)
      return nameA.localeCompare(nameB)
    })
  }, [models, freeOnly, selectedProvider])

  const selectedModel = models.find(m => m.id === value)

  // Always show dropdown
  return (
    <div className="space-y-1">
      {label && <label className="text-sm font-medium text-foreground">{label}</label>}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={!hasLoaded}
            className={cn(
              'w-full h-10 appearance-none rounded-md border border-input bg-background pl-3 pr-10 py-2 text-sm text-foreground',
              'hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
              'cursor-pointer',
              !value && 'text-muted-foreground',
              !hasLoaded && 'bg-muted cursor-wait'
            )}
          >
            <option value="">{!hasLoaded ? 'Loading models...' : placeholder}</option>
            {filteredModels.map(model => (
              <option key={model.id} value={model.id}>
                {model.isFree ? '⚡ ' : ''}{getModelDisplayName(model)} ({formatContext(model.contextLength)})
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>
        {showRemove && onRemove && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRemove}
            className="h-10 px-3 text-red-500 hover:text-red-600 hover:bg-red-500/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      {selectedModel && (
        <p className="text-xs text-muted-foreground">
          {selectedModel.isFree && <span className="text-emerald-500 font-medium">Free • </span>}
          {formatContext(selectedModel.contextLength)} context
        </p>
      )}
    </div>
  )
}

interface StageModelTabsProps {
  stageConfigs: StageConfigs
  onChange: (stageConfigs: StageConfigs) => void
  provider: AIProvider
  /** When provided, only these stage tabs are shown (e.g. hide legacy 2-5). */
  visibleStageKeys?: (keyof StageConfigs)[]
}

export default function StageModelTabs({
  stageConfigs,
  onChange,
  provider = 'openrouter',
  visibleStageKeys
}: StageModelTabsProps) {
  const visibleStages = useMemo(
    () => STAGE_LABELS.filter((s) => !visibleStageKeys || visibleStageKeys.includes(s.key)),
    [visibleStageKeys]
  )
  const [activeTab, setActiveTab] = useState<keyof StageConfigs>(
    visibleStageKeys && visibleStageKeys.length > 0 ? visibleStageKeys[0] : 'stage1'
  )
  const [availableModels, setAvailableModels] = useState<AIModel[]>([])
  const [loading, setLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [freeOnly, setFreeOnly] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [currentAIProvider, setCurrentAIProvider] = useState<AIProvider>(provider)
  const [recommendedPrompts, setRecommendedPrompts] = useState<RecommendedPrompts | null>(null)
  const [loadingPrompts, setLoadingPrompts] = useState(false)
  
  // Auto-load models on mount and when provider changes
  useEffect(() => {
    if (provider !== currentAIProvider) {
      setCurrentAIProvider(provider)
      setAvailableModels([])
      setHasLoaded(false)
      setSelectedProvider('')
    }
    // Auto-load models
    if (!hasLoaded && !loading) {
      loadModelsInternal()
    }
  }, [provider, currentAIProvider])

  // Auto-load on initial mount
  useEffect(() => {
    if (!hasLoaded && !loading) {
      loadModelsInternal()
    }
  }, [])

  async function loadModelsInternal() {
    try {
      setLoading(true)
      const data = await fetchAvailableModels(provider)
      setAvailableModels(data)
      setHasLoaded(true)
    } catch (error) {
      console.error('Failed to load models:', error)
      // Still mark as loaded so UI doesn't stay in loading state
      setHasLoaded(true)
    } finally {
      setLoading(false)
    }
  }

  // Load recommended prompts from backend
  async function loadRecommendedPromptsFromBackend(): Promise<RecommendedPrompts | null> {
    // If already loaded, return cached
    if (recommendedPrompts) {
      return recommendedPrompts
    }
    
    try {
      setLoadingPrompts(true)
      const data = await fetchRecommendedPrompts()
      setRecommendedPrompts(data)
      return data
    } catch (error) {
      console.error('Failed to load recommended prompts:', error)
      showToast({
        title: 'Error',
        description: 'Failed to load recommended prompts from server',
        variant: 'destructive',
      })
      return null
    } finally {
      setLoadingPrompts(false)
    }
  }

  // Get unique providers with counts
  const providers = useMemo(() => {
    const providerMap: Record<string, { total: number; free: number }> = {}
    for (const model of availableModels) {
      if (!providerMap[model.provider]) {
        providerMap[model.provider] = { total: 0, free: 0 }
      }
      providerMap[model.provider].total++
      if (model.isFree) {
        providerMap[model.provider].free++
      }
    }
    return Object.entries(providerMap)
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [availableModels])

  async function loadModels() {
    try {
      setLoading(true)
      const data = await fetchAvailableModels(provider)
      setAvailableModels(data)
      setHasLoaded(true)
      
      const providerLabel = provider === 'ollama' ? 'Ollama' : provider === 'openai' ? 'OpenAI' : 'OpenRouter'
      showToast({
        title: 'Models Refreshed',
        description: `Found ${data.length} ${providerLabel} models`,
        variant: 'success',
      })
    } catch (error) {
      const providerLabel = provider === 'ollama' ? 'Ollama' : provider === 'openai' ? 'OpenAI' : 'OpenRouter'
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : `Failed to load ${providerLabel} models`,
        variant: 'destructive',
      })
      setHasLoaded(true) // Mark as loaded so UI doesn't stay in loading state
    } finally {
      setLoading(false)
    }
  }

  const currentStageConfig = stageConfigs[activeTab]

  const updateStageConfig = (updates: Partial<StageModelConfig>) => {
    onChange({
      ...stageConfigs,
      [activeTab]: {
        ...currentStageConfig,
        ...updates
      }
    })
  }

  const handleAddCouncilModel = () => {
    updateStageConfig({
      councilModels: [...currentStageConfig.councilModels, '']
    })
  }

  const handleRemoveCouncilModel = (index: number) => {
    updateStageConfig({
      councilModels: currentStageConfig.councilModels.filter((_, i) => i !== index)
    })
  }

  const handleCouncilModelChange = (index: number, value: string) => {
    const newModels = [...currentStageConfig.councilModels]
    newModels[index] = value
    updateStageConfig({ councilModels: newModels })
  }

  const handleSyncToAllStages = () => {
    // Only copy model-related settings, NOT prompts (taskPrompt, taskPrompt2, memberSystemPrompt, chairmanSystemPrompt)
    const modelSettingsToCopy = {
      mode: currentStageConfig.mode,
      singleModel: currentStageConfig.singleModel,
      councilModels: [...currentStageConfig.councilModels],
      chairmanModel: currentStageConfig.chairmanModel,
    }
    onChange({
      stage1: { ...stageConfigs.stage1, ...modelSettingsToCopy },
      stage2: { ...stageConfigs.stage2, ...modelSettingsToCopy },
      stage3: { ...stageConfigs.stage3, ...modelSettingsToCopy },
      stage4: { ...stageConfigs.stage4, ...modelSettingsToCopy },
      stage5: { ...stageConfigs.stage5, ...modelSettingsToCopy },
    })
    showToast({
      title: 'Synced to All Stages',
      description: `${currentStageConfig.mode === 'council' ? 'Council' : 'Single model'} model settings applied to all stages (prompts unchanged)`,
      variant: 'success',
    })
  }

  // Load recommended council prompts for current stage
  const handleLoadRecommendedCouncilPrompts = async () => {
    const prompts = await loadRecommendedPromptsFromBackend()
    if (prompts && prompts.stages[activeTab]) {
      updateStageConfig({
        memberSystemPrompt: prompts.stages[activeTab].memberSystemPrompt,
        chairmanSystemPrompt: prompts.stages[activeTab].chairmanSystemPrompt
      })
      const stageLabel = STAGE_LABELS.find(s => s.key === activeTab)?.label || activeTab
      showToast({
        title: 'Recommended Council Prompts Loaded',
        description: `Loaded optimized council prompts for ${stageLabel}`,
        variant: 'success',
      })
    }
  }

  // Load recommended council prompts for all stages at once
  const handleLoadAllRecommendedCouncilPrompts = async () => {
    const prompts = await loadRecommendedPromptsFromBackend()
    if (prompts) {
      onChange({
        stage1: { ...stageConfigs.stage1, memberSystemPrompt: prompts.stages.stage1.memberSystemPrompt, chairmanSystemPrompt: prompts.stages.stage1.chairmanSystemPrompt },
        stage2: { ...stageConfigs.stage2, memberSystemPrompt: prompts.stages.stage2.memberSystemPrompt, chairmanSystemPrompt: prompts.stages.stage2.chairmanSystemPrompt },
        stage3: { ...stageConfigs.stage3, memberSystemPrompt: prompts.stages.stage3.memberSystemPrompt, chairmanSystemPrompt: prompts.stages.stage3.chairmanSystemPrompt },
        stage4: { ...stageConfigs.stage4, memberSystemPrompt: prompts.stages.stage4.memberSystemPrompt, chairmanSystemPrompt: prompts.stages.stage4.chairmanSystemPrompt },
        stage5: { ...stageConfigs.stage5, memberSystemPrompt: prompts.stages.stage5.memberSystemPrompt, chairmanSystemPrompt: prompts.stages.stage5.chairmanSystemPrompt },
      })
      showToast({
        title: 'All Recommended Council Prompts Loaded',
        description: 'Loaded optimized council prompts for all 5 stages',
        variant: 'success',
      })
    }
  }

  // Load recommended task prompts for current stage
  const handleLoadRecommendedTaskPrompts = async () => {
    const prompts = await loadRecommendedPromptsFromBackend()
    if (prompts && prompts.stages[activeTab]) {
      const updates: Partial<StageModelConfig> = {}
      if (prompts.stages[activeTab].taskPrompt) {
        updates.taskPrompt = prompts.stages[activeTab].taskPrompt
      }
      if (prompts.stages[activeTab].taskPrompt2) {
        updates.taskPrompt2 = prompts.stages[activeTab].taskPrompt2
      }
      if (Object.keys(updates).length > 0) {
        updateStageConfig(updates)
        const stageLabel = STAGE_LABELS.find(s => s.key === activeTab)?.label || activeTab
        showToast({
          title: 'Recommended Task Prompts Loaded',
          description: `Loaded optimized task prompts for ${stageLabel}`,
          variant: 'success',
        })
      } else {
        showToast({
          title: 'No Task Prompts',
          description: 'This stage has no task prompts to load',
          variant: 'default',
        })
      }
    }
  }

  // Load recommended task prompts for all stages at once
  const handleLoadAllRecommendedTaskPrompts = async () => {
    const prompts = await loadRecommendedPromptsFromBackend()
    if (prompts) {
      onChange({
        stage1: { 
          ...stageConfigs.stage1, 
          taskPrompt: prompts.stages.stage1.taskPrompt,
          taskPrompt2: prompts.stages.stage1.taskPrompt2
        },
        stage2: { ...stageConfigs.stage2, taskPrompt: prompts.stages.stage2.taskPrompt },
        stage3: { ...stageConfigs.stage3, taskPrompt: prompts.stages.stage3.taskPrompt },
        stage4: { ...stageConfigs.stage4, taskPrompt: prompts.stages.stage4.taskPrompt },
        stage5: { ...stageConfigs.stage5 }, // Stage 5 has no task prompt
      })
      showToast({
        title: 'All Recommended Task Prompts Loaded',
        description: 'Loaded optimized task prompts for all stages',
        variant: 'success',
      })
    }
  }

  const freeModelCount = availableModels.filter(m => m.isFree).length

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={loadModels}
          disabled={loading}
          className="gap-2"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh Models
        </Button>

        {provider === 'openrouter' && hasLoaded && (
          <Button
            variant={freeOnly ? 'default' : 'outline'}
            onClick={() => setFreeOnly(!freeOnly)}
            className={cn(
              'gap-2',
              freeOnly && 'bg-emerald-600 hover:bg-emerald-700'
            )}
          >
            ⚡ Free Only
            <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">
              {freeModelCount}
            </span>
          </Button>
        )}
      </div>

      {/* Provider Filter */}
      {hasLoaded && providers.length > 1 && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Filter by Provider</label>
          <div className="relative">
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className={cn(
                'w-full md:w-80 h-10 appearance-none rounded-md border border-input bg-background pl-3 pr-10 py-2 text-sm text-foreground',
                'hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
                'cursor-pointer'
              )}
            >
              <option value="">All Providers ({providers.length})</option>
              {providers.map(prov => (
                <option key={prov.name} value={prov.name}>
                  {prov.name.charAt(0).toUpperCase() + prov.name.slice(1)} — {prov.total} models{prov.free > 0 ? ` (${prov.free} free)` : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      )}

      {/* Stage Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-1 overflow-x-auto">
          {visibleStages.map(({ key, label }) => {
            const config = stageConfigs[key]
            const isCouncil = config?.mode === 'council'
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                  activeTab === key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                )}
              >
                {isCouncil ? (
                  <Users className="h-4 w-4 text-amber-500" />
                ) : (
                  <User className="h-4 w-4 text-blue-500" />
                )}
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Active Tab Content */}
      <div className="space-y-6">
        {/* Stage Description */}
        <div className="text-sm text-muted-foreground">
          <span className="font-medium">{STAGE_LABELS.find(s => s.key === activeTab)?.description}</span>
        </div>

        {/* Mode Selection */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Execution Mode</label>
          <div className="flex rounded-lg border border-border overflow-hidden w-fit bg-muted/30">
            <button
              type="button"
              onClick={() => updateStageConfig({ mode: 'single' })}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors',
                currentStageConfig?.mode === 'single' || !currentStageConfig?.mode
                  ? 'bg-blue-500 text-white'
                  : 'bg-background text-muted-foreground hover:bg-muted/50'
              )}
            >
              <User className="h-4 w-4" />
              Single Model
            </button>
            <button
              type="button"
              onClick={() => updateStageConfig({ mode: 'council' })}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors',
                currentStageConfig?.mode === 'council'
                  ? 'bg-amber-500 text-white'
                  : 'bg-background text-muted-foreground hover:bg-muted/50'
              )}
            >
              <Users className="h-4 w-4" />
              Council
            </button>
          </div>
        </div>

        {/* Single Model Selection */}
        {(currentStageConfig?.mode === 'single' || !currentStageConfig?.mode) && (
          <div className="space-y-4">
            <ModelDropdown
              value={currentStageConfig?.singleModel || ''}
              onChange={(value) => updateStageConfig({ singleModel: value })}
              label="Model"
              models={availableModels}
              freeOnly={freeOnly}
              selectedProvider={selectedProvider}
              placeholder="Select a model..."
              hasLoaded={hasLoaded}
            />
            
            {/* Sync to all stages button */}
            <div className="pt-3 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncToAllStages}
                className="gap-2"
              >
                <Copy className="h-4 w-4" />
                Sync to All Stages
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Apply this model configuration to all 5 stages
              </p>
            </div>
          </div>
        )}

        {/* Council Mode Selection */}
        {currentStageConfig?.mode === 'council' && (
          <div className="space-y-6">
            {/* Council Members */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">Council Members</label>
              <p className="text-xs text-muted-foreground">
                Add multiple models to deliberate together
              </p>
              
              <div className="space-y-3">
                {(currentStageConfig.councilModels || []).map((model, index) => (
                  <ModelDropdown
                    key={index}
                    value={model}
                    onChange={(value) => handleCouncilModelChange(index, value)}
                    label={`Member ${index + 1}`}
                    models={availableModels}
                    freeOnly={freeOnly}
                    selectedProvider={selectedProvider}
                    placeholder="Select a council member..."
                    showRemove={true}
                    onRemove={() => handleRemoveCouncilModel(index)}
                    hasLoaded={hasLoaded}
                  />
                ))}
              </div>
              
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddCouncilModel}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Member
              </Button>
            </div>

            {/* Chairman Model */}
            <div className="space-y-3 pt-4 border-t border-border">
              <ModelDropdown
                value={currentStageConfig.chairmanModel || ''}
                onChange={(value) => updateStageConfig({ chairmanModel: value })}
                label="Chairman Model"
                models={availableModels}
                freeOnly={freeOnly}
                selectedProvider={selectedProvider}
                placeholder="Select chairman model..."
                hasLoaded={hasLoaded}
              />
              <p className="text-xs text-muted-foreground">
                The chairman synthesizes all council responses into a final output
              </p>
            </div>

            {/* Council Prompts */}
            <div className="space-y-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <label className="text-sm font-medium text-foreground">Council Prompts</label>
                  <p className="text-xs text-muted-foreground">Custom instructions for this stage's council execution</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadRecommendedCouncilPrompts}
                    disabled={loadingPrompts}
                    className="gap-2 text-purple-600 hover:text-purple-700 hover:bg-purple-500/10 border-purple-500/30"
                  >
                    {loadingPrompts ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4" />
                    )}
                    Load Recommended
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadAllRecommendedCouncilPrompts}
                    disabled={loadingPrompts}
                    className="gap-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10 border-emerald-500/30"
                  >
                    {loadingPrompts ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4" />
                    )}
                    Load All Stages
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Member System Prompt</label>
                <p className="text-xs text-muted-foreground">Instructions for council members in this stage</p>
                <textarea
                  className="w-full min-h-[100px] rounded-md border border-input bg-background p-3 text-sm text-foreground resize-y"
                  placeholder="You are a helpful AI assistant participating in a council deliberation..."
                  value={currentStageConfig.memberSystemPrompt || ''}
                  onChange={(e) => updateStageConfig({ memberSystemPrompt: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Chairman System Prompt</label>
                <p className="text-xs text-muted-foreground">Instructions for synthesizing council responses in this stage</p>
                <textarea
                  className="w-full min-h-[100px] rounded-md border border-input bg-background p-3 text-sm text-foreground resize-y"
                  placeholder="You are the Chairman of an LLM Council..."
                  value={currentStageConfig.chairmanSystemPrompt || ''}
                  onChange={(e) => updateStageConfig({ chairmanSystemPrompt: e.target.value })}
                />
              </div>
            </div>

            {/* Sync to all stages button */}
            <div className="pt-4 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncToAllStages}
                className="gap-2"
              >
                <Copy className="h-4 w-4" />
                Sync to All Stages
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Apply this council configuration to all 5 stages
              </p>
            </div>
          </div>
        )}

        {/* Task Prompts Section - shown for all modes */}
        {STAGE_LABELS.find(s => s.key === activeTab)?.taskPromptLabel && (
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <label className="text-sm font-medium text-foreground">Task Prompts</label>
                <p className="text-xs text-muted-foreground">Instructions for the AI when processing this stage (used in both single and council modes)</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadRecommendedTaskPrompts}
                  disabled={loadingPrompts}
                  className="gap-2 text-blue-600 hover:text-blue-700 hover:bg-blue-500/10 border-blue-500/30"
                >
                  {loadingPrompts ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  Load Recommended
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadAllRecommendedTaskPrompts}
                  disabled={loadingPrompts}
                  className="gap-2 text-cyan-600 hover:text-cyan-700 hover:bg-cyan-500/10 border-cyan-500/30"
                >
                  {loadingPrompts ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  Load All Stages
                </Button>
              </div>
            </div>
            
            {/* Primary Task Prompt */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                {STAGE_LABELS.find(s => s.key === activeTab)?.taskPromptLabel || 'Task Prompt'}
              </label>
              <p className="text-xs text-muted-foreground">
                The main instruction prompt for this stage's AI task
              </p>
              <textarea
                className="w-full min-h-[150px] rounded-md border border-input bg-background p-3 text-sm text-foreground resize-y font-mono"
                placeholder="Enter the task prompt..."
                value={currentStageConfig?.taskPrompt || ''}
                onChange={(e) => updateStageConfig({ taskPrompt: e.target.value })}
              />
            </div>

            {/* Secondary Task Prompt (Stage 1 only - CLO Analysis) */}
            {activeTab === 'stage1' && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {STAGE_LABELS.find(s => s.key === 'stage1')?.taskPrompt2Label || 'CLO Analysis Prompt'}
                </label>
                <p className="text-xs text-muted-foreground">
                  Prompt for analyzing Course Learning Outcomes (CLOs) after extraction
                </p>
                <textarea
                  className="w-full min-h-[150px] rounded-md border border-input bg-background p-3 text-sm text-foreground resize-y font-mono"
                  placeholder="Enter the CLO analysis prompt..."
                  value={currentStageConfig?.taskPrompt2 || ''}
                  onChange={(e) => updateStageConfig({ taskPrompt2: e.target.value })}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Loading indicator */}
      {loading && !hasLoaded && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading available models...
        </div>
      )}
    </div>
  )
}
