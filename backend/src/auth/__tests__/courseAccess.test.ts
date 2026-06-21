/**
 * Course-scoped access + role rules (run under RUN_DB_TESTS=1).
 *
 * Verifies: admins see everything; professors reach only owned or review-assigned
 * courses; students reach only assigned courses; and the listing helper returns the
 * right course codes per role.
 */
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import * as userRepo from '../../db/repos/userRepo.js';
import * as courseRepo from '../../db/repos/courseRepo.js';
import { resolveCourseAccess, listAccessibleCourseCodes } from '../courseAccess.js';
import { hashPassword } from '../password.js';
import type { AuthUser } from '../middleware.js';
import { dbTestsEnabled, setupTestDb, resetTestData, teardownTestDb } from '../../db/testSupport.js';
import type { Course } from '../../models/schemas.js';

const dbSkip = dbTestsEnabled ? false : 'requires RUN_DB_TESTS=1';

before(async () => {
  if (dbTestsEnabled) await setupTestDb();
});
beforeEach(async () => {
  if (dbTestsEnabled) await resetTestData();
});
after(async () => {
  if (dbTestsEnabled) await teardownTestDb();
});

function makeCourse(code: string): Course {
  return {
    course_code: code,
    title: `Course ${code}`,
    description: '',
    credit_hours: 3,
    raw_extracted_text: '',
    current_stage: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as Course;
}

async function makeUser(email: string, role: 'admin' | 'professor' | 'student'): Promise<AuthUser> {
  const u = await userRepo.createUser({
    email,
    name: email,
    role,
    passwordHash: await hashPassword('password123'),
  });
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

test('admin can access any course', { skip: dbSkip }, async () => {
  const admin = await makeUser('admin@x.io', 'admin');
  await courseRepo.createCourse(makeCourse('C1'));
  assert.equal(await resolveCourseAccess(admin, 'C1'), 'admin');
  assert.equal(await resolveCourseAccess(admin, 'DOES-NOT-EXIST'), 'admin');
});

test('professor reaches owned + review-assigned courses only', { skip: dbSkip }, async () => {
  const prof = await makeUser('prof@x.io', 'professor');
  const other = await makeUser('other@x.io', 'professor');

  await courseRepo.createCourse(makeCourse('OWNED'));
  await courseRepo.createCourse(makeCourse('REVIEW'));
  await courseRepo.createCourse(makeCourse('FOREIGN'));

  await userRepo.setCourseOwner('OWNED', prof.id);
  await userRepo.setCourseOwner('FOREIGN', other.id);
  await userRepo.assignReviewer('REVIEW', prof.id, admin());

  assert.equal(await resolveCourseAccess(prof, 'OWNED'), 'owner');
  assert.equal(await resolveCourseAccess(prof, 'REVIEW'), 'reviewer');
  assert.equal(await resolveCourseAccess(prof, 'FOREIGN'), 'none');

  const codes = (await listAccessibleCourseCodes(prof)).sort();
  // listAccessibleCourseCodes covers review assignments; ownership is unioned by the route.
  assert.deepEqual(codes, ['REVIEW']);
});

test('student reaches only assigned courses', { skip: dbSkip }, async () => {
  const student = await makeUser('student@x.io', 'student');
  await courseRepo.createCourse(makeCourse('ASSIGNED'));
  await courseRepo.createCourse(makeCourse('UNASSIGNED'));
  await userRepo.assignStudent('ASSIGNED', student.id, admin());

  assert.equal(await resolveCourseAccess(student, 'ASSIGNED'), 'assigned');
  assert.equal(await resolveCourseAccess(student, 'UNASSIGNED'), 'none');
  assert.deepEqual(await listAccessibleCourseCodes(student), ['ASSIGNED']);
});

test('removing a reviewer revokes access', { skip: dbSkip }, async () => {
  const prof = await makeUser('rev@x.io', 'professor');
  await courseRepo.createCourse(makeCourse('R1'));
  await userRepo.assignReviewer('R1', prof.id, admin());
  assert.equal(await resolveCourseAccess(prof, 'R1'), 'reviewer');
  await userRepo.removeReviewer('R1', prof.id);
  assert.equal(await resolveCourseAccess(prof, 'R1'), 'none');
});

// Small helper: an arbitrary "assigned_by" id for assignment rows.
function admin(): string {
  return 'seed-admin';
}
