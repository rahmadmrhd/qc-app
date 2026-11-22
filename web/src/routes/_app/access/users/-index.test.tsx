import type { BusinessUnitDto, LocationDto, RoleDto, UserDto } from '@shared/contract';
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

const user = (id: string, patch: Partial<UserDto> = {}): UserDto => ({
  id,
  email: `${id}@x.com`,
  name: id.toUpperCase(),
  status: 'inactive',
  assignments: [],
  buAssignments: [],
  sharedAccount: false,
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
  ...patch,
});

const roles: RoleDto[] = [
  {
    id: 'r1',
    name: 'QC',
    description: '',
    permissions: {},
    userCount: 0,
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

let live: UserDto[] = [];
let deletedRows: UserDto[] = [];
let calls: { id: string; input: unknown }[] = [];

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  toast.warning.mockReset();
  calls = [];
  live = [user('u1'), user('u2')];
  deletedRows = [];
  apiMock.mockImplementation(async (id: string, input: { ids?: string[]; status?: string }) => {
    calls.push({ id, input });
    switch (id) {
      case 'access.users.list':
        return (input as { status?: string } | null)?.status === 'deleted' ? deletedRows : live;
      case 'access.roles.list':
        return (input as { status?: string } | null)?.status === 'deleted' ? [] : roles;
      case 'access.locations.list':
        return (input as { status?: string } | null)?.status === 'deleted' ? [] : locations;
      case 'access.businessUnits.list':
        return (input as { status?: string } | null)?.status === 'deleted' ? [] : businessUnits;
      case 'access.users.setStatusBatch':
        return {
          items: (input.ids ?? []).map((userId) =>
            user(userId, { status: input.status as 'active' | 'inactive' }),
          ),
        };
      case 'access.users.removeBatch':
        return { ids: input.ids };
      case 'access.users.restoreBatch':
        return { items: (input.ids ?? []).map((userId) => user(userId)) };
      case 'auth.me':
        return makeMe();
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount({ manage = true, entry = '/_app/access/users/' } = {}) {
  const result = await mountRoute({
    route: Route,
    routePath: '/_app/access/users/',
    entry,
    me: makeMe({ permissions: { access: manage ? 'manage' : 'view' } }),
  });
  await screen.findByRole('table', { name: 'Daftar pengguna' });
  return result;
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('email menaut ke View pengguna', async () => {
  await mount();
  expect(await screen.findByRole('link', { name: 'u1@x.com' })).toHaveAttribute(
    'href',
    '/access/users/u1',
  );
});

test('pilih dua pengguna: Aktifkan memanggil access.users.setStatusBatch dengan dua id', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih u1@x.com' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih u2@x.com' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  await userEvent.click(within(bar).getByRole('button', { name: 'Aktifkan' }));
  await waitFor(() => expect(callsOf('access.users.setStatusBatch')).toHaveLength(1));
  expect(callsOf('access.users.setStatusBatch')[0]?.input).toEqual({
    ids: ['u1', 'u2'],
    status: 'active',
  });
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      '2 pengguna diaktifkan',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Urungkan' }) }),
    ),
  );
});

test('Hapus massal: konfirmasi lalu access.users.removeBatch', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 2 pengguna?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('access.users.removeBatch')).toHaveLength(1));
  expect(callsOf('access.users.removeBatch')[0]?.input).toEqual({ ids: ['u1', 'u2'] });
});

test('pilihan campuran Aktif + Nonaktif menampilkan Aktifkan dan Nonaktifkan; yang dikirim hanya baris yang memenuhi syarat', async () => {
  live = [user('u1', { status: 'active' }), user('u2')];
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole('button', { name: 'Nonaktifkan' }));
  await waitFor(() => expect(callsOf('access.users.setStatusBatch')).toHaveLength(1));
  expect(callsOf('access.users.setStatusBatch')[0]?.input).toEqual({
    ids: ['u1'],
    status: 'inactive',
  });
});

test('akun sendiri tidak ikut Nonaktifkan massal: hanya baris lain yang dikirim', async () => {
  live = [user('a', { email: 'a@x.com', status: 'active' }), user('u2', { status: 'active' })];
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  await userEvent.click(within(bar).getByRole('button', { name: 'Nonaktifkan' }));
  await waitFor(() => expect(callsOf('access.users.setStatusBatch')).toHaveLength(1));
  expect(callsOf('access.users.setStatusBatch')[0]?.input).toEqual({
    ids: ['u2'],
    status: 'inactive',
  });
});

test('akun sendiri tidak ikut Hapus massal: hanya pengguna Nonaktif lain yang dikirim', async () => {
  live = [user('a', { email: 'a@x.com' }), user('u2'), user('u3', { status: 'active' })];
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 pengguna?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('access.users.removeBatch')).toHaveLength(1));
  expect(callsOf('access.users.removeBatch')[0]?.input).toEqual({ ids: ['u2'] });
});

test('hanya akun sendiri atau super admin terpilih: tanpa Nonaktifkan dan Hapus', async () => {
  live = [
    user('a', { email: 'a@x.com', status: 'active' }),
    user('u1', { status: 'active', superAdmin: true }),
  ];
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).queryByRole('button', { name: 'Nonaktifkan' })).toBeNull();
  expect(within(bar).queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(within(bar).queryByRole('button', { name: 'Aktifkan' })).toBeNull();
});

test('Hapus massal tampil bila ada pengguna Nonaktif terpilih dan hanya itu yang dikirim', async () => {
  live = [user('u1', { status: 'active' }), user('u2')];
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 pengguna?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('access.users.removeBatch')).toHaveLength(1));
  expect(callsOf('access.users.removeBatch')[0]?.input).toEqual({ ids: ['u2'] });
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

test('tampilan Terhapus memuat daftar terhapus dan bar massal hanya Pulihkan', async () => {
  deletedRows = [
    user('d1', { deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } }),
  ];
  await mount({ entry: '/_app/access/users/?status=deleted' });
  await screen.findByText('d1@x.com');
  expect(
    callsOf('access.users.list').some(
      (call) => (call.input as { status?: string } | null)?.status === 'deleted',
    ),
  ).toBe(true);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih d1@x.com' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).queryByRole('button', { name: 'Nonaktifkan' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() =>
    expect(callsOf('access.users.restoreBatch')[0]?.input).toEqual({ ids: ['d1'] }),
  );
});

test('Tambah pengguna membuka dialog bertab', async () => {
  await mount();
  await userEvent.click(
    screen.getAllByRole('button', { name: 'Tambah pengguna' })[0] as HTMLElement,
  );
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah pengguna' });
  expect(within(dialog).getByRole('tab', { name: 'Penugasan BU' })).toBeInTheDocument();
});

test('Ubah dari baris membuka dialog berisi email terkunci', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah u1@x.com' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByLabelText('Email')).toHaveValue('u1@x.com');
  expect(within(dialog).getByLabelText('Email')).toBeDisabled();
});
