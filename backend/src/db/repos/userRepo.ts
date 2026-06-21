/**
 * User + course-access repository.
 *
 * Owns the `users` table plus the two course-access join tables
 * (`course_review_assignments`, `course_student_assignments`). Mirrors the other
 * repos: each method accepts an optional executor for transactional composition.
 */
import { and, eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { users, courseReviewAssignments, courseStudentAssignments, type UserRole } from '../schema/auth.js';
import { courses } from '../schema/courses.js';
import { exec, type Executor } from './_exec.js';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  avatar_path: string | null;
  title: string;
  department: string;
  bio: string;
  phone: string;
  created_at: string;
  updated_at: string;
}

export interface UserWithSecret extends UserRecord {
  password_hash: string;
}

function toRecord(row: typeof users.$inferSelect): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    is_active: row.isActive,
    avatar_path: row.avatarPath ?? null,
    title: row.title ?? '',
    department: row.department ?? '',
    bio: row.bio ?? '',
    phone: row.phone ?? '',
    created_at: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
    updated_at: (row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt)).toISOString(),
  };
}

export async function createUser(
  input: { email: string; name: string; role: UserRole; passwordHash: string; id?: string; isActive?: boolean },
  tx?: Executor
): Promise<UserRecord> {
  const id = input.id ?? uuidv4();
  const rows = await exec(tx)
    .insert(users)
    .values({
      id,
      email: input.email,
      name: input.name,
      role: input.role,
      passwordHash: input.passwordHash,
      isActive: input.isActive ?? true,
      updatedAt: new Date(),
    })
    .returning();
  return toRecord(rows[0]);
}

export async function getUserById(id: string, tx?: Executor): Promise<UserRecord | null> {
  const rows = await exec(tx).select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function getUserByEmail(email: string, tx?: Executor): Promise<UserWithSecret | null> {
  const rows = await exec(tx)
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...toRecord(row), password_hash: row.passwordHash };
}

export async function listUsers(tx?: Executor): Promise<UserRecord[]> {
  const rows = await exec(tx).select().from(users).orderBy(users.createdAt);
  return rows.map(toRecord);
}

export async function countUsers(tx?: Executor): Promise<number> {
  const rows = await exec(tx).select({ c: sql<number>`count(*)::int` }).from(users);
  return rows[0]?.c ?? 0;
}

export async function setUserActive(id: string, isActive: boolean, tx?: Executor): Promise<void> {
  await exec(tx).update(users).set({ isActive, updatedAt: new Date() }).where(eq(users.id, id));
}

export async function updatePassword(id: string, passwordHash: string, tx?: Executor): Promise<void> {
  await exec(tx).update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, id));
}

export async function setUserRole(id: string, role: UserRole, tx?: Executor): Promise<void> {
  await exec(tx).update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, id));
}

export interface ProfileUpdate {
  name?: string;
  email?: string;
  title?: string;
  department?: string;
  bio?: string;
  phone?: string;
}

export async function updateProfile(id: string, patch: ProfileUpdate, tx?: Executor): Promise<UserRecord | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.email !== undefined) set.email = patch.email;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.department !== undefined) set.department = patch.department;
  if (patch.bio !== undefined) set.bio = patch.bio;
  if (patch.phone !== undefined) set.phone = patch.phone;
  const rows = await exec(tx).update(users).set(set).where(eq(users.id, id)).returning();
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function setAvatarPath(id: string, avatarPath: string, tx?: Executor): Promise<void> {
  await exec(tx).update(users).set({ avatarPath, updatedAt: new Date() }).where(eq(users.id, id));
}

// ===== Course ownership =====

export async function setCourseOwner(courseCode: string, ownerUserId: string | null, tx?: Executor): Promise<void> {
  await exec(tx).update(courses).set({ ownerUserId, updatedAt: new Date() }).where(eq(courses.courseCode, courseCode));
}

export async function getCourseOwner(courseCode: string, tx?: Executor): Promise<string | null> {
  const rows = await exec(tx)
    .select({ ownerUserId: courses.ownerUserId })
    .from(courses)
    .where(eq(courses.courseCode, courseCode))
    .limit(1);
  return rows[0]?.ownerUserId ?? null;
}

// ===== Review assignments (professors) =====

export async function assignReviewer(
  courseCode: string,
  professorId: string,
  assignedBy: string,
  tx?: Executor
): Promise<void> {
  await exec(tx)
    .insert(courseReviewAssignments)
    .values({ courseCode, professorId, assignedBy })
    .onConflictDoNothing();
}

export async function removeReviewer(courseCode: string, professorId: string, tx?: Executor): Promise<void> {
  await exec(tx)
    .delete(courseReviewAssignments)
    .where(
      and(eq(courseReviewAssignments.courseCode, courseCode), eq(courseReviewAssignments.professorId, professorId))
    );
}

export async function isReviewer(courseCode: string, professorId: string, tx?: Executor): Promise<boolean> {
  const rows = await exec(tx)
    .select({ c: sql`1` })
    .from(courseReviewAssignments)
    .where(
      and(eq(courseReviewAssignments.courseCode, courseCode), eq(courseReviewAssignments.professorId, professorId))
    )
    .limit(1);
  return rows.length > 0;
}

export async function listReviewerIdsForCourse(courseCode: string, tx?: Executor): Promise<string[]> {
  const rows = await exec(tx)
    .select({ professorId: courseReviewAssignments.professorId })
    .from(courseReviewAssignments)
    .where(eq(courseReviewAssignments.courseCode, courseCode));
  return rows.map((r) => r.professorId);
}

export async function listReviewCourseCodesForProfessor(professorId: string, tx?: Executor): Promise<string[]> {
  const rows = await exec(tx)
    .select({ courseCode: courseReviewAssignments.courseCode })
    .from(courseReviewAssignments)
    .where(eq(courseReviewAssignments.professorId, professorId));
  return rows.map((r) => r.courseCode);
}

// ===== Student assignments =====

export async function assignStudent(
  courseCode: string,
  studentId: string,
  assignedBy: string,
  tx?: Executor
): Promise<void> {
  await exec(tx)
    .insert(courseStudentAssignments)
    .values({ courseCode, studentId, assignedBy })
    .onConflictDoNothing();
}

export async function removeStudent(courseCode: string, studentId: string, tx?: Executor): Promise<void> {
  await exec(tx)
    .delete(courseStudentAssignments)
    .where(
      and(eq(courseStudentAssignments.courseCode, courseCode), eq(courseStudentAssignments.studentId, studentId))
    );
}

export async function isStudentAssigned(courseCode: string, studentId: string, tx?: Executor): Promise<boolean> {
  const rows = await exec(tx)
    .select({ c: sql`1` })
    .from(courseStudentAssignments)
    .where(
      and(eq(courseStudentAssignments.courseCode, courseCode), eq(courseStudentAssignments.studentId, studentId))
    )
    .limit(1);
  return rows.length > 0;
}

export async function listStudentIdsForCourse(courseCode: string, tx?: Executor): Promise<string[]> {
  const rows = await exec(tx)
    .select({ studentId: courseStudentAssignments.studentId })
    .from(courseStudentAssignments)
    .where(eq(courseStudentAssignments.courseCode, courseCode));
  return rows.map((r) => r.studentId);
}

export async function listAssignedCourseCodesForStudent(studentId: string, tx?: Executor): Promise<string[]> {
  const rows = await exec(tx)
    .select({ courseCode: courseStudentAssignments.courseCode })
    .from(courseStudentAssignments)
    .where(eq(courseStudentAssignments.studentId, studentId));
  return rows.map((r) => r.courseCode);
}
