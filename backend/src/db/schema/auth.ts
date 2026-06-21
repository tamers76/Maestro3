/**
 * Authentication + authorization entities (Postgres source of truth).
 *
 * Adds real users with roles plus the course-access join tables that scope what a
 * professor (review assignments) or a student (course assignments) may reach. The
 * `courses.owner_user_id` column (added in bootstrap DDL) carries primary course
 * ownership; these tables carry the secondary access grants.
 */
import { pgTable, text, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';

/** Canonical application roles. */
export type UserRole = 'admin' | 'professor' | 'student';

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name').notNull().default(''),
    role: text('role').$type<UserRole>().notNull().default('professor'),
    passwordHash: text('password_hash').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    // Profile fields (self-service)
    avatarPath: text('avatar_path'),
    title: text('title').notNull().default(''),
    department: text('department').notNull().default(''),
    bio: text('bio').notNull().default(''),
    phone: text('phone').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ emailUniq: uniqueIndex('users_email_uniq').on(t.email) })
);

/** Professors granted review access to a course they do not own. */
export const courseReviewAssignments = pgTable(
  'course_review_assignments',
  {
    courseCode: text('course_code').notNull(),
    professorId: text('professor_id').notNull(),
    assignedBy: text('assigned_by').notNull().default(''),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('course_review_assignment_pk').on(t.courseCode, t.professorId),
    byProfessor: index('course_review_assignment_professor_idx').on(t.professorId),
  })
);

/** Students assigned to consume a course (consumption UI lands later). */
export const courseStudentAssignments = pgTable(
  'course_student_assignments',
  {
    courseCode: text('course_code').notNull(),
    studentId: text('student_id').notNull(),
    assignedBy: text('assigned_by').notNull().default(''),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('course_student_assignment_pk').on(t.courseCode, t.studentId),
    byStudent: index('course_student_assignment_student_idx').on(t.studentId),
  })
);

/** Status of a peer-to-peer course review request. */
export type ReviewRequestStatus = 'pending' | 'accepted' | 'declined';

/**
 * Peer-to-peer review requests: a course owner (or admin) asks another professor
 * to review a course. Accepting grants the reviewer access via
 * `course_review_assignments`.
 */
export const courseReviewRequests = pgTable(
  'course_review_requests',
  {
    id: text('id').primaryKey(),
    courseCode: text('course_code').notNull(),
    requesterId: text('requester_id').notNull(),
    reviewerId: text('reviewer_id').notNull(),
    status: text('status').$type<ReviewRequestStatus>().notNull().default('pending'),
    message: text('message').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => ({
    byReviewer: index('course_review_request_reviewer_idx').on(t.reviewerId),
    byCourse: index('course_review_request_course_idx').on(t.courseCode),
    byRequester: index('course_review_request_requester_idx').on(t.requesterId),
  })
);
