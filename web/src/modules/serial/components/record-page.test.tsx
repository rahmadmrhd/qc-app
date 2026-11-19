import type { MeDto, SerialRowResult } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
import { addSerials, type StagingRow } from '../lib/draft';
import { saveDraft } from '../lib/draft-store';
import { exportQcsn } from '../lib/qcsn';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn(), dismiss: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

const ITEMS = [
  {
    id: 'i1',
    label: 'Cisco C9200',
    buIds: ['b1'],
    buOptions: [{ id: 'b1', code: 'BU1' }],
    proofRequired: false,
    proofMin: 1,
  },
  {
    id: 'i2',
    label: 'Aruba 2930',
    buIds: ['b1'],
    buOptions: [{ id: 'b1', code: 'BU1' }],
    proofRequired: false,
    proofMin: 1,
  },
];
const STICKERS: Record<string, { id: string; name: string }[]> = {
  i1: [
    { id: 's1', name: 'Stiker A' },
    { id: 's2', name: 'Stiker B' },
  ],
  i2: [{ id: 's3', name: 'Stiker C' }],
};

let saveCalls: { rows: { clientId: string; serial: string; stickers: unknown[] }[] }[] = [];
let resultFor: (row: { clientId: string; serial: string }) => SerialRowResult['result'] = () =>
  'created';

function installApi() {
  saveCalls = [];
  resultFor = () => 'created';
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
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
      if (!list) return Promise.reject(new Error('tidak ditemukan'));
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
      const rows =
        (input.rows as { clientId: string; serial: string; stickers: unknown[] }[]) ?? [];
      saveCalls.push({ rows });
      return Promise.resolve({
        results: rows.map((row) => ({
          clientId: row.clientId,
          result: resultFor(row),
          message: resultFor(row) === 'duplicate' ? 'Serial sudah terdaftar' : '',
        })),
      });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
}

beforeEach(() => {
  localStorage.clear();
  installApi();
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
    },
    businessUnits: [],
    // Tanpa penugasan lokasi: pilihan lokasi serial datang dari serials.locationOptions.
    locations: [],
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  apiMock.mockReset();
});

function renderPage(
  props: { onDirtyChange?: (dirty: boolean) => void; onAllSaved?: (created: number) => void } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RecordPage {...props} />
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
  // Tempelan satu baris hanya mengisi kolom; Enter (seperti pemindai) yang mengirimnya.
  if (!text.includes(String.fromCharCode(10))) await userEvent.keyboard('{Enter}');
}

const dataRows = () => screen.getAllByRole('row').slice(1);
const serialValues = () =>
  screen
    .getAllByRole('textbox', { name: /^Serial / })
    .map((input) => (input as HTMLInputElement).value);

test('menempel dua serial menambah dua baris dengan bawaan rombongan', async () => {
  renderPage();
  await pickDefaults();
  await paste('abc123\nxyz789');
  expect(serialValues()).toEqual(['ABC123', 'XYZ789']);
  expect(dataRows()).toHaveLength(2);
  for (const row of dataRows()) {
    expect(within(row).getByText('Cisco C9200')).toBeInTheDocument();
    expect(within(row).getByText('Jakarta (JKT)')).toBeInTheDocument();
  }
  // Hasil murni sukses = toast (id tetap supaya scan berturut-turut mengganti, bukan menumpuk), bukan kotak inline.
  expect(toastSuccess).toHaveBeenCalledWith(
    '2 serial ditambahkan',
    expect.objectContaining({ id: 'serial-add' }),
  );
  expect(screen.queryByText(/2 serial ditambahkan/)).toBeNull();
});

test('scan berturut-turut memakai id toast yang sama; duplikat tetap inline dan sukses berikutnya menghapusnya', async () => {
  toastSuccess.mockClear();
  renderPage();
  await pickDefaults();
  await paste('AAA111');
  await paste('BBB222');
  const addCalls = toastSuccess.mock.calls.filter((call) =>
    String(call[0]).includes('ditambahkan'),
  );
  expect(addCalls).toHaveLength(2);
  for (const call of addCalls) expect(call[1]).toMatchObject({ id: 'serial-add' });
  const dismissed = vi.mocked((await import('sonner')).toast.dismiss);
  dismissed.mockClear();
  await paste('AAA111');
  expect(dismissed).toHaveBeenCalledWith('serial-add');
  expect(screen.getByText(/1 duplikat dilewati/)).toBeInTheDocument();
  await paste('CCC333');
  expect(screen.queryByText(/duplikat dilewati/)).toBeNull();
});

test('serial ganda menampilkan pesan dan tidak menambah baris', async () => {
  renderPage();
  await pickDefaults();
  await paste('abc123\nxyz789');
  await paste('ABC123');
  expect(dataRows()).toHaveLength(2);
  expect(screen.getByText(/1 duplikat dilewati/)).toBeInTheDocument();
  expect(screen.getByText('Sudah ada')).toBeInTheDocument();
});

test('serial ganda saat diedit pada sel ditolak dan nilai lama dikembalikan', async () => {
  renderPage();
  await pickDefaults();
  await paste('AAA111\nBBB222');
  const second = screen.getByRole('textbox', { name: 'Serial BBB222' });
  await userEvent.clear(second);
  await userEvent.type(second, 'aaa111');
  await userEvent.tab();
  expect(screen.getByRole('alert')).toHaveTextContent('Serial sudah ada di tabel');
  expect(serialValues()).toEqual(['AAA111', 'BBB222']);
  const first = screen.getByRole('textbox', { name: 'Serial AAA111' });
  await userEvent.clear(first);
  await userEvent.type(first, '4c:5e:0c:1a:2b:3d');
  await userEvent.tab();
  expect(serialValues()).toEqual(['4C5E0C1A2B3D', 'BBB222']);
});

test('ubah massal tiga baris terpilih mengganti lokasi dan hanya baris itu yang berubah', async () => {
  renderPage();
  await pickDefaults();
  await paste('A1\nA2\nA3\nA4');
  for (const serial of ['A1', 'A2', 'A4']) {
    await userEvent.click(screen.getByRole('checkbox', { name: `Pilih baris ${serial}` }));
  }
  expect(screen.getByText('3 dipilih')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await pickLink(screen, 'Lokasi (ubah massal)', 'Surabaya (SBY)');
  await userEvent.click(screen.getByRole('button', { name: 'Terapkan ke 3 baris' }));
  const locations = dataRows().map((row) =>
    within(row).queryByText('Surabaya (SBY)') ? 'SBY' : 'JKT',
  );
  expect(locations).toEqual(['SBY', 'SBY', 'JKT', 'SBY']);
});

test('mengganti item pada baris mengosongkan stiker; detail memuat ulang dengan semua tercentang', async () => {
  renderPage();
  await pickDefaults();
  await paste('A1');
  // Pilihan eksplisit: hanya Stiker A.
  await userEvent.click(screen.getByRole('button', { name: 'Detail A1' }));
  const dialog = await screen.findByRole('dialog');
  const stickerB = await within(dialog).findByRole('checkbox', { name: 'Stiker B' });
  await userEvent.click(stickerB);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Terapkan' }));
  expect(screen.getByText('Stiker A ×1')).toBeInTheDocument();

  // Ganti item lewat ubah massal: pilihan stiker dikosongkan (bawaan semua yang berlaku).
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih baris A1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await pickLink(screen, 'Item (ubah massal)', 'Aruba 2930');
  await userEvent.click(screen.getByRole('button', { name: 'Terapkan ke 1 baris' }));
  expect(screen.queryByText(/^Stiker A ×/)).toBeNull();

  await userEvent.click(screen.getByRole('button', { name: 'Detail A1' }));
  const next = await screen.findByRole('dialog');
  expect(await within(next).findByRole('checkbox', { name: 'Stiker C' })).toBeChecked();
});

test('mencentang jumlah stiker 2 mengirim stickers dengan qty 2 saat simpan', async () => {
  renderPage();
  await pickDefaults();
  await paste('A1');
  await userEvent.click(screen.getByRole('button', { name: 'Detail A1' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('checkbox', { name: 'Stiker A' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tambah Stiker A' }));
  expect(within(dialog).getByLabelText('Jumlah Stiker A')).toHaveTextContent('2');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Terapkan' }));
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(saveCalls).toHaveLength(1));
  expect(saveCalls[0]?.rows[0]?.stickers).toEqual([
    { stickerId: 's1', qty: 2 },
    { stickerId: 's2', qty: 1 },
  ]);
});

test('baris tanpa pilihan stiker memakai semua stiker yang berlaku saat simpan', async () => {
  renderPage();
  await pickDefaults();
  await paste('A1');
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(saveCalls).toHaveLength(1));
  expect(saveCalls[0]?.rows[0]?.stickers).toEqual([
    { stickerId: 's1', qty: 1 },
    { stickerId: 's2', qty: 1 },
  ]);
  await waitFor(() => expect(screen.queryAllByRole('row')).toHaveLength(0));
  expect(screen.getByText('Dibuat 1, duplikat 0, gagal 0.')).toBeInTheDocument();
});

test('simpan 450 baris memanggil mutasi 3 kali dan menghapus baris created', async () => {
  renderPage();
  await pickDefaults();
  const text = Array.from({ length: 450 }, (_, index) => `SN${index}`).join('\n');
  await paste(text);
  expect(dataRows()).toHaveLength(450);
  await userEvent.click(screen.getByRole('button', { name: /^Simpan 450 serial/ }));
  await waitFor(() => expect(saveCalls).toHaveLength(3), { timeout: 10_000 });
  expect(saveCalls.map((call) => call.rows.length)).toEqual([200, 200, 50]);
  await waitFor(() => expect(screen.queryAllByRole('row')).toHaveLength(0));
  expect(screen.getByText('Dibuat 450, duplikat 0, gagal 0.')).toBeInTheDocument();
}, 60_000);

test('baris duplicate dari server tersisa berwarna dan dapat dicoba lagi setelah diedit', async () => {
  renderPage();
  await pickDefaults();
  await paste('A1\nA2');
  resultFor = (row) => (row.serial === 'A2' ? 'duplicate' : 'created');
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(serialValues()).toEqual(['A2']));
  const row = dataRows()[0] as HTMLElement;
  expect(row).toHaveAttribute('data-result', 'duplicate');
  expect(within(row).getByText('Serial sudah terdaftar')).toBeInTheDocument();
  expect(screen.getByText(/Dibuat 1, duplikat 1, gagal 0\./)).toBeInTheDocument();
  // Diedit: penanda hasil dibersihkan; simpan ulang mengirim hanya baris yang tersisa.
  const input = screen.getByRole('textbox', { name: 'Serial A2' });
  await userEvent.clear(input);
  await userEvent.type(input, 'A3');
  await userEvent.tab();
  expect(dataRows()[0]).toHaveAttribute('data-result', 'ok');
  resultFor = () => 'created';
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(saveCalls).toHaveLength(2));
  expect(saveCalls[1]?.rows.map((r) => r.serial)).toEqual(['A3']);
});

test('galat jaringan menandai baris tersisa sebagai error dan menawarkan Coba lagi', async () => {
  renderPage();
  await pickDefaults();
  await paste('A1');
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.saveBatch' ? Promise.reject(new Error('putus')) : original?.(id, input),
  );
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  expect(await screen.findByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  expect(dataRows()[0]).toHaveAttribute('data-result', 'error');
});

test('simpan ditolak bila ada baris tanpa item atau lokasi', async () => {
  // Gerbang Default mencegah baris baru tanpa item; baris tak lengkap datang dari draft lama atau impor.
  const [row] = stagingRows(['A1']);
  if (!row) throw new Error('seed');
  saveDraft('a@gmail.com', [
    { ...row, itemId: '', itemLabel: '', buId: '', buLabel: '', locationId: '', locationLabel: '' },
  ]);
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  expect(screen.getByText(/1 baris belum lengkap/)).toBeInTheDocument();
  expect(saveCalls).toHaveLength(0);
  expect(screen.getByText('Item belum dipilih')).toBeInTheDocument();
});

function stagingRows(serials: string[]): StagingRow[] {
  let n = 0;
  return addSerials(
    [],
    serials.join('\n'),
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

test('impor berkas sah menambah baris; baris dengan item yang tak ditemukan wajib dipilih ulang', async () => {
  const ok = stagingRows(['IMP1']);
  const missing = stagingRows(['IMP2']).map((row) => ({
    ...row,
    clientId: 'row-missing01',
    itemId: 'ghost',
    itemLabel: 'Item Hantu',
  }));
  const text = await exportQcsn([...ok, ...missing], { name: 'qc-web', version: '1' }, new Date());
  renderPage();
  await userEvent.upload(
    screen.getByLabelText('Impor berkas .qcsn'),
    new File([text], 'serial.qcsn', { type: 'application/json' }),
  );
  await waitFor(() => expect(serialValues()).toEqual(['IMP1', 'IMP2']));
  expect(screen.getByText(/serial\.qcsn: 2 baris baru/)).toBeInTheDocument();
  expect(screen.getByText('Pilih ulang item (tidak ditemukan)')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  expect(screen.getByText(/1 baris belum lengkap/)).toBeInTheDocument();
  expect(saveCalls).toHaveLength(0);
});

test('impor berkas rusak menampilkan pesan tanpa mengubah tabel', async () => {
  renderPage();
  await userEvent.upload(
    screen.getByLabelText('Impor berkas .qcsn'),
    new File(['{"bukan":"qcsn"}'], 'rusak.qcsn', { type: 'application/json' }),
  );
  expect(await screen.findByText(/Impor gagal/)).toBeInTheDocument();
  expect(screen.queryAllByRole('row')).toHaveLength(0);
});

test('muat ulang komponen memulihkan draf dari localStorage', async () => {
  const first = renderPage();
  await pickDefaults();
  await paste('KEEP1\nKEEP2');
  first.unmount();
  expect(localStorage.getItem('qc.serial.draft:a@gmail.com')).not.toBeNull();
  renderPage();
  expect(serialValues()).toEqual(['KEEP1', 'KEEP2']);
});

test('kuota penuh menampilkan peringatan draf tidak tersimpan otomatis', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });
  renderPage();
  await pickDefaults();
  await paste('A1');
  expect(await screen.findByText(/Draft tidak tersimpan otomatis/)).toBeInTheDocument();
});

test('onDirtyChange mengikuti isi tabel', async () => {
  const onDirtyChange = vi.fn();
  renderPage({ onDirtyChange });
  await pickDefaults();
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  await paste('A1');
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
});

test('halaman tidak memuat elemen select atau option bawaan', async () => {
  const { container } = renderPage();
  await pickDefaults();
  await paste('A1');
  expect(container.querySelector('select, option, optgroup')).toBeNull();
  expect(document.querySelector('select, option, optgroup')).toBeNull();
});

test('semua baris tersimpan: onAllSaved dipanggil dan draft localStorage kosong', async () => {
  const onAllSaved = vi.fn();
  renderPage({ onAllSaved });
  await pickDefaults();
  await paste('A1\nA2');
  await userEvent.click(screen.getByRole('button', { name: /^Simpan 2 serial/ }));
  await waitFor(() => expect(onAllSaved).toHaveBeenCalledTimes(1), { timeout: 10_000 });
  expect(onAllSaved).toHaveBeenCalledWith(2);
  expect(toastSuccess).toHaveBeenCalledWith('Serial Number berhasil disimpan');
  expect(screen.queryAllByRole('row')).toHaveLength(0);
  const draft = localStorage.getItem('qc.serial.draft:a@gmail.com');
  expect(draft === null || draft === '[]').toBe(true);
});

test('sebagian gagal (duplikat): tidak berpindah halaman; baris sukses keluar, baris gagal tersisa', async () => {
  const onAllSaved = vi.fn();
  renderPage({ onAllSaved });
  await pickDefaults();
  await paste('A1\nA2');
  resultFor = (row) => (row.serial === 'A2' ? 'duplicate' : 'created');
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(serialValues()).toEqual(['A2']));
  expect(onAllSaved).not.toHaveBeenCalled();
});

test('galat jaringan: tidak berpindah halaman', async () => {
  const onAllSaved = vi.fn();
  renderPage({ onAllSaved });
  await pickDefaults();
  await paste('A1');
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.saveBatch' ? Promise.reject(new Error('putus')) : original?.(id, input),
  );
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  expect(await screen.findByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  expect(onAllSaved).not.toHaveBeenCalled();
});

test('halaman ditinggalkan saat simpan berjalan: onAllSaved tidak dipanggil dan draf disinkronkan', async () => {
  const onAllSaved = vi.fn();
  const view = renderPage({ onAllSaved });
  await pickDefaults();
  await paste('A1');
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation(async (id: string, input: Record<string, unknown>) => {
    if (id === 'serials.saveBatch') await gate;
    return original?.(id, input);
  });
  await userEvent.click(screen.getByRole('button', { name: /^Simpan 1 serial/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Menyimpan/ })).toBeDisabled());
  view.unmount();
  release();
  await waitFor(() => expect(saveCalls).toHaveLength(1), { timeout: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(onAllSaved).not.toHaveBeenCalled();
  // Baris sudah tersimpan: draf tidak lagi memuatnya.
  const draft = localStorage.getItem('qc.serial.draft:a@gmail.com');
  expect(draft === null || draft === '[]').toBe(true);
});
