import { readObject } from '@server/core/validate';
import { validateUploadFile } from '@server/modules/files/validate';
import type {
  GetSerialProofInput,
  RemoveSerialProofInput,
  RetrySerialProofInput,
  UploadSerialProofInput,
} from '@shared/contract';

/** Unggahan foto bukti: aturan yang sama dengan `files.upload` (JPEG/PNG/WebP, tanda tangan byte, <= 10 MB, lebar/tinggi). */
export function validateUploadSerialProof(raw: unknown): UploadSerialProofInput {
  return validateUploadFile(raw);
}

export function validateGetSerialProof(raw: unknown): GetSerialProofInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

export function validateRemoveSerialProof(raw: unknown): RemoveSerialProofInput {
  return validateGetSerialProof(raw);
}

export function validateRetrySerialProof(raw: unknown): RetrySerialProofInput {
  return validateGetSerialProof(raw);
}
