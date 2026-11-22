import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render } from '@testing-library/react';
import { type ComponentType, Suspense } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { meQueryKey } from '@/modules/auth/queries';

interface MountableRoute {
  options: { component?: unknown; validateSearch?: unknown };
}

/**
 * Memasang SATU halaman rute (komponen aslinya) di bawah router memori untuk tes halaman: `routePath` = path tempat
 * komponen dipasang, `entry` = lokasi awal, `me` dan `seeds` mengisi cache query (mis. `auth.me`), dan `others` =
 * rute tujuan navigasi (mis. daftar induk) yang cukup menampilkan teks. Komponen di-`preload` agar kode terpisah
 * (`autoCodeSplitting`) sudah termuat sebelum render.
 */
export async function mountRoute({
  route,
  routePath,
  entry,
  me,
  seeds = [],
  others = [],
}: {
  route: MountableRoute;
  routePath: string;
  entry: string;
  me?: MeDto;
  seeds?: readonly [QueryKey, unknown][];
  others?: readonly { path: string; label: string }[];
}) {
  const Component = route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (me) client.setQueryData(meQueryKey, me);
  for (const [key, value] of seeds) client.setQueryData(key, value);
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: routePath,
    ...(route.options.validateSearch
      ? {
          validateSearch: route.options.validateSearch as (
            search: Record<string, unknown>,
          ) => unknown,
        }
      : {}),
    component: Component as never,
  });
  const extra = others.map((other) =>
    createRoute({
      getParentRoute: () => root,
      path: other.path,
      component: () => <p>{other.label}</p>,
    }),
  );
  const router = createRouter({
    routeTree: root.addChildren([page, ...extra]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <Suspense fallback={<p>memuat</p>}>
            <RouterProvider router={router as never} />
          </Suspense>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });
  return { router, client };
}
