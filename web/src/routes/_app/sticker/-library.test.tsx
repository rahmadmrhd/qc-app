import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { FileLibrarySource } from '@/components/file-dialog';
import { GuideLibraryRoute, librarySearchSchema, Route } from './library';

const fake = vi.hoisted(() => ({ source: null as unknown as FileLibrarySource }));
vi.mock('@/modules/sticker/lib/guide-source', () => ({
  get stickerGuideSource() {
    return fake.source;
  },
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => null }));
vi.mock('@/modules/auth/permissions', async () => ({
  ...(await vi.importActual<object>('@/modules/auth/permissions')),
  can: () => false,
}));

const parse = (search: Record<string, unknown>) => librarySearchSchema.parse(search);

test('q angka (diketik tangan) diterima sebagai teks dan q panjang dipotong', () => {
  expect(parse({ q: 123 }).q).toBe('123');
  expect(parse({ q: 'a'.repeat(500) }).q).toHaveLength(120);
  expect(parse({ q: { x: 1 } }).q).toBeUndefined();
});

test('mengetik di tengah teks tidak memindahkan kursor ke ujung (teks lokal + debounce ke URL)', async () => {
  fake.source = {
    key: 'fake-guides',
    mimeTypes: ['image/png'],
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    upload: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  };
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: '/_app/sticker/library',
    validateSearch: Route.options.validateSearch,
    component: GuideLibraryRoute,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/_app/sticker/library?q=%22kardus%22'] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  const box = (await screen.findByRole('searchbox', { name: 'Cari gambar' })) as HTMLInputElement;
  expect(box.value).toBe('kardus');
  box.setSelectionRange(3, 3);
  await userEvent.type(box, 'X', { initialSelectionStart: 3, initialSelectionEnd: 3 });
  expect(box.value).toBe('karXdus');
  expect(box.selectionStart).toBe(4);
  await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'karXdus' }), {
    timeout: 3000,
  });
  expect(box.value).toBe('karXdus');
});
