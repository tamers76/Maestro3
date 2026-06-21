import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { showToast } from '@/components/ui/Toaster'
import {
  testNeo4jConnection,
  testPostgresConnection,
  fetchPostgresStatus,
  type PostgresStatus,
} from '@/services/api'
import { useAdminSettings } from './adminSettingsContext'
import { Loader2, Check, X, Save, RefreshCw, Database, Network } from 'lucide-react'

type TestStatus = 'idle' | 'success' | 'error'

export default function DatabasePage() {
  const { settings, setSettings, save, saving, loading } = useAdminSettings()
  const [testingPg, setTestingPg] = useState(false)
  const [testingNeo, setTestingNeo] = useState(false)
  const [pgStatus, setPgStatus] = useState<TestStatus>('idle')
  const [neoStatus, setNeoStatus] = useState<TestStatus>('idle')
  const [livePg, setLivePg] = useState<PostgresStatus | null>(null)

  useEffect(() => {
    fetchPostgresStatus()
      .then(setLivePg)
      .catch(() => setLivePg(null))
  }, [])

  if (loading || !settings) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  async function handleTestPg() {
    try {
      setTestingPg(true)
      setPgStatus('idle')
      const result = await testPostgresConnection(settings!.postgres?.connectionString)
      setPgStatus(result.success ? 'success' : 'error')
      showToast({
        title: result.success ? 'Connected' : 'Connection failed',
        description: result.success ? result.message || 'Postgres reachable' : result.error || 'Failed',
        variant: result.success ? 'success' : 'destructive',
      })
    } catch {
      setPgStatus('error')
      showToast({ title: 'Error', description: 'Failed to test connection', variant: 'destructive' })
    } finally {
      setTestingPg(false)
    }
  }

  async function handleTestNeo() {
    try {
      setTestingNeo(true)
      setNeoStatus('idle')
      const result = await testNeo4jConnection()
      setNeoStatus(result.success ? 'success' : 'error')
      showToast({
        title: result.success ? 'Connected' : 'Connection failed',
        description: result.message,
        variant: result.success ? 'success' : 'destructive',
      })
    } catch {
      setNeoStatus('error')
      showToast({ title: 'Error', description: 'Failed to test connection', variant: 'destructive' })
    } finally {
      setTestingNeo(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Database</h2>
        <p className="text-caption text-muted-foreground">
          Primary Postgres store and the optional Neo4j graph projection.
        </p>
      </div>

      {/* Postgres */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Postgres (primary)</CardTitle>
              <CardDescription>primary Database and PGvector Store</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Active pool:</span>
            {livePg ? (
              livePg.connected ? (
                <span className="flex items-center gap-1 text-emerald-500">
                  <Check className="h-4 w-4" /> connected
                </span>
              ) : (
                <span className="flex items-center gap-1 text-red-500">
                  <X className="h-4 w-4" /> {livePg.last_error || 'disconnected'}
                </span>
              )
            ) : (
              <span className="text-muted-foreground">unknown</span>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Connection string</label>
            <Input
              type="password"
              placeholder="postgresql://user:password@host:5432/database"
              value={settings.postgres?.connectionString || ''}
              onChange={(e) =>
                setSettings((prev) =>
                  prev ? { ...prev, postgres: { ...prev.postgres, connectionString: e.target.value } } : prev
                )
              }
            />
            <p className="text-xs text-muted-foreground">
              Stored masked. Leave the masked value untouched to keep the current connection.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Pool max</label>
              <Input
                type="number"
                min={1}
                value={settings.postgres?.poolMax ?? 10}
                onChange={(e) =>
                  setSettings((prev) =>
                    prev ? { ...prev, postgres: { ...prev.postgres, poolMax: Number(e.target.value) } } : prev
                  )
                }
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <StatusLabel status={pgStatus} okText="Reachable" errText="Unreachable" />
            <Button variant="outline" onClick={handleTestPg} disabled={testingPg}>
              {testingPg ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Test Connection
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Neo4j */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
              <Network className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Neo4j (graph projection)</CardTitle>
              <CardDescription>graph database connection</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">URI</label>
              <Input
                placeholder="neo4j://localhost:7687"
                value={settings.neo4j?.uri || ''}
                onChange={(e) =>
                  setSettings((prev) => (prev ? { ...prev, neo4j: { ...prev.neo4j, uri: e.target.value } } : prev))
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Username</label>
              <Input
                placeholder="neo4j"
                value={settings.neo4j?.user || ''}
                onChange={(e) =>
                  setSettings((prev) => (prev ? { ...prev, neo4j: { ...prev.neo4j, user: e.target.value } } : prev))
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Password</label>
            <Input
              type="password"
              placeholder="••••••••"
              value={settings.neo4j?.password || ''}
              onChange={(e) =>
                setSettings((prev) => (prev ? { ...prev, neo4j: { ...prev.neo4j, password: e.target.value } } : prev))
              }
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <StatusLabel status={neoStatus} okText="Connected" errText="Connection failed" />
            <Button variant="outline" onClick={handleTestNeo} disabled={testingNeo}>
              {testingNeo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
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
