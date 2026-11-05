import { readObject } from '@server/core/validate';
import {
  isImageMime,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  matchesImageBytesSignature,
} from '@shared/files';
import type { GetFileInput, UploadFileInput } from '@shared/rpc';

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
    reader.fail('bytes', 'Ukuran gambar maksimal 1 MB');
  } else if (isImageMime(mime) && !matchesImageBytesSignature(mime, bytes)) {
    reader.fail('bytes', 'Isi berkas tidak sesuai jenis gambar');
  }
  if (!isDimension(width)) reader.fail('width', 'Lebar tidak valid');
  if (!isDimension(height)) reader.fail('height', 'Tinggi tidak valid');
  reader.done();
  return {
    mime: mime as string,
    bytes: bytes as Uint8Array,
    width: width as number,
    height: height as number,
  };
}

export function validateGetFile(raw: unknown): GetFileInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}
