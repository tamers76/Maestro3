/**
 * Digital Library routes (institution-wide book catalog).
 *
 * Mounted at /api/library for admins + professors. Professors can search the
 * APPROVED catalog and add a book to a course they can access; everything else
 * (review candidates, approve/reject/edit/delete/re-enrich) is admin-only.
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import type { ReferenceSourceType } from '../models/schemas.js';
import {
  listCandidates,
  listApproved,
  getBook,
  listUsages,
  searchApprovedBooks,
  approveBook,
  reenrichBook,
  rejectBook,
  updateBookMetadata,
  deleteBook,
  useBookInCourse,
  addBookToLibrary,
  type BookMetadataEdit,
} from '../services/library.service.js';
import { resolveBookFile, streamBookFile } from '../services/libraryStorage.service.js';
import { requireRole } from '../auth/middleware.js';
import { resolveCourseAccess } from '../auth/courseAccess.js';
import {
  makeIngestionReporter,
  emitIngestionProgress,
  subscribeToCourseIngestion,
  getActiveIngestionsForCourse,
  type IngestionProgress,
} from '../services/ingestionProgress.service.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const SOURCE_TYPES: ReferenceSourceType[] = ['textbook_chapter', 'paper', 'other'];

/**
 * Pseudo "course" key used to multiplex admin library-ingestion progress over the
 * existing job/course progress bus. Admin uploads aren't tied to a course, so they
 * share this synthetic channel; the frontend demuxes individual files by `jobId`.
 */
const LIBRARY_INGEST_CHANNEL = '__library__';

function parseStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

// ─── Professor + admin: browse / use the approved catalog ───────────────────

// GET /api/library/books?search=...&course=CODE — approved books only (professor-facing).
// When `course` is provided each book is flagged `already_in_course`.
router.get('/books', async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.search === 'string' ? req.query.search : '';
    const course = typeof req.query.course === 'string' ? req.query.course.trim() : '';
    const books = await searchApprovedBooks(query, course || undefined);
    res.json({ books });
  } catch (error) {
    console.error('[library] search failed:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to search library' });
  }
});

// GET /api/library/books/:id/cover — authenticated cover image stream.
router.get('/books/:id/cover', async (req: Request, res: Response) => {
  try {
    const book = await getBook(req.params.id);
    if (!book || !book.cover_path) return res.status(404).json({ error: 'Cover not found' });
    const full = resolveBookFile(book.book_id, book.cover_path);
    if (!full) return res.status(404).json({ error: 'Cover not found' });
    const { stream, size, contentType } = streamBookFile(full);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(size));
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (error) {
    console.error('[library] cover stream failed:', error);
    res.status(500).json({ error: 'Failed to load cover' });
  }
});

// POST /api/library/books/:id/use-in-course — add an approved book to a course.
router.post('/books/:id/use-in-course', async (req: Request, res: Response) => {
  try {
    const courseCode = typeof req.body?.course_code === 'string' ? req.body.course_code.trim() : '';
    if (!courseCode) return res.status(400).json({ error: 'course_code is required' });

    // Professors may only add to courses they can access; admins can add anywhere.
    const access = await resolveCourseAccess(req.user!, courseCode);
    if (access === 'none') return res.status(403).json({ error: 'You do not have access to this course' });

    const jobId = req.body?.job_id ? String(req.body.job_id) : undefined;
    const onProgress = makeIngestionReporter(jobId, courseCode);

    const result = await useBookInCourse(req.params.id, courseCode, {
      addedBy: req.user?.id,
      onProgress,
    });
    res.status(201).json(result);
  } catch (error) {
    console.error('[library] use-in-course failed:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to add book to course' });
  }
});

// ─── Admin-only: curation ───────────────────────────────────────────────────

// POST /api/library/books — admin uploads a book DIRECTLY into the library (no
// course). The file is ingested into the canonical index here so later course-adds
// are instant clones. Returns the created/approved catalog book.
router.post('/books', requireRole('admin'), upload.single('file'), async (req: Request, res: Response) => {
  const jobId = req.body?.job_id ? String(req.body.job_id) : undefined;
  const filename = req.file?.originalname;
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const rawType = String(req.body?.source_type || 'other') as ReferenceSourceType;
    const sourceType = SOURCE_TYPES.includes(rawType) ? rawType : 'other';
    const onProgress = makeIngestionReporter(jobId, LIBRARY_INGEST_CHANNEL);

    try {
      const book = await addBookToLibrary({
        buffer: file.buffer,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        title: req.body?.title ? String(req.body.title) : undefined,
        sourceType,
        createdBy: req.user?.id,
        onProgress,
      });
      if (jobId) {
        emitIngestionProgress({
          jobId,
          courseCode: LIBRARY_INGEST_CHANNEL,
          phase: 'done',
          docTitle: book.title,
          filename: file.originalname,
          chunkCount: book.canonical?.chunk_count,
          message: `Added "${book.title}" to the library — ${book.canonical?.chunk_count ?? 0} passages indexed.`,
        });
      }
      return res.status(201).json({ book });
    } catch (error) {
      if (jobId) {
        emitIngestionProgress({
          jobId,
          courseCode: LIBRARY_INGEST_CHANNEL,
          phase: 'error',
          filename,
          error: error instanceof Error ? error.message : 'Failed to add book',
          message: error instanceof Error ? error.message : 'Failed to add book to the library.',
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('[library] add-to-library failed:', error);
    return res
      .status(400)
      .json({ error: error instanceof Error ? error.message : 'Failed to add book to the library' });
  }
});

// GET /api/library/books/ingest/stream — SSE live progress for ALL in-flight admin
// library uploads, multiplexed over ONE connection (demuxed client-side by jobId).
// Mirrors the course reference stream so the admin "Add books" flow shows the same
// per-file ingestion animation. Declared before /books/:id so it isn't shadowed.
router.get('/books/ingest/stream', requireRole('admin'), (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  for (const job of getActiveIngestionsForCourse(LIBRARY_INGEST_CHANNEL)) {
    res.write(`data: ${JSON.stringify(job)}\n\n`);
  }

  const unsubscribe = subscribeToCourseIngestion(LIBRARY_INGEST_CHANNEL, (update: IngestionProgress) => {
    res.write(`data: ${JSON.stringify(update)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.get('/candidates', requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    res.json({ books: await listCandidates() });
  } catch (error) {
    console.error('[library] list candidates failed:', error);
    res.status(500).json({ error: 'Failed to load candidates' });
  }
});

router.get('/approved', requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    res.json({ books: await listApproved() });
  } catch (error) {
    console.error('[library] list approved failed:', error);
    res.status(500).json({ error: 'Failed to load approved books' });
  }
});

router.get('/books/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const book = await getBook(req.params.id);
    if (!book) return res.status(404).json({ error: 'Book not found' });
    res.json({ book });
  } catch (error) {
    console.error('[library] get book failed:', error);
    res.status(500).json({ error: 'Failed to load book' });
  }
});

router.get('/books/:id/usages', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    res.json({ usages: await listUsages(req.params.id) });
  } catch (error) {
    console.error('[library] list usages failed:', error);
    res.status(500).json({ error: 'Failed to load usages' });
  }
});

router.post('/books/:id/approve', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const book = await approveBook(req.params.id, req.user?.id);
    res.json({ book });
  } catch (error) {
    console.error('[library] approve failed:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to approve book' });
  }
});

router.post('/books/:id/reject', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const book = await rejectBook(req.params.id, req.user?.id);
    res.json({ book });
  } catch (error) {
    console.error('[library] reject failed:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to reject book' });
  }
});

router.post('/books/:id/reenrich', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const book = await reenrichBook(req.params.id);
    res.json({ book });
  } catch (error) {
    console.error('[library] re-enrich failed:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to re-enrich book' });
  }
});

router.patch('/books/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const edit: BookMetadataEdit = {
      title: typeof body.title === 'string' ? body.title : undefined,
      authors: parseStringArray(body.authors),
      description: typeof body.description === 'string' ? body.description : undefined,
      isbn: body.isbn === null ? null : typeof body.isbn === 'string' ? body.isbn : undefined,
      publisher: body.publisher === null ? null : typeof body.publisher === 'string' ? body.publisher : undefined,
      published_year:
        body.published_year === null
          ? null
          : body.published_year !== undefined
            ? Number(body.published_year)
            : undefined,
      source_type: body.source_type,
      status: body.status,
    };
    const book = await updateBookMetadata(req.params.id, edit);
    res.json({ book });
  } catch (error) {
    console.error('[library] update failed:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update book' });
  }
});

router.delete('/books/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const ok = await deleteBook(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Book not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('[library] delete failed:', error);
    res.status(500).json({ error: 'Failed to delete book' });
  }
});

export default router;
