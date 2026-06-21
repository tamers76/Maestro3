import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { showToast } from '@/components/ui/Toaster'
import { testOpenRouterConnection, testOpenAIConnection } from '@/services/api'
import { useAdminSettings } from './adminSettingsContext'
import { Loader2, Check, X, Save, RefreshCw, Key } from 'lucide-react'

type TestStatus = 'idle' | 'success' | 'error'

export default function ApiKeysPage() {
  const { settings, setSettings, save, saving, loading } = useAdminSettings()
  const [testingOR, setTestingOR] = useState(false)
  const [testingOAI, setTestingOAI] = useState(false)
  const [orStatus, setOrStatus] = useState<TestStatus>('idle')
  const [oaiStatus, setOaiStatus] = useState<TestStatus>('idle')

  if (loading || !settings) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  async function handleTestOR() {
    try {
      setTestingOR(true)
      setOrStatus('idle')
      const result = await testOpenRouterConnection(settings!.openrouter?.apiKey, settings!.openrouter?.baseUrl)
      setOrStatus(result.success ? 'success' : 'error')
      showToast({
        title: result.success ? 'Connected' : 'Connection failed',
        description: result.message,
        variant: result.success ? 'success' : 'destructive',
      })
    } catch {
      setOrStatus('error')
      showToast({ title: 'Error', description: 'Failed to test connection', variant: 'destructive' })
    } finally {
      setTestingOR(false)
    }
  }

  async function handleTestOAI() {
    try {
      setTestingOAI(true)
      setOaiStatus('idle')
      const result = await testOpenAIConnection(settings!.openai?.apiKey, settings!.openai?.baseUrl)
      setOaiStatus(result.success ? 'success' : 'error')
      showToast({
        title: result.success ? 'Connected' : 'Connection failed',
        description: result.message,
        variant: result.success ? 'success' : 'destructive',
      })
    } catch {
      setOaiStatus('error')
      showToast({ title: 'Error', description: 'Failed to test OpenAI connection', variant: 'destructive' })
    } finally {
      setTestingOAI(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">API Keys</h2>
        <p className="text-caption text-muted-foreground">
          Provider credentials and endpoints. Keys are stored masked and survive restarts; environment variables take
          precedence.
        </p>
      </div>

      {/* OpenRouter */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
              <Key className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>OpenRouter API</CardTitle>
              <CardDescription>Cloud access to 300+ models</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">API Key</label>
            <Input
              type="password"
              placeholder="sk-or-..."
              value={settings.openrouter?.apiKey || ''}
              onChange={(e) =>
                setSettings((prev) => (prev ? { ...prev, openrouter: { ...prev.openrouter, apiKey: e.target.value } } : prev))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Base URL</label>
            <Input
              placeholder="https://openrouter.ai/api/v1"
              value={settings.openrouter?.baseUrl || ''}
              onChange={(e) =>
                setSettings((prev) => (prev ? { ...prev, openrouter: { ...prev.openrouter, baseUrl: e.target.value } } : prev))
              }
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <StatusLabel status={orStatus} okText="API key valid" errText="API key invalid" />
            <Button variant="outline" onClick={handleTestOR} disabled={testingOR}>
              {testingOR ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Test Connection
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* OpenAI */}
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
              onChange={(e) =>
                setSettings((prev) =>
                  prev
                    ? { ...prev, openai: { apiKey: e.target.value, baseUrl: prev.openai?.baseUrl || 'https://api.openai.com/v1' } }
                    : prev
                )
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Base URL</label>
            <Input
              placeholder="https://api.openai.com/v1"
              value={settings.openai?.baseUrl || 'https://api.openai.com/v1'}
              onChange={(e) =>
                setSettings((prev) =>
                  prev ? { ...prev, openai: { apiKey: prev.openai?.apiKey || '', baseUrl: e.target.value } } : prev
                )
              }
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <StatusLabel status={oaiStatus} okText="API key valid" errText="API key invalid" />
            <Button variant="outline" onClick={handleTestOAI} disabled={testingOAI}>
              {testingOAI ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Test Connection
            </Button>
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

function StatusLabel({ status, okText, errText }: { status: TestStatus; okText: string; errText: string }) {
  return (
    <div className="flex items-center gap-2">
      {status === 'success' && <Check className="h-4 w-4 text-emerald-500" />}
      {status === 'error' && <X className="h-4 w-4 text-red-500" />}
      <span className="text-sm text-muted-foreground">
        {status === 'success' ? okText : status === 'error' ? errText : ''}
      </span>
    </div>
  )
}
