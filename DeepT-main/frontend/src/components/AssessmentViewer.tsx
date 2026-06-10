import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { 
  ClipboardCheck, 
  Brain, 
  Award,
  ChevronDown,
  ChevronRight,
  Clock,
  Target,
  HelpCircle,
  CheckCircle2,
  Lightbulb
} from 'lucide-react'
import type { 
  NodeAssessment, 
  AssessmentQuestion, 
  AllAssessmentsResponse,
  Stage4AssessmentType 
} from '@/services/api'

interface AssessmentViewerProps {
  assessments: AllAssessmentsResponse
}

interface SingleAssessmentProps {
  assessment: NodeAssessment & { node_learning_intent?: string; node_type?: string }
  defaultExpanded?: boolean
}

function getAssessmentTypeInfo(type: Stage4AssessmentType): {
  label: string
  description: string
  icon: React.ReactNode
  color: string
  bgColor: string
} {
  switch (type) {
    case 'pre_knowledge':
      return {
        label: 'Pre-Knowledge Check (Type A)',
        description: 'Determines if learners already have sufficient understanding',
        icon: <Brain className="h-4 w-4" />,
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/10 border-blue-500/20'
      }
    case 'formative_diagnostic':
      return {
        label: 'Formative Diagnostic (Type B)',
        description: 'Identifies causes of misunderstanding during learning',
        icon: <Lightbulb className="h-4 w-4" />,
        color: 'text-amber-500',
        bgColor: 'bg-amber-500/10 border-amber-500/20'
      }
    case 'mastery_evidence':
      return {
        label: 'Mastery Evidence (Type C)',
        description: 'Confirms learner can demonstrate the required capability',
        icon: <Award className="h-4 w-4" />,
        color: 'text-green-500',
        bgColor: 'bg-green-500/10 border-green-500/20'
      }
    default:
      return {
        label: type,
        description: '',
        icon: <ClipboardCheck className="h-4 w-4" />,
        color: 'text-primary',
        bgColor: 'bg-primary/10 border-primary/20'
      }
  }
}

function QuestionCard({ question, index }: { question: AssessmentQuestion; index: number }) {
  const [showAnswer, setShowAnswer] = useState(false)
  
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-start gap-3">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center justify-center">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
              {question.question_type.replace('_', ' ')}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {question.bloom_level}
            </span>
            <span className="text-xs text-muted-foreground">
              {question.points} pts
            </span>
          </div>
          
          <p className="text-sm text-foreground mb-3">{question.question_text}</p>
          
          {question.options && question.options.length > 0 && (
            <div className="space-y-2 mb-3">
              {question.options.map((option, i) => (
                <div 
                  key={i}
                  className={`text-sm p-2 rounded border ${
                    showAnswer && question.correct_answer && option.startsWith(question.correct_answer)
                      ? 'border-green-500/50 bg-green-500/10'
                      : 'border-muted bg-muted/30'
                  }`}
                >
                  {option}
                </div>
              ))}
            </div>
          )}
          
          {question.rubric_criteria && (
            <div className="mb-3 p-3 rounded bg-muted/50 border border-muted">
              <p className="text-xs font-medium text-muted-foreground mb-1">Rubric Criteria:</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{question.rubric_criteria}</p>
            </div>
          )}
          
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              <Target className="h-3 w-3 inline mr-1" />
              {question.diagnostic_value}
            </p>
            {question.correct_answer && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAnswer(!showAnswer)}
                className="text-xs"
              >
                {showAnswer ? 'Hide' : 'Show'} Answer
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SingleAssessment({ assessment, defaultExpanded = false }: SingleAssessmentProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const typeInfo = getAssessmentTypeInfo(assessment.assessment_type)
  
  return (
    <Card className={`border ${typeInfo.bgColor}`}>
      <CardHeader 
        className="cursor-pointer py-3"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={typeInfo.color}>
              {typeInfo.icon}
            </div>
            <div>
              <CardTitle className="text-sm font-medium">{assessment.title}</CardTitle>
              {assessment.node_learning_intent && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                  {assessment.node_learning_intent}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-xs text-muted-foreground">
                {assessment.questions.length} questions
              </span>
              {assessment.time_limit_minutes && (
                <span className="text-xs text-muted-foreground ml-2">
                  <Clock className="h-3 w-3 inline mr-0.5" />
                  {assessment.time_limit_minutes}m
                </span>
              )}
            </div>
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>
      
      {expanded && (
        <CardContent className="pt-0">
          <div className="space-y-4">
            {/* Assessment Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 rounded-lg bg-muted/30">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                <p className="text-sm">{assessment.description}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Pass Threshold</p>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">{assessment.pass_threshold}%</span>
                </div>
              </div>
            </div>
            
            {/* Adaptive Function */}
            <div className="p-3 rounded-lg border border-dashed">
              <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <HelpCircle className="h-3 w-3" />
                Adaptive Function
              </p>
              <p className="text-sm">{assessment.adaptive_function}</p>
            </div>
            
            {/* Instructions */}
            {assessment.instructions && (
              <div className="p-3 rounded-lg bg-primary/5">
                <p className="text-xs font-medium text-primary mb-1">Instructions for Learners</p>
                <p className="text-sm text-foreground">{assessment.instructions}</p>
              </div>
            )}
            
            {/* Questions */}
            <div className="space-y-3">
              <p className="text-sm font-medium">Questions</p>
              {assessment.questions.map((q, i) => (
                <QuestionCard key={q.question_id} question={q} index={i} />
              ))}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  )
}

export default function AssessmentViewer({ assessments }: AssessmentViewerProps) {
  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-blue-500/10 border-blue-500/20">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Brain className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{assessments.summary.pre_knowledge_count}</p>
                <p className="text-xs text-muted-foreground">Pre-Knowledge Checks</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-amber-500/10 border-amber-500/20">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Lightbulb className="h-5 w-5 text-amber-500" />
              <div>
                <p className="text-2xl font-bold">{assessments.summary.formative_count}</p>
                <p className="text-xs text-muted-foreground">Formative Diagnostics</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-green-500/10 border-green-500/20">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Award className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{assessments.summary.mastery_count}</p>
                <p className="text-xs text-muted-foreground">Mastery Assessments</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs by Type */}
      <Tabs defaultValue="pre_knowledge">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pre_knowledge" className="text-xs">
            <Brain className="h-3 w-3 mr-1" />
            Type A ({assessments.summary.pre_knowledge_count})
          </TabsTrigger>
          <TabsTrigger value="formative" className="text-xs">
            <Lightbulb className="h-3 w-3 mr-1" />
            Type B ({assessments.summary.formative_count})
          </TabsTrigger>
          <TabsTrigger value="mastery" className="text-xs">
            <Award className="h-3 w-3 mr-1" />
            Type C ({assessments.summary.mastery_count})
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="pre_knowledge" className="mt-4">
          <div className="space-y-4">
            {assessments.by_type.pre_knowledge.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No pre-knowledge checks generated
              </p>
            ) : (
              assessments.by_type.pre_knowledge.map((a, i) => (
                <SingleAssessment key={`${a.node_id}-${i}`} assessment={a} />
              ))
            )}
          </div>
        </TabsContent>
        
        <TabsContent value="formative" className="mt-4">
          <div className="space-y-4">
            {assessments.by_type.formative_diagnostic.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No formative diagnostics generated
              </p>
            ) : (
              assessments.by_type.formative_diagnostic.map((a, i) => (
                <SingleAssessment key={`${a.node_id}-${i}`} assessment={a} />
              ))
            )}
          </div>
        </TabsContent>
        
        <TabsContent value="mastery" className="mt-4">
          <div className="space-y-4">
            {assessments.by_type.mastery_evidence.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No mastery assessments generated
              </p>
            ) : (
              assessments.by_type.mastery_evidence.map((a, i) => (
                <SingleAssessment key={`${a.node_id}-${i}`} assessment={a} />
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
