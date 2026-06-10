import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { 
  Video, 
  Clock, 
  ChevronDown, 
  ChevronRight,
  Play,
  Film,
  Eye,
  MessageSquare,
  Users,
  Clapperboard
} from 'lucide-react'
import type { AllVideoScriptsResponse, VideoScript, VideoSection } from '@/services/api'

interface VideoScriptViewerProps {
  data: AllVideoScriptsResponse
}

interface SingleVideoScriptProps {
  script: VideoScript & { node_learning_intent?: string; node_type?: string }
  defaultExpanded?: boolean
}

function getScriptTypeInfo(type: string): {
  label: string
  description: string
  color: string
} {
  switch (type) {
    case 'explainer':
      return {
        label: 'Explainer',
        description: 'Introduces and explains the concept in an engaging, visual way',
        color: 'text-blue-500'
      }
    case 'walkthrough':
      return {
        label: 'Walkthrough',
        description: 'Demonstrates the principle through step-by-step reasoning',
        color: 'text-green-500'
      }
    case 'demonstration':
      return {
        label: 'Demonstration',
        description: 'Shows the procedure being performed step-by-step',
        color: 'text-amber-500'
      }
    case 'feedback':
      return {
        label: 'Feedback',
        description: 'Provides guidance on applying knowledge to scenarios',
        color: 'text-purple-500'
      }
    default:
      return {
        label: type,
        description: '',
        color: 'text-primary'
      }
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function SectionCard({ section }: { section: VideoSection }) {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <div className="border rounded-lg overflow-hidden">
      <div 
        className="flex items-center justify-between p-3 bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center justify-center">
            {section.section_number}
          </span>
          <div>
            <p className="text-sm font-medium">{section.title}</p>
            <p className="text-xs text-muted-foreground">
              <Clock className="h-3 w-3 inline mr-1" />
              {formatDuration(section.duration_seconds)}
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
        <div className="p-4 space-y-4 border-t">
          {/* Narration */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              Narration
            </p>
            <p className="text-sm whitespace-pre-wrap bg-card p-3 rounded border">
              {section.narration}
            </p>
          </div>
          
          {/* Visual Description */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Eye className="h-3 w-3" />
              Visual Description
            </p>
            <p className="text-sm whitespace-pre-wrap bg-blue-500/5 p-3 rounded border border-blue-500/20">
              {section.visual_description}
            </p>
          </div>
          
          {/* On-Screen Text */}
          {section.on_screen_text && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">On-Screen Text</p>
              <p className="text-sm bg-muted/50 p-3 rounded border font-mono">
                {section.on_screen_text}
              </p>
            </div>
          )}
          
          {/* Transitions */}
          {section.transitions && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                <Clapperboard className="h-3 w-3" />
                Transition
              </p>
              <p className="text-sm text-muted-foreground italic">{section.transitions}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SingleVideoScript({ script, defaultExpanded = false }: SingleVideoScriptProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const typeInfo = getScriptTypeInfo(script.script_type)
  
  return (
    <Card>
      <CardHeader 
        className="cursor-pointer py-4"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Video className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-medium">{script.title}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs ${typeInfo.color} capitalize`}>
                  {typeInfo.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  <Clock className="h-3 w-3 inline mr-0.5" />
                  {script.duration_minutes} min
                </span>
                <span className="text-xs text-muted-foreground">
                  {script.sections.length} sections
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {script.node_type && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                {script.node_type}
              </span>
            )}
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
            {/* Script Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-lg bg-muted/30">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                  <Play className="h-3 w-3" />
                  Learning Objective
                </p>
                <p className="text-sm">{script.learning_objective}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  Target Audience
                </p>
                <p className="text-sm">{script.target_audience}</p>
              </div>
            </div>
            
            {/* Script Type Description */}
            <div className="p-3 rounded-lg border border-dashed">
              <p className="text-xs font-medium text-muted-foreground mb-1">Video Type</p>
              <p className="text-sm">{typeInfo.description}</p>
            </div>
            
            {/* Sections */}
            <div>
              <p className="text-sm font-medium mb-3 flex items-center gap-2">
                <Film className="h-4 w-4" />
                Script Sections
              </p>
              <div className="space-y-2">
                {script.sections.map(section => (
                  <SectionCard key={section.section_number} section={section} />
                ))}
              </div>
            </div>
            
            {/* Production Notes */}
            {script.production_notes && (
              <div className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">
                  Production Notes
                </p>
                <p className="text-sm text-foreground">{script.production_notes}</p>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

export default function VideoScriptViewer({ data }: VideoScriptViewerProps) {
  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Video className="h-5 w-5 text-primary" />
              <div>
                <p className="text-2xl font-bold">{data.total_videos}</p>
                <p className="text-xs text-muted-foreground">Video Scripts</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-primary" />
              <div>
                <p className="text-2xl font-bold">{data.total_duration_minutes}</p>
                <p className="text-xs text-muted-foreground">Total Minutes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Film className="h-5 w-5 text-primary" />
              <div>
                <p className="text-2xl font-bold">
                  {data.video_scripts.reduce((sum, s) => sum + s.sections.length, 0)}
                </p>
                <p className="text-xs text-muted-foreground">Total Sections</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Video Scripts List */}
      <div className="space-y-4">
        {data.video_scripts.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <Video className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No video scripts generated</p>
              <p className="text-xs text-muted-foreground mt-1">
                Video scripts are generated for concept, principle, procedure, and application nodes
              </p>
            </CardContent>
          </Card>
        ) : (
          data.video_scripts.map((script, i) => (
            <SingleVideoScript key={`${script.node_id}-${i}`} script={script} />
          ))
        )}
      </div>
    </div>
  )
}
