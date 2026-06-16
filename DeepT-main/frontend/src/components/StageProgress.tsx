import { cn } from '@/lib/utils'
import { STAGE_NAMES } from '@/lib/utils'
import { Check, Loader2, AlertCircle, Users, User, Sparkles, Brain, Zap } from 'lucide-react'
import { Progress } from '@/components/ui/Progress'
import type { ProgressUpdate, CouncilInfo } from '@/services/api'
import { LEGACY_STAGES_ENABLED } from '@/config/featureFlags'
import ProductProgress from '@/components/ProductProgress'

interface StageProgressProps {
  currentStage: number
  runningStage?: number | null
  progress?: ProgressUpdate | null
  compact?: boolean
  /** V1 only: precise "all six Course Architect layers approved" signal. */
  courseArchitectComplete?: boolean
}

// Futuristic phase messages for council mode
const COUNCIL_PHASE_MESSAGES: Record<string, { title: string; subtitle: string }> = {
  deliberating: {
    title: 'Neural Deliberation',
    subtitle: 'Collective intelligence processing'
  },
  synthesizing: {
    title: 'Synthesis Protocol',
    subtitle: 'Chairman merging perspectives'
  },
  consensus: {
    title: 'Consensus Achieved',
    subtitle: 'Unified output generated'
  }
}

// Extract model display name (remove provider prefix, shorten)
function formatModelName(model: string): string {
  // Remove common prefixes and clean up
  return model
    .replace(/^(openai\/|anthropic\/|google\/|meta-llama\/|mistralai\/)/, '')
    .replace(/-instruct$/, '')
    .replace(/-turbo$/, '')
    .split('/').pop() || model
}

// Council status indicator component
function CouncilIndicator({ council }: { council: CouncilInfo }) {
  const isCouncil = council.mode === 'council'
  const phase = council.phase || 'deliberating'
  const phaseInfo = COUNCIL_PHASE_MESSAGES[phase] || COUNCIL_PHASE_MESSAGES.deliberating
  
  if (!isCouncil) {
    // Single model mode - subtle indicator
    return (
      <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted border border-border">
        <User className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-foreground font-medium">
          {formatModelName(council.models[0] || 'AI')}
        </span>
      </div>
    )
  }
  
  // Council mode - futuristic indicator
  return (
    <div className="rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/50 dark:to-orange-950/50 border border-amber-200/50 dark:border-amber-700/50 p-2.5 space-y-2">
      {/* Council Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Users className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <Sparkles className="h-2 w-2 text-amber-400 dark:text-amber-300 absolute -top-0.5 -right-0.5 animate-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-200 tracking-wide uppercase">
              {phaseInfo.title}
            </span>
            <span className="text-[10px] text-amber-600/80 dark:text-amber-400/80">
              {phaseInfo.subtitle}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 border border-amber-200 dark:border-amber-700">
          <Brain className="h-3 w-3 text-amber-600 dark:text-amber-400" />
          <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">
            {council.memberCount} Minds
          </span>
        </div>
      </div>
      
      {/* Active Models Display */}
      <div className="flex flex-wrap gap-1">
        {council.models.map((model, idx) => {
          const isActive = council.activeModel === model
          const isCompleted = council.completedModels?.includes(model)
          const isChairman = model === council.chairmanModel && phase === 'synthesizing'
          
          return (
            <div
              key={idx}
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all',
                isChairman && 'bg-amber-500 text-white ring-1 ring-amber-300 shadow-sm',
                isActive && !isChairman && 'bg-amber-200 dark:bg-amber-700 text-amber-800 dark:text-amber-100 ring-1 ring-amber-300 dark:ring-amber-500',
                isCompleted && !isActive && !isChairman && 'bg-amber-100/50 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400',
                !isActive && !isCompleted && !isChairman && 'bg-white/50 dark:bg-amber-950/30 text-amber-500 dark:text-amber-500 border border-amber-200/50 dark:border-amber-700/50'
              )}
            >
              {isChairman ? (
                <Zap className="h-2.5 w-2.5" />
              ) : isActive ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : isCompleted ? (
                <Check className="h-2.5 w-2.5" />
              ) : (
                <div className="h-2.5 w-2.5 rounded-full bg-amber-300/50 dark:bg-amber-600/50" />
              )}
              <span className="truncate max-w-[80px]">{formatModelName(model)}</span>
            </div>
          )
        })}
      </div>
      
      {/* Chairman synthesis message - more prominent */}
      {phase === 'synthesizing' && (
        <div className="flex items-center gap-2 pt-2 mt-1 border-t border-amber-200/50 dark:border-amber-700/50 bg-amber-100/50 dark:bg-amber-900/30 -mx-2.5 -mb-2.5 px-2.5 py-2 rounded-b-lg">
          <div className="relative">
            <Zap className="h-4 w-4 text-amber-500 dark:text-amber-400" />
            <div className="absolute inset-0 animate-ping">
              <Zap className="h-4 w-4 text-amber-500/50 dark:text-amber-400/50" />
            </div>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">
              All council members submitted responses
            </span>
            <span className="text-[10px] text-amber-600 dark:text-amber-400">
              Chairman <span className="font-semibold">{formatModelName(council.chairmanModel)}</span> is synthesizing collective wisdom...
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function StageProgress({ currentStage, runningStage, progress, compact, courseArchitectComplete }: StageProgressProps) {
  // V1 default: present the two-half Course Architect → Node Engine product model
  // instead of the legacy five-stage stepper. The legacy stepper below stays
  // intact and is only reached when LEGACY_STAGES_ENABLED is true.
  if (!LEGACY_STAGES_ENABLED) {
    return (
      <ProductProgress
        currentStage={currentStage}
        courseArchitectComplete={courseArchitectComplete}
        compact={compact}
      />
    )
  }

  // Calculate percentage for progress bar
  const progressPercent = progress?.current && progress?.total 
    ? Math.round((progress.current / progress.total) * 100)
    : null
  
  const isCouncilMode = progress?.council?.mode === 'council'

  return (
    <div className="space-y-3">
      {/* Stage circles — responsive */}
      <div className="flex items-center justify-between w-full">
        {[1, 2, 3, 4, 5].map((stage) => {
          const isComplete = currentStage >= stage
          const isActive = runningStage === stage
          const isPending = currentStage < stage && !isActive
          const hasError = progress?.status === 'error' && progress?.stage === stage

          const stageColors: Record<number, { bg: string; ring: string; connector: string }> = {
            1: { bg: 'bg-violet-500', ring: 'ring-violet-200 dark:ring-violet-800', connector: 'bg-violet-500' },
            2: { bg: 'bg-blue-500', ring: 'ring-blue-200 dark:ring-blue-800', connector: 'bg-blue-500' },
            3: { bg: 'bg-cyan-500', ring: 'ring-cyan-200 dark:ring-cyan-800', connector: 'bg-cyan-500' },
            4: { bg: 'bg-amber-500', ring: 'ring-amber-200 dark:ring-amber-800', connector: 'bg-amber-500' },
            5: { bg: 'bg-emerald-500', ring: 'ring-emerald-200 dark:ring-emerald-800', connector: 'bg-emerald-500' },
          }
          const sc = stageColors[stage]

          return (
            <div key={stage} className="flex items-center flex-1 last:flex-initial">
              <div className="flex flex-col items-center flex-shrink-0">
                <div
                  className={cn(
                    'flex items-center justify-center rounded-full font-bold transition-all',
                    compact
                      ? 'h-7 w-7 text-[10px]'
                      : 'h-8 w-8 text-xs sm:h-10 sm:w-10 sm:text-sm lg:h-14 lg:w-14 lg:text-base',
                    isActive && !hasError && !isCouncilMode && `${sc.bg} text-white ${compact ? 'ring-2' : 'ring-2 sm:ring-4'} ${sc.ring}`,
                    isActive && !hasError && isCouncilMode && `bg-amber-500 text-white ${compact ? 'ring-2' : 'ring-2 sm:ring-4'} ring-amber-200 dark:ring-amber-900 shadow-lg`,
                    hasError && `bg-red-500 text-white ${compact ? 'ring-2' : 'ring-2 sm:ring-4'} ring-red-200 dark:ring-red-900`,
                    isComplete && !isActive && !hasError && `${sc.bg} text-white`,
                    isPending && 'bg-slate-200 dark:bg-muted text-black/30 dark:text-muted-foreground'
                  )}
                >
                  {hasError ? (
                    <AlertCircle className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6'} />
                  ) : isActive ? (
                    isCouncilMode ? (
                      <Users className={cn(compact ? 'h-3.5 w-3.5' : 'h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6', 'animate-pulse')} />
                    ) : (
                      <Loader2 className={cn(compact ? 'h-3.5 w-3.5' : 'h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6', 'animate-spin')} />
                    )
                  ) : isComplete ? (
                    <Check className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6'} />
                  ) : (
                    stage
                  )}
                </div>
                <span className={cn(
                  'font-semibold text-black/70 dark:text-muted-foreground text-center leading-tight',
                  compact
                    ? 'mt-1 text-[9px] max-w-[48px]'
                    : 'mt-1 sm:mt-1.5 lg:mt-2 text-[10px] sm:text-xs lg:text-sm max-w-[50px] sm:max-w-[70px] lg:max-w-[90px]'
                )}>
                  {STAGE_NAMES[stage]}
                </span>
              </div>
              {stage < 5 && (
                <div
                  className={cn(
                    'flex-1 rounded-full min-w-[4px]',
                    compact
                      ? 'mx-0.5 h-[2px]'
                      : 'mx-1 sm:mx-1.5 lg:mx-2 h-0.5 sm:h-0.5 lg:h-1 min-w-[8px]',
                    currentStage >= stage + 1 ? sc.connector : 'bg-slate-200 dark:bg-muted'
                  )}
                />
              )}
            </div>
          )
        })}
      </div>
      
      {/* Detailed progress section */}
      {progress && progress.status === 'running' && (
        <div className={cn(
          'rounded-lg p-3 space-y-2',
          isCouncilMode 
            ? 'bg-gradient-to-br from-amber-50 via-orange-50 to-amber-50 dark:from-amber-950/50 dark:via-orange-950/50 dark:to-amber-950/50 border border-amber-200 dark:border-amber-800' 
            : 'bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800'
        )}>
          <div className="flex items-center justify-between text-sm">
            <span className={cn(
              'font-medium',
              isCouncilMode ? 'text-amber-800 dark:text-amber-200' : 'text-blue-800 dark:text-blue-200'
            )}>
              Stage {progress.stage}: {progress.step}
            </span>
            {progressPercent !== null && (
              <span className={cn(
                'font-semibold',
                isCouncilMode ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'
              )}>
                {progressPercent}%
              </span>
            )}
          </div>
          
          {/* Council/Single Mode Indicator */}
          {progress.council && (
            <CouncilIndicator council={progress.council} />
          )}
          
          {/* Progress bar */}
          {progress.current && progress.total && (
            <div className="space-y-1">
              <Progress 
                value={progressPercent || 0} 
                className={cn('h-2', isCouncilMode && '[&>div]:bg-amber-500')} 
              />
              <p className={cn(
                'text-xs',
                isCouncilMode ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'
              )}>
                {progress.current} of {progress.total} items completed
              </p>
            </div>
          )}
          
          {/* Current item info */}
          {progress.message && !progress.current && !progress.council && (
            <p className={cn(
              'text-xs flex items-center gap-2',
              isCouncilMode ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'
            )}>
              <Loader2 className="h-3 w-3 animate-spin" />
              {progress.message}
            </p>
          )}
          
          {/* Item ID if available */}
          {progress.itemId && (
            <p className="text-xs text-muted-foreground font-mono">
              Processing: {progress.itemId}
            </p>
          )}
        </div>
      )}
      
      {/* Error display */}
      {progress && progress.status === 'error' && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 p-3">
          <div className="flex items-center gap-2 text-sm text-red-800 dark:text-red-200">
            <AlertCircle className="h-4 w-4" />
            <span className="font-medium">Stage {progress.stage} failed</span>
          </div>
          {progress.error && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{progress.error}</p>
          )}
        </div>
      )}
      
      {/* Completion message */}
      {progress && progress.status === 'completed' && (
        <div className={cn(
          'rounded-lg p-3',
          progress.council?.mode === 'council'
            ? 'bg-gradient-to-r from-amber-50 to-emerald-50 dark:from-amber-950/50 dark:to-emerald-950/50 border border-amber-200 dark:border-amber-800'
            : 'bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800'
        )}>
          <div className={cn(
            'flex items-center gap-2 text-sm',
            progress.council?.mode === 'council' ? 'text-amber-800 dark:text-amber-200' : 'text-emerald-800 dark:text-emerald-200'
          )}>
            {progress.council?.mode === 'council' ? (
              <>
                <Sparkles className="h-4 w-4 text-amber-500 dark:text-amber-400" />
                <span className="font-medium">
                  Council Consensus Achieved
                </span>
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                <span className="font-medium">{progress.message}</span>
              </>
            )}
          </div>
          {progress.council?.mode === 'council' && (
            <p className="mt-1 text-xs text-amber-600/80 dark:text-amber-400/80">
              {progress.council.memberCount} minds unified via {formatModelName(progress.council.chairmanModel)} synthesis
            </p>
          )}
          {progress.message && progress.council?.mode === 'council' && (
            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">{progress.message}</p>
          )}
        </div>
      )}
    </div>
  )
}
