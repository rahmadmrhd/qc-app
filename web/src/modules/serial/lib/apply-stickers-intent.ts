import type { ApplyStickersBatchInput } from '@shared/contract';
import { ApiError } from '@/lib/api/api-error';

/**
 * Niat kirim Tempel stiker massal yang hasilnya BELUM JELAS (koneksi putus, server tak menjawab, 5xx): tulis server bisa
 * saja sudah berhasil di-commit tetapi jawabannya hilang. Kiriman berikutnya WAJIB memakai `clientId` dan isi yang persis
 * sama (kunci idempoten server: kiriman ulang yang sudah tersimpan tidak memotong stok dua kali, isi berbeda dengan id
 * yang sama = `CONFLICT`). Dipegang halaman daftar (di luar umur dialog) agar menutup lalu membuka dialog tidak membuat
 * id baru.
 */
export interface PendingApplyStickers {
  clientId: string;
  input: ApplyStickersBatchInput;
}

/** Penolakan yang PASTI (server menolak sebelum menulis apa pun): id baru aman dipakai untuk niat kirim berikutnya. */
const DEFINITE_REJECTIONS = new Set(['VALIDATION', 'CONFLICT', 'FORBIDDEN', 'NOT_FOUND']);

export function isDefiniteRejection(error: unknown): boolean {
  return error instanceof ApiError && DEFINITE_REJECTIONS.has(error.code);
}

export function newPendingApplyStickers(
  input: Omit<ApplyStickersBatchInput, 'clientId'>,
): PendingApplyStickers {
  const clientId = crypto.randomUUID();
  return { clientId, input: { ...input, clientId } };
}
