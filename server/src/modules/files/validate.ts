import { readObject } from '@server/core/validate';
import type { GetFileInput, UploadFileInput } from '@shared/contract';
import {
  isImageMime,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  matchesImageBytesSignature,
  readImageDimensions,
} from '@shared/files';

function isDimension(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_IMAGE_DIMENSION
  );
}

export function validateUploadFile(raw: unknown): UploadFileInput {
  const reader = readObject(raw);
  const mime = reader.raw('mime');
  const bytes = reader.raw('bytes');
  const width = reader.raw('width');
  const height = reader.raw('height');
  if (!isImageMime(mime)) reader.fail('mime', 'Hanya JPEG, PNG, atau WebP');
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    reader.fail('bytes', 'Isi gambar tidak valid');
  } else if (bytes.length > MAX_IMAGE_BYTES) {
    reader.fail('bytes', 'Ukuran gambar maksimal 10 MB');
  } else if (isImageMime(mime) && !matchesImageBytesSignature(mime, bytes)) {
    reader.fail('bytes', 'Isi berkas tidak sesuai jenis gambar');
  }
  if (!isDimension(width)) reader.fail('width', 'Lebar tidak valid');
  if (!isDimension(height)) reader.fail('height', 'Tinggi tidak valid');
  // Dimensi sebenarnya dibaca dari HEADER byte (tanpa mendekode piksel), bukan dipercaya dari klaim klien: gambar
  // raksasa berklaim kecil akan membuat peramban semua pengguna kehabisan memori saat menampilkannya. Header yang
  // tak terbaca (jarang; varian format tak umum) memakai klaim yang sudah tervalidasi di atas.
  let actual: { width: number; height: number } | null = null;
  if (isImageMime(mime) && bytes instanceof Uint8Array && matchesImageBytesSignature(mime, bytes)) {
    actual = readImageDimensions(mime, bytes);
    if (actual !== null && (!isDimension(actual.width) || !isDimension(actual.height))) {
      reader.fail('bytes', `Dimensi gambar maksimal ${MAX_IMAGE_DIMENSION} px per sisi`);
    }
  }
  reader.done();
  return {
    mime: mime as string,
    bytes: bytes as Uint8Array,
    width: actual?.width ?? (width as number),
    height: actual?.height ?? (height as number),
  };
}

export function validateGetFile(raw: unknown): GetFileInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}
