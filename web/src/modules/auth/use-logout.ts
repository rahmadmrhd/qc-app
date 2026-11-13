import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { runBusy } from '@/app/pwa/busy';
import { CSRF_HEADERS } from '@/lib/api/client';
import { clearAllOutboxes, suspendOutboxWrites } from '@/modules/handover/lib/check-outbox';
import { clearSending } from '@/modules/handover/lib/outbox-status';
import { clearAllDrafts } from '@/modules/serial/lib/draft-store';
import { clearSession } from './session';

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
      if (!import.meta.env.DEV) await postLogout();
      clearSession();
      // Draf tabel sementara Serial Number (localStorage) dibuang saat keluar; sesi yang kedaluwarsa tidak membuangnya.
      clearAllDrafts();
      // Antrean centang di perangkat (Fase 2, FR-P14/P19) dibuang saat keluar eksplisit; sesi kedaluwarsa tidak membuangnya.
      clearAllOutboxes();
      // Penanda "mengirim" (memori) ikut dibuang: permintaan lama yang masih terbang tak boleh menempel ke sesi berikutnya.
      clearSending();
      queryClient.clear();
      await router.navigate({ to: '/login' });
    });
  };
}
