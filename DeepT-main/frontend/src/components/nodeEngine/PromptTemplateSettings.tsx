import { useEffect, useMemo, useState } from 'react'
import { Loader2, Save, History, FileText, Cpu, Plus, Trash2, User, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { Input } from '@/components/ui/Input'
import { showToast } from '@/components/ui/Toaster'
import { HeyGenRenderSettingsPicker } from './HeyGenRenderSettingsPicker'
import { GlassPanel } from '@/components/ui/GlassPanel'
import {
  fetchPromptTemplates,
  updatePromptTemplate,
  fetchModalityConfigs,
  updateModalityConfig,
  fetchSettings,
  fetchAvailableModels,
  type PromptTemplate,
  type ModalityConfigEntry,
  type ModalityGenerationConfig,
  type ModalityConfigUpdate,
  type ResolvedGenerationModel,
  type VideoSettings,
  type AIModel,
  type AIProvider,
} from '@/services/api'

const VIDEO_ENGINES = ['avatar_iv', 'avatar_v'] as const
const VIDEO_RESOLUTIONS = ['4k', '1080p', '720p'] as const
const VIDEO_ASPECT_RATIOS = ['auto', '16:9', '9:16', '4:5', '5:4', '1:1'] as const
const VIDEO_OUTPUT_FORMATS = ['mp4', 'webm'] as const

const SOURCE_LABELS: Record<ResolvedGenerationModel['source'], string> = {
  global_default: 'Global default',
  modality_config: 'Modality config',
  prompt_template_override: 'Prompt template override',
}

function modelDisplayName(model: AIModel): string {
  if (model.shortName) return model.shortName
  const parts = model.id.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : model.id
}

/** Minimal model <select> populated from the SAME source StageModelTabs uses. */
function ModelSelect({
  value,
  onChange,
  models,
  hasLoaded,
  placeholder = 'Use global default…',
  showRemove = false,
  onRemove,
}: {
  value: string
  onChange: (value: string) => void
  models: AIModel[]
  hasLoaded: boolean
  placeholder?: string
  showRemove?: boolean
  onRemove?: () => void
}) {
  const sorted = useMemo(
    () => [...models].sort((a, b) => modelDisplayName(a).localeCompare(modelDisplayName(b))),
    [models]
  )
  // Keep an unknown/custom value selectable even if not in the fetched list.
  const hasValue = value && sorted.some((m) => m.id === value)
  return (
    <div className="flex gap-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={!hasLoaded}
        className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:bg-muted"
      >
        <option value="">{hasLoaded ? placeholder : 'Loading models…'}</option>
        {value && !hasValue && <option value={value}>{value} (custom)</option>}
        {sorted.map((m) => (
          <option key={m.id} value={m.id}>
            {m.isFree ? '⚡ ' : ''}
            {modelDisplayName(m)}
          </option>
        ))}
      </select>
      {showRemove && onRemove && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRemove}
          className="h-9 px-3 text-red-500 hover:text-red-600 hover:bg-red-500/10"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}

/**
 * S7 — Prompt Template Registry settings screen (M2).
 *
 * Lists the active version of every node-engine prompt template and lets an
 * editor revise the task prompt. Saving never mutates a published version — the
 * backend appends a NEW version and moves the active pointer (D3).
 */
export interface PromptTemplateSettingsProps {
  /** When set, only these template ids are shown (focused/embedded variant). */
  filterTemplateIds?: string[]
  /** Hide the per-vehicle Model & Generation Settings block (focused variant). */
  hideModelSettings?: boolean
  /** Override the section heading (focused variant). */
  heading?: { title?: string; description?: string }
}

export default function PromptTemplateSettings({
  filterTemplateIds,
  hideModelSettings = false,
  heading,
}: PromptTemplateSettingsProps = {}) {
  const focused = !!filterTemplateIds && filterTemplateIds.length > 0
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftPrompt, setDraftPrompt] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [editor, setEditor] = useState('')
  const [saving, setSaving] = useState(false)

  // Model & Generation Settings (stored INDEPENDENTLY of prompt-template versions)
  const [modalityEntries, setModalityEntries] = useState<ModalityConfigEntry[]>([])
  const [globalDefaultModel, setGlobalDefaultModel] = useState('')
  const [availableModels, setAvailableModels] = useState<AIModel[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [modelDraft, setModelDraft] = useState<ModalityGenerationConfig | null>(null)
  const [savingModel, setSavingModel] = useState(false)

  const visibleTemplates = useMemo(
    () =>
      focused
        ? templates.filter((t) => filterTemplateIds!.includes(t.prompt_template_id))
        : templates,
    [templates, focused, filterTemplateIds]
  )

  // Show the template list/switcher whenever there is more than one template to
  // choose between — including the focused (embedded) variant when it filters to
  // multiple ids (e.g. the coverage-judgment + source-suggestion prompts).
  const showList = !focused || visibleTemplates.length > 1

  const selected = useMemo(
    () => templates.find((t) => t.prompt_template_id === selectedId) ?? null,
    [templates, selectedId]
  )

  const selectedEntry = useMemo(
    () => (selected ? modalityEntries.find((e) => e.config.vehicle === selected.vehicle) ?? null : null),
    [modalityEntries, selected]
  )

  function findConfigForVehicle(entries: ModalityConfigEntry[], vehicle: string): ModalityGenerationConfig | null {
    return entries.find((e) => e.config.vehicle === vehicle)?.config ?? null
  }

  async function load() {
    setLoading(true)
    try {
      const [list, modality] = await Promise.all([fetchPromptTemplates(), fetchModalityConfigs()])
      setTemplates(list)
      setModalityEntries(modality.configs)
      setGlobalDefaultModel(modality.global_default_model)
      const initialList =
        filterTemplateIds && filterTemplateIds.length > 0
          ? list.filter((t) => filterTemplateIds.includes(t.prompt_template_id))
          : list
      if (initialList.length > 0 && !selectedId) {
        setSelectedId(initialList[0].prompt_template_id)
        setDraftPrompt(initialList[0].task_prompt)
        setModelDraft(findConfigForVehicle(modality.configs, initialList[0].vehicle))
      }
    } catch (error) {
      showToast({
        title: 'Failed to load prompt templates',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Populate model dropdowns from the SAME source StageModelTabs uses.
  useEffect(() => {
    (async () => {
      try {
        const settings = await fetchSettings()
        const provider = (settings.aiProvider ?? 'openrouter') as AIProvider
        const models = await fetchAvailableModels(provider)
        setAvailableModels(models)
      } catch (error) {
        console.error('Failed to load available models:', error)
      } finally {
        setModelsLoaded(true)
      }
    })()
  }, [])

  function selectTemplate(t: PromptTemplate) {
    setSelectedId(t.prompt_template_id)
    setDraftPrompt(t.task_prompt)
    setChangeNote('')
    setModelDraft(findConfigForVehicle(modalityEntries, t.vehicle))
  }

  function patchModelDraft(patch: Partial<ModalityGenerationConfig>) {
    setModelDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  function patchVideoSettings(patch: Partial<VideoSettings>) {
    setModelDraft((prev) =>
      prev ? { ...prev, videoSettings: { ...(prev.videoSettings ?? { provider: 'heygen' }), ...patch } } : prev
    )
  }

  function patchVoiceSettings(patch: Partial<NonNullable<VideoSettings['voice_settings']>>) {
    setModelDraft((prev) => {
      if (!prev) return prev
      const vs = prev.videoSettings ?? { provider: 'heygen' as const }
      return { ...prev, videoSettings: { ...vs, voice_settings: { ...(vs.voice_settings ?? {}), ...patch } } }
    })
  }

  async function handleSaveModelConfig() {
    if (!selected || !modelDraft) return
    setSavingModel(true)
    try {
      const payload: ModalityConfigUpdate = {
        mode: modelDraft.mode,
        singleModel: modelDraft.singleModel ?? '',
        councilModels: modelDraft.councilModels ?? [],
        chairmanModel: modelDraft.chairmanModel ?? '',
        defaultTemperature: modelDraft.defaultTemperature,
        defaultMaxTokens: modelDraft.defaultMaxTokens,
        modelSelectionReason: modelDraft.modelSelectionReason ?? '',
        productionTarget: modelDraft.productionTarget ?? '',
        enabled: modelDraft.enabled,
      }
      if (modelDraft.videoSettings) {
        payload.videoSettings = modelDraft.videoSettings
      }
      const { config, resolved } = await updateModalityConfig(selected.vehicle, payload)
      setModalityEntries((prev) =>
        prev.map((e) => (e.config.vehicle === config.vehicle ? { config, resolved } : e))
      )
      setModelDraft(config)
      showToast({
        title: 'Model settings saved',
        description: `${selected.vehicle} now resolves to "${resolved.model}" (${SOURCE_LABELS[resolved.source]}). Prompt version unchanged.`,
        variant: 'success',
      })
    } catch (error) {
      showToast({
        title: 'Failed to save model settings',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setSavingModel(false)
    }
  }

  const isReserved = selected?.status === 'reserved'
  const isDirty = selected ? draftPrompt !== selected.task_prompt : false

  async function handleSave() {
    if (!selected) return
    if (!editor.trim()) {
      showToast({ title: 'Editor name required', description: 'Enter who is making this change.', variant: 'destructive' })
      return
    }
    if (!changeNote.trim()) {
      showToast({ title: 'Change note required', description: 'Describe what changed and why.', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const { template } = await updatePromptTemplate(selected.prompt_template_id, {
        task_prompt: draftPrompt,
        last_updated_by: editor.trim(),
        change_note: changeNote.trim(),
      })
      showToast({
        title: 'New version saved',
        description: `${template.prompt_template_name} is now at version ${template.version}.`,
        variant: 'success',
      })
      setChangeNote('')
      await load()
    } catch (error) {
      showToast({
        title: 'Failed to save template',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading prompt templates...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FileText className="h-5 w-5" />
          {heading?.title ?? 'Prompt Template Registry'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {heading?.description ??
            'One template per production vehicle (Build Spec §8.14). Editing a template creates a new immutable version and moves the active pointer — published versions are never overwritten.'}
        </p>
      </div>

      <div className={showList ? 'grid grid-cols-1 md:grid-cols-3 lg:grid-cols-12 gap-4' : 'grid grid-cols-1 gap-4'}>
        {/* Template list — shown whenever there is more than one template (incl.
            the focused variant filtered to multiple ids). */}
        {showList && (
        <Card className={showList ? 'md:col-span-1 lg:col-span-3' : ''}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Templates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {visibleTemplates.map((t) => (
              <button
                key={t.prompt_template_id}
                type="button"
                onClick={() => selectTemplate(t)}
                className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                  t.prompt_template_id === selectedId
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <div className="font-medium">{t.prompt_template_name}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <span className="font-mono">{t.vehicle}</span>
                  <span>· v{t.version}</span>
                  <span
                    className={
                      t.status === 'approved'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : t.status === 'reserved'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-muted-foreground'
                    }
                  >
                    {t.status}
                  </span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
        )}

        {/* Editor */}
        <Card className={showList ? 'md:col-span-2 lg:col-span-9' : ''}>
          {selected ? (
            <>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{selected.prompt_template_name}</span>
                  <span className="text-xs font-normal text-muted-foreground flex items-center gap-1">
                    <History className="h-3.5 w-3.5" />
                    active v{selected.version}
                  </span>
                </CardTitle>
                <CardDescription>
                  Vehicle <span className="font-mono">{selected.vehicle}</span> · generator{' '}
                  <span className="font-mono">{selected.generator_kind}</span>
                  {isReserved && ' · reserved/deferred (not editable in V1)'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Task prompt</label>
                  <Textarea
                    value={draftPrompt}
                    onChange={(e) => setDraftPrompt(e.target.value)}
                    rows={16}
                    disabled={isReserved}
                    className="font-mono text-xs mt-1"
                    placeholder={isReserved ? 'Reserved vehicle — no prompt body in V1.' : ''}
                  />
                </div>
                {!isReserved && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Edited by</label>
                      <Input
                        value={editor}
                        onChange={(e) => setEditor(e.target.value)}
                        placeholder="Your name"
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Change note</label>
                      <Input
                        value={changeNote}
                        onChange={(e) => setChangeNote(e.target.value)}
                        placeholder="What changed and why"
                        className="mt-1"
                      />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-muted-foreground">
                    Last updated by {selected.last_updated_by || 'system'} ·{' '}
                    {new Date(selected.last_updated_at).toLocaleString()}
                  </p>
                  {!isReserved && (
                    <Button onClick={handleSave} disabled={saving || !isDirty} className="gap-2">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save as new version
                    </Button>
                  )}
                </div>

                {/* Model & Generation Settings — saved SEPARATELY from the prompt body. */}
                {!hideModelSettings && modelDraft && (
                  <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3 mt-2">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold">Model &amp; Generation Settings</h3>
                    </div>
                    <p className="text-xs text-muted-foreground -mt-1">
                      Stored independently from the prompt body. Saving here{' '}
                      <span className="font-medium">does NOT create a new prompt-template version</span> — use{' '}
                      <span className="font-mono">Save as new version</span> above for prompt edits.
                    </p>

                    {/* Resolved model + source */}
                    {selectedEntry && (
                      <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs">
                        <span className="text-muted-foreground">Resolves to </span>
                        <span className="font-mono font-medium">{selectedEntry.resolved.model}</span>
                        <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          {SOURCE_LABELS[selectedEntry.resolved.source]}
                        </span>
                        <span className="ml-2 text-muted-foreground">
                          (global default: <span className="font-mono">{globalDefaultModel}</span>)
                        </span>
                      </div>
                    )}

                    {/* Mode toggle */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Generation mode</label>
                      <div className="flex rounded-lg border border-border overflow-hidden w-fit">
                        <button
                          type="button"
                          onClick={() => patchModelDraft({ mode: 'single' })}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                            modelDraft.mode === 'single' ? 'bg-blue-500 text-white' : 'bg-background text-muted-foreground hover:bg-muted/50'
                          }`}
                        >
                          <User className="h-3.5 w-3.5" /> Single
                        </button>
                        <button
                          type="button"
                          onClick={() => patchModelDraft({ mode: 'council' })}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${
                            modelDraft.mode === 'council' ? 'bg-amber-500 text-white' : 'bg-background text-muted-foreground hover:bg-muted/50'
                          }`}
                        >
                          <Users className="h-3.5 w-3.5" /> Council
                        </button>
                      </div>
                    </div>

                    {modelDraft.mode === 'single' ? (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Single model</label>
                        <ModelSelect
                          value={modelDraft.singleModel ?? ''}
                          onChange={(v) => patchModelDraft({ singleModel: v })}
                          models={availableModels}
                          hasLoaded={modelsLoaded}
                          placeholder="Use global default…"
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Council members</label>
                          <div className="space-y-2">
                            {(modelDraft.councilModels ?? []).map((m, i) => (
                              <ModelSelect
                                key={i}
                                value={m}
                                onChange={(v) => {
                                  const next = [...(modelDraft.councilModels ?? [])]
                                  next[i] = v
                                  patchModelDraft({ councilModels: next })
                                }}
                                models={availableModels}
                                hasLoaded={modelsLoaded}
                                placeholder="Select a council member…"
                                showRemove
                                onRemove={() =>
                                  patchModelDraft({
                                    councilModels: (modelDraft.councilModels ?? []).filter((_, j) => j !== i),
                                  })
                                }
                              />
                            ))}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 mt-1"
                            onClick={() => patchModelDraft({ councilModels: [...(modelDraft.councilModels ?? []), ''] })}
                          >
                            <Plus className="h-3.5 w-3.5" /> Add member
                          </Button>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Chairman model</label>
                          <ModelSelect
                            value={modelDraft.chairmanModel ?? ''}
                            onChange={(v) => patchModelDraft({ chairmanModel: v })}
                            models={availableModels}
                            hasLoaded={modelsLoaded}
                            placeholder="Use global default…"
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Temperature</label>
                        <Input
                          type="number"
                          step="0.1"
                          value={modelDraft.defaultTemperature ?? ''}
                          onChange={(e) =>
                            patchModelDraft({
                              defaultTemperature: e.target.value === '' ? undefined : Number(e.target.value),
                            })
                          }
                          placeholder="(unset)"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Max tokens</label>
                        <Input
                          type="number"
                          value={modelDraft.defaultMaxTokens ?? ''}
                          onChange={(e) =>
                            patchModelDraft({
                              defaultMaxTokens: e.target.value === '' ? undefined : Number(e.target.value),
                            })
                          }
                          placeholder="(unset)"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Model selection reason</label>
                      <Textarea
                        value={modelDraft.modelSelectionReason ?? ''}
                        onChange={(e) => patchModelDraft({ modelSelectionReason: e.target.value })}
                        rows={2}
                        className="text-xs"
                        placeholder="Why this model was chosen for this vehicle (auditable)."
                      />
                    </div>

                    {/* Video Render Settings — only for the `video` vehicle. */}
                    {selected.vehicle === 'video' && (
                      <div className="space-y-4">
                        <HeyGenRenderSettingsPicker
                          videoSettings={modelDraft.videoSettings}
                          onPatch={patchVideoSettings}
                        />

                        <GlassPanel>
                          <div className="space-y-3">
                            <h5 className="text-xs font-semibold text-foreground">Output & delivery</h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Engine</label>
                            <select
                              value={modelDraft.videoSettings?.engine ?? ''}
                              onChange={(e) => patchVideoSettings({ engine: (e.target.value || undefined) as VideoSettings['engine'] })}
                              className="w-full h-9 rounded-md border border-black/10 dark:border-white/10 bg-background/50 px-3 text-sm"
                            >
                              <option value="">(default avatar_iv)</option>
                              {VIDEO_ENGINES.map((v) => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Resolution</label>
                            <select
                              value={modelDraft.videoSettings?.resolution ?? ''}
                              onChange={(e) => patchVideoSettings({ resolution: (e.target.value || undefined) as VideoSettings['resolution'] })}
                              className="w-full h-9 rounded-md border border-black/10 dark:border-white/10 bg-background/50 px-3 text-sm"
                            >
                              <option value="">(default 1080p)</option>
                              {VIDEO_RESOLUTIONS.map((v) => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Aspect ratio</label>
                            <select
                              value={modelDraft.videoSettings?.aspect_ratio ?? ''}
                              onChange={(e) => patchVideoSettings({ aspect_ratio: (e.target.value || undefined) as VideoSettings['aspect_ratio'] })}
                              className="w-full h-9 rounded-md border border-black/10 dark:border-white/10 bg-background/50 px-3 text-sm"
                            >
                              <option value="">(default auto)</option>
                              {VIDEO_ASPECT_RATIOS.map((v) => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Output format</label>
                            <select
                              value={modelDraft.videoSettings?.output_format ?? ''}
                              onChange={(e) => patchVideoSettings({ output_format: (e.target.value || undefined) as VideoSettings['output_format'] })}
                              className="w-full h-9 rounded-md border border-black/10 dark:border-white/10 bg-background/50 px-3 text-sm"
                            >
                              <option value="">(default mp4)</option>
                              {VIDEO_OUTPUT_FORMATS.map((v) => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Motion prompt</label>
                          <Input
                            value={modelDraft.videoSettings?.motion_prompt ?? ''}
                            onChange={(e) => patchVideoSettings({ motion_prompt: e.target.value })}
                            placeholder="Natural-language body/gesture control"
                            className="bg-background/50 border-black/10 dark:border-white/10"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Voice speed</label>
                            <Input
                              type="number"
                              step="0.1"
                              value={modelDraft.videoSettings?.voice_settings?.speed ?? ''}
                              onChange={(e) =>
                                patchVoiceSettings({ speed: e.target.value === '' ? undefined : Number(e.target.value) })
                              }
                              placeholder="(unset)"
                              className="bg-background/50 border-black/10 dark:border-white/10"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Voice pitch</label>
                            <Input
                              type="number"
                              step="0.1"
                              value={modelDraft.videoSettings?.voice_settings?.pitch ?? ''}
                              onChange={(e) =>
                                patchVoiceSettings({ pitch: e.target.value === '' ? undefined : Number(e.target.value) })
                              }
                              placeholder="(unset)"
                              className="bg-background/50 border-black/10 dark:border-white/10"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Voice locale</label>
                            <Input
                              value={modelDraft.videoSettings?.voice_settings?.locale ?? ''}
                              onChange={(e) => patchVoiceSettings({ locale: e.target.value || undefined })}
                              placeholder="e.g. en-US"
                              className="bg-background/50 border-black/10 dark:border-white/10"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Callback URL</label>
                            <Input
                              value={modelDraft.videoSettings?.callback_url ?? ''}
                              onChange={(e) => patchVideoSettings({ callback_url: e.target.value || undefined })}
                              placeholder="Webhook on completion"
                              className="bg-background/50 border-black/10 dark:border-white/10"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">API key ref (name only)</label>
                            <Input
                              value={modelDraft.videoSettings?.apiKeyRef ?? ''}
                              onChange={(e) => patchVideoSettings({ apiKeyRef: e.target.value || undefined })}
                              placeholder="e.g. HEYGEN_API_KEY"
                              className="bg-background/50 border-black/10 dark:border-white/10"
                            />
                          </div>
                        </div>

                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={modelDraft.videoSettings?.remove_background ?? false}
                            onChange={(e) => patchVideoSettings({ remove_background: e.target.checked })}
                          />
                          Remove background
                        </label>
                          </div>
                        </GlassPanel>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={modelDraft.enabled}
                          onChange={(e) => patchModelDraft({ enabled: e.target.checked })}
                        />
                        Enabled
                      </label>
                      <Button onClick={handleSaveModelConfig} disabled={savingModel} variant="secondary" className="gap-2">
                        {savingModel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
                        Save model settings
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </>
          ) : (
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              Select a template to view or edit.
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  )
}
