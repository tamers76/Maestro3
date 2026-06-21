import { useCallback, useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { showToast } from '@/components/ui/Toaster'
import {
  searchLibraryBooks,
  libraryCoverUrl,
  libraryBookFileUrl,
  type LibraryBook,
} from '@/services/api'
import { BookOpen, Library, Loader2, Search, BookText } from 'lucide-react'

function BookCover({ book }: { book: LibraryBook }) {
  const url = libraryCoverUrl(book)
  if (url) {
    return (
      <img
        src={url}
        alt={book.title}
        className="h-28 w-20 flex-shrink-0 rounded object-cover shadow-sm"
      />
    )
  }
  return (
    <div className="flex h-28 w-20 flex-shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
      <BookOpen className="h-7 w-7" />
    </div>
  )
}

/**
 * Read-only digital library for professors and students: search the admin-approved
 * catalog by name/topic and open a book to read it. No curation, no pending review,
 * no add-to-course — purely browsing and reading.
 */
export default function LibraryBrowsePage() {
  const [query, setQuery] = useState('')
  const [books, setBooks] = useState<LibraryBook[]>([])
  const [loading, setLoading] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runSearch = useCallback(async (q: string) => {
    try {
      setLoading(true)
      setBooks(await searchLibraryBooks(q))
    } catch (error) {
      showToast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to load the library',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void runSearch(query), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, runSearch])

  function readBook(book: LibraryBook) {
    window.open(libraryBookFileUrl(book), '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
          <Library className="h-6 w-6 text-primary" />
          Digital Library
        </h2>
        <p className="text-caption text-muted-foreground">
          Browse and read the university&apos;s approved books. Search by title, author, or topic.
        </p>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          className="pl-9"
          placeholder="Search by title, author, or topic…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : books.length === 0 ? (
        <p className="py-12 text-center text-caption text-muted-foreground">
          {query.trim()
            ? 'No approved books match your search.'
            : 'The library has no approved books yet.'}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {books.map((book) => (
            <Card key={book.book_id}>
              <CardContent className="flex gap-3 p-4">
                <BookCover book={book} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <h3 className="line-clamp-2 text-body font-semibold text-foreground">{book.title}</h3>
                  <p className="truncate text-fine-print text-muted-foreground">
                    {book.authors.length ? book.authors.join(', ') : 'Unknown author'}
                    {book.published_year ? ` · ${book.published_year}` : ''}
                  </p>
                  {book.description ? (
                    <p className="mt-1 line-clamp-3 text-caption text-muted-foreground">
                      {book.description}
                    </p>
                  ) : null}
                  <div className="mt-auto pt-2">
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => readBook(book)}>
                      <BookText className="h-4 w-4" />
                      Read book
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
