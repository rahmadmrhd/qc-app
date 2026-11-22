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

const brand = (id: string, patch: Partial<BrandDto> = {}): BrandDto => ({
  id,
  name: `Merk ${id}`,
  status: 'inactive',
  itemCount: 0,
  updatedAt: '',
  businessUnitIds: [],
  ...patch,
});

const businessUnits: BusinessUnitOptionDto[] = [
  { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active' },
];

let live: BrandDto[] = [];
let deletedRows: BrandDto[] = [];
let calls: { id: string; input: unknown }[] = [];

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  toast.warning.mockReset();
  calls = [];
  live = [brand('b1', { itemCount: 3 }), brand('b2')];
  deletedRows = [];
  apiMock.mockImplementation(async (id: string, input: { ids?: string[]; status?: string }) => {
    calls.push({ id, input });
    switch (id) {
      case 'brands.list':
        return (input as { status?: string } | null)?.status === 'deleted' ? deletedRows : live;
      case 'businessUnits.options':
        return businessUnits;
      case 'brands.setStatusBatch':
        return {
          items: (input.ids ?? []).map((brandId) =>
            brand(brandId, { status: input.status as 'active' | 'inactive' }),
          ),
        };
      case 'brands.removeBatch':
        return { ids: input.ids };
      case 'brands.restoreBatch':
        return { items: (input.ids ?? []).map((brandId) => brand(brandId)) };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount({ manage = true, path = '/_app/item/brands/' } = {}) {
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(meQueryKey, makeMe({ itemLevel: manage ? 'manage' : 'edit' }));
  client.setQueryData(['businessUnits', 'options'], businessUnits);
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: '/_app/item/brands/',
    validateSearch: Route.options.validateSearch,
    component: Component as never,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
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
  await screen.findByRole('table', { name: 'Daftar merk' });
  return { router, client };
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('pilih dua merk: Nonaktifkan memanggil brands.setStatusBatch dengan dua id', async () => {
  live = [brand('b1', { status: 'active' }), brand('b2', { status: 'active' })];
  await mount();
  await screen.findByText('Merk b1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Merk b1' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Merk b2' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByText('2 dipilih')).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole('button', { name: 'Nonaktifkan' }));
  await waitFor(() => expect(callsOf('brands.setStatusBatch')).toHaveLength(1));
  expect(callsOf('brands.setStatusBatch')[0]?.input).toEqual({
    ids: ['b1', 'b2'],
    status: 'inactive',
  });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      '2 merk dinonaktifkan',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Urungkan' }) }),
    ),
  );
});

test('Hapus massal: konfirmasi memuat jumlah item terpakai, lalu brands.removeBatch', async () => {
  await mount();
  await screen.findByText('Merk b1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 2 merk?' });
  expect(within(dialog).getByText('Dipakai 3 item')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('brands.removeBatch')).toHaveLength(1));
  expect(callsOf('brands.removeBatch')[0]?.input).toEqual({ ids: ['b1', 'b2'] });
});

test('pilihan campuran Aktif + Nonaktif: Aktifkan, Nonaktifkan, dan Hapus tampil; Hapus hanya mengirim yang Nonaktif', async () => {
  live = [brand('b1', { status: 'active' }), brand('b2')];
  await mount();
  await screen.findByText('Merk b1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument();
  expect(within(bar).getByRole('button', { name: 'Nonaktifkan' })).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 merk?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('brands.removeBatch')).toHaveLength(1));
  expect(callsOf('brands.removeBatch')[0]?.input).toEqual({ ids: ['b2'] });
});

test('tanpa hak manage: tidak ada checkbox maupun opsi Terhapus', async () => {
  await mount({ manage: false });
  expect(screen.queryByRole('checkbox')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Status' }));
  await userEvent.click(await screen.findByRole('combobox', { name: 'Filter status' }));
  const options = await screen.findAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual([
    'Semua status',
    'Aktif',
    'Nonaktif',
  ]);
});

test('tampilan Terhapus: memuat daftar terhapus, bar massal hanya Pulihkan', async () => {
  deletedRows = [
    brand('d1', { deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } }),
  ];
  await mount({ path: '/_app/item/brands/?status=deleted' });
  await screen.findByText('Merk d1');
  expect(
    callsOf('brands.list').some(
      (call) => (call.input as { status?: string } | null)?.status === 'deleted',
    ),
  ).toBe(true);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Merk d1' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).queryByRole('button', { name: 'Nonaktifkan' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() => expect(callsOf('brands.restoreBatch')).toHaveLength(1));
  expect(callsOf('brands.restoreBatch')[0]?.input).toEqual({ ids: ['d1'] });
});

test('?status=deleted tanpa hak manage diperlakukan sebagai Semua status', async () => {
  await mount({ manage: false, path: '/_app/item/brands/?status=deleted' });
  await screen.findByText('Merk b1');
  expect(
    callsOf('brands.list').every((call) => (call.input as { status?: string } | null) === null),
  ).toBe(true);
});

test('cari menyaring daftar menurut nama merk', async () => {
  await mount();
  await screen.findByText('Merk b1');
  await userEvent.type(screen.getByRole('searchbox', { name: 'Cari merk' }), 'b2');
  await waitFor(() => expect(screen.queryByText('Merk b1')).toBeNull());
  expect(screen.getByText('Merk b2')).toBeInTheDocument();
});

test('Tambah merk membuka dialog dengan form merk', async () => {
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah merk' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByLabelText('Nama merk')).toBeInTheDocument();
});

test('hanya merk Aktif terpilih: Hapus tidak tampil', async () => {
  live = [brand('b1', { status: 'active' })];
  await mount();
  await screen.findByText('Merk b1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Merk b1' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(within(bar).queryByRole('button', { name: 'Aktifkan' })).toBeNull();
  expect(within(bar).getByRole('button', { name: 'Nonaktifkan' })).toBeInTheDocument();
});
