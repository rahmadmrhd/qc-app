import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';

/** Pesan galat unggah gambar yang ramah pengguna (galat server, galat kompresi, atau tak terduga). */
export function uploadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return describeError(error);
  if (error instanceof Error) return error.message;
  return 'Gagal mengunggah gambar';
}
