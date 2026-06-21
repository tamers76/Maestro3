/**
 * Central role/permission rules.
 *
 * Coarse-grained role capabilities live here so routes and the frontend stay in
 * sync. Course-scoped access (owner vs reviewer vs assigned student) is resolved
 * separately against the DB in `courseAccess` because it depends on per-row grants.
 */
import type { UserRole } from '../db/schema/auth.js';

export type { UserRole };

export const ROLES: UserRole[] = ['admin', 'professor', 'student'];

export function isRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (ROLES as string[]).includes(value);
}

/** Admins can do anything in the system. */
export function isAdmin(role: UserRole): boolean {
  return role === 'admin';
}

/** Who may author/run curriculum workflows on a course they can access. */
export function canAuthorCourses(role: UserRole): boolean {
  return role === 'admin' || role === 'professor';
}

/** Who may create new courses. */
export function canCreateCourses(role: UserRole): boolean {
  return role === 'admin' || role === 'professor';
}

/** Who may edit global app settings / prompt + model configuration. */
export function canManageSettings(role: UserRole): boolean {
  return role === 'admin';
}

/** Who may manage users and course access assignments. */
export function canManageUsers(role: UserRole): boolean {
  return role === 'admin';
}

/** Who may delete a course. */
export function canDeleteCourses(role: UserRole): boolean {
  return role === 'admin';
}
