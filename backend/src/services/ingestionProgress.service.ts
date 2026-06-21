/**
 * Reference Ingestion Progress Service
 *
 * Live, per-job progress for the reference-material RAG pipeline (extract ->
 * chunk -> contextual headers -> embed -> index). Unlike progress.service.ts
 * (which is keyed by courseCode for Stage 1-5 runs), this is keyed by a per-upload
 * `jobId` so multiple files ingesting in parallel each get their own stream.
 *
 * The frontend generates a jobId, opens an SSE stream for it, then sends the
 * upload tagged with the same jobId. The ingestion service emits a `phase`
 * update after each stage and during the long-running header/embed loops.
 */

import { EventEmitter } from 'events';

export type IngestionPhase =
  | 'queued'
  | 'fetching' // link ingest only: downloading the source PDF
  | 'extracting' // pulling text out of the PDF/DOCX
  | 'chunking' // splitting text into citable passages
  | 'contextualizing' // generating per-chunk context headers (LLM)
  | 'embedding' // turning enriched passages into vectors
  | 'indexing' // persisting + indexing into pgvector
  | 'done'
  | 'error';

export interface IngestionProgress {
  jobId: string;
  courseCode: string;
  phase: IngestionPhase;
  status: 'running' | 'completed' | 'error';
  /** Human-friendly status line for the UI. */
  message: string;
  /** Overall 0-100 progress across all phases. */
  percent: number;
  /** Items processed within the current phase (e.g. headers/embeddings done). */
  current?: number;
  /** Total items in the current phase. */
  total?: number;
  /** Passages discovered / indexed so far. */
  chunkCount?: number;
  /** Characters extracted from the source. */
  charCount?: number;
  docTitle?: string;
  filename?: string;
  error?: string;
  updatedAt: number;
}

/** Per-phase [start, end] share of the overall progress bar (0-100). */
const PHASE_BOUNDS: Record<IngestionPhase, [number, number]> = {
  queued: [0, 2],
  fetching: [2, 8],
  extracting: [8, 16],
  chunking: [16, 24],
  contextualizing: [24, 60],
  embedding: [60, 90],
  indexing: [90, 99],
  done: [100, 100],
  error: [0, 0],
};

function computePercent(phase: IngestionPhase, current?: number, total?: number): number {
  const [lo, hi] = PHASE_BOUNDS[phase];
  if (phase === 'done') return 100;
  if (phase === 'error') return 0;
  if (current != null && total != null && total > 0) {
    const frac = Math.min(1, Math.max(0, current / total));
    return Math.round(lo + (hi - lo) * frac);
  }
  return lo;
}

const store = new Map<string, IngestionProgress>();
const emitter = new EventEmitter();
emitter.setMaxListeners(200);

/** How long a terminal (done/error) job lingers in the store before cleanup. */
const TERMINAL_TTL_MS = 30000;

export interface EmitIngestionInput {
  jobId: string;
  courseCode: string;
  phase: IngestionPhase;
  message?: string;
  current?: number;
  total?: number;
  chunkCount?: number;
  charCount?: number;
  docTitle?: string;
  filename?: string;
  error?: string;
}

const DEFAULT_MESSAGES: Record<IngestionPhase, string> = {
  queued: 'Queued…',
  fetching: 'Downloading the source PDF…',
  extracting: 'Extracting text from the document…',
  chunking: 'Splitting the text into passages…',
  contextualizing: 'Generating context for each passage…',
  embedding: 'Embedding passages into the vector index…',
  indexing: 'Saving and indexing passages…',
  done: 'Ingestion complete.',
  error: 'Ingestion failed.',
};

/** Emit a progress update for a job. Carries forward metadata across phases. */
export function emitIngestionProgress(input: EmitIngestionInput): void {
  const prev = store.get(input.jobId);
  const phase = input.phase;
  const status: IngestionProgress['status'] =
    phase === 'done' ? 'completed' : phase === 'error' ? 'error' : 'running';

  const update: IngestionProgress = {
    jobId: input.jobId,
    courseCode: input.courseCode,
    phase,
    status,
    message: input.message ?? DEFAULT_MESSAGES[phase],
    percent: computePercent(phase, input.current, input.total),
    current: input.current,
    total: input.total,
    chunkCount: input.chunkCount ?? prev?.chunkCount,
    charCount: input.charCount ?? prev?.charCount,
    docTitle: input.docTitle ?? prev?.docTitle,
    filename: input.filename ?? prev?.filename,
    error: input.error,
    updatedAt: Date.now(),
  };

  store.set(input.jobId, update);
  // Emit on BOTH a per-job channel and a per-course channel. The frontend uses a
  // single course-scoped SSE stream (one connection for a whole batch) to avoid
  // exhausting the browser's per-host connection pool when many files ingest.
  emitter.emit(`ingest:${input.jobId}`, update);
  emitter.emit(`ingest:course:${input.courseCode}`, update);

  if (phase === 'done' || phase === 'error') {
    setTimeout(() => store.delete(input.jobId), TERMINAL_TTL_MS);
  }
}

export function getIngestionProgress(jobId: string): IngestionProgress | null {
  return store.get(jobId) ?? null;
}

/** All known (still-stored) ingestion jobs for a course, for SSE replay-on-connect. */
export function getActiveIngestionsForCourse(courseCode: string): IngestionProgress[] {
  return Array.from(store.values()).filter((p) => p.courseCode === courseCode);
}

/** Subscribe to a single job's progress. Returns an unsubscribe function. */
export function subscribeToIngestion(
  jobId: string,
  callback: (update: IngestionProgress) => void
): () => void {
  const eventName = `ingest:${jobId}`;
  emitter.on(eventName, callback);
  return () => emitter.off(eventName, callback);
}

/** Subscribe to ALL ingestion progress for a course (multiplexed). */
export function subscribeToCourseIngestion(
  courseCode: string,
  callback: (update: IngestionProgress) => void
): () => void {
  const eventName = `ingest:course:${courseCode}`;
  emitter.on(eventName, callback);
  return () => emitter.off(eventName, callback);
}

/**
 * Build an `onProgress` reporter bound to a job. Safe no-op when jobId is absent
 * so ingestion callers can stay agnostic about whether progress is being tracked.
 */
export function makeIngestionReporter(
  jobId: string | undefined,
  courseCode: string
): (input: Omit<EmitIngestionInput, 'jobId' | 'courseCode'>) => void {
  if (!jobId) return () => {};
  return (input) => emitIngestionProgress({ ...input, jobId, courseCode });
}

export type IngestionReporter = ReturnType<typeof makeIngestionReporter>;
