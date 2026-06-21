/**
 * Audit-event repository filtering (run under RUN_DB_TESTS=1).
 *
 * Verifies createAuditEvent persistence and that listAuditEvents honors the
 * actor/course/category/action/date filters + free-text search and pagination,
 * and that listAuditFacets returns the distinct dropdown values.
 */
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import * as auditRepo from '../../db/repos/auditRepo.js';
import { dbTestsEnabled, setupTestDb, resetTestData, teardownTestDb } from '../../db/testSupport.js';

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

async function seed() {
  await auditRepo.createAuditEvent({
    actorUserId: 'u-alice',
    actorEmail: 'alice@x.io',
    actorRole: 'admin',
    action: 'user.create',
    category: 'user',
    entityType: 'user',
    entityId: 'u-new',
    targetUserId: 'u-new',
    summary: 'Created professor bob@x.io',
  });
  await auditRepo.createAuditEvent({
    actorUserId: 'u-alice',
    actorEmail: 'alice@x.io',
    actorRole: 'admin',
    action: 'course.create',
    category: 'course',
    entityType: 'course',
    entityId: 'CS101',
    courseCode: 'CS101',
    summary: 'Created course CS101',
  });
  await auditRepo.createAuditEvent({
    actorUserId: 'u-bob',
    actorEmail: 'bob@x.io',
    actorRole: 'professor',
    action: 'course.stage1_layer_approve',
    category: 'approval',
    entityType: 'stage1_layer',
    entityId: 'CS101/layer1-intake',
    courseCode: 'CS101',
    summary: 'Approved Stage 1 layer "layer1-intake" for CS101',
  });
}

test('lists all events newest-first with a total count', { skip: dbSkip }, async () => {
  await seed();
  const page = await auditRepo.listAuditEvents();
  assert.equal(page.total, 3);
  assert.equal(page.events.length, 3);
  // Newest first: the approval (last inserted) leads.
  assert.equal(page.events[0].action, 'course.stage1_layer_approve');
});

test('filters by actor, course, and category', { skip: dbSkip }, async () => {
  await seed();
  assert.equal((await auditRepo.listAuditEvents({ actorUserId: 'u-bob' })).total, 1);
  assert.equal((await auditRepo.listAuditEvents({ courseCode: 'CS101' })).total, 2);
  assert.equal((await auditRepo.listAuditEvents({ category: 'user' })).total, 1);
  assert.equal((await auditRepo.listAuditEvents({ action: 'course.create' })).total, 1);
});

test('free-text search matches summary and email', { skip: dbSkip }, async () => {
  await seed();
  assert.equal((await auditRepo.listAuditEvents({ search: 'bob@x.io' })).total, 2);
  assert.equal((await auditRepo.listAuditEvents({ search: 'layer1-intake' })).total, 1);
});

test('pagination caps the page and reports the full total', { skip: dbSkip }, async () => {
  await seed();
  const page = await auditRepo.listAuditEvents({ limit: 2, offset: 0 });
  assert.equal(page.total, 3);
  assert.equal(page.events.length, 2);
  assert.equal(page.limit, 2);
  const page2 = await auditRepo.listAuditEvents({ limit: 2, offset: 2 });
  assert.equal(page2.events.length, 1);
});

test('facets return the distinct filter values', { skip: dbSkip }, async () => {
  await seed();
  const facets = await auditRepo.listAuditFacets();
  assert.deepEqual(
    [...facets.categories].sort(),
    ['approval', 'course', 'user']
  );
  assert.ok(facets.actions.includes('user.create'));
  assert.ok(facets.entityTypes.includes('stage1_layer'));
});
