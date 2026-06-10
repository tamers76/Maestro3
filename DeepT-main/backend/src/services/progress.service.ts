import { EventEmitter } from 'events';

// Council execution info for progress tracking
export interface CouncilInfo {
  mode: 'single' | 'council';
  memberCount: number;
  models: string[];
  chairmanModel: string;
  phase?: 'deliberating' | 'synthesizing' | 'consensus';
  activeModel?: string;
  completedModels?: string[];
}

// Progress event types
export interface ProgressUpdate {
  courseCode: string;
  stage: number;
  status: 'running' | 'completed' | 'error';
  step: string;
  current?: number;
  total?: number;
  itemId?: string;
  message?: string;
  error?: string;
  // Council execution details
  council?: CouncilInfo;
}

// In-memory storage for current progress per course
const progressStore = new Map<string, ProgressUpdate>();

// Event emitter for SSE
const progressEmitter = new EventEmitter();
progressEmitter.setMaxListeners(100); // Allow many concurrent connections

/**
 * Update progress for a course stage
 */
export function updateProgress(update: ProgressUpdate): void {
  progressStore.set(update.courseCode, update);
  progressEmitter.emit(`progress:${update.courseCode}`, update);
  
  // Log progress for debugging
  if (update.current && update.total) {
    console.log(`[Progress] ${update.courseCode} Stage ${update.stage}: ${update.step} (${update.current}/${update.total})`);
  } else {
    console.log(`[Progress] ${update.courseCode} Stage ${update.stage}: ${update.step}`);
  }
}

/**
 * Get current progress for a course
 */
export function getProgress(courseCode: string): ProgressUpdate | null {
  return progressStore.get(courseCode) || null;
}

/**
 * Clear progress for a course (call when stage completes)
 */
export function clearProgress(courseCode: string): void {
  progressStore.delete(courseCode);
}

/**
 * Subscribe to progress updates for a course
 * Returns unsubscribe function
 */
export function subscribeToProgress(
  courseCode: string,
  callback: (update: ProgressUpdate) => void
): () => void {
  const eventName = `progress:${courseCode}`;
  progressEmitter.on(eventName, callback);
  
  return () => {
    progressEmitter.off(eventName, callback);
  };
}

/**
 * Helper to start stage progress
 */
export function startStageProgress(courseCode: string, stage: number, step: string, council?: CouncilInfo): void {
  updateProgress({
    courseCode,
    stage,
    status: 'running',
    step,
    message: `Starting ${step}...`,
    council
  });
}

/**
 * Helper to update stage progress with item count
 */
export function updateItemProgress(
  courseCode: string,
  stage: number,
  step: string,
  current: number,
  total: number,
  itemId?: string,
  council?: CouncilInfo
): void {
  const percentage = Math.round((current / total) * 100);
  updateProgress({
    courseCode,
    stage,
    status: 'running',
    step,
    current,
    total,
    itemId,
    message: `${step} (${current}/${total}) - ${percentage}%`,
    council
  });
}

/**
 * Helper to update council phase during deliberation
 */
export function updateCouncilPhase(
  courseCode: string,
  stage: number,
  step: string,
  council: CouncilInfo
): void {
  updateProgress({
    courseCode,
    stage,
    status: 'running',
    step,
    message: council.phase === 'deliberating' 
      ? `Council deliberating: ${council.activeModel || 'Processing'}...`
      : council.phase === 'synthesizing'
      ? `Chairman synthesizing consensus...`
      : `Reaching consensus...`,
    council
  });
}

/**
 * Helper to complete stage progress
 */
export function completeStageProgress(courseCode: string, stage: number, message: string): void {
  updateProgress({
    courseCode,
    stage,
    status: 'completed',
    step: 'Complete',
    message
  });
  // Don't clear immediately - let frontend see completion
  setTimeout(() => clearProgress(courseCode), 5000);
}

/**
 * Helper to report stage error
 */
export function errorStageProgress(courseCode: string, stage: number, error: string): void {
  updateProgress({
    courseCode,
    stage,
    status: 'error',
    step: 'Error',
    error,
    message: `Stage ${stage} failed: ${error}`
  });
  // Don't clear immediately - let frontend see error
  setTimeout(() => clearProgress(courseCode), 10000);
}
