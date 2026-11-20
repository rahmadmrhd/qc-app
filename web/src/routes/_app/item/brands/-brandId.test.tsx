import type { BrandDto, BusinessUnitOptionDto } from '@shared/contract';
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
import { ApiError } from '@/lib/api/api-error';
import { meQueryKey } from '@/modules/auth/queries';
import { brandKeys } from '@/modules/brand/keys';
import { makeMe } from '@/test/make-me';
import { Route } from './$brandId';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const base: BrandDto = {
  id: 'b1',
  name: 'Ubiquiti',
  status: 'inactive',
  itemCount: 3,
  updatedAt: '2026-11-09T01:00:00.000Z',
  businessUnitIds: ['bu-a'],
};
const businessUnits: BusinessUnitOptionDto[] = [
  { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active' },
];

let server: BrandDto | 'missing' = base;
let calls: { id: string; input: unknown }[] = [];

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  calls = [];
  server = base;
  apiMock.mockImplementation(async (id: string, input: unknown) => {
    calls.push({ id, input });
    switch (id) {
      case 'brands.get':
        if (server === 'missing') throw new ApiError('NOT_FOUND', 'Merk tidak ditemukan', 'req');
        return server;
      case 'businessUnits.options':
        return businessUnits;
      case 'brands.removeBatch':
        return { ids: (input as { ids: string[] }).ids };
      case 'brands.restoreBatch':
        return { items: [base] };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount({
  manage = true,
  seedList = false,
}: {
  manage?: boolean;
  seedList?: boolean;
} = {}) {
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(meQueryKey, makeMe({ itemLevel: manage ? 'manage' : 'view' }));
  client.setQueryData(['businessUnits', 'options'], businessUnits);
  if (seedList) client.setQueryData(brandKeys.list, [base]);
  const root = createRootRoute();
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/_app/item/brands/$brandId',
    component: Component as never,
  });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/item/brands',
    component: () => <p>Daftar merk</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([detail, index]),
    history: createMemoryHistory({ initialEntries: ['/_app/item/brands/b1'] }),
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
  return { router };
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('merk tidak ada di cache daftar: dimuat lewat brands.get', async () => {
  await mount();
  expect(await screen.findByRole('heading', { level: 1, name: 'Ubiquiti' })).toBeInTheDocument();
  expect(callsOf('brands.get')).toHaveLength(1);
  expect(callsOf('brands.get')[0]?.input).toEqual({ id: 'b1' });
});

test('merk ada di cache daftar: tampil seketika dari cache walau brands.get belum selesai', async () => {
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation(async (id: string, input: unknown) =>
    id === 'brands.get' ? new Promise(() => undefined) : original?.(id, input),
  );
  await mount({ seedList: true });
  expect(await screen.findByRole('heading', { level: 1, name: 'Ubiquiti' })).toBeInTheDocument();
});

test('merk terhapus: banner dan Pulihkan memanggil brands.restoreBatch', async () => {
  server = { ...base, deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } };
  await mount();
  expect(await screen.findByText('Data ini sudah dihapus')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  await waitFor(() => expect(callsOf('brands.restoreBatch')[0]?.input).toEqual({ ids: ['b1'] }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Merk dipulihkan (Nonaktif)'));
});

test('Hapus dari View: konfirmasi, kembali ke daftar merk, toast "Dihapus" dengan Pulihkan', async () => {
  const { router } = await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 merk?' });
  expect(within(dialog).getByText('Dipakai 3 item')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/item/brands'));
  expect(callsOf('brands.removeBatch')[0]?.input).toEqual({ ids: ['b1'] });
  expect(toast.success).toHaveBeenCalledWith(
    'Dihapus',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
  );
});

test('Ubah membuka dialog form merk berisi nama saat ini', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByLabelText('Nama merk')).toHaveValue('Ubiquiti');
});

test('merk tidak ditemukan (NOT_FOUND): pesan dan tombol kembali', async () => {
  server = 'missing';
  await mount();
  expect(await screen.findByRole('heading', { name: 'Merk tidak ditemukan' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kembali ke daftar merk' })).toBeInTheDocument();
});

test('Pulihkan dari toast "Dihapus" setelah navigasi tetap memberi toast sukses atau galat', async () => {
  const { router } = await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 merk?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/item/brands'));
  const options = toast.success.mock.calls.find((call) => call[0] === 'Dihapus')?.[1] as {
    action: { onClick: () => void };
  };
  toast.success.mockClear();
  options.action.onClick();
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Merk dipulihkan (Nonaktif)'));
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation(async (id: string, input: unknown) => {
    if (id === 'brands.restoreBatch') throw new Error('gagal');
    return original?.(id, input);
  });
  options.action.onClick();
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
});
