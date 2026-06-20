import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { showToast } from '@/components/ui/Toaster'
import StageModelTabs from '@/components/StageModelTabs'
import Stage1LayersConfig from '@/components/Stage1LayersConfig'
import PromptTemplateSettings from '@/components/nodeEngine/PromptTemplateSettings'
import { LEGACY_STAGES_ENABLED } from '@/config/featureFlags'
import {
  fetchRawSettings,
  updateSettings,
  testNeo4jConnection,
  testOpenRouterConnection,
  testOllamaConnection,
  testOpenAIConnection,
  fetchEmbeddingHealth,
  fetchReferenceCoverageConfig,
  updateReferenceCoverageConfig,
  type Settings as SettingsType,
  type AIProvider,
  type EmbeddingHealth,
  type ReferenceCoverageThresholds,
} from '@/services/api'
import { Loader2, Check, X, Save, RefreshCw, Database, Key, Cpu, Server, Users, Sparkles, Layers, Activity, Network } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The coverage-judgment prompt id in the node-engine registry (Phase A seed). */
const REFERENCE_COVERAGE_JUDGMENT_PROMPT_ID = 'reference_coverage_judgment_prompt'
/** The node-grounding judgment prompt id (Problem 2 seed). */
const REFERENCE_GROUNDING_JUDGMENT_PROMPT_ID = 'reference_grounding_judgment_prompt'
/** The AI source-suggestion prompt id (Phase C seed). */
const REFERENCE_SOURCE_SUGGESTION_PROMPT_ID = 'reference_source_suggestion_prompt'

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
  const [embeddingHealth, setEmbeddingHealth] = useState<EmbeddingHealth | null>(null)
  const [checkingEmbedding, setCheckingEmbedding] = useState(false)
  const [coverageThresholds, setCoverageThresholds] = useState<ReferenceCoverageThresholds | null>(null)
  const [savingCoverage, setSavingCoverage] = useState(false)
  const location = useLocation()

  useEffect(() => {
    loadSettings()
    handleCheckEmbedding()
    loadCoverageConfig()
  }, [])

  // Deep-link from admin settings bookmarks (/settings#reference-cross-referencing).
  useEffect(() => {
    if (loading) return
    const hash = location.hash?.replace('#', '')
    if (!hash) return
    const el = document.getElementById(hash)
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [loading, location.hash])

  async function loadCoverageConfig() {
    try {
      const config = await fetchReferenceCoverageConfig()
      setCoverageThresholds(config.thresholds)
    } catch {
      // Non-fatal: the card shows a retry-on-save path if the config can't load.
    }
  }

  async function handleSaveCoverageConfig() {
    if (!coverageThresholds) return
    try {
      setSavingCoverage(true)
      const config = await updateReferenceCoverageConfig(coverageThresholds)
      setCoverageThresholds(config.thresholds)
      showToast({
        title: 'Thresholds saved',
        description: 'Reference cross-referencing thresholds updated. Re-run coverage to apply.',
        variant: 'success',
      })
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save thresholds',
        variant: 'destructive',
      })
    } finally {
      setSavingCoverage(false)
    }
  }

  async function handleCheckEmbedding() {
    try {
      setCheckingEmbedding(true)
      const health = await fetchEmbeddingHealth()
      setEmbeddingHealth(health)
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
      setCheckingEmbedding(false)
    }
  }
  
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
      const result = await updateSettings(settings)
      showToast({
        title: 'Settings Saved',
        description: result.warning
          ? `${result.message}. ${result.warning}`
          : 'Your settings have been updated',
        variant: result.warning ? 'default' : 'success',
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
      const result = await testOpenRouterConnection(settings?.openrouter?.apiKey, settings?.openrouter?.baseUrl)
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
      const result = await testOpenAIConnection(settings?.openai?.apiKey, settings?.openai?.baseUrl)
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
    <div className="mx-auto w-full max-w-6xl space-y-8">
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
      
      {/* Embedding / RAG health — makes the silent grounding-failure mode visible.
          A down provider can never again masquerade as "weak grounding". */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg',
              embeddingHealth?.ok ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
            )}>
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Reference Grounding (RAG) Health</CardTitle>
              <CardDescription>
                Live embedding-provider probe. If this is down, node generation falls back to model-only
                and is not academically approvable.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {embeddingHealth ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-2">
                {embeddingHealth.ok ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <X className="h-4 w-4 text-red-500" />
                )}
                <span className="text-sm font-medium text-foreground">
                  {embeddingHealth.ok ? 'Embedding provider healthy' : 'Embedding provider unavailable'}
                </span>
              </div>
              <div className="text-sm text-muted-foreground">Provider: <span className="text-foreground">{embeddingHealth.provider}</span></div>
              <div className="text-sm text-muted-foreground">Model: <span className="text-foreground">{embeddingHealth.model || '—'}</span></div>
              <div className="text-sm text-muted-foreground">
                Dimensions: <span className="text-foreground">{embeddingHealth.liveDimensions || embeddingHealth.configuredDimensions}</span>
                {embeddingHealth.liveDimensions > 0 && embeddingHealth.liveDimensions !== embeddingHealth.configuredDimensions && (
                  <span className="text-amber-500"> (live {embeddingHealth.liveDimensions} ≠ configured {embeddingHealth.configuredDimensions})</span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                Provider key configured: <span className="text-foreground">{embeddingHealth.providerConfigured ? 'yes' : 'no'}</span>
              </div>
              {embeddingHealth.error && (
                <div className="sm:col-span-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-600 dark:text-red-400">
                  {embeddingHealth.error}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Running embedding health probe…</p>
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={handleCheckEmbedding} disabled={checkingEmbedding}>
              {checkingEmbedding ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Re-check
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reference cross-referencing — coverage thresholds + embedding (read-only)
          + the reused coverage-judgment prompt editor. */}
      <Card id="reference-cross-referencing">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-500">
              <Network className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Reference cross-referencing</CardTitle>
              <CardDescription>
                Tune the evidence-gate thresholds, review the embedding model, and edit the
                coverage-judgment prompt used by the Reference Coverage Check.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Numeric thresholds */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-1">Evidence-gate thresholds</h3>
            <p className="text-xs text-muted-foreground mb-3">
              A CLO reaches "Well covered / Partial" only when enough on-topic passages exist across
              enough distinct sources. These control that gate; the judgment can only confirm or
              downgrade within it.
            </p>
            {coverageThresholds ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Top-K passages</label>
                  <Input
                    type="number"
                    min={1}
                    value={coverageThresholds.topK}
                    onChange={(e) =>
                      setCoverageThresholds((p) => (p ? { ...p, topK: Number(e.target.value) } : p))
                    }
                  />
                  <p className="text-xs text-muted-foreground">Passages retrieved per CLO (≥ 1).</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Relevance floor</label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    value={coverageThresholds.relevanceFloor}
                    onChange={(e) =>
                      setCoverageThresholds((p) =>
                        p ? { ...p, relevanceFloor: Number(e.target.value) } : p
                      )
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Fused score a passage must clear to count (0–1).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Min passages</label>
                  <Input
                    type="number"
                    min={1}
                    value={coverageThresholds.minPassages}
                    onChange={(e) =>
                      setCoverageThresholds((p) =>
                        p ? { ...p, minPassages: Number(e.target.value) } : p
                      )
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Supporting passages needed to open the gate (≥ 1).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Distribution min</label>
                  <Input
                    type="number"
                    min={1}
                    value={coverageThresholds.distributionMin}
                    onChange={(e) =>
                      setCoverageThresholds((p) =>
                        p ? { ...p, distributionMin: Number(e.target.value) } : p
                      )
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Distinct documents required among supporting passages (≥ 1).
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Loading thresholds…</p>
            )}
            <div className="mt-3 flex justify-end">
              <Button onClick={handleSaveCoverageConfig} disabled={savingCoverage || !coverageThresholds} className="gap-2">
                {savingCoverage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save thresholds
              </Button>
            </div>
          </div>

          {/* Embedding model (read-only) */}
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <h3 className="text-sm font-semibold text-foreground mb-1">Embedding model (read-only)</h3>
            <p className="text-xs text-muted-foreground mb-2">
              Coverage retrieval reuses the configured embedding model. Change it under the AI provider
              settings; it is shown here for reference.
            </p>
            <div className="grid gap-2 sm:grid-cols-3 text-sm">
              <div className="text-muted-foreground">
                Provider: <span className="text-foreground">{embeddingHealth?.provider ?? '—'}</span>
              </div>
              <div className="text-muted-foreground">
                Model: <span className="text-foreground">{embeddingHealth?.model || '—'}</span>
              </div>
              <div className="text-muted-foreground">
                Dimensions:{' '}
                <span className="text-foreground">
                  {embeddingHealth
                    ? embeddingHealth.liveDimensions || embeddingHealth.configuredDimensions || '—'
                    : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Coverage prompts — reuses the versioned PromptTemplateSettings editor for
              BOTH the Layer-3 coverage-judgment prompt and the Phase-C AI
              source-suggestion prompt. */}
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
                  'Coverage judgment, node-grounding judgment, and AI source-suggestion prompts. Editing any creates a new immutable version and moves the active pointer — published versions are never overwritten.',
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Stage 1 Internal Layers */}
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

      {/* Legacy Stage Pipeline (deprecated) — only reachable when LEGACY_STAGES_ENABLED.
          The V1 intake config (model + council + Extraction/CLO Analysis prompts) now
          lives on the "Stage 1 — Academic Contract Layers" card's layer1-intake layer.
          Stage 2-5 configs remain in storage/schema and are editable here when enabled. */}
      {LEGACY_STAGES_ENABLED && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Legacy Stage Pipeline (deprecated)</CardTitle>
                <CardDescription>
                  Per-stage model/council config for the legacy Stage 2–5 pipeline. Stage 1 intake is now
                  configured on the Academic Contract Layers card above.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
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
              visibleStageKeys={['stage2', 'stage3', 'stage4', 'stage5']}
            />
          </CardContent>
        </Card>
      )}

      {/* Maestro Node Engine — Prompt Template Registry (M2 / S7) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Node Engine — Prompt Templates</CardTitle>
              <CardDescription>
                Versioned prompt templates for each production vehicle (Build Spec §8.14)
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <PromptTemplateSettings />
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
