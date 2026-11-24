import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { addSerials, type StagingRow } from '../lib/draft';
import { loadDraft, saveDraft } from '../lib/draft-store';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage, type RecordPageHandle } from './record-page';

type SavedRow = { clientId: string; serial: string; proofPhotoIds?: string[] };
let saveCalls: SavedRow[][] = [];
let respond: (row: SavedRow) => { result: string; message: string } = () => ({
  result: 'created',
  message: '',
});

const photo = (id: string) => ({
  id,
  mime: 'image/webp',
  size: 1,
  thumbUrl: `/api/v1/serial-proofs/${id}`,
});

function seedDraft(entries: { serial: string; photos: string[] }[]) {
  let n = 0;
  const rows: StagingRow[] = addSerials(
    [],
    entries.map((entry) => entry.serial).join('\n'),
    {
      itemId: 'i1',
      itemLabel: 'Cisco C9200',
      buId: 'b1',
      buLabel: 'BU1',
      testDate: '2026-11-12',
      locationId: 'l1',
      locationLabel: 'Jakarta (JKT)',
      sample: false,
      note: '',
      stickers: [],
    },
    () => `id-${String(++n).padStart(8, '0')}`,
    () => '2026-11-12T10:00:00.000Z',
  ).rows.map((row, index) => ({
    ...row,
    proofPhotos: (entries[index]?.photos ?? []).map(photo),
  }));
  saveDraft('a@gmail.com', rows);
}

beforeEach(() => {
  localStorage.clear();
  saveCalls = [];
  respond = () => ({ result: 'created', message: '' });
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.locationOptions') {
      return Promise.resolve({ locations: [{ id: 'l1', code: 'JKT', name: 'Jakarta' }] });
    }
    if (id === 'serials.itemOptions') return Promise.resolve({ items: [], nextCursor: null });
    if (id === 'serials.saveBatch') {
      const rows = input.rows as SavedRow[];
      saveCalls.push(rows);
      return Promise.resolve({
        results: rows.map((row) => ({ clientId: row.clientId, ...respond(row) })),
      });
    }
    if (id === 'serialProofs.remove') return Promise.resolve({ id: String(input.id) });
    if (id === 'serials.lookupMany') return Promise.resolve({ found: [] });
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
  me = {
    email: 'a@gmail.com',
    name: 'A',
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
      serial: 'edit',
      serialservice: 'none',
      countrylock: 'none',
      dashboard: 'none',
    },
    businessUnits: [],
    locations: [],
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  apiMock.mockReset();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

const removeCalls = () =>
  apiMock.mock.calls
    .filter((call) => call[0] === 'serialProofs.remove')
    .map((call) => (call[1] as { id: string }).id)
    .sort();

test('Simpan mengirim proofPhotoIds hanya untuk baris yang punya foto; baris tersimpan tidak membuang fotonya', async () => {
  seedDraft([
    { serial: 'AAA111', photos: ['p1', 'p2'] },
    { serial: 'BBB222', photos: [] },
  ]);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /^Simpan 2 serial/ }));
  await waitFor(() => expect(saveCalls).toHaveLength(1));
  expect(saveCalls[0]?.map((row) => row.proofPhotoIds)).toEqual([['p1', 'p2'], undefined]);
  await waitFor(() => expect(screen.getByText(/Dibuat 2/)).toBeInTheDocument());
  // Foto yang sudah ditautkan ke entri tidak boleh dibuang.
  expect(removeCalls()).toEqual([]);
});

test('menghapus satu baris membuang foto barisnya di server', async () => {
  seedDraft([
    { serial: 'AAA111', photos: ['p1', 'p2'] },
    { serial: 'BBB222', photos: ['p3'] },
  ]);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Hapus AAA111' }));
  await waitFor(() => expect(removeCalls()).toEqual(['p1', 'p2']));
  expect(screen.queryByRole('textbox', { name: 'Serial AAA111' })).not.toBeInTheDocument();
});

test('hapus massal baris terpilih membuang foto baris-baris itu saja', async () => {
  seedDraft([
    { serial: 'AAA111', photos: ['p1'] },
    { serial: 'BBB222', photos: ['p2'] },
    { serial: 'CCC333', photos: ['p3'] },
  ]);
  renderPage();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih baris AAA111' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris CCC333' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Hapus 2 baris' }));
  await waitFor(() => expect(removeCalls()).toEqual(['p1', 'p3']));
});

test('Kosongkan draft membuang foto semua baris', async () => {
  seedDraft([
    { serial: 'AAA111', photos: ['p1'] },
    { serial: 'BBB222', photos: ['p2', 'p3'] },
  ]);
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Kosongkan draft' }));
  // Konfirmasi menyebut jumlah baris dan foto yang ikut dibuang.
  const dialog = await screen.findByRole('alertdialog', { name: 'Kosongkan draft?' });
  expect(dialog).toHaveTextContent('2 baris dibuang dari draft dan 3 foto buktinya ikut dibuang');
  expect(removeCalls()).toEqual([]);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kosongkan 2 baris' }));
  await waitFor(() => expect(removeCalls()).toEqual(['p1', 'p2', 'p3']));
  expect(localStorage.getItem('qc.serial.draft:a@gmail.com')).toBeNull();
});

test('foto kedaluwarsa: baris tetap di draft dengan pesan server, foto dibuang dari baris dan tidak dihapus lagi di server', async () => {
  seedDraft([{ serial: 'AAA111', photos: ['p1'] }]);
  respond = () => ({ result: 'invalid', message: 'Foto sudah kedaluwarsa, unggah ulang' });
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /^Simpan 1 serial/ }));
  expect(await screen.findByText('Foto sudah kedaluwarsa, unggah ulang')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Serial AAA111' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Foto (0), AAA111' })).toBeInTheDocument();
  expect(removeCalls()).toEqual([]);
  // Draft tersimpan tanpa foto basi.
  await waitFor(() => expect(loadDraft('a@gmail.com')[0]?.proofPhotos).toEqual([]));
});

test('galat penyimpanan lain: foto tetap melekat pada baris', async () => {
  seedDraft([{ serial: 'AAA111', photos: ['p1'] }]);
  respond = () => ({ result: 'invalid', message: 'Item tidak ditemukan' });
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /^Simpan 1 serial/ }));
  expect(await screen.findByText('Item tidak ditemukan')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Foto (1), AAA111' })).toBeInTheDocument();
});

function renderGuarded(extra: {
  onAllSaved?: () => void;
  onProofChange?: (hasProof: boolean) => void;
}) {
  const handleRef: { current: RecordPageHandle | null } = { current: null };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RecordPage handleRef={handleRef} {...extra} />
    </QueryClientProvider>,
  );
  return handleRef;
}

test('onProofChange melaporkan ada/tidaknya baris berfoto bukti', async () => {
  seedDraft([
    { serial: 'AAA111', photos: ['p1'] },
    { serial: 'BBB222', photos: [] },
  ]);
  const onProofChange = vi.fn();
  renderGuarded({ onProofChange });
  await waitFor(() => expect(onProofChange).toHaveBeenLastCalledWith(true));
  await userEvent.click(await screen.findByRole('button', { name: 'Hapus AAA111' }));
  await waitFor(() => expect(onProofChange).toHaveBeenLastCalledWith(false));
});

test('handleRef.save: menyimpan semua baris, true, mengosongkan draft, tanpa memanggil onAllSaved', async () => {
  seedDraft([{ serial: 'AAA111', photos: ['p1'] }]);
  const onAllSaved = vi.fn();
  const handleRef = renderGuarded({ onAllSaved });
  await screen.findByRole('button', { name: /^Simpan 1 serial/ });
  let saved = false;
  await act(async () => {
    saved = (await handleRef.current?.save()) ?? false;
  });
  expect(saved).toBe(true);
  expect(saveCalls[0]?.map((row) => row.proofPhotoIds)).toEqual([['p1']]);
  expect(onAllSaved).not.toHaveBeenCalled();
  expect(localStorage.getItem('qc.serial.draft:a@gmail.com')).toBeNull();
});

test('handleRef.save: ada baris gagal = false dan draft tetap', async () => {
  seedDraft([
    { serial: 'AAA111', photos: ['p1'] },
    { serial: 'BBB222', photos: [] },
  ]);
  respond = (row) =>
    row.serial === 'BBB222'
      ? { result: 'invalid', message: 'Ditolak' }
      : { result: 'created', message: '' };
  const handleRef = renderGuarded({});
  await screen.findByRole('button', { name: /^Simpan 2 serial/ });
  let saved = true;
  await act(async () => {
    saved = (await handleRef.current?.save()) ?? true;
  });
  expect(saved).toBe(false);
  expect(screen.getByText('Ditolak')).toBeInTheDocument();
});
