import { Link } from 'react-router-dom'
import StageProgress from './StageProgress'
import { ArrowRight, Trash2, UserPlus, Eye } from 'lucide-react'
import type { CourseListItem } from '@/services/api'

/** Numeric day/month/year, e.g. 21/06/2026. */
function formatNumericDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

interface CourseStatus {
  label: string
  dotClass: string
  pillClass: string
}

/**
 * Map the legacy stage counter to a scannable, color-coded status.
 * Buckets mirror the Dashboard summary (completed=5, in progress=1–4,
 * not started=0) and reuse the in-card progress palette (emerald=done,
 * violet=active) for visual consistency.
 */
function getCourseStatus(stage: number): CourseStatus {
  if (stage >= 5) {
    return {
      label: 'Completed',
      dotClass: 'bg-emerald-500',
      pillClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    }
  }
  if (stage <= 0) {
    return {
      label: 'Not started',
      dotClass: 'bg-amber-500',
      pillClass: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    }
  }
  return {
    label: 'In progress',
    dotClass: 'bg-violet-500',
    pillClass: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  }
}

interface CourseCardProps {
  course: CourseListItem
  onDelete: (code: string) => void
  onRequestReview?: (code: string) => void
  canDelete?: boolean
}

export default function CourseCard({
  course,
  onDelete,
  onRequestReview,
  canDelete = true,
}: CourseCardProps) {
  const isReviewing = course.access === 'reviewer'
  const ownerDisplay =
    course.owner_name ||
    course.owner_email ||
    (course.access === 'owner' ? 'You' : course.owner_user_id || 'Unassigned')
  const reviewerNames = (course.reviewers ?? [])
    .map((r) => r.name || r.email || r.user_id)
    .filter(Boolean) as string[]
  const status = getCourseStatus(course.current_stage)

  return (
    <div className="md-scope md-card md-card-interactive group relative p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="md-chip inline-flex bg-[#eef4ff] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-[#0e3191] dark:bg-[#024ad8]/20 dark:text-[#7aabf5]">
              {course.course_code}
            </span>
            <span
              className={`md-pill inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold ${status.pillClass}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${status.dotClass}`} />
              {status.label}
            </span>
            {isReviewing && (
              <span className="md-pill inline-flex items-center gap-1 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                <Eye className="h-3 w-3" /> Reviewing
              </span>
            )}
          </div>
          <h3 className="mt-2.5 line-clamp-2 text-base font-bold leading-snug text-foreground">
            {course.title}
          </h3>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Owner: <span className="font-semibold text-foreground/90">{ownerDisplay}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {reviewerNames.length > 0 ? (
              <>
                Reviewers:{' '}
                <span className="font-semibold text-foreground/90">{reviewerNames.join(', ')}</span>
              </>
            ) : (
              <>
                Reviewers: <span className="text-muted-foreground/80">None</span>
              </>
            )}
          </p>
        </div>
        {canDelete && (
          <button
            title="Delete course"
            className="-mr-1 -mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-foreground/40 opacity-0 transition-all hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-rose-500/10"
            onClick={(e) => {
              e.preventDefault()
              onDelete(course.course_code)
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-5">
        <StageProgress currentStage={course.current_stage} compact />
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <span className="text-sm text-muted-foreground">
          Updated {formatNumericDate(course.updated_at)}
        </span>
        <div className={onRequestReview ? 'grid grid-cols-2 gap-2' : 'flex'}>
          {onRequestReview && (
            <button
              className="md-btn-soft flex w-full items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-foreground/70 transition-colors hover:text-[#024ad8]"
              onClick={(e) => {
                e.preventDefault()
                onRequestReview(course.course_code)
              }}
            >
              <UserPlus className="h-4 w-4" />
              Request review
            </button>
          )}
          <Link to={`/courses/${encodeURIComponent(course.course_code)}`} className="contents">
            <button className="md-btn group/btn flex w-full items-center justify-center gap-1.5 bg-gradient-to-br from-[#296ef9] to-[#024ad8] px-4 py-2 text-sm font-semibold text-white">
              Open
              <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" />
            </button>
          </Link>
        </div>
      </div>
    </div>
  )
}
