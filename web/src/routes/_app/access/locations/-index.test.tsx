import type { LocationDto } from '@shared/contract';
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

const location = (id: string, patch: Partial<LocationDto> = {}): LocationDto => ({
  id,
  code: id.toUpperCase(),
  name: `Lokasi ${id}`,
  status: 'inactive',
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
  ...patch,
});

let live: LocationDto[] = [];
let deletedRows: LocationDto[] = [];
let calls: { id: string; input: unknown }[] = [];

beforeEach(() => {
  apiMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  calls = [];
  live = [location('a'), location('b')];
  deletedRows = [];
  apiMock.mockImplementation(async (id: string, input: { ids?: string[]; status?: string }) => {
    calls.push({ id, input });
    switch (id) {
      case 'access.locations.list':
        return input?.status === 'deleted' ? deletedRows : live;
      case 'access.locations.setStatusBatch':
        return {
          items: (input.ids ?? []).map((locId) =>
            location(locId, { status: input.status as 'active' | 'inactive' }),
          ),
        };
      case 'access.locations.removeBatch':
        return { ids: input.ids };
      case 'access.locations.restoreBatch':
        return { items: (input.ids ?? []).map((locId) => location(locId)) };
      default:
        throw new Error(`api tak terduga: ${id}`);
    }
  });
});

async function mount({ manage = true, entry = '/_app/access/locations/' } = {}) {
  const result = await mountRoute({
    route: Route,
    routePath: '/_app/access/locations/',
    entry,
    me: makeMe({ permissions: { access: manage ? 'manage' : 'view' } }),
  });
  await screen.findByRole('table', { name: 'Daftar lokasi' });
  return result;
}

const callsOf = (id: string) => calls.filter((call) => call.id === id);

test('kode menaut ke View lokasi', async () => {
  await mount();
  expect(await screen.findByRole('link', { name: 'A' })).toHaveAttribute(
    'href',
    '/access/locations/a',
  );
});

test('pilih dua lokasi: Aktifkan memanggil access.locations.setStatusBatch dengan dua id', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih Lokasi a' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Lokasi b' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  await userEvent.click(within(bar).getByRole('button', { name: 'Aktifkan' }));
  await waitFor(() => expect(callsOf('access.locations.setStatusBatch')).toHaveLength(1));
  expect(callsOf('access.locations.setStatusBatch')[0]?.input).toEqual({
    ids: ['a', 'b'],
    status: 'active',
  });
});

test('Hapus massal: konfirmasi lalu access.locations.removeBatch; nonaktif bila ada lokasi Aktif', async () => {
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus 2 lokasi?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('access.locations.removeBatch')).toHaveLength(1));
  expect(callsOf('access.locations.removeBatch')[0]?.input).toEqual({ ids: ['a', 'b'] });
});

test('Hapus massal nonaktif dengan alasan bila ada lokasi Aktif yang terpilih', async () => {
  live = [location('a', { status: 'active' }), location('b')];
  await mount();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeDisabled();
  expect(screen.getByText('Nonaktifkan lokasi dulu sebelum dihapus')).toBeInTheDocument();
});

test('tanpa hak manage: tanpa checkbox dan tanpa opsi Terhapus', async () => {
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
    location('d1', { deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' } }),
  ];
  await mount({ entry: '/_app/access/locations/?status=deleted' });
  await screen.findByText('Lokasi d1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih Lokasi d1' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).queryByRole('button', { name: 'Nonaktifkan' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() =>
    expect(callsOf('access.locations.restoreBatch')[0]?.input).toEqual({ ids: ['d1'] }),
  );
});

test('Tambah lokasi membuka dialog; Ubah dari baris mengisi kode terkunci', async () => {
  await mount();
  await userEvent.click(screen.getAllByRole('button', { name: 'Tambah lokasi' })[0] as HTMLElement);
  const add = await screen.findByRole('alertdialog', { name: 'Tambah lokasi' });
  expect(within(add).getByLabelText('Kode')).toBeEnabled();
  await userEvent.click(within(add).getByRole('button', { name: 'Batal' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah Lokasi a' }));
  const edit = await screen.findByRole('alertdialog');
  expect(within(edit).getByLabelText('Kode')).toHaveValue('A');
  expect(within(edit).getByLabelText('Kode')).toBeDisabled();
});
