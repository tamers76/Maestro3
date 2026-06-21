import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { showToast } from '@/components/ui/Toaster'
import {
  listUsers,
  createUser,
  setUserActive,
  resetUserPassword,
  fetchCourses,
  fetchCourseAccess,
  setCourseOwner,
  assignReviewer,
  removeReviewer,
  assignStudent,
  removeStudent,
  type ManagedUser,
  type UserRole,
  type CourseListItem,
  type CourseAccess,
} from '@/services/api'
import { Loader2, UserPlus, ShieldCheck, BookOpen } from 'lucide-react'

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'professor', label: 'Professor' },
  { value: 'student', label: 'Student' },
  { value: 'admin', label: 'Admin' },
]

const inputClass =
  'flex h-11 w-full rounded-md border border-input bg-white/55 dark:bg-white/5 backdrop-blur-md px-4 py-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function Admin() {
  const [tab, setTab] = useState<'users' | 'access'>('users')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Administration</h1>
        <p className="text-caption text-muted-foreground">Manage users and course access.</p>
      </div>

      <div className="flex gap-2">
        <Button variant={tab === 'users' ? 'default' : 'glass'} size="sm" onClick={() => setTab('users')}>
          <UserPlus className="mr-2 h-4 w-4" /> Users
        </Button>
        <Button variant={tab === 'access' ? 'default' : 'glass'} size="sm" onClick={() => setTab('access')}>
          <ShieldCheck className="mr-2 h-4 w-4" /> Course Access
        </Button>
      </div>

      {tab === 'users' ? <UsersTab /> : <CourseAccessTab />}
    </div>
  )
}

function UsersTab() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<{ email: string; name: string; password: string; role: UserRole }>({
    email: '',
    name: '',
    password: '',
    role: 'professor',
  })

  async function load() {
    try {
      setLoading(true)
      setUsers(await listUsers())
    } catch (e) {
      showToast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to load users', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    try {
      setCreating(true)
      await createUser({ ...form, email: form.email.trim(), name: form.name.trim() })
      showToast({ title: 'User created', description: `${form.email} added as ${form.role}`, variant: 'success' })
      setForm({ email: '', name: '', password: '', role: 'professor' })
      await load()
    } catch (e) {
      showToast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to create user', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(u: ManagedUser) {
    try {
      await setUserActive(u.id, !u.is_active)
      await load()
    } catch (e) {
      showToast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to update user', variant: 'destructive' })
    }
  }

  async function handleResetPassword(u: ManagedUser) {
    const pw = window.prompt(`Set a new password for ${u.email} (min 8 chars):`)
    if (!pw) return
    try {
      await resetUserPassword(u.id, pw)
      showToast({ title: 'Password reset', description: `Password updated for ${u.email}`, variant: 'success' })
    } catch (e) {
      showToast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to reset password', variant: 'destructive' })
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <form onSubmit={handleCreate} className="glass h-fit space-y-4 rounded-xl border border-white/10 p-5">
        <h2 className="flex items-center gap-2 text-body font-semibold text-foreground">
          <UserPlus className="h-4 w-4" /> Create user
        </h2>
        <div>
          <label className="mb-1.5 block text-caption font-medium text-foreground">Email</label>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="user@institution.edu"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-caption font-medium text-foreground">Name</label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
        </div>
        <div>
          <label className="mb-1.5 block text-caption font-medium text-foreground">Password</label>
          <Input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Min 8 characters"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-caption font-medium text-foreground">Role</label>
          <select
            className={inputClass}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" className="w-full" disabled={creating}>
          {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Create user
        </Button>
      </form>

      <div className="glass rounded-xl border border-white/10 p-5">
        <h2 className="mb-4 text-body font-semibold text-foreground">Users</h2>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-caption font-medium text-foreground">{u.name || u.email}</p>
                  <p className="truncate text-fine-print text-muted-foreground">
                    {u.email} · {u.role}
                    {!u.is_active && <span className="ml-2 text-red-400">inactive</span>}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" size="sm" onClick={() => handleResetPassword(u)}>
                    Reset PW
                  </Button>
                  <Button variant={u.is_active ? 'outline' : 'default'} size="sm" onClick={() => toggleActive(u)}>
                    {u.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              </div>
            ))}
            {users.length === 0 && <p className="text-caption text-muted-foreground">No users yet.</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function CourseAccessTab() {
  const [courses, setCourses] = useState<CourseListItem[]>([])
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [selectedCourse, setSelectedCourse] = useState('')
  const [access, setAccess] = useState<CourseAccess | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const professors = useMemo(() => users.filter((u) => u.role === 'professor' || u.role === 'admin'), [users])
  const students = useMemo(() => users.filter((u) => u.role === 'student'), [users])
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        const [c, u] = await Promise.all([fetchCourses(), listUsers()])
        setCourses(c)
        setUsers(u)
        if (c.length > 0) setSelectedCourse(c[0].course_code)
      } catch (e) {
        showToast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to load', variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function loadAccess(code: string) {
    if (!code) return
    try {
      setAccess(await fetchCourseAccess(code))
    } catch (e) {
      showToast({ title: 'Error', description: e instanceof Error ? e.message : 'Failed to load access', variant: 'destructive' })
    }
  }

  useEffect(() => {
    if (selectedCourse) loadAccess(selectedCourse)
  }, [selectedCourse])

  async function run(fn: () => Promise<void>) {
    try {
      setBusy(true)
      await fn()
      await loadAccess(selectedCourse)
    } catch (e) {
      showToast({ title: 'Error', description: e instanceof Error ? e.message : 'Action failed', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const label = (id: string) => {
    const u = usersById.get(id)
    return u ? `${u.name || u.email} (${u.email})` : id
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="glass space-y-6 rounded-xl border border-white/10 p-5">
      <div>
        <label className="mb-1.5 flex items-center gap-2 text-caption font-medium text-foreground">
          <BookOpen className="h-4 w-4" /> Course
        </label>
        <select className={inputClass} value={selectedCourse} onChange={(e) => setSelectedCourse(e.target.value)}>
          {courses.map((c) => (
            <option key={c.course_code} value={c.course_code}>
              {c.course_code} — {c.title}
            </option>
          ))}
        </select>
        {courses.length === 0 && <p className="mt-2 text-caption text-muted-foreground">No courses available.</p>}
      </div>

      {access && selectedCourse && (
        <div className="grid gap-6 md:grid-cols-3">
          {/* Owner */}
          <div className="space-y-2">
            <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">Owner</h3>
            <select
              className={inputClass}
              value={access.owner_user_id || ''}
              disabled={busy}
              onChange={(e) => run(() => setCourseOwner(selectedCourse, e.target.value || null))}
            >
              <option value="">— No owner —</option>
              {professors.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.email}
                </option>
              ))}
            </select>
          </div>

          {/* Reviewers */}
          <div className="space-y-2">
            <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">Reviewers</h3>
            <div className="space-y-1.5">
              {access.reviewer_ids.map((id) => (
                <div key={id} className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <span className="truncate text-fine-print text-foreground">{label(id)}</span>
                  <button
                    className="text-fine-print text-red-400 hover:underline"
                    disabled={busy}
                    onClick={() => run(() => removeReviewer(selectedCourse, id))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {access.reviewer_ids.length === 0 && (
                <p className="text-fine-print text-muted-foreground">No reviewers assigned.</p>
              )}
            </div>
            <select
              className={inputClass}
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && run(() => assignReviewer(selectedCourse, e.target.value))}
            >
              <option value="">+ Add reviewer…</option>
              {professors
                .filter((p) => !access.reviewer_ids.includes(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.email}
                  </option>
                ))}
            </select>
          </div>

          {/* Students */}
          <div className="space-y-2">
            <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">Students</h3>
            <div className="space-y-1.5">
              {access.student_ids.map((id) => (
                <div key={id} className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2">
                  <span className="truncate text-fine-print text-foreground">{label(id)}</span>
                  <button
                    className="text-fine-print text-red-400 hover:underline"
                    disabled={busy}
                    onClick={() => run(() => removeStudent(selectedCourse, id))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {access.student_ids.length === 0 && (
                <p className="text-fine-print text-muted-foreground">No students assigned.</p>
              )}
            </div>
            <select
              className={inputClass}
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && run(() => assignStudent(selectedCourse, e.target.value))}
            >
              <option value="">+ Add student…</option>
              {students
                .filter((s) => !access.student_ids.includes(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.email}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
