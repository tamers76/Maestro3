import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { showToast } from '@/components/ui/Toaster'
import {
  listAuditEvents,
  fetchAuditFacets,
  listUsers,
  fetchCourses,
  type AuditEvent,
  type AuditFilters,
  type AuditFacets,
  type ManagedUser,
  type CourseListItem,
} from '@/services/api'
import { Loader2, RefreshCw, Filter, X } from 'lucide-react'

const PAGE_SIZE = 50

const inputClass =
  'flex h-10 w-full rounded-md border border-input bg-white/55 dark:bg-white/5 backdrop-blur-md px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const CATEGORY_BADGES: Record<string, string> = {
  user: 'bg-blue-500/15 text-blue-500',
  access: 'bg-purple-500/15 text-purple-500',
  course: 'bg-emerald-500/15 text-emerald-500',
  approval: 'bg-amber-500/15 text-amber-500',
  review: 'bg-cyan-500/15 text-cyan-500',
  settings: 'bg-slate-500/15 text-slate-400',
  auth: 'bg-rose-500/15 text-rose-500',
}

interface FilterState {
  actor_user_id: string
  course_code: string
  category: string
  action: string
  entity_type: string
  from: string
  to: string
  search: string
}

const EMPTY_FILTERS: FilterState = {
  actor_user_id: '',
  course_code: '',
  category: '',
  action: '',
  entity_type: '',
  from: '',
  to: '',
  search: '',
}

export default function AuditPage() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const [users, setUsers] = useState<ManagedUser[]>([])
  const [courses, setCourses] = useState<CourseListItem[]>([])
  const [facets, setFacets] = useState<AuditFacets>({ actions: [], categories: [], entityTypes: [] })

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])

  useEffect(() => {
    ;(async () => {
      const [u, c, f] = await Promise.allSettled([listUsers(), fetchCourses(), fetchAuditFacets()])
      if (u.status === 'fulfilled') setUsers(u.value)
      if (c.status === 'fulfilled') setCourses(c.value)
      if (f.status === 'fulfilled') setFacets(f.value)
    })()
  }, [])

  useEffect(() => {
    void load(applied, page)
  }, [applied, page])

  async function load(f: FilterState, p: number) {
    try {
      setLoading(true)
      const query: AuditFilters = { ...f, limit: PAGE_SIZE, offset: p * PAGE_SIZE }
      const result = await listAuditEvents(query)
      setEvents(result.events)
      setTotal(result.total)
    } catch (e) {
      showToast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to load audit log', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  function applyFilters() {
    setPage(0)
    setApplied(filters)
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS)
    setPage(0)
    setApplied(EMPTY_FILTERS)
  }

  const actorLabel = (e: AuditEvent) => {
    const u = e.actor_user_id ? usersById.get(e.actor_user_id) : undefined
    return e.actor_name || e.actor_email || (u ? u.name || u.email : 'system')
  }

  const targetLabel = (e: AuditEvent) => {
    if (e.target_user_id) {
      const u = usersById.get(e.target_user_id)
      return u ? u.name || u.email : e.target_user_id
    }
    if (e.course_code) return e.course_code
    return e.entity_id || '—'
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Audit</h2>
        <p className="text-caption text-muted-foreground">
          Activity history across users, access, courses, approvals, reviews, and settings.
        </p>
      </div>

      {/* Filters */}
      <div className="glass space-y-4 rounded-xl border border-white/10 p-5">
        <div className="flex items-center gap-2 text-caption font-medium text-foreground">
          <Filter className="h-4 w-4" /> Filters
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Field label="User">
            <select
              className={inputClass}
              value={filters.actor_user_id}
              onChange={(e) => setFilters({ ...filters, actor_user_id: e.target.value })}
            >
              <option value="">All users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Course">
            <select
              className={inputClass}
              value={filters.course_code}
              onChange={(e) => setFilters({ ...filters, course_code: e.target.value })}
            >
              <option value="">All courses</option>
              {courses.map((c) => (
                <option key={c.course_code} value={c.course_code}>
                  {c.course_code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select
              className={inputClass}
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
            >
              <option value="">All categories</option>
              {facets.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Action">
            <select
              className={inputClass}
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
            >
              <option value="">All actions</option>
              {facets.actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Entity type">
            <select
              className={inputClass}
              value={filters.entity_type}
              onChange={(e) => setFilters({ ...filters, entity_type: e.target.value })}
            >
              <option value="">All entities</option>
              {facets.entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input
              type="date"
              className={inputClass}
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              className={inputClass}
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </Field>
          <Field label="Search">
            <Input
              placeholder="Summary, email, entity…"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-2 h-4 w-4" /> Clear
          </Button>
          <Button size="sm" onClick={applyFilters}>
            <Filter className="mr-2 h-4 w-4" /> Apply
          </Button>
        </div>
      </div>

      {/* Results */}
      <div className="glass rounded-xl border border-white/10 p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-caption text-muted-foreground">
            {loading ? 'Loading…' : `${total} event${total === 1 ? '' : 's'}`}
          </p>
          <Button variant="outline" size="sm" onClick={() => load(applied, page)} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <p className="py-10 text-center text-caption text-muted-foreground">No audit events match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-fine-print">
              <thead>
                <tr className="border-b border-white/10 text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Time</th>
                  <th className="px-2 py-2 font-medium">Actor</th>
                  <th className="px-2 py-2 font-medium">Action</th>
                  <th className="px-2 py-2 font-medium">Target</th>
                  <th className="px-2 py-2 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-white/5 align-top hover:bg-white/5">
                    <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="px-2 py-2">
                      <span className="text-foreground">{actorLabel(e)}</span>
                      {e.actor_role && <span className="block text-muted-foreground">{e.actor_role}</span>}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          CATEGORY_BADGES[e.category] || 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {e.category || 'event'}
                      </span>
                      <span className="mt-1 block font-mono text-foreground">{e.action}</span>
                    </td>
                    <td className="px-2 py-2 text-foreground">{targetLabel(e)}</td>
                    <td className="px-2 py-2 text-muted-foreground">{e.summary || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-fine-print text-muted-foreground">
              Page {page + 1} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-fine-print font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}
