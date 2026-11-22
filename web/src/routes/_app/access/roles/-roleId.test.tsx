import type { RoleDto, UserDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { makeMe } from '@/test/make-me';
import { clickMoreAction } from '@/test/more-actions';
import { mountRoute } from '@/test/mount-route';
import { Route } from './$roleId';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: apiMock,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const base: RoleDto = {
  id: 'r1',
  name: 'QC Staff',
  description: 'Petugas QC',
  permissions: { item: 'view' },
  userCount: 0,
  createdAt: '',
  updatedAt: '2026-11-09T01:00:00.000Z',
  updatedBy: 'admin@x.com',
};
const member: UserDto = {
  id: 'u1',
  email: 'ani@x.com',
  name: 'Ani',
  status: 'active',
  assignments: [{ locationId: null, roleIds: ['r1'] }],
  buAssignments: [],
  sharedAccount: false,
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
};

let server: RoleDto | 'missing' = base;
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
      case 'access.roles.get':
        if (server === 'missing') throw new ApiError('NOT_FOUND', 'Role tidak ditemukan', 'req');
        return server;
      case 'access.users.list':
        return [member];
      case 'access.roles.removeBatch':
        return { ids: (input as { ids: string[] }).ids };
      case 'access.roles.restoreBatch':
        return { items: [base] };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount(entry = '/_app/access/roles/r1') {
  return mountRoute({
    route: Route,
    routePath: '/_app/access/roles/$roleId',
    entry,
    me: makeMe({ permissions: { access: 'manage' } }),
    others: [{ path: '/access/roles', label: 'Daftar role' }],
  });
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('tab Pengguna menampilkan pengguna pemakai role, bertaut ke View pengguna', async () => {
  await mount('/_app/access/roles/r1?tab=users');
  expect(await screen.findByRole('link', { name: 'ani@x.com' })).toHaveAttribute(
    'href',
    '/access/users/u1',
  );
});

test('Hapus dari View: kembali ke daftar role dengan toast "Dihapus"', async () => {
  const { router } = await mount();
  await screen.findByRole('button', { name: 'Aksi lainnya' });
  await clickMoreAction('Hapus');
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 role?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/access/roles'));
  expect(callsOf('access.roles.removeBatch')[0]?.input).toEqual({ ids: ['r1'] });
  expect(toast.success).toHaveBeenCalledWith(
    'Dihapus',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
  );
});

test('role tidak ditemukan (NOT_FOUND): pesan dan tombol kembali', async () => {
  server = 'missing';
  await mount();
  expect(await screen.findByRole('heading', { name: 'Role tidak ditemukan' })).toBeInTheDocument();
});
