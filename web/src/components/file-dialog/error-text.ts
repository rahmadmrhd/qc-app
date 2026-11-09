import { ApiError, describeError } from '@/lib/api';

/** Teks galat untuk pengguna: galat server lewat `describeError`, galat lokal (mis. pengecilan gambar) apa adanya. */
export function errorText(error: unknown, fallback = 'Terjadi kesalahan'): string {
  if (error instanceof ApiError) return describeError(error);
  if (error instanceof Error && error.message !== '') return error.message;
  return fallback;
}
