import sharp from 'sharp';
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_EDGE, mediaMessages } from '@leadflow/shared';
import { AppError } from './errors';

const FORMATS: Record<string, (typeof ACCEPTED_IMAGE_TYPES)[number]> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Decodes the upload for real (the declared MIME type and file name are not trusted), then
 * re-encodes: auto-rotate, fit within MAX_IMAGE_EDGE, WebP, all metadata (EXIF/GPS) stripped.
 */
export async function processImage(input: Buffer) {
  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: 50_000_000 }).metadata()).format;
  } catch {
    throw new AppError('VALIDATION_ERROR', mediaMessages.unreadable);
  }
  if (!format || !FORMATS[format]) throw new AppError('VALIDATION_ERROR', mediaMessages.wrongType);

  try {
    const { data, info } = await sharp(input, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({
        width: MAX_IMAGE_EDGE,
        height: MAX_IMAGE_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, mime: 'image/webp' as const };
  } catch {
    throw new AppError('VALIDATION_ERROR', mediaMessages.unreadable);
  }
}
