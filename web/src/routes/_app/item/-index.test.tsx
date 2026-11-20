import type { ItemDto, ItemSummaryDto } from '@shared/contract';
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
import { ApiError } from '@/lib/api/api-error';
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

const summary = (id: string, patch: Partial<ItemSummaryDto> = {}): ItemSummaryDto => ({
  id,
  brandId: 'b1',
  brand: 'Asus',
  model: `M-${id}`,
  isCountryLock: false,
  status: 'inactive',
  aliases: [],
  imageCount: 0,
  hasInstructions: true,
  hasManualBook: true,
  hasPostel: true,
  businessUnits: [{ id: 'bu-a', code: 'RTL', name: 'Retail' }],
  updatedAt: '',
  ...patch,
});

const asDto = (item: ItemSummaryDto, patch: Partial<ItemDto> = {}): ItemDto =>
  ({
    ...item,
    manualBook: null,
    postel: null,
    stickerPhotos: [],
    accessories: [],
    attachments: [],
    detail: '',
    firmware: '',
    proofRequired: false,
    proofMin: 1,
    createdAt: '',
    updatedBy: '',
    ...patch,
  }) as ItemDto;

let rows: ItemSummaryDto[] = [];
let calls: { id: string; input: unknown }[] = [];

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  toast.warning.mockReset();
  calls = [];
  rows = [summary('i1'), summary('i2')];
  apiMock.mockImplementation(async (id: string, input: { ids?: string[]; status?: string }) => {
    calls.push({ id, input });
    switch (id) {
      case 'items.list':
        return { items: rows, nextCursor: null };
      case 'brands.list':
        return [
          {
            id: 'b1',
            name: 'Asus',
            status: 'active',
            itemCount: 2,
            updatedAt: '',
            businessUnitIds: [],
          },
        ];
      case 'brands.get':
        return {
          id: 'bx',
          name: 'Merk Lawas',
          status: 'inactive',
          itemCount: 0,
          updatedAt: '',
          businessUnitIds: [],
          deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
        };
      case 'stickers.list':
      case 'stickerTypes.list':
        return [];
      case 'items.setStatusBatch':
        return {
          items: (input.ids ?? []).map((itemId) =>
            asDto(summary(itemId, { status: input.status as 'active' | 'inactive' })),
          ),
        };
      case 'items.removeBatch':
        return { ids: input.ids };
      case 'items.restoreBatch':
        return { items: (input.ids ?? []).map((itemId) => asDto(summary(itemId))) };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount({
  manage = true,
  path = '/_app/item/',
}: {
  manage?: boolean;
  path?: string;
} = {}) {
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(meQueryKey, makeMe({ itemLevel: manage ? 'manage' : 'view' }));
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path: '/_app/item/',
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
        <Suspense fallback={<p>memuat</p>}>
          <RouterProvider router={router as never} />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  await screen.findByRole('table', { name: 'Daftar item' });
  return { router, client };
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('pilih dua baris: "2 dipilih" dan Nonaktifkan memanggil items.setStatusBatch dengan dua id', async () => {
  await mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Asus M-i1' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Asus M-i2' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByText('2 dipilih')).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole('button', { name: 'Nonaktifkan' }));
  await waitFor(() => expect(callsOf('items.setStatusBatch')).toHaveLength(1));
  expect(callsOf('items.setStatusBatch')[0]?.input).toEqual({
    ids: ['i1', 'i2'],
    status: 'inactive',
  });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      '2 item dinonaktifkan',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Urungkan' }) }),
    ),
  );
});

test('Hapus massal membuka konfirmasi "Hapus 2 item?" lalu memanggil items.removeBatch', async () => {
  await mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 2 item?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('items.removeBatch')).toHaveLength(1));
  expect(callsOf('items.removeBatch')[0]?.input).toEqual({ ids: ['i1', 'i2'] });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      '2 item dihapus',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
    ),
  );
});

test('Hapus massal nonaktif bila ada item Aktif yang terpilih', async () => {
  rows = [summary('i1', { status: 'active' }), summary('i2')];
  await mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeDisabled();
});

test('mengubah filter mengosongkan pilihan', async () => {
  await mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.getByText('2 dipilih')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Status' }));
  await userEvent.click(await screen.findByRole('combobox', { name: 'Filter status' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Aktif' }));
  await waitFor(() => expect(screen.queryByText(/dipilih/)).toBeNull());
});

test('tanpa item: manage tidak ada checkbox maupun opsi Terhapus', async () => {
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

test('pemegang manage melihat opsi Terhapus', async () => {
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Status' }));
  await userEvent.click(await screen.findByRole('combobox', { name: 'Filter status' }));
  const options = await screen.findAllByRole('option');
  expect(options.map((option) => option.textContent)).toContain('Terhapus');
});

test('"Pilih semua" 250 id dikirim bertahap 100, 100, 50', async () => {
  rows = Array.from({ length: 250 }, (_, index) => summary(`x${index}`));
  await mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.getByText('250 dipilih')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan' }));
  await waitFor(() => expect(callsOf('items.setStatusBatch')).toHaveLength(3), { timeout: 5000 });
  expect(
    callsOf('items.setStatusBatch').map((call) => (call.input as { ids: string[] }).ids.length),
  ).toEqual([100, 100, 50]);
}, 60_000);

test('UNAVAILABLE menjadi toast galat tanpa antrean dan pilihan tetap', async () => {
  await mount();
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation(async (id: string, input: unknown) => {
    if (id === 'items.setStatusBatch') {
      throw new ApiError('UNAVAILABLE', 'Tidak ada koneksi', 'req-1');
    }
    return original?.(id, input);
  });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith('Tidak ada koneksi. Coba lagi beberapa saat.'),
  );
  expect(screen.getByText('2 dipilih')).toBeInTheDocument();
});

test('tampilan Terhapus: bar massal hanya Pulihkan dan memanggil items.restoreBatch', async () => {
  rows = [
    summary('i1', { deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } }),
  ];
  await mount({ path: '/_app/item/?status=deleted' });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Asus M-i1' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).queryByRole('button', { name: 'Nonaktifkan' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() => expect(callsOf('items.restoreBatch')).toHaveLength(1));
  expect(callsOf('items.restoreBatch')[0]?.input).toEqual({ ids: ['i1'] });
});

test('tombol Tambah item tampil bagi yang boleh membuat, tanpa "Kelola merk"', async () => {
  await mount();
  expect(screen.getByRole('button', { name: 'Tambah item' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Kelola merk' })).toBeNull();
});

test('pilihan yang tak dapat dikelola: bar tetap tampil, aksi nonaktif dengan alasan, Batalkan pilihan jalan', async () => {
  rows = [summary('i1', { businessUnits: [{ id: 'bu-z', code: 'ZZZ', name: 'Lain' }] })];
  await mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Asus M-i1' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByText('1 dipilih')).toBeInTheDocument();
  expect(within(bar).getByRole('button', { name: 'Aktifkan' })).toBeDisabled();
  expect(within(bar).getByRole('button', { name: 'Hapus' })).toBeDisabled();
  expect(
    within(bar).getAllByText('Anda tidak berhak mengelola sebagian item yang dipilih').length,
  ).toBeGreaterThan(0);
  await userEvent.click(within(bar).getByRole('button', { name: 'Batalkan pilihan' }));
  expect(screen.queryByText(/dipilih/)).toBeNull();
});

test('alasan Hapus massal nonaktif dapat dijangkau (bukan atribut title)', async () => {
  rows = [summary('i1', { status: 'active' })];
  await mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Asus M-i1' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByRole('button', { name: 'Hapus' })).not.toHaveAttribute('title');
  expect(within(bar).getByText('Nonaktifkan item dulu sebelum dihapus')).toBeInTheDocument();
});

test('?brandId= dari tautan Merk diteruskan ke items.list dan chip Merk menampilkan namanya', async () => {
  await mount({ path: '/_app/item/?brandId=b1' });
  await waitFor(() =>
    expect(
      callsOf('items.list').some((call) => (call.input as { brandId?: string }).brandId === 'b1'),
    ).toBe(true),
  );
  expect(await screen.findByRole('button', { name: 'Merk: Asus' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Business Unit' })).toBeInTheDocument();
});

test('?brandId= merk terhapus: chip Merk menampilkan nama dan penanda Terhapus (brands.get)', async () => {
  await mount({ path: '/_app/item/?brandId=bx' });
  expect(
    await screen.findByRole('button', { name: 'Merk: Merk Lawas — Terhapus' }),
  ).toBeInTheDocument();
  expect(callsOf('brands.get')[0]?.input).toEqual({ id: 'bx' });
});

test('toast Nonaktifkan massal memuat Urungkan yang mengaktifkan lagi item itu', async () => {
  await mount();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(
    within(screen.getByRole('region', { name: 'Aksi massal' })).getByRole('button', {
      name: 'Nonaktifkan',
    }),
  );
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  const options = toast.success.mock.calls[0]?.[1] as { action: { onClick: () => void } };
  options.action.onClick();
  await waitFor(() => expect(callsOf('items.setStatusBatch')).toHaveLength(2));
  expect(callsOf('items.setStatusBatch')[1]?.input).toEqual({
    ids: ['i1', 'i2'],
    status: 'active',
  });
});
