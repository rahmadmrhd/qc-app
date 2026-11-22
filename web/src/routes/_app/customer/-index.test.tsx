import type { CustomerDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { makeMe } from '@/test/make-me';
import { mountRoute } from '@/test/mount-route';
import { Route } from './index';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const customer = (id: string, patch: Partial<CustomerDto> = {}): CustomerDto => ({
  id,
  name: `Cust ${id}`,
  status: 'inactive',
  updatedAt: '',
  ...patch,
});

let live: CustomerDto[] = [];
let deletedRows: CustomerDto[] = [];
let calls: { id: string; input: unknown }[] = [];

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  calls = [];
  live = [customer('a'), customer('b')];
  deletedRows = [];
  apiMock.mockImplementation(
    async (id: string, input: { ids?: string[]; status?: string; name?: string }) => {
      calls.push({ id, input });
      switch (id) {
        case 'customers.list':
          return input?.status === 'deleted' ? deletedRows : live;
        case 'customers.rename':
          return { ...customer((input as unknown as { id: string }).id), name: input.name };
        case 'customers.setStatusBatch':
          return {
            items: (input.ids ?? []).map((cId) =>
              customer(cId, { status: input.status as 'active' | 'inactive' }),
            ),
          };
        case 'customers.removeBatch':
          return { ids: input.ids };
        case 'customers.restoreBatch':
          return { items: (input.ids ?? []).map((cId) => customer(cId)) };
        default:
          throw new Error(`api tak terduga: ${id}`);
      }
    },
  );
});

async function mount({ manage = true, entry = '/_app/customer/' } = {}) {
  const result = await mountRoute({
    route: Route,
    routePath: '/_app/customer/',
    entry,
    me: makeMe({ itemLevel: manage ? 'manage' : 'view' }),
  });
  await screen.findByRole('table', { name: 'Daftar customer' });
  return result;
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('nama menaut ke View customer; tidak ada tombol Tambah', async () => {
  await mount();
  expect(await screen.findByRole('link', { name: 'Cust a' })).toHaveAttribute(
    'href',
    '/customer/a',
  );
  expect(screen.queryByRole('button', { name: /^Tambah/ })).toBeNull();
});

test('Ubah dari baris membuka dialog satu field Nama dan memanggil customers.rename', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah Cust a' }));
  const dialog = await screen.findByRole('alertdialog');
  const name = within(dialog).getByLabelText('Nama');
  expect(name).toHaveValue('Cust a');
  await userEvent.clear(name);
  await userEvent.type(name, 'Cust Baru');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(callsOf('customers.rename')[0]?.input).toEqual({ id: 'a', name: 'Cust Baru' }),
  );
});

test('pilih dua customer: Aktifkan memanggil customers.setStatusBatch dengan dua id', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih Cust a' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Cust b' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  await userEvent.click(within(bar).getByRole('button', { name: 'Aktifkan' }));
  await waitFor(() => expect(callsOf('customers.setStatusBatch')).toHaveLength(1));
  expect(callsOf('customers.setStatusBatch')[0]?.input).toEqual({
    ids: ['a', 'b'],
    status: 'active',
  });
});

test('Hapus massal: konfirmasi lalu customers.removeBatch', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 2 customer?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('customers.removeBatch')).toHaveLength(1));
  expect(callsOf('customers.removeBatch')[0]?.input).toEqual({ ids: ['a', 'b'] });
});

test('pilihan campuran Aktif + Nonaktif: Aktifkan dan Nonaktifkan tampil; Hapus hanya mengirim yang Nonaktif', async () => {
  live = [customer('a', { status: 'active' }), customer('b')];
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument();
  expect(within(bar).getByRole('button', { name: 'Nonaktifkan' })).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 customer?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('customers.removeBatch')).toHaveLength(1));
  expect(callsOf('customers.removeBatch')[0]?.input).toEqual({ ids: ['b'] });
});

test('tanpa item: manage: tanpa checkbox dan tanpa opsi Terhapus', async () => {
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

test('tampilan Terhapus memuat daftar terhapus dan bar massal hanya Pulihkan', async () => {
  deletedRows = [
    customer('d1', { deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } }),
  ];
  await mount({ entry: '/_app/customer/?status=deleted' });
  await screen.findByText('Cust d1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Cust d1' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).queryByRole('button', { name: 'Nonaktifkan' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() => expect(callsOf('customers.restoreBatch')[0]?.input).toEqual({ ids: ['d1'] }));
});

test('pencarian nama menyaring daftar di klien', async () => {
  await mount();
  await userEvent.type(screen.getByRole('searchbox', { name: 'Cari customer' }), 'Cust b');
  await waitFor(() => expect(screen.queryByText('Cust a')).toBeNull());
  expect(screen.getByText('Cust b')).toBeInTheDocument();
});
