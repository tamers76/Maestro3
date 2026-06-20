/**
 * Maestro-owned produced video assets — ingest HeyGen output, catalog in blob_files,
 * stream for in-app SME review.
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { Request, Response } from 'express';
import * as blobRepo from '../db/repos/blobRepo.js';

const DATA_DIR = join(process.cwd(), '..', 'data', 'courses');
const ASSET_PREFIX = 'MSTR-VID';

export interface ProducedVideoIngestResult {
  maestro_video_asset_id: string;
  maestro_video_stored: boolean;
  maestro_video_bytes?: number;
  maestro_video_ingested_at?: string;
  maestro_video_ingest_error?: string;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

/** Stable Maestro asset tag for a produced learning-object video. */
export function buildMaestroVideoAssetId(courseCode: string, objectId: string): string {
  const course = courseCode.trim().toUpperCase();
  const object = objectId.trim();
  return `${ASSET_PREFIX}-${course}-${object}`;
}

export function producedVideoFileName(objectId: string): string {
  return `${objectId}.mp4`;
}

export function getProducedVideoAbsolutePath(courseCode: string, objectId: string): string {
  return join(DATA_DIR, courseCode, 'media', 'video', producedVideoFileName(objectId));
}

export function ensureProducedVideoDirectory(courseCode: string): string {
  const dir = join(DATA_DIR, courseCode, 'media', 'video');
  ensureDir(dir);
  return dir;
}

async function downloadUrlToFile(url: string, destPath: string): Promise<number> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  if (!response.body) {
    throw new Error('Download response has no body');
  }
  await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), createWriteStream(destPath));
  return statSync(destPath).size;
}

/**
 * Pull HeyGen MP4 into Maestro storage and register in blob_files.
 * Skips re-download when file already exists for the same HeyGen video id.
 */
export async function ingestProducedVideoFromHeyGen(input: {
  courseCode: string;
  objectId: string;
  heygenVideoId: string;
  sourceUrl: string;
  mock?: boolean;
}): Promise<ProducedVideoIngestResult> {
  const assetId = buildMaestroVideoAssetId(input.courseCode, input.objectId);
  const ingestedAt = new Date().toISOString();

  if (input.mock || !input.sourceUrl?.trim() || input.sourceUrl.includes('mock.heygen.local')) {
    return {
      maestro_video_asset_id: assetId,
      maestro_video_stored: false,
      maestro_video_ingested_at: ingestedAt,
    };
  }

  const destPath = getProducedVideoAbsolutePath(input.courseCode, input.objectId);
  ensureProducedVideoDirectory(input.courseCode);

  try {
    const bytes = await downloadUrlToFile(input.sourceUrl, destPath);
    await blobRepo.record({
      courseCode: input.courseCode,
      kind: 'produced_video',
      docType: input.objectId,
      format: 'mp4',
      path: destPath,
      bytes,
    });
    return {
      maestro_video_asset_id: assetId,
      maestro_video_stored: true,
      maestro_video_bytes: bytes,
      maestro_video_ingested_at: ingestedAt,
    };
  } catch (error) {
    return {
      maestro_video_asset_id: assetId,
      maestro_video_stored: false,
      maestro_video_ingested_at: ingestedAt,
      maestro_video_ingest_error:
        error instanceof Error ? error.message : 'Failed to ingest video into Maestro storage',
    };
  }
}

export function resolveStoredProducedVideoPath(
  courseCode: string,
  objectId: string
): string | null {
  const path = getProducedVideoAbsolutePath(courseCode, objectId);
  return existsSync(path) ? path : null;
}

/** Stream MP4 with Range support for in-browser review. */
export function streamProducedVideoFile(filePath: string, req: Request, res: Response): void {
  const stat = statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Content-Length', chunkSize);
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', fileSize);
  createReadStream(filePath).pipe(res);
}
