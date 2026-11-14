import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { clearBoardStoreWithin } from '@/app/board-persist';
import { runBusy } from '@/app/pwa/busy';
import { announceLogout } from '@/app/session-broadcast';
import { CSRF_HEADERS } from '@/lib/api/client';
import { clearAllOutboxesWithin, suspendOutboxWrites } from '@/modules/handover/lib/outbox';
import { clearSending } from '@/modules/handover/lib/outbox-status';
import { clearAllDrafts } from '@/modules/serial/lib/draft-store';
import { clearSession, getSession } from './session';

/** Menghapus cookie sesi di server (gagal jaringan diabaikan: sesi lokal tetap dibuang). */
export async function postLogout(fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: CSRF_HEADERS,
    });
  } catch {
    // Dibiarkan.
  }
}

export function useLogout(): () => void {
  const router = useRouter();
  const queryClient = useQueryClient();
  return () => {
    // POST /auth/logout + pembersihan sesi lokal = satu penulisan berjalan (muat ulang otomatis PWA tak boleh memotongnya).
    void runBusy(async () => {
      // Tahan penulisan antrean centang dari awal: permintaan yang masih terbang lalu gagal UNAVAILABLE tak boleh
      // menghidupkan antrean pemilik lama sesudah dibuang (dilanjutkan lagi oleh `startOutboxSync` sesi berikutnya).
      suspendOutboxWrites();
      // Tab lain akun yang sama berhenti menulis data perangkat (antrean, papan) sebelum toko dibersihkan di bawah.
      const owner = getSession().email;
      if (owner) announceLogout(owner);
      if (!import.meta.env.DEV) await postLogout();
      clearSession();
      // Draf tabel sementara Serial Number (localStorage) dibuang saat keluar; sesi yang kedaluwarsa tidak membuangnya.
      clearAllDrafts();
      // Antrean tulis di perangkat (IndexedDB + kunci lama) dibuang saat keluar eksplisit, dalam batas waktu; sesi
      // kedaluwarsa tidak membuangnya. Kegagalan pembersihan tak menghalangi keluar.
      await clearAllOutboxesWithin();
      // Penanda "mengirim" (memori) ikut dibuang: permintaan lama yang masih terbang tak boleh menempel ke sesi berikutnya.
      clearSending();
      // Papan dan detail task di IndexedDB (Fase 3 Tahap B) dibuang saat keluar eksplisit; sesi kedaluwarsa tidak membuangnya.
      // Tulis yang sedang berjalan atau tertunda dibatalkan di dalamnya; kegagalan pembersihan tak menghalangi keluar.
      try {
        await clearBoardStoreWithin();
      } catch {
        // Dibiarkan: sesi lokal tetap dibuang.
      }
      queryClient.clear();
      await router.navigate({ to: '/login' });
    });
  };
}
