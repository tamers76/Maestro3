import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { showToast } from '@/components/ui/Toaster'
import { useAuth } from '@/contexts/AuthContext'
import { avatarSrc, changePassword } from '@/services/api'
import { resizeImageToSquare } from '@/lib/image'
import { Loader2, Upload, User as UserIcon, KeyRound, Save } from 'lucide-react'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  professor: 'Professor',
  student: 'Student',
}

export default function Profile() {
  const { user, updateProfile, uploadAvatar } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    name: '',
    email: '',
    title: '',
    department: '',
    bio: '',
    phone: '',
  })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' })
  const [changingPwd, setChangingPwd] = useState(false)

  useEffect(() => {
    if (user) {
      setForm({
        name: user.name ?? '',
        email: user.email ?? '',
        title: user.title ?? '',
        department: user.department ?? '',
        bio: user.bio ?? '',
        phone: user.phone ?? '',
      })
    }
  }, [user])

  if (!user) return null

  const initials = (user.name || user.email || '?')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) {
      showToast({ title: 'Name required', description: 'Please enter your name.', variant: 'destructive' })
      return
    }
    try {
      setSaving(true)
      await updateProfile({
        name: form.name.trim(),
        email: form.email.trim(),
        title: form.title.trim(),
        department: form.department.trim(),
        bio: form.bio,
        phone: form.phone.trim(),
      })
      showToast({ title: 'Profile saved', description: 'Your changes have been saved.' })
    } catch (err) {
      showToast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save profile',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setUploading(true)
      // Resize + center-crop in the browser so any photo fits the 2MB cap and
      // fills the circular avatar cleanly.
      const processed = await resizeImageToSquare(file)
      await uploadAvatar(processed)
      showToast({ title: 'Avatar updated' })
    } catch (err) {
      showToast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to upload avatar',
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (pwd.next.length < 8) {
      showToast({
        title: 'Password too short',
        description: 'New password must be at least 8 characters.',
        variant: 'destructive',
      })
      return
    }
    if (pwd.next !== pwd.confirm) {
      showToast({
        title: 'Passwords do not match',
        description: 'Please confirm your new password.',
        variant: 'destructive',
      })
      return
    }
    try {
      setChangingPwd(true)
      await changePassword(pwd.current, pwd.next)
      setPwd({ current: '', next: '', confirm: '' })
      showToast({ title: 'Password changed', description: 'Use your new password next time you sign in.' })
    } catch (err) {
      showToast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to change password',
        variant: 'destructive',
      })
    } finally {
      setChangingPwd(false)
    }
  }

  const src = avatarSrc(user.avatar_url)

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Profile</h1>
        <p className="text-caption text-muted-foreground">
          Manage your personal information and account security.
        </p>
      </div>

      {/* Avatar + identity */}
      <div className="glass-strong rounded-2xl p-6">
        <div className="flex items-center gap-5">
          <div className="relative">
            {src ? (
              <img
                src={src}
                alt={user.name || user.email}
                className="h-20 w-20 rounded-full object-cover ring-2 ring-border"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground ring-2 ring-border">
                {initials || <UserIcon className="h-8 w-8" />}
              </div>
            )}
          </div>
          <div className="flex-1">
            <p className="text-lg font-semibold text-foreground">{user.name || user.email}</p>
            <p className="text-caption text-muted-foreground">
              {ROLE_LABELS[user.role] || user.role}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleAvatarChange}
            />
            <Button
              variant="glass"
              size="sm"
              className="mt-3"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Change photo
            </Button>
          </div>
        </div>
      </div>

      {/* Profile fields */}
      <form
        onSubmit={handleSaveProfile}
        className="glass-strong rounded-2xl p-6 space-y-4"
      >
        <h2 className="text-body font-semibold text-foreground">Personal information</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input
              type="text"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Title">
            <Input
              value={form.title}
              placeholder="e.g. Associate Professor"
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="Department">
            <Input
              value={form.department}
              placeholder="e.g. Computer Science"
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Bio">
          <textarea
            value={form.bio}
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
            rows={4}
            className="flex w-full rounded-md border-2 border-input bg-white/70 dark:bg-white/5 px-4 py-3 text-body text-foreground shadow-[inset_2px_2px_5px_rgb(2_74_216_/_0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="A short bio..."
          />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save changes
          </Button>
        </div>
      </form>

      {/* Change password */}
      <form
        onSubmit={handleChangePassword}
        className="glass-strong rounded-2xl p-6 space-y-4"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-body font-semibold text-foreground">Change password</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Current password">
            <Input
              type="password"
              value={pwd.current}
              onChange={(e) => setPwd({ ...pwd, current: e.target.value })}
            />
          </Field>
          <Field label="New password">
            <Input
              type="password"
              value={pwd.next}
              onChange={(e) => setPwd({ ...pwd, next: e.target.value })}
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              type="password"
              value={pwd.confirm}
              onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="glass" disabled={changingPwd}>
            {changingPwd ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <KeyRound className="mr-2 h-4 w-4" />
            )}
            Update password
          </Button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-caption font-medium text-foreground">{label}</span>
      {children}
    </label>
  )
}
