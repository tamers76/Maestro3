import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { showToast } from '@/components/ui/Toaster'
import {
  fetchRawSettings,
  updateSettings as apiUpdateSettings,
  type Settings,
} from '@/services/api'
import type { AdminSettingsContextValue } from './adminSettingsContext'
import {
  Users,
  ShieldCheck,
  KeyRound,
  Database,
  Cpu,
  Sparkles,
  Network,
  ScrollText,
  ShieldAlert,
} from 'lucide-react'

interface NavItem {
  to: string
  label: string
  icon: typeof Users
  description: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Identity & Access',
    items: [
      { to: '/admin/users', label: 'Users', icon: Users, description: 'Create and manage user accounts' },
      { to: '/admin/access', label: 'Course Access', icon: ShieldCheck, description: 'Owners, reviewers, and students' },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { to: '/admin/api-keys', label: 'API Keys', icon: KeyRound, description: 'AI provider keys and endpoints' },
      { to: '/admin/database', label: 'Database', icon: Database, description: 'Postgres and Neo4j connectivity' },
      { to: '/admin/models', label: 'AI Models', icon: Cpu, description: 'Provider and default models' },
      { to: '/admin/prompts', label: 'Prompts', icon: Sparkles, description: 'Architect and node-engine prompts' },
      { to: '/admin/rag', label: 'Reference & RAG', icon: Network, description: 'Grounding health and thresholds' },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { to: '/admin/audit', label: 'Audit', icon: ScrollText, description: 'Activity history and filters' },
    ],
  },
]

export default function AdminCenter() {
  const location = useLocation()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchRawSettings()
      setSettings(data)
    } catch {
      showToast({ title: 'Error', description: 'Failed to load settings', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const patch = useCallback((partial: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...partial } : prev))
  }, [])

  const save = useCallback(async () => {
    if (!settings) return
    try {
      setSaving(true)
      const result = await apiUpdateSettings(settings)
      // Refresh from server so masked secrets reflect the persisted state.
      setSettings(result.settings)
      showToast({
        title: 'Settings saved',
        description: result.warning ? `${result.message}. ${result.warning}` : 'Your settings have been updated',
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
  }, [settings])

  const ctx: AdminSettingsContextValue = { settings, setSettings, patch, save, saving, loading, reload }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-foreground flex items-center gap-3">
          Admin Center
          <ShieldAlert className="h-6 w-6 text-primary" />
        </h1>
        <p className="mt-1 text-muted-foreground">
          Administrator-only controls for users, access, configuration, and activity auditing.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Browsable section navigation */}
        <nav className="space-y-5 lg:sticky lg:top-[68px] lg:self-start">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="mb-2 px-2 text-fine-print font-medium uppercase tracking-wide text-muted-foreground">
                {section.title}
              </p>
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const active = location.pathname === item.to
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={cn(
                        'flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors',
                        active
                          ? 'bg-primary/10 text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      <item.icon className={cn('mt-0.5 h-4 w-4 flex-shrink-0', active && 'text-primary')} />
                      <span className="min-w-0">
                        <span className="block text-caption font-medium leading-tight">{item.label}</span>
                        <span className="block truncate text-fine-print text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Active page */}
        <div className="min-w-0">
          <Outlet context={ctx} />
        </div>
      </div>
    </div>
  )
}
