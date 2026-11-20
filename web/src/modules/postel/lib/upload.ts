import type { PostelAttachmentDto } from '@shared/contract';
import { runBusy } from '@/app/pwa/busy';
import { fileMime } from '@/components/file-dialog/accept';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';

/** Jenis berkas (UX saja; server memvalidasi tanda tangan byte). Sama dengan `fileMime` dialog berkas. */
export const postelFileMime = fileMime;

/**
 * Unggah satu lampiran Postel (gambar atau PDF) apa adanya: TANPA pengecilan (desain stiker perlu resolusi asli); jenis,
 * ukuran, dan isi divalidasi server berdasarkan tanda tangan byte.
 */
export function uploadPostelFile(file: File): Promise<PostelAttachmentDto> {
  // Membaca berkas + mengirim = satu penulisan berjalan (muat ulang otomatis PWA tak boleh memotongnya).
  return runBusy(async () =>
    api('postelFiles.upload', {
      mime: postelFileMime(file),
      bytes: new Uint8Array(await file.arrayBuffer()),
    }),
  );
}

/** Pesan galat unggah: pesan field `bytes`/`mime` dari server ditampilkan apa adanya (mis. dimensi gambar tidak terbaca). */
export function postelUploadError(error: unknown): string {
  if (error instanceof ApiError)
    return error.fields?.bytes ?? error.fields?.mime ?? describeError(error);
  if (error instanceof Error) return error.message;
  return 'Gagal mengunggah lampiran';
}
