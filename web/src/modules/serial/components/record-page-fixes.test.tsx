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
  if (id === 'serials.locationOptions') {
    return Promise.resolve({
      locations: [
        { id: 'l1', code: 'JKT', name: 'Jakarta' },
        { id: 'l2', code: 'SBY', name: 'Surabaya' },
      ],
    });
  }
  if (id === 'serials.itemOptions') {
    const ids = input.itemIds as string[] | undefined;
    return Promise.resolve({
      items: ids ? ITEMS.filter((item) => ids.includes(item.id)) : ITEMS,
      nextCursor: null,
    });
  }
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

beforeEach(() => {
  localStorage.clear();
  saveCalls = [];
  apiMock.mockReset();
  apiMock.mockImplementation(baseApi);
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
    },
    businessUnits: [],
    locations: [],
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
  await userEvent.click(screen.getByLabelText('Scan atau tempel serial (satu per baris)'));
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
      status: 'good',
      damage: '',
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
  expect(within(tr).getByText(/belum bisa diverifikasi/)).toBeInTheDocument();
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
  expect(await screen.findByText(/Stiker yang berlaku gagal dimuat: /)).toBeInTheDocument();
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

test('daftar lokasi gagal dimuat saat impor: baris ditandai belum terverifikasi, bukan lokasi tak ditemukan', async () => {
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.locationOptions' ? Promise.reject(new Error('putus')) : baseApi(id, input),
  );
  renderPage();
  await uploadRows(stagingRows(['LOC1']));
  await waitFor(() => expect(serialValues()).toEqual(['LOC1']));
  const tr = dataRows()[0] as HTMLElement;
  expect(within(tr).getByText(/belum bisa diverifikasi/)).toBeInTheDocument();
  expect(within(tr).queryByText(/lokasi \(tidak ditemukan\)/)).toBeNull();
});

test('pencatat tanpa penugasan lokasi tetap dapat memilih lokasi dari serials.locationOptions', async () => {
  expect(me.locations).toEqual([]);
  renderPage();
  await pickDefaults();
  await paste('A1');
  expect(within(dataRows()[0] as HTMLElement).getByText('Jakarta (JKT)')).toBeInTheDocument();
});

test('impor: item dicocokkan menurut id (bukan label berkas); label usang disegarkan, berkas tanpa label tak bermasalah, id hantu ditandai', async () => {
  const [base] = stagingRows(['IMP1']);
  if (!base) throw new Error('seed');
  const rows: StagingRow[] = [
    { ...base, clientId: 'row-renamed001', serial: 'RENAMED', itemLabel: 'Cisco LAMA' },
    { ...base, clientId: 'row-nolabel001', serial: 'NOLABEL', itemLabel: '' },
    { ...base, clientId: 'row-ghost00001', serial: 'GHOST', itemId: 'iHantu', itemLabel: 'Hantu' },
  ];
  renderPage();
  await uploadRows(rows);
  await waitFor(() => expect(serialValues()).toEqual(['RENAMED', 'NOLABEL', 'GHOST']));
  expect(within(rowOf('RENAMED')).getByText('Cisco C9200')).toBeInTheDocument();
  expect(within(rowOf('RENAMED')).queryByText(/tidak ditemukan/)).toBeNull();
  expect(within(rowOf('NOLABEL')).getByText('Cisco C9200')).toBeInTheDocument();
  expect(within(rowOf('NOLABEL')).queryByText(/tidak ditemukan/)).toBeNull();
  expect(
    within(rowOf('GHOST')).getByText('Pilih ulang item (tidak ditemukan)'),
  ).toBeInTheDocument();
  const byId = apiMock.mock.calls.filter(
    (call) => call[0] === 'serials.itemOptions' && Array.isArray(call[1]?.itemIds),
  );
  expect(byId).toHaveLength(1);
  const sent = byId[0]?.[1] as { itemIds: string[]; query?: string };
  expect([...sent.itemIds].sort()).toEqual(['i1', 'iHantu']);
  expect(sent.query).toBeUndefined();
});

test('bawaan rombongan: tanpa item tampil petunjuk; item terpilih menampilkan stiker yang berlaku, semua tercentang jumlah awal', async () => {
  renderPage();
  expect(
    screen.getByText('Pilih item dan Business Unit untuk melihat stiker yang berlaku.'),
  ).toBeInTheDocument();
  await pickLink(screen, 'Item', 'Cisco C9200');
  expect(await screen.findByRole('checkbox', { name: 'Stiker A' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Stiker B' })).toBeChecked();
  expect(screen.getByLabelText('Jumlah Stiker A')).toHaveTextContent('1');
  expect(screen.getByLabelText('Jumlah Stiker B')).toHaveTextContent('1');
});

test('bawaan rombongan: item tanpa stiker berlaku menampilkan pesan', async () => {
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.stickerOptions' ? Promise.resolve({ stickers: [] }) : baseApi(id, input),
  );
  renderPage();
  await pickLink(screen, 'Item', 'Cisco C9200');
  expect(
    await screen.findByText('Tidak ada stiker yang berlaku bagi item ini.'),
  ).toBeInTheDocument();
});

test('bawaan rombongan: bawaan tak diubah = stickers null (semua yang berlaku saat simpan); diubah = salinan eksplisit untuk baris sesudahnya saja', async () => {
  renderPage();
  await pickDefaults();
  await screen.findByRole('checkbox', { name: 'Stiker A' });
  await paste('A1');
  // Ubah bawaan: Stiker B dilepas, jumlah Stiker A menjadi 3.
  await userEvent.click(screen.getByRole('checkbox', { name: 'Stiker B' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Stiker A' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Stiker A' }));
  expect(screen.getByLabelText('Jumlah Stiker A')).toHaveTextContent('3');
  await paste('B2');
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(saveCalls).toHaveLength(1));
  const byserial = new Map(saveCalls[0]?.rows.map((row) => [row.serial, row.stickers]));
  // A1 ditambah sebelum bawaan diubah: semua stiker yang berlaku dengan jumlah awal.
  expect(byserial.get('A1')).toEqual([
    { stickerId: 's1', qty: 1 },
    { stickerId: 's2', qty: 1 },
  ]);
  // B2 sesudahnya: salinan pilihan eksplisit.
  expect(byserial.get('B2')).toEqual([{ stickerId: 's1', qty: 3 }]);
});

test('bawaan rombongan: mengganti item mengembalikan pilihan ke bawaan semua tercentang', async () => {
  renderPage();
  await pickLink(screen, 'Item', 'Cisco C9200');
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Stiker B' }));
  expect(screen.getByRole('checkbox', { name: 'Stiker B' })).not.toBeChecked();
  await pickLink(screen, 'Item', 'Aruba 2930');
  expect(await screen.findByRole('checkbox', { name: 'Stiker C' })).toBeChecked();
  await pickLink(screen, 'Item', 'Cisco C9200');
  expect(await screen.findByRole('checkbox', { name: 'Stiker B' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Stiker A' })).toBeChecked();
});

test('bawaan rombongan: semua stiker dilepas = baris baru tanpa stiker (eksplisit kosong)', async () => {
  renderPage();
  await pickDefaults();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Stiker A' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Stiker B' }));
  await paste('NONE1');
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(saveCalls).toHaveLength(1));
  expect(saveCalls[0]?.rows[0]?.stickers).toEqual([]);
});
