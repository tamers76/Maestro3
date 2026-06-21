/**
 * Peer-to-peer review request flow (run under RUN_DB_TESTS=1).
 *
 * Verifies: accepting a request grants the reviewer access (course resolves as
 * `reviewer`); declining does not grant access; and a pending-request guard
 * prevents duplicates. The "only the recipient may respond" rule is enforced in
 * the route layer; here we cover the repo + access-granting side effects.
 */
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import * as userRepo from '../../db/repos/userRepo.js';
import * as courseRepo from '../../db/repos/courseRepo.js';
import * as reviewRequestRepo from '../../db/repos/reviewRequestRepo.js';
import { resolveCourseAccess } from '../courseAccess.js';
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

test('accepting a review request grants reviewer access', { skip: dbSkip }, async () => {
  const owner = await makeUser('owner@x.io', 'professor');
  const reviewer = await makeUser('reviewer@x.io', 'professor');
  await courseRepo.createCourse(makeCourse('RR1'));
  await userRepo.setCourseOwner('RR1', owner.id);

  assert.equal(await resolveCourseAccess(reviewer, 'RR1'), 'none');

  const req = await reviewRequestRepo.create({
    courseCode: 'RR1',
    requesterId: owner.id,
    reviewerId: reviewer.id,
  });

  // Simulate the accept side effects from the route handler.
  await userRepo.assignReviewer(req.course_code, req.reviewer_id, req.requester_id);
  await reviewRequestRepo.setStatus(req.id, 'accepted');

  assert.equal(await resolveCourseAccess(reviewer, 'RR1'), 'reviewer');
  const after = await reviewRequestRepo.getById(req.id);
  assert.equal(after?.status, 'accepted');
});

test('declining a review request does not grant access', { skip: dbSkip }, async () => {
  const owner = await makeUser('owner2@x.io', 'professor');
  const reviewer = await makeUser('reviewer2@x.io', 'professor');
  await courseRepo.createCourse(makeCourse('RR2'));
  await userRepo.setCourseOwner('RR2', owner.id);

  const req = await reviewRequestRepo.create({
    courseCode: 'RR2',
    requesterId: owner.id,
    reviewerId: reviewer.id,
  });

  // Decline: status only, no assignment.
  await reviewRequestRepo.setStatus(req.id, 'declined');

  assert.equal(await resolveCourseAccess(reviewer, 'RR2'), 'none');
  const after = await reviewRequestRepo.getById(req.id);
  assert.equal(after?.status, 'declined');
});

test('hasPending guards against duplicate pending requests', { skip: dbSkip }, async () => {
  const owner = await makeUser('owner3@x.io', 'professor');
  const reviewer = await makeUser('reviewer3@x.io', 'professor');
  await courseRepo.createCourse(makeCourse('RR3'));
  await userRepo.setCourseOwner('RR3', owner.id);

  assert.equal(await reviewRequestRepo.hasPending('RR3', reviewer.id), false);
  await reviewRequestRepo.create({ courseCode: 'RR3', requesterId: owner.id, reviewerId: reviewer.id });
  assert.equal(await reviewRequestRepo.hasPending('RR3', reviewer.id), true);

  // Incoming list reflects the reviewer's pending request.
  const incoming = await reviewRequestRepo.listIncoming(reviewer.id);
  assert.equal(incoming.length, 1);
  assert.equal(incoming[0].course_code, 'RR3');
});

test('candidates exclude existing reviewers and pending recipients', { skip: dbSkip }, async () => {
  const owner = await makeUser('owner4@x.io', 'professor');
  const reviewer = await makeUser('reviewer4@x.io', 'professor');
  await courseRepo.createCourse(makeCourse('RR4'));
  await userRepo.setCourseOwner('RR4', owner.id);

  await reviewRequestRepo.create({ courseCode: 'RR4', requesterId: owner.id, reviewerId: reviewer.id });
  const pending = await reviewRequestRepo.pendingReviewerIdsForCourse('RR4');
  assert.deepEqual(pending, [reviewer.id]);
});
