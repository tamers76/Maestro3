import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Progress } from '@/components/ui/Progress'
import { 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle,
  BarChart3,
  Calendar,
  BookOpen
} from 'lucide-react'
import type { WorkloadMap as WorkloadMapType, WeeklyWorkload } from '@/services/api'

interface WorkloadMapProps {
  workload: WorkloadMapType
}

function getAlignmentColor(status: string): string {
  switch (status) {
    case 'aligned': return 'text-green-500 dark:text-green-400'
    case 'under': return 'text-amber-500 dark:text-amber-400'
    case 'over': return 'text-red-500 dark:text-red-400'
    default: return 'text-muted-foreground'
  }
}

function getAlignmentBgColor(status: string): string {
  switch (status) {
    case 'aligned': return 'bg-green-500/10 border-green-500/20'
    case 'under': return 'bg-amber-500/10 border-amber-500/20'
    case 'over': return 'bg-red-500/10 border-red-500/20'
    default: return 'bg-muted'
  }
}

function AlignmentIcon({ status }: { status: string }) {
  switch (status) {
    case 'aligned':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />
    case 'under':
      return <AlertTriangle className="h-5 w-5 text-amber-500" />
    case 'over':
      return <AlertCircle className="h-5 w-5 text-red-500" />
    default:
      return null
  }
}

function WeeklyWorkloadBar({ week, maxHours }: { week: WeeklyWorkload; maxHours: number }) {
  const percentage = maxHours > 0 ? (week.total_time_hours / maxHours) * 100 : 0
  
  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-foreground">Week {week.week}</span>
        <span className="text-xs text-muted-foreground">{week.total_time_hours}h</span>
      </div>
      <div className="relative h-6 bg-muted rounded-md overflow-hidden">
        <div 
          className={`h-full transition-all duration-300 ${
            week.is_balanced 
              ? 'bg-primary/80 group-hover:bg-primary' 
              : 'bg-amber-500/80 group-hover:bg-amber-500'
          }`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-medium text-foreground/70 truncate px-1">
            {week.topic}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[10px] text-muted-foreground">
          {week.node_count} nodes
        </span>
        {!week.is_balanced && (
          <span className="text-[10px] text-amber-500">Unbalanced</span>
        )}
      </div>
    </div>
  )
}

export default function WorkloadMap({ workload }: WorkloadMapProps) {
  const maxWeeklyHours = Math.max(...workload.weekly_workload.map(w => w.total_time_hours), 1)
  
  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Workload Card */}
        <Card className={`border ${getAlignmentBgColor(workload.alignment_status)}`}>
          <CardContent className="pt-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Workload</p>
                <p className="text-2xl font-bold text-foreground">
                  {workload.total_hours}h
                </p>
                <p className="text-xs text-muted-foreground">
                  Expected: {workload.expected_hours}h
                </p>
              </div>
              <AlignmentIcon status={workload.alignment_status} />
            </div>
            <div className="mt-3">
              <Progress 
                value={(workload.total_hours / workload.expected_hours) * 100} 
                className="h-2"
              />
              <p className={`text-xs mt-1 ${getAlignmentColor(workload.alignment_status)}`}>
                {workload.deviation_percentage > 0 ? '+' : ''}{workload.deviation_percentage}% 
                ({workload.deviation_hours > 0 ? '+' : ''}{workload.deviation_hours}h)
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Credit Alignment Card */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Credit Hours</p>
                <p className="text-2xl font-bold text-foreground">
                  {workload.credit_hours}
                </p>
                <p className="text-xs text-muted-foreground">
                  {workload.hours_per_credit}h per credit
                </p>
              </div>
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className={`text-sm font-medium capitalize ${getAlignmentColor(workload.alignment_status)}`}>
                {workload.alignment_status}
              </span>
              {workload.is_valid && (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Time Breakdown Card */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Time Breakdown</p>
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Content</span>
                    <span className="font-medium">{workload.total_content_hours}h</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Assessment</span>
                    <span className="font-medium">{workload.total_assessment_hours}h</span>
                  </div>
                </div>
              </div>
              <Clock className="h-5 w-5 text-primary" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Validation Notes */}
      {workload.validation_notes.length > 0 && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Validation Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {workload.validation_notes.map((note, i) => (
                <li key={i} className="text-sm text-muted-foreground">
                  {note}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Weekly Workload Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Weekly Workload Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {workload.weekly_workload.map(week => (
              <WeeklyWorkloadBar 
                key={week.week} 
                week={week} 
                maxHours={maxWeeklyHours} 
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Node Workload Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Node Time Estimates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">Node</th>
                  <th className="text-center py-2 px-2 font-medium text-muted-foreground">Type</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Content</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Video</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Assessment</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Practice</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody>
                {workload.nodes.slice(0, 20).map(node => (
                  <tr key={node.node_id} className="border-b border-muted/50 hover:bg-muted/30">
                    <td className="py-2 px-2">
                      <span className="font-mono text-xs">{node.node_id}</span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary capitalize">
                        {node.node_type}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right text-muted-foreground">
                      {node.content_time_minutes}m
                    </td>
                    <td className="py-2 px-2 text-right text-muted-foreground">
                      {node.video_time_minutes > 0 ? `${node.video_time_minutes}m` : '-'}
                    </td>
                    <td className="py-2 px-2 text-right text-muted-foreground">
                      {node.assessment_time_minutes}m
                    </td>
                    <td className="py-2 px-2 text-right text-muted-foreground">
                      {node.practice_time_minutes}m
                    </td>
                    <td className="py-2 px-2 text-right font-medium">
                      {node.total_time_minutes}m
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {workload.nodes.length > 20 && (
              <p className="text-xs text-muted-foreground text-center mt-2">
                Showing 20 of {workload.nodes.length} nodes
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
