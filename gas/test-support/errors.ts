import type { AppError } from '@gas/core/errors';
import { isAppError_ } from '@gas/core/errors';

export function captureAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (isAppError_(error)) return error;
    throw error;
  }
  throw new Error('Fungsi tidak melempar AppError');
}
