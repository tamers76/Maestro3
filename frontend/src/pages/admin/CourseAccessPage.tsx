import { useEffect, useMemo, useState } from 'react'
import { showToast } from '@/components/ui/Toaster'
import {
  fetchCourses,
  listUsers,
  fetchCourseAccess,
  setCourseOwner,
  assignReviewer,
  removeReviewer,
  assignStudent,
  removeStudent,
  type ManagedUser,
  type CourseListItem,
  type CourseAccess,
} from '@/services/api'
import { Loader2, BookOpen } from 'lucide-react'

const inputClass =
  'flex h-11 w-full rounded-md border border-input bg-white/55 dark:bg-white/5 backdrop-blur-md px-4 py-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function CourseAccessPage() {
  const [courses, setCourses] = useState<CourseListItem[]>([])
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [selectedCourse, setSelectedCourse] = useState('')
  const [access, setAccess] = useState<CourseAccess | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [ownerDraftId, setOwnerDraftId] = useState('')

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

  useEffect(() => {
    setOwnerDraftId(access?.owner_user_id ?? '')
  }, [access?.owner_user_id])

  async function run(fn: () => Promise<void>, successMessage?: string) {
    try {
      setBusy(true)
      await fn()
      await loadAccess(selectedCourse)
      if (successMessage) {
        showToast({ title: 'Saved', description: successMessage, variant: 'success' })
      }
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
  const ownerChanged = (access?.owner_user_id ?? '') !== ownerDraftId

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Course Access</h2>
        <p className="text-caption text-muted-foreground">Assign course owners, reviewers, and students.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
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
                  value={ownerDraftId}
                  disabled={busy}
                  onChange={(e) => setOwnerDraftId(e.target.value)}
                >
                  <option value="">— No owner —</option>
                  {professors.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.email}
                    </option>
                  ))}
                </select>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="rounded-md bg-primary px-3 py-1.5 text-fine-print font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={busy || !ownerChanged}
                    onClick={() =>
                      run(
                        () => setCourseOwner(selectedCourse, ownerDraftId || null),
                        'Course owner updated'
                      )
                    }
                  >
                    Save owner
                  </button>
                </div>
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
                        onClick={() => run(() => removeReviewer(selectedCourse, id), 'Reviewer removed')}
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
                  onChange={(e) =>
                    e.target.value &&
                    run(() => assignReviewer(selectedCourse, e.target.value), 'Reviewer assigned')
                  }
                >
                  <option value="">+ Add reviewer…</option>
                  {professors
                    .filter((p) => !access.reviewer_ids.includes(p.id) && p.id !== ownerDraftId)
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
                        onClick={() => run(() => removeStudent(selectedCourse, id), 'Student removed')}
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
                  onChange={(e) =>
                    e.target.value && run(() => assignStudent(selectedCourse, e.target.value), 'Student assigned')
                  }
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
      )}
    </div>
  )
}
