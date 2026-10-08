import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { readBoot, resolveInitialSession } from '@/app/boot';
import { restoreHashFromTop, syncTopUrl } from '@/app/gas-location';
import { queryClient, setUnauthenticatedHandler } from '@/app/query-client';
import { createAppRouter } from '@/app/router';
import { readLoginNonce } from '@/modules/auth/nonce';
import { clearToken, initSession, readStoredToken } from '@/modules/auth/session';
import { ThemeProvider } from '@/modules/theme/theme-provider';
import './styles.css';

async function start() {
  initSession(resolveInitialSession(readBoot(), readStoredToken(), readLoginNonce()));
  await restoreHashFromTop();

  const router = createAppRouter(queryClient);
  setUnauthenticatedHandler(() => {
    clearToken();
    queryClient.clear();
    void router.navigate({ to: '/login' });
  });
  router.subscribe('onResolved', () => syncTopUrl(window.location.hash));
  syncTopUrl(window.location.hash);

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
