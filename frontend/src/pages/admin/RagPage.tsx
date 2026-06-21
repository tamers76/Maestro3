import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { showToast } from '@/components/ui/Toaster'
import PromptTemplateSettings from '@/components/nodeEngine/PromptTemplateSettings'
import {
  fetchEmbeddingHealth,
  fetchReferenceCoverageConfig,
  updateReferenceCoverageConfig,
  type EmbeddingHealth,
  type ReferenceCoverageThresholds,
} from '@/services/api'
import { Loader2, Check, X, Save, RefreshCw, Activity, Network } from 'lucide-react'

const REFERENCE_COVERAGE_JUDGMENT_PROMPT_ID = 'reference_coverage_judgment_prompt'
const REFERENCE_GROUNDING_JUDGMENT_PROMPT_ID = 'reference_grounding_judgment_prompt'
const REFERENCE_SOURCE_SUGGESTION_PROMPT_ID = 'reference_source_suggestion_prompt'

export default function RagPage() {
  const [embeddingHealth, setEmbeddingHealth] = useState<EmbeddingHealth | null>(null)
  const [checking, setChecking] = useState(false)
  const [thresholds, setThresholds] = useState<ReferenceCoverageThresholds | null>(null)
  const [savingThresholds, setSavingThresholds] = useState(false)

  useEffect(() => {
    void handleCheck()
    void loadThresholds()
  }, [])

  async function handleCheck() {
    try {
      setChecking(true)
      setEmbeddingHealth(await fetchEmbeddingHealth())
    } catch (error) {
      setEmbeddingHealth({
        ok: false,
        provider: 'unknown',
        model: '',
        configuredDimensions: 0,
        liveDimensions: 0,
        providerConfigured: false,
        error: error instanceof Error ? error.message : 'Health check failed',
        checkedAt: new Date().toISOString(),
      })
    } finally {
      setChecking(false)
    }
  }

  async function loadThresholds() {
    try {
      const config = await fetchReferenceCoverageConfig()
      setThresholds(config.thresholds)
    } catch {
      /* non-fatal */
    }
  }

  async function saveThresholds() {
    if (!thresholds) return
    try {
      setSavingThresholds(true)
      const config = await updateReferenceCoverageConfig(thresholds)
      setThresholds(config.thresholds)
      showToast({ title: 'Thresholds saved', description: 'Re-run coverage to apply.', variant: 'success' })
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save thresholds',
        variant: 'destructive',
      })
    } finally {
      setSavingThresholds(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Reference & RAG</h2>
        <p className="text-caption text-muted-foreground">
          Grounding health, evidence-gate thresholds, and the coverage/grounding prompts.
        </p>
      </div>

      {/* Embedding health */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${embeddingHealth?.ok ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Reference Grounding (RAG) Health</CardTitle>
              <CardDescription>
                Live embedding-provider probe. If down, node generation falls back to model-only and is not academically
                approvable.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {embeddingHealth ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-2">
                {embeddingHealth.ok ? <Check className="h-4 w-4 text-emerald-500" /> : <X className="h-4 w-4 text-red-500" />}
                <span className="text-sm font-medium text-foreground">
                  {embeddingHealth.ok ? 'Embedding provider healthy' : 'Embedding provider unavailable'}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">
                Provider: <span className="text-foreground">{embeddingHealth.provider}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                Model: <span className="text-foreground">{embeddingHealth.model || '—'}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                Dimensions: <span className="text-foreground">{embeddingHealth.liveDimensions || embeddingHealth.configuredDimensions}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                Provider key configured: <span className="text-foreground">{embeddingHealth.providerConfigured ? 'yes' : 'no'}</span>
              </div>
              {embeddingHealth.error && (
                <div className="sm:col-span-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
                  {embeddingHealth.error}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Running embedding health probe…</p>
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={handleCheck} disabled={checking}>
              {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Re-check
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Coverage thresholds + prompts */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-500">
              <Network className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Reference cross-referencing</CardTitle>
              <CardDescription>Tune the evidence-gate thresholds and edit the coverage-judgment prompts.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="mb-1 text-sm font-semibold text-foreground">Evidence-gate thresholds</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              A CLO reaches "Well covered / Partial" only when enough on-topic passages exist across enough distinct
              sources.
            </p>
            {thresholds ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <ThresholdInput
                  label="Top-K passages"
                  hint="Passages retrieved per CLO (≥ 1)."
                  value={thresholds.topK}
                  onChange={(v) => setThresholds((p) => (p ? { ...p, topK: v } : p))}
                />
                <ThresholdInput
                  label="Relevance floor"
                  hint="Fused score a passage must clear (0–1)."
                  step="0.01"
                  min={0}
                  max={1}
                  value={thresholds.relevanceFloor}
                  onChange={(v) => setThresholds((p) => (p ? { ...p, relevanceFloor: v } : p))}
                />
                <ThresholdInput
                  label="Min passages"
                  hint="Supporting passages needed to open the gate (≥ 1)."
                  value={thresholds.minPassages}
                  onChange={(v) => setThresholds((p) => (p ? { ...p, minPassages: v } : p))}
                />
                <ThresholdInput
                  label="Distribution min"
                  hint="Distinct documents required among supporting passages (≥ 1)."
                  value={thresholds.distributionMin}
                  onChange={(v) => setThresholds((p) => (p ? { ...p, distributionMin: v } : p))}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading thresholds…</p>
            )}
            <div className="mt-3 flex justify-end">
              <Button onClick={saveThresholds} disabled={savingThresholds || !thresholds} className="gap-2">
                {savingThresholds ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save thresholds
              </Button>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <PromptTemplateSettings
              filterTemplateIds={[
                REFERENCE_COVERAGE_JUDGMENT_PROMPT_ID,
                REFERENCE_GROUNDING_JUDGMENT_PROMPT_ID,
                REFERENCE_SOURCE_SUGGESTION_PROMPT_ID,
              ]}
              hideModelSettings
              heading={{
                title: 'Coverage & grounding prompts',
                description:
                  'Coverage judgment, node-grounding judgment, and AI source-suggestion prompts. Editing any creates a new immutable version.',
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ThresholdInput(props: {
  label: string
  hint: string
  value: number
  onChange: (v: number) => void
  step?: string
  min?: number
  max?: number
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{props.label}</label>
      <Input
        type="number"
        step={props.step}
        min={props.min ?? 1}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <p className="text-xs text-muted-foreground">{props.hint}</p>
    </div>
  )
}
