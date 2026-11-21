import type { QueryClient } from '@tanstack/react-query';
import { createBrowserHistory, createRouter } from '@tanstack/react-router';
import { PageLoading } from '@/components/page-loading';
import { deferNavigateUnderOverlays } from '@/lib/overlay-navigate';
import { recordLocation } from '@/lib/stack-nav';
import { routeTree } from '@/routeTree.gen';

export function createAppRouter(queryClient: QueryClient) {
  const router = createRouter({
    routeTree,
    history: createBrowserHistory(),
    context: { queryClient },
    // Tanpa prefetch saat hover: data dimuat saat navigasi saja (tiap prefetch = satu permintaan tambahan).
    defaultPreload: false,
    // Pindah halaman hanya menunggu DATA: tampilkan "memuat" segera (setelah 100 ms agar data yang sudah di-cache
    // tidak berkedip) dan pertahankan 300 ms agar tidak berkedip-kedip.
    defaultPendingComponent: PageLoading,
    defaultPendingMs: 100,
    defaultPendingMinMs: 300,
    scrollRestoration: true,
  });
  // Jejak lokasi per entri riwayat: dasar `popTo` (kembali ke asal bila entri sebelumnya memang tujuannya).
  router.subscribe('onResolved', ({ toLocation }) => recordLocation(toLocation.pathname));
  deferNavigateUnderOverlays(router);
  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
