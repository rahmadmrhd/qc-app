import type { ErrorCode } from '@shared/rpc';

export interface AppError extends Error {
  code: ErrorCode;
  fields?: Record<string, string>;
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

export function isAppError(value: unknown): value is AppError {
  return (
    value instanceof Error &&
    value.name === 'AppError' &&
    typeof (value as Partial<AppError>).code === 'string'
  );
}
