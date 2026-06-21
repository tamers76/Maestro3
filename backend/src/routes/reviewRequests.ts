/**
 * Peer-to-peer course review requests.
 *
 * Mounted at /api/review-requests (requireAuth + requireRole('admin','professor')).
 * A course owner (or admin) asks another professor to review a course; the reviewer
 * accepts (granting review access) or declines.
 */
import { Router, Request, Response } from 'express';
import * as userRepo from '../db/repos/userRepo.js';
import * as reviewRequestRepo from '../db/repos/reviewRequestRepo.js';
import type { ReviewRequestRecord } from '../db/repos/reviewRequestRepo.js';
import { resolveCourseAccess } from '../auth/courseAccess.js';
import * as curriculumStore from '../services/curriculumStore.service.js';
import { recordAudit } from '../services/audit.service.js';

const router = Router();

/** Minimal public view of the "other party" on a request. */
function partyView(user: Awaited<ReturnType<typeof userRepo.getUserById>>) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar_url: user.avatar_path ? `/api/auth/users/${user.id}/avatar` : null,
  };
}

async function buildCourseTitleMap(codes: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(codes));
  await Promise.all(
    unique.map(async (code) => {
      try {
        const course = await curriculumStore.getCourse(code);
        if (course?.title) map.set(code, course.title);
      } catch {
        /* ignore missing course */
      }
    })
  );
  return map;
}

async function enrich(requests: ReviewRequestRecord[], direction: 'incoming' | 'outgoing') {
  const titleMap = await buildCourseTitleMap(requests.map((r) => r.course_code));
  return Promise.all(
    requests.map(async (r) => {
      const otherPartyId = direction === 'incoming' ? r.requester_id : r.reviewer_id;
      const other = await userRepo.getUserById(otherPartyId);
      return {
        ...r,
        course_title: titleMap.get(r.course_code) ?? r.course_code,
        [direction === 'incoming' ? 'requester' : 'reviewer']: partyView(other),
      };
    })
  );
}

// POST /api/review-requests - create a request (owner/admin asks a professor)
router.post('/', async (req: Request, res: Response) => {
  try {
    const courseCode = typeof req.body?.course_code === 'string' ? req.body.course_code.trim() : '';
    const reviewerId = typeof req.body?.reviewer_id === 'string' ? req.body.reviewer_id.trim() : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!courseCode || !reviewerId) {
      return res.status(400).json({ error: 'course_code and reviewer_id are required' });
    }

    const access = await resolveCourseAccess(req.user!, courseCode);
    if (access !== 'owner' && access !== 'admin') {
      return res.status(403).json({ error: 'Only the course owner or an admin can request reviews' });
    }

    if (reviewerId === req.user!.id) {
      return res.status(400).json({ error: 'You cannot request a review from yourself' });
    }

    const reviewer = await userRepo.getUserById(reviewerId);
    if (!reviewer || !reviewer.is_active || reviewer.role !== 'professor') {
      return res.status(400).json({ error: 'Reviewer must be an active professor' });
    }

    const owner = await userRepo.getCourseOwner(courseCode);
    if (owner && owner === reviewerId) {
      return res.status(400).json({ error: 'That professor already owns this course' });
    }
    if (await userRepo.isReviewer(courseCode, reviewerId)) {
      return res.status(409).json({ error: 'That professor already reviews this course' });
    }
    if (await reviewRequestRepo.hasPending(courseCode, reviewerId)) {
      return res.status(409).json({ error: 'A pending request already exists for that professor' });
    }

    const created = await reviewRequestRepo.create({
      courseCode,
      requesterId: req.user!.id,
      reviewerId,
      message,
    });
    void recordAudit(req, {
      action: 'review_request.create',
      category: 'review',
      entityType: 'review_request',
      entityId: created.id,
      courseCode,
      targetUserId: reviewerId,
      summary: `Requested review of ${courseCode} from ${reviewer.email}`,
    });
    res.status(201).json(created);
  } catch (error) {
    console.error('[ReviewRequests] create failed:', error);
    res.status(500).json({ error: 'Failed to create review request' });
  }
});

// GET /api/review-requests?direction=incoming|outgoing
router.get('/', async (req: Request, res: Response) => {
  try {
    const direction = req.query.direction === 'outgoing' ? 'outgoing' : 'incoming';
    const requests =
      direction === 'incoming'
        ? await reviewRequestRepo.listIncoming(req.user!.id)
        : await reviewRequestRepo.listOutgoing(req.user!.id);
    res.json(await enrich(requests, direction));
  } catch (error) {
    console.error('[ReviewRequests] list failed:', error);
    res.status(500).json({ error: 'Failed to load review requests' });
  }
});

// POST /api/review-requests/:id/respond { action: 'accept'|'decline' }
router.post('/:id/respond', async (req: Request, res: Response) => {
  try {
    const action = req.body?.action;
    if (action !== 'accept' && action !== 'decline') {
      return res.status(400).json({ error: "action must be 'accept' or 'decline'" });
    }
    const request = await reviewRequestRepo.getById(req.params.id);
    if (!request) return res.status(404).json({ error: 'Review request not found' });
    if (request.reviewer_id !== req.user!.id) {
      return res.status(403).json({ error: 'Only the requested reviewer can respond' });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({ error: 'This request has already been answered' });
    }

    if (action === 'accept') {
      await userRepo.assignReviewer(request.course_code, request.reviewer_id, request.requester_id);
      await reviewRequestRepo.setStatus(request.id, 'accepted');
    } else {
      await reviewRequestRepo.setStatus(request.id, 'declined');
    }
    void recordAudit(req, {
      action: action === 'accept' ? 'review_request.accept' : 'review_request.decline',
      category: 'review',
      entityType: 'review_request',
      entityId: request.id,
      courseCode: request.course_code,
      targetUserId: request.requester_id,
      summary: `${action === 'accept' ? 'Accepted' : 'Declined'} review of ${request.course_code}`,
    });
    res.json({ ok: true, status: action === 'accept' ? 'accepted' : 'declined' });
  } catch (error) {
    console.error('[ReviewRequests] respond failed:', error);
    res.status(500).json({ error: 'Failed to respond to review request' });
  }
});

// GET /api/review-requests/candidates?course_code= - eligible professors to ask
router.get('/candidates', async (req: Request, res: Response) => {
  try {
    const courseCode = typeof req.query.course_code === 'string' ? req.query.course_code.trim() : '';
    if (!courseCode) return res.status(400).json({ error: 'course_code is required' });

    const access = await resolveCourseAccess(req.user!, courseCode);
    if (access !== 'owner' && access !== 'admin') {
      return res.status(403).json({ error: 'Only the course owner or an admin can request reviews' });
    }

    const owner = await userRepo.getCourseOwner(courseCode);
    const existingReviewers = new Set(await userRepo.listReviewerIdsForCourse(courseCode));
    const pending = new Set(await reviewRequestRepo.pendingReviewerIdsForCourse(courseCode));

    const all = await userRepo.listUsers();
    const candidates = all
      .filter(
        (u) =>
          u.role === 'professor' &&
          u.is_active &&
          u.id !== owner &&
          u.id !== req.user!.id &&
          !existingReviewers.has(u.id) &&
          !pending.has(u.id)
      )
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        avatar_url: u.avatar_path ? `/api/auth/users/${u.id}/avatar` : null,
      }));
    res.json(candidates);
  } catch (error) {
    console.error('[ReviewRequests] candidates failed:', error);
    res.status(500).json({ error: 'Failed to load candidates' });
  }
});

export default router;
