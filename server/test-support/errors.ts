import type { AppError } from '@server/core/errors';
import { isAppError } from '@server/core/errors';

export function captureAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error('Fungsi tidak melempar AppError');
}

/** Varian async: menunggu hasil `fn` dan mengembalikan AppError yang dilempar. */
export async function captureAppErrorAsync(fn: () => Promise<unknown>): Promise<AppError> {
  try {
    await fn();
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error('Fungsi tidak melempar AppError');
}
