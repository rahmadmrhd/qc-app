import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { ErrorView } from '@/app/shell/error-view';
import { StatusMessage } from '@/app/shell/status-message';
import { Toaster } from '@/components/ui/sonner';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <Outlet />
      <Toaster richColors position="top-right" />
    </>
  ),
  errorComponent: ErrorView,
  notFoundComponent: () => (
    <StatusMessage
      code="404"
      title="Halaman tidak ditemukan"
      description="Alamat yang Anda buka tidak tersedia."
    />
  ),
});
