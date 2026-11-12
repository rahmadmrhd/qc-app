import type { PostelAttachmentDto } from '@shared/contract';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';

const MIME_BY_EXTENSION = new Map<string, string>([
  ['pdf', 'application/pdf'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]);

/**
 * Jenis berkas: `file.type`; bila kosong (sebagian peramban/OS tak mengisinya) diturunkan dari ekstensi. Hanya untuk UX:
 * server tetap memvalidasi jenis dan isi berdasarkan tanda tangan byte.
 */
export function postelFileMime(file: File): string {
  if (file.type !== '') return file.type;
  // Ekstensi harus didahului titik: nama "pdf" (tanpa titik) bukan ekstensi.
  const extension = /\.([^./\\]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION.get(extension) ?? '';
}

/**
 * Unggah satu lampiran Postel (gambar atau PDF) apa adanya: TANPA pengecilan (desain stiker perlu resolusi asli); jenis,
 * ukuran, dan isi divalidasi server berdasarkan tanda tangan byte.
 */
export async function uploadPostelFile(file: File): Promise<PostelAttachmentDto> {
  return api('postelFiles.upload', {
    mime: postelFileMime(file),
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
}

/** Pesan galat unggah: pesan field `bytes`/`mime` dari server ditampilkan apa adanya (mis. dimensi gambar tidak terbaca). */
export function postelUploadError(error: unknown): string {
  if (error instanceof ApiError)
    return error.fields?.bytes ?? error.fields?.mime ?? describeError(error);
  if (error instanceof Error) return error.message;
  return 'Gagal mengunggah lampiran';
}
