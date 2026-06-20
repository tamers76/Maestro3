import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { 
  Scale, 
  FileText, 
  BookOpen,
  ChevronDown,
  ChevronRight,
  Target,
  Award,
  Percent
} from 'lucide-react'
import { Markdown } from '@/components/ui/Markdown'
import type { CourseRubric, CLORubricCriteria, RubricCriterion } from '@/services/api'

interface RubricViewerProps {
  rubric: CourseRubric
}

function getLevelColor(level: number): string {
  switch (level) {
    case 4: return 'bg-green-500/20 border-green-500/30 text-green-700 dark:text-green-300'
    case 3: return 'bg-blue-500/20 border-blue-500/30 text-blue-700 dark:text-blue-300'
    case 2: return 'bg-amber-500/20 border-amber-500/30 text-amber-700 dark:text-amber-300'
    case 1: return 'bg-red-500/20 border-red-500/30 text-red-700 dark:text-red-300'
    default: return 'bg-muted border-muted-foreground/20'
  }
}

function CriterionCard({ criterion }: { criterion: RubricCriterion }) {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <div className="border rounded-lg overflow-hidden">
      <div 
        className="flex items-center justify-between p-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <Target className="h-4 w-4 text-primary" />
          <div>
            <p className="text-sm font-medium">{criterion.description}</p>
            <p className="text-xs text-muted-foreground">
              Weight: {criterion.weight}%
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      
      {expanded && (
        <div className="p-4 space-y-2 border-t">
          {criterion.levels
            .sort((a, b) => b.level - a.level)
            .map(level => (
              <div 
                key={level.level}
                className={`p-3 rounded border ${getLevelColor(level.level)}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{level.label}</span>
                  <span className="text-xs">{level.points} pts</span>
                </div>
                <p className="text-sm opacity-90">{level.description}</p>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

function CLOCriteriaCard({ clo }: { clo: CLORubricCriteria }) {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <Card className="overflow-hidden">
      <CardHeader 
        className="cursor-pointer py-3 bg-primary/5"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Award className="h-4 w-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-medium">{clo.clo_id}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {clo.clo_text}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {clo.bloom_level}
            </span>
            <span className="text-xs text-muted-foreground">
              {clo.criteria.length} criteria
            </span>
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>
      
      {expanded && (
        <CardContent className="pt-4">
          <div className="space-y-3">
            {clo.criteria.map(criterion => (
              <CriterionCard key={criterion.criterion_id} criterion={criterion} />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

export default function RubricViewer({ rubric }: RubricViewerProps) {
  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Scale className="h-5 w-5 text-primary" />
              <div>
                <p className="text-2xl font-bold">{rubric.clo_criteria.length}</p>
                <p className="text-xs text-muted-foreground">CLO Criteria Sets</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Target className="h-5 w-5 text-primary" />
              <div>
                <p className="text-2xl font-bold">
                  {rubric.clo_criteria.reduce((sum, c) => sum + c.criteria.length, 0)}
                </p>
                <p className="text-xs text-muted-foreground">Total Criteria</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Percent className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-bold">Assessment Weights</p>
                <div className="flex gap-2 mt-1 text-xs">
                  <span className="text-blue-500">A: {rubric.assessment_weights.pre_knowledge}%</span>
                  <span className="text-amber-500">B: {rubric.assessment_weights.formative}%</span>
                  <span className="text-green-500">C: {rubric.assessment_weights.mastery}%</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grading Scale */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Scale className="h-4 w-4" />
            Grading Scale
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {rubric.grading_scale.map(level => (
              <div 
                key={level.grade}
                className="p-3 rounded-lg border bg-muted/30 text-center"
              >
                <p className="text-lg font-bold text-primary">{level.grade}</p>
                <p className="text-xs text-muted-foreground">
                  {level.min_percentage}-{level.max_percentage}%
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">
                  {level.description}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tabs for different views */}
      <Tabs defaultValue="criteria">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="criteria" className="text-xs">
            <Target className="h-3 w-3 mr-1" />
            CLO Criteria
          </TabsTrigger>
          <TabsTrigger value="marking" className="text-xs">
            <FileText className="h-3 w-3 mr-1" />
            Marking Guide
          </TabsTrigger>
          <TabsTrigger value="learner" className="text-xs">
            <BookOpen className="h-3 w-3 mr-1" />
            Learner Guide
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="criteria" className="mt-4">
          <div className="space-y-4">
            {rubric.clo_criteria.map(clo => (
              <CLOCriteriaCard key={clo.clo_id} clo={clo} />
            ))}
          </div>
        </TabsContent>
        
        <TabsContent value="marking" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Marking Guide for Instructors</CardTitle>
            </CardHeader>
            <CardContent>
              <Markdown>{rubric.marking_guide}</Markdown>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="learner" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Guide for Learners</CardTitle>
            </CardHeader>
            <CardContent>
              <Markdown>{rubric.learner_instructions}</Markdown>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
