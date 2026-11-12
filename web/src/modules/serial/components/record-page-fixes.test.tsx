import type { MeDto, SerialRowResult } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { pickLink } from '@/test/link-field';
import { addSerials, type StagingRow } from '../lib/draft';
import { clearAllDrafts } from '../lib/draft-store';
import { exportQcsn } from '../lib/qcsn';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

const NL = String.fromCharCode(10);
const ITEMS = [
  { id: 'i1', label: 'Cisco C9200', buIds: ['b1'], buOptions: [{ id: 'b1', code: 'BU1' }] },
  { id: 'i2', label: 'Aruba 2930', buIds: ['b1'], buOptions: [{ id: 'b1', code: 'BU1' }] },
];
const STICKERS: Record<string, { id: string; name: string }[]> = {
  i1: [
    { id: 's1', name: 'Stiker A' },
    { id: 's2', name: 'Stiker B' },
  ],
  i2: [{ id: 's3', name: 'Stiker C' }],
};

let saveCalls: { rows: { clientId: string; serial: string; stickers: unknown[] }[] }[] = [];

function baseApi(id: string, input: Record<string, unknown>) {
  if (id === 'serials.itemOptions') return Promise.resolve({ items: ITEMS, nextCursor: null });
  if (id === 'serials.stickerOptions') {
    const list = STICKERS[String(input.itemId)];
    if (!list) return Promise.reject(new ApiError('NOT_FOUND', 'Tidak ditemukan', '-'));
    return Promise.resolve({
      stickers: list.map((sticker) => ({
        ...sticker,
        alias: '',
        typeName: 'Jenis',
        defaultQty: 1,
      })),
    });
  }
  if (id === 'serials.saveBatch') {
    const rows = (input.rows as { clientId: string; serial: string; stickers: unknown[] }[]) ?? [];
    saveCalls.push({ rows });
    const results: SerialRowResult[] = rows.map((row) => ({
      clientId: row.clientId,
      result: 'created',
      message: '',
    }));
    return Promise.resolve({ results });
  }
  return Promise.reject(new Error(`api tak dikenal: ${id}`));
}

const location = (id: string, code: string, name: string) => ({
  id,
  code,
  name,
  permissions: {
    handover: 'none' as const,
    qc: 'none' as const,
    stock: 'none' as const,
    stickerstock: 'none' as const,
  },
});

beforeEach(() => {
  localStorage.clear();
  saveCalls = [];
  apiMock.mockReset();
  apiMock.mockImplementation(baseApi);
  me = {
    email: 'a@gmail.com',
    name: 'A',
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
      serial: 'edit',
      serialservice: 'none',
    },
    businessUnits: [],
    locations: [location('l1', 'JKT', 'Jakarta'), location('l2', 'SBY', 'Surabaya')],
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RecordPage />
    </QueryClientProvider>,
  );
}

async function pickDefaults() {
  await pickLink(screen, 'Item', 'Cisco C9200');
  await pickLink(screen, 'Lokasi', 'Jakarta (JKT)');
}

async function paste(text: string) {
  await userEvent.click(screen.getByLabelText('Pindai atau tempel serial (satu per baris)'));
  await userEvent.paste(text);
  if (!text.includes(NL)) await userEvent.keyboard('{Enter}');
}

const dataRows = () => screen.getAllByRole('row').slice(1);
const serialValues = () =>
  screen
    .queryAllByRole('textbox', { name: /^Serial / })
    .map((input) => (input as HTMLInputElement).value);

function stagingRows(serials: string[]): StagingRow[] {
  let n = 0;
  return addSerials(
    [],
    serials.join(NL),
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
    },
    () => `row-${String(++n).padStart(8, '0')}`,
    () => '2026-11-12T10:00:00.000Z',
  ).rows;
}

async function uploadRows(rows: StagingRow[]) {
  const text = await exportQcsn(rows, { name: 'qc-web', version: '1' }, new Date());
  await userEvent.upload(
    screen.getByLabelText('Impor berkas .qcsn'),
    new File([text], 'serial.qcsn', { type: 'application/json' }),
  );
}

function rowOf(serial: string): HTMLElement {
  return dataRows().find((row) => within(row).queryByDisplayValue(serial)) as HTMLElement;
}

test('impor: lokasi tak dikenal ditandai, BU kosong diturunkan dari item satu-BU, label diganti nilai server', async () => {
  const [base] = stagingRows(['IMP1']);
  if (!base) throw new Error('seed');
  const rows: StagingRow[] = [
    { ...base, clientId: 'row-noBuId001', serial: 'NOBU', buId: '', buLabel: '' },
    {
      ...base,
      clientId: 'row-badLoc001',
      serial: 'BADLOC',
      locationId: 'lX',
      locationLabel: 'Gudang Hantu',
    },
    {
      ...base,
      clientId: 'row-labels001',
      serial: 'LABELS',
      stickers: [{ stickerId: 's1', name: 'Stiker PALSU', qty: 2 }],
    },
  ];
  renderPage();
  await uploadRows(rows);
  await waitFor(() => expect(serialValues()).toEqual(['NOBU', 'BADLOC', 'LABELS']));
  expect(within(rowOf('NOBU')).getByText('BU1')).toBeInTheDocument();
  expect(within(rowOf('NOBU')).queryByText('Business Unit belum dipilih')).toBeNull();
  expect(
    within(rowOf('BADLOC')).getByText('Pilih ulang lokasi (tidak ditemukan)'),
  ).toBeInTheDocument();
  expect(within(rowOf('LABELS')).getByText('Stiker A ×2')).toBeInTheDocument();
  expect(screen.queryByText(/Stiker PALSU/)).toBeNull();
});

test('impor: galat jaringan saat verifikasi bukan "item tidak ditemukan" dan stiker tidak dibuang', async () => {
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.stickerOptions' ? Promise.reject(new Error('putus')) : baseApi(id, input),
  );
  const [row] = stagingRows(['NET1']).map((r) => ({
    ...r,
    stickers: [{ stickerId: 's1', name: 'Stiker A', qty: 2 }],
  }));
  if (!row) throw new Error('seed');
  renderPage();
  await uploadRows([row]);
  await waitFor(() => expect(serialValues()).toEqual(['NET1']));
  const tr = dataRows()[0] as HTMLElement;
  expect(within(tr).queryByText(/tidak ditemukan/)).toBeNull();
  expect(within(tr).getByText(/belum dapat diverifikasi/)).toBeInTheDocument();
  expect(within(tr).getByText('Stiker A ×2')).toBeInTheDocument();
});

test('pindaian yang masuk selama impor menunggu tidak hilang', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  apiMock.mockImplementation(async (id: string, input: Record<string, unknown>) => {
    if (id === 'serials.stickerOptions') await gate;
    return baseApi(id, input);
  });
  renderPage();
  await pickDefaults();
  await uploadRows(stagingRows(['IMP1', 'IMP2']));
  await paste(`SCAN1${NL}SCAN2`);
  expect(serialValues()).toEqual(['SCAN1', 'SCAN2']);
  release();
  await waitFor(() => expect(serialValues()).toEqual(['SCAN1', 'SCAN2', 'IMP1', 'IMP2']));
});

test('keluar saat halaman Catat terpasang: draf tidak tertulis ulang saat halaman dilepas', async () => {
  const view = renderPage();
  await pickDefaults();
  await paste(`KEEP1${NL}KEEP2`);
  clearAllDrafts();
  view.unmount();
  expect(localStorage.getItem('qc.serial.draft:a@gmail.com')).toBeNull();
});

test('satu pasangan item/BU NOT_FOUND saat simpan hanya menandai barisnya; baris lain tetap tersimpan', async () => {
  renderPage();
  await pickDefaults();
  await paste('GOOD1');
  await pickLink(screen, 'Item', 'Aruba 2930');
  await paste('BAD1');
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.stickerOptions' && input.itemId === 'i2'
      ? Promise.reject(new ApiError('NOT_FOUND', 'Tidak ditemukan', '-'))
      : baseApi(id, input),
  );
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(saveCalls).toHaveLength(1));
  expect(saveCalls[0]?.rows.map((r) => r.serial)).toEqual(['GOOD1']);
  await waitFor(() => expect(serialValues()).toEqual(['BAD1']));
  expect(screen.getByText('Pilih ulang item (tidak ditemukan)')).toBeInTheDocument();
  expect(screen.getByText(/1 baris tidak dikirim/)).toBeInTheDocument();
});

test('gangguan jaringan saat memuat stiker menghentikan simpan tanpa menandai baris', async () => {
  renderPage();
  await pickDefaults();
  await paste('A1');
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.stickerOptions' ? Promise.reject(new Error('putus')) : baseApi(id, input),
  );
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  expect(await screen.findByText(/Stiker yang berlaku gagal dimuat/)).toBeInTheDocument();
  expect(saveCalls).toHaveLength(0);
  expect(dataRows()[0]).toHaveAttribute('data-result', 'ok');
});

test('selama simpan tabel terkunci tetapi pemindai tetap menerima serial; yang baru tidak ikut terkirim', async () => {
  renderPage();
  await pickDefaults();
  await paste('A1');
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  apiMock.mockImplementation(async (id: string, input: Record<string, unknown>) => {
    if (id === 'serials.saveBatch') await gate;
    return baseApi(id, input);
  });
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  const catatan = await screen.findByRole('textbox', { name: 'Catatan A1' });
  expect(catatan).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Detail A1' })).toBeDisabled();
  await paste('LATE1');
  release();
  await waitFor(() => expect(saveCalls).toHaveLength(1));
  expect(saveCalls[0]?.rows.map((r) => r.serial)).toEqual(['A1']);
  await waitFor(() => expect(serialValues()).toEqual(['LATE1']));
});

test('tanggal uji dikosongkan ditandai di kolom Hasil', async () => {
  renderPage();
  await pickDefaults();
  await paste('A1');
  fireEvent.change(screen.getByLabelText('Tanggal uji A1'), { target: { value: '' } });
  expect(
    within(dataRows()[0] as HTMLElement).getByText('Tanggal uji belum diisi'),
  ).toBeInTheDocument();
});

test('tempelan sebagian ditolak tidak berbunyi sukses', async () => {
  renderPage();
  await pickDefaults();
  await paste(`GOOD1${NL}bad${String.fromCharCode(7)}x`);
  expect(screen.getByText('Ditolak')).toBeInTheDocument();
  expect(screen.queryByText('Ditambahkan')).toBeNull();
});

test('ubah massal dapat mengosongkan catatan', async () => {
  renderPage();
  await pickDefaults();
  await userEvent.type(screen.getByLabelText('Catatan'), 'salah');
  await paste('A1');
  expect(screen.getByLabelText('Catatan A1')).toHaveValue('salah');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris A1' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Kosongkan catatan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Terapkan ke 1 baris' }));
  expect(screen.getByLabelText('Catatan A1')).toHaveValue('');
});
