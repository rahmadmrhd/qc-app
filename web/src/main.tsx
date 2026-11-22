import { registerSW } from 'virtual:pwa-register';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { restoreBoardCache, startBoardPersistence } from '@/app/board-persist';
import { loadMeForBoot, readAuthError, resolveInitialSession } from '@/app/boot';
import { startOutboxSync } from '@/app/outbox-sync';
import { insertParentChain } from '@/app/parent-chain';
import { startInstallCapture } from '@/app/pwa/install';
import { setMutationSource } from '@/app/pwa/safe-reload';
import { attachNavigationTrigger, startPwaUpdates } from '@/app/pwa/update';
import { PwaUpdateBanner } from '@/app/pwa/update-banner';
import { queryClient, setUnauthenticatedHandler } from '@/app/query-client';
import { restoreQueryCache, startQueryPersistence } from '@/app/query-persist';
import { createAppRouter } from '@/app/router';
import { startServerStatus } from '@/app/server-status';
import { handleRemoteLogout, startSessionListener } from '@/app/session-broadcast';
import { OfflineScreen } from '@/app/shell/offline-screen';
import { startUiUpdateWatch } from '@/app/ui-update-store';
import { startApiVersions } from '@/lib/api/versions';
import { isDesktop, shouldRegisterServiceWorker } from '@/lib/platform';
import { meQueryKey } from '@/modules/auth/queries';
import { clearSession, initSession } from '@/modules/auth/session';
import { hydrateOutbox } from '@/modules/handover/lib/outbox';
import { ThemeProvider } from '@/modules/theme/theme-provider';
import './styles.css';

/**
 * Service worker hanya ada pada build produksi (FR-P11); dev tidak mendaftarkannya. Versi baru dipakai otomatis
 * bila aman, pada perpindahan halaman atau saat tab kembali terlihat (keputusan pemilik 2026-11-13).
 * `router` kosong pada jalur boot offline (tanpa router, tanpa pemicu navigasi).
 */
function startServiceWorker(router?: Parameters<typeof attachNavigationTrigger>[0]) {
  // Desktop memuat UI dari app://qc (bundel terkemas atau unduhan bertanda tangan); service worker tidak dipakai
  // di sana (pembaruan UI lewat pengelola bundel desktop).
  if (!import.meta.env.PROD || !shouldRegisterServiceWorker()) return;
  startPwaUpdates({ register: registerSW });
  if (router) attachNavigationTrigger(router);
}

async function start() {
  // Desktop: tampung pengumuman "UI baru siap" sejak awal (tak berbuat apa pun di peramban).
  startUiUpdateWatch();
  // beforeinstallprompt dapat tiba sebelum React dirender; tangkap sejak awal (FR-P5).
  startInstallCapture();

  // Galat login dari redirect server (/?authError=...) dibaca sekali lalu dibuang dari URL.
  const authError = readAuthError(window.location.search);
  if (authError) window.history.replaceState(null, '', window.location.pathname);

  // Sesi cookie diverifikasi server (GET /api/v1/me) SEBELUM router dibuat; hasilnya sekaligus data `auth.me`.
  // Di desktop proses utama menambahkan Bearer lewat app://qc/api, dan boot punya batas waktu (`loadMeForBoot`).
  // Peta versi API per kelompok (`/api/ping`): dimuat dari salinan tersimpan lalu disegarkan di latar, tanpa menunggu
  // jaringan, supaya jalur boot normal dan offline sama-sama sudah punya peta (belum ada = semua v1).
  startApiVersions();
  const { me, unreachable } = await loadMeForBoot();
  const root = document.getElementById('app');
  if (!root) throw new Error('Elemen #app tidak ditemukan');
  // Server tidak terjangkau saat boot (peramban): layar "Tidak ada koneksi" saja (tanpa router/query client). Service
  // worker tetap didaftarkan agar cangkang aplikasi dan pembaruan versi jalan; sesi tidak disentuh (FR-P7).
  // Desktop sengaja TIDAK memakai layar ini: halaman login memuat pengaturan alamat server, satu-satunya jalan keluar
  // bila alamat server salah atau server mati (layar offline hanya punya "Coba lagi").
  if (unreachable && !isDesktop()) {
    // Hitungan antrean di layar ini dibaca dari salinan memori: muat dulu (dibatasi 1,5 dtk; gagal = hitungan 0).
    await hydrateOutbox();
    createRoot(root).render(
      <StrictMode>
        <ThemeProvider>
          <OfflineScreen onRetry={() => window.location.reload()} />
        </ThemeProvider>
      </StrictMode>,
    );
    startServiceWorker();
    return;
  }
  initSession(resolveInitialSession(me, authError, unreachable));
  if (me) {
    // Cache tersimpan dipasang hanya untuk pemilik yang sesinya sudah terbukti sah (stale-while-revalidate).
    restoreQueryCache(queryClient, me.email);
    queryClient.setQueryData(meQueryKey, me);
    // Papan dan detail task Serah Terima dari IndexedDB (Fase 3 Tahap B) dan antrean tulis offline (Tahap C), masing-masing
    // dibatasi 1,5 dtk dan dimuat bersamaan (batas waktunya tidak berurutan); tanpa data = boot normal.
    await Promise.all([restoreBoardCache(queryClient, me.email), hydrateOutbox()]);
  }
  startQueryPersistence(queryClient);
  const boardPersistence = startBoardPersistence(queryClient);
  // Spanduk "data terakhir" saat server tidak tersedia (FR-P16).
  startServerStatus(queryClient);
  // Antrean centang di perangkat dikirim ulang di foreground saat server pulih (FR-P17); hanya untuk sesi sah.
  if (me) {
    startOutboxSync(queryClient);
    // Tab lain akun ini keluar: berhenti menulis antrean dan papan ke perangkat (sesi tab ini mati lewat jalur 401).
    startSessionListener((owner) =>
      handleRemoteLogout(owner, {
        currentOwner: me.email,
        stopBoardPersistence: () => boardPersistence.stop(),
      }),
    );
  }

  // Tautan dalam di ponsel: sisipkan rantai induk SEBELUM router dibuat (router membaca riwayat saat dibuat).
  insertParentChain(window, undefined, me !== null);
  const router = createAppRouter(queryClient);
  setUnauthenticatedHandler(() => {
    clearSession();
    queryClient.clear();
    void router.navigate({ to: '/login' });
  });

  // Mutasi react-query yang berjalan membuat tidak aman memuat ulang (muat ulang otomatis hanya bila aman).
  setMutationSource({
    isMutating: () => queryClient.isMutating(),
    subscribe: (callback) => queryClient.getMutationCache().subscribe(callback),
  });
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <PwaUpdateBanner />
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  );
  startServiceWorker(router);
}

void start();
