/**
 * Pure-function auth tests (no DB): password hashing/verification + JWT round-trip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword } from '../password.js';
import { signAuthToken, verifyAuthToken } from '../jwt.js';

test('hashPassword + verifyPassword accept the correct password and reject wrong ones', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple', 'hash must not equal the plaintext');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('verifyPassword returns false for an empty/invalid hash', async () => {
  assert.equal(await verifyPassword('anything', ''), false);
  assert.equal(await verifyPassword('anything', 'not-a-bcrypt-hash'), false);
});

test('signAuthToken + verifyAuthToken round-trips the payload', () => {
  const token = signAuthToken({ sub: 'u1', email: 'a@b.c', role: 'admin', name: 'Ada' });
  const decoded = verifyAuthToken(token);
  assert.ok(decoded, 'token should verify');
  assert.equal(decoded?.sub, 'u1');
  assert.equal(decoded?.role, 'admin');
  assert.equal(decoded?.email, 'a@b.c');
  assert.equal(decoded?.name, 'Ada');
});

test('verifyAuthToken rejects a tampered/garbage token', () => {
  assert.equal(verifyAuthToken('garbage.token.value'), null);
  const token = signAuthToken({ sub: 'u1', email: 'a@b.c', role: 'professor', name: 'Pat' });
  assert.equal(verifyAuthToken(token + 'x'), null);
});
