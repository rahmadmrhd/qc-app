import { registerSW } from 'virtual:pwa-register';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadMe, readAuthError, resolveInitialSession } from '@/app/boot';
import { startPwaUpdates } from '@/app/pwa/update';
import { PwaUpdateBanner } from '@/app/pwa/update-banner';
import { queryClient, setUnauthenticatedHandler } from '@/app/query-client';
import { restoreQueryCache, startQueryPersistence } from '@/app/query-persist';
import { createAppRouter } from '@/app/router';
import { meQueryKey } from '@/modules/auth/queries';
import { clearSession, initSession } from '@/modules/auth/session';
import { ThemeProvider } from '@/modules/theme/theme-provider';
import './styles.css';

async function start() {
  // Galat login dari redirect server (/?authError=...) dibaca sekali lalu dibuang dari URL.
  const authError = readAuthError(window.location.search);
  if (authError) window.history.replaceState(null, '', window.location.pathname);

  // Sesi cookie diverifikasi server (GET /api/v1/me) SEBELUM router dibuat; hasilnya sekaligus data `auth.me`.
  const me = await loadMe();
  initSession(resolveInitialSession(me, authError));
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
          <PwaUpdateBanner />
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  );
  // Service worker hanya ada pada build produksi (FR-P11); dev tidak mendaftarkannya.
  if (import.meta.env.PROD) startPwaUpdates({ register: registerSW });
}

void start();
