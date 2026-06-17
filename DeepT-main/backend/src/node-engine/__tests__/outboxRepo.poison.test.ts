/**
 * Projection-outbox poison / dead-letter semantics (run under RUN_DB_TESTS=1).
 *
 * A permanently-failing ("poison") row must stop being retried after
 * MAX_ATTEMPTS, park as `failed`, drop out of claimPending, and NOT head-of-line
 * block other pending rows. This is the deterministic stand-in for the manual
 * "enqueue a row whose key triggers a Neo4j failure" check.
 */
import test, { before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import * as outboxRepo from '../../db/repos/outboxRepo.js';
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

test('a poison row parks as failed after MAX_ATTEMPTS and stops being claimed', { skip: dbSkip }, async () => {
  await outboxRepo.enqueue('course', 'POISON', 'upsert');

  const claimed = await outboxRepo.claimPending();
  assert.equal(claimed.length, 1, 'the row is initially claimable');
  const id = claimed[0].id;

  // Simulate MAX_ATTEMPTS-1 failed drains: still pending each time.
  for (let i = 0; i < outboxRepo.MAX_ATTEMPTS - 1; i++) {
    await outboxRepo.markFailed(id, `boom ${i}`);
    const still = await outboxRepo.claimPending();
    assert.equal(still.length, 1, `still claimable after ${i + 1} failures (< cap)`);
  }

  // The final failure crosses the cap and dead-letters the row.
  await outboxRepo.markFailed(id, 'final boom');

  assert.equal((await outboxRepo.claimPending()).length, 0, 'parked row is no longer claimed');
  assert.equal(await outboxRepo.failedCount(), 1, 'row is counted in the dead-letter set');
  assert.equal(await outboxRepo.pendingCount(), 0, 'no rows remain pending');
});

test('a parked poison row does not block other pending rows', { skip: dbSkip }, async () => {
  await outboxRepo.enqueue('course', 'POISON', 'upsert');
  const id = (await outboxRepo.claimPending())[0].id;
  for (let i = 0; i < outboxRepo.MAX_ATTEMPTS; i++) {
    await outboxRepo.markFailed(id, 'boom');
  }
  assert.equal(await outboxRepo.failedCount(), 1, 'poison row parked');

  // A healthy row enqueued afterwards is claimable and not blocked by the poison row.
  await outboxRepo.enqueue('course', 'HEALTHY', 'upsert');
  const claimed = await outboxRepo.claimPending();
  assert.equal(claimed.length, 1, 'only the healthy row is claimable');
  assert.equal(claimed[0].entityKey, 'HEALTHY', 'the healthy row is returned, not the parked one');

  // Draining the healthy row succeeds and leaves only the dead-letter row behind.
  await outboxRepo.markDone(claimed[0].id);
  assert.equal(await outboxRepo.pendingCount(), 0, 'no pending rows remain');
  assert.equal(await outboxRepo.failedCount(), 1, 'dead-letter row remains for ops visibility');
});
