import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
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

const inputClass =
  'flex h-11 w-full rounded-md border border-input bg-white/55 dark:bg-white/5 backdrop-blur-md px-4 py-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

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
        <form onSubmit={handleCreate} className="glass h-fit space-y-4 rounded-xl border border-white/10 p-5">
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
          <Button type="submit" className="w-full" disabled={creating}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create user
          </Button>
        </form>

        <div className="glass rounded-xl border border-white/10 p-5">
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
    </div>
  )
}
