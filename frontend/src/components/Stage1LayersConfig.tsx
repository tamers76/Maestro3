import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { showToast } from '@/components/ui/Toaster'
import {
  fetchAvailableModels,
  fetchRecommendedPrompts,
  type Stage1LayerConfig,
  type AIProvider,
  type AIModel,
} from '@/services/api'
import { ChevronDown, ChevronRight, User, Users, Plus, Trash2, RefreshCw, Loader2, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Decision-button styles shared with the Course Architect / Node Engine layers:
 * light tint at rest, solid on hover/selection. primary = blue, approve = emerald,
 * neutral/regenerate = slate, edit = amber, destructive = red.
 */
const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[12px] border px-3 py-1.5 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const PRIMARY_BTN = `${BTN_BASE} border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-600 hover:text-white hover:border-transparent focus-visible:ring-blue-500/40`
const REGEN_BTN = `${BTN_BASE} border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300 hover:bg-slate-600 hover:text-white hover:border-transparent focus-visible:ring-slate-400/40`
const EDIT_BTN = `${BTN_BASE} border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500 hover:text-white hover:border-transparent focus-visible:ring-amber-500/40`
const TOGGLE_ON = `${BTN_BASE} border-transparent bg-blue-600 text-white shadow-sm focus-visible:ring-blue-500/40`
const TOGGLE_OFF = `${BTN_BASE} border-border bg-background text-muted-foreground hover:bg-muted`
const REMOVE_BTN =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] border border-red-500/30 bg-red-500/10 text-red-600 transition-colors hover:bg-red-500 hover:text-white hover:border-transparent'
const CARD_SURFACE = 'rounded-[6px] border border-border/50 bg-card'

// The intake layer whose config is the single source of truth for course intake
// (extraction + CLO analysis). It gets the richer model + CLO-analysis controls.
const INTAKE_LAYER_ID = 'layer1-intake'

interface Stage1LayersConfigProps {
  layers: Stage1LayerConfig[]
  onChange: (layers: Stage1LayerConfig[]) => void
  provider: AIProvider
}

function getModelDisplayName(model: AIModel): string {
  if (model.shortName) return model.shortName
  const parts = model.id.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : model.id
}

interface ModelSelectProps {
  value: string
  onChange: (value: string) => void
  models: AIModel[]
  hasLoaded: boolean
  placeholder?: string
  showRemove?: boolean
  onRemove?: () => void
}

/** A single model dropdown backed by fetchAvailableModels, preserving the current
 *  value even when it is not present in the fetched list. */
function ModelSelect({
  value,
  onChange,
  models,
  hasLoaded,
  placeholder = 'Select a model...',
  showRemove = false,
  onRemove,
}: ModelSelectProps) {
  const options = useMemo(() => {
    const sorted = [...models].sort((a, b) =>
      getModelDisplayName(a).localeCompare(getModelDisplayName(b))
    )
    // Ensure the currently-selected value is always selectable, even if the model
    // list has not loaded or no longer contains it.
    if (value && !sorted.some((m) => m.id === value)) {
      return [{ id: value, label: value }, ...sorted.map((m) => ({ id: m.id, label: getModelDisplayName(m) }))]
    }
    return sorted.map((m) => ({ id: m.id, label: getModelDisplayName(m) }))
  }, [models, value])

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'w-full h-10 appearance-none rounded-[4px] border border-input bg-background pl-3 pr-10 py-2 text-sm text-foreground',
            'hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent cursor-pointer',
            !value && 'text-muted-foreground'
          )}
        >
          <option value="">{!hasLoaded ? 'Loading models…' : placeholder}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      </div>
      {showRemove && onRemove && (
        <button type="button" onClick={onRemove} className={REMOVE_BTN} aria-label="Remove model">
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

export default function Stage1LayersConfig({ layers, onChange, provider }: Stage1LayersConfigProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [models, setModels] = useState<AIModel[]>([])
  const [hasLoaded, setHasLoaded] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [loadingPrompts, setLoadingPrompts] = useState(false)

  const sorted = [...layers].sort((a, b) => a.order - b.order)

  async function loadModels(notify = false) {
    try {
      setLoadingModels(true)
      const data = await fetchAvailableModels(provider)
      setModels(data)
      setHasLoaded(true)
      if (notify) {
        showToast({ title: 'Models Refreshed', description: `Found ${data.length} models`, variant: 'success' })
      }
    } catch (error) {
      setHasLoaded(true)
      if (notify) {
        showToast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to load models',
          variant: 'destructive',
        })
      }
    } finally {
      setLoadingModels(false)
    }
  }

  // Auto-load models on mount and whenever the provider changes.
  useEffect(() => {
    setHasLoaded(false)
    loadModels(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  function updateLayer(id: string, patch: Partial<Stage1LayerConfig>) {
    onChange(layers.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  // Load the recommended Stage 1 intake prompts (extraction + CLO analysis) from the
  // backend and apply them to the intake layer. Reuses the same recommended values
  // surfaced everywhere else (getRecommendedPrompts().stages.stage1).
  async function loadRecommendedIntakePrompts(layerId: string) {
    try {
      setLoadingPrompts(true)
      const prompts = await fetchRecommendedPrompts()
      const stage1 = prompts.stages.stage1
      const patch: Partial<Stage1LayerConfig> = {}
      if (stage1?.taskPrompt) patch.taskPrompt = stage1.taskPrompt
      if (stage1?.taskPrompt2) patch.taskPrompt2 = stage1.taskPrompt2
      if (Object.keys(patch).length > 0) {
        updateLayer(layerId, patch)
        showToast({
          title: 'Recommended Intake Prompts Loaded',
          description: 'Loaded the Extraction and CLO Analysis prompts',
          variant: 'success',
        })
      }
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load recommended prompts',
        variant: 'destructive',
      })
    } finally {
      setLoadingPrompts(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Models are loaded from your active provider ({provider}).
        </p>
        <button type="button" onClick={() => loadModels(true)} disabled={loadingModels} className={REGEN_BTN}>
          {loadingModels ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh Models
        </button>
      </div>

      {sorted.map((layer) => {
        const open = expandedId === layer.id
        const isIntake = layer.id === INTAKE_LAYER_ID
        return (
          <div key={layer.id} className={CARD_SURFACE}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 p-4 text-left hover:bg-muted/50"
              onClick={() => setExpandedId(open ? null : layer.id)}
            >
              <div>
                <p className="font-medium text-foreground">
                  {layer.order}. {layer.name}
                </p>
                <p className="text-sm text-muted-foreground">{layer.productOutput}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                    layer.mode === 'council'
                      ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {layer.mode === 'council' ? 'LLM Council' : 'Single Agent'}
                </span>
                {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </div>
            </button>

            {open && (
              <div className="space-y-4 border-t border-border/50 p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Layer name</label>
                    <Input
                      value={layer.name}
                      onChange={(e) => updateLayer(layer.id, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Product output</label>
                    <Input
                      value={layer.productOutput}
                      onChange={(e) => updateLayer(layer.id, { productOutput: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={layer.description}
                    onChange={(e) => updateLayer(layer.id, { description: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Output fields (comma-separated)</label>
                  <Input
                    value={layer.outputFields.join(', ')}
                    onChange={(e) =>
                      updateLayer(layer.id, {
                        outputFields: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      })
                    }
                  />
                </div>

                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={layer.approvalRequired}
                      onChange={(e) => updateLayer(layer.id, { approvalRequired: e.target.checked })}
                    />
                    SME approval required
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={layer.regenerateEnabled}
                      onChange={(e) => updateLayer(layer.id, { regenerateEnabled: e.target.checked })}
                    />
                    Regenerate enabled
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={layer.editEnabled}
                      onChange={(e) => updateLayer(layer.id, { editEnabled: e.target.checked })}
                    />
                    Manual SME edit
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={layer.lockNextUntilApproval}
                      onChange={(e) => updateLayer(layer.id, { lockNextUntilApproval: e.target.checked })}
                    />
                    Lock next until approval
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => updateLayer(layer.id, { mode: 'single' })}
                    className={layer.mode === 'single' ? TOGGLE_ON : TOGGLE_OFF}
                  >
                    <User className="h-4 w-4" /> Single Agent
                  </button>
                  <button
                    type="button"
                    onClick={() => updateLayer(layer.id, { mode: 'council' })}
                    className={layer.mode === 'council' ? TOGGLE_ON : TOGGLE_OFF}
                  >
                    <Users className="h-4 w-4" /> LLM Council
                  </button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Single model</label>
                    <ModelSelect
                      value={layer.singleModel}
                      onChange={(value) => updateLayer(layer.id, { singleModel: value })}
                      models={models}
                      hasLoaded={hasLoaded}
                      placeholder="Select a model…"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Chairman model</label>
                    <ModelSelect
                      value={layer.chairmanModel}
                      onChange={(value) => updateLayer(layer.id, { chairmanModel: value })}
                      models={models}
                      hasLoaded={hasLoaded}
                      placeholder="Select chairman model…"
                    />
                  </div>
                </div>

                {layer.mode === 'council' && (
                  <div className="space-y-3">
                    <label className="text-sm font-medium">Council members</label>
                    <p className="text-xs text-muted-foreground">
                      Add multiple models to deliberate together; the chairman synthesizes the final output.
                    </p>
                    <div className="space-y-3">
                      {(layer.councilModels || []).map((model, index) => (
                        <ModelSelect
                          key={index}
                          value={model}
                          onChange={(value) => {
                            const next = [...layer.councilModels]
                            next[index] = value
                            updateLayer(layer.id, { councilModels: next })
                          }}
                          models={models}
                          hasLoaded={hasLoaded}
                          placeholder="Select a council member…"
                          showRemove
                          onRemove={() =>
                            updateLayer(layer.id, {
                              councilModels: layer.councilModels.filter((_, i) => i !== index),
                            })
                          }
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => updateLayer(layer.id, { councilModels: [...layer.councilModels, ''] })}
                      className={PRIMARY_BTN}
                    >
                      <Plus className="h-4 w-4" /> Add Member
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <label className="text-sm font-medium">
                      {isIntake ? 'Extraction prompt' : 'Task prompt'}
                    </label>
                    {isIntake && (
                      <button
                        type="button"
                        onClick={() => loadRecommendedIntakePrompts(layer.id)}
                        disabled={loadingPrompts}
                        className={EDIT_BTN}
                      >
                        {loadingPrompts ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                        Load Recommended
                      </button>
                    )}
                  </div>
                  <Textarea
                    value={layer.taskPrompt || ''}
                    onChange={(e) => updateLayer(layer.id, { taskPrompt: e.target.value })}
                    rows={6}
                    className="font-mono text-xs"
                  />
                </div>

                {isIntake && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">CLO Analysis prompt</label>
                    <p className="text-xs text-muted-foreground">
                      Prompt for analyzing Course Learning Outcomes after extraction.
                    </p>
                    <Textarea
                      value={layer.taskPrompt2 || ''}
                      onChange={(e) => updateLayer(layer.id, { taskPrompt2: e.target.value })}
                      rows={6}
                      className="font-mono text-xs"
                    />
                  </div>
                )}

                {layer.mode === 'council' && (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Council member prompt</label>
                      <Textarea
                        value={layer.memberSystemPrompt || ''}
                        onChange={(e) => updateLayer(layer.id, { memberSystemPrompt: e.target.value })}
                        rows={5}
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Chairman prompt</label>
                      <Textarea
                        value={layer.chairmanSystemPrompt || ''}
                        onChange={(e) => updateLayer(layer.id, { chairmanSystemPrompt: e.target.value })}
                        rows={5}
                        className="font-mono text-xs"
                      />
                    </div>
                  </>
                )}

                <p className={cn('text-xs text-muted-foreground')}>
                  Provider: {provider} · Parent stage: {layer.parentStage} · Order: {layer.order}
                </p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
