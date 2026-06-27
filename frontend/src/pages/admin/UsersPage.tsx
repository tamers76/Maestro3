import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { showToast } from '@/components/ui/Toaster'
import {
  listUsers,
  createUser,
  setUserActive,
  resetUserPassword,
  type ManagedUser,
  type UserRole,
} from '@/services/api'
import { Loader2, UserPlus } from 'lucide-react'

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'professor', label: 'Professor' },
  { value: 'student', label: 'Student' },
  { value: 'admin', label: 'Admin' },
]

/**
 * Decision-button styles shared with the Course Architect / Node Engine layers:
 * light tint at rest, solid on hover. primary = blue, approve = emerald,
 * neutral = slate, destructive = red.
 */
const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-[12px] border px-3 py-1.5 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const PRIMARY_BTN = `${BTN_BASE} border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-600 hover:text-white hover:border-transparent focus-visible:ring-blue-500/40`
const APPROVE_BTN = `${BTN_BASE} border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500 hover:text-white hover:border-transparent focus-visible:ring-emerald-500/40`
const REGEN_BTN = `${BTN_BASE} border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300 hover:bg-slate-600 hover:text-white hover:border-transparent focus-visible:ring-slate-400/40`
const DANGER_BTN = `${BTN_BASE} border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300 hover:bg-red-500 hover:text-white hover:border-transparent focus-visible:ring-red-500/40`
const CARD_SURFACE = 'rounded-[6px] border border-border/50 bg-card'

const inputClass =
  'flex h-11 w-full rounded-[4px] border-2 border-input bg-white/70 dark:bg-white/5 px-4 py-3 text-body text-foreground shadow-[inset_2px_2px_5px_rgb(2_74_216_/_0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function UsersPage() {
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
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Users</h2>
        <p className="text-caption text-muted-foreground">Create accounts and manage access.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <form onSubmit={handleCreate} className={`h-fit space-y-4 p-5 ${CARD_SURFACE}`}>
          <h3 className="flex items-center gap-2 text-body font-semibold text-foreground">
            <UserPlus className="h-4 w-4" /> Create user
          </h3>
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
          <button type="submit" className={`w-full ${PRIMARY_BTN}`} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Create user
          </button>
        </form>

        <div className={`p-5 ${CARD_SURFACE}`}>
          <h3 className="mb-4 text-body font-semibold text-foreground">All users</h3>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-3 rounded-[4px] border border-border/50 bg-muted/30 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-caption font-medium text-foreground">{u.name || u.email}</p>
                    <p className="truncate text-fine-print text-muted-foreground">
                      {u.email} · {u.role}
                      {!u.is_active && <span className="ml-2 text-red-500 dark:text-red-400">inactive</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button type="button" className={REGEN_BTN} onClick={() => handleResetPassword(u)}>
                      Reset PW
                    </button>
                    <button
                      type="button"
                      className={u.is_active ? DANGER_BTN : APPROVE_BTN}
                      onClick={() => toggleActive(u)}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              ))}
              {users.length === 0 && <p className="text-caption text-muted-foreground">No users yet.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
