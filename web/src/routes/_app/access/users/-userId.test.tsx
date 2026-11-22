import type { BusinessUnitDto, LocationDto, RoleDto, UserDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { makeMe } from '@/test/make-me';
import { clickMoreAction } from '@/test/more-actions';
import { mountRoute } from '@/test/mount-route';
import { Route } from './$userId';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const base: UserDto = {
  id: 'u1',
  email: 'ani@x.com',
  name: 'Ani',
  status: 'inactive',
  assignments: [{ locationId: 'l1', roleIds: ['r1'] }],
  buAssignments: [],
  sharedAccount: false,
  createdAt: '',
  updatedAt: '2026-11-09T01:00:00.000Z',
  updatedBy: 'admin@x.com',
};
const roles: RoleDto[] = [
  {
    id: 'r1',
    name: 'QC',
    description: '',
    permissions: {},
    userCount: 1,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
  },
];
const locations: LocationDto[] = [
  {
    id: 'l1',
    code: 'JKT',
    name: 'Jakarta',
    status: 'active',
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
  },
];
const businessUnits: BusinessUnitDto[] = [];

let server: UserDto | 'missing' = base;
let calls: { id: string; input: unknown }[] = [];

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  calls = [];
  server = base;
  apiMock.mockImplementation(async (id: string, input: unknown) => {
    calls.push({ id, input });
    const deletedList = (input as { status?: string } | null)?.status === 'deleted';
    switch (id) {
      case 'access.users.get':
        if (server === 'missing')
          throw new ApiError('NOT_FOUND', 'Pengguna tidak ditemukan', 'req');
        return server;
      case 'access.roles.list':
        return deletedList ? [] : roles;
      case 'access.locations.list':
        return deletedList ? [] : locations;
      case 'access.businessUnits.list':
        return deletedList ? [] : businessUnits;
      case 'access.users.removeBatch':
        return { ids: (input as { ids: string[] }).ids };
      case 'access.users.restoreBatch':
        return { items: [base] };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount({ manage = true, view = true } = {}) {
  return mountRoute({
    route: Route,
    routePath: '/_app/access/users/$userId',
    entry: '/_app/access/users/u1',
    me: makeMe({ permissions: { access: manage ? 'manage' : view ? 'view' : 'none' } }),
    seeds: [
      [['access', 'roles'], roles],
      [['access', 'locations'], locations],
      [['access', 'businessUnits'], businessUnits],
    ],
    others: [{ path: '/access/users', label: 'Daftar pengguna' }],
  });
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('pengguna dimuat lewat access.users.get dan menampilkan email', async () => {
  await mount();
  expect(await screen.findByRole('heading', { level: 1, name: 'ani@x.com' })).toBeInTheDocument();
  expect(callsOf('access.users.get')[0]?.input).toEqual({ id: 'u1' });
});

test('Buka lokasi pada penugasan menaut ke View lokasi bila access: view', async () => {
  await mount({ manage: false });
  await userEvent.click(await screen.findByRole('tab', { name: 'Penugasan lokasi' }));
  expect(await screen.findByRole('link', { name: 'Jakarta' })).toHaveAttribute(
    'href',
    '/access/locations/l1',
  );
});

test('tanpa hak manage: tanpa aksi Ubah/Hapus, dan daftar Terhapus tidak diminta', async () => {
  await mount({ manage: false });
  await screen.findByRole('heading', { level: 1, name: 'ani@x.com' });
  expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  expect(
    calls.some((call) => (call.input as { status?: string } | null)?.status === 'deleted'),
  ).toBe(false);
});

test('Hapus dari View: konfirmasi, kembali ke daftar pengguna, toast "Dihapus" dengan Pulihkan', async () => {
  const { router } = await mount();
  await screen.findByRole('button', { name: 'Aksi lainnya' });
  await clickMoreAction('Hapus');
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 pengguna?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/access/users'));
  expect(callsOf('access.users.removeBatch')[0]?.input).toEqual({ ids: ['u1'] });
  expect(toast.success).toHaveBeenCalledWith(
    'Dihapus',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
  );
});

test('pengguna terhapus: banner dan Pulihkan memanggil access.users.restoreBatch', async () => {
  server = { ...base, deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } };
  await mount();
  expect(await screen.findByText('Data ini sudah dihapus')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  await waitFor(() =>
    expect(callsOf('access.users.restoreBatch')[0]?.input).toEqual({ ids: ['u1'] }),
  );
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Pengguna dipulihkan (Nonaktif)'));
});

test('Ubah membuka dialog bertab berisi data pengguna', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByLabelText('Nama')).toHaveValue('Ani');
});

test('pengguna tidak ditemukan (NOT_FOUND): pesan dan tombol kembali', async () => {
  server = 'missing';
  await mount();
  expect(
    await screen.findByRole('heading', { name: 'Pengguna tidak ditemukan' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kembali ke daftar pengguna' })).toBeInTheDocument();
});
