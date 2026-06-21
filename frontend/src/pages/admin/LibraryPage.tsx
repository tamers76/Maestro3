import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Card, CardContent } from '@/components/ui/Card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog'
import { showToast } from '@/components/ui/Toaster'
import {
  fetchLibraryCandidates,
  fetchLibraryApproved,
  fetchLibraryBookUsages,
  approveLibraryBook,
  rejectLibraryBook,
  reenrichLibraryBook,
  updateLibraryBook,
  deleteLibraryBook,
  uploadLibraryBook,
  subscribeToLibraryIngestion,
  newIngestionJobId,
  libraryCoverUrl,
  type LibraryBook,
  type LibraryBookUsage,
  type ReferenceSourceType,
  type IngestionProgress,
} from '@/services/api'
import IngestionProgressCard from '@/components/IngestionProgressCard'
import { BookOpen, Check, X, RefreshCw, Pencil, Trash2, Loader2, BookMarked, Library, Upload } from 'lucide-react'

const SOURCE_TYPE_OPTIONS: { value: ReferenceSourceType; label: string }[] = [
  { value: 'textbook_chapter', label: 'Textbook chapter' },
  { value: 'paper', label: 'Paper' },
  { value: 'other', label: 'Other' },
]

/** Ingest one book at a time so the admin sees a clear one-by-one activity list. */
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

function BookCover({ book, className }: { book: LibraryBook; className?: string }) {
  const url = libraryCoverUrl(book)
  if (url) {
    return (
      <img
        src={url}
        alt={book.title}
        className={`h-24 w-16 flex-shrink-0 rounded object-cover shadow-sm ${className ?? ''}`}
      />
    )
  }
  return (
    <div
      className={`flex h-24 w-16 flex-shrink-0 items-center justify-center rounded bg-muted text-muted-foreground ${className ?? ''}`}
    >
      <BookOpen className="h-6 w-6" />
    </div>
  )
}

export default function LibraryPage() {
  const [candidates, setCandidates] = useState<LibraryBook[]>([])
  const [approved, setApproved] = useState<LibraryBook[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tab, setTab] = useState<'candidates' | 'catalog'>('candidates')

  const [editing, setEditing] = useState<LibraryBook | null>(null)
  const [usagesFor, setUsagesFor] = useState<LibraryBook | null>(null)
  const [usages, setUsages] = useState<LibraryBookUsage[]>([])

  const [addFiles, setAddFiles] = useState<File[]>([])
  const [addTitle, setAddTitle] = useState('')
  const [addTitleEdited, setAddTitleEdited] = useState(false)
  const [addSourceType, setAddSourceType] = useState<ReferenceSourceType>('textbook_chapter')
  const [addingBook, setAddingBook] = useState(false)
  const [ingestJobs, setIngestJobs] = useState<IngestionProgress[]>([])
  const addFileRef = useRef<HTMLInputElement>(null)

  const upsertJob = useCallback((update: IngestionProgress) => {
    setIngestJobs((prev) => {
      const idx = prev.findIndex((j) => j.jobId === update.jobId)
      if (idx === -1) return [...prev, update]
      const next = prev.slice()
      next[idx] = { ...next[idx], ...update }
      return next
    })
  }, [])

  // `silent` refreshes (after an action) must NOT toggle the full-page spinner,
  // otherwise the Tabs unmount and remount on their default tab, making the view
  // appear to "jump back" to Pending review.
  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) setLoading(true)
      const [cand, appr] = await Promise.all([fetchLibraryCandidates(), fetchLibraryApproved()])
      setCandidates(cand)
      setApproved(appr)
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load the library',
        variant: 'destructive',
      })
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function runAction(id: string, action: () => Promise<unknown>, successMessage: string) {
    try {
      setBusyId(id)
      await action()
      showToast({ title: 'Done', description: successMessage, variant: 'success' })
      await reload({ silent: true })
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Action failed',
        variant: 'destructive',
      })
    } finally {
      setBusyId(null)
    }
  }

  function resetAddForm() {
    setAddFiles([])
    setAddTitle('')
    setAddTitleEdited(false)
    setAddSourceType('textbook_chapter')
    if (addFileRef.current) addFileRef.current.value = ''
  }

  function handleAddFilesChange(selected: FileList | null) {
    const picked = selected ? Array.from(selected) : []
    setAddFiles(picked)
    if (picked.length === 1 && !addTitleEdited) {
      setAddTitle(picked[0].name.replace(/\.[^.]+$/, ''))
    } else if (picked.length !== 1 && !addTitleEdited) {
      setAddTitle('')
    }
  }

  async function handleAddBook() {
    if (addFiles.length === 0) {
      showToast({ title: 'No files', description: 'Choose one or more PDF/DOCX files first.', variant: 'destructive' })
      return
    }
    setIngestJobs([])
    const jobs = addFiles.map((file) => ({ file, jobId: newIngestionJobId() }))
    let unsubscribe: (() => void) | undefined
    try {
      setAddingBook(true)
      const singleFileTitle = addFiles.length === 1 ? addTitle.trim() || undefined : undefined

      // Seed a card per file, then open ONE multiplexed SSE stream BEFORE uploading
      // so we don't miss early phase events.
      setIngestJobs(
        jobs.map(({ file, jobId }) => ({
          jobId,
          phase: 'queued' as const,
          status: 'running' as const,
          percent: 0,
          filename: file.name,
        }))
      )
      unsubscribe = await subscribeToLibraryIngestion(upsertJob)

      const results = await runSettledWithConcurrency(jobs, UPLOAD_CONCURRENCY, async ({ file, jobId }) => {
        upsertJob({ jobId, phase: 'extracting', status: 'running', percent: 0, filename: file.name })
        try {
          const book = await uploadLibraryBook(file, {
            title: singleFileTitle,
            source_type: addSourceType,
            job_id: jobId,
          })
          upsertJob({
            jobId,
            phase: 'done',
            status: 'completed',
            percent: 100,
            filename: file.name,
            docTitle: book.title,
            chunkCount: book.canonical?.chunk_count,
          })
          return book
        } catch (err) {
          upsertJob({
            jobId,
            phase: 'error',
            status: 'error',
            percent: 0,
            filename: file.name,
            error: err instanceof Error ? err.message : 'Failed to add book',
          })
          throw err
        }
      })

      const successes = results.filter(
        (r): r is PromiseFulfilledResult<LibraryBook> => r.status === 'fulfilled'
      )
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

      if (successes.length > 0) {
        showToast({
          title: successes.length === 1 ? 'Added to library' : `${successes.length} books added`,
          description:
            successes.length === 1
              ? `"${successes[0].value.title}" was ingested and is now available to all professors.`
              : `${successes.length} books ingested and available to all professors.`,
          variant: 'success',
        })
        resetAddForm()
        setTab('catalog')
        await reload({ silent: true })
      }

      if (failures.length > 0) {
        const firstError = failures[0].reason
        showToast({
          title: failures.length === 1 ? '1 book failed' : `${failures.length} books failed`,
          description: firstError instanceof Error ? firstError.message : 'Failed to add one or more books',
          variant: 'destructive',
        })
      }
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add book to the library',
        variant: 'destructive',
      })
    } finally {
      unsubscribe?.()
      setAddingBook(false)
      // Keep error cards visible; auto-dismiss once everything finished cleanly.
      setIngestJobs((prev) => {
        if (prev.some((j) => j.status === 'error')) return prev
        setTimeout(() => setIngestJobs([]), 2500)
        return prev
      })
    }
  }

  async function openUsages(book: LibraryBook) {
    setUsagesFor(book)
    setUsages([])
    try {
      setUsages(await fetchLibraryBookUsages(book.book_id))
    } catch {
      /* non-fatal */
    }
  }

  function BookRow({ book, mode }: { book: LibraryBook; mode: 'candidate' | 'approved' }) {
    const busy = busyId === book.book_id
    return (
      <Card>
        <CardContent className="flex gap-4 p-4">
          <BookCover book={book} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-body font-semibold text-foreground">{book.title}</h3>
                <p className="truncate text-caption text-muted-foreground">
                  {book.authors.length ? book.authors.join(', ') : 'Unknown author'}
                  {book.published_year ? ` · ${book.published_year}` : ''}
                  {book.publisher ? ` · ${book.publisher}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void openUsages(book)}
                className="flex-shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-fine-print font-medium text-primary hover:bg-primary/20"
                title="See which courses use this book"
              >
                {book.usage_count ?? 0} course{(book.usage_count ?? 0) === 1 ? '' : 's'}
              </button>
            </div>
            {book.description ? (
              <p className="mt-2 line-clamp-3 text-caption text-muted-foreground">{book.description}</p>
            ) : (
              <p className="mt-2 text-caption italic text-muted-foreground">
                No description yet — approve to generate one.
              </p>
            )}
            {book.original_filename ? (
              <p className="mt-1 truncate text-fine-print text-muted-foreground">
                Source: {book.original_filename}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {mode === 'candidate' ? (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void runAction(
                        book.book_id,
                        () => approveLibraryBook(book.book_id),
                        'Book approved and added to the library.'
                      )
                    }
                  >
                    {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void runAction(book.book_id, () => rejectLibraryBook(book.book_id), 'Book rejected.')
                    }
                  >
                    <X className="mr-1.5 h-4 w-4" />
                    Reject
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(book)}>
                    <Pencil className="mr-1.5 h-4 w-4" />
                    Edit
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(book)}>
                    <Pencil className="mr-1.5 h-4 w-4" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void runAction(
                        book.book_id,
                        () => reenrichLibraryBook(book.book_id),
                        'Re-ran AI enrichment.'
                      )
                    }
                  >
                    {busy ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1.5 h-4 w-4" />
                    )}
                    Re-enrich
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm(`Remove "${book.title}" from the library? This deletes the stored file.`)) return
                      void runAction(book.book_id, () => deleteLibraryBook(book.book_id), 'Book removed.')
                    }}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <Library className="h-6 w-6 text-primary" />
          Digital Library
        </h2>
        <p className="text-caption text-muted-foreground">
          Review books professors have used, approve them into the university library, and manage the catalog.
        </p>
      </div>

      {/* Add a book directly to the library (ingested now, reusable by any course) */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h3 className="text-body font-semibold text-foreground">Add books to the library</h3>
            <p className="text-caption text-muted-foreground">
              Upload one or more books to make them available to every professor. They are ingested &amp;
              enriched now, so adding them to a course later is instant — no re-processing.
            </p>
          </div>
          <input
            ref={addFileRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,application/pdf"
            disabled={addingBook}
            onChange={(e) => handleAddFilesChange(e.target.files)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90"
          />
          {addFiles.length > 0 && (
            <div className="space-y-1 rounded-md border border-border bg-muted/20 p-3">
              <p className="text-fine-print font-semibold uppercase tracking-wide text-muted-foreground">
                Selected files ({addFiles.length})
              </p>
              <ul className="space-y-1">
                {addFiles.map((f, idx) => (
                  <li key={`${f.name}-${idx}`} className="truncate text-caption text-foreground">
                    {idx + 1}. {f.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              placeholder={
                addFiles.length === 1
                  ? 'Title (optional — detected from the book if blank)'
                  : 'Select exactly one file to set a custom title'
              }
              value={addTitle}
              disabled={addingBook || addFiles.length !== 1}
              onChange={(e) => {
                setAddTitle(e.target.value)
                setAddTitleEdited(true)
              }}
            />
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={addSourceType}
              disabled={addingBook}
              onChange={(e) => setAddSourceType(e.target.value as ReferenceSourceType)}
            >
              {SOURCE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-fine-print text-muted-foreground">
              {addingBook ? 'Ingesting & enriching… this can take a minute per book.' : ''}
            </p>
            <Button size="sm" disabled={addingBook || addFiles.length === 0} onClick={() => void handleAddBook()}>
              {addingBook ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-4 w-4" />
              )}
              {addingBook
                ? 'Adding…'
                : addFiles.length > 1
                  ? `Add ${addFiles.length} books to library`
                  : 'Add to library'}
            </Button>
          </div>

          {/* Live ingestion progress (one compact row per in-flight book) */}
          {ingestJobs.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {ingestJobs.length > 1 && (
                <p className="text-fine-print font-semibold uppercase tracking-wide text-muted-foreground">
                  Ingesting {ingestJobs.length} books
                </p>
              )}
              {ingestJobs.map((job) => (
                <IngestionProgressCard key={job.jobId} progress={job} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'candidates' | 'catalog')}>
          <TabsList>
            <TabsTrigger value="candidates">
              <BookMarked className="mr-1.5 h-4 w-4" />
              Pending review ({candidates.length})
            </TabsTrigger>
            <TabsTrigger value="catalog">
              <Library className="mr-1.5 h-4 w-4" />
              Library catalog ({approved.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="candidates" className="space-y-3">
            {candidates.length === 0 ? (
              <p className="py-8 text-center text-caption text-muted-foreground">
                No books pending review. Books professors upload as references show up here.
              </p>
            ) : (
              candidates.map((book) => <BookRow key={book.book_id} book={book} mode="candidate" />)
            )}
          </TabsContent>

          <TabsContent value="catalog" className="space-y-3">
            {approved.length === 0 ? (
              <p className="py-8 text-center text-caption text-muted-foreground">
                The library is empty. Approve a pending book to add it here.
              </p>
            ) : (
              approved.map((book) => <BookRow key={book.book_id} book={book} mode="approved" />)
            )}
          </TabsContent>
        </Tabs>
      )}

      {editing ? (
        <EditBookDialog
          book={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await reload({ silent: true })
          }}
        />
      ) : null}

      <Dialog open={!!usagesFor} onOpenChange={(open) => !open && setUsagesFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Where it&apos;s used</DialogTitle>
            <DialogDescription>{usagesFor?.title}</DialogDescription>
          </DialogHeader>
          {usages.length === 0 ? (
            <p className="text-caption text-muted-foreground">Not used in any course yet.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-auto">
              {usages.map((u) => (
                <li
                  key={`${u.book_id}-${u.course_code}`}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-caption"
                >
                  <span className="font-medium text-foreground">{u.course_code}</span>
                  <span className="text-muted-foreground">{new Date(u.added_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EditBookDialog({
  book,
  onClose,
  onSaved,
}: {
  book: LibraryBook
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [title, setTitle] = useState(book.title)
  const [authors, setAuthors] = useState(book.authors.join(', '))
  const [description, setDescription] = useState(book.description)
  const [isbn, setIsbn] = useState(book.isbn ?? '')
  const [publisher, setPublisher] = useState(book.publisher ?? '')
  const [year, setYear] = useState(book.published_year ? String(book.published_year) : '')
  const [saving, setSaving] = useState(false)

  async function save() {
    try {
      setSaving(true)
      await updateLibraryBook(book.book_id, {
        title: title.trim(),
        authors: authors
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
        description: description.trim(),
        isbn: isbn.trim() || null,
        publisher: publisher.trim() || null,
        published_year: year.trim() ? Number(year.trim()) : null,
      })
      showToast({ title: 'Saved', description: 'Book details updated.', variant: 'success' })
      await onSaved()
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit book</DialogTitle>
          <DialogDescription>Adjust the catalog metadata shown to professors.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-fine-print font-medium text-muted-foreground">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-fine-print font-medium text-muted-foreground">
              Authors (comma separated)
            </label>
            <Input value={authors} onChange={(e) => setAuthors(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-fine-print font-medium text-muted-foreground">Description</label>
            <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-fine-print font-medium text-muted-foreground">ISBN</label>
              <Input value={isbn} onChange={(e) => setIsbn(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-fine-print font-medium text-muted-foreground">Publisher</label>
              <Input value={publisher} onChange={(e) => setPublisher(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-fine-print font-medium text-muted-foreground">Year</label>
              <Input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
