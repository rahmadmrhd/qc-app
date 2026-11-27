import type { MeDto, ReadyStockBoxDto, ReadyStockPageDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { type ReadySearchParams, readySearchSchema } from '../lib/ready-stock-filter';
import { whMe, whSerial } from '../lib/test-support';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn() },
}));
const handOffMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/hand-off', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/hand-off')>()),
  handOffToDispatch: handOffMock,
}));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { ReadyStockPage } from './ready-stock-page';

let media: ReturnType<typeof mockMatchMedia>;
let boxes: ReadyStockBoxDto[] = [];
let pickedIds: string[] = [];
let failList = false;
let writeText: ReturnType<typeof vi.fn>;

const serial = (
  id: string,
  boxId: string,
  boxNumber: number,
  processing = false,
  status = 'good',
  custody = 'qc',
) => ({
  status,
  custody,
  id,
  serial: `SN-${id}`,
  boxId,
  boxNumber,
  capacity: 3,
  recordedOn: '2026-11-20',
  processing,
});

function fixture(): ReadyStockBoxDto[] {
  return [
    {
      id: 'bx1',
      number: 1,
      capacity: 3,
      remaining: 3,
      kind: 'full',
      itemId: 'item1',
      itemLabel: 'Tenda AX300',
      buId: 'bu1',
      buCode: 'A',
      buName: 'BU 1',
      serials: [serial('s1', 'bx1', 1), serial('s2', 'bx1', 1), serial('s3', 'bx1', 1, true)],
    },
    {
      id: 'bx2',
      number: 2,
      capacity: 3,
      remaining: 3,
      kind: 'full',
      itemId: 'item1',
      itemLabel: 'Tenda AX300',
      buId: 'bu1',
      buCode: 'A',
      buName: 'BU 1',
      serials: [
        serial('s4', 'bx2', 2),
        serial('s5', 'bx2', 2, false, 'reported'),
        serial('s6', 'bx2', 2),
      ],
    },
    {
      id: 'bx3',
      number: 3,
      capacity: 3,
      remaining: 2,
      kind: 'loose',
      itemId: 'item1',
      itemLabel: 'Tenda AX300',
      buId: 'bu1',
      buCode: 'A',
      buName: 'BU 1',
      serials: [serial('s7', 'bx3', 3), serial('s8', 'bx3', 3)],
    },
  ];
}

const page = (): ReadyStockPageDto => ({
  boxes,
  nextCursor: null,
  totals: { units: 8, fullBoxes: 2, looseBoxes: 1, maxBoxNumber: 3 },
  itemFacets: [{ id: 'item1', label: 'Tenda AX300' }],
});

const listCalls = () =>
  apiMock.mock.calls.filter((call) => call[0] === 'serialWarehouse.readyStock');

beforeEach(() => {
  boxes = fixture();
  pickedIds = [];
  failList = false;
  media = mockMatchMedia(true);
  me = whMe(['bu1']);
  handOffMock.mockReset();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  apiMock.mockReset();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serialWarehouse.readyStock') {
      if (failList) return Promise.reject(new ApiError('INTERNAL', 'gagal', 'req1'));
      return Promise.resolve({
        ...page(),
        ...(typeof input.pickCount === 'number' ? { picked: pickedIds } : {}),
      });
    }
    if (id === 'serialWarehouse.lookup') {
      const ids = (input.ids as string[]) ?? [];
      return Promise.resolve({
        found: ids.map((sid) =>
          whSerial({ id: sid, serial: `SN-${sid}`, itemId: 'item1', itemLabel: 'Tenda AX300' }),
        ),
      });
    }
    if (id === 'serialWarehouse.itemOptions') {
      return Promise.resolve({ items: [], nextCursor: null });
    }
    return Promise.resolve({});
  });
});

afterEach(() => {
  media.restore();
  apiMock.mockReset();
});

function Harness({ initial = {} }: { initial?: Record<string, unknown> }) {
  const [search, setSearch] = useState<ReadySearchParams>(readySearchSchema.parse(initial));
  return (
    <ReadyStockPage
      search={search}
      onSearchChange={(patch) => setSearch((prev) => ({ ...prev, ...patch }))}
    />
  );
}

async function renderPage() {
  return renderInRouter(<Harness />);
}

const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

test('dua bagian (Kardus penuh, lalu Ecer) dan zebra per kardus', async () => {
  await renderPage();
  await screen.findByText('SN-s1');
  expect(screen.getByRole('heading', { name: 'Kardus penuh' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Ecer' })).toBeInTheDocument();
  const tone = (sid: string) => rowOf(`SN-${sid}`).getAttribute('data-box-tone');
  // Satu kardus satu warna, kardus berurutan selang-seling.
  expect(tone('s1')).toBe(tone('s2'));
  expect(tone('s2')).toBe(tone('s3'));
  expect(tone('s4')).toBe(tone('s6'));
  expect(tone('s1')).not.toBe(tone('s4'));
  expect(tone('s4')).not.toBe(tone('s7'));
  expect([tone('s1'), tone('s4'), tone('s7')].every((t) => t === 'a' || t === 'b')).toBe(true);
  // Ecer ada di bawah kardus penuh.
  const full = screen.getByRole('heading', { name: 'Kardus penuh' });
  const loose = screen.getByRole('heading', { name: 'Ecer' });
  expect(full.compareDocumentPosition(loose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('ringkasan totals di atas tabel dan sisa/kapasitas kardus', async () => {
  await renderPage();
  await screen.findByText('SN-s1');
  expect(screen.getByText(/8 unit/)).toBeInTheDocument();
  expect(screen.getByText(/2 kardus penuh/)).toBeInTheDocument();
  expect(screen.getByText(/1 ecer/)).toBeInTheDocument();
  expect(within(rowOf('SN-s7')).getByText(/2\/3/)).toBeInTheDocument();
});

test('memilih satu kardus memilih semua serialnya yang bisa dipilih', async () => {
  await renderPage();
  await screen.findByText('SN-s1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih kardus 1' }));
  expect(await screen.findByText('2 dipilih')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Pilih SN-s1' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Pilih SN-s2' })).toBeChecked();
});

test('serial processing bertanda "Sedang diproses" dan tidak dapat dicentang', async () => {
  await renderPage();
  await screen.findByText('SN-s1');
  expect(within(rowOf('SN-s3')).getByText('Sedang diproses')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Pilih SN-s3' })).not.toBeInTheDocument();
});

test('"Pilih N unit" memanggil rute dengan pickCount lalu mencentang picked', async () => {
  pickedIds = ['s1', 's2', 's4'];
  await renderPage();
  await screen.findByText('SN-s1');
  await userEvent.type(screen.getByLabelText('Jumlah unit'), '3');
  await userEvent.click(screen.getByRole('button', { name: 'Pilih sesuai urutan' }));
  await waitFor(() =>
    expect(listCalls().some((call) => (call[1] as { pickCount?: number }).pickCount === 3)).toBe(
      true,
    ),
  );
  expect(await screen.findByText('3 dipilih')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Pilih SN-s4' })).toBeChecked();
  // Pilihan tetap bisa diubah bebas.
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih SN-s4' }));
  expect(await screen.findByText('2 dipilih')).toBeInTheDocument();
});

test('"Salin ke clipboard" menyalin teks tab-terpisah Kardus dan Serial', async () => {
  await renderPage();
  await screen.findByText('SN-s1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih SN-s4' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih SN-s7' }));
  await userEvent.click(await screen.findByRole('button', { name: /Salin ke clipboard/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('Kardus\tSerial\n2\tSN-s4\n3\tSN-s7'));
});

test('"Keluarkan ke Penjualan" memanggil handOffToDispatch dan menavigasi ke form', async () => {
  const { router } = await renderPage();
  await screen.findByText('SN-s1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih SN-s4' }));
  await userEvent.click(await screen.findByRole('button', { name: /Keluarkan ke Penjualan/ }));
  await waitFor(() => expect(handOffMock).toHaveBeenCalledTimes(1));
  const [rows, email] = handOffMock.mock.calls[0] ?? [];
  expect(email).toBe(me.email);
  expect(rows).toEqual([
    expect.objectContaining({
      serialId: 's4',
      serial: 'SN-s4',
      itemId: 'item1',
      buId: 'bu1',
    }),
  ]);
  await waitFor(() => expect(router.state.location.pathname).toBe('/serial/gudang'));
});

test('pengguna serialwh: view tanpa edit tidak melihat tombol Keluarkan', async () => {
  me = whMe(['bu1']);
  const perms = me.businessUnits?.[0]?.permissions;
  if (perms) perms.serialwh = 'view';
  await renderPage();
  await screen.findByText('SN-s1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih SN-s4' }));
  expect(await screen.findByRole('button', { name: /Salin ke clipboard/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Keluarkan ke Penjualan/ })).not.toBeInTheDocument();
  // Kolom BU dan filter Tipe tidak butuh rute edit (lookup/itemOptions).
  expect(within(rowOf('SN-s1')).getByText('A - BU 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Tipe/ })).toBeInTheDocument();
  expect(apiMock.mock.calls.some((call) => call[0] === 'serialWarehouse.lookup')).toBe(false);
  expect(apiMock.mock.calls.some((call) => call[0] === 'serialWarehouse.itemOptions')).toBe(false);
});

test('kosong: pesan keadaan kosong', async () => {
  boxes = [];
  await renderPage();
  expect(await screen.findByText('Belum ada stok ready.')).toBeInTheDocument();
});

test('galat memuat: pesan dan Coba lagi', async () => {
  failList = true;
  await renderPage();
  expect(await screen.findByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
});

test('kotak cari dan filter mengirim query ke rute', async () => {
  await renderPage();
  await screen.findByText('SN-s1');
  await userEvent.type(screen.getByRole('searchbox'), 'ABC');
  await waitFor(() =>
    expect(listCalls().some((call) => (call[1] as { query?: string }).query === 'ABC')).toBe(true),
  );
});

test('tanpa pilihan, "Salin ke clipboard" menyalin semua serial terfilter (kecuali yang diproses)', async () => {
  await renderPage();
  await screen.findByText('SN-s1');
  await userEvent.click(screen.getByRole('button', { name: /Salin ke clipboard/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const text = writeText.mock.calls[0]?.[0] as string;
  expect(text.split('\n')[0]).toBe('Kardus\tSerial');
  expect(text).toContain('1\tSN-s1');
  expect(text).toContain('3\tSN-s8');
  expect(text).not.toContain('SN-s3');
});

test('ponsel: kotak centang per kardus juga ada', async () => {
  media.restore();
  media = mockMatchMedia(false);
  window.innerWidth = 390;
  await renderPage();
  await screen.findByText('SN-s1');
  expect(screen.getByRole('checkbox', { name: 'Pilih kardus 1' })).toBeInTheDocument();
  window.innerWidth = 1024;
});

test('"Pilih N unit" melebihi batas: pesan memuat batasnya dan rute tidak dipanggil', async () => {
  await renderPage();
  await screen.findByText('SN-s1');
  await userEvent.type(screen.getByLabelText('Jumlah unit'), '5001');
  await userEvent.click(screen.getByRole('button', { name: 'Pilih sesuai urutan' }));
  expect(await screen.findByText(/Paling banyak 5000 unit/)).toBeInTheDocument();
  expect(listCalls().some((call) => (call[1] as { pickCount?: number }).pickCount)).toBe(false);
});

test('serial bukan good+qc bertanda status, tidak dapat dicentang, dan tidak ikut kotak centang kardus', async () => {
  await renderPage();
  await screen.findByText('SN-s1');
  expect(within(rowOf('SN-s5')).getByText('Dilaporkan')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Pilih SN-s5' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih kardus 2' }));
  expect(await screen.findByText('2 dipilih')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Pilih SN-s4' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Pilih SN-s6' })).toBeChecked();
});

test('salin semua terfilter tetap menyertakan serial bermasalah', async () => {
  await renderPage();
  await screen.findByText('SN-s1');
  await userEvent.click(screen.getByRole('button', { name: /Salin ke clipboard/ }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0]?.[0]).toContain('2	SN-s5');
});

test('label chip Tipe tetap saat facet berubah/kosong setelah filter diterapkan', async () => {
  function Switcher() {
    const [search, setSearch] = useState<ReadySearchParams>(readySearchSchema.parse({}));
    return (
      <>
        <button type="button" onClick={() => setSearch({ itemIds: ['item1'] })}>
          terapkan
        </button>
        <ReadyStockPage
          search={search}
          onSearchChange={(patch) => setSearch((prev) => ({ ...prev, ...patch }))}
        />
      </>
    );
  }
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serialWarehouse.readyStock') {
      return Promise.resolve({
        ...page(),
        itemFacets: input.itemIds ? [] : [{ id: 'item1', label: 'Tenda AX300' }],
      });
    }
    return Promise.resolve({ found: [], items: [], nextCursor: null });
  });
  await renderInRouter(<Switcher />);
  await screen.findByText('SN-s1');
  await userEvent.click(screen.getByRole('button', { name: 'terapkan' }));
  await waitFor(() =>
    expect(listCalls().some((call) => (call[1] as { itemIds?: string[] }).itemIds)).toBe(true),
  );
  expect(
    await screen.findByText('Tenda AX300', { selector: 'button *, button' }),
  ).toBeInTheDocument();
  expect(screen.queryByText('Tipe terpilih')).not.toBeInTheDocument();
});
