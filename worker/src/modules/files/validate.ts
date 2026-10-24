import {
  base64ByteLength,
  isBase64Text,
  isImageMime,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  matchesImageSignature,
} from '@shared/files';
import type { GetFileInput, UploadFileInput } from '@shared/rpc';
import { readObject } from '@worker/core/validate';

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
  const base64 = reader.raw('base64');
  const width = reader.raw('width');
  const height = reader.raw('height');
  if (!isImageMime(mime)) reader.fail('mime', 'Hanya JPEG, PNG, atau WebP');
  if (typeof base64 !== 'string' || !isBase64Text(base64)) {
    reader.fail('base64', 'Isi gambar tidak valid');
  } else if (base64ByteLength(base64) > MAX_IMAGE_BYTES) {
    reader.fail('base64', 'Ukuran gambar maksimal 1 MB');
  } else if (isImageMime(mime) && !matchesImageSignature(mime, base64)) {
    reader.fail('base64', 'Isi berkas tidak sesuai jenis gambar');
  }
  if (!isDimension(width)) reader.fail('width', 'Lebar tidak valid');
  if (!isDimension(height)) reader.fail('height', 'Tinggi tidak valid');
  reader.done();
  return {
    mime: mime as string,
    base64: base64 as string,
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
