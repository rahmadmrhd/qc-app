import type { HandoverDto, MeDto } from '@shared/rpc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  me: null as unknown as MeDto,
  selected: ['loc-a'] as string[],
  rpc: vi.fn(),
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => state.me }));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ selectedIds: state.selected }),
}));
vi.mock('@/lib/rpc', () => ({ rpc: (...args: unknown[]) => state.rpc(...args) }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
    },
    locations: [
      {
        id: 'loc-a',
        code: 'A',
        name: 'Lokasi A',
        permissions: { handover: 'none', qc: 'none', stock: 'none', ...locPerms },
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

beforeEach(() => {
  state.rpc.mockReset();
  state.selected = ['loc-a'];
  state.me = me({ handover: 'manage', qc: 'edit' });
});

test('board memuat satu RPC untuk satu lokasi (bukan get per kartu)', async () => {
  state.rpc.mockResolvedValue([
    makeHandover({ id: '1', number: 'ST-1' }),
    makeHandover({ id: '2', number: 'ST-2' }),
    makeHandover({ id: '3', number: 'ST-3' }),
  ]);
  renderPage();
  await screen.findByText('ST-3');
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(state.rpc).toHaveBeenCalledWith('handovers.board', { locationIds: ['loc-a'] });
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
  state.rpc.mockImplementation(async (method: string) =>
    method === 'handovers.board' ? [task] : checked,
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
  expect(state.rpc).toHaveBeenCalledWith('handovers.setCheck', {
    id: '1',
    locationId: 'loc-a',
    index: 0,
    text: 'A = 1',
    checked: true,
  });
  // papan tidak dimuat ulang setelah centang: satu board + satu setCheck
  expect(state.rpc.mock.calls.filter(([m]) => m === 'handovers.board')).toHaveLength(1);
});

test('Mark done mengirim setDone dan memindahkan kartu ke Selesai', async () => {
  const task = makeHandover({ id: '1', number: 'ST-1' });
  state.rpc.mockImplementation(async (method: string) =>
    method === 'handovers.board' ? [task] : { ...task, status: 'done' },
  );
  renderPage();
  await screen.findByText('ST-1');
  await userEvent.click(screen.getByRole('button', { name: 'Mark done' }));
  await waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: 'Kolom Selesai' })).getByText('ST-1'),
    ).toBeInTheDocument(),
  );
  expect(state.rpc).toHaveBeenCalledWith('handovers.setDone', {
    id: '1',
    locationId: 'loc-a',
  });
});

test('pending per task: kartu lain tetap bisa dicentang saat satu task diproses', async () => {
  const one = makeHandover({ id: '1', number: 'ST-1' });
  const two = makeHandover({ id: '2', number: 'ST-2' });
  let release: (value: HandoverDto) => void = () => undefined;
  state.rpc.mockImplementation((method: string, input: { id?: string }) => {
    if (method === 'handovers.board') return Promise.resolve([one, two]);
    if (input.id === '1') {
      return new Promise<HandoverDto>((resolve) => {
        release = resolve;
      });
    }
    return Promise.resolve(two);
  });
  renderPage();
  await screen.findByText('ST-1');
  const cardOne = screen.getByRole('article', { name: 'Task ST-1' });
  const cardTwo = screen.getByRole('article', { name: 'Task ST-2' });
  await userEvent.click(within(cardOne).getAllByRole('checkbox')[0] as HTMLElement);
  await waitFor(() => expect(within(cardOne).getAllByRole('checkbox')[0]).toBeDisabled());
  expect(within(cardOne).getByRole('button', { name: 'Mark done' })).toBeDisabled();
  expect(within(cardTwo).getAllByRole('checkbox')[0]).toBeEnabled();
  expect(within(cardTwo).getByRole('button', { name: 'Mark done' })).toBeEnabled();
  release(one);
});

test('Dibatalkan: Buka kembali mengirim handovers.reopen', async () => {
  const task = makeHandover({ id: '1', number: 'ST-1', status: 'cancelled' });
  state.rpc.mockImplementation(async (method: string) =>
    method === 'handovers.board' ? [task] : { ...task, status: 'new' },
  );
  renderPage();
  await screen.findByText('ST-1');
  await userEvent.click(screen.getByRole('button', { name: 'Buka kembali' }));
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith('handovers.reopen', { id: '1', locationId: 'loc-a' }),
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
  state.rpc.mockImplementation(async (method: string) =>
    method === 'handovers.board' ? [task] : commented,
  );
  const handlers = renderPage();
  await screen.findByText('ST-1');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah komentar' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Komentar' }), 'Halo');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim' }));
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith('handovers.comment', {
      id: '1',
      locationId: 'loc-a',
      quote: '',
      before: '',
      after: '',
      body: 'Halo',
    }),
  );
  expect(handlers.onOpen).not.toHaveBeenCalled();
  await screen.findByText('Halo');
});

test('pengguna yang hanya QC tidak melihat More dan tombol Tambah task', async () => {
  state.me = me({ qc: 'edit' });
  state.rpc.mockResolvedValue([makeHandover({ id: '1', number: 'ST-1' })]);
  renderPage();
  await screen.findByText('ST-1');
  expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tambah task' })).not.toBeInTheDocument();
});

test('belum memilih lokasi, kosong, dan galat punya tampilan jelas', async () => {
  state.selected = [];
  const first = renderPage();
  expect(screen.getByText(/Pilih lokasi di header/)).toBeInTheDocument();
  expect(state.rpc).not.toHaveBeenCalled();
  expect(first.onCreate).not.toHaveBeenCalled();
  document.body.innerHTML = '';

  state.selected = ['loc-a'];
  state.rpc.mockResolvedValue([]);
  renderPage();
  expect(await screen.findByText(/Belum ada task/)).toBeInTheDocument();
  document.body.innerHTML = '';

  state.rpc.mockRejectedValue(new Error('x'));
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat task');
});
