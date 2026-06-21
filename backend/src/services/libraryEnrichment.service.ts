/**
 * Library book enrichment.
 *
 * When an admin approves a catalog book we enrich it for display:
 *   1. Read the stored source file and have the LLM identify the REAL bibliographic
 *      metadata (title, authors, ISBN, ...) from the document's own content. This is
 *      essential because the uploaded `title` is usually just a filename
 *      (e.g. "Book+Review+Kumar.pdf"), which never matches an external catalog.
 *   2. Look up a cover image + metadata from an external books API (Google Books
 *      first, Open Library fallback), keyed by the identified ISBN/title.
 *   3. Download the cover image to disk.
 *   4. Generate a clean academic description with the LLM, grounded in the actual
 *      extracted text so it never refuses for lack of information.
 *
 * Every external/AI/extraction step is best-effort and individually guarded: a
 * missing cover or unavailable AI provider still yields an approvable book.
 */
import type { LibraryBook } from '../models/schemas.js';
import { callAI, parseAIJson } from './ai.service.js';
import { extractTextFromBuffer } from './extraction.service.js';
import { saveCoverImage, readSourceBuffer } from './libraryStorage.service.js';

/** Metadata the LLM extracts directly from the document's own text. */
interface ContentMetadata {
  title?: string;
  authors?: string[];
  isbn?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  subjects?: string[];
  description?: string;
}

/** Max characters of document text fed to the LLM for identification. */
const CONTENT_SNIPPET_CHARS = 8000;

/**
 * Turn a filename-ish title into a plausible search string: drop the extension,
 * replace separators with spaces, strip long digit runs (ISBNs/ids), collapse
 * whitespace. Used only as a fallback when content extraction yields no title.
 */
function cleanFilenameToQuery(raw: string): string {
  return raw
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[+_-]+/g, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Identify real bibliographic metadata from the document's own content. Reads the
 * stored file, extracts text, and asks the LLM to return structured JSON. Returns
 * null when the file is missing, has no extractable text, or the LLM call fails.
 */
async function extractMetadataFromContent(book: LibraryBook): Promise<ContentMetadata | null> {
  try {
    const buffer = readSourceBuffer(book.book_id, book.file_path);
    if (!buffer) return null;
    const text = (
      await extractTextFromBuffer(buffer, book.mime_type || 'application/pdf', book.original_filename || undefined)
    )?.trim();
    if (!text) return null;
    const snippet = text.slice(0, CONTENT_SNIPPET_CHARS);

    const response = await callAI(
      [
        {
          role: 'system',
          content:
            'You identify bibliographic metadata for an academic book or paper from an excerpt of its own text. ' +
            'Return ONLY a JSON object with keys: title (string), authors (string[]), isbn (string or null), ' +
            'publisher (string or null), published_year (number or null), subjects (string[]), ' +
            'description (string: 2-4 sentence factual summary of what it covers and who it is for). ' +
            'Infer the real title from the content (NOT any filename). If a field is unknown, use null or []. ' +
            'Never refuse; base everything on the excerpt.',
        },
        {
          role: 'user',
          content: `Filename (unreliable, do not use as the title): ${book.original_filename || book.title}\n\nDocument excerpt:\n"""\n${snippet}\n"""`,
        },
      ],
      1,
      { jsonMode: true, maxTokens: 600 }
    );

    const parsed = parseAIJson<{
      title?: string;
      authors?: string[];
      isbn?: string | null;
      publisher?: string | null;
      published_year?: number | null;
      subjects?: string[];
      description?: string;
    }>(response);

    return {
      title: typeof parsed.title === 'string' ? parsed.title.trim() : undefined,
      authors: Array.isArray(parsed.authors) ? parsed.authors.map(String).filter(Boolean) : undefined,
      isbn: parsed.isbn ? String(parsed.isbn).replace(/[^0-9Xx]/g, '') || null : null,
      publisher: parsed.publisher ? String(parsed.publisher) : null,
      publishedYear: parseYear(parsed.published_year),
      subjects: Array.isArray(parsed.subjects) ? parsed.subjects.map(String).filter(Boolean) : undefined,
      description: typeof parsed.description === 'string' ? parsed.description.trim() : undefined,
    };
  } catch (err) {
    console.error('[library] content metadata extraction failed (non-fatal):', err);
    return null;
  }
}

interface ExternalMetadata {
  title?: string;
  authors?: string[];
  description?: string;
  publisher?: string;
  publishedYear?: number | null;
  isbn?: string | null;
  coverUrl?: string | null;
  subjects?: string[];
  pageCount?: number | null;
  source?: string;
}

function parseYear(value: unknown): number | null {
  if (!value) return null;
  const match = String(value).match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

/** Query the Google Books API (no key required for basic volume search). */
async function fetchFromGoogleBooks(query: string): Promise<ExternalMetadata | null> {
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: Array<{
        volumeInfo?: {
          title?: string;
          authors?: string[];
          description?: string;
          publisher?: string;
          publishedDate?: string;
          pageCount?: number;
          categories?: string[];
          industryIdentifiers?: Array<{ type: string; identifier: string }>;
          imageLinks?: { thumbnail?: string; smallThumbnail?: string };
        };
      }>;
    };
    const info = data.items?.[0]?.volumeInfo;
    if (!info) return null;
    const ids = info.industryIdentifiers ?? [];
    const isbn =
      ids.find((i) => i.type === 'ISBN_13')?.identifier ||
      ids.find((i) => i.type === 'ISBN_10')?.identifier ||
      null;
    const rawCover = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null;
    return {
      title: info.title,
      authors: info.authors,
      description: info.description,
      publisher: info.publisher,
      publishedYear: parseYear(info.publishedDate),
      isbn,
      coverUrl: rawCover ? rawCover.replace(/^http:/, 'https:') : null,
      subjects: info.categories,
      pageCount: info.pageCount ?? null,
      source: 'google_books',
    };
  } catch {
    return null;
  }
}

/** Open Library fallback (search + cover-by-id). */
async function fetchFromOpenLibrary(query: string): Promise<ExternalMetadata | null> {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      docs?: Array<{
        title?: string;
        author_name?: string[];
        first_publish_year?: number;
        publisher?: string[];
        isbn?: string[];
        cover_i?: number;
        subject?: string[];
      }>;
    };
    const doc = data.docs?.[0];
    if (!doc) return null;
    return {
      title: doc.title,
      authors: doc.author_name,
      publisher: doc.publisher?.[0],
      publishedYear: doc.first_publish_year ?? null,
      isbn: doc.isbn?.[0] ?? null,
      coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
      subjects: doc.subject?.slice(0, 8),
      source: 'open_library',
    };
  } catch {
    return null;
  }
}

async function fetchExternalMetadata(title: string, isbn?: string | null): Promise<ExternalMetadata | null> {
  const queries: string[] = [];
  if (isbn) queries.push(`isbn:${isbn}`);
  if (title) queries.push(title);
  for (const q of queries) {
    const google = await fetchFromGoogleBooks(q);
    if (google) return google;
  }
  for (const q of queries) {
    const ol = await fetchFromOpenLibrary(q);
    if (ol) return ol;
  }
  return null;
}

/** Download a remote cover image and persist it. Returns the stored filename or null. */
async function downloadCover(bookId: string, coverUrl: string): Promise<string | null> {
  try {
    const res = await fetch(coverUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!contentType.startsWith('image/')) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return null;
    return saveCoverImage(bookId, buffer, contentType);
  } catch {
    return null;
  }
}

/**
 * Generate a concise academic description via the configured LLM (best-effort).
 * Grounded in (a) external catalog metadata and (b) the content the LLM already
 * summarized from the document itself, so it never refuses for lack of detail.
 */
async function generateDescription(
  book: LibraryBook,
  external: ExternalMetadata | null,
  content: ContentMetadata | null
): Promise<string> {
  const facts = [
    `Title: ${external?.title || content?.title || book.title}`,
    external?.authors?.length
      ? `Authors: ${external.authors.join(', ')}`
      : content?.authors?.length
        ? `Authors: ${content.authors.join(', ')}`
        : '',
    external?.publisher ? `Publisher: ${external.publisher}` : '',
    external?.publishedYear ? `Year: ${external.publishedYear}` : '',
    external?.subjects?.length
      ? `Subjects: ${external.subjects.join(', ')}`
      : content?.subjects?.length
        ? `Subjects: ${content.subjects.join(', ')}`
        : '',
    external?.description ? `Source summary: ${external.description}` : '',
    content?.description ? `Content summary: ${content.description}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await callAI(
      [
        {
          role: 'system',
          content:
            'You are a university librarian writing concise, factual catalog descriptions for academic books. ' +
            'Write 2-4 sentences describing what the book covers and who it is for. ' +
            'Do not invent facts; rely only on the provided details. Never refuse or mention missing information. ' +
            'Output plain text only.',
        },
        {
          role: 'user',
          content: `Write a catalog description for this book:\n\n${facts}`,
        },
      ],
      1,
      { maxTokens: 300 }
    );
    const text = response?.trim();
    if (text) return text;
  } catch (err) {
    console.error('[library] AI description generation failed (falling back):', err);
  }

  if (content?.description?.trim()) return content.description.trim();
  if (external?.description?.trim()) return external.description.trim();
  const fallbackTitle = external?.title || content?.title || book.title;
  const fallbackAuthors = external?.authors?.length ? external.authors : content?.authors;
  return `${fallbackTitle}${fallbackAuthors?.length ? ` by ${fallbackAuthors.join(', ')}` : ''}.`;
}

/**
 * Enrich a book in place (returns a new object). The caller is responsible for
 * flipping status/approved fields and persisting the result.
 */
export async function enrichBook(book: LibraryBook): Promise<LibraryBook> {
  // 1. Identify the real metadata from the document's own content. The uploaded
  //    `title` is typically a filename, which is useless for catalog lookups.
  const content = await extractMetadataFromContent(book);

  // 2. Build the best query we can: identified title/ISBN first, cleaned filename last.
  const searchTitle = content?.title || cleanFilenameToQuery(book.title) || book.title;
  const searchIsbn = book.isbn || content?.isbn || null;
  const external = await fetchExternalMetadata(searchTitle, searchIsbn);

  // 3. Cover image (external only — content excerpt has no image).
  let coverPath = book.cover_path;
  if (external?.coverUrl) {
    const stored = await downloadCover(book.book_id, external.coverUrl);
    if (stored) coverPath = stored;
  }

  // 4. Description grounded in both external + content-derived facts.
  const description = await generateDescription(book, external, content);

  const metadata: Record<string, unknown> = { ...(book.metadata ?? {}) };
  if (external) {
    metadata.external_source = external.source;
    if (external.coverUrl) metadata.cover_source_url = external.coverUrl;
    if (external.pageCount) metadata.page_count = external.pageCount;
  }
  const subjects = external?.subjects?.length ? external.subjects : content?.subjects;
  if (subjects?.length) metadata.subjects = subjects;
  metadata.metadata_identified_from_content = Boolean(content);
  metadata.enriched_at = new Date().toISOString();

  // Resolve each field across external -> content -> existing, never blanking out.
  const finalTitle = external?.title?.trim() || content?.title?.trim() || book.title;
  const finalAuthors = external?.authors?.length
    ? external.authors
    : content?.authors?.length
      ? content.authors
      : book.authors;

  return {
    ...book,
    title: finalTitle,
    authors: finalAuthors,
    publisher: external?.publisher ?? content?.publisher ?? book.publisher,
    published_year: external?.publishedYear ?? content?.publishedYear ?? book.published_year,
    isbn: book.isbn || external?.isbn || content?.isbn || null,
    cover_path: coverPath,
    description,
    metadata,
    updated_at: new Date().toISOString(),
  };
}
