import type { HandoverDto, MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  me: null as unknown as MeDto,
  selected: ['loc-a'] as string[],
  api: vi.fn(),
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => state.me }));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ selectedIds: state.selected }),
}));
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => state.api(...args) }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ApiError } from '@/lib/api/api-error';
import { resetOutboxEnv } from '@/test/outbox-env';
import { enqueueOutbox } from '../lib/outbox';
import { HandoverBoardPage } from './handover-board-page';
import { makeHandover } from './test-handover';

function me(locPerms: Record<string, string>): MeDto {
  return {
    email: 'u@qc.local',
    name: 'U',
    isSuperAdmin: false,
    permissions: {
      access: 'none',
      item: 'none',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
      sticker: 'none',
      stickerstock: 'none',
    },
    locations: [
      {
        id: 'loc-a',
        code: 'A',
        name: 'Lokasi A',
        permissions: {
          handover: 'none',
          qc: 'none',
          stock: 'none',
          stickerstock: 'none',
          ...locPerms,
        },
      },
    ],
  } as MeDto;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const handlers = {
    onOpen: vi.fn(),
    onEdit: vi.fn(),
    onCreate: vi.fn(),
    onStatusChange: vi.fn(),
  };
  render(
    <QueryClientProvider client={client}>
      <HandoverBoardPage status="all" {...handlers} />
    </QueryClientProvider>,
  );
  return handlers;
}

type BoardInput = { status?: string; locationIds?: string[]; id?: string };

/** Jawaban `handovers.board` per kolom (kontrak API: berkursor, dengan total). */
function pageOf(tasks: HandoverDto[], input: BoardInput) {
  const items = tasks.filter((task) => task.status === input.status);
  return { items, nextCursor: null, total: items.length };
}

beforeEach(() => {
  resetOutboxEnv();
  state.api.mockReset();
  state.selected = ['loc-a'];
  state.me = me({ handover: 'manage', qc: 'edit' });
});

test('board memuat satu permintaan berkursor per kolom (4), bukan get per kartu', async () => {
  const list = [
    makeHandover({ id: '1', number: 'ST-1' }),
    makeHandover({ id: '2', number: 'ST-2' }),
    makeHandover({ id: '3', number: 'ST-3' }),
  ];
  state.api.mockImplementation(async (_method: string, input: BoardInput) => pageOf(list, input));
  renderPage();
  await screen.findByText('ST-3');
  expect(state.api).toHaveBeenCalledTimes(4);
  for (const status of ['new', 'in_progress', 'done', 'cancelled']) {
    expect(state.api).toHaveBeenCalledWith('handovers.board', { locationIds: ['loc-a'], status });
  }
});

test('mencentang memindahkan kartu ke kolom yang sesuai tanpa memuat ulang', async () => {
  const task = makeHandover({ id: '1', number: 'ST-1' });
  const checked: HandoverDto = {
    ...task,
    status: 'in_progress',
    checklist: [
      { index: 0, text: 'A = 1', checked: true, by: 'u@qc.local', at: '2026-10-15T03:00:00.000Z' },
      task.checklist[1] as HandoverDto['checklist'][number],
    ],
  };
  state.api.mockImplementation(async (method: string, input: BoardInput) =>
    method === 'handovers.board' ? pageOf([task], input) : checked,
  );
  renderPage();
  await screen.findByText('ST-1');
  expect(
    within(screen.getByRole('region', { name: 'Kolom Baru' })).getByText('ST-1'),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: /A = 1/ }));
  await waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: 'Kolom Dikerjakan' })).getByText('ST-1'),
    ).toBeInTheDocument(),
  );
  expect(state.api).toHaveBeenCalledWith('handovers.setCheck', {
    id: '1',
    locationId: 'loc-a',
    index: 0,
    text: 'A = 1',
    checked: true,
  });
  // papan tidak dimuat ulang setelah centang: hanya empat muatan awal (satu per kolom) + satu setCheck
  expect(state.api.mock.calls.filter(([m]) => m === 'handovers.board')).toHaveLength(4);
});

test('Mark done mengirim setDone dan memindahkan kartu ke Selesai', async () => {
  const task = makeHandover({ id: '1', number: 'ST-1' });
  state.api.mockImplementation(async (method: string, input: BoardInput) =>
    method === 'handovers.board' ? pageOf([task], input) : { ...task, status: 'done' },
  );
  renderPage();
  await screen.findByText('ST-1');
  await userEvent.click(screen.getByRole('button', { name: 'Mark done' }));
  await waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: 'Kolom Selesai' })).getByText('ST-1'),
    ).toBeInTheDocument(),
  );
  expect(state.api).toHaveBeenCalledWith('handovers.setDone', {
    id: '1',
    locationId: 'loc-a',
  });
});

test('centang instan: langsung tercentang dengan penanda Menyimpan; checkbox lain dan kartu lain tetap aktif', async () => {
  const one = makeHandover({ id: '1', number: 'ST-1' });
  const two = makeHandover({ id: '2', number: 'ST-2' });
  let release: (value: HandoverDto) => void = () => undefined;
  state.api.mockImplementation((method: string, input: BoardInput) => {
    if (method === 'handovers.board') return Promise.resolve(pageOf([one, two], input));
    if (input.id === '1') {
      return new Promise<HandoverDto>((resolve) => {
        release = resolve;
      });
    }
    return Promise.resolve(two);
  });
  renderPage();
  await screen.findByText('ST-1');
  const cardTwo = screen.getByRole('article', { name: 'Task ST-2' });
  await userEvent.click(
    within(screen.getByRole('article', { name: 'Task ST-1' })).getAllByRole(
      'checkbox',
    )[0] as HTMLElement,
  );
  // kartu tetap di kolom sampai server menjawab (tidak melompat di tengah rentetan klik)
  const cardOne = screen.getByRole('article', { name: 'Task ST-1' });
  expect(
    within(screen.getByRole('region', { name: 'Kolom Baru' })).getByText('ST-1'),
  ).toBeInTheDocument();
  // respons server belum datang, tetapi tampilan sudah berubah dan checkbox tidak dinonaktifkan
  expect(within(cardOne).getAllByRole('checkbox')[0]).toBeChecked();
  expect(within(cardOne).getAllByRole('checkbox')[1]).toBeEnabled();
  expect(within(cardOne).getByRole('status')).toHaveTextContent('Menyimpan');
  expect(within(cardTwo).getAllByRole('checkbox')[0]).toBeEnabled();
  release({
    ...one,
    status: 'in_progress',
    checklist: [
      { index: 0, text: 'A = 1', checked: true, by: 'u@qc.local', at: '2026-10-15T03:00:00.000Z' },
      one.checklist[1] as HandoverDto['checklist'][number],
    ],
  });
  await waitFor(() =>
    expect(
      within(screen.getByRole('article', { name: 'Task ST-1' })).queryByRole('status'),
    ).not.toBeInTheDocument(),
  );
  expect(
    within(screen.getByRole('article', { name: 'Task ST-1' })).getAllByRole('checkbox')[0],
  ).toBeChecked();
});

test('Dibatalkan: Buka kembali mengirim handovers.reopen', async () => {
  const task = makeHandover({ id: '1', number: 'ST-1', status: 'cancelled' });
  state.api.mockImplementation(async (method: string, input: BoardInput) =>
    method === 'handovers.board' ? pageOf([task], input) : { ...task, status: 'new' },
  );
  renderPage();
  await screen.findByText('ST-1');
  await userEvent.click(screen.getByRole('button', { name: 'Buka kembali' }));
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith('handovers.reopen', { id: '1', locationId: 'loc-a' }),
  );
});

test('komentar dikirim dari kartu tanpa membuka detail (komentar umum)', async () => {
  const task = makeHandover({ id: '1', number: 'ST-1' });
  const commented = {
    ...task,
    comments: [
      {
        id: 'c',
        quote: '',
        before: '',
        after: '',
        body: 'Halo',
        author: 'u@qc.local',
        at: '2026-10-15T03:00:00.000Z',
        stale: false,
      },
    ],
  };
  state.api.mockImplementation(async (method: string, input: BoardInput) =>
    method === 'handovers.board' ? pageOf([task], input) : commented,
  );
  const handlers = renderPage();
  await screen.findByText('ST-1');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah komentar' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'Halo');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith('handovers.comment', {
      id: '1',
      locationId: 'loc-a',
      quote: '',
      before: '',
      after: '',
      body: 'Halo',
      // Kunci idempoten dibuat sebelum percobaan kirim pertama (antrean offline memakainya ulang).
      clientId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      ),
    }),
  );
  expect(handlers.onOpen).not.toHaveBeenCalled();
  await screen.findByText('Halo');
});

test('pengguna yang hanya QC tidak melihat More dan tombol Tambah task', async () => {
  state.me = me({ qc: 'edit' });
  const only = [makeHandover({ id: '1', number: 'ST-1' })];
  state.api.mockImplementation(async (_method: string, input: BoardInput) => pageOf(only, input));
  renderPage();
  await screen.findByText('ST-1');
  expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tambah task' })).not.toBeInTheDocument();
});

test('belum memilih lokasi, kosong, dan galat punya tampilan jelas', async () => {
  state.selected = [];
  const first = renderPage();
  expect(screen.getByText(/Pilih lokasi di header/)).toBeInTheDocument();
  expect(state.api).not.toHaveBeenCalled();
  expect(first.onCreate).not.toHaveBeenCalled();
  document.body.innerHTML = '';

  state.selected = ['loc-a'];
  state.api.mockImplementation(async (_method: string, input: BoardInput) => pageOf([], input));
  renderPage();
  expect(await screen.findByText(/Belum ada task/)).toBeInTheDocument();
  document.body.innerHTML = '';

  state.api.mockRejectedValue(new Error('x'));
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat task');
});

test('judul kolom memakai total server; "Muat lebih banyak" memuat halaman berikutnya dengan kursor', async () => {
  const first = makeHandover({ id: '1', number: 'ST-1' });
  const second = makeHandover({ id: '2', number: 'ST-2' });
  state.api.mockImplementation(async (_method: string, input: BoardInput & { cursor?: string }) => {
    if (input.status !== 'new') return { items: [], nextCursor: null, total: 0 };
    return input.cursor === 'c1'
      ? { items: [second], nextCursor: null, total: 2 }
      : { items: [first], nextCursor: 'c1', total: 2 };
  });
  renderPage();
  await screen.findByText('ST-1');
  const column = screen.getByRole('region', { name: 'Kolom Baru' });
  expect(within(column).getByRole('heading')).toHaveTextContent('Baru (2)');
  expect(within(column).queryByText('ST-2')).not.toBeInTheDocument();
  await userEvent.click(within(column).getByRole('button', { name: 'Muat lebih banyak' }));
  await within(column).findByText('ST-2');
  expect(state.api).toHaveBeenCalledWith('handovers.board', {
    locationIds: ['loc-a'],
    status: 'new',
    cursor: 'c1',
  });
  expect(within(column).queryByRole('button', { name: 'Muat lebih banyak' })).toBeNull();
});

test('locationId dari URL (notifikasi): papan memuat lokasi itu, bukan pilihan header; lokasi tanpa hak tidak diminta', async () => {
  const base = me({ handover: 'view' });
  const loc = base.locations[0] as MeDto['locations'][number];
  state.me = {
    ...base,
    locations: [
      loc,
      { ...loc, id: 'loc-b', code: 'B', name: 'Lokasi B' },
      {
        ...loc,
        id: 'loc-s',
        code: 'S',
        name: 'Lokasi S',
        permissions: { ...loc.permissions, handover: 'none' },
      },
    ],
  };
  state.api.mockImplementation(async (_method: string, input: BoardInput) => pageOf([], input));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <HandoverBoardPage
        status="all"
        locationId="loc-b"
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onStatusChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith('handovers.board', {
      locationIds: ['loc-b'],
      status: 'new',
    }),
  );
  expect(state.api).not.toHaveBeenCalledWith(
    'handovers.board',
    expect.objectContaining({ locationIds: ['loc-a'] }),
  );
  view.unmount();
  state.api.mockClear();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <HandoverBoardPage
        status="all"
        locationId="loc-s"
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onStatusChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(state.api).not.toHaveBeenCalled();
});

test('akun tanpa penugasan lokasi melihat peringatan penugasan lokasi; yang punya lokasi tidak', async () => {
  state.api.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  state.me = { ...me({}), locations: [] };
  state.selected = [];
  renderPage();
  expect(await screen.findByText(/belum ditugaskan ke lokasi mana pun/)).toBeInTheDocument();
});

test('akun dengan lokasi tidak melihat peringatan penugasan lokasi', async () => {
  state.api.mockImplementation(async (_method: string, input: BoardInput) => pageOf([], input));
  renderPage();
  await screen.findByText('Serah Terima');
  expect(screen.queryByText(/belum ditugaskan ke lokasi mana pun/)).toBeNull();
});

test('komentar saat server tidak terjangkau: diantrekan, komposer tertutup, tampil "Belum terkirim" di kartu', async () => {
  const task = makeHandover({ id: '1', number: 'ST-1' });
  state.api.mockImplementation(async (method: string, input: BoardInput) => {
    if (method === 'handovers.board') return pageOf([task], input);
    throw new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-');
  });
  renderPage();
  await screen.findByText('ST-1');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah komentar' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'Halo offline');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));
  expect(await screen.findByText('Belum terkirim')).toBeInTheDocument();
  // Komposer menutup sesudah pengiriman selesai (entri antre tampil lebih dulu): tunggu, lalu hanya satu salinan teks.
  await waitFor(() =>
    expect(screen.queryByRole('textbox', { name: 'Komentar' })).not.toBeInTheDocument(),
  );
  expect(screen.getByText('Halo offline')).toBeInTheDocument();
  const comments = state.api.mock.calls.filter((call) => call[0] === 'handovers.comment');
  expect(comments).toHaveLength(1);
});

test('task baru di antrean perangkat: kartu sementara hanya untuk lokasi terpilih; papan kosong tetap tampil', async () => {
  state.api.mockImplementation(async (_method: string, input: BoardInput) => pageOf([], input));
  const base = {
    kind: 'create' as const,
    tasks: [
      { clientId: '11111111-1111-4111-8111-111111111111', customerName: 'PT Antre', note: 'x' },
    ],
    at: Date.now(),
  };
  await enqueueOutbox('u@qc.local', { ...base, locationId: 'loc-a' });
  await enqueueOutbox('u@qc.local', {
    ...base,
    tasks: [
      { clientId: '22222222-2222-4222-8222-222222222222', customerName: 'PT Lain', note: 'x' },
    ],
    locationId: 'loc-b',
  });
  renderPage();
  expect(await screen.findByText('PT Antre')).toBeInTheDocument();
  expect(screen.queryByText('PT Lain')).not.toBeInTheDocument();
  expect(screen.queryByText('Belum ada task serah terima di lokasi ini.')).not.toBeInTheDocument();
  expect(screen.getByText('Belum terkirim')).toBeInTheDocument();
});

test('customerId: permintaan tiap kolom membawa customerId, chip filter tampil dan dapat dihapus', async () => {
  const list = [
    makeHandover({ id: '1', number: 'ST-1', customerId: 'c9', customerName: 'PT Budi' }),
  ];
  state.api.mockImplementation(async (_method: string, input: BoardInput) => pageOf(list, input));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClearCustomer = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <HandoverBoardPage
        status="all"
        customerId="c9"
        onClearCustomer={onClearCustomer}
        onOpen={vi.fn()}
        onEdit={vi.fn()}
        onCreate={vi.fn()}
        onStatusChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await screen.findByText('ST-1');
  for (const status of ['new', 'in_progress', 'done', 'cancelled']) {
    expect(state.api).toHaveBeenCalledWith('handovers.board', {
      locationIds: ['loc-a'],
      status,
      customerId: 'c9',
    });
  }
  expect(screen.getByRole('button', { name: /Customer: PT Budi/ })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus filter Customer' }));
  expect(onClearCustomer).toHaveBeenCalledTimes(1);
});
