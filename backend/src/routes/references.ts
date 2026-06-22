/**
 * Reference Materials routes (RAG grounding capability)
 *
 * SME-initiated, per-course ingestion + retrieval of institutionally-licensed
 * reference documents. Mounted under /api/courses.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import type { ReferenceScope, ReferenceSourceType } from '../models/schemas.js';
import {
  ingestReferenceDocument,
  ingestReferenceFromUrl,
  listReferenceDocuments,
  deleteReferenceDocument,
  reembedCourseWithContext,
} from '../services/referenceIngestion.service.js';
import { retrieveReferenceChunks } from '../services/referenceRetrieval.service.js';
import { detectDuplicateDocuments } from '../services/referenceDedup.service.js';
import {
  getAlignmentState,
  proposeAlignment,
  getAlignmentProposal,
  updateAlignmentMapping,
  approveAlignment,
  type AlignmentMappingEdit,
} from '../services/referenceAlignment.service.js';
import {
  getCoverageState,
  getCoverageReport,
  recomputeCoverageWithDelta,
  confirmCoverage,
} from '../services/referenceCoverage.service.js';
import { suggestSourcesForClo } from '../services/referenceSourceSuggestion.service.js';
import {
  makeIngestionReporter,
  subscribeToCourseIngestion,
  getActiveIngestionsForCourse,
  emitIngestionProgress,
  type IngestionProgress,
} from '../services/ingestionProgress.service.js';
import { getCourseReferenceLibraryInfo, reuseUploadedBookIfKnown } from '../services/library.service.js';
import { requireRole, courseAccessParamHandler } from '../auth/middleware.js';

const router = Router();

// Reference ingestion/RAG is authoring work: admins + professors only, scoped to
// courses the caller can access.
router.use(requireRole('admin', 'professor'));
router.param('code', courseAccessParamHandler);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const SOURCE_TYPES: ReferenceSourceType[] = ['textbook_chapter', 'paper', 'other'];

/** Parse a list field that may arrive as JSON array or comma-separated string. */
function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean);
      } catch {
        /* fall through to CSV */
      }
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// POST /api/courses/:code/references — upload + ingest a reference document
router.post('/:code/references', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const rawType = String(req.body.source_type || 'other') as ReferenceSourceType;
    const sourceType = SOURCE_TYPES.includes(rawType) ? rawType : 'other';

    const scope: ReferenceScope = {
      clo_ids: parseList(req.body.clo_ids),
      subtopic_ids: parseList(req.body.subtopic_ids),
    };

    const jobId = req.body.job_id ? String(req.body.job_id) : undefined;
    const onProgress = makeIngestionReporter(jobId, code);

    try {
      // If this exact file is already in the library, reuse its prepared passages
      // (clone) or short-circuit if it's already a reference here — no re-ingest.
      const dedup = await reuseUploadedBookIfKnown({
        buffer: file.buffer,
        courseCode: code,
        addedBy: req.user?.id,
        onProgress,
      });
      if (dedup) {
        return res.status(201).json({
          document: dedup.document,
          reused: dedup.reused,
          already_present: dedup.alreadyPresent,
          from_library: true,
        });
      }

      const doc = await ingestReferenceDocument({
        courseCode: code,
        buffer: file.buffer,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        title: req.body.title ? String(req.body.title) : undefined,
        sourceType,
        citationLabel: req.body.citation_label ? String(req.body.citation_label) : undefined,
        scope,
        onProgress,
        uploadedBy: req.user?.id,
      });
      return res.status(201).json({ document: doc });
    } catch (error) {
      if (jobId) {
        emitIngestionProgress({
          jobId,
          courseCode: code,
          phase: 'error',
          filename: file.originalname,
          error: error instanceof Error ? error.message : 'Failed to ingest reference',
          message: error instanceof Error ? error.message : 'Ingestion failed.',
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('[references] ingest failed:', error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to ingest reference' });
  }
});

// POST /api/courses/:code/references/link — ingest a directly-downloadable PDF URL
router.post('/:code/references/link', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { url, title, source_type, citation_label, clo_ids, subtopic_ids } = req.body ?? {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'url (string) is required' });
    }

    const rawType = String(source_type || 'other') as ReferenceSourceType;
    const sourceType = SOURCE_TYPES.includes(rawType) ? rawType : 'other';

    const jobId = req.body?.job_id ? String(req.body.job_id) : undefined;
    const onProgress = makeIngestionReporter(jobId, code);

    try {
      const doc = await ingestReferenceFromUrl({
        courseCode: code,
        url,
        title: title ? String(title) : undefined,
        sourceType,
        citationLabel: citation_label ? String(citation_label) : undefined,
        scope: { clo_ids: parseList(clo_ids), subtopic_ids: parseList(subtopic_ids) },
        onProgress,
        uploadedBy: req.user?.id,
      });
      return res.status(201).json({ document: doc });
    } catch (error) {
      if (jobId) {
        emitIngestionProgress({
          jobId,
          courseCode: code,
          phase: 'error',
          error: error instanceof Error ? error.message : 'Failed to ingest reference link',
          message: error instanceof Error ? error.message : 'Ingestion failed.',
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('[references] link ingest failed:', error);
    return res
      .status(400)
      .json({ error: error instanceof Error ? error.message : 'Failed to ingest reference link' });
  }
});

// GET /api/courses/:code/references/ingest/stream — SSE live progress for ALL
// in-flight ingestion jobs in this course, multiplexed over ONE connection. The
// client opens this BEFORE POSTing uploads (each tagged with its own job_id) and
// demuxes events by `jobId`. Using a single stream avoids exhausting the browser's
// per-host connection pool when several files ingest at once.
router.get('/:code/references/ingest/stream', async (req: Request, res: Response) => {
  const { code } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Disable proxy buffering (nginx) so progress events stream in real time instead
  // of being held until the connection closes — otherwise the UI appears stuck.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Replay any in-flight/recent jobs so a late-connecting client catches up.
  for (const job of getActiveIngestionsForCourse(code)) {
    res.write(`data: ${JSON.stringify(job)}\n\n`);
  }

  const unsubscribe = subscribeToCourseIngestion(code, (update: IngestionProgress) => {
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

// GET /api/courses/:code/references — list ingested reference documents
router.get('/:code/references', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const [documents, libraryInfo] = await Promise.all([
      listReferenceDocuments(code),
      getCourseReferenceLibraryInfo(code),
    ]);
    // Attach catalog cover/description so the panel can display a picture + summary
    // for any reference linked to a library book (approved OR still a candidate).
    const withLibrary = documents.map((doc) => ({
      ...doc,
      library: libraryInfo[doc.doc_id] ?? null,
    }));
    return res.json({ documents: withLibrary });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to list references' });
  }
});

// DELETE /api/courses/:code/references/:docId — remove a reference document
router.delete('/:code/references/:docId', async (req: Request, res: Response) => {
  try {
    const { code, docId } = req.params;
    const ok = await deleteReferenceDocument(code, docId);
    if (!ok) return res.status(404).json({ error: 'Reference document not found' });
    return res.json({ success: true });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to delete reference' });
  }
});

// POST /api/courses/:code/references/retrieve — test retrieval (capability check)
// Body: { query: string, cloId?: string, subtopicId?: string, topN?: number }
router.post('/:code/references/retrieve', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { query, cloId, subtopicId, topN } = req.body ?? {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query (string) is required' });
    }
    const results = await retrieveReferenceChunks(code, query, {
      scope: { cloId, subtopicId },
      topN: typeof topN === 'number' ? topN : undefined,
    });
    return res.json({ results });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to retrieve references' });
  }
});

// ===========================================================================
// Reference Anchoring V1.0 — duplicate detection, contextual re-embed, hybrid preview
// ===========================================================================

// GET /api/courses/:code/references/duplicates — non-destructive duplicate report
router.get('/:code/references/duplicates', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    return res.json({ report: await detectDuplicateDocuments(code) });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to detect duplicates' });
  }
});

// POST /api/courses/:code/references/reembed-contextual — re-embed all chunks with
// contextual headers (cache-aware + idempotent). Returns counts + a rough cost note.
router.post('/:code/references/reembed-contextual', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const counts = await reembedCourseWithContext(code);
    const note =
      counts.headersGenerated === 0
        ? 'No content changes — 0 header LLM calls and 0 re-embeds (cache hit / idempotent run).'
        : `Generated ${counts.headersGenerated} header(s) via the cheap context-header model and re-embedded ${counts.reembedded} chunk(s); ${counts.cacheHits} cache hit(s). Cost scales ~linearly with headersGenerated (one cheap LLM call each) + reembedded embedding inputs.`;
    return res.json({ ...counts, note });
  } catch (error) {
    console.error('[references] contextual re-embed failed:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to re-embed with context',
    });
  }
});

// GET /api/courses/:code/references/retrieval-preview?query=...&subtopicId=...&topN=...
// Gate 1 inspection endpoint: hybrid multi-signal hits with per-signal scores.
router.get('/:code/references/retrieval-preview', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    if (!query.trim()) {
      return res.status(400).json({ error: 'query (string) is required' });
    }
    const subtopicId = typeof req.query.subtopicId === 'string' ? req.query.subtopicId : undefined;
    const cloId = typeof req.query.cloId === 'string' ? req.query.cloId : undefined;
    const topNRaw = typeof req.query.topN === 'string' ? Number(req.query.topN) : undefined;
    const topN = topNRaw && Number.isFinite(topNRaw) ? topNRaw : undefined;

    const hits = await retrieveReferenceChunks(code, query, {
      scope: { cloId, subtopicId },
      topN,
    });

    const results = hits.map((h) => ({
      chunk_id: h.chunk_id,
      doc_id: h.doc_id,
      citation: h.citation,
      text_preview: h.text.length > 320 ? `${h.text.slice(0, 320)}…` : h.text,
      semantic_score: h.semantic_score,
      keyword_score: h.keyword_score,
      final_score: h.final_score,
      match_reason: h.match_reason,
      clo_ids: h.clo_ids,
      subtopic_ids: h.subtopic_ids,
    }));
    return res.json({ query, count: results.length, results });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to preview retrieval' });
  }
});

// ===========================================================================
// Reference Alignment — Course Architect "Layer 7". Tags chunks to CLOs/subtopics
// so M7's scoped retrieval returns real passages. SME-reviewed, never automatic.
// ===========================================================================

// GET /api/courses/:code/references/alignment — Layer 7 state + current proposal
router.get('/:code/references/alignment', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const state = await getAlignmentState(code);
    const proposal = await getAlignmentProposal(code);
    return res.json({ state, proposal });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to read alignment state' });
  }
});

// POST /api/courses/:code/references/alignment/propose — generate a proposal
router.post('/:code/references/alignment/propose', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const body = req.body ?? {};
    const proposal = await proposeAlignment(code, {
      threshold: typeof body.threshold === 'number' ? body.threshold : undefined,
      maxCandidates: typeof body.maxCandidates === 'number' ? body.maxCandidates : undefined,
    });
    return res.json({ proposal });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to propose alignment' });
  }
});

// PUT /api/courses/:code/references/alignment/mapping — apply SME edits
router.put('/:code/references/alignment/mapping', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const edits = Array.isArray(req.body?.edits) ? (req.body.edits as AlignmentMappingEdit[]) : [];
    if (edits.length === 0) {
      return res.status(400).json({ error: 'edits[] is required' });
    }
    const proposal = await updateAlignmentMapping(code, edits);
    return res.json({ proposal });
  } catch (error) {
    return res
      .status(400)
      .json({ error: error instanceof Error ? error.message : 'Failed to update alignment mapping' });
  }
});

// POST /api/courses/:code/references/alignment/approve — write tags + re-index
router.post('/:code/references/alignment/approve', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const approver = typeof req.body?.approver === 'string' ? req.body.approver : '';
    if (!approver.trim()) {
      return res.status(400).json({ error: 'approver is required' });
    }
    const proposal = await approveAlignment(code, { approver });
    return res.json({ proposal });
  } catch (error) {
    return res
      .status(400)
      .json({ error: error instanceof Error ? error.message : 'Failed to approve alignment' });
  }
});

// ===========================================================================
// Reference Coverage — read-only, per-CLO measurement of how well the corpus
// teaches each approved CLO. Writes NO scope tags; persists a report artifact.
// ===========================================================================

// GET /api/courses/:code/references/coverage — coverage state + current report
router.get('/:code/references/coverage', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const state = await getCoverageState(code);
    const report = await getCoverageReport(code);
    return res.json({ state, report });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to read coverage state' });
  }
});

// POST /api/courses/:code/references/coverage/compute — recompute + persist report.
// Returns the new report plus a per-CLO before/after `delta` (null on first run).
router.post('/:code/references/coverage/compute', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const { report, delta } = await recomputeCoverageWithDelta(code);
    return res.json({ report, delta });
  } catch (error) {
    console.error('[references] coverage compute failed:', error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to compute coverage' });
  }
});

// POST /api/courses/:code/references/coverage/confirm — SME sign-off on the
// measured coverage. Gates Layer 2 approval; only valid once coverage is computed.
router.post('/:code/references/coverage/confirm', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const report = await confirmCoverage(code);
    return res.json({ report });
  } catch (error) {
    console.error('[references] coverage confirm failed:', error);
    return res
      .status(400)
      .json({ error: error instanceof Error ? error.message : 'Failed to approve coverage' });
  }
});

// POST /api/courses/:code/references/coverage/suggest-sources — AI source
// suggestions for ONE weak/uncovered CLO (Phase C). AI PROPOSES, SME APPROVES:
// this returns candidate sources only and NEVER ingests. Body: { clo_id }.
router.post('/:code/references/coverage/suggest-sources', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const cloId = typeof req.body?.clo_id === 'string' ? req.body.clo_id.trim() : '';
    if (!cloId) {
      return res.status(400).json({ error: 'clo_id (string) is required' });
    }
    const result = await suggestSourcesForClo(code, cloId);
    return res.json({ suggestions: result.suggestions, reason: result.reason, clo_id: result.clo_id });
  } catch (error) {
    console.error('[references] source suggestion failed:', error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Failed to suggest sources' });
  }
});

export default router;
