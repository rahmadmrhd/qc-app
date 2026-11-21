import type { BusinessUnitDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { makeMe } from '@/test/make-me';
import { mountRoute } from '@/test/mount-route';
import { Route } from './$businessUnitId';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const base: BusinessUnitDto = {
  id: 'bu1',
  code: 'RTL',
  name: 'Retail',
  status: 'inactive',
  itemCount: 12,
  userCount: 3,
  createdAt: '',
  updatedAt: '2026-11-09T01:00:00.000Z',
  updatedBy: 'admin@x.com',
};

let server: BusinessUnitDto | 'missing' = base;
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
      case 'access.businessUnits.get':
        if (server === 'missing') throw new ApiError('NOT_FOUND', 'BU tidak ditemukan', 'req');
        return server;
      case 'access.businessUnits.setStatus':
        return { ...base, status: (input as { status: 'active' | 'inactive' }).status };
      case 'access.businessUnits.removeBatch':
        return { ids: (input as { ids: string[] }).ids };
      case 'access.businessUnits.restoreBatch':
        return { items: [base] };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount({ manage = true } = {}) {
  return mountRoute({
    route: Route,
    routePath: '/_app/access/business-units/$businessUnitId',
    entry: '/_app/access/business-units/bu1',
    me: makeMe({ permissions: { access: manage ? 'manage' : 'view' } }),
    others: [{ path: '/access/business-units', label: 'Daftar BU' }],
  });
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('BU dimuat lewat access.businessUnits.get dan menampilkan nama', async () => {
  await mount();
  expect(await screen.findByRole('heading', { level: 1, name: 'Retail' })).toBeInTheDocument();
  expect(callsOf('access.businessUnits.get')[0]?.input).toEqual({ id: 'bu1' });
});

test('Hapus dari View: konfirmasi menyebut pemakaian, kembali ke daftar BU dengan toast "Dihapus"', async () => {
  const { router } = await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 BU?' });
  expect(dialog).toHaveTextContent('Dipakai 12 item, 3 pengguna');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/access/business-units'));
  expect(callsOf('access.businessUnits.removeBatch')[0]?.input).toEqual({ ids: ['bu1'] });
  expect(toast.success).toHaveBeenCalledWith(
    'Dihapus',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
  );
});

test('menonaktifkan BU Aktif yang dipakai meminta konfirmasi dari View', async () => {
  server = { ...base, status: 'active' };
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Nonaktifkan' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Nonaktifkan BU Retail?' });
  expect(callsOf('access.businessUnits.setStatus')).toHaveLength(0);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Nonaktifkan' }));
  await waitFor(() => expect(callsOf('access.businessUnits.setStatus')).toHaveLength(1));
});

test('BU terhapus: banner dan Pulihkan memanggil access.businessUnits.restoreBatch', async () => {
  server = {
    ...base,
    deleted: true,
    deletedInfo: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
  };
  await mount();
  expect(await screen.findByText('Data ini sudah dihapus')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  await waitFor(() =>
    expect(callsOf('access.businessUnits.restoreBatch')[0]?.input).toEqual({ ids: ['bu1'] }),
  );
});

test('BU tidak ditemukan (NOT_FOUND): pesan dan tombol kembali', async () => {
  server = 'missing';
  await mount();
  expect(await screen.findByRole('heading', { name: 'BU tidak ditemukan' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kembali ke daftar BU' })).toBeInTheDocument();
});
