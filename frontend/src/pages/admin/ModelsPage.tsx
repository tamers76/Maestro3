import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { cn } from '@/lib/utils'
import { useAdminSettings } from './adminSettingsContext'
import type { AIProvider } from '@/services/api'
import { Loader2, Save, Cpu, Key } from 'lucide-react'

export default function ModelsPage() {
  const { settings, setSettings, save, saving, loading } = useAdminSettings()

  if (loading || !settings) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  function setProvider(provider: AIProvider) {
    setSettings((prev) => (prev ? { ...prev, aiProvider: provider } : prev))
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">AI Models</h2>
        <p className="text-caption text-muted-foreground">
          Choose the active provider and the system-default models used as fallbacks.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>AI Provider</CardTitle>
              <CardDescription>Cloud provider used for generation and embeddings</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <ProviderButton
              active={settings.aiProvider === 'openrouter'}
              onClick={() => setProvider('openrouter')}
              activeClass="border-blue-500 bg-blue-500/10 dark:bg-blue-500/20"
              iconClass={settings.aiProvider === 'openrouter' ? 'text-blue-500' : 'text-muted-foreground'}
              titleClass={settings.aiProvider === 'openrouter' ? 'text-blue-500' : 'text-foreground'}
              title="OpenRouter"
              description="Cloud access to 300+ models incl. GPT-4, Claude, Llama"
            />
            <ProviderButton
              active={settings.aiProvider === 'openai'}
              onClick={() => setProvider('openai')}
              activeClass="border-green-500 bg-green-500/10 dark:bg-green-500/20"
              iconClass={settings.aiProvider === 'openai' ? 'text-green-500' : 'text-muted-foreground'}
              titleClass={settings.aiProvider === 'openai' ? 'text-green-500' : 'text-foreground'}
              title="OpenAI"
              description="Direct access to OpenAI GPT-4, GPT-4o, o1, and others"
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Configure the corresponding API key on the API Keys page.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Node Engine defaults</CardTitle>
              <CardDescription>System fallback models for node generation</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Default generation model</label>
            <Input
              placeholder="anthropic/claude-sonnet-4"
              value={settings.nodeEngineDefaults?.defaultModel || ''}
              onChange={(e) =>
                setSettings((prev) =>
                  prev
                    ? { ...prev, nodeEngineDefaults: { ...prev.nodeEngineDefaults, defaultModel: e.target.value } }
                    : prev
                )
              }
            />
            <p className="text-xs text-muted-foreground">Used when no per-vehicle model is configured.</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Context-header model</label>
            <Input
              placeholder="openai/gpt-4o-mini"
              value={settings.nodeEngineDefaults?.contextHeaderModel || ''}
              onChange={(e) =>
                setSettings((prev) =>
                  prev
                    ? { ...prev, nodeEngineDefaults: { ...prev.nodeEngineDefaults, contextHeaderModel: e.target.value } }
                    : prev
                )
              }
            />
            <p className="text-xs text-muted-foreground">Cheap model used to generate reference-chunk context headers.</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
      </div>
    </div>
  )
}

function ProviderButton(props: {
  active: boolean
  onClick: () => void
  activeClass: string
  iconClass: string
  titleClass: string
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        'flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-all',
        props.active ? props.activeClass : 'border-border hover:border-primary/50 hover:bg-muted/50'
      )}
    >
      <div className="flex items-center gap-2">
        <Key className={cn('h-5 w-5', props.iconClass)} />
        <span className={cn('font-medium', props.titleClass)}>{props.title}</span>
      </div>
      <p className="text-sm text-muted-foreground">{props.description}</p>
    </button>
  )
}
