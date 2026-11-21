import type { RoleDto } from '@shared/contract';
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

const role = (id: string, patch: Partial<RoleDto> = {}): RoleDto => ({
  id,
  name: `Role ${id}`,
  description: '',
  permissions: {},
  userCount: 0,
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
  ...patch,
});

let live: RoleDto[] = [];
let deletedRows: RoleDto[] = [];
let calls: { id: string; input: unknown }[] = [];

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  calls = [];
  live = [role('a'), role('b')];
  deletedRows = [];
  apiMock.mockImplementation(async (id: string, input: { ids?: string[] }) => {
    calls.push({ id, input });
    switch (id) {
      case 'access.roles.list':
        return (input as { status?: string } | null)?.status === 'deleted' ? deletedRows : live;
      case 'access.roles.removeBatch':
        return { ids: input.ids };
      case 'access.roles.restoreBatch':
        return { items: (input.ids ?? []).map((roleId) => role(roleId)) };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount({ manage = true, entry = '/_app/access/roles/' } = {}) {
  const result = await mountRoute({
    route: Route,
    routePath: '/_app/access/roles/',
    entry,
    me: makeMe({ permissions: { access: manage ? 'manage' : 'view' } }),
  });
  await screen.findByRole('table', { name: 'Daftar role' });
  return result;
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('nama role menaut ke View; daftar role tanpa kolom status', async () => {
  await mount();
  expect(await screen.findByRole('link', { name: 'Role a' })).toHaveAttribute(
    'href',
    '/access/roles/a',
  );
  expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
});

test('Hapus massal memanggil access.roles.removeBatch; dinonaktifkan bila ada role yang dipakai', async () => {
  live = [role('a'), role('b', { userCount: 2 })];
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih Role a' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 1 role?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() =>
    expect(callsOf('access.roles.removeBatch')[0]?.input).toEqual({ ids: ['a'] }),
  );
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Role b' }));
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeDisabled();
});

test('filter tampilan hanya untuk manage; Terhapus memuat daftar terhapus dan bar hanya Pulihkan', async () => {
  deletedRows = [
    role('d1', { deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } }),
  ];
  await mount({ entry: '/_app/access/roles/?status=deleted' });
  await screen.findByText('Role d1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Role d1' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).queryByRole('button', { name: 'Hapus' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() =>
    expect(callsOf('access.roles.restoreBatch')[0]?.input).toEqual({ ids: ['d1'] }),
  );
});

test('tanpa manage: tanpa checkbox dan tanpa filter tampilan Terhapus', async () => {
  await mount({ manage: false });
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Tampilan' })).toBeNull();
});

test('Tambah role membuka dialog role', async () => {
  await mount();
  await userEvent.click(screen.getAllByRole('button', { name: 'Tambah role' })[0] as HTMLElement);
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah role' });
  expect(within(dialog).getByLabelText('Nama role')).toBeInTheDocument();
});
