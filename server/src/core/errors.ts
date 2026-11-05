import type { ErrorCode } from '@shared/rpc';

export interface AppError extends Error {
  code: ErrorCode;
  fields?: Record<string, string>;
  /** Galat basi (penulis memakai versi usang): dengan `If-Match` pada rute berETag, kernel REST menjawab 412. */
  stale?: true;
  /** Status HTTP eksplisit (kernel REST: 400/413 untuk badan rusak); tanpa nilai = dari kode. */
  status?: number;
}

export function appError(
  code: ErrorCode,
  message: string,
  fields?: Record<string, string>,
): AppError {
  const error = new Error(message) as AppError;
  error.name = 'AppError';
  error.code = code;
  if (fields) error.fields = fields;
  return error;
}

/** `CONFLICT` karena versi usang (CAS/`expectedUpdatedAt` gagal); beda dengan konflik lain (nama kembar, dipakai). */
export function staleError(message: string): AppError {
  const error = appError('CONFLICT', message);
  error.stale = true;
  return error;
}

export function isAppError(value: unknown): value is AppError {
  return (
    value instanceof Error &&
    value.name === 'AppError' &&
    typeof (value as Partial<AppError>).code === 'string'
  );
}
