import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import StageProgress from '@/components/StageProgress'
import GraphViewer from '@/components/GraphViewer'
import CytoscapeGraph from '@/components/CytoscapeGraph'
import CLOGraphEditor from '@/components/CLOGraphEditor'
import Stage1Layers from '@/components/Stage1Layers'
import Stage3LogicViewer from '@/components/Stage3LogicViewer'
import { showToast } from '@/components/ui/Toaster'
import { 
  fetchCourse, 
  runStage, 
  fetchGraphData,
  fetchNodeContent,
  getDownloadUrl,
  subscribeToProgress,
  confirmGraph,
  confirmNodeGraph,
  fetchContentPack,
  fetchWorkloadMap,
  fetchRubric,
  fetchAllAssessments,
  fetchAllVideoScripts,
  fetchStage3Snapshot,
  fetchStage3IncompleteReport,
  generateSuggestedCloTopics,
  type CourseDetail as CourseDetailType,
  type GraphData,
  type ProgressUpdate,
  type StageExecutionMode,
  type Stage4ContentPack,
  type WorkloadMap as WorkloadMapType,
  type CourseRubric,
  type AllAssessmentsResponse,
  type AllVideoScriptsResponse,
  type Stage3Snapshot,
  type Stage3IncompleteReport,
} from '@/services/api'
import WorkloadMap from '@/components/WorkloadMap'
import AssessmentViewer from '@/components/AssessmentViewer'
import VideoScriptViewer from '@/components/VideoScriptViewer'
import RubricViewer from '@/components/RubricViewer'
import { NODE_TYPE_COLORS } from '@/lib/utils'
import { 
  ArrowLeft, 
  Play, 
  RefreshCw, 
  Loader2,
  FileText,
  Network,
  ChevronRight,
  Package,
  Users,
  User,
  CheckCircle2,
  AlertCircle,
  Lock,
  Video,
  ClipboardCheck,
  Scale,
  Clock,
  Edit3,
  Shield,
  Boxes,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { cn } from '@/lib/utils'
import { LEGACY_STAGES_ENABLED } from '@/config/featureFlags'
import NodeEnginePanel from '@/components/nodeEngine/NodeEnginePanel'
import ReferenceAlignmentPanel from '@/components/ReferenceAlignmentPanel'

export default function CourseDetail() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  
  const [course, setCourse] = useState<CourseDetailType | null>(null)
  const [stage1AllApproved, setStage1AllApproved] = useState(false)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [runningStage, setRunningStage] = useState<number | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [nodeContent, setNodeContent] = useState<string | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [progress, setProgress] = useState<ProgressUpdate | null>(null)
  const [executionMode, setExecutionMode] = useState<StageExecutionMode | undefined>(undefined) // undefined = use settings default
  const [confirmingNodeGraph, setConfirmingNodeGraph] = useState(false)
  const [confirmingGraph, setConfirmingGraph] = useState(false)
  
  // Stage 4 Content Pack data
  const [contentPack, setContentPack] = useState<Stage4ContentPack | null>(null)
  const [workloadMap, setWorkloadMap] = useState<WorkloadMapType | null>(null)
  const [rubric, setRubric] = useState<CourseRubric | null>(null)
  const [assessments, setAssessments] = useState<AllAssessmentsResponse | null>(null)
  const [videoScripts, setVideoScripts] = useState<AllVideoScriptsResponse | null>(null)
  const [loadingContentPack, setLoadingContentPack] = useState(false)
  const [contentSubTab, setContentSubTab] = useState('materials')
  const [graphViewType, setGraphViewType] = useState<'structured' | 'dynamic'>('structured')
  
  // Stage 3 Logic snapshot + incomplete report
  const [stage3Snapshot, setStage3Snapshot] = useState<Stage3Snapshot | null>(null)
  const [stage3IncompleteReport, setStage3IncompleteReport] = useState<Stage3IncompleteReport | null>(null)
  const [loadingStage3, setLoadingStage3] = useState(false)
  
  // AI Suggested Topics (deep research) state
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false)
  
  // Tab navigation state. The Node Engine is the default V1 surface; the legacy
  // Overview tab has been removed (its CLO Subtopic Coverage lives in Course
  // Architect Layer 6, which renders above these tabs).
  const [activeTab, setActiveTab] = useState('node-engine')
  
  // Track SSE unsubscribe function
  const unsubscribeRef = useRef<(() => void) | null>(null)
  
  // Subscribe to progress updates when a stage starts running
  // Returns a promise that resolves when connected
  const startProgressSubscription = useCallback(async (courseCode: string): Promise<void> => {
    // Unsubscribe from any existing subscription
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
    }
    
    // Subscribe to progress updates and wait for connection
    unsubscribeRef.current = await subscribeToProgress(
      courseCode,
      (update) => {
        // Ignore idle status - only show running, completed, or error
        if (update.status === 'idle') {
          return
        }
        
        setProgress(update)
        
        // Only clear progress UI after completion/error - don't close SSE connection here
        // The connection will be closed when runningStage is set to null in handleRunStage
        if (update.status === 'completed' || update.status === 'error') {
          setTimeout(() => {
            setProgress(null)
            // Don't close SSE connection here - let it stay open for potential follow-up stages
            // Connection cleanup happens in the useEffect cleanup or when component unmounts
          }, 3000) // Show completion message for 3 seconds
        }
      },
      (error) => {
        console.error('Progress subscription error:', error)
      }
    )
  }, [])
  
  // Cleanup subscription on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
      }
    }
  }, [])
  
  useEffect(() => {
    if (code) {
      loadCourse(true, true) // Show loading on initial load, auto-switch to Edit Graph if needed
    }
  }, [code])
  
  async function loadCourse(showLoadingState = false, autoSwitchToEditGraph = false) {
    if (!code) return
    
    try {
      // Only show full-page loading on initial load, not on refresh
      if (showLoadingState) {
        setLoading(true)
      }
      const data = await fetchCourse(code)
      setCourse(data)
      
      // Load graph if we have nodes
      if (data.current_stage >= 2) {
        const graph = await fetchGraphData(code)
        setGraphData(graph)
        
        // Auto-switch to Edit Graph tab if requested and node graph not yet confirmed
        if (autoSwitchToEditGraph && !data.confirmations?.node_graph_confirmed_at) {
          setActiveTab('edit-graph')
        }
      }
      
      // Load Stage 3 snapshot if available
      if (data.current_stage >= 3) {
        loadStage3Data(code)
      }
      
      // Load Stage 4 content pack if available
      if (data.current_stage >= 4) {
        loadStage4Data(code)
      }
    } catch (error) {
      showToast({
        title: 'Error',
        description: 'Failed to load course',
        variant: 'destructive',
      })
      navigate('/dashboard')
    } finally {
      if (showLoadingState) {
        setLoading(false)
      }
    }
  }
  
  async function loadStage4Data(courseCode: string) {
    setLoadingContentPack(true)
    try {
      // Load all Stage 4 data in parallel
      const [pack, workload, rubricData, assessmentData, videoData] = await Promise.all([
        fetchContentPack(courseCode).catch(() => null),
        fetchWorkloadMap(courseCode).catch(() => null),
        fetchRubric(courseCode).catch(() => null),
        fetchAllAssessments(courseCode).catch(() => null),
        fetchAllVideoScripts(courseCode).catch(() => null),
      ])
      
      setContentPack(pack)
      setWorkloadMap(workload)
      setRubric(rubricData)
      setAssessments(assessmentData)
      setVideoScripts(videoData)
    } catch (error) {
      console.error('Failed to load Stage 4 data:', error)
    } finally {
      setLoadingContentPack(false)
    }
  }
  
  async function loadStage3Data(courseCode: string) {
    setLoadingStage3(true)
    try {
      const [snapshot, incompleteReport] = await Promise.all([
        fetchStage3Snapshot(courseCode),
        fetchStage3IncompleteReport(courseCode).catch(() => null)
      ])
      setStage3Snapshot(snapshot)
      setStage3IncompleteReport(incompleteReport)
    } catch (error) {
      console.error('Failed to load Stage 3 snapshot:', error)
      setStage3Snapshot(null)
      setStage3IncompleteReport(null)
    } finally {
      setLoadingStage3(false)
    }
  }
  
  async function handleRunStage(stage: number, execOverride?: StageExecutionMode) {
    if (!code) return
    
    try {
      setRunningStage(stage)
      setProgress(null) // Clear any previous progress
      
      // Start SSE subscription and wait for connection before running stage
      await startProgressSubscription(code)
      
      // Use the provided override, or the selected execution mode, or undefined (use settings default)
      const effectiveMode = execOverride ?? executionMode
      const result = await runStage(code, stage, effectiveMode)
      
      if (result.success) {
        showToast({
          title: 'Stage Complete',
          description: result.message,
          variant: 'success',
        })
        // Auto-switch to Edit Graph tab after Stage 2 completes
        await loadCourse(false, stage === 2)
      }
    } catch (error) {
      showToast({
        title: 'Stage Failed',
        description: error instanceof Error ? error.message : 'Failed to run stage',
        variant: 'destructive',
      })
    } finally {
      setRunningStage(null)
      // Close SSE connection after a delay to allow completion message to be shown
      setTimeout(() => {
        if (unsubscribeRef.current) {
          unsubscribeRef.current()
          unsubscribeRef.current = null
        }
      }, 4000) // Wait slightly longer than the progress clear timeout
    }
  }
  
  async function handleNodeClick(nodeId: string) {
    if (!code || !nodeId.startsWith('ln-')) return
    
    const actualNodeId = nodeId.replace('ln-', '')
    setSelectedNode(actualNodeId)
    
    try {
      setLoadingContent(true)
      const data = await fetchNodeContent(code, actualNodeId)
      setNodeContent(data.content)
    } catch {
      setNodeContent(null)
    } finally {
      setLoadingContent(false)
    }
  }
  
  async function handleGenerateSuggestions() {
    if (!code) return
    
    try {
      setGeneratingSuggestions(true)
      
      // Start SSE progress subscription
      await startProgressSubscription(code)
      
      // Fire the async generation
      await generateSuggestedCloTopics(code)
      
      showToast({
        title: 'Generation Started',
        description: 'AI is researching textbook content to design suggested topics per CLO. This may take a minute...',
        variant: 'default',
      })
      
      // Poll for completion
      const previousGenAt = course?.snapshot?.suggested_clo_topics?.generated_at
      const maxWait = 300_000 // 5 minutes
      const pollInterval = 3000
      const startTime = Date.now()
      
      while (Date.now() - startTime < maxWait) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        
        try {
          // Check progress for errors first
          const progressRes = await fetch(`/api/courses/${encodeURIComponent(code)}/progress`)
          if (progressRes.ok) {
            const progressData = await progressRes.json()
            if (progressData.status === 'error') {
              showToast({
                title: 'Suggestion Failed',
                description: progressData.error || progressData.message || 'Deep research failed. Check backend logs.',
                variant: 'destructive',
              })
              break
            }
          }
          
          // Check if new suggested topics have been saved
          const refreshed = await fetchCourse(code)
          if (refreshed.snapshot?.suggested_clo_topics && 
              !refreshed.snapshot.suggested_clo_topics.stale &&
              refreshed.snapshot.suggested_clo_topics.generated_at !== previousGenAt) {
            setCourse(refreshed)
            const topicCount = refreshed.snapshot.suggested_clo_topics.topics_by_clo.reduce(
              (sum, g) => sum + g.topics.length, 0
            )
            showToast({
              title: 'Suggested Topics Ready',
              description: `Generated ${topicCount} suggested topics across ${refreshed.snapshot.suggested_clo_topics.topics_by_clo.length} CLOs`,
              variant: 'success',
            })
            break
          }
        } catch {
          // Ignore transient fetch errors during polling
        }
      }
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to generate suggested CLO topics',
        variant: 'destructive',
      })
    } finally {
      setGeneratingSuggestions(false)
    }
  }
  
  // Auto-trigger AI suggestions when Stage 1 data is ready and no suggestions exist
  const autoTriggeredRef = useRef(false)
  useEffect(() => {
    if (
      course &&
      course.current_stage >= 1 &&
      course.clos &&
      course.clos.length > 0 &&
      !course.snapshot?.suggested_clo_topics &&
      !generatingSuggestions &&
      !autoTriggeredRef.current
    ) {
      autoTriggeredRef.current = true
      handleGenerateSuggestions()
    }
  }, [course, generatingSuggestions])
  
  async function handleConfirmNodeGraph() {
    if (!code) return
    
    try {
      setConfirmingNodeGraph(true)
      await confirmNodeGraph(code)
      showToast({
        title: 'Confirmed',
        description: 'Node graph confirmed. You can now run Stage 3.',
        variant: 'success',
      })
      await loadCourse()
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to confirm node graph',
        variant: 'destructive',
      })
    } finally {
      setConfirmingNodeGraph(false)
    }
  }
  
  async function handleConfirmGraph() {
    if (!code) return
    
    try {
      setConfirmingGraph(true)
      await confirmGraph(code)
      showToast({
        title: 'Confirmed',
        description: 'Graph structure confirmed. You can now run Stage 4.',
        variant: 'success',
      })
      await loadCourse()
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to confirm graph',
        variant: 'destructive',
      })
    } finally {
      setConfirmingGraph(false)
    }
  }
  
  // Helper to determine node status label
  function getNodeStatusLabel(node: { mandatory: boolean; skippable: boolean; skip_conditions: string }): { label: string; color: string } {
    if (node.mandatory && !node.skippable) {
      return { label: 'Required', color: 'bg-red-500/10 text-red-600 dark:text-red-400' }
    }
    if (node.skippable && node.skip_conditions && node.skip_conditions.length > 0) {
      return { label: 'Conditionally Skippable', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' }
    }
    if (node.skippable) {
      return { label: 'Skippable', color: 'bg-green-500/10 text-green-600 dark:text-green-400' }
    }
    return { label: 'Required', color: 'bg-red-500/10 text-red-600 dark:text-red-400' }
  }
  
  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }
  
  if (!course) {
    return (
      <div className="text-center">
        <p>Course not found</p>
        <Button onClick={() => navigate('/dashboard')}>Go Back</Button>
      </div>
    )
  }
  
  const nextStage = course.current_stage < 5 ? course.current_stage + 1 : null
  
  // Check if confirmations are required and not yet done
  const cloTopicsConfirmed = !!course.confirmations?.clo_topics_confirmed_at || !!course.confirmations?.weekly_plan_confirmed_at
  const nodeGraphConfirmed = !!course.confirmations?.node_graph_confirmed_at
  const graphConfirmed = !!course.confirmations?.graph_confirmed_at
  
  // Determine if we need to block stages due to missing confirmations
  const needsNodeGraphConfirmation = course.current_stage >= 2 && !nodeGraphConfirmed
  
  // Stage 2 is blocked until all Stage 1 layers approved (or legacy CLO topics confirmation)
  const stage2Blocked = nextStage === 2 && !stage1AllApproved && !cloTopicsConfirmed
  // Stage 3 is blocked until node graph is confirmed (Stage 2.5)
  const stage3Blocked = nextStage === 3 && !nodeGraphConfirmed
  // Stage 4 is blocked until graph is confirmed
  const stage4Blocked = nextStage === 4 && !graphConfirmed
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')} className="mb-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
          <p className="text-sm font-medium text-primary uppercase tracking-wider">
            {course.course_code}
          </p>
          <h1 className="font-display text-3xl font-semibold text-foreground">
            {course.title}
          </h1>
          <p className="mt-1 text-muted-foreground">{course.description}</p>
        </div>
        
        <div className="flex items-center gap-2">
          {course.current_stage >= 5 && (
            <>
              <a href={getDownloadUrl(course.course_code, 'zip')} download>
                <Button className="gap-2 bg-green-600 hover:bg-green-700">
                  <Package className="h-4 w-4" />
                  Download Course (ZIP)
                </Button>
              </a>
              <a href={getDownloadUrl(course.course_code)} download>
                <Button variant="outline" className="gap-2">
                  <FileText className="h-4 w-4" />
                  PDF Only
                </Button>
              </a>
            </>
          )}
        </div>
      </div>
      
      {/* Stage Progress Card */}
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <StageProgress 
                currentStage={course.current_stage} 
                runningStage={runningStage}
                progress={progress}
                courseArchitectComplete={stage1AllApproved}
              />
              
              {/* Legacy stage-run controls (monolithic Stage 1–5 pipeline). V1 runs
                  Course Architect per-layer in the card below and the Node Engine in
                  its own tab, so these only appear behind LEGACY_STAGES_ENABLED. */}
              {LEGACY_STAGES_ENABLED && (
              <div className="flex flex-col gap-3 flex-shrink-0 ml-4">
                {/* Execution Mode Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Run as:</span>
                  <div className="flex rounded-lg border border-border overflow-hidden bg-muted/30">
                    <button
                      type="button"
                      onClick={() => setExecutionMode(undefined)}
                      className={cn(
                        'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-all duration-200',
                        executionMode === undefined
                          ? 'bg-muted text-foreground shadow-inner'
                          : 'bg-background text-muted-foreground hover:bg-muted/50'
                      )}
                      title="Use settings default"
                    >
                      Default
                    </button>
                    <button
                      type="button"
                      onClick={() => setExecutionMode('single')}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-all duration-200',
                        executionMode === 'single'
                          ? 'bg-blue-500 text-white shadow-md ring-2 ring-blue-300 ring-offset-1 ring-offset-background'
                          : 'bg-background text-muted-foreground hover:bg-muted/50'
                      )}
                      title="Use single model (fast)"
                    >
                      <User className="h-3 w-3" />
                      Single
                    </button>
                    <button
                      type="button"
                      onClick={() => setExecutionMode('council')}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-all duration-200',
                        executionMode === 'council'
                          ? 'bg-amber-500 text-white shadow-md ring-2 ring-amber-300 ring-offset-1 ring-offset-background'
                          : 'bg-background text-muted-foreground hover:bg-muted/50'
                      )}
                      title="Use council (thorough)"
                    >
                      <Users className="h-3 w-3" />
                      Council
                    </button>
                  </div>
                </div>
                
                {/* Stage Run Buttons */}
                <div className="flex gap-2">
                  {nextStage && (LEGACY_STAGES_ENABLED || nextStage < 2) && (
                    <Button
                      onClick={() => handleRunStage(nextStage)}
                      disabled={runningStage !== null || stage2Blocked || stage3Blocked || stage4Blocked}
                      className="gap-2"
                      title={stage2Blocked ? 'Confirm weekly plan distribution first' : stage3Blocked ? 'Confirm node graph first' : stage4Blocked ? 'Confirm graph structure first' : undefined}
                    >
                      {runningStage === nextStage ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (stage2Blocked || stage3Blocked || stage4Blocked) ? (
                        <Lock className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      Run Stage {nextStage}
                    </Button>
                  )}
                  {course.current_stage >= 1 && (
                    <Button
                      variant="outline"
                      onClick={() => handleRunStage(course.current_stage)}
                      disabled={runningStage !== null}
                      className="gap-2"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Regenerate
                    </Button>
                  )}
                </div>
                
                {/* Confirmation requirement hints */}
                {stage2Blocked && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Approve all Stage 1 layers to unlock Stage 2
                  </p>
                )}
                {stage3Blocked && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Confirm node graph in Edit Graph tab to unlock Stage 3
                  </p>
                )}
                {stage4Blocked && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Confirm graph structure below to unlock Stage 4
                  </p>
                )}
              </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stage 1 internal academic contract layers (always available to revisit, including personal notes on Layer 2) */}
      <Stage1Layers
        courseCode={course.course_code}
        onAllApproved={setStage1AllApproved}
        intake={{
          title: course.title,
          code: course.course_code,
          description: course.description,
          creditHours: course.credit_hours,
          hours: course.contract?.course_metadata.hours,
          clos: course.clos ?? [],
          assessments: course.snapshot?.assessments ?? [],
          weeklyPlan: course.snapshot?.weekly_plan ?? [],
          references: course.snapshot?.references ?? [],
          accreditationTags: course.contract?.course_metadata.accreditation_tags ?? [],
          assessmentStrategy: course.contract?.assessment_strategy,
        }}
      />

      {/* Course Architect Layer 7 — Reference Alignment (grounds the Node Engine). */}
      <ReferenceAlignmentPanel courseCode={course.course_code} />

      {/* Main Content Tabs. With only the Node Engine surface (legacy parked),
          the single-item tab switcher is redundant — the Node Engine panel
          renders its own header below. We only render the tab nav when the
          legacy Stage 2–4 tabs are present and a real switcher is needed. */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        {LEGACY_STAGES_ENABLED && (
          <TabsList>
            <TabsTrigger value="node-engine" className="gap-2">
              <Boxes className="h-4 w-4" />
              Node Engine
            </TabsTrigger>
            <TabsTrigger value="edit-graph" className="gap-2" disabled={course.current_stage < 2}>
              <Edit3 className="h-4 w-4" />
              Edit Graph
              {needsNodeGraphConfirmation && !nodeGraphConfirmed && (
                <span className="ml-1 h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              )}
            </TabsTrigger>
            <TabsTrigger value="graph" className="gap-2" disabled={!graphData}>
              <Network className="h-4 w-4" />
              Graph View
            </TabsTrigger>
            <TabsTrigger value="stage3-logic" className="gap-2" disabled={course.current_stage < 3}>
              <Shield className="h-4 w-4" />
              Stage 3 Logic
            </TabsTrigger>
            <TabsTrigger value="content" className="gap-2" disabled={course.current_stage < 4}>
              <FileText className="h-4 w-4" />
              Content
            </TabsTrigger>
          </TabsList>
        )}

        {/* Node Engine Tab (Phase 0 foundations) */}
        <TabsContent value="node-engine" className="space-y-4">
          <NodeEnginePanel courseCode={course.course_code} />
        </TabsContent>
        
        {/* Edit Graph Tab (Stage 2.5) */}
        <TabsContent value="edit-graph">
          {course.current_stage >= 2 ? (
            <div className="space-y-4">
              {/* Confirmation Card */}
              <Card className={cn(
                'border-2',
                nodeGraphConfirmed 
                  ? 'border-green-500/30 dark:border-green-500/20' 
                  : 'border-amber-500/30 dark:border-amber-500/20'
              )}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h3 className="font-medium flex items-center gap-2">
                        <Edit3 className="h-4 w-4" />
                        Stage 2.5: Edit Learning Node Graph
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Add, edit, or remove learning nodes and their prerequisite relationships for each CLO.
                        Drag from one node to another to create a dependency edge.
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      {nodeGraphConfirmed ? (
                        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>Confirmed</span>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Confirm to proceed to Stage 3
                        </p>
                      )}
                      <Button
                        onClick={handleConfirmNodeGraph}
                        disabled={nodeGraphConfirmed || confirmingNodeGraph}
                        variant={nodeGraphConfirmed ? 'outline' : 'default'}
                        size="sm"
                        className="gap-2"
                      >
                        {confirmingNodeGraph ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        {nodeGraphConfirmed ? 'Confirmed' : 'Confirm Node Graph'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* Graph Editor */}
              {course.clos && course.clos.length > 0 ? (
                <CLOGraphEditor
                  courseCode={course.course_code}
                  clos={course.clos}
                  nodes={course.nodes || []}
                  cloTopics={course.snapshot?.clo_topics || []}
                  onSave={() => loadCourse()}
                />
              ) : (
                <Card>
                  <CardContent className="py-12 text-center">
                    <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No CLOs available. Please run Stage 1 first.</p>
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Edit3 className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">Graph Editor Not Available</h3>
                <p className="text-muted-foreground">
                  Complete Stage 2 to edit the learning node graph.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        
        {/* Graph Tab */}
        <TabsContent value="graph">
          {graphData ? (
            <div className="space-y-4">
              {/* Graph Confirmation Card - shows after Stage 3 */}
              {course.current_stage >= 3 && (
                <Card className={cn(
                  'border-2',
                  graphConfirmed 
                    ? 'border-green-500/30 dark:border-green-500/20' 
                    : 'border-amber-500/30 dark:border-amber-500/20'
                )}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h3 className="font-medium flex items-center gap-2">
                          <Network className="h-4 w-4" />
                          Graph Structure Review
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {course.nodes?.length || 0} learning nodes • 
                          {course.nodes?.filter(n => n.mandatory).length || 0} required • 
                          {course.nodes?.filter(n => n.skippable).length || 0} skippable
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        {graphConfirmed ? (
                          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-4 w-4" />
                            <span>Confirmed</span>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Review and confirm to proceed
                          </p>
                        )}
                        <Button
                          onClick={handleConfirmGraph}
                          disabled={graphConfirmed || confirmingGraph}
                          variant={graphConfirmed ? 'outline' : 'default'}
                          size="sm"
                          className="gap-2"
                        >
                          {confirmingGraph ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          {graphConfirmed ? 'Confirmed' : 'Confirm Graph'}
                        </Button>
                      </div>
                    </div>
                    
                    {/* Node Status Legend */}
                    <div className="mt-4 pt-4 border-t flex flex-wrap gap-4 text-xs">
                      <span className="flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded bg-red-500/20 border border-red-500/40" />
                        Required (Non-skippable)
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded bg-amber-500/20 border border-amber-500/40" />
                        Conditionally Skippable
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-3 w-3 rounded bg-green-500/20 border border-green-500/40" />
                        Skippable
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}
              
              {/* Graph View Toggle */}
              <div className="flex items-center justify-end gap-2 mb-4">
                <span className="text-sm text-muted-foreground">View:</span>
                <div className="flex rounded-lg border bg-muted/30 p-1">
                  <button
                    onClick={() => setGraphViewType('structured')}
                    className={cn(
                      'px-3 py-1.5 text-sm rounded-md transition-colors',
                      graphViewType === 'structured' 
                        ? 'bg-background shadow-sm font-medium' 
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Structured
                  </button>
                  <button
                    onClick={() => setGraphViewType('dynamic')}
                    className={cn(
                      'px-3 py-1.5 text-sm rounded-md transition-colors',
                      graphViewType === 'dynamic' 
                        ? 'bg-background shadow-sm font-medium' 
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Dynamic
                  </button>
                </div>
              </div>

              <div className="relative">
                {graphViewType === 'structured' ? (
                  <GraphViewer 
                    graphData={graphData} 
                    onNodeClick={(node) => handleNodeClick(node.id)}
                  />
                ) : (
                  <CytoscapeGraph
                    graphData={graphData}
                    onNodeClick={(nodeId, nodeData) => {
                      const actualNodeId = (nodeData.node_id as string) || nodeId.replace('node-', '')
                      handleNodeClick(actualNodeId)
                    }}
                  />
                )}
                
                {/* Node Detail Sidebar */}
                {selectedNode && (
                  <div className="absolute right-4 top-4 w-96 rounded-lg border border-border bg-card p-4 shadow-lg max-h-[600px] overflow-y-auto z-10">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-card-foreground">Node Details</h3>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedNode(null)}>
                        ×
                      </Button>
                    </div>
                    
                    {/* Node Status */}
                    {course.nodes?.find(n => n.node_id === selectedNode) && (
                      <div className="mb-4 p-2 rounded bg-muted/50">
                        {(() => {
                          const node = course.nodes!.find(n => n.node_id === selectedNode)!
                          const status = getNodeStatusLabel(node)
                          return (
                            <div className="space-y-1">
                              <span className={cn('inline-block rounded px-2 py-0.5 text-xs font-medium', status.color)}>
                                {status.label}
                              </span>
                              {node.skip_conditions && (
                                <p className="text-xs text-muted-foreground">
                                  Skip condition: {node.skip_conditions}
                                </p>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    )}
                    
                    {/* Stage 3 Assessment Intelligence */}
                    {(() => {
                      const node = course.nodes?.find(n => n.node_id === selectedNode)
                      if (!node?.stage3_logic_json) return null
                      try {
                        const logic = JSON.parse(node.stage3_logic_json) as import('@/services/api').Stage3NodeLogic
                        return (
                          <div className="mb-4 space-y-3 border-t pt-3">
                            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">Stage 3 Logic</h4>
                            
                            {/* Diagnostic Intent */}
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase">Diagnostic Intent</p>
                              <p className="text-xs text-foreground">{logic.diagnostic_intent}</p>
                            </div>
                            
                            {/* Mastery / Progression */}
                            <div>
                              <p className="text-[10px] font-medium text-muted-foreground uppercase">Mastery & Progression</p>
                              <p className="text-xs text-foreground">{logic.progression_rules.mastery_definition}</p>
                              <div className="flex gap-1.5 mt-1 flex-wrap">
                                <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                                  logic.progression_rules.gate_strictness === 'strict' 
                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' 
                                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                                )}>
                                  {logic.progression_rules.gate_strictness} gate
                                </span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                  {logic.progression_rules.mastery_threshold} mastery
                                </span>
                                {logic.progression_rules.blocks_downstream && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400">
                                    blocks downstream
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            {/* Failure Types */}
                            {logic.failure_types.length > 0 && (
                              <div>
                                <p className="text-[10px] font-medium text-muted-foreground uppercase">
                                  Failure Types ({logic.failure_types.length})
                                </p>
                                <div className="space-y-1 mt-1">
                                  {logic.failure_types.map(ft => (
                                    <div key={ft.id} className="text-xs p-1.5 rounded bg-muted/50">
                                      <span className={cn('inline-block text-[9px] px-1 rounded mr-1',
                                        ft.severity === 'high' ? 'bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-300' :
                                        ft.severity === 'medium' ? 'bg-amber-200 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' :
                                        'bg-green-200 text-green-800 dark:bg-green-900/50 dark:text-green-300'
                                      )}>
                                        {ft.severity}
                                      </span>
                                      {ft.description}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {/* Remediation Paths */}
                            {logic.remediation_paths.length > 0 && (
                              <div>
                                <p className="text-[10px] font-medium text-muted-foreground uppercase">
                                  Remediation ({logic.remediation_paths.length})
                                </p>
                                <div className="space-y-1 mt-1">
                                  {logic.remediation_paths.map(rem => (
                                    <div key={rem.id} className="text-xs p-1.5 rounded bg-muted/50">
                                      <span className="text-[9px] px-1 rounded bg-purple-200 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 mr-1">
                                        {rem.strategy.replace(/_/g, ' ')}
                                      </span>
                                      {rem.description}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {/* Pre-knowledge Check */}
                            {logic.preknowledge_check_logic.eligible && (
                              <div>
                                <p className="text-[10px] font-medium text-muted-foreground uppercase">Pre-Knowledge Check</p>
                                <p className="text-xs text-foreground">{logic.preknowledge_check_logic.check_description}</p>
                                {logic.preknowledge_check_logic.high_risk_override && (
                                  <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">High-risk override active</p>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      } catch {
                        return null
                      }
                    })()}
                    
                    {loadingContent ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    ) : nodeContent ? (
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <ReactMarkdown>{nodeContent.substring(0, 1000) + '...'}</ReactMarkdown>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No content generated for this node yet.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center text-muted-foreground">
              Complete Stage 2 to view the curriculum graph
            </div>
          )}
        </TabsContent>
        
        {/* Stage 3 Logic Tab */}
        <TabsContent value="stage3-logic">
          {loadingStage3 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">Loading Stage 3 snapshot...</span>
            </div>
          ) : stage3Snapshot ? (
            <Stage3LogicViewer snapshot={stage3Snapshot} incompleteReport={stage3IncompleteReport} />
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Shield className="h-12 w-12 mb-3 opacity-50" />
              <p className="text-sm font-medium">No Stage 3 data available</p>
              <p className="text-xs mt-1">Run Stage 3 to generate assessment intelligence for all learning nodes.</p>
            </div>
          )}
        </TabsContent>
        
        {/* Content Tab - Enhanced with Sub-tabs */}
        <TabsContent value="content">
          {course.current_stage >= 4 ? (
            <div className="space-y-4">
              {/* Content Pack Summary */}
              {contentPack && (
                <Card className={cn(
                  'border',
                  contentPack.is_complete 
                    ? 'border-green-500/30 bg-green-500/5' 
                    : 'border-amber-500/30 bg-amber-500/5'
                )}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 rounded-lg bg-primary/10">
                          <Package className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-medium">Course Content Pack</h3>
                          <p className="text-sm text-muted-foreground">
                            {contentPack.nodes_with_content}/{contentPack.total_nodes} nodes • 
                            {contentPack.total_assessments} assessments • 
                            {contentPack.nodes_with_video} videos
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className={cn(
                            'text-sm font-medium',
                            contentPack.workload_summary.alignment_status === 'aligned' 
                              ? 'text-green-600 dark:text-green-400' 
                              : 'text-amber-600 dark:text-amber-400'
                          )}>
                            {contentPack.workload_summary.total_hours}h workload
                          </p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {contentPack.workload_summary.alignment_status}
                          </p>
                        </div>
                        {contentPack.is_complete ? (
                          <CheckCircle2 className="h-6 w-6 text-green-500" />
                        ) : (
                          <AlertCircle className="h-6 w-6 text-amber-500" />
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
              
              {/* Content Sub-tabs */}
              <Tabs value={contentSubTab} onValueChange={setContentSubTab}>
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="materials" className="text-xs gap-1">
                    <FileText className="h-3 w-3" />
                    Materials
                  </TabsTrigger>
                  <TabsTrigger value="assessments" className="text-xs gap-1">
                    <ClipboardCheck className="h-3 w-3" />
                    Assessments
                  </TabsTrigger>
                  <TabsTrigger value="videos" className="text-xs gap-1">
                    <Video className="h-3 w-3" />
                    Videos
                  </TabsTrigger>
                  <TabsTrigger value="rubric" className="text-xs gap-1">
                    <Scale className="h-3 w-3" />
                    Rubric
                  </TabsTrigger>
                  <TabsTrigger value="workload" className="text-xs gap-1">
                    <Clock className="h-3 w-3" />
                    Workload
                  </TabsTrigger>
                </TabsList>
                
                {/* Materials Sub-tab */}
                <TabsContent value="materials" className="mt-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Instructional Materials</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {loadingContentPack ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                      ) : course.nodes && course.nodes.some(n => n.content_path) ? (
                        <div className="space-y-3">
                          {course.nodes.filter(n => n.content_path).map(node => {
                            const status = contentPack?.node_content_status.find(s => s.node_id === node.node_id)
                            return (
                              <div
                                key={node.node_id}
                                className="rounded-lg border border-border p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                                onClick={() => handleNodeClick(`ln-${node.node_id}`)}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className={`h-3 w-3 rounded-full ${NODE_TYPE_COLORS[node.node_type] || 'bg-muted-foreground'}`} />
                                    <div>
                                      <p className="font-medium text-foreground">{node.learning_intent}</p>
                                      <div className="flex items-center gap-2 mt-1">
                                        <span className="text-xs text-muted-foreground capitalize">{node.node_type}</span>
                                        {status?.has_video && (
                                          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
                                            <Video className="h-3 w-3 inline mr-0.5" />
                                            Video
                                          </span>
                                        )}
                                        {status?.has_assessments && (
                                          <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400">
                                            <ClipboardCheck className="h-3 w-3 inline mr-0.5" />
                                            {status.assessment_types.length}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <p className="text-center text-muted-foreground py-8">
                          No content generated yet
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
                
                {/* Assessments Sub-tab */}
                <TabsContent value="assessments" className="mt-4">
                  {loadingContentPack ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : assessments ? (
                    <AssessmentViewer assessments={assessments} />
                  ) : (
                    <Card>
                      <CardContent className="py-8 text-center">
                        <ClipboardCheck className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                        <p className="text-muted-foreground">No assessments available</p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
                
                {/* Videos Sub-tab */}
                <TabsContent value="videos" className="mt-4">
                  {loadingContentPack ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : videoScripts ? (
                    <VideoScriptViewer data={videoScripts} />
                  ) : (
                    <Card>
                      <CardContent className="py-8 text-center">
                        <Video className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                        <p className="text-muted-foreground">No video scripts available</p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
                
                {/* Rubric Sub-tab */}
                <TabsContent value="rubric" className="mt-4">
                  {loadingContentPack ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : rubric ? (
                    <RubricViewer rubric={rubric} />
                  ) : (
                    <Card>
                      <CardContent className="py-8 text-center">
                        <Scale className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                        <p className="text-muted-foreground">No rubric available</p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
                
                {/* Workload Sub-tab */}
                <TabsContent value="workload" className="mt-4">
                  {loadingContentPack ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : workloadMap ? (
                    <WorkloadMap workload={workloadMap} />
                  ) : (
                    <Card>
                      <CardContent className="py-8 text-center">
                        <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                        <p className="text-muted-foreground">No workload data available</p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">Content Pack Not Generated</h3>
                <p className="text-muted-foreground">
                  Complete Stage 4 to generate the Course Content Pack including:<br />
                  instructional materials, assessments, video scripts, rubrics, and workload map.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
