import { readObject_ } from '@gas/core/validate';
import {
  base64ByteLength,
  IMAGE_TARGET_BYTES,
  isBase64Text,
  isImageMime,
  MAX_IMAGE_DIMENSION,
  matchesImageSignature,
} from '@shared/files';
import type { GasUploadFileInput } from '@shared/gas-legacy';
import type { GetFileInput } from '@shared/rpc';

function isDimension_(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_IMAGE_DIMENSION
  );
}

export function validateUploadFile_(raw: unknown): GasUploadFileInput {
  const reader = readObject_(raw);
  const mime = reader.raw('mime');
  const base64 = reader.raw('base64');
  const width = reader.raw('width');
  const height = reader.raw('height');
  if (!isImageMime(mime)) reader.fail('mime', 'Hanya JPEG, PNG, atau WebP');
  if (typeof base64 !== 'string' || !isBase64Text(base64)) {
    reader.fail('base64', 'Isi gambar tidak valid');
  } else if (base64ByteLength(base64) > IMAGE_TARGET_BYTES) {
    reader.fail('base64', 'Ukuran gambar maksimal 1 MB');
  } else if (isImageMime(mime) && !matchesImageSignature(mime, base64)) {
    reader.fail('base64', 'Isi berkas tidak sesuai jenis gambar');
  }
  if (!isDimension_(width)) reader.fail('width', 'Lebar tidak valid');
  if (!isDimension_(height)) reader.fail('height', 'Tinggi tidak valid');
  reader.done();
  return {
    mime: mime as string,
    base64: base64 as string,
    width: width as number,
    height: height as number,
  };
}

export function validateGetFile_(raw: unknown): GetFileInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}
