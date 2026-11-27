import type { QcBridge } from '@countrylock/bridge-contract';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { clearBoardStoreWithin } from '@/app/board-persist';
import { runBusy } from '@/app/pwa/busy';
import { announceLogout } from '@/app/session-broadcast';
import { CSRF_HEADERS } from '@/lib/api/client';
import { getBridge } from '@/lib/platform';
import { clearAllOutboxesWithin, suspendOutboxWrites } from '@/modules/handover/lib/outbox';
import { clearSending } from '@/modules/handover/lib/outbox-status';
import { clearLastActive } from '@/modules/location/last-active';
import { clearAllDrafts } from '@/modules/serial/lib/draft-store';
import { clearAllWarehouseDrafts } from '@/modules/serialwh/lib/draft-store';
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

/** Desktop: proses utama membuang token Bearer; galat IPC diabaikan (sesi lokal tetap dibuang). */
export async function logoutDesktop(bridge: QcBridge): Promise<void> {
  try {
    await bridge.auth.logout();
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
      // Desktop: proses utama membuang token Bearer; peramban: POST /auth/logout (cookie).
      const bridge = getBridge();
      if (bridge) await logoutDesktop(bridge);
      else if (!import.meta.env.DEV) await postLogout();
      clearSession();
      clearLastActive(owner);
      // Draf tabel sementara Serial Number (localStorage) dibuang saat keluar; sesi yang kedaluwarsa tidak membuangnya.
      clearAllDrafts();
      clearAllWarehouseDrafts();
      // Antrean tulis di perangkat (IndexedDB + kunci lama) dan papan/detail task (Fase 3 Tahap B) dibuang saat keluar
      // eksplisit; sesi kedaluwarsa tidak membuangnya. Keduanya berjalan PARALEL, masing-masing dibatasi waktunya
      // (IndexedDB macet = maksimal satu anggaran 1,5 dtk, bukan dua berurutan). Penulisan antrean sudah ditahan di
      // atas dan tulis papan tertunda dibatalkan di dalam `clearBoardStoreWithin`. Kegagalan tak menghalangi keluar.
      await Promise.all([
        clearAllOutboxesWithin(),
        clearBoardStoreWithin().catch(() => {
          // Dibiarkan: sesi lokal tetap dibuang.
        }),
      ]);
      // Penanda "mengirim" (memori) ikut dibuang: permintaan lama yang masih terbang tak boleh menempel ke sesi berikutnya.
      clearSending();
      queryClient.clear();
      await router.navigate({ to: '/login' });
    });
  };
}
