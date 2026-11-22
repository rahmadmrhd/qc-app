import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentType, Suspense } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { makeHandover } from '@/modules/handover/components/test-handover';
import { boardColumnData, boardColumnKey } from '@/modules/handover/lib/board-cache';
import { clickMoreAction } from '@/test/more-actions';

const state = vi.hoisted(() => ({
  me: null as unknown as MeDto,
  selected: ['loc-a'] as string[],
  api: vi.fn(),
  navigate: vi.fn(),
  routerNavigate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => state.me }));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ selectedIds: state.selected }),
}));
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual<object>('@/lib/api')),
  api: (...args: unknown[]) => state.api(...args),
}));
// Panel aktivitas di luar cakupan tes ini (seed papan dan galat muat); ia punya tesnya sendiri.
vi.mock('@/modules/activity/components/activity-log', () => ({ ActivityLog: () => null }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));
vi.mock('sonner', () => ({ toast: { success: state.toastSuccess, error: state.toastError } }));
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<object>('@tanstack/react-router')),
  useNavigate: () => state.navigate,
  useRouter: () => ({ navigate: state.routerNavigate }),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

import { Route } from './index';

const none = { handover: 'none', qc: 'none', stock: 'none', stickerstock: 'none' } as const;
function me(): MeDto {
  return {
    email: 'u@qc.local',
    name: 'U',
    isSuperAdmin: false,
    sharedAccount: false,
    canManageSerialSettings: false,
    permissions: {
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
      serial: 'none',
      serialservice: 'none',
      countrylock: 'none',
    },
    businessUnits: [],
    locations: [
      { id: 'loc-a', code: 'A', name: 'Lokasi A', permissions: { ...none, handover: 'view' } },
      { id: 'loc-b', code: 'B', name: 'Lokasi B', permissions: { ...none, handover: 'view' } },
      // Hanya stok: lokasi ada di `me`, tetapi task tidak boleh dibaca.
      { id: 'loc-s', code: 'S', name: 'Lokasi S', permissions: { ...none, stock: 'view' } },
    ],
  } as MeDto;
}

async function mount(search: { loc?: string }, prepare?: (client: QueryClient) => void) {
  vi.spyOn(Route, 'useParams').mockReturnValue({ handoverId: 'h1' } as never);
  vi.spyOn(Route, 'useSearch').mockReturnValue(search as never);
  const Component = Route.options.component as ComponentType & { preload?: () => Promise<void> };
  await Component.preload?.();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  prepare?.(client);
  render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>memuat</p>}>
        <Component />
      </Suspense>
    </QueryClientProvider>,
  );
  return client;
}

const getCalls = () => state.api.mock.calls.filter(([id]) => id === 'handovers.get');

beforeEach(() => {
  state.api.mockReset();
  state.navigate.mockReset();
  state.routerNavigate.mockReset();
  state.toastSuccess.mockReset();
  state.toastError.mockReset();
  state.selected = ['loc-a'];
  state.me = me();
  state.api.mockImplementation(async (id: string, input: { locationIds: string[] }) => {
    if (id !== 'handovers.get') throw new Error(`tak terduga: ${id}`);
    return makeHandover({ id: 'h1', number: 'ST-B', locationId: input.locationIds[0] });
  });
});

test('tanpa loc: memuat dari lokasi yang terpilih di header', async () => {
  await mount({});
  await screen.findByText('ST-B');
  expect(state.api).toHaveBeenCalledWith('handovers.get', { id: 'h1', locationIds: ['loc-a'] });
});

test('loc dari notifikasi: memuat task dari lokasi itu walau tak terpilih di header', async () => {
  await mount({ loc: 'loc-b' });
  await screen.findByText('ST-B');
  expect(state.api).toHaveBeenCalledWith('handovers.get', { id: 'h1', locationIds: ['loc-b'] });
  expect(getCalls()).toHaveLength(1);
});

test('loc tanpa hak baca task (atau tak dikenal): tidak meminta ke server, tampil "tidak ditemukan"', async () => {
  await mount({ loc: 'loc-s' });
  expect(await screen.findByRole('alert')).toHaveTextContent('Task tidak ditemukan');
  await waitFor(() => expect(getCalls()).toHaveLength(0));
  state.api.mockClear();
  await mount({ loc: 'loc-tak-dikenal' });
  await waitFor(() =>
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Task tidak ditemukan'),
  );
  expect(getCalls()).toHaveLength(0);
});

// Data kartu di papan (cache) hanya data awal: jawaban server tetap otoritatif (Fase 3 Tahap B, review A-I1).
const seedBoard =
  (columnIds: string[], locationId: string, number = 'ST-SEED') =>
  (client: QueryClient) =>
    client.setQueryData(
      boardColumnKey(columnIds, 'new'),
      boardColumnData([makeHandover({ id: 'h1', number, locationId })]),
      { updatedAt: 1234 },
    );

for (const code of ['NOT_FOUND', 'FORBIDDEN'] as const) {
  test(`seed papan + ${code} dari server: tampil "tidak ditemukan", data papan tidak dipakai`, async () => {
    state.api.mockRejectedValue(new ApiError(code, 'ditolak', 'r1'));
    await mount({}, seedBoard(['loc-a'], 'loc-a'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Task tidak ditemukan');
    expect(screen.queryByText('ST-SEED')).toBeNull();
  });
}

test('seed papan + UNAVAILABLE: data papan tetap tampil', async () => {
  state.api.mockRejectedValue(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-'));
  await mount({}, seedBoard(['loc-a'], 'loc-a'));
  await screen.findByText('ST-SEED');
  await waitFor(() => expect(getCalls()).toHaveLength(1));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('ST-SEED')).toBeInTheDocument();
});

test('seed papan + sukses: data server menggantikan data papan', async () => {
  await mount({}, seedBoard(['loc-a'], 'loc-a'));
  await screen.findByText('ST-B');
  expect(screen.queryByText('ST-SEED')).toBeNull();
});

test('readable kosong: papan lokasi itu tidak menjadi seed dan tidak tampil', async () => {
  await mount({ loc: 'loc-s' }, seedBoard(['loc-s'], 'loc-s'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Task tidak ditemukan');
  expect(screen.queryByText('ST-SEED')).toBeNull();
  expect(getCalls()).toHaveLength(0);
});

test('task dari kolom lokasi lain (di luar lokasi yang dibuka): tidak di-seed', async () => {
  state.api.mockRejectedValue(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-'));
  await mount({ loc: 'loc-b' }, seedBoard(['loc-a'], 'loc-a'));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('ST-SEED')).toBeNull();
});

test('penolakan server dilatch: UNAVAILABLE sesudahnya tidak memunculkan lagi data yang ditolak; sukses memulihkan', async () => {
  state.api.mockRejectedValue(new ApiError('NOT_FOUND', 'ditolak', 'r1'));
  const client = await mount({}, seedBoard(['loc-a'], 'loc-a'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Task tidak ditemukan');
  const refetch = () =>
    act(() => client.refetchQueries({ queryKey: ['handovers', 'one', 'h1', ['loc-a']] }));

  state.api.mockRejectedValue(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-'));
  await refetch();
  expect(await screen.findByRole('alert')).toHaveTextContent('Task tidak ditemukan');
  expect(screen.queryByText('ST-SEED')).toBeNull();

  // Akses dipulihkan: sukses mengembalikan data server.
  state.api.mockResolvedValue(makeHandover({ id: 'h1', number: 'ST-BARU', locationId: 'loc-a' }));
  await refetch();
  await screen.findByText('ST-BARU');
  expect(screen.queryByRole('alert')).toBeNull();
});

function manager(): MeDto {
  const base = me();
  const [first, ...rest] = base.locations;
  return {
    ...base,
    locations: [
      {
        ...(first as MeDto['locations'][number]),
        permissions: { ...none, handover: 'manage', qc: 'edit' },
      },
      ...rest,
    ],
  };
}

test('Hapus dari View: handovers.remove, task keluar dari papan dan cache detail, kembali ke /handover + toast Dihapus', async () => {
  state.me = manager();
  state.api.mockImplementation(async (id: string, input: { locationIds?: string[] }) => {
    if (id === 'handovers.get') {
      return makeHandover({
        id: 'h1',
        number: 'ST-B',
        locationId: input.locationIds?.[0] ?? 'loc-a',
      });
    }
    if (id === 'handovers.remove') return { id: 'h1' };
    throw new Error(`tak terduga: ${id}`);
  });
  const board = boardColumnKey(['loc-a'], 'new');
  const client = await mount({}, (c) =>
    c.setQueryData(
      board,
      boardColumnData([makeHandover({ id: 'h1', number: 'ST-B', locationId: 'loc-a' })], {
        total: 1,
      }),
    ),
  );
  await screen.findByText('ST-B');
  await clickMoreAction('Hapus');
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith('handovers.remove', { id: 'h1', locationId: 'loc-a' }),
  );
  await waitFor(() =>
    expect(state.routerNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/handover', replace: true }),
    ),
  );
  expect(state.toastSuccess).toHaveBeenCalledWith(
    'Dihapus',
    expect.objectContaining({ action: expect.objectContaining({ label: 'Pulihkan' }) }),
  );
  const column = client.getQueryData<ReturnType<typeof boardColumnData>>(board);
  expect(column?.pages[0]?.items).toEqual([]);
  expect(column?.pages[0]?.total).toBe(0);
  expect(client.getQueryData(['handovers', 'one', 'h1', ['loc-a']])).toBeUndefined();
});

test('toast Dihapus: aksi Pulihkan memanggil handovers.restore dengan lokasi task', async () => {
  state.me = manager();
  state.api.mockImplementation(async (id: string) => {
    if (id === 'handovers.get')
      return makeHandover({ id: 'h1', number: 'ST-B', locationId: 'loc-a' });
    if (id === 'handovers.remove') return { id: 'h1' };
    if (id === 'handovers.restore') return makeHandover({ id: 'h1', locationId: 'loc-a' });
    throw new Error(`tak terduga: ${id}`);
  });
  await mount({});
  await screen.findByText('ST-B');
  await clickMoreAction('Hapus');
  await userEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hapus' }),
  );
  await waitFor(() => expect(state.toastSuccess).toHaveBeenCalled());
  const options = state.toastSuccess.mock.calls[0]?.[1] as { action: { onClick: () => void } };
  options.action.onClick();
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith('handovers.restore', { id: 'h1', locationId: 'loc-a' }),
  );
});

test('tanpa handover:manage tidak ada Hapus', async () => {
  await mount({});
  await screen.findByText('ST-B');
  expect(screen.queryByRole('button', { name: 'Hapus' })).not.toBeInTheDocument();
});

test('task terhapus (manage): banner + Pulihkan memanggil handovers.restore', async () => {
  state.me = manager();
  state.api.mockImplementation(async (id: string) => {
    if (id === 'handovers.get') {
      return makeHandover({
        id: 'h1',
        number: 'ST-B',
        locationId: 'loc-a',
        deleted: { deletedAt: '2026-11-20T01:00:00.000Z', deletedBy: 'adm@qc.local' },
      });
    }
    if (id === 'handovers.restore')
      return makeHandover({ id: 'h1', number: 'ST-B', locationId: 'loc-a' });
    throw new Error(`tak terduga: ${id}`);
  });
  await mount({});
  expect(await screen.findByText('Data ini sudah dihapus')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Pulihkan' })[0] as HTMLElement);
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith('handovers.restore', { id: 'h1', locationId: 'loc-a' }),
  );
  await waitFor(() => expect(screen.queryByText('Data ini sudah dihapus')).not.toBeInTheDocument());
});

test('ganti tab View mengganti entri riwayat (replace) dan menulis search param tab', async () => {
  await mount({});
  await screen.findByText('ST-B');
  await userEvent.click(screen.getByRole('tab', { name: 'Riwayat' }));
  expect(state.navigate).toHaveBeenCalledWith({
    to: '/handover/$handoverId',
    params: { handoverId: 'h1' },
    search: { tab: 'riwayat' },
    replace: true,
  });
});

test('Ubah membuka form ubah dengan push (bukan replace) membawa filter papan', async () => {
  state.me = manager();
  await mount({ status: 'done', deleted: true } as never);
  await screen.findByText('ST-B');
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  await waitFor(() =>
    expect(state.routerNavigate).toHaveBeenCalledWith({
      to: '/handover/$handoverId/edit',
      params: { handoverId: 'h1' },
      search: { status: 'done', deleted: true },
      replace: false,
    }),
  );
});
