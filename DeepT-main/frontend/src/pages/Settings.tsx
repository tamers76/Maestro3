import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { showToast } from '@/components/ui/Toaster'
import StageModelTabs from '@/components/StageModelTabs'
import Stage1LayersConfig from '@/components/Stage1LayersConfig'
import {
  fetchRawSettings,
  updateSettings,
  testNeo4jConnection,
  testOpenRouterConnection,
  testOllamaConnection,
  testOpenAIConnection,
  type Settings as SettingsType,
  type AIProvider,
} from '@/services/api'
import { Loader2, Check, X, Save, RefreshCw, Database, Key, Cpu, Server, Users, Sparkles, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function Settings() {
  const [settings, setSettings] = useState<SettingsType | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingNeo4j, setTestingNeo4j] = useState(false)
  const [testingOpenRouter, setTestingOpenRouter] = useState(false)
  const [testingOllama, setTestingOllama] = useState(false)
  const [testingOpenAI, setTestingOpenAI] = useState(false)
  const [neo4jStatus, setNeo4jStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [openRouterStatus, setOpenRouterStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [openAIStatus, setOpenAIStatus] = useState<'idle' | 'success' | 'error'>('idle')
  
  useEffect(() => {
    loadSettings()
  }, [])
  
  async function loadSettings() {
    try {
      setLoading(true)
      const data = await fetchRawSettings()
      setSettings(data)
    } catch (error) {
      showToast({
        title: 'Error',
        description: 'Failed to load settings',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }
  
  async function handleSave() {
    if (!settings) return
    
    try {
      setSaving(true)
      await updateSettings(settings)
      showToast({
        title: 'Settings Saved',
        description: 'Your settings have been updated',
        variant: 'success',
      })
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save settings',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }
  
  async function handleTestNeo4j() {
    try {
      setTestingNeo4j(true)
      setNeo4jStatus('idle')
      const result = await testNeo4jConnection()
      setNeo4jStatus(result.success ? 'success' : 'error')
      showToast({
        title: result.success ? 'Connected' : 'Connection Failed',
        description: result.message,
        variant: result.success ? 'success' : 'destructive',
      })
    } catch (error) {
      setNeo4jStatus('error')
      showToast({
        title: 'Error',
        description: 'Failed to test connection',
        variant: 'destructive',
      })
    } finally {
      setTestingNeo4j(false)
    }
  }
  
  async function handleTestOpenRouter() {
    try {
      setTestingOpenRouter(true)
      setOpenRouterStatus('idle')
      const result = await testOpenRouterConnection()
      setOpenRouterStatus(result.success ? 'success' : 'error')
      showToast({
        title: result.success ? 'Connected' : 'Connection Failed',
        description: result.message,
        variant: result.success ? 'success' : 'destructive',
      })
    } catch (error) {
      setOpenRouterStatus('error')
      showToast({
        title: 'Error',
        description: 'Failed to test connection',
        variant: 'destructive',
      })
    } finally {
      setTestingOpenRouter(false)
    }
  }
  
  async function handleTestOllama() {
    try {
      setTestingOllama(true)
      setOllamaStatus('idle')
      const result = await testOllamaConnection()
      setOllamaStatus(result.success ? 'success' : 'error')
      showToast({
        title: result.success ? 'Connected' : 'Connection Failed',
        description: result.message,
        variant: result.success ? 'success' : 'destructive',
      })
    } catch (error) {
      setOllamaStatus('error')
      showToast({
        title: 'Error',
        description: 'Failed to test Ollama connection. Is Ollama running?',
        variant: 'destructive',
      })
    } finally {
      setTestingOllama(false)
    }
  }
  
  async function handleTestOpenAI() {
    try {
      setTestingOpenAI(true)
      setOpenAIStatus('idle')
      const result = await testOpenAIConnection()
      setOpenAIStatus(result.success ? 'success' : 'error')
      showToast({
        title: result.success ? 'Connected' : 'Connection Failed',
        description: result.message,
        variant: result.success ? 'success' : 'destructive',
      })
    } catch (error) {
      setOpenAIStatus('error')
      showToast({
        title: 'Error',
        description: 'Failed to test OpenAI connection',
        variant: 'destructive',
      })
    } finally {
      setTestingOpenAI(false)
    }
  }
  
  function handleProviderChange(provider: AIProvider) {
    setSettings(prev => prev ? { ...prev, aiProvider: provider } : prev)
  }
  
  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    )
  }
  
  if (!settings) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4 text-center">
        <p className="text-muted-foreground">Failed to load settings</p>
        <Button onClick={loadSettings}>Retry</Button>
      </div>
    )
  }
  
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground flex items-center gap-3">
          Settings
          <Sparkles className="h-6 w-6 text-primary" />
        </h1>
        <p className="mt-1 text-muted-foreground">
          Configure your Neo4j database, AI provider, and model preferences
        </p>
      </div>
      
      {/* Neo4j Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Neo4j Database</CardTitle>
              <CardDescription>Graph database connection settings</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">URI</label>
              <Input
                placeholder="neo4j://localhost:7687"
                value={settings.neo4j.uri}
                onChange={e => setSettings(prev => prev ? {
                  ...prev,
                  neo4j: { ...prev.neo4j, uri: e.target.value }
                } : prev)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Username</label>
              <Input
                placeholder="neo4j"
                value={settings.neo4j.user}
                onChange={e => setSettings(prev => prev ? {
                  ...prev,
                  neo4j: { ...prev.neo4j, user: e.target.value }
                } : prev)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Password</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={settings.neo4j.password}
              onChange={e => setSettings(prev => prev ? {
                ...prev,
                neo4j: { ...prev.neo4j, password: e.target.value }
              } : prev)}
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              {neo4jStatus === 'success' && <Check className="h-4 w-4 text-emerald-500" />}
              {neo4jStatus === 'error' && <X className="h-4 w-4 text-red-500" />}
              <span className="text-sm text-muted-foreground">
                {neo4jStatus === 'success' ? 'Connected' : 
                 neo4jStatus === 'error' ? 'Connection failed' : ''}
              </span>
            </div>
            <Button variant="outline" onClick={handleTestNeo4j} disabled={testingNeo4j}>
              {testingNeo4j ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Test Connection
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* AI Provider Selection */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>AI Provider</CardTitle>
              <CardDescription>Choose between cloud (OpenRouter, OpenAI) or local (Ollama) AI models</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <button
              type="button"
              onClick={() => handleProviderChange('openrouter')}
              className={cn(
                'flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-all',
                settings.aiProvider === 'openrouter'
                  ? 'border-blue-500 bg-blue-500/10 dark:bg-blue-500/20'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50'
              )}
            >
              <div className="flex items-center gap-2">
                <Key className={cn('h-5 w-5', settings.aiProvider === 'openrouter' ? 'text-blue-500' : 'text-muted-foreground')} />
                <span className={cn('font-medium', settings.aiProvider === 'openrouter' ? 'text-blue-500' : 'text-foreground')}>
                  OpenRouter
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Cloud-based access to 300+ AI models including GPT-4, Claude, Llama, and more
              </p>
            </button>
            
            <button
              type="button"
              onClick={() => handleProviderChange('openai')}
              className={cn(
                'flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-all',
                settings.aiProvider === 'openai'
                  ? 'border-green-500 bg-green-500/10 dark:bg-green-500/20'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50'
              )}
            >
              <div className="flex items-center gap-2">
                <Key className={cn('h-5 w-5', settings.aiProvider === 'openai' ? 'text-green-500' : 'text-muted-foreground')} />
                <span className={cn('font-medium', settings.aiProvider === 'openai' ? 'text-green-500' : 'text-foreground')}>
                  OpenAI
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Direct access to OpenAI's GPT-4, GPT-4o, o1, and other models
              </p>
            </button>
            
            <button
              type="button"
              onClick={() => handleProviderChange('ollama')}
              className={cn(
                'flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-all',
                settings.aiProvider === 'ollama'
                  ? 'border-emerald-500 bg-emerald-500/10 dark:bg-emerald-500/20'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50'
              )}
            >
              <div className="flex items-center gap-2">
                <Server className={cn('h-5 w-5', settings.aiProvider === 'ollama' ? 'text-emerald-500' : 'text-muted-foreground')} />
                <span className={cn('font-medium', settings.aiProvider === 'ollama' ? 'text-emerald-500' : 'text-foreground')}>
                  Ollama (Local)
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Run AI models locally on your machine. Free, private, and no internet required
              </p>
            </button>
          </div>
        </CardContent>
      </Card>
      
      {/* OpenRouter Settings - Only show when OpenRouter is selected */}
      {settings.aiProvider === 'openrouter' && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                <Key className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>OpenRouter API</CardTitle>
                <CardDescription>Cloud AI model provider settings</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">API Key</label>
              <Input
                type="password"
                placeholder="sk-or-..."
                value={settings.openrouter.apiKey}
                onChange={e => setSettings(prev => prev ? {
                  ...prev,
                  openrouter: { ...prev.openrouter, apiKey: e.target.value }
                } : prev)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Base URL</label>
              <Input
                placeholder="https://openrouter.ai/api/v1"
                value={settings.openrouter.baseUrl}
                onChange={e => setSettings(prev => prev ? {
                  ...prev,
                  openrouter: { ...prev.openrouter, baseUrl: e.target.value }
                } : prev)}
              />
            </div>
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                {openRouterStatus === 'success' && <Check className="h-4 w-4 text-emerald-500" />}
                {openRouterStatus === 'error' && <X className="h-4 w-4 text-red-500" />}
                <span className="text-sm text-muted-foreground">
                  {openRouterStatus === 'success' ? 'API key valid' : 
                   openRouterStatus === 'error' ? 'API key invalid' : ''}
                </span>
              </div>
              <Button variant="outline" onClick={handleTestOpenRouter} disabled={testingOpenRouter}>
                {testingOpenRouter ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Test Connection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* OpenAI Settings - Only show when OpenAI is selected */}
      {settings.aiProvider === 'openai' && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10 text-green-500">
                <Key className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>OpenAI API</CardTitle>
                <CardDescription>Direct OpenAI API settings</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">API Key</label>
              <Input
                type="password"
                placeholder="sk-..."
                value={settings.openai?.apiKey || ''}
                onChange={e => setSettings(prev => prev ? {
                  ...prev,
                  openai: { 
                    apiKey: e.target.value,
                    baseUrl: prev.openai?.baseUrl || 'https://api.openai.com/v1'
                  }
                } : prev)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Base URL</label>
              <Input
                placeholder="https://api.openai.com/v1"
                value={settings.openai?.baseUrl || 'https://api.openai.com/v1'}
                onChange={e => setSettings(prev => prev ? {
                  ...prev,
                  openai: { 
                    apiKey: prev.openai?.apiKey || '',
                    baseUrl: e.target.value
                  }
                } : prev)}
              />
              <p className="text-xs text-muted-foreground">
                Default is https://api.openai.com/v1. Change only if using a proxy or compatible API.
              </p>
            </div>
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                {openAIStatus === 'success' && <Check className="h-4 w-4 text-emerald-500" />}
                {openAIStatus === 'error' && <X className="h-4 w-4 text-red-500" />}
                <span className="text-sm text-muted-foreground">
                  {openAIStatus === 'success' ? 'API key valid' : 
                   openAIStatus === 'error' ? 'API key invalid' : ''}
                </span>
              </div>
              <Button variant="outline" onClick={handleTestOpenAI} disabled={testingOpenAI}>
                {testingOpenAI ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Test Connection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Ollama Settings - Only show when Ollama is selected */}
      {settings.aiProvider === 'ollama' && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                <Server className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Ollama (Local)</CardTitle>
                <CardDescription>Local AI model server settings</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Base URL</label>
              <Input
                placeholder="http://localhost:11434"
                value={settings.ollama?.baseUrl || 'http://localhost:11434'}
                onChange={e => setSettings(prev => prev ? {
                  ...prev,
                  ollama: { ...prev.ollama, baseUrl: e.target.value }
                } : prev)}
              />
              <p className="text-xs text-muted-foreground">
                Default is http://localhost:11434. Change only if Ollama runs on a different port or machine.
              </p>
            </div>
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                {ollamaStatus === 'success' && <Check className="h-4 w-4 text-emerald-500" />}
                {ollamaStatus === 'error' && <X className="h-4 w-4 text-red-500" />}
                <span className="text-sm text-muted-foreground">
                  {ollamaStatus === 'success' ? 'Ollama is running' : 
                   ollamaStatus === 'error' ? 'Cannot connect to Ollama' : ''}
                </span>
              </div>
              <Button variant="outline" onClick={handleTestOllama} disabled={testingOllama}>
                {testingOllama ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Test Connection
              </Button>
            </div>
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-600 dark:text-amber-400">
              <p className="font-medium">Tip: Pull models with Ollama CLI</p>
              <p className="mt-1 text-amber-600/80 dark:text-amber-400/80">
                Run <code className="rounded bg-amber-500/20 px-1">ollama pull llama3.2</code> or <code className="rounded bg-amber-500/20 px-1">ollama pull mistral</code> to download models.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Stage 1 Internal Layers */}
      <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Stage 1 — Academic Contract Layers</CardTitle>
                <CardDescription>
                  Configure each internal Stage 1 layer: prompts, execution mode, council, and SME workflow
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

      {/* LLM Council - Per-Stage Model Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>LLM Council</CardTitle>
              <CardDescription>
                Configure each stage to use a single model or a council of models
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Stage Model Tabs */}
          <StageModelTabs
            stageConfigs={settings.stageConfigs || {
              stage1: { mode: 'single', singleModel: '', councilModels: [], chairmanModel: '' },
              stage2: { mode: 'single', singleModel: '', councilModels: [], chairmanModel: '' },
              stage3: { mode: 'single', singleModel: '', councilModels: [], chairmanModel: '' },
              stage4: { mode: 'single', singleModel: '', councilModels: [], chairmanModel: '' },
              stage5: { mode: 'single', singleModel: '', councilModels: [], chairmanModel: '' },
            }}
            onChange={(stageConfigs) => setSettings(prev => prev ? {
              ...prev,
              stageConfigs
            } : prev)}
            provider={settings.aiProvider}
          />
          
          {/* Info box */}
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-3 text-sm text-blue-600 dark:text-blue-400">
            <p className="font-medium">How LLM Council Works</p>
            <ul className="mt-1 text-blue-600/80 dark:text-blue-400/80 list-disc list-inside space-y-1">
              <li><strong>Single mode:</strong> Uses one model directly (fast)</li>
              <li><strong>Council mode:</strong> Multiple models deliberate, then the chairman synthesizes the final output (thorough)</li>
              <li><strong>Per-stage prompts:</strong> Each stage has its own member and chairman prompts tailored to its task</li>
            </ul>
          </div>
        </CardContent>
      </Card>
      
      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="gap-2 shadow-lg shadow-primary/25 dark:shadow-primary/10">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Settings
        </Button>
      </div>
    </div>
  )
}
