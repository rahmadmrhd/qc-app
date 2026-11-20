import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import '../route-meta';
import { AppBreadcrumb } from './app-breadcrumb';

function setViewport(width: number) {
  window.innerWidth = width;
  window.matchMedia = ((query: string) => ({
    matches: width < 768,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(() => setViewport(1280));
afterEach(() => setViewport(1280));

async function renderAt(path: string, queryClient: QueryClient) {
  const root = createRootRoute({
    component: () => (
      <>
        <AppBreadcrumb />
        <Outlet />
      </>
    ),
  });
  const list = createRoute({
    getParentRoute: () => root,
    path: '/item',
    component: () => <p>daftar</p>,
  });
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/item/$itemId',
    staticData: {
      crumb: ({ params, queryClient: qc }) => {
        const item = qc.getQueryData<{ name: string }>(['items', 'detail', params.itemId]);
        return { label: item?.name ?? 'Detail' };
      },
    },
    component: () => <p>detail</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([list, detail]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole('navigation', { name: 'breadcrumb' });
}

test('tautan butir menu, induk tanpa tautan, tingkat terakhir tanpa tautan; label dari cache menyusul', async () => {
  const queryClient = new QueryClient();
  await renderAt('/item/1', queryClient);
  expect(screen.getByRole('link', { name: 'Daftar Item' })).toHaveAttribute('href', '/item');
  expect(screen.queryByRole('link', { name: 'Item' })).toBeNull();
  expect(screen.getByText('Item')).toBeInTheDocument();
  const last = screen.getByText('Detail');
  expect(last).toHaveAttribute('aria-current', 'page');
  expect(last.closest('a')).toBeNull();
  await act(async () => {
    queryClient.setQueryData(['items', 'detail', '1'], { name: 'Asus RT-AX55' });
  });
  expect(await screen.findByText('Asus RT-AX55')).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByText('Detail')).toBeNull();
});

test('ponsel: hanya tingkat terakhir dan tombol Kembali ke tingkat sebelumnya yang bertautan', async () => {
  setViewport(500);
  await renderAt('/item/1', new QueryClient());
  expect(screen.getByRole('link', { name: 'Kembali ke Daftar Item' })).toHaveAttribute(
    'href',
    '/item',
  );
  expect(screen.getByText('Detail')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Daftar Item' })).toBeNull();
});

test('ponsel 360 px: label panjang dipotong (truncate), tanpa pembungkusan baris, dan bisa menyusut', async () => {
  setViewport(360);
  const queryClient = new QueryClient();
  queryClient.setQueryData(['items', 'detail', '1'], {
    name: 'Nama item yang sangat panjang sekali sampai tidak muat di header ponsel 360 px',
  });
  await renderAt('/item/1', queryClient);
  const label = await screen.findByText(/Nama item yang sangat panjang/);
  expect(label.className).toContain('truncate');
  expect(label.closest('li')?.className).toContain('min-w-0');
  const list = label.closest('ol');
  expect(list?.className).toContain('flex-nowrap');
  expect(list?.className).toContain('min-w-0');
  expect(screen.getByRole('navigation', { name: 'breadcrumb' }).className).toContain('min-w-0');
});
