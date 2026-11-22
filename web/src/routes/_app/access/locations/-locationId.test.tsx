import type { LocationDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { makeMe } from '@/test/make-me';
import { clickMoreAction } from '@/test/more-actions';
import { mountRoute } from '@/test/mount-route';
import { Route } from './$locationId';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const base: LocationDto = {
  id: 'l1',
  code: 'JKT',
  name: 'Jakarta',
  status: 'inactive',
  createdAt: '',
  updatedAt: '2026-11-09T01:00:00.000Z',
  updatedBy: 'admin@x.com',
};

let server: LocationDto | 'missing' = base;
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
      case 'access.locations.get':
        if (server === 'missing') throw new ApiError('NOT_FOUND', 'Lokasi tidak ditemukan', 'req');
        return server;
      case 'access.locations.removeBatch':
        return { ids: (input as { ids: string[] }).ids };
      case 'access.locations.restoreBatch':
        return { items: [base] };
      case 'access.locations.setStatus':
        return { ...base, status: (input as { status: 'active' | 'inactive' }).status };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount({ manage = true, serial = false, stock = false } = {}) {
  return mountRoute({
    route: Route,
    routePath: '/_app/access/locations/$locationId',
    entry: '/_app/access/locations/l1',
    me: makeMe({
      permissions: {
        access: manage ? 'manage' : 'view',
        ...(serial ? { serial: 'view' } : {}),
        ...(stock ? { sticker: 'view' } : {}),
      },
    }),
    others: [{ path: '/access/locations', label: 'Daftar lokasi' }],
  });
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('lokasi dimuat lewat access.locations.get dan menampilkan nama', async () => {
  await mount();
  expect(await screen.findByRole('heading', { level: 1, name: 'Jakarta' })).toBeInTheDocument();
  expect(callsOf('access.locations.get')[0]?.input).toEqual({ id: 'l1' });
});

test('tautan Data terkait tampil sesuai izin: Serial untuk serial: view, Stok untuk sticker: view', async () => {
  await mount({ serial: true, stock: true });
  expect(
    await screen.findByRole('link', { name: /Serial Number di lokasi ini/ }),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Stok stiker' })).toBeInTheDocument();
});

test('tanpa izin serial/stok: tanpa tautan Data terkait', async () => {
  await mount();
  await screen.findByRole('heading', { level: 1, name: 'Jakarta' });
  expect(screen.queryByRole('link', { name: /Serial Number di lokasi ini/ })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Stok stiker' })).toBeNull();
});

test('Hapus dari View: kembali ke daftar lokasi dengan toast "Dihapus" dan Pulihkan', async () => {
  const { router } = await mount();
  await screen.findByRole('button', { name: 'Aksi lainnya' });
  await clickMoreAction('Hapus');
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 lokasi?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/access/locations'));
  expect(callsOf('access.locations.removeBatch')[0]?.input).toEqual({ ids: ['l1'] });
  expect(toast.success).toHaveBeenCalledWith(
    'Dihapus',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
  );
});

test('lokasi terhapus: banner dan Pulihkan memanggil access.locations.restoreBatch', async () => {
  server = { ...base, deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } };
  await mount();
  expect(await screen.findByText('Data ini sudah dihapus')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  await waitFor(() =>
    expect(callsOf('access.locations.restoreBatch')[0]?.input).toEqual({ ids: ['l1'] }),
  );
});

test('lokasi tidak ditemukan (NOT_FOUND): pesan dan tombol kembali', async () => {
  server = 'missing';
  await mount();
  expect(
    await screen.findByRole('heading', { name: 'Lokasi tidak ditemukan' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kembali ke daftar lokasi' })).toBeInTheDocument();
});
