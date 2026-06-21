/**
 * Course-scoped access resolution.
 *
 * Admins can reach every course. Professors can reach a course they own
 * (courses.owner_user_id) or that they were assigned to review. Students can
 * reach only courses they were explicitly assigned (consumption surfaces land
 * later, but the access check is enforced now).
 */
import * as userRepo from '../db/repos/userRepo.js';
import type { AuthUser } from './middleware.js';

export type CourseAccessLevel = 'owner' | 'reviewer' | 'assigned' | 'admin' | 'none';

export async function resolveCourseAccess(user: AuthUser, courseCode: string): Promise<CourseAccessLevel> {
  if (user.role === 'admin') return 'admin';

  if (user.role === 'professor') {
    const owner = await userRepo.getCourseOwner(courseCode);
    if (owner && owner === user.id) return 'owner';
    if (await userRepo.isReviewer(courseCode, user.id)) return 'reviewer';
    return 'none';
  }

  if (user.role === 'student') {
    if (await userRepo.isStudentAssigned(courseCode, user.id)) return 'assigned';
    return 'none';
  }

  return 'none';
}

export async function canAccessCourse(user: AuthUser, courseCode: string): Promise<boolean> {
  return (await resolveCourseAccess(user, courseCode)) !== 'none';
}

/** Course codes a user may see in listings (admins handled by caller with getAll). */
export async function listAccessibleCourseCodes(user: AuthUser): Promise<string[]> {
  if (user.role === 'professor') {
    const reviewing = await userRepo.listReviewCourseCodesForProfessor(user.id);
    return Array.from(new Set(reviewing));
  }
  if (user.role === 'student') {
    return userRepo.listAssignedCourseCodesForStudent(user.id);
  }
  return [];
}
