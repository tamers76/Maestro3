import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { showToast } from '@/components/ui/Toaster'
import {
  listReferences,
  uploadReference,
  uploadReferenceFromLink,
  deleteReference,
  subscribeToCourseIngestion,
  newIngestionJobId,
  libraryCoverUrl,
  type ReferenceDocument,
  type ReferenceLibraryInfo,
  type ReferenceSourceType,
  type IngestionProgress,
  type UploadReferenceResult,
} from '@/services/api'
import IngestionProgressCard from '@/components/IngestionProgressCard'
import LibraryPicker from '@/components/LibraryPicker'
import { Loader2, Upload, Trash2, BookOpen, Library, Sparkles, Link as LinkIcon, AlertTriangle } from 'lucide-react'

/** True while a professor-uploaded book is still being auto-enriched in the background. */
function isEnriching(library?: ReferenceLibraryInfo | null): boolean {
  return (
    !!library &&
    library.status === 'candidate' &&
    !library.cover_path &&
    !(library.description ?? '').trim()
  )
}

/**
 * Small badge distinguishing where a reference came from:
 *  - approved library book  -> "Library"
 *  - professor upload (candidate) -> "Uploaded" (or an enriching spinner while metadata loads)
 */
function ReferenceBadge({ library }: { library?: ReferenceLibraryInfo | null }) {
  if (!library) return null
  if (library.status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        <Library className="h-3 w-3" />
        Library
      </span>
    )
  }
  if (isEnriching(library)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
        <Sparkles className="h-3 w-3 animate-pulse" />
        Enriching…
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      <BookOpen className="h-3 w-3" />
      Uploaded
    </span>
  )
}

const SOURCE_TYPE_OPTIONS: { value: ReferenceSourceType; label: string }[] = [
  { value: 'textbook_chapter', label: 'Textbook chapter' },
  { value: 'paper', label: 'Paper' },
  { value: 'other', label: 'Other' },
]

/** Ingest one file at a time so the SME sees a clear one-by-one activity list. */
const UPLOAD_CONCURRENCY = 1

/** Run `worker` over `items` with bounded concurrency, returning allSettled-style results. */
async function runSettledWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let cursor = 0
  const runner = async () => {
    while (cursor < items.length) {
      const index = cursor++
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner))
  return results
}

interface ReferenceMaterialsPanelProps {
  courseCode: string
  /** When true, render without the outer card chrome/header so it can sit inside another card. */
  embedded?: boolean
  /** Notify the parent when the ingested-document count changes (e.g. to drive warnings). */
  onDocsChange?: (count: number) => void
  /** Fired after a reference is successfully ingested (upload OR link) — drives the
   * coverage re-check loop so the SME sees before/after deltas. */
  onReferenceUploaded?: () => void
  /** Prefill the title field (e.g. from an approved AI source suggestion). */
  initialTitle?: string
  /** Prefill the "Add from link" URL field (e.g. from an approved AI suggestion). */
  initialLinkUrl?: string
  /** Prefill the source-type select (e.g. from an approved AI suggestion). */
  initialSourceType?: ReferenceSourceType
}

/**
 * SME panel to upload (or link) institutionally-licensed reference materials
 * (PDF/DOCX) for a course. Ingestion runs the RAG pipeline (extract -> chunk ->
 * embed -> index) on the backend so generation can be grounded in actual text.
 */
export default function ReferenceMaterialsPanel({
  courseCode,
  embedded = false,
  onDocsChange,
  onReferenceUploaded,
  initialTitle,
  initialLinkUrl,
  initialSourceType,
}: ReferenceMaterialsPanelProps) {
  const [docs, setDocs] = useState<ReferenceDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [title, setTitle] = useState(initialTitle ?? '')
  // A prefilled title counts as SME-provided, so a later file pick won't clobber it.
  const [titleEdited, setTitleEdited] = useState(!!initialTitle)
  const [sourceType, setSourceType] = useState<ReferenceSourceType>(
    initialSourceType ?? 'textbook_chapter'
  )
  const [linkUrl, setLinkUrl] = useState(initialLinkUrl ?? '')
  const [linking, setLinking] = useState(false)
  // Live per-job ingestion progress (one card per in-flight upload/link).
  const [ingestJobs, setIngestJobs] = useState<IngestionProgress[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const upsertJob = useCallback((update: IngestionProgress) => {
    setIngestJobs((prev) => {
      const idx = prev.findIndex((j) => j.jobId === update.jobId)
      if (idx === -1) return [...prev, update]
      const next = prev.slice()
      next[idx] = { ...next[idx], ...update }
      return next
    })
  }, [])

  const load = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      try {
        if (!opts.silent) setLoading(true)
        const result = await listReferences(courseCode)
        setDocs(result)
        onDocsChange?.(result.length)
      } catch (error) {
        if (!opts.silent) {
          showToast({
            title: 'Error',
            description: error instanceof Error ? error.message : 'Failed to load reference materials',
            variant: 'destructive',
          })
        }
      } finally {
        if (!opts.silent) setLoading(false)
      }
    },
    [courseCode, onDocsChange]
  )

  useEffect(() => {
    load()
  }, [load])

  // Background enrichment (cover + description) for professor uploads finishes a few
  // seconds AFTER ingest. Quietly re-poll while any candidate is still un-enriched so
  // its picture/summary appears without a manual refresh. Capped to avoid busy-looping.
  const enrichPollsRef = useRef(0)
  useEffect(() => {
    const pending = docs.some((d) => isEnriching(d.library))
    if (!pending) {
      enrichPollsRef.current = 0
      return
    }
    if (enrichPollsRef.current >= 10) return
    const timer = setTimeout(() => {
      enrichPollsRef.current += 1
      void load({ silent: true })
    }, 4000)
    return () => clearTimeout(timer)
  }, [docs, load])

  // Auto-capture a sensible title from the file name (without extension) when
  // exactly one file is selected, unless the SME has manually edited the title.
  const handleFileChange = (selected: FileList | null) => {
    const picked = selected ? Array.from(selected) : []
    setFiles(picked)
    if (picked.length === 1 && !titleEdited) {
      setTitle(picked[0].name.replace(/\.[^.]+$/, ''))
    }
    if (picked.length !== 1 && !titleEdited) {
      setTitle('')
    }
  }

  const resetForm = () => {
    setFiles([])
    setTitle('')
    setTitleEdited(false)
    setSourceType('textbook_chapter')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleUpload = async () => {
    if (files.length === 0) {
      showToast({ title: 'No files', description: 'Choose one or more PDF/DOCX files first.', variant: 'destructive' })
      return
    }
    setIngestJobs([])
    const jobs = files.map((file) => ({ file, jobId: newIngestionJobId() }))
    let unsubscribe: (() => void) | undefined
    try {
      setUploading(true)
      const singleFileTitle = files.length === 1 ? title.trim() || undefined : undefined

      // Seed a card per file, then open ONE multiplexed SSE stream BEFORE uploading
      // so we don't miss early phase events (and don't starve the connection pool).
      setIngestJobs(
        jobs.map(({ file, jobId }) => ({
          jobId,
          phase: 'queued' as const,
          status: 'running' as const,
          percent: 0,
          filename: file.name,
        }))
      )
      unsubscribe = await subscribeToCourseIngestion(courseCode, upsertJob)

      // Drive the Waiting -> Ingesting -> Ingested flow from the sequential queue
      // itself so the activity indicator is reliable even if the live SSE stream
      // isn't available; SSE updates (passage counts, phases) just enrich it.
      const results = await runSettledWithConcurrency(jobs, UPLOAD_CONCURRENCY, async ({ file, jobId }) => {
        upsertJob({ jobId, phase: 'extracting', status: 'running', percent: 0, filename: file.name })
        try {
          const doc = await uploadReference(courseCode, file, {
            title: singleFileTitle,
            source_type: sourceType,
            job_id: jobId,
          })
          upsertJob({
            jobId,
            phase: 'done',
            status: 'completed',
            percent: 100,
            filename: file.name,
            docTitle: doc.title,
            chunkCount: doc.chunk_count,
            message: doc.already_present
              ? `"${doc.title}" is already a reference in this course.`
              : doc.reused
                ? `Already in the library — reused ${doc.chunk_count} prepared passages (no re-processing).`
                : undefined,
          })
          return doc
        } catch (err) {
          upsertJob({
            jobId,
            phase: 'error',
            status: 'error',
            percent: 0,
            filename: file.name,
            error: err instanceof Error ? err.message : 'Failed to ingest',
          })
          throw err
        }
      })
      const successes = results.filter(
        (r): r is PromiseFulfilledResult<UploadReferenceResult> => r.status === 'fulfilled'
      )
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

      if (successes.length > 0) {
        const totalChunks = successes.reduce((sum, s) => sum + s.value.chunk_count, 0)
        const reusedCount = successes.filter((s) => s.value.from_library).length
        const reuseNote =
          reusedCount > 0
            ? ` (${reusedCount} already in the library — reused instantly)`
            : ''
        showToast({
          title: successes.length === 1 ? 'Reference ingested' : `${successes.length} references ingested`,
          description:
            successes.length === 1
              ? successes[0].value.already_present
                ? `${successes[0].value.title} was already a reference in this course`
                : successes[0].value.from_library
                  ? `${successes[0].value.title} — reused ${successes[0].value.chunk_count} prepared passages (no re-processing)`
                  : `${successes[0].value.title} — ${successes[0].value.chunk_count} passages indexed`
              : `${totalChunks} passages indexed across ${successes.length} files${reuseNote}`,
          variant: 'success',
        })
        resetForm()
        await load()
        onReferenceUploaded?.()
      }

      if (failures.length > 0) {
        const firstError = failures[0].reason
        const firstMessage = firstError instanceof Error ? firstError.message : 'Failed to ingest one or more files'
        showToast({
          title: failures.length === 1 ? '1 file failed to ingest' : `${failures.length} files failed to ingest`,
          description: firstMessage,
          variant: 'destructive',
        })
      }
    } catch (error) {
      showToast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Failed to ingest reference',
        variant: 'destructive',
      })
    } finally {
      unsubscribe?.()
      setUploading(false)
      // Keep error cards visible; auto-dismiss once everything finished cleanly.
      setIngestJobs((prev) => {
        if (prev.some((j) => j.status === 'error')) return prev
        setTimeout(() => setIngestJobs([]), 2500)
        return prev
      })
    }
  }

  const handleLink = async () => {
    const url = linkUrl.trim()
    if (!url) {
      showToast({ title: 'No link', description: 'Paste a PDF URL first.', variant: 'destructive' })
      return
    }
    setIngestJobs([])
    const jobId = newIngestionJobId()
    let unsubscribe: (() => void) | undefined
    try {
      setLinking(true)
      setIngestJobs([
        { jobId, phase: 'queued', status: 'running', percent: 0, filename: url },
      ])
      unsubscribe = await subscribeToCourseIngestion(courseCode, upsertJob)

      upsertJob({ jobId, phase: 'fetching', status: 'running', percent: 0, filename: url })
      const doc = await uploadReferenceFromLink(courseCode, url, {
        source_type: sourceType,
        job_id: jobId,
      })
      upsertJob({
        jobId,
        phase: 'done',
        status: 'completed',
        percent: 100,
        filename: url,
        docTitle: doc.title,
        chunkCount: doc.chunk_count,
      })
      showToast({
        title: 'Reference ingested',
        description: `${doc.title} — ${doc.chunk_count} passages indexed`,
        variant: 'success',
      })
      setLinkUrl('')
      await load()
      onReferenceUploaded?.()
    } catch (error) {
      upsertJob({
        jobId,
        phase: 'error',
        status: 'error',
        percent: 0,
        filename: url,
        error: error instanceof Error ? error.message : 'Failed to ingest reference link',
      })
      showToast({
        title: 'Link ingest failed',
        description: error instanceof Error ? error.message : 'Failed to ingest reference link',
        variant: 'destructive',
      })
    } finally {
      unsubscribe?.()
      setLinking(false)
      setIngestJobs((prev) => {
        if (prev.some((j) => j.status === 'error')) return prev
        setTimeout(() => setIngestJobs([]), 2500)
        return prev
      })
    }
  }

  const handleDelete = async (docId: string) => {
    try {
      await deleteReference(courseCode, docId)
      setDocs((prev) => {
        const next = prev.filter((d) => d.doc_id !== docId)
        onDocsChange?.(next.length)
        return next
      })
      showToast({ title: 'Removed', description: 'Reference deleted', variant: 'success' })
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete reference',
        variant: 'destructive',
      })
    }
  }

  const body = (
    <div className={embedded ? 'space-y-5' : 'p-6 space-y-5'}>
      {/* No-textbook warning (non-blocking) */}
      {!loading && docs.length === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p className="text-xs">
            No textbook ingested yet — Course Architect layers (especially Layers 2 and 6) will run
            without textbook grounding. Upload or link a textbook to ground them.
          </p>
        </div>
      )}

      {/* Pick from the university library (admin-approved books) */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Reuse a library book</p>
          <p className="text-xs text-muted-foreground">
            Add an admin-approved book from the university library — no upload needed.
          </p>
        </div>
        <LibraryPicker
          courseCode={courseCode}
          onAdded={() => {
            void load()
            onReferenceUploaded?.()
          }}
        />
      </div>

      {/* Upload / link form */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,application/pdf"
          onChange={(e) => handleFileChange(e.target.files)}
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90"
        />
        {files.length > 0 && (
          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Selected files ({files.length})
            </p>
            <ul className="space-y-1">
              {files.map((selectedFile, idx) => (
                <li key={`${selectedFile.name}-${idx}`} className="text-sm text-foreground">
                  {idx + 1}. {selectedFile.name}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
              Title (used only when one file is selected)
            </label>
            <Input
              className="h-8 text-sm"
              placeholder={
                files.length === 1
                  ? 'Captured from the uploaded file name'
                  : 'Select exactly one file to set a custom title'
              }
              value={title}
              disabled={files.length !== 1}
              onChange={(e) => {
                setTitle(e.target.value)
                setTitleEdited(true)
              }}
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
              Source type
            </label>
            <select
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as ReferenceSourceType)}
            >
              {SOURCE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={handleUpload} disabled={uploading || files.length === 0} className="gap-2">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? 'Ingesting…' : files.length > 1 ? `Upload & ingest ${files.length} files` : 'Upload & ingest'}
          </Button>
        </div>

        {/* Add from link (PDF URL) */}
        <div className="border-t border-border pt-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
            Add from link (PDF URL)
          </label>
          <div className="flex items-start gap-2">
            <Input
              className="h-8 flex-1 text-sm"
              placeholder="https://example.com/chapter.pdf"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleLink()
                }
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleLink}
              disabled={linking || !linkUrl.trim()}
              className="gap-2"
            >
              {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
              {linking ? 'Fetching…' : 'Add link'}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Direct PDF links only. If the link is protected or requires login, download the file and
            upload it instead.
          </p>
        </div>
      </div>

      {/* Live ingestion progress (one compact row per in-flight upload/link) */}
      {ingestJobs.length > 0 && (
        <div className="space-y-1.5">
          {ingestJobs.length > 1 && (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Ingesting {ingestJobs.length} files
            </p>
          )}
          {ingestJobs.map((job) => (
            <IngestionProgressCard key={job.jobId} progress={job} />
          ))}
        </div>
      )}

      {/* Document list */}
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reference materials uploaded yet.</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((doc) => {
            const coverUrl = doc.library ? libraryCoverUrl(doc.library) : null
            const authors = doc.library?.authors?.length ? doc.library.authors.join(', ') : ''
            const description = doc.library?.description?.trim()
            const enriching = isEnriching(doc.library)
            return (
              <li
                key={doc.doc_id}
                className="flex items-start justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2"
              >
                <div className="flex items-start gap-3 min-w-0">
                  {coverUrl ? (
                    <img
                      src={coverUrl}
                      alt={doc.title}
                      className="h-16 w-11 shrink-0 rounded object-cover shadow-sm"
                    />
                  ) : (
                    <div className="relative flex h-16 w-11 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                      <BookOpen className="h-5 w-5" />
                      {enriching ? (
                        <Loader2 className="absolute bottom-1 right-1 h-3 w-3 animate-spin text-sky-500" />
                      ) : null}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.title}</p>
                      <ReferenceBadge library={doc.library} />
                    </div>
                    {authors ? (
                      <p className="text-xs text-muted-foreground truncate">{authors}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {doc.chunk_count} passages ·{' '}
                      {SOURCE_TYPE_OPTIONS.find((o) => o.value === doc.source_type)?.label}
                      {doc.scope.clo_ids?.length ? ` · CLOs: ${doc.scope.clo_ids.join(', ')}` : ''}
                      {doc.scope.subtopic_ids?.length
                        ? ` · Subtopics: ${doc.scope.subtopic_ids.join(', ')}`
                        : ''}
                    </p>
                    {description ? (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{description}</p>
                    ) : enriching ? (
                      <p className="mt-1 text-xs italic text-sky-600 dark:text-sky-400">
                        Fetching cover &amp; description…
                      </p>
                    ) : null}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600 hover:text-red-700 shrink-0"
                  onClick={() => handleDelete(doc.doc_id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  if (embedded) {
    return (
      <div className="mt-4 border-t border-border pt-4">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="h-4 w-4 text-primary" />
          <h4 className="font-semibold text-sm">Grounding materials (textbook / readings)</h4>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Upload or link licensed readings (PDF/DOCX). Their actual text is chunked and indexed so
          Course Architect generation can be grounded in the source material.
        </p>
        {body}
      </div>
    )
  }

  return (
    <div className="flex flex-col rounded-xl border bg-card shadow-sm overflow-hidden mt-4">
      <div className="flex items-center gap-2 px-6 py-4 border-b bg-muted/30">
        <BookOpen className="h-5 w-5 text-primary" />
        <h3 className="font-bold text-base">Reference Materials</h3>
        <span className="text-sm text-muted-foreground">
          Upload licensed readings (PDF/DOCX) to ground generation in their actual text
        </span>
      </div>
      {body}
    </div>
  )
}
