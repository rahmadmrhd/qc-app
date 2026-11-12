import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadMeForBoot, readAuthError, resolveInitialSession } from '@/app/boot';
import { queryClient, setUnauthenticatedHandler } from '@/app/query-client';
import { restoreQueryCache, startQueryPersistence } from '@/app/query-persist';
import { createAppRouter } from '@/app/router';
import { startUiUpdateWatch } from '@/app/ui-update-store';
import { meQueryKey } from '@/modules/auth/queries';
import { clearSession, initSession } from '@/modules/auth/session';
import { ThemeProvider } from '@/modules/theme/theme-provider';
import './styles.css';

async function start() {
  // Desktop: tampung pengumuman "UI baru siap" sejak awal (tak berbuat apa pun di peramban).
  startUiUpdateWatch();

  // Galat login dari redirect server (/?authError=...) dibaca sekali lalu dibuang dari URL.
  const authError = readAuthError(window.location.search);
  if (authError) window.history.replaceState(null, '', window.location.pathname);

  // Sesi cookie diverifikasi server (GET /api/v1/me) SEBELUM router dibuat; hasilnya sekaligus data `auth.me`.
  // Di desktop `loadMeState()` berjalan sama saja (proses utama menambahkan Bearer lewat app://qc/api).
  const { me, unreachable } = await loadMeForBoot();
  initSession(resolveInitialSession(me, authError, unreachable));
  if (me) {
    // Cache tersimpan dipasang hanya untuk pemilik yang sesinya sudah terbukti sah (stale-while-revalidate).
    restoreQueryCache(queryClient, me.email);
    queryClient.setQueryData(meQueryKey, me);
  }
  startQueryPersistence(queryClient);

  const router = createAppRouter(queryClient);
  setUnauthenticatedHandler(() => {
    clearSession();
    queryClient.clear();
    void router.navigate({ to: '/login' });
  });

  const root = document.getElementById('app');
  if (!root) throw new Error('Elemen #app tidak ditemukan');
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}

void start();
