import type { PostelAttachmentDto } from '@shared/contract';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';

/**
 * Unggah satu lampiran Postel (gambar atau PDF) apa adanya: TANPA pengecilan (desain stiker perlu resolusi asli); jenis,
 * ukuran, dan isi divalidasi server berdasarkan tanda tangan byte.
 */
export async function uploadPostelFile(file: File): Promise<PostelAttachmentDto> {
  return api('postelFiles.upload', {
    mime: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
}

/** Pesan galat unggah: pesan field `bytes`/`mime` dari server ditampilkan apa adanya (mis. batas sisi gambar). */
export function postelUploadError(error: unknown): string {
  if (error instanceof ApiError)
    return error.fields?.bytes ?? error.fields?.mime ?? describeError(error);
  if (error instanceof Error) return error.message;
  return 'Gagal mengunggah lampiran';
}
