import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/Dialog'
import { showToast } from '@/components/ui/Toaster'
import {
  searchLibraryBooks,
  addLibraryBookToCourse,
  libraryCoverUrl,
  subscribeToCourseIngestion,
  newIngestionJobId,
  type LibraryBook,
  type IngestionProgress,
} from '@/services/api'
import { BookOpen, Library, Loader2, Plus, Search, Check } from 'lucide-react'

interface LibraryPickerProps {
  courseCode: string
  /** Fired after a book is successfully added to the course. */
  onAdded?: () => void
}

/** Human-readable label for an in-flight ingestion phase. */
function phaseLabel(p?: IngestionProgress): string {
  if (!p) return 'Queued…'
  switch (p.phase) {
    case 'queued':
      return 'Queued…'
    case 'extracting':
      return 'Reading file…'
    case 'chunking':
      return 'Splitting passages…'
    case 'contextualizing':
      return 'Adding context…'
    case 'embedding':
      return 'Embedding…'
    case 'indexing':
      return 'Indexing…'
    case 'done':
      return 'Added'
    case 'error':
      return 'Failed'
    default:
      return p.message || 'Working…'
  }
}

/**
 * Slim, width-contained progress shown inside a book card while it is being added.
 * Truncates its label and keeps a determinate-ish bar so concurrent adds never push
 * the dialog layout around.
 */
function InlineAddProgress({ progress }: { progress?: IngestionProgress }) {
  const pct =
    typeof progress?.percent === 'number'
      ? Math.max(8, Math.min(100, progress.percent))
      : progress?.current && progress?.total
        ? Math.max(8, Math.min(100, Math.round((progress.current / progress.total) * 100)))
        : undefined
  return (
    <div className="mt-2 min-w-0">
      <div className="flex items-center gap-1.5 text-fine-print font-medium text-emerald-600 dark:text-emerald-400">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span className="truncate">{phaseLabel(progress)}</span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={
            'h-full rounded-full bg-emerald-500 transition-all duration-500 ' +
            (pct === undefined ? 'w-1/3 animate-pulse' : '')
          }
          style={pct === undefined ? undefined : { width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function Cover({ book }: { book: LibraryBook }) {
  const url = libraryCoverUrl(book)
  if (url) {
    return <img src={url} alt={book.title} className="h-28 w-20 flex-shrink-0 rounded object-cover shadow-sm" />
  }
  return (
    <div className="flex h-28 w-20 flex-shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
      <BookOpen className="h-7 w-7" />
    </div>
  )
}

/**
 * Clean, searchable browser over the admin-approved digital library. Professors
 * search by name or topic and add a book to the current course as grounding
 * material (the stored file is re-ingested through the RAG pipeline server-side).
 */
export default function LibraryPicker({ courseCode, onAdded }: LibraryPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [books, setBooks] = useState<LibraryBook[]>([])
  const [loading, setLoading] = useState(false)
  // Per-book add state so several books can be added at once without colliding.
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set())
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const [progressByBook, setProgressByBook] = useState<Record<string, IngestionProgress>>({})
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // One shared SSE subscription for the whole picker; route updates by jobId.
  const jobToBookRef = useRef<Map<string, string>>(new Map())
  const unsubRef = useRef<(() => void) | null>(null)

  const runSearch = useCallback(async (q: string) => {
    try {
      setLoading(true)
      setBooks(await searchLibraryBooks(q, courseCode))
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to search the library',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [courseCode])

  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void runSearch(query), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [open, query, runSearch])

  // Open a single ingestion stream while the picker is open; fan out each update
  // to the book that owns its jobId. Closing the dialog tears the stream down.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const unsub = await subscribeToCourseIngestion(courseCode, (update) => {
        const bookId = jobToBookRef.current.get(update.jobId)
        if (!bookId) return
        setProgressByBook((prev) => ({ ...prev, [bookId]: update }))
      })
      if (cancelled) unsub()
      else unsubRef.current = unsub
    })()
    return () => {
      cancelled = true
      unsubRef.current?.()
      unsubRef.current = null
      jobToBookRef.current.clear()
    }
  }, [open, courseCode])

  async function handleAdd(book: LibraryBook) {
    if (addingIds.has(book.book_id) || addedIds.has(book.book_id) || book.already_in_course) return
    const jobId = newIngestionJobId()
    jobToBookRef.current.set(jobId, book.book_id)
    setAddingIds((prev) => new Set(prev).add(book.book_id))
    setProgressByBook((prev) => ({
      ...prev,
      [book.book_id]: { jobId, phase: 'queued', status: 'running', percent: 0, filename: book.title },
    }))
    try {
      const result = await addLibraryBookToCourse(book.book_id, courseCode, { job_id: jobId })
      setAddedIds((prev) => new Set(prev).add(book.book_id))
      showToast({
        title: result.alreadyPresent ? 'Already in this course' : 'Added to course',
        description: result.alreadyPresent
          ? `"${book.title}" was already a grounding reference.`
          : result.reused
            ? `"${book.title}" added instantly — reused prepared passages (no re-processing).`
            : `"${book.title}" is now a grounding reference.`,
        variant: 'success',
      })
      onAdded?.()
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to add the book',
        variant: 'destructive',
      })
    } finally {
      jobToBookRef.current.delete(jobId)
      setAddingIds((prev) => {
        const next = new Set(prev)
        next.delete(book.book_id)
        return next
      })
      setProgressByBook((prev) => {
        const next = { ...prev }
        delete next[book.book_id]
        return next
      })
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" className="gap-2" onClick={() => setOpen(true)}>
        <Library className="h-4 w-4" />
        Browse the library
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Library className="h-5 w-5 text-primary" />
              University Library
            </DialogTitle>
            <DialogDescription>
              Search approved books by name or topic and add them as grounding material. You can add
              several at once.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-9"
              placeholder="Search by title, author, or topic…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="max-h-[55vh] space-y-2 overflow-y-auto overflow-x-hidden pr-1">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : books.length === 0 ? (
              <p className="py-8 text-center text-caption text-muted-foreground">
                {query.trim()
                  ? 'No approved books match your search.'
                  : 'The library has no approved books yet.'}
              </p>
            ) : (
              books.map((book) => {
                const added = addedIds.has(book.book_id) || !!book.already_in_course
                const busy = addingIds.has(book.book_id)
                return (
                  <div
                    key={book.book_id}
                    className={
                      'flex gap-3 rounded-lg border bg-card p-3 transition-colors ' +
                      (busy ? 'border-emerald-500/40' : 'border-border')
                    }
                  >
                    <Cover book={book} />
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-body font-semibold text-foreground">{book.title}</h4>
                      <p className="truncate text-fine-print text-muted-foreground">
                        {book.authors.length ? book.authors.join(', ') : 'Unknown author'}
                        {book.published_year ? ` · ${book.published_year}` : ''}
                      </p>
                      {book.description ? (
                        <p className="mt-1 line-clamp-2 text-caption text-muted-foreground">
                          {book.description}
                        </p>
                      ) : null}
                      {busy ? (
                        <InlineAddProgress progress={progressByBook[book.book_id]} />
                      ) : (
                        <div className="mt-2">
                          <Button
                            size="sm"
                            variant={added ? 'ghost' : 'default'}
                            disabled={added}
                            onClick={() => void handleAdd(book)}
                          >
                            {added ? (
                              <Check className="mr-1.5 h-4 w-4" />
                            ) : (
                              <Plus className="mr-1.5 h-4 w-4" />
                            )}
                            {added ? 'Already added' : 'Add to course'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
