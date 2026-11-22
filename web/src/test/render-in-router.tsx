import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Merender komponen yang memakai `Link`/tooltip/query di bawah router memori (tanpa pohon rute asli): tautan ke
 * rute yang tak terdaftar tetap menghasilkan `href` dari `to` + `params`. Mengembalikan router agar tes dapat membaca
 * lokasi setelah klik/navigasi.
 */
export async function renderInRouter(
  element: ReactNode,
  { path = '/', client }: { path?: string; client?: QueryClient } = {},
) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{element}</TooltipProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(<RouterProvider router={router} />);
  });
  return { router, queryClient, ...(result as ReturnType<typeof render>) };
}
