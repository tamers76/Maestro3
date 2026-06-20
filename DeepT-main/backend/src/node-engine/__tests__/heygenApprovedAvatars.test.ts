import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getHeyGenApprovedAvatarsConfig,
  getHeyGenApprovedAvatarGroupIds,
  groupApprovedAvatarsConfig,
} from '../heygenApprovedAvatars.service.js';

test('getHeyGenApprovedAvatarsConfig returns a copy of the defaults list', () => {
  const first = getHeyGenApprovedAvatarsConfig();
  const second = getHeyGenApprovedAvatarsConfig();
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
});

test('getHeyGenApprovedAvatarGroupIds returns configured identity IDs', () => {
  const ids = getHeyGenApprovedAvatarGroupIds();
  assert.ok(Array.isArray(ids));
});

test('groupApprovedAvatarsConfig groups by group_id', () => {
  const grouped = groupApprovedAvatarsConfig([
    { id: 'look_a', name: 'Annie in Blue', character_name: 'Annie', group_id: 'grp1' },
    { id: 'look_b', name: 'Annie in Red', character_name: 'Annie', group_id: 'grp1' },
    { id: 'look_c', name: 'Brandon suit', character_name: 'Brandon', group_id: 'grp2' },
  ]);
  assert.equal(grouped.get('grp1')?.length, 2);
  assert.equal(grouped.get('grp2')?.length, 1);
});
