import type { BusinessUnitDto } from '@shared/contract';
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

const unit = (id: string, patch: Partial<BusinessUnitDto> = {}): BusinessUnitDto => ({
  id,
  code: id.toUpperCase(),
  name: `BU ${id}`,
  status: 'inactive',
  itemCount: 0,
  userCount: 0,
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
  ...patch,
});

let live: BusinessUnitDto[] = [];
let deletedRows: BusinessUnitDto[] = [];
let calls: { id: string; input: unknown }[] = [];

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  calls = [];
  live = [unit('a'), unit('b')];
  deletedRows = [];
  apiMock.mockImplementation(async (id: string, input: { ids?: string[]; status?: string }) => {
    calls.push({ id, input });
    switch (id) {
      case 'access.businessUnits.list':
        return input?.status === 'deleted' ? deletedRows : live;
      case 'access.businessUnits.setStatus':
        return unit((input as unknown as { id: string }).id, { status: input.status as 'active' });
      case 'access.businessUnits.setStatusBatch':
        return {
          items: (input.ids ?? []).map((buId) =>
            unit(buId, { status: input.status as 'active' | 'inactive' }),
          ),
        };
      case 'access.businessUnits.removeBatch':
        return { ids: input.ids };
      case 'access.businessUnits.restoreBatch':
        return { items: (input.ids ?? []).map((buId) => unit(buId)) };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount({ manage = true, entry = '/_app/access/business-units/' } = {}) {
  const result = await mountRoute({
    route: Route,
    routePath: '/_app/access/business-units/',
    entry,
    me: makeMe({ permissions: { access: manage ? 'manage' : 'view' } }),
  });
  await screen.findByRole('table', { name: 'Daftar Business Unit' });
  return result;
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('kode menaut ke View BU', async () => {
  await mount();
  expect(await screen.findByRole('link', { name: 'A' })).toHaveAttribute(
    'href',
    '/access/business-units/a',
  );
});

test('Hapus massal: konfirmasi menyebut pemakaian, lalu access.businessUnits.removeBatch', async () => {
  live = [unit('a', { itemCount: 12, userCount: 3 }), unit('b')];
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 2 BU?' });
  expect(dialog).toHaveTextContent('Dipakai 12 item, 3 pengguna');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('access.businessUnits.removeBatch')).toHaveLength(1));
  expect(callsOf('access.businessUnits.removeBatch')[0]?.input).toEqual({ ids: ['a', 'b'] });
});

test('menonaktifkan BU yang masih dipakai dari baris meminta konfirmasi dengan jumlah item dan user', async () => {
  live = [unit('a', { status: 'active', itemCount: 12, userCount: 3 })];
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan BU a' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Nonaktifkan BU BU a?' });
  expect(dialog).toHaveTextContent('12 item');
  expect(dialog).toHaveTextContent('3 user');
  expect(callsOf('access.businessUnits.setStatus')).toHaveLength(0);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Nonaktifkan' }));
  await waitFor(() => expect(callsOf('access.businessUnits.setStatus')).toHaveLength(1));
});

test('membatalkan konfirmasi nonaktifkan tidak mengubah status', async () => {
  live = [unit('a', { status: 'active', itemCount: 1 })];
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan BU a' }));
  await userEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Batal' }),
  );
  expect(callsOf('access.businessUnits.setStatus')).toHaveLength(0);
});

test('BU yang tidak dipakai langsung dinonaktifkan tanpa konfirmasi', async () => {
  live = [unit('a', { status: 'active' })];
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan BU a' }));
  await waitFor(() => expect(callsOf('access.businessUnits.setStatus')).toHaveLength(1));
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

test('Nonaktifkan massal atas BU yang dipakai meminta konfirmasi lalu memanggil setStatusBatch', async () => {
  live = [
    unit('a', { status: 'active', itemCount: 2 }),
    unit('b', { status: 'active', userCount: 1 }),
  ];
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  await userEvent.click(within(bar).getByRole('button', { name: 'Nonaktifkan' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Nonaktifkan 2 BU?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Nonaktifkan' }));
  await waitFor(() => expect(callsOf('access.businessUnits.setStatusBatch')).toHaveLength(1));
  expect(callsOf('access.businessUnits.setStatusBatch')[0]?.input).toEqual({
    ids: ['a', 'b'],
    status: 'inactive',
  });
});

test('tanpa hak manage: tanpa checkbox maupun opsi Terhapus', async () => {
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

test('tampilan Terhapus: bar massal hanya Pulihkan', async () => {
  deletedRows = [
    unit('d1', {
      deleted: true,
      deletedInfo: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
    }),
  ];
  await mount({ entry: '/_app/access/business-units/?status=deleted' });
  await screen.findByText('d1'.toUpperCase());
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih BU d1' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).queryByRole('button', { name: 'Nonaktifkan' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() =>
    expect(callsOf('access.businessUnits.restoreBatch')[0]?.input).toEqual({ ids: ['d1'] }),
  );
});

test('Tambah BU membuka dialog', async () => {
  await mount();
  await userEvent.click(screen.getAllByRole('button', { name: 'Tambah BU' })[0] as HTMLElement);
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah BU' });
  expect(within(dialog).getByLabelText('Kode')).toBeInTheDocument();
});
