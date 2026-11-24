import type { ApplyStickersBatchInput } from '@shared/contract';
import { useCallback, useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api/api-error';
import { newUuid } from '@/lib/uuid';

/**
 * Niat kirim Tempel stiker massal yang hasilnya BELUM JELAS (koneksi putus, server tak menjawab, 5xx): tulis server bisa
 * saja sudah berhasil di-commit tetapi jawabannya hilang. Kiriman berikutnya WAJIB memakai `clientId` dan isi yang persis
 * sama (kunci idempoten server: kiriman ulang yang sudah tersimpan tidak memotong stok dua kali, isi berbeda dengan id
 * yang sama = `CONFLICT`). Disimpan di store tingkat modul (di luar umur dialog DAN halaman daftar) agar menutup dialog
 * atau berpindah halaman lalu kembali tidak membuat id baru.
 */
export interface PendingApplyStickers {
  clientId: string;
  input: ApplyStickersBatchInput;
  /** Cuplikan nomor serial kiriman itu (maks. `SAMPLE_MAX`), untuk keterangan "kiriman sebelumnya". */
  sample: string[];
}

const SAMPLE_MAX = 3;

/** Penolakan yang PASTI (server menolak sebelum menulis apa pun): id baru aman dipakai untuk niat kirim berikutnya. */
const DEFINITE_REJECTIONS = new Set(['VALIDATION', 'CONFLICT', 'FORBIDDEN', 'NOT_FOUND']);

export function isDefiniteRejection(error: unknown): boolean {
  return error instanceof ApiError && DEFINITE_REJECTIONS.has(error.code);
}

export function newPendingApplyStickers(
  input: Omit<ApplyStickersBatchInput, 'clientId'>,
  serialNumbers: readonly string[] = [],
): PendingApplyStickers {
  const clientId = newUuid();
  return { clientId, input: { ...input, clientId }, sample: serialNumbers.slice(0, SAMPLE_MAX) };
}

/** "ABC, DEF, GHI dan 4 lainnya" untuk keterangan kiriman yang tertunda. */
export function pendingSummary(pending: PendingApplyStickers): string {
  const total = pending.input.rows.length;
  const more = total - pending.sample.length;
  const shown = pending.sample.join(', ');
  if (shown === '') return `${total} Serial Number`;
  return more > 0
    ? `${total} Serial Number: ${shown} dan ${more} lainnya`
    : `${total} Serial Number: ${shown}`;
}

// Store tingkat modul, dikunci per email pengguna (akun lain tak melihat niat akun ini). Tidak ke localStorage: cukup
// bertahan selama aplikasi terbuka. Sengaja tidak dihapus saat keluar (use-logout milik modul auth): kunci email menjaga
// akun lain, dan akun yang sama yang masuk lagi memang masih punya kiriman yang belum jelas.
const store = new Map<string, PendingApplyStickers>();
const listeners = new Set<() => void>();

const keyOf = (email: string) => email.trim().toLowerCase();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Niat tertunda milik `email` dan penyetelnya (null = hapus). Dipakai halaman daftar Serial. */
export function usePendingApplyStickers(email: string) {
  const key = keyOf(email);
  const pending = useSyncExternalStore(
    subscribe,
    () => store.get(key) ?? null,
    () => null,
  );
  const setPending = useCallback(
    (next: PendingApplyStickers | null) => {
      if (next) store.set(key, next);
      else store.delete(key);
      for (const listener of listeners) listener();
    },
    [key],
  );
  return [pending, setPending] as const;
}

/** Hanya untuk tes: mengosongkan store antar-tes. */
export function resetPendingApplyStickersForTest() {
  store.clear();
  for (const listener of listeners) listener();
}
