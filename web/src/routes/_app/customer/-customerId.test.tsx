import type { CustomerDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { makeMe } from '@/test/make-me';
import { mountRoute } from '@/test/mount-route';
import { Route } from './$customerId';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const base: CustomerDto = {
  id: 'c1',
  name: 'PT Maju',
  status: 'inactive',
  updatedAt: '2026-11-09T01:00:00.000Z',
};

let server: CustomerDto | 'missing' = base;
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
      case 'customers.get':
        if (server === 'missing')
          throw new ApiError('NOT_FOUND', 'Customer tidak ditemukan', 'req');
        return server;
      case 'customers.rename':
        return { ...base, name: (input as { name: string }).name };
      case 'customers.removeBatch':
        return { ids: (input as { ids: string[] }).ids };
      case 'customers.restoreBatch':
        return { items: [base] };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount({ manage = true } = {}) {
  return mountRoute({
    route: Route,
    routePath: '/_app/customer/$customerId',
    entry: '/_app/customer/c1',
    me: makeMe({ itemLevel: manage ? 'manage' : 'view' }),
    others: [{ path: '/customer', label: 'Daftar customer' }],
  });
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('customer dimuat lewat customers.get dan menampilkan nama', async () => {
  await mount();
  expect(await screen.findByRole('heading', { level: 1, name: 'PT Maju' })).toBeInTheDocument();
  expect(callsOf('customers.get')[0]?.input).toEqual({ id: 'c1' });
});

test('Ubah membuka dialog satu field Nama dan memanggil customers.rename', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah' }));
  const dialog = await screen.findByRole('alertdialog');
  const name = within(dialog).getByLabelText('Nama');
  await userEvent.clear(name);
  await userEvent.type(name, 'PT Baru');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(callsOf('customers.rename')[0]?.input).toEqual({ id: 'c1', name: 'PT Baru' }),
  );
});

test('Hapus dari View: kembali ke daftar customer dengan toast "Dihapus" dan Pulihkan', async () => {
  const { router } = await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 customer?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/customer'));
  expect(callsOf('customers.removeBatch')[0]?.input).toEqual({ ids: ['c1'] });
  expect(toast.success).toHaveBeenCalledWith(
    'Dihapus',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
  );
});

test('customer terhapus: banner dan Pulihkan memanggil customers.restoreBatch', async () => {
  server = { ...base, deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } };
  await mount();
  expect(await screen.findByText('Data ini sudah dihapus')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  await waitFor(() => expect(callsOf('customers.restoreBatch')[0]?.input).toEqual({ ids: ['c1'] }));
});

test('tanpa item: manage: tanpa aksi Ubah/Hapus', async () => {
  await mount({ manage: false });
  await screen.findByRole('heading', { level: 1, name: 'PT Maju' });
  expect(screen.queryByRole('button', { name: /Ubah|Aktifkan|Hapus/ })).toBeNull();
});

test('customer tidak ditemukan (NOT_FOUND): pesan dan tombol kembali', async () => {
  server = 'missing';
  await mount();
  expect(
    await screen.findByRole('heading', { name: 'Customer tidak ditemukan' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kembali ke daftar customer' })).toBeInTheDocument();
});
