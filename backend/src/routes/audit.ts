/**
 * Admin-only audit log API.
 *
 * Mounted at /api/audit with requireAuth + requireRole('admin'). Exposes a
 * filterable, paginated view of the append-only `audit_events` table plus the
 * distinct facet values used to populate the Audit page filter dropdowns.
 */
import { Router, Request, Response } from 'express';
import * as auditRepo from '../db/repos/auditRepo.js';

const router = Router();

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// GET /api/audit — filtered, paginated audit events
router.get('/', async (req: Request, res: Response) => {
  try {
    const q = req.query;
    const limit = str(q.limit) ? Number(q.limit) : undefined;
    const offset = str(q.offset) ? Number(q.offset) : undefined;
    const page = await auditRepo.listAuditEvents({
      actorUserId: str(q.actor_user_id),
      courseCode: str(q.course_code),
      entityType: str(q.entity_type),
      entityId: str(q.entity_id),
      action: str(q.action),
      category: str(q.category),
      status: str(q.status),
      from: str(q.from),
      to: str(q.to),
      search: str(q.search),
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });
    res.json(page);
  } catch (error) {
    console.error('[Audit] list failed:', error);
    res.status(500).json({ error: 'Failed to load audit events' });
  }
});

// GET /api/audit/facets — distinct actions/categories/entity types for filters
router.get('/facets', async (_req: Request, res: Response) => {
  try {
    res.json(await auditRepo.listAuditFacets());
  } catch (error) {
    console.error('[Audit] facets failed:', error);
    res.status(500).json({ error: 'Failed to load audit facets' });
  }
});

export default router;
