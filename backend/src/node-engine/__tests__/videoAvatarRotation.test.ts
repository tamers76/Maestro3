import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAvatarRotationPool,
  resolveVideoAvatarForObject,
  stableRotationIndex,
} from '../videoAvatarRotation.service.js';

test('stableRotationIndex is deterministic per object id', () => {
  const a = stableRotationIndex('obj_video_1', 4);
  const b = stableRotationIndex('obj_video_1', 4);
  const c = stableRotationIndex('obj_video_2', 4);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('resolveVideoAvatarForObject rotates through avatar_rotation_pool', () => {
  const settings = {
    provider: 'heygen' as const,
    voice_id: 'default_voice',
    avatar_rotation_pool: [
      { id: 'look_a', name: 'Look A', default_voice_id: 'voice_a' },
      { id: 'look_b', name: 'Look B', default_voice_id: 'voice_b' },
      { id: 'look_c', name: 'Look C' },
    ],
  };
  const r1 = resolveVideoAvatarForObject(settings, 'obj_alpha');
  const r2 = resolveVideoAvatarForObject(settings, 'obj_beta');
  assert.ok(['look_a', 'look_b', 'look_c'].includes(r1.avatar_id!));
  assert.ok(['look_a', 'look_b', 'look_c'].includes(r2.avatar_id!));
  assert.equal(resolveVideoAvatarForObject(settings, 'obj_alpha').avatar_id, r1.avatar_id);
});

test('resolveVideoAvatarForObject leaves settings unchanged without pool', () => {
  const settings = {
    provider: 'heygen' as const,
    avatar_id: 'solo',
    voice_id: 'v1',
  };
  const resolved = resolveVideoAvatarForObject(settings, 'obj_x');
  assert.equal(resolved.avatar_id, 'solo');
});

test('normalizeAvatarRotationPool keeps only the first character looks', () => {
  const normalized = normalizeAvatarRotationPool([
    { id: 'a1', name: 'Raviy suit', group_id: 'grp_raviy', character_name: 'Raviy' },
    { id: 'a2', name: 'Raviy casual', group_id: 'grp_raviy', character_name: 'Raviy' },
    { id: 'b1', name: 'Darlene blue', group_id: 'grp_darlene', character_name: 'Darlene' },
  ]);
  assert.equal(normalized.length, 2);
  assert.ok(normalized.every((entry) => entry.group_id === 'grp_raviy'));
});
