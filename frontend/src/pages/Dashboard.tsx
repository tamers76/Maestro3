import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import CourseCard from '@/components/CourseCard'
import { showToast } from '@/components/ui/Toaster'
import { fetchCourses, deleteCourse, type CourseListItem } from '@/services/api'
import { Plus, BookOpen, Loader2, Sparkles, TrendingUp, CheckCircle2, Clock, Target, PenTool, Video, Wand2, ClipboardCheck, ChevronRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'

export default function Dashboard() {
  const [courses, setCourses] = useState<CourseListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; code: string | null }>({
    open: false,
    code: null,
  })
  const [deleting, setDeleting] = useState(false)
  const [capabilityDialog, setCapabilityDialog] = useState<{ open: boolean; capability: typeof capabilities[number] | null }>({
    open: false,
    capability: null,
  })
  
  useEffect(() => {
    loadCourses()
  }, [])
  
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
  
  async function handleDelete() {
    if (!deleteDialog.code) return
    
    try {
      setDeleting(true)
      await deleteCourse(deleteDialog.code)
      setCourses(prev => prev.filter(c => c.course_code !== deleteDialog.code))
      showToast({
        title: 'Course Deleted',
        description: `Course ${deleteDialog.code} has been deleted`,
        variant: 'success',
      })
    } catch (error) {
      showToast({
        title: 'Error',
        description: 'Failed to delete course',
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
      setDeleteDialog({ open: false, code: null })
    }
  }

  const totalCourses = courses.length
  const completedCourses = courses.filter(c => c.current_stage === 5).length
  const inProgressCourses = courses.filter(c => c.current_stage > 0 && c.current_stage < 5).length
  const notStartedCourses = courses.filter(c => c.current_stage === 0).length
  
  const capabilities = [
    {
      title: 'CLO Mapping',
      description: 'AI-powered course learning outcome extraction and alignment with Bloom\'s taxonomy',
      icon: Target,
      gradient: 'from-violet-500 to-purple-600',
      details: {
        subtitle: 'Intelligent Learning Outcome Analysis',
        body: 'Maestro automatically extracts and maps Course Learning Outcomes (CLOs) from uploaded syllabi. Using advanced NLP, it identifies cognitive levels based on Bloom\'s Taxonomy (Remember, Understand, Apply, Analyze, Evaluate, Create) and ensures balanced distribution across the curriculum.',
        features: [
          'Automatic CLO extraction from syllabus documents (PDF, DOCX)',
          'Bloom\'s Taxonomy cognitive level classification',
          'CLO-to-week mapping with fair distribution analysis',
          'Interactive graph visualization of CLO relationships',
          'Editable CLO text with real-time validation',
        ],
      },
    },
    {
      title: 'Smart Assessments',
      description: 'Automated generation of assessments aligned to CLOs with cognitive level targeting',
      icon: ClipboardCheck,
      gradient: 'from-blue-500 to-cyan-600',
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
      gradient: 'from-amber-500 to-orange-600',
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
      gradient: 'from-emerald-500 to-teal-600',
      details: {
        subtitle: 'Multi-Model AI Content Studio',
        body: 'Maestro\'s most powerful stage leverages an AI Council — multiple language models deliberating together — to produce rich educational content. The council approach ensures diverse perspectives and higher quality output through collective intelligence synthesis.',
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

  const stats = [
    {
      label: 'Total Courses',
      value: totalCourses,
      subtitle: 'All courses',
      icon: BookOpen,
      iconBg: 'bg-violet-100 dark:bg-violet-500/20',
      iconColor: 'text-violet-600 dark:text-violet-400',
    },
    {
      label: 'In Progress',
      value: inProgressCourses,
      subtitle: 'Being processed',
      icon: TrendingUp,
      iconBg: 'bg-blue-100 dark:bg-blue-500/20',
      iconColor: 'text-blue-600 dark:text-blue-400',
    },
    {
      label: 'Completed',
      value: completedCourses,
      subtitle: 'All stages done',
      icon: CheckCircle2,
      iconBg: 'bg-emerald-100 dark:bg-emerald-500/20',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Not Started',
      value: notStartedCourses,
      subtitle: 'Awaiting processing',
      icon: Clock,
      iconBg: 'bg-amber-100 dark:bg-amber-500/20',
      iconColor: 'text-amber-600 dark:text-amber-400',
    },
  ]

  return (
    <div className="space-y-8">
      {/* Welcome & Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-base font-medium text-violet-600 dark:text-violet-400">
            Welcome back, Prof. Ahmed
          </p>
          <h1 className="text-3xl font-bold text-black dark:text-foreground mt-1">
            Course Dashboard
          </h1>
          <p className="mt-1 text-base text-black/60 dark:text-muted-foreground">
            Manage your adaptive curriculum courses
          </p>
        </div>
        <Link to="/courses/new">
          <Button className="gap-2.5 bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-600/25 rounded-xl px-6 py-3 h-auto text-base font-semibold">
            <Plus className="h-5 w-5" />
            New Course
          </Button>
        </Link>
      </div>
      
      {/* Stat Cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div 
            key={stat.label}
            className="group rounded-2xl bg-white dark:bg-card border border-slate-100 dark:border-border p-6 shadow-sm hover:shadow-md transition-all duration-300"
          >
            <div className="flex items-start justify-between">
              <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${stat.iconBg} transition-transform duration-300 group-hover:scale-110`}>
                <stat.icon className={`h-7 w-7 ${stat.iconColor}`} />
              </div>
            </div>
            <div className="mt-5">
              <p className="text-4xl font-bold text-black dark:text-foreground">
                {loading ? '—' : stat.value}
              </p>
              <p className="text-base font-semibold text-black/70 dark:text-muted-foreground mt-1">
                {stat.label}
              </p>
            </div>
            <p className="mt-1 text-sm text-black/50 dark:text-muted-foreground/70">
              {stat.subtitle}
            </p>
          </div>
        ))}
      </div>

      {/* Course Grid */}
      <div>
        <h3 className="text-lg font-bold text-black dark:text-foreground mb-5 flex items-center gap-2.5">
          <Sparkles className="h-5 w-5 text-violet-500" />
          Your Courses
        </h3>
        
        {loading ? (
          <div className="flex h-56 items-center justify-center rounded-2xl bg-white dark:bg-card border border-slate-100 dark:border-border">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-9 w-9 animate-spin text-violet-500" />
              <p className="text-base text-black/50 dark:text-muted-foreground">Loading courses...</p>
            </div>
          </div>
        ) : courses.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 dark:border-border bg-white/50 dark:bg-card/50">
            <div className="rounded-full bg-violet-100 dark:bg-violet-500/20 p-4">
              <BookOpen className="h-10 w-10 text-violet-500" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-black dark:text-foreground">No courses yet</h3>
            <p className="mt-1 text-sm text-black/50 dark:text-muted-foreground">
              Upload a syllabus to get started
            </p>
            <Link to="/courses/new" className="mt-4">
              <Button className="bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-600/20 rounded-xl text-sm font-semibold px-5 py-2.5 h-auto">
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Course
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {courses.map(course => (
              <CourseCard
                key={course.course_code}
                course={course}
                onDelete={code => setDeleteDialog({ open: true, code })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Platform Capabilities */}
      <div>
        <h3 className="text-lg font-bold text-black dark:text-foreground mb-5 flex items-center gap-2.5">
          <Wand2 className="h-5 w-5 text-violet-500" />
          Maestro Capabilities
        </h3>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {capabilities.map((cap) => (
            <button
              key={cap.title}
              onClick={() => setCapabilityDialog({ open: true, capability: cap })}
              className="group rounded-2xl bg-white dark:bg-card border border-slate-100 dark:border-border p-6 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden relative text-left cursor-pointer"
            >
              <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${cap.gradient} opacity-60 group-hover:opacity-100 transition-opacity`} />
              <div className={`inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${cap.gradient} text-white mb-4 transition-transform duration-300 group-hover:scale-110`}>
                <cap.icon className="h-6 w-6" />
              </div>
              <h4 className="text-base font-bold text-black dark:text-foreground">
                {cap.title}
              </h4>
              <p className="mt-2 text-sm text-black/60 dark:text-muted-foreground leading-relaxed">
                {cap.description}
              </p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-violet-600 dark:text-violet-400 opacity-0 group-hover:opacity-100 transition-opacity">
                Learn more <ChevronRight className="h-4 w-4" />
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Capability Detail Dialog */}
      <Dialog open={capabilityDialog.open} onOpenChange={open => setCapabilityDialog({ open, capability: capabilityDialog.capability })}>
        <DialogContent className="sm:max-w-xl">
          {capabilityDialog.capability && (() => {
            const cap = capabilityDialog.capability
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-4 mb-2">
                    <div className={`inline-flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br ${cap.gradient} text-white`}>
                      <cap.icon className="h-7 w-7" />
                    </div>
                    <div>
                      <DialogTitle className="text-xl">{cap.title}</DialogTitle>
                      <p className="text-sm font-medium text-violet-600 dark:text-violet-400 mt-0.5">
                        {cap.details.subtitle}
                      </p>
                    </div>
                  </div>
                  <DialogDescription className="text-base leading-relaxed pt-2">
                    {cap.details.body}
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-4">
                  <h4 className="text-sm font-bold text-black dark:text-foreground mb-3">Key Features</h4>
                  <ul className="space-y-2.5">
                    {cap.details.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-black/70 dark:text-muted-foreground leading-relaxed">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <DialogFooter className="mt-6">
                  <Button
                    onClick={() => setCapabilityDialog({ open: false, capability: null })}
                    className="bg-violet-600 hover:bg-violet-700 text-white rounded-xl px-6 py-2.5 h-auto text-sm font-semibold"
                  >
                    Got it
                  </Button>
                </DialogFooter>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
      
      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={open => setDeleteDialog({ open, code: deleteDialog.code })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl">Delete Course</DialogTitle>
            <DialogDescription className="text-base">
              Are you sure you want to delete course <strong className="text-foreground">{deleteDialog.code}</strong>? 
              This will remove all associated data including CLOs, learning nodes, and generated content.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialog({ open: false, code: null })}
              className="text-base px-5 py-2.5 h-auto"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="text-base px-5 py-2.5 h-auto"
            >
              {deleting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
