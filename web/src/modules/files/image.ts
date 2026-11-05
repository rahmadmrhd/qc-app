import type { ImageMime } from '@shared/files';
import { isImageMime, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE } from '@shared/files';
import type { UploadFileInput } from '@shared/rpc';

/** Skala turun agar sisi terpanjang <= `max`; tidak pernah membesarkan; sisi minimal 1 px. */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_IMAGE_SIDE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest <= max ? 1 : max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isAcceptedImage(file: { type: string }): boolean {
  return isImageMime(file.type);
}

const QUALITIES = [0.85, 0.7, 0.5];

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Gagal membaca gambar'));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Kecilkan (maks. `MAX_IMAGE_SIDE`) dan kompres gambar di klien sebelum diunggah. Dicoba WebP dahulu
 * (JPEG bila peramban tidak mendukung), kualitas diturunkan bertahap sampai <= `MAX_IMAGE_BYTES`.
 * Bergantung pada canvas peramban, jadi diverifikasi manual di peramban (bukan di jsdom).
 */
export async function prepareImage(
  file: File,
  maxSide: number = MAX_IMAGE_SIDE,
): Promise<UploadFileInput> {
  if (!isAcceptedImage(file)) throw new Error('Format gambar harus JPEG, PNG, atau WebP');
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Peramban tidak mendukung pengolahan gambar');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  for (const quality of QUALITIES) {
    const webp = await canvasToBlob(canvas, 'image/webp', quality);
    const blob =
      webp && webp.type === 'image/webp' ? webp : await canvasToBlob(canvas, 'image/jpeg', quality);
    if (!blob || !isImageMime(blob.type)) continue;
    if (blob.size <= MAX_IMAGE_BYTES) {
      return { mime: blob.type as ImageMime, bytes: await blobToBytes(blob), width, height };
    }
  }
  throw new Error('Gambar masih terlalu besar setelah dikompres (maks. 1 MB)');
}
