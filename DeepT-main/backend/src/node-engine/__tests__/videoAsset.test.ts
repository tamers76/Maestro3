import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMaestroVideoAssetId,
  getProducedVideoAbsolutePath,
  producedVideoFileName,
} from '../videoAsset.service.js';

test('buildMaestroVideoAssetId uses stable MSTR-VID tag', () => {
  assert.equal(
    buildMaestroVideoAssetId('mdld602', 'obj_video_intro'),
    'MSTR-VID-MDLD602-obj_video_intro'
  );
});

test('produced video paths are deterministic per course and object', () => {
  assert.equal(producedVideoFileName('obj_video_intro'), 'obj_video_intro.mp4');
  const abs = getProducedVideoAbsolutePath('MDLD602', 'obj_video_intro').replace(/\\/g, '/');
  assert.ok(abs.endsWith('MDLD602/media/video/obj_video_intro.mp4'));
});

test('ingestProducedVideoFromHeyGen skips mock URLs', async () => {
  const { ingestProducedVideoFromHeyGen } = await import('../videoAsset.service.js');
  const result = await ingestProducedVideoFromHeyGen({
    courseCode: 'TEST',
    objectId: 'obj_a',
    heygenVideoId: 'mock_vid',
    sourceUrl: 'https://mock.heygen.local/videos/x.mp4',
    mock: true,
  });
  assert.equal(result.maestro_video_asset_id, 'MSTR-VID-TEST-obj_a');
  assert.equal(result.maestro_video_stored, false);
});
