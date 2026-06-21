/**
 * Peer-to-peer course review request repository.
 *
 * A course owner (or admin) creates a request asking another professor to review
 * a course; the reviewer accepts (granting access) or declines.
 */
import { and, desc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { courseReviewRequests, type ReviewRequestStatus } from '../schema/auth.js';
import { exec, type Executor } from './_exec.js';

export interface ReviewRequestRecord {
  id: string;
  course_code: string;
  requester_id: string;
  reviewer_id: string;
  status: ReviewRequestStatus;
  message: string;
  created_at: string;
  responded_at: string | null;
}

function toRecord(row: typeof courseReviewRequests.$inferSelect): ReviewRequestRecord {
  return {
    id: row.id,
    course_code: row.courseCode,
    requester_id: row.requesterId,
    reviewer_id: row.reviewerId,
    status: row.status,
    message: row.message ?? '',
    created_at: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
    responded_at: row.respondedAt
      ? (row.respondedAt instanceof Date ? row.respondedAt : new Date(row.respondedAt)).toISOString()
      : null,
  };
}

export async function create(
  input: { courseCode: string; requesterId: string; reviewerId: string; message?: string },
  tx?: Executor
): Promise<ReviewRequestRecord> {
  const rows = await exec(tx)
    .insert(courseReviewRequests)
    .values({
      id: uuidv4(),
      courseCode: input.courseCode,
      requesterId: input.requesterId,
      reviewerId: input.reviewerId,
      message: input.message ?? '',
      status: 'pending',
    })
    .returning();
  return toRecord(rows[0]);
}

export async function getById(id: string, tx?: Executor): Promise<ReviewRequestRecord | null> {
  const rows = await exec(tx).select().from(courseReviewRequests).where(eq(courseReviewRequests.id, id)).limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function listIncoming(reviewerId: string, tx?: Executor): Promise<ReviewRequestRecord[]> {
  const rows = await exec(tx)
    .select()
    .from(courseReviewRequests)
    .where(eq(courseReviewRequests.reviewerId, reviewerId))
    .orderBy(desc(courseReviewRequests.createdAt));
  return rows.map(toRecord);
}

export async function listOutgoing(requesterId: string, tx?: Executor): Promise<ReviewRequestRecord[]> {
  const rows = await exec(tx)
    .select()
    .from(courseReviewRequests)
    .where(eq(courseReviewRequests.requesterId, requesterId))
    .orderBy(desc(courseReviewRequests.createdAt));
  return rows.map(toRecord);
}

export async function hasPending(courseCode: string, reviewerId: string, tx?: Executor): Promise<boolean> {
  const rows = await exec(tx)
    .select({ id: courseReviewRequests.id })
    .from(courseReviewRequests)
    .where(
      and(
        eq(courseReviewRequests.courseCode, courseCode),
        eq(courseReviewRequests.reviewerId, reviewerId),
        eq(courseReviewRequests.status, 'pending')
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function setStatus(id: string, status: ReviewRequestStatus, tx?: Executor): Promise<void> {
  await exec(tx)
    .update(courseReviewRequests)
    .set({ status, respondedAt: new Date() })
    .where(eq(courseReviewRequests.id, id));
}

/** Reviewer ids with a pending request for a course (used to exclude from candidates). */
export async function pendingReviewerIdsForCourse(courseCode: string, tx?: Executor): Promise<string[]> {
  const rows = await exec(tx)
    .select({ reviewerId: courseReviewRequests.reviewerId })
    .from(courseReviewRequests)
    .where(and(eq(courseReviewRequests.courseCode, courseCode), eq(courseReviewRequests.status, 'pending')));
  return rows.map((r) => r.reviewerId);
}
