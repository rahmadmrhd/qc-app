import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';

/** Pesan galat unggah: pesan field `bytes`/`mime` dari server ditampilkan apa adanya (mis. dimensi gambar tidak terbaca). */
export function postelUploadError(error: unknown): string {
  if (error instanceof ApiError)
    return error.fields?.bytes ?? error.fields?.mime ?? describeError(error);
  if (error instanceof Error) return error.message;
  return 'Gagal mengunggah lampiran';
}
