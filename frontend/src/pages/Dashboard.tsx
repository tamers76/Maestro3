import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Input } from '@/components/ui/Input'
import CourseCard from '@/components/CourseCard'
import { showToast } from '@/components/ui/Toaster'
import {
  fetchCourses,
  deleteCourse,
  listReviewRequests,
  respondReviewRequest,
  fetchReviewCandidates,
  createReviewRequest,
  avatarSrc,
  type CourseListItem,
  type ReviewRequest,
  type ReviewParty,
} from '@/services/api'
import { useAuth } from '@/contexts/AuthContext'
import {
  Plus,
  BookOpen,
  Loader2,
  Sparkles,
  TrendingUp,
  CheckCircle2,
  Clock,
  Target,
  PenTool,
  Video,
  Wand2,
  ClipboardCheck,
  ChevronRight,
  Eye,
  Inbox,
  UserPlus,
  Check,
  X,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'

/* ------------------------------------------------------------------ *
 * Course Dashboard — Material design (Soft UI / elevation) from the
 * ui-ux-pro-max skill, on the HP Electric Blue brand. Scoped to this
 * page via .md-scope; the rest of the app remains on clay until
 * migrated. Gradient icon tiles, flat elevation cards, Inter type.
 * ------------------------------------------------------------------ */

type Tone = 'slate' | 'blue' | 'violet' | 'emerald' | 'amber' | 'rose' | 'teal'

const toneStyles: Record<
  Tone,
  { tile: string; soft: string; text: string; ring: string; glow: string }
> = {
  slate: {
    tile: 'bg-gradient-to-br from-slate-600 to-slate-800 text-white',
    soft: 'bg-slate-100 dark:bg-slate-500/15',
    text: 'text-slate-700 dark:text-slate-300',
    ring: 'focus-visible:ring-slate-500',
    glow: 'shadow-lg shadow-slate-500/40',
  },
  blue: {
    tile: 'bg-gradient-to-br from-[#4d88ef] to-[#024ad8] text-white',
    soft: 'bg-[#eef4ff] dark:bg-[#024ad8]/15',
    text: 'text-[#0e3191] dark:text-[#7aabf5]',
    ring: 'focus-visible:ring-[#296ef9]',
    glow: 'shadow-lg shadow-[#024ad8]/40',
  },
  violet: {
    tile: 'bg-gradient-to-br from-violet-400 to-violet-600 text-white',
    soft: 'bg-violet-50 dark:bg-violet-500/15',
    text: 'text-violet-700 dark:text-violet-300',
    ring: 'focus-visible:ring-violet-500',
    glow: 'shadow-lg shadow-violet-500/40',
  },
  emerald: {
    tile: 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white',
    soft: 'bg-emerald-50 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    ring: 'focus-visible:ring-emerald-500',
    glow: 'shadow-lg shadow-emerald-500/40',
  },
  amber: {
    tile: 'bg-gradient-to-br from-amber-400 to-orange-500 text-white',
    soft: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-700 dark:text-amber-300',
    ring: 'focus-visible:ring-amber-500',
    glow: 'shadow-lg shadow-amber-500/40',
  },
  rose: {
    tile: 'bg-gradient-to-br from-rose-400 to-pink-600 text-white',
    soft: 'bg-rose-50 dark:bg-rose-500/15',
    text: 'text-rose-700 dark:text-rose-300',
    ring: 'focus-visible:ring-rose-500',
    glow: 'shadow-lg shadow-rose-500/40',
  },
  teal: {
    tile: 'bg-gradient-to-br from-teal-400 to-cyan-600 text-white',
    soft: 'bg-teal-50 dark:bg-teal-500/15',
    text: 'text-teal-700 dark:text-teal-300',
    ring: 'focus-visible:ring-teal-500',
    glow: 'shadow-lg shadow-teal-500/40',
  },
}

export default function Dashboard() {
  const { user } = useAuth()
  const isProfessorOrAdmin = user?.role === 'admin' || user?.role === 'professor'
  const [courses, setCourses] = useState<CourseListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; code: string | null }>({
    open: false,
    code: null,
  })
  const [deleting, setDeleting] = useState(false)
  const [capabilityDialog, setCapabilityDialog] = useState<{
    open: boolean
    capability: (typeof capabilities)[number] | null
  }>({
    open: false,
    capability: null,
  })

  // Incoming peer review requests (professors/admins)
  const [reviewRequests, setReviewRequests] = useState<ReviewRequest[]>([])
  const [respondingId, setRespondingId] = useState<string | null>(null)

  // Request-review dialog
  const [requestDialog, setRequestDialog] = useState<{
    open: boolean
    courseCode: string | null
    candidates: ReviewParty[]
    loadingCandidates: boolean
    reviewerId: string
    message: string
    submitting: boolean
  }>({
    open: false,
    courseCode: null,
    candidates: [],
    loadingCandidates: false,
    reviewerId: '',
    message: '',
    submitting: false,
  })

  useEffect(() => {
    loadCourses()
    if (isProfessorOrAdmin) loadReviewRequests()
  }, [isProfessorOrAdmin])

  async function loadCourses() {
    try {
      setLoading(true)
      const data = await fetchCourses()
      setCourses(data)
    } catch (error) {
      showToast({
        title: 'Error',
        description: 'Failed to load courses',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  async function loadReviewRequests() {
    try {
      const data = await listReviewRequests('incoming')
      setReviewRequests(data.filter((r) => r.status === 'pending'))
    } catch {
      /* non-fatal; panel just stays empty */
    }
  }

  async function handleRespond(id: string, action: 'accept' | 'decline') {
    try {
      setRespondingId(id)
      await respondReviewRequest(id, action)
      setReviewRequests((prev) => prev.filter((r) => r.id !== id))
      showToast({
        title: action === 'accept' ? 'Review accepted' : 'Review declined',
        description:
          action === 'accept'
            ? 'The course now appears under "Reviewing".'
            : 'The request has been declined.',
      })
      if (action === 'accept') loadCourses()
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to respond',
        variant: 'destructive',
      })
    } finally {
      setRespondingId(null)
    }
  }

  async function openRequestDialog(courseCode: string) {
    setRequestDialog({
      open: true,
      courseCode,
      candidates: [],
      loadingCandidates: true,
      reviewerId: '',
      message: '',
      submitting: false,
    })
    try {
      const candidates = await fetchReviewCandidates(courseCode)
      setRequestDialog((prev) =>
        prev.courseCode === courseCode ? { ...prev, candidates, loadingCandidates: false } : prev
      )
    } catch (error) {
      setRequestDialog((prev) => ({ ...prev, loadingCandidates: false }))
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load candidates',
        variant: 'destructive',
      })
    }
  }

  async function submitReviewRequest() {
    if (!requestDialog.courseCode || !requestDialog.reviewerId) return
    try {
      setRequestDialog((prev) => ({ ...prev, submitting: true }))
      await createReviewRequest({
        course_code: requestDialog.courseCode,
        reviewer_id: requestDialog.reviewerId,
        message: requestDialog.message.trim() || undefined,
      })
      showToast({ title: 'Review requested', description: 'The professor will see your request.' })
      setRequestDialog((prev) => ({ ...prev, open: false, submitting: false }))
    } catch (error) {
      setRequestDialog((prev) => ({ ...prev, submitting: false }))
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send request',
        variant: 'destructive',
      })
    }
  }

  async function handleDelete() {
    if (!deleteDialog.code) return
    try {
      setDeleting(true)
      await deleteCourse(deleteDialog.code)
      setCourses((prev) => prev.filter((c) => c.course_code !== deleteDialog.code))
      showToast({
        title: 'Course Deleted',
        description: `Course ${deleteDialog.code} has been deleted`,
        variant: 'success',
      })
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete course',
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
      setDeleteDialog({ open: false, code: null })
    }
  }

  const totalCourses = courses.length
  const completedCourses = courses.filter((c) => c.current_stage === 5).length
  const inProgressCourses = courses.filter((c) => c.current_stage > 0 && c.current_stage < 5).length
  const notStartedCourses = courses.filter((c) => c.current_stage === 0).length

  const reviewingCourses = courses.filter((c) => c.access === 'reviewer')
  const myCourses = courses.filter((c) => c.access !== 'reviewer')

  const capabilities = [
    {
      title: 'CLO Mapping',
      description:
        "AI-powered course learning outcome extraction and alignment with Bloom's taxonomy",
      icon: Target,
      tone: 'violet' as Tone,
      details: {
        subtitle: 'Intelligent Learning Outcome Analysis',
        body: "Maestro automatically extracts and maps Course Learning Outcomes (CLOs) from uploaded syllabi. Using advanced NLP, it identifies cognitive levels based on Bloom's Taxonomy (Remember, Understand, Apply, Analyze, Evaluate, Create) and ensures balanced distribution across the curriculum.",
        features: [
          'Automatic CLO extraction from syllabus documents (PDF, DOCX)',
          "Bloom's Taxonomy cognitive level classification",
          'CLO-to-week mapping with fair distribution analysis',
          'Interactive graph visualization of CLO relationships',
          'Editable CLO text with real-time validation',
        ],
      },
    },
    {
      title: 'Smart Assessments',
      description:
        'Automated generation of assessments aligned to CLOs with cognitive level targeting',
      icon: ClipboardCheck,
      tone: 'blue' as Tone,
      details: {
        subtitle: 'AI-Driven Assessment Design',
        body: 'Maestro generates comprehensive assessments that are directly aligned to your Course Learning Outcomes. Each assessment targets specific cognitive levels and ensures complete CLO coverage across your course, following best practices in outcome-based education.',
        features: [
          'Assessment items mapped to specific CLOs and cognitive levels',
          'Multiple assessment types: quizzes, assignments, projects, exams',
          'Automatic alignment verification with learning outcomes',
          'Cognitive level balancing across all assessments',
          'Customizable assessment parameters and grading weights',
        ],
      },
    },
    {
      title: 'Rubric Builder',
      description: 'Intelligent rubric creation with criteria, descriptors, and scoring levels',
      icon: PenTool,
      tone: 'amber' as Tone,
      details: {
        subtitle: 'Automated Rubric Generation',
        body: 'Maestro creates detailed, criterion-referenced rubrics for each assessment. Each rubric includes clear performance descriptors across multiple achievement levels, ensuring transparent and consistent grading aligned with the targeted learning outcomes.',
        features: [
          'Multi-level rubrics with detailed performance descriptors',
          'Criteria directly linked to CLOs and cognitive targets',
          'Configurable scoring levels (e.g., Excellent, Good, Satisfactory, Needs Improvement)',
          'Exportable rubric documents for LMS integration',
          'Consistency checks across rubric criteria and weights',
        ],
      },
    },
    {
      title: 'Content Generation',
      description: 'Video scripts, teaching guides, and multimedia content powered by AI council',
      icon: Video,
      tone: 'emerald' as Tone,
      details: {
        subtitle: 'Multi-Model AI Content Studio',
        body: "Maestro's most powerful stage leverages an AI Council — multiple language models deliberating together — to produce rich educational content. The council approach ensures diverse perspectives and higher quality output through collective intelligence synthesis.",
        features: [
          'Video lecture scripts with structured talking points',
          'Teaching guides with pedagogical strategies',
          'AI Council mode: multiple models collaborate for best results',
          'Chairman model synthesizes council member outputs',
          'Bulk export of all generated content as downloadable packages',
        ],
      },
    },
  ]

  const stats: {
    label: string
    value: number
    subtitle: string
    icon: typeof BookOpen
    tone: Tone
  }[] = [
    {
      label: 'Total Courses',
      value: totalCourses,
      subtitle: 'All courses',
      icon: BookOpen,
      tone: 'slate',
    },
    {
      label: 'In Progress',
      value: inProgressCourses,
      subtitle: 'Being processed',
      icon: TrendingUp,
      tone: 'blue',
    },
    {
      label: 'Completed',
      value: completedCourses,
      subtitle: 'All stages done',
      icon: CheckCircle2,
      tone: 'emerald',
    },
    {
      label: 'Not Started',
      value: notStartedCourses,
      subtitle: 'Awaiting processing',
      icon: Clock,
      tone: 'rose',
    },
  ]

  return (
    <div className="md-scope space-y-8">
      {/* Welcome header — slim Material card */}
      <div className="md-card flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-[#0e3191] dark:text-[#7aabf5]">
            Welcome back{user ? `, ${user.name || user.email}` : ''}
          </span>
          <h1 className="mt-1.5 text-3xl font-bold tracking-tight text-foreground">
            Course Dashboard
          </h1>
          <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
            Manage your adaptive curriculum courses in one place.
          </p>
        </div>
        <Link to="/courses/new" className="shrink-0">
          <button className="md-btn inline-flex items-center gap-2 bg-gradient-to-br from-[#296ef9] to-[#024ad8] px-5 py-3 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" />
            New Course
          </button>
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const t = toneStyles[stat.tone]
          return (
            <div
              key={stat.label}
              className="md-card md-card-interactive relative px-5 pb-4 pt-0"
            >
              <div className="flex items-start justify-between">
                <div
                  className={`md-tile -mt-6 inline-flex h-14 w-14 items-center justify-center ${t.tile} ${t.glow}`}
                >
                  <stat.icon className="h-7 w-7" />
                </div>
                <div className="pt-5 text-right">
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold tracking-tight text-foreground">
                    {loading ? '—' : stat.value}
                  </p>
                </div>
              </div>
              <div className="mt-3 border-t border-border/70 pt-3">
                <p className="text-xs text-muted-foreground">{stat.subtitle}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Review Requests panel (incoming, pending) */}
      {isProfessorOrAdmin && reviewRequests.length > 0 && (
        <section>
          <h3 className="mb-4 flex items-center gap-2.5 text-lg font-bold text-foreground">
            <span className="md-tile inline-flex h-8 w-8 items-center justify-center bg-gradient-to-br from-amber-400 to-orange-500 text-white">
              <Inbox className="h-4 w-4" />
            </span>
            Review Requests
            <span className="md-pill inline-flex items-center justify-center bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              {reviewRequests.length}
            </span>
          </h3>
          <div className="space-y-3">
            {reviewRequests.map((req) => (
              <div
                key={req.id}
                className="md-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  {avatarSrc(req.requester?.avatar_url) ? (
                    <img
                      src={avatarSrc(req.requester?.avatar_url)!}
                      alt={req.requester?.name || ''}
                      className="h-11 w-11 flex-shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="md-tile flex h-11 w-11 flex-shrink-0 items-center justify-center bg-gradient-to-br from-[#4d88ef] to-[#024ad8] text-white">
                      <UserPlus className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">
                      <span className="font-bold">
                        {req.requester?.name || req.requester?.email || 'A professor'}
                      </span>{' '}
                      asked you to review{' '}
                      <span className="font-bold">{req.course_title}</span>
                      <span className="text-muted-foreground"> ({req.course_code})</span>
                    </p>
                    {req.message && (
                      <p className="mt-1 text-sm italic text-muted-foreground">"{req.message}"</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    className="md-btn inline-flex items-center gap-1.5 bg-gradient-to-br from-emerald-400 to-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    disabled={respondingId === req.id}
                    onClick={() => handleRespond(req.id, 'accept')}
                  >
                    {respondingId === req.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    Accept
                  </button>
                  <button
                    className="md-btn-soft inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-60"
                    disabled={respondingId === req.id}
                    onClick={() => handleRespond(req.id, 'decline')}
                  >
                    <X className="h-4 w-4" />
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Course grid */}
      {loading ? (
        <div className="grid gap-5 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="md-card p-6">
              <div className="flex items-center gap-3">
                <div className="h-6 w-20 animate-pulse rounded-full bg-foreground/10" />
                <div className="h-5 w-16 animate-pulse rounded-full bg-foreground/10" />
              </div>
              <div className="mt-4 h-5 w-3/4 animate-pulse rounded-lg bg-foreground/10" />
              <div className="mt-2 h-4 w-1/2 animate-pulse rounded-lg bg-foreground/10" />
              <div className="mt-6 h-3 w-full animate-pulse rounded-full bg-foreground/10" />
              <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                <div className="h-4 w-24 animate-pulse rounded-lg bg-foreground/10" />
                <div className="h-9 w-20 animate-pulse rounded-xl bg-foreground/10" />
              </div>
            </div>
          ))}
        </div>
      ) : courses.length === 0 ? (
        <div className="md-dashed flex h-64 flex-col items-center justify-center bg-muted/30">
          <div className="md-tile inline-flex h-16 w-16 items-center justify-center bg-gradient-to-br from-[#4d88ef] to-[#024ad8] text-white">
            <BookOpen className="h-8 w-8" />
          </div>
          <h3 className="mt-4 text-lg font-bold text-foreground">No courses yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Upload a syllabus to get started</p>
          <Link to="/courses/new" className="mt-5">
            <button className="md-btn inline-flex items-center gap-2 bg-gradient-to-br from-[#296ef9] to-[#024ad8] px-5 py-2.5 text-sm font-semibold text-white">
              <Plus className="h-4 w-4" />
              Create Your First Course
            </button>
          </Link>
        </div>
      ) : (
        <>
          {/* My Courses */}
          <section>
            <h3 className="mb-4 flex items-center gap-2.5 text-lg font-bold text-foreground">
              <span className="md-tile inline-flex h-8 w-8 items-center justify-center bg-gradient-to-br from-[#4d88ef] to-[#024ad8] text-white">
                <Sparkles className="h-4 w-4" />
              </span>
              My Courses
            </h3>
            {myCourses.length === 0 ? (
              <p className="text-sm text-muted-foreground">You don't own any courses yet.</p>
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                {myCourses.map((course) => (
                  <CourseCard
                    key={course.course_code}
                    course={course}
                    canDelete={user?.role === 'admin' || course.access === 'owner'}
                    onDelete={(code) => setDeleteDialog({ open: true, code })}
                    onRequestReview={
                      course.access === 'owner' || course.access === 'admin'
                        ? openRequestDialog
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {/* Reviewing */}
          {reviewingCourses.length > 0 && (
            <section>
              <h3 className="mb-4 flex items-center gap-2.5 text-lg font-bold text-foreground">
                <span className="md-tile inline-flex h-8 w-8 items-center justify-center bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                  <Eye className="h-4 w-4" />
                </span>
                Reviewing
              </h3>
              <div className="grid gap-5 md:grid-cols-2">
                {reviewingCourses.map((course) => (
                  <CourseCard
                    key={course.course_code}
                    course={course}
                    canDelete={false}
                    onDelete={(code) => setDeleteDialog({ open: true, code })}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Platform Capabilities */}
      <section>
        <h3 className="mb-4 flex items-center gap-2.5 text-lg font-bold text-foreground">
          <span className="md-tile inline-flex h-8 w-8 items-center justify-center bg-gradient-to-br from-violet-400 to-violet-600 text-white">
            <Wand2 className="h-4 w-4" />
          </span>
          Maestro Capabilities
        </h3>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {capabilities.map((cap) => {
            const t = toneStyles[cap.tone]
            return (
              <button
                key={cap.title}
                onClick={() => setCapabilityDialog({ open: true, capability: cap })}
                className={`md-card md-card-interactive group cursor-pointer p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${t.ring}`}
              >
                <div className="flex items-start justify-between">
                  <div
                    className={`md-tile inline-flex h-12 w-12 items-center justify-center ${t.tile}`}
                  >
                    <cap.icon className="h-6 w-6" />
                  </div>
                  <ChevronRight
                    className={`h-5 w-5 ${t.text} opacity-0 transition-opacity group-hover:opacity-100`}
                  />
                </div>
                <div className="mt-4 border-t border-border/70 pt-3">
                  <h4 className="text-sm font-semibold text-foreground">{cap.title}</h4>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {cap.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* Capability Detail Dialog */}
      <Dialog
        open={capabilityDialog.open}
        onOpenChange={(open) =>
          setCapabilityDialog({ open, capability: capabilityDialog.capability })
        }
      >
        <DialogContent className="md-scope sm:max-w-xl">
          {capabilityDialog.capability &&
            (() => {
              const cap = capabilityDialog.capability
              const t = toneStyles[cap.tone]
              return (
                <>
                  <DialogHeader>
                    <div className="mb-2 flex items-center gap-4">
                      <div
                        className={`md-tile inline-flex h-14 w-14 items-center justify-center ${t.tile}`}
                      >
                        <cap.icon className="h-7 w-7" />
                      </div>
                      <div>
                        <DialogTitle className="text-xl font-bold">{cap.title}</DialogTitle>
                        <p className={`mt-0.5 text-sm font-semibold ${t.text}`}>
                          {cap.details.subtitle}
                        </p>
                      </div>
                    </div>
                    <DialogDescription className="pt-2 text-base leading-relaxed">
                      {cap.details.body}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-4">
                    <h4 className="mb-3 text-sm font-bold text-foreground">Key Features</h4>
                    <ul className="space-y-2.5">
                      {cap.details.features.map((feature, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500" />
                          <span className="text-sm leading-relaxed text-muted-foreground">
                            {feature}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <DialogFooter className="mt-6">
                    <button
                      onClick={() => setCapabilityDialog({ open: false, capability: null })}
                      className="md-btn bg-gradient-to-br from-[#296ef9] to-[#024ad8] px-5 py-2.5 text-sm font-semibold text-white"
                    >
                      Got it
                    </button>
                  </DialogFooter>
                </>
              )
            })()}
        </DialogContent>
      </Dialog>

      {/* Request Review Dialog */}
      <Dialog
        open={requestDialog.open}
        onOpenChange={(open) => setRequestDialog((prev) => ({ ...prev, open }))}
      >
        <DialogContent className="md-scope sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Request a review</DialogTitle>
            <DialogDescription className="text-base">
              Ask another professor to review{' '}
              <strong className="text-foreground">{requestDialog.courseCode}</strong>. They'll be
              able to accept or decline.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-caption font-semibold text-foreground">Reviewer</label>
              {requestDialog.loadingCandidates ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading professors...
                </div>
              ) : requestDialog.candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No eligible professors available to request.
                </p>
              ) : (
                <select
                  value={requestDialog.reviewerId}
                  onChange={(e) =>
                    setRequestDialog((prev) => ({ ...prev, reviewerId: e.target.value }))
                  }
                  className="md-chip flex h-11 w-full border border-input bg-background px-4 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select a professor…</option>
                  {requestDialog.candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name ? `${c.name} (${c.email})` : c.email}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-caption font-semibold text-foreground">Message (optional)</label>
              <Input
                value={requestDialog.message}
                placeholder="Add a short note…"
                onChange={(e) =>
                  setRequestDialog((prev) => ({ ...prev, message: e.target.value }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <button
              className="md-btn-soft px-5 py-2.5 text-sm font-semibold text-foreground"
              onClick={() => setRequestDialog((prev) => ({ ...prev, open: false }))}
            >
              Cancel
            </button>
            <button
              onClick={submitReviewRequest}
              disabled={
                requestDialog.submitting ||
                !requestDialog.reviewerId ||
                requestDialog.loadingCandidates
              }
              className="md-btn inline-flex items-center gap-2 bg-gradient-to-br from-[#296ef9] to-[#024ad8] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {requestDialog.submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Send request
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, code: deleteDialog.code })}
      >
        <DialogContent className="md-scope">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Delete Course</DialogTitle>
            <DialogDescription className="text-base">
              Are you sure you want to delete course{' '}
              <strong className="text-foreground">{deleteDialog.code}</strong>? This will remove all
              associated data including CLOs, learning nodes, and generated content. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              className="md-btn-soft px-5 py-2.5 text-sm font-semibold text-foreground"
              onClick={() => setDeleteDialog({ open: false, code: null })}
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="md-btn inline-flex items-center gap-2 bg-gradient-to-br from-rose-500 to-red-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {deleting && <Loader2 className="h-5 w-5 animate-spin" />}
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
