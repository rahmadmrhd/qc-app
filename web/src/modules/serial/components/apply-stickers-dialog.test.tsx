import type { SerialSummaryDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock, Toaster: () => null }));

import { ApplyStickersDialog } from './apply-stickers-dialog';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const row = (over: Partial<SerialSummaryDto>): SerialSummaryDto => ({
  id: 's1',
  buId: 'b1',
  buCode: 'BU1',
  serial: 'ABC123',
  itemId: 'i1',
  itemLabel: 'Cisco C9200',
  testDate: '2026-11-10',
  sample: false,
  locationId: 'l1',
  locationName: 'Jakarta',
  status: 'good',
  custody: 'qc',
  transitToLocationId: null,
  transitToLocationName: null,
  transitOn: null,
  openCaseNumber: null,
  hasProofPhotos: false,
  proofProblemCount: 0,
  createdAt: '2026-11-10T03:00:00.000Z',
  ...over,
});

const ROWS = [
  row({ id: 's1', serial: 'AAA111' }),
  row({ id: 's2', serial: 'BBB222' }),
  row({ id: 's3', serial: 'CCC333', itemId: 'i2', itemLabel: 'Aruba 2930' }),
];

const OPTIONS: Record<string, { id: string; name: string }[]> = {
  i1: [
    { id: 'st1', name: 'Stiker A' },
    { id: 'st2', name: 'Stiker B' },
  ],
  i2: [{ id: 'st3', name: 'Stiker C' }],
};

let applyResult: () => Promise<{ ids: string[] }>;

beforeEach(() => {
  apiMock.mockReset();
  toastMock.success.mockReset();
  applyResult = () => Promise.resolve({ ids: ['s1', 's2'] });
  apiMock.mockImplementation((id: string, input: { itemId?: string }) => {
    if (id === 'serials.stickerOptions') {
      return Promise.resolve({
        stickers: (OPTIONS[input.itemId ?? ''] ?? []).map((sticker) => ({
          ...sticker,
          alias: '',
          typeName: 'J',
          defaultQty: 1,
        })),
      });
    }
    if (id === 'serials.applyStickersBatch') return applyResult();
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

const calls = (id: string) => apiMock.mock.calls.filter((call) => call[0] === id);

async function renderDialog(
  rows: SerialSummaryDto[] = ROWS,
  handlers: { onClose?: () => void; onDone?: (ids: string[]) => void } = {},
) {
  const onClose = handlers.onClose ?? vi.fn();
  const onDone = handlers.onDone ?? vi.fn();
  await renderInRouter(<ApplyStickersDialog rows={rows} onClose={onClose} onDone={onDone} />);
  const dialog = await screen.findByRole('dialog', { name: 'Tempel stiker' });
  return { dialog, onClose, onDone };
}

test('satu bagian per kelompok (Item, BU); daftar stiker dimuat dengan salah satu serial kelompok', async () => {
  const { dialog } = await renderDialog();
  const aruba = within(dialog).getByRole('region', { name: 'Aruba 2930 · BU1' });
  const cisco = within(dialog).getByRole('region', { name: 'Cisco C9200 · BU1' });
  expect(within(cisco).getByText(/2 Serial Number: AAA111, BBB222/)).toBeInTheDocument();
  expect(within(aruba).getByText(/1 Serial Number: CCC333/)).toBeInTheDocument();
  expect(await within(cisco).findByRole('checkbox', { name: 'Stiker A' })).toBeInTheDocument();
  expect(await within(aruba).findByRole('checkbox', { name: 'Stiker C' })).toBeInTheDocument();
  expect(calls('serials.stickerOptions').map((call) => call[1])).toEqual(
    expect.arrayContaining([
      { itemId: 'i1', buId: 'b1', serialId: 's1' },
      { itemId: 'i2', buId: 'b1', serialId: 's3' },
    ]),
  );
  expect(calls('serials.stickerOptions')).toHaveLength(2);
  // Daftar mewakili banyak serial: tanpa keterangan jumlah tempel per serial.
  expect(within(dialog).queryByText(/Belum pernah ditempel|Sudah ditempel/)).toBeNull();
});

test('Tempel stiker nonaktif tanpa centang; kelompok tanpa centang dilewati; id serial semua anggota kelompok yang dicentang', async () => {
  const { dialog, onDone, onClose } = await renderDialog();
  const send = within(dialog).getByRole('button', { name: 'Tempel stiker' });
  expect(send).toBeDisabled();
  const cisco = within(dialog).getByRole('region', { name: 'Cisco C9200 · BU1' });
  await userEvent.click(await within(cisco).findByRole('checkbox', { name: 'Stiker A' }));
  await userEvent.click(within(cisco).getByRole('checkbox', { name: 'Stiker B' }));
  expect(send).toBeEnabled();
  await userEvent.click(send);
  await waitFor(() => expect(calls('serials.applyStickersBatch')).toHaveLength(1));
  const input = calls('serials.applyStickersBatch')[0]?.[1] as {
    clientId: string;
    occurredOn: string;
    message: string;
    rows: { id: string; stickerIds: string[] }[];
  };
  expect(input.clientId).toMatch(UUID);
  expect(input.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(input.message).toBe('');
  // Aruba (tanpa centang) dilewati.
  expect(input.rows).toEqual([
    { id: 's1', stickerIds: ['st1', 'st2'] },
    { id: 's2', stickerIds: ['st1', 'st2'] },
  ]);
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(['s1', 's2']));
  expect(onClose).toHaveBeenCalled();
  expect(toastMock.success).toHaveBeenCalledWith('2 Serial Number ditempeli stiker');
});

test('catatan opsional ikut terkirim', async () => {
  const { dialog } = await renderDialog([row({ id: 's1' })]);
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Stiker A' }));
  await userEvent.type(within(dialog).getByLabelText('Catatan (opsional)'), 'Stiker batch Nov');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tempel stiker' }));
  await waitFor(() => expect(calls('serials.applyStickersBatch')).toHaveLength(1));
  expect(calls('serials.applyStickersBatch')[0]?.[1]).toMatchObject({
    message: 'Stiker batch Nov',
    rows: [{ id: 's1', stickerIds: ['st1'] }],
  });
});

test('gagal kirim: dialog tetap terbuka dengan galat; kirim ulang memakai clientId yang sama, isi berubah memakai id baru', async () => {
  let attempt = 0;
  applyResult = () => {
    attempt += 1;
    return attempt === 1
      ? Promise.reject(
          new ApiError('VALIDATION', 'AAA111: Stiker tidak berlaku bagi item ini', 'req-1'),
        )
      : Promise.resolve({ ids: ['s1'] });
  };
  const onClose = vi.fn();
  const { dialog } = await renderDialog([row({ id: 's1' })], { onClose });
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Stiker A' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tempel stiker' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('AAA111');
  expect(onClose).not.toHaveBeenCalled();

  // Mengulang kiriman yang sama: id sama (kunci idempoten server).
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tempel stiker' }));
  await waitFor(() => expect(calls('serials.applyStickersBatch')).toHaveLength(2));
  const [first, second] = calls('serials.applyStickersBatch').map(
    (call) => (call[1] as { clientId: string }).clientId,
  );
  expect(second).toBe(first);
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test('isi kiriman berubah sesudah gagal: niat kirim baru dengan clientId baru', async () => {
  let attempt = 0;
  applyResult = () => {
    attempt += 1;
    return attempt === 1 ? Promise.reject(new Error('Gagal')) : Promise.resolve({ ids: ['s1'] });
  };
  const { dialog } = await renderDialog([row({ id: 's1' })]);
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Stiker A' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tempel stiker' }));
  await within(dialog).findByRole('alert');
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Stiker B' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tempel stiker' }));
  await waitFor(() => expect(calls('serials.applyStickersBatch')).toHaveLength(2));
  const ids = calls('serials.applyStickersBatch').map(
    (call) => (call[1] as { clientId: string }).clientId,
  );
  expect(ids[1]).not.toBe(ids[0]);
});

test('lebih dari 100 serial yang dicentang: peringatan dan tombol nonaktif; kelompok tanpa centang tak dihitung', async () => {
  const many = Array.from({ length: 101 }, (_, index) =>
    row({ id: `m${index}`, serial: `MASSAL${index}` }),
  );
  const { dialog } = await renderDialog([
    ...many,
    row({ id: 'z1', serial: 'ZZZ', itemId: 'i2', itemLabel: 'Aruba 2930' }),
  ]);
  const cisco = within(dialog).getByRole('region', { name: 'Cisco C9200 · BU1' });
  await userEvent.click(await within(cisco).findByRole('checkbox', { name: 'Stiker A' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Paling banyak 100 Serial Number');
  expect(within(dialog).getByRole('button', { name: 'Tempel stiker' })).toBeDisabled();
  // Lepas centang: 0 baris tercentang, jadi peringatan hilang (tombol tetap nonaktif karena tak ada centang).
  await userEvent.click(within(cisco).getByRole('checkbox', { name: 'Stiker A' }));
  expect(within(dialog).queryByRole('alert')).toBeNull();
});

test('kelompok tanpa stiker yang berlaku diberi catatan dan tak menahan kelompok lain', async () => {
  const { dialog } = await renderDialog([
    row({ id: 's1' }),
    row({ id: 's9', serial: 'KOSONG9', itemId: 'i9', itemLabel: 'Tanpa Stiker' }),
  ]);
  const empty = within(dialog).getByRole('region', { name: 'Tanpa Stiker · BU1' });
  expect(await within(empty).findByText(/Tidak ada stiker yang berlaku/)).toBeInTheDocument();
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Stiker A' }));
  expect(within(dialog).getByRole('button', { name: 'Tempel stiker' })).toBeEnabled();
});

test('Batal menutup tanpa mengirim', async () => {
  const { dialog, onClose } = await renderDialog([row({ id: 's1' })]);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  expect(onClose).toHaveBeenCalled();
  expect(calls('serials.applyStickersBatch')).toHaveLength(0);
});
