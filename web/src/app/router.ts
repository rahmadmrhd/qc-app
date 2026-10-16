import type { QueryClient } from '@tanstack/react-query';
import { createHashHistory, createRouter } from '@tanstack/react-router';
import { PageLoading } from '@/components/page-loading';
import { routeTree } from '@/routeTree.gen';

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    history: createHashHistory(),
    context: { queryClient },
    // Tiap prefetch = satu RPC google.script.run yang antre di klien dan membuat klik nyata menunggu (HAR: 14,7 dari
    // 17,2 detik 'blocked'). Data dimuat saat navigasi saja.
    defaultPreload: false,
    // UI sudah termuat utuh (satu berkas), jadi pindah halaman hanya menunggu DATA: tampilkan "memuat" segera
    // (setelah 100 ms agar data yang sudah di-cache tidak berkedip) dan pertahankan 300 ms agar tidak berkedip-kedip.
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
