import { useState, useMemo, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { fetchAvailableModels, type AIModel, type AIProvider } from '@/services/api'
import { showToast } from '@/components/ui/Toaster'
import { 
  Loader2, 
  Sparkles, 
  DollarSign,
  RefreshCw,
  ChevronDown
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Use AIModel type (aliased as OpenRouterModel for backward compatibility)
type OpenRouterModel = AIModel

interface ModelSelectorProps {
  value: string
  onChange: (value: string) => void
  label: string
  models: OpenRouterModel[]
  freeOnly: boolean
  selectedProvider: string
}

// Helper to get a display name for a model
function getModelDisplayName(model: OpenRouterModel): string {
  // Use shortName if available, otherwise extract from id
  if (model.shortName) return model.shortName
  // Extract model name from id (e.g., "openai/gpt-4" -> "gpt-4")
  const parts = model.id.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : model.id
}

function ModelDropdown({ value, onChange, label, models, freeOnly, selectedProvider }: ModelSelectorProps) {
  // Filter models based on free filter and provider
  const filteredModels = useMemo(() => {
    let filtered = models
    if (freeOnly) {
      filtered = filtered.filter(m => m.isFree)
    }
    if (selectedProvider) {
      filtered = filtered.filter(m => m.provider === selectedProvider)
    }
    // Sort by display name within the filtered list
    return [...filtered].sort((a, b) => {
      const nameA = getModelDisplayName(a)
      const nameB = getModelDisplayName(b)
      return nameA.localeCompare(nameB)
    })
  }, [models, freeOnly, selectedProvider])

  const selectedModel = models.find(m => m.id === value)

  // Format context length for display
  const formatContext = (length: number) => {
    if (length >= 1000000) return `${(length / 1000000).toFixed(1)}M`
    if (length >= 1000) return `${Math.round(length / 1000)}K`
    return `${length}`
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'w-full h-10 appearance-none rounded-md border border-input bg-background pl-3 pr-10 py-2 text-sm text-foreground',
            'hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent',
            'cursor-pointer',
            !value && 'text-muted-foreground'
          )}
        >
          <option value="">Select a model...</option>
          {filteredModels.map(model => (
            <option key={model.id} value={model.id}>
              {model.isFree ? '⚡ ' : ''}{getModelDisplayName(model)} ({formatContext(model.contextLength)})
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      </div>
      {selectedModel && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{selectedModel.name || selectedModel.id}</span>
          {selectedModel.isFree && <span className="text-emerald-500 font-medium"> • Free</span>}
          <span> • {formatContext(selectedModel.contextLength)} context</span>
        </p>
      )}
    </div>
  )
}

interface ModelSelectorPanelProps {
  models: {
    stage1: string
    stage2: string
    stage3: string
    stage4: string
  }
  onChange: (stage: 'stage1' | 'stage2' | 'stage3' | 'stage4', value: string) => void
  provider?: AIProvider
}

export default function ModelSelectorPanel({ models, onChange, provider = 'openrouter' }: ModelSelectorPanelProps) {
  const [availableModels, setAvailableModels] = useState<OpenRouterModel[]>([])
  const [loading, setLoading] = useState(false)
  const [freeOnly, setFreeOnly] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState('')
  const [currentAIProvider, setCurrentAIProvider] = useState<AIProvider>(provider)
  
  // Reset when AI provider changes
  useEffect(() => {
    if (provider !== currentAIProvider) {
      setCurrentAIProvider(provider)
      setAvailableModels([])
      setHasLoaded(false)
      setSelectedProvider('')
    }
  }, [provider, currentAIProvider])

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
      
      const providerLabel = provider === 'ollama' ? 'Ollama' : 'OpenRouter'
      showToast({
        title: 'Models Loaded',
        description: `Found ${data.length} ${providerLabel} models`,
        variant: 'success',
      })
    } catch (error) {
      const providerLabel = provider === 'ollama' ? 'Ollama' : 'OpenRouter'
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : `Failed to load ${providerLabel} models`,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  // Filter models for "feeling lucky"
  const luckyModels = useMemo(() => {
    let candidates = availableModels
    if (freeOnly) {
      candidates = candidates.filter(m => m.isFree)
    }
    if (selectedProvider) {
      candidates = candidates.filter(m => m.provider === selectedProvider)
    }
    // Filter to only text models with reasonable context
    return candidates.filter(m => m.contextLength >= 4000)
  }, [availableModels, freeOnly, selectedProvider])

  function handleFeelingLucky() {
    if (luckyModels.length === 0) {
      showToast({
        title: 'No models available',
        description: 'Load models first or adjust your filters',
        variant: 'destructive',
      })
      return
    }

    // Pick a random model for each stage
    const randomPick = () => luckyModels[Math.floor(Math.random() * luckyModels.length)]
    
    onChange('stage1', randomPick().id)
    onChange('stage2', randomPick().id)
    onChange('stage3', randomPick().id)
    onChange('stage4', randomPick().id)

    showToast({
      title: 'Feeling Lucky!',
      description: 'Random models selected for all stages',
      variant: 'success',
    })
  }

  const stageLabels = [
    { key: 'stage1' as const, label: 'Stage 1 - Extraction & Contract' },
    { key: 'stage2' as const, label: 'Stage 2 - Node Decomposition' },
    { key: 'stage3' as const, label: 'Stage 3 - Adaptive Logic' },
    { key: 'stage4' as const, label: 'Stage 4 - Content Generation' },
  ]

  const freeModelCount = availableModels.filter(m => m.isFree).length
  const filteredModelCount = useMemo(() => {
    let count = availableModels.length
    if (freeOnly) count = availableModels.filter(m => m.isFree).length
    if (selectedProvider) {
      const providerModels = availableModels.filter(m => m.provider === selectedProvider)
      count = freeOnly ? providerModels.filter(m => m.isFree).length : providerModels.length
    }
    return count
  }, [availableModels, freeOnly, selectedProvider])

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
          {hasLoaded ? 'Refresh Models' : 'Load Models'}
        </Button>

        {/* Only show Free Only filter for OpenRouter - all Ollama models are free */}
        {provider === 'openrouter' && (
          <Button
            variant={freeOnly ? 'default' : 'outline'}
            onClick={() => setFreeOnly(!freeOnly)}
            className={cn(
              'gap-2',
              freeOnly && 'bg-emerald-600 hover:bg-emerald-700'
            )}
            disabled={!hasLoaded}
          >
            <DollarSign className="h-4 w-4" />
            Free Only
            {hasLoaded && (
              <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">
                {freeModelCount}
              </span>
            )}
          </Button>
        )}

        <Button
          variant="outline"
          onClick={handleFeelingLucky}
          disabled={!hasLoaded || luckyModels.length === 0}
          className="gap-2 border-amber-300 dark:border-amber-500/50 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10 text-amber-700 dark:text-amber-400 hover:from-amber-100 hover:to-orange-100 dark:hover:from-amber-500/20 dark:hover:to-orange-500/20"
        >
          <Sparkles className="h-4 w-4" />
          I'm Feeling Lucky
        </Button>
      </div>

      {/* Provider Filter */}
      {hasLoaded && (
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
              {providers.map(provider => (
                <option key={provider.name} value={provider.name}>
                  {provider.name.charAt(0).toUpperCase() + provider.name.slice(1)} — {provider.total} models{provider.free > 0 ? ` (${provider.free} free)` : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      )}

      {/* Stats bar */}
      {hasLoaded && (
        <div className="rounded-lg bg-muted/50 px-4 py-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{filteredModelCount}</span> models shown
          {selectedProvider && (
            <span className="ml-1">from <span className="font-medium text-foreground">{selectedProvider}</span></span>
          )}
          {freeOnly && <span className="ml-1 text-emerald-500">(free only)</span>}
          <span className="opacity-60 ml-2">• {availableModels.length} total from {providers.length} providers</span>
        </div>
      )}

      {/* Model selection grid */}
      {!hasLoaded ? (
        <div className="rounded-lg border-2 border-dashed border-border p-8 text-center">
          <RefreshCw className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            Click "Load Models" to fetch available models from {provider === 'ollama' ? 'Ollama' : 'OpenRouter'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            {provider === 'ollama' 
              ? 'Make sure Ollama is running on your machine'
              : 'You can still type model IDs manually below'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {stageLabels.map(({ key, label }) => (
            <ModelDropdown
              key={key}
              value={models[key]}
              onChange={(value) => onChange(key, value)}
              label={label}
              models={availableModels}
              freeOnly={freeOnly}
              selectedProvider={selectedProvider}
            />
          ))}
        </div>
      )}

      {/* Manual input fallback */}
      {hasLoaded && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            <span className="ml-1">Or enter model names manually</span>
          </summary>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {stageLabels.map(({ key, label }) => (
              <div key={key} className="space-y-1">
                <label className="text-xs text-muted-foreground">{label}</label>
                <Input
                  placeholder={provider === 'ollama' ? 'e.g., llama3.2' : 'e.g., anthropic/claude-sonnet-4'}
                  value={models[key]}
                  onChange={e => onChange(key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </details>
      )}

      {/* If not loaded, show manual inputs as primary */}
      {!hasLoaded && (
        <div className="grid gap-4 md:grid-cols-2">
          {stageLabels.map(({ key, label }) => (
            <div key={key} className="space-y-2">
              <label className="text-sm font-medium text-foreground">{label}</label>
              <Input
                placeholder={provider === 'ollama' ? 'llama3.2' : 'anthropic/claude-sonnet-4'}
                value={models[key]}
                onChange={e => onChange(key, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {provider === 'ollama'
          ? 'Use Ollama model names like "llama3.2", "mistral", or "codellama"'
          : 'Use OpenRouter model identifiers like "anthropic/claude-sonnet-4" or "openai/gpt-4o"'}
      </p>
    </div>
  )
}
