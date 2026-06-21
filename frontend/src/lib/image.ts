/**
 * Client-side image processing for avatar uploads.
 *
 * Browsers happily hand us multi-megabyte camera photos that blow past the
 * backend's 2MB avatar cap. We decode the picture, center-crop it to a square
 * (so it fills the circular avatar without distortion), downscale it, and
 * re-encode as JPEG well under the limit before uploading.
 */

export interface ResizeOptions {
  /** Output width/height in pixels (square). */
  size?: number;
  /** JPEG quality 0–1. */
  quality?: number;
  /** Hard ceiling on the output file size in bytes; quality steps down to fit. */
  maxBytes?: number;
}

const DEFAULTS: Required<ResizeOptions> = {
  size: 512,
  quality: 0.85,
  maxBytes: 1.5 * 1024 * 1024,
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image encoding failed'))),
      'image/jpeg',
      quality
    );
  });
}

/**
 * Center-crop + downscale an image file to a square JPEG `File`, stepping quality
 * down until it fits under `maxBytes`.
 */
export async function resizeImageToSquare(file: File, options: ResizeOptions = {}): Promise<File> {
  const { size, quality, maxBytes } = { ...DEFAULTS, ...options };

  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file');
  }

  const img = await loadImage(file);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not supported in this browser');

  // Center-crop the largest square that fits the source image.
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  let q = quality;
  let blob = await canvasToBlob(canvas, q);
  // Step quality down if we're still over the cap (e.g. very detailed photos).
  while (blob.size > maxBytes && q > 0.4) {
    q -= 0.15;
    blob = await canvasToBlob(canvas, q);
  }

  const baseName = file.name.replace(/\.[^.]+$/, '') || 'avatar';
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
}
