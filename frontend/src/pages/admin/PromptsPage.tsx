import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import StageModelTabs from '@/components/StageModelTabs'
import Stage1LayersConfig from '@/components/Stage1LayersConfig'
import PromptTemplateSettings from '@/components/nodeEngine/PromptTemplateSettings'
import { LEGACY_STAGES_ENABLED } from '@/config/featureFlags'
import { useAdminSettings } from './adminSettingsContext'
import { Loader2, Save, Layers, Sparkles, Users } from 'lucide-react'

export default function PromptsPage() {
  const { settings, setSettings, save, saving, loading } = useAdminSettings()

  if (loading || !settings) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Prompts</h2>
        <p className="text-caption text-muted-foreground">
          Course Architect layers and versioned node-engine prompt templates.
        </p>
      </div>

      {/* Course Architect (Stage 1 layers) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Course Architect</CardTitle>
              <CardDescription>
                Configure each Course Architect layer: prompts, execution mode, council, and SME workflow
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Stage1LayersConfig
            layers={settings.stage1Layers ?? []}
            onChange={(stage1Layers) => setSettings((prev) => (prev ? { ...prev, stage1Layers } : prev))}
            provider={settings.aiProvider}
          />
        </CardContent>
      </Card>

      {/* Node engine prompt templates (self-saving editor) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Node Engine — Prompt Templates</CardTitle>
              <CardDescription>Versioned prompt templates for each production vehicle (Build Spec §8.14)</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <PromptTemplateSettings />
        </CardContent>
      </Card>

      {/* Legacy stage pipeline (only when enabled) */}
      {LEGACY_STAGES_ENABLED && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Legacy Stage Pipeline (deprecated)</CardTitle>
                <CardDescription>Per-stage model/council config for the legacy Stage 2–5 pipeline.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <StageModelTabs
              stageConfigs={
                settings.stageConfigs || {
                  stage1: { mode: 'single', singleModel: '', councilModels: [], chairmanModel: '' },
                  stage2: { mode: 'single', singleModel: '', councilModels: [], chairmanModel: '' },
                  stage3: { mode: 'single', singleModel: '', councilModels: [], chairmanModel: '' },
                  stage4: { mode: 'single', singleModel: '', councilModels: [], chairmanModel: '' },
                  stage5: { mode: 'single', singleModel: '', councilModels: [], chairmanModel: '' },
                }
              }
              onChange={(stageConfigs) => setSettings((prev) => (prev ? { ...prev, stageConfigs } : prev))}
              provider={settings.aiProvider}
              visibleStageKeys={['stage2', 'stage3', 'stage4', 'stage5']}
            />
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save layer & stage config
        </Button>
      </div>
    </div>
  )
}
