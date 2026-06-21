import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import StageProgress from './StageProgress'
import { formatDate } from '@/lib/utils'
import { ArrowRight, Trash2, UserPlus, Eye } from 'lucide-react'
import type { CourseListItem } from '@/services/api'

interface CourseCardProps {
  course: CourseListItem
  onDelete: (code: string) => void
  onRequestReview?: (code: string) => void
  canDelete?: boolean
}

export default function CourseCard({ course, onDelete, onRequestReview, canDelete = true }: CourseCardProps) {
  const isReviewing = course.access === 'reviewer'
  const ownerDisplay =
    course.owner_name ||
    course.owner_email ||
    (course.access === 'owner' ? 'You' : course.owner_user_id || 'Unassigned')
  const reviewerNames = (course.reviewers ?? [])
    .map((r) => r.name || r.email || r.user_id)
    .filter(Boolean) as string[]
  return (
    <div className="group relative rounded-2xl bg-white dark:bg-card border border-slate-100 dark:border-border p-6 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
      {/* Top accent bar */}
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-violet-500 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider">
              {course.course_code}
            </p>
            {isReviewing && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <Eye className="h-3 w-3" /> Reviewing
              </span>
            )}
          </div>
          <h3 className="mt-2 text-base font-bold text-black dark:text-foreground line-clamp-2 leading-snug">
            {course.title}
          </h3>
          <p className="mt-1 text-xs text-black/55 dark:text-muted-foreground">
            Owner: <span className="font-semibold text-black/75 dark:text-foreground/90">{ownerDisplay}</span>
          </p>
          <p className="mt-0.5 text-xs text-black/55 dark:text-muted-foreground">
            {reviewerNames.length > 0 ? (
              <>
                Reviewers:{' '}
                <span className="font-semibold text-black/75 dark:text-foreground/90">
                  {reviewerNames.join(', ')}
                </span>
              </>
            ) : (
              <>Reviewers: <span className="text-black/45 dark:text-muted-foreground/80">None</span></>
            )}
          </p>
        </div>
        {canDelete && (
          <Button
            variant="ghost"
            size="icon"
            title="Delete course"
            className="opacity-0 group-hover:opacity-100 transition-opacity text-black/40 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 h-9 w-9 -mt-1 -mr-1"
            onClick={(e) => {
              e.preventDefault()
              onDelete(course.course_code)
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      
      <div className="mt-5">
        <StageProgress currentStage={course.current_stage} compact />
      </div>
      
      <div className="mt-5 flex items-center justify-between pt-4 border-t border-slate-100 dark:border-border">
        <span className="text-sm text-black/50 dark:text-muted-foreground">
          Updated {formatDate(course.updated_at)}
        </span>
        <div className="flex items-center gap-1.5">
          {onRequestReview && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-black/60 dark:text-muted-foreground hover:text-violet-700 hover:bg-violet-50 dark:hover:bg-violet-500/10 h-9 text-sm font-semibold rounded-lg px-3"
              onClick={(e) => {
                e.preventDefault()
                onRequestReview(course.course_code)
              }}
            >
              <UserPlus className="h-4 w-4" />
              Request review
            </Button>
          )}
          <Link to={`/courses/${encodeURIComponent(course.course_code)}`}>
            <Button variant="ghost" size="sm" className="gap-1.5 group/btn text-violet-600 dark:text-violet-400 hover:text-violet-700 hover:bg-violet-50 dark:hover:bg-violet-500/10 h-9 text-sm font-semibold rounded-lg px-3">
              Open 
              <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
