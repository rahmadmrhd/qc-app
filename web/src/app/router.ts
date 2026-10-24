import type { QueryClient } from '@tanstack/react-query';
import { createBrowserHistory, createRouter } from '@tanstack/react-router';
import { PageLoading } from '@/components/page-loading';
import { routeTree } from '@/routeTree.gen';

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    history: createBrowserHistory(),
    context: { queryClient },
    // Tanpa prefetch saat hover: data dimuat saat navigasi saja (tiap prefetch = satu permintaan RPC tambahan).
    defaultPreload: false,
    // Pindah halaman hanya menunggu DATA: tampilkan "memuat" segera (setelah 100 ms agar data yang sudah di-cache
    // tidak berkedip) dan pertahankan 300 ms agar tidak berkedip-kedip.
    defaultPendingComponent: PageLoading,
    defaultPendingMs: 100,
    defaultPendingMinMs: 300,
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
