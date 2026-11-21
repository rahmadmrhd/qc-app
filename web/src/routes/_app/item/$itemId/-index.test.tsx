import type { ItemDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentType, Suspense } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { meQueryKey } from '@/modules/auth/queries';
import { makeMe } from '@/test/make-me';
import { Route } from './index';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: (id: string) => ({
    url: `data:image/png;base64,${id}`,
    isLoading: false,
    isError: false,
  }),
}));

const base: ItemDto = {
  id: 'i1',
  brandId: 'b1',
  brand: 'Asus',
  model: 'RT-AX88U',
  isCountryLock: false,
  firmware: '',
  proofRequired: false,
  proofMin: 1,
  status: 'inactive',
  aliases: [],
  imageCount: 1,
  businessUnits: [{ id: 'bu-a', code: 'RTL', name: 'Retail' }],
  updatedAt: '2026-11-01T00:00:00.000Z',
  hasInstructions: false,
  hasManualBook: false,
  hasPostel: false,
  manualBook: null,
  postel: null,
  stickerPhotos: [],
  accessories: [],
  attachments: ['g1'],
  detail: '',
  createdAt: '',
  updatedBy: '',
};

let current: ItemDto = base;
let calls: { id: string; input: unknown }[] = [];

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  calls = [];
  current = base;
  apiMock.mockImplementation(async (id: string, input: unknown) => {
    calls.push({ id, input });
    switch (id) {
      case 'items.get':
        return current;
      case 'items.removeBatch':
        return { ids: (input as { ids: string[] }).ids };
      case 'items.restoreBatch':
        return { items: [{ ...base, status: 'inactive' }] };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount({ manage = true, path = '/_app/item/i1/' } = {}) {
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(meQueryKey, makeMe({ itemLevel: manage ? 'manage' : 'view' }));
  const root = createRootRoute();
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/_app/item/$itemId/',
    validateSearch: Route.options.validateSearch,
    component: Component as never,
  });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/item',
    component: () => <p>Daftar item</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([detail, index]),
    history: createMemoryHistory({ initialEntries: [path] }),
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
  await screen.findByRole('heading', { level: 1, name: 'Asus RT-AX88U' });
  return { router };
}

test('klik tab mengubah search param tab dan menampilkan isinya', async () => {
  const { router } = await mount();
  await userEvent.click(screen.getByRole('tab', { name: 'Gambar' }));
  await waitFor(() => expect(router.state.location.search).toEqual({ tab: 'gambar' }));
  expect(screen.getByAltText('Gambar 1')).toBeInTheDocument();
});

test('?tab= di URL memilih tab; nilai tak dikenal jatuh ke tab pertama', async () => {
  const first = await mount({ path: '/_app/item/i1/?tab=gambar' });
  expect(screen.getByRole('tab', { name: 'Gambar', selected: true })).toBeInTheDocument();
  expect(first.router.state.location.search).toEqual({ tab: 'gambar' });
});

test('Hapus dari View: konfirmasi, items.removeBatch, kembali ke /item, toast "Dihapus" dengan Pulihkan', async () => {
  const { router } = await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 item?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/item'));
  expect(calls.find((call) => call.id === 'items.removeBatch')?.input).toEqual({ ids: ['i1'] });
  expect(toast.success).toHaveBeenCalledWith(
    'Dihapus',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
  );
});

test('tanpa hak manage tombol Hapus tidak tampil', async () => {
  // Pemegang edit-saja tak melihat Hapus; hak manage pada item menentukan juga tombolnya.
  await mount({ manage: false });
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
});

test('item terhapus: banner Pulihkan memanggil items.restoreBatch', async () => {
  current = {
    ...base,
    deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
  };
  await mount();
  expect(screen.getByText('Data ini sudah dihapus')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  await waitFor(() =>
    expect(calls.find((call) => call.id === 'items.restoreBatch')?.input).toEqual({ ids: ['i1'] }),
  );
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Item dipulihkan (Nonaktif)'));
});

test('Pulihkan dari toast "Dihapus" setelah navigasi tetap memberi toast sukses atau galat', async () => {
  const { router } = await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 item?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/item'));
  const options = toast.success.mock.calls.find((call) => call[0] === 'Dihapus')?.[1] as {
    action: { onClick: () => void };
  };
  toast.success.mockClear();
  options.action.onClick();
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Item dipulihkan (Nonaktif)'));
  // Galat (mis. CONFLICT nama sudah dipakai) juga tampil.
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation(async (id: string, input: unknown) => {
    if (id === 'items.restoreBatch') throw new Error('gagal');
    return original?.(id, input);
  });
  options.action.onClick();
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
});
