import type { MeDto, WarehouseSerialDto, WarehouseSubmitInput } from '@shared/contract';
import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { pickLink } from '@/test/link-field';
import { longPress } from '@/test/long-press';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { isWarehouseSubmitting } from '../lib/active-submission';
import { makeExistingRow, makeNewRow } from '../lib/draft';
import {
  clearAllWarehouseDrafts,
  enableWarehouseDraftWrites,
  readWarehouseDraft,
  type WarehouseDraft,
  warehouseDraftWritesBlocked,
  writeWarehouseDraft,
} from '../lib/draft-store';
import { whItem, whMe, whSerial } from '../lib/test-support';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));
vi.mock('@/modules/markdown/wysiwyg-editor', () => ({
  WysiwygEditor: (props: { id: string; value: string; onChange: (v: string) => void }) => (
    <textarea
      id={props.id}
      aria-label="Isi catatan"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { DispatchPage } from './dispatch-page';

let media: ReturnType<typeof mockMatchMedia>;
let lookupResult: WarehouseSerialDto[] = [];
let serialsPage: WarehouseSerialDto[] = [];
const submitCalls: WarehouseSubmitInput[] = [];
let submitSkip: { serial: string; reason: string }[] = [];

function api(id: string, input: Record<string, unknown>) {
  switch (id) {
    case 'serialWarehouse.options':
      return Promise.resolve({
        locations: [
          { id: 'loc1', name: 'Gudang 1' },
          { id: 'loc2', name: 'Gudang 2' },
        ],
        customers: [{ id: 'c1', name: 'PT Maju' }],
        inactiveCustomerNames: [],
      });
    case 'serialWarehouse.itemOptions': {
      const ids = input.ids as string[] | undefined;
      const items = [
        whItem(),
        whItem({ id: 'item2', label: 'Tenda SG8', brandName: 'Tenda', model: 'SG8' }),
      ];
      return Promise.resolve({
        items: ids ? items.filter((entry) => ids.includes(entry.id)) : items,
        nextCursor: null,
      });
    }
    case 'serialWarehouse.serials':
      return Promise.resolve({ items: serialsPage, nextCursor: null });
    case 'serialWarehouse.lookup':
      return Promise.resolve({ found: lookupResult });
    case 'serialWarehouse.orderOptions':
      return Promise.resolve({ items: [], nextCursor: null });
    case 'serialWarehouse.handoverCandidates':
      return Promise.resolve({ linked: [], items: [], nextCursor: null });
    case 'serialWarehouse.submit': {
      const body = input as unknown as WarehouseSubmitInput;
      submitCalls.push(body);
      const total = body.header.total;
      const chunkCount = Math.ceil(total / body.header.chunkSize);
      const done = body.chunkIndex + 1 === chunkCount;
      return Promise.resolve({
        dispatchId: 'd1',
        ...(body.header.mode === 'note'
          ? {}
          : { orderId: 'o1', orderNumber: body.header.orderNumber }),
        status: done ? 'done' : 'pending',
        chunksReceived: body.chunkIndex + 1,
        chunkCount,
        created: 0,
        skipped: submitSkip.filter((entry) => body.rows.some((row) => row.serial === entry.serial)),
        ...(done
          ? {
              serials: body.rows
                .map((row) => row.serial)
                .filter((serial) => !submitSkip.some((entry) => entry.serial === serial)),
              skippedTotal: submitSkip,
            }
          : {}),
      });
    }
    default:
      return Promise.resolve(null);
  }
}

function seedDraft(draft: Partial<WarehouseDraft> & Pick<WarehouseDraft, 'rows'>) {
  writeWarehouseDraft('wh@x.com', {
    v: 1,
    itemId: draft.itemId ?? '',
    filters: draft.filters ?? {
      buId: 'bu1',
      locationId: 'loc1',
      testDate: '2026-11-20',
      hideRecorded: true,
    },
    rows: draft.rows,
    ...(draft.submission ? { submission: draft.submission } : {}),
  });
}

async function renderPage(props: { handoverId?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderInRouter(<DispatchPage {...props} onCancel={vi.fn()} />, { client });
}

beforeEach(() => {
  localStorage.clear();
  enableWarehouseDraftWrites();
  submitCalls.length = 0;
  submitSkip = [];
  lookupResult = [];
  serialsPage = [];
  me = whMe(['bu1', 'bu2']);
  media = mockMatchMedia(true);
  apiMock.mockImplementation(api);
});

afterEach(() => {
  window.innerWidth = 1024;
  media.restore();
  apiMock.mockReset();
});

async function scan(text: string) {
  const input = await screen.findByRole('textbox', { name: 'Serial Number' });
  await userEvent.type(input, `${text}{Enter}`);
}

test('tabel kosong sebelum Item terisi', async () => {
  await renderPage();
  expect(await screen.findByText('Pilih Item atau scan serial untuk mulai')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Salin ke clipboard \(0\)/ })).toBeDisabled();
});

test('scan serial yang ada: dipilih, lalu Item terkunci dengan pesan', async () => {
  seedDraft({ itemId: 'item1', rows: [] });
  lookupResult = [whSerial()];
  await renderPage();
  await scan('sn1');
  expect(await screen.findByText(/Terkunci karena 1 serial sudah dipilih/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Salin ke clipboard \(1\)/ })).toBeEnabled();
});

test('scan beda Tipe tanpa pilihan: tawaran Ganti Item', async () => {
  seedDraft({ itemId: 'item1', rows: [] });
  lookupResult = [whSerial({ id: 'x', serial: 'SN9', itemId: 'item2', itemLabel: 'Tenda SG8' })];
  await renderPage();
  await scan('sn9');
  expect(await screen.findByText('Ganti Item ke Tenda SG8?')).toBeInTheDocument();
});

test('scan beda Tipe dengan pilihan: dialog error, tidak dipilih', async () => {
  seedDraft({ itemId: 'item1', rows: [makeExistingRow(whSerial())] });
  lookupResult = [whSerial({ id: 'x', serial: 'SN9', itemId: 'item2', itemLabel: 'Tenda SG8' })];
  await renderPage();
  await scan('sn9');
  expect(await screen.findByText('Beda Tipe')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /Salin ke clipboard \(1\)/, hidden: true }),
  ).toBeInTheDocument();
});

test('scan belum ada tanpa BU, Lokasi, Tanggal uji: tetap jadi draf baru', async () => {
  seedDraft({
    itemId: 'item1',
    rows: [],
    filters: { buId: '', locationId: '', testDate: '', hideRecorded: true },
  });
  await renderPage();
  await scan('baru1');
  expect(await screen.findByText('Draf baru')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Salin ke clipboard \(1\)/ })).toBeEnabled();
});

test('kolom Serial Number terkunci sampai Item terisi', async () => {
  seedDraft({ itemId: '', rows: [] });
  await renderPage();
  const input = screen.getByRole('textbox', { name: 'Serial Number' });
  expect(input).toBeDisabled();
  expect(input).toHaveAttribute('placeholder', 'Pilih Item dulu');
});

test('scan belum ada dengan isian lengkap: jadi draf baru', async () => {
  seedDraft({ itemId: 'item1', rows: [] });
  await renderPage();
  await scan('baru1');
  expect(await screen.findByText('Draf baru')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Salin ke clipboard \(1\)/ })).toBeEnabled();
});

test('dua scan cepat satu SN tidak menjadi dua draf', async () => {
  seedDraft({ itemId: 'item1', rows: [] });
  await renderPage();
  const input = await screen.findByRole('textbox', { name: 'Serial Number' });
  await userEvent.type(input, 'baru1{Enter}baru1{Enter}');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Salin ke clipboard \(1\)/ })).toBeInTheDocument(),
  );
});

test('draf tahan muat ulang', async () => {
  seedDraft({ itemId: 'item1', rows: [] });
  lookupResult = [whSerial()];
  const first = await renderPage();
  await scan('sn1');
  await screen.findByText(/Terkunci karena 1 serial/);
  // Tulis tertunda ~300 ms; lepas halaman juga menguras tulisan.
  first.unmount();
  await renderPage();
  expect(
    await screen.findByRole('button', { name: /Salin ke clipboard \(1\)/ }),
  ).toBeInTheDocument();
});

test('pemangkasan pilihan kit tidak menghapus draf yang tidak ditampilkan', async () => {
  // Lebih banyak dari satu halaman tampil (200): baris sisanya tidak dirender, tetapi tetap terpilih.
  const rows = Array.from({ length: 250 }, (_, index) =>
    makeNewRow({
      serial: `SN${index}`,
      itemId: 'item1',
      buId: 'bu1',
      locationId: 'loc1',
      testDate: '2026-11-20',
    }),
  );
  seedDraft({ itemId: 'item1', rows });
  await renderPage();
  expect(await screen.findByRole('button', { name: /Salin ke clipboard \(250\)/ })).toBeEnabled();
  expect(
    screen.getByRole('button', { name: /Tampilkan lebih banyak \(50 lebih lama\)/ }),
  ).toBeInTheDocument();
  // Beri waktu efek pemangkasan kit berjalan; jumlah tetap.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.getByRole('button', { name: /Salin ke clipboard \(250\)/ })).toBeEnabled();
});

test('urutan draf tetap urutan scan walau ponsel menampilkan yang terbaru di atas', async () => {
  media.set(false);
  window.innerWidth = 375;
  seedDraft({
    itemId: 'item1',
    rows: [
      makeNewRow({
        serial: 'AAA',
        itemId: 'item1',
        buId: 'bu1',
        locationId: 'loc1',
        testDate: '2026-11-20',
      }),
      makeNewRow({
        serial: 'BBB',
        itemId: 'item1',
        buId: 'bu1',
        locationId: 'loc1',
        testDate: '2026-11-20',
      }),
    ],
  });
  await renderPage();
  const titles = await screen.findAllByText(/^(AAA|BBB)$/);
  expect(titles.map((node) => node.textContent)).toEqual(['BBB', 'AAA']);
  await userEvent.click(screen.getByRole('button', { name: /Salin ke clipboard \(2\)/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  await waitFor(() => expect(submitCalls).toHaveLength(1));
  // Urutan kiriman (= seq = clipboard) tetap urutan scan.
  expect(submitCalls[0]?.rows.map((row) => row.serial)).toEqual(['AAA', 'BBB']);
});

test('clipboard gagal: dialog Salin lagi muncul tanpa mengirim ulang', async () => {
  const write = vi.fn().mockRejectedValue(new Error('ditolak'));
  const writeText = vi.fn().mockRejectedValue(new Error('ditolak'));
  Object.defineProperty(navigator, 'clipboard', {
    value: { write, writeText },
    configurable: true,
  });
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(public items: unknown) {}
    },
  );
  try {
    seedDraft({
      itemId: 'item1',
      rows: [
        makeNewRow({
          serial: 'AAA',
          itemId: 'item1',
          buId: 'bu1',
          locationId: 'loc1',
          testDate: '2026-11-20',
        }),
      ],
    });
    await renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Salin ke clipboard \(1\)/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
    expect(await screen.findByRole('button', { name: 'Salin lagi' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Daftar Serial Number' })).toHaveValue('AAA');
    expect(submitCalls).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

test('header catatan: mode note tanpa SO, customer, dan orderId; kardus awal 1', async () => {
  seedDraft({
    itemId: 'item1',
    rows: [
      makeNewRow({
        serial: 'AAA',
        itemId: 'item1',
        buId: 'bu1',
        locationId: 'loc1',
        testDate: '2026-11-20',
      }),
    ],
  });
  await renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /Salin ke clipboard \(1\)/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Simpan & salin' }));
  await waitFor(() => expect(submitCalls).toHaveLength(1));
  const header = submitCalls[0]?.header;
  expect(header).toMatchObject({ mode: 'note', orderNumber: '', customerName: '', buId: 'bu1' });
  expect(header).not.toHaveProperty('orderId');
});

test('serial baru tanpa lokasi dan tanggal uji: memakai Lokasi dialog dan tanggal keluar', async () => {
  seedDraft({
    itemId: 'item1',
    rows: [],
    filters: { buId: 'bu1', locationId: '', testDate: '', hideRecorded: true },
  });
  await renderPage();
  await scan('baru1');
  await userEvent.click(await screen.findByRole('button', { name: /Salin ke clipboard \(1\)/ }));
  await pickLink(screen, 'Lokasi', 'Gudang 1');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  await waitFor(() => expect(submitCalls).toHaveLength(1));
  const call = submitCalls[0];
  expect(call?.rows[0]).toMatchObject({
    kind: 'new',
    serial: 'BARU1',
    locationId: 'loc1',
    testDate: call?.header.dispatchedOn,
  });
});

test('Lokasi dialog menjadi lokasi semua serial baru, menimpa lokasi chip saat scan', async () => {
  seedDraft({
    itemId: 'item1',
    rows: [
      makeNewRow({
        serial: 'AAA',
        itemId: 'item1',
        buId: 'bu1',
        locationId: 'loc1',
        testDate: '2026-11-20',
      }),
    ],
    filters: { buId: 'bu1', locationId: 'loc1', testDate: '2026-11-20', hideRecorded: true },
  });
  await renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /Salin ke clipboard \(1\)/ }));
  await pickLink(screen, 'Lokasi', 'Gudang 2');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  await waitFor(() => expect(submitCalls).toHaveLength(1));
  expect(submitCalls[0]?.rows[0]).toMatchObject({ kind: 'new', locationId: 'loc2' });
});

test('chip Tanggal uji yang terisi menang atas tanggal keluar untuk serial baru', async () => {
  seedDraft({
    itemId: 'item1',
    rows: [
      makeNewRow({ serial: 'AAA', itemId: 'item1', buId: 'bu1', locationId: 'loc1', testDate: '' }),
    ],
    filters: { buId: 'bu1', locationId: 'loc1', testDate: '2026-11-18', hideRecorded: true },
  });
  await renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /Salin ke clipboard \(1\)/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Simpan & salin' }));
  await waitFor(() => expect(submitCalls).toHaveLength(1));
  expect(submitCalls[0]?.rows[0]).toMatchObject({ kind: 'new', testDate: '2026-11-18' });
});

test('urutan kiriman mengikuti urutan serial dipilih dari tabel, bukan urutan tampil', async () => {
  serialsPage = [
    whSerial({ id: 's1', serial: 'S1' }),
    whSerial({ id: 's2', serial: 'S2' }),
    whSerial({ id: 's3', serial: 'S3' }),
  ];
  seedDraft({ itemId: 'item1', rows: [] });
  await renderPage();
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih S3' }));
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih S1' }));
  await userEvent.click(await screen.findByRole('button', { name: /Salin ke clipboard \(2\)/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Simpan & salin' }));
  await waitFor(() => expect(submitCalls).toHaveLength(1));
  expect(submitCalls[0]?.rows.map((row) => row.serial)).toEqual(['S3', 'S1']);
});

const draftRow = (serial: string) =>
  makeNewRow({ serial, itemId: 'item1', buId: 'bu1', locationId: 'loc1', testDate: '2026-11-20' });

function usePhone() {
  media.set(false);
  window.innerWidth = 375;
}

const copyButton = (count: number) =>
  screen.getByRole('button', {
    name: new RegExp(`Salin ke clipboard \\(${count}\\)`),
    hidden: true,
  });

test('ponsel: tekan lama tidak memunculkan bar di atas kartu dan draf tetap utuh', async () => {
  usePhone();
  seedDraft({ itemId: 'item1', rows: [draftRow('AAA'), draftRow('BBB')] });
  await renderPage();
  const card = (await screen.findByText('AAA')).closest('li') as HTMLElement;
  expect(document.querySelector('[data-slot="selection-bar"]')).toBeNull();
  await longPress(card);
  expect(document.querySelector('[data-slot="selection-bar"]')).toBeNull();
  // Satu-satunya bar pilihan ada di bawah (bersama Batal dan Simpan form).
  expect(screen.getByText('2 dipilih')).toBeInTheDocument();
  expect(copyButton(2)).toBeEnabled();
});

test('ponsel: tombol kembali setelah tekan lama tidak terjebak dan tidak menghapus draf', async () => {
  usePhone();
  seedDraft({ itemId: 'item1', rows: [draftRow('AAA')] });
  await renderPage();
  await longPress((await screen.findByText('AAA')).closest('li') as HTMLElement);
  act(() => window.history.back());
  await waitFor(() => expect(copyButton(1)).toBeEnabled());
  expect(screen.getByText('1 dipilih')).toBeInTheDocument();
});

test('ponsel: ✕ dan kotak centang bar bawah meminta konfirmasi saat mengosongkan draf baru', async () => {
  usePhone();
  seedDraft({ itemId: 'item1', rows: [draftRow('AAA'), draftRow('BBB')] });
  await renderPage();
  await screen.findByText('AAA');
  // Semua terpilih: kotak centang berlabel "Lepas semua" dan sama dengan ✕ (membatalkan seluruh pilihan).
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Lepas semua' }));
  expect(await screen.findByText('Batalkan pilihan?')).toBeInTheDocument();
  expect(copyButton(2)).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali' }));
  await waitFor(() => expect(screen.queryByText('Batalkan pilihan?')).toBeNull());
  expect(copyButton(2)).toBeEnabled();
  const summary = document.querySelector('[data-slot="selection-summary"]') as HTMLElement;
  await userEvent.click(within(summary).getByRole('button', { name: 'Batalkan pilihan' }));
  expect(await screen.findByText('Batalkan pilihan?')).toBeInTheDocument();
});

test('ponsel: lebih dari satu halaman menampilkan serial TERBARU di atas', async () => {
  usePhone();
  const rows = Array.from({ length: 250 }, (_, index) => draftRow(`SN${index}`));
  seedDraft({ itemId: 'item1', rows });
  await renderPage();
  const titles = await screen.findAllByText(/^SN\d+$/);
  expect(titles[0]?.textContent).toBe('SN249');
  expect(titles.some((node) => node.textContent === 'SN0')).toBe(false);
}, 60_000);

test('desktop: lebih dari satu halaman tetap menampilkan serial terbaru', async () => {
  const rows = Array.from({ length: 250 }, (_, index) => draftRow(`SN${index}`));
  seedDraft({ itemId: 'item1', rows });
  await renderPage();
  expect(await screen.findByText('SN249')).toBeInTheDocument();
  expect(screen.queryByText('SN0')).toBeNull();
}, 60_000);

test('hasil scan disorot sebentar, termasuk serial yang sudah ada di pilihan', async () => {
  seedDraft({ itemId: 'item1', rows: [draftRow('AAA')] });
  await renderPage();
  const highlighted = (text: string) =>
    (screen.getByText(text).closest('tr') as HTMLElement).hasAttribute('data-highlight');
  await scan('baru2');
  await screen.findByText('BARU2');
  expect(highlighted('BARU2')).toBe(true);
  expect(highlighted('AAA')).toBe(false);
  await scan('aaa');
  await waitFor(() => expect(highlighted('AAA')).toBe(true));
});

test('setelah potongan terkirim, cache serialwh ditandai basi lewat mutasi bersama', async () => {
  seedDraft({ itemId: 'item1', rows: [draftRow('AAA')] });
  const { queryClient } = await renderPage();
  const spy = vi.spyOn(queryClient, 'invalidateQueries');
  await userEvent.click(await screen.findByRole('button', { name: /Salin ke clipboard \(1\)/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  await waitFor(() => expect(submitCalls).toHaveLength(1));
  await waitFor(() => {
    const keys = spy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(['serialwh']));
  });
});

test('klip dimulai sinkron dari klik Simpan & salin (sebelum menunggu server)', async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { write, writeText: vi.fn() },
    configurable: true,
  });
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(public items: unknown) {}
    },
  );
  try {
    seedDraft({ itemId: 'item1', rows: [draftRow('AAA')] });
    await renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Salin ke clipboard \(1\)/ }));
    const save = screen.getByRole('button', { name: 'Simpan & salin' });
    // Klik mentah: pemeriksaan tepat setelah handler sinkron, sebelum mikrotask lain berjalan.
    act(() => {
      save.click();
    });
    expect(write).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

test('banner peringatan dapat dibuka untuk melihat serialnya; baris menyebut SO dan tanggal pengeluaran lama', async () => {
  seedDraft({
    itemId: 'item1',
    rows: [
      makeExistingRow(
        whSerial({
          id: 'x1',
          serial: 'PRIOR1',
          dispatches: [
            {
              orderId: 'o9',
              orderNumber: 'SO-9',
              buId: 'bu1',
              buCode: 'A',
              dispatchedOn: '2026-11-10',
            },
          ],
        }),
      ),
    ],
  });
  await renderPage();
  const summary = await screen.findByText(/sebelumnya sudah keluar di BU ini/);
  expect(screen.getAllByText(/PRIOR1/).length).toBeGreaterThan(0);
  expect(summary.closest('details')).not.toBeNull();
  expect(screen.getByText(/Pernah keluar di BU ini \(SO-9, /)).toBeInTheDocument();
});

async function sendDraft() {
  await userEvent.click(await screen.findByRole('button', { name: /Salin ke clipboard \(\d+\)/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
}

function stubClipboard() {
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { write, writeText: vi.fn() },
    configurable: true,
  });
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(public items: unknown) {}
    },
  );
}
function unstubClipboard() {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'clipboard');
}

test('kiriman campuran: yang berhasil keluar dari draf, yang dilewati tetap ditandai alasan dan tampil di dialog', async () => {
  stubClipboard();
  try {
    submitSkip = [{ serial: 'BBB', reason: 'Tipe berbeda' }];
    seedDraft({ itemId: 'item1', rows: [draftRow('AAA'), draftRow('BBB')] });
    await renderPage();
    await sendDraft();
    expect(await screen.findByText('Dilewati (1)')).toBeInTheDocument();
    expect(screen.getByTestId('skipped-list')).toHaveTextContent('BBB: Tipe berbeda');
    expect(screen.getByRole('textbox', { name: 'Daftar Serial Number' })).toHaveValue('AAA');
    await userEvent.click(screen.getByRole('button', { name: /Tutup|Close/i }));
    expect(await screen.findByText('BBB')).toBeInTheDocument();
    expect(screen.queryByText('AAA')).toBeNull();
    expect(screen.getByText('Tipe berbeda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salin ke clipboard \(1\)/ })).toBeEnabled();
  } finally {
    unstubClipboard();
  }
});

test('semua baris dilewati: selesai dengan daftar kosong dan semua baris tetap di draf', async () => {
  stubClipboard();
  try {
    submitSkip = [
      { serial: 'AAA', reason: 'Serial tidak ditemukan' },
      { serial: 'BBB', reason: 'Sudah ada di SO ini' },
    ];
    seedDraft({ itemId: 'item1', rows: [draftRow('AAA'), draftRow('BBB')] });
    await renderPage();
    await sendDraft();
    expect(await screen.findByText('Dilewati (2)')).toBeInTheDocument();
    expect(screen.getByText('Tidak ada Serial Number yang tersimpan.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Daftar Serial Number' })).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: /Tutup|Close/i }));
    await waitFor(() => expect(copyButton(2)).toBeEnabled());
  } finally {
    unstubClipboard();
  }
});

test('penanda kiriman berjalan menyala selama potongan dikirim dan padam setelah selesai', async () => {
  stubClipboard();
  try {
    seedDraft({ itemId: 'item1', rows: [draftRow('AAA')] });
    await renderPage();
    expect(isWarehouseSubmitting()).toBe(false);
    await sendDraft();
    await screen.findByText('Daftar Serial Number');
    await waitFor(() => expect(isWarehouseSubmitting()).toBe(false));
  } finally {
    unstubClipboard();
  }
});

test('logout saat halaman terpasang: draf tidak tertulis lagi saat halaman dilepas', async () => {
  seedDraft({ itemId: 'item1', rows: [draftRow('AAA')] });
  const view = await renderPage();
  await screen.findByRole('button', { name: /Salin ke clipboard \(1\)/ });
  clearAllWarehouseDrafts();
  expect(readWarehouseDraft('wh@x.com')).toBeNull();
  view.unmount();
  expect(readWarehouseDraft('wh@x.com')).toBeNull();
  // Halaman dibuka lagi (sesi baru) mengizinkan penulisan normal.
  expect(warehouseDraftWritesBlocked()).toBe(true);
  await renderPage();
  expect(warehouseDraftWritesBlocked()).toBe(false);
});

test('kiriman yang selesai setelah logout tidak menulis draf lagi', async () => {
  stubClipboard();
  try {
    seedDraft({ itemId: 'item1', rows: [draftRow('AAA')] });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    apiMock.mockImplementation(async (id: string, input: Record<string, unknown>) => {
      if (id === 'serialWarehouse.submit') await gate;
      return api(id, input);
    });
    await renderPage();
    await sendDraft();
    await waitFor(() => expect(isWarehouseSubmitting()).toBe(true));
    clearAllWarehouseDrafts();
    release();
    await waitFor(() => expect(isWarehouseSubmitting()).toBe(false));
    expect(readWarehouseDraft('wh@x.com')).toBeNull();
  } finally {
    unstubClipboard();
  }
});

test('galat INTERNAL pada potongan pertama: kiriman beku dipertahankan (clientId sama, bisa dilanjutkan)', async () => {
  seedDraft({ itemId: 'item1', rows: [draftRow('AAA')] });
  let fail = true;
  apiMock.mockImplementation(async (id: string, input: Record<string, unknown>) => {
    if (id === 'serialWarehouse.submit' && fail) {
      submitCalls.push(input as unknown as WarehouseSubmitInput);
      throw new ApiError('INTERNAL', 'Gateway timeout', '-');
    }
    return api(id, input);
  });
  await renderPage();
  await sendDraft();
  expect(await screen.findByRole('button', { name: 'Lanjutkan' })).toBeInTheDocument();
  expect(copyButton(1)).toBeDisabled();
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Lanjutkan' }));
  await waitFor(() => expect(submitCalls).toHaveLength(2));
  expect(submitCalls[1]?.clientId).toBe(submitCalls[0]?.clientId);
});

test('serial recorded tanpa rujukan terbaca tetap berlencana Tercatat WH; rujukan tanpa No SO tampil kode BU', async () => {
  seedDraft({
    itemId: 'item1',
    rows: [
      makeExistingRow(whSerial({ id: 'r1', serial: 'REC1', recorded: true, dispatches: [] })),
      makeExistingRow(
        whSerial({
          id: 'r2',
          serial: 'REC2',
          recorded: true,
          dispatches: [{ buCode: 'Z', dispatchedOn: '2026-11-10' }],
        }),
      ),
    ],
  });
  await renderPage();
  const row1 = (await screen.findByText('REC1')).closest('tr') as HTMLElement;
  expect(row1).toHaveTextContent('Tercatat WH');
  expect(row1).toHaveTextContent('Pernah keluar di BU lain');
  const row2 = screen.getByText('REC2').closest('tr') as HTMLElement;
  expect(row2).toHaveTextContent('Tercatat WH');
  expect(row2).toHaveTextContent(/Pernah keluar di BU lain \(BU Z, /);
});

function seedOneNewRow() {
  seedDraft({
    itemId: 'item1',
    rows: [
      makeNewRow({
        serial: 'RDY1',
        itemId: 'item1',
        buId: 'bu1',
        locationId: 'loc1',
        testDate: '2026-11-20',
      }),
    ],
  });
}

test('catatan: isi per kardus bawaan dari Item; hasil membuka detail riwayat', async () => {
  seedOneNewRow();
  const { router } = await renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /Salin ke clipboard \(1\)/ }));
  await waitFor(() => expect(screen.getByLabelText('Isi per kardus')).toHaveValue(12));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  await waitFor(() => expect(submitCalls).toHaveLength(1));
  expect(submitCalls[0]?.header).toMatchObject({
    mode: 'note',
    handoverIds: [],
    buId: 'bu1',
    boxStart: 1,
    boxSize: 12,
  });
  expect(await screen.findByRole('textbox', { name: 'Daftar Serial Number' })).toHaveValue('RDY1');
  await userEvent.click(screen.getByRole('button', { name: 'Buka riwayat' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/serial/gudang/riwayat/d1'));
});

test('filter Sembunyikan yang sudah tercatat memakai forMode note', async () => {
  seedOneNewRow();
  await renderPage();
  const serialsCalls = () =>
    apiMock.mock.calls.filter((call) => call[0] === 'serialWarehouse.serials');
  await waitFor(() => expect(serialsCalls().length).toBeGreaterThan(0));
  expect(serialsCalls().at(-1)?.[1]).toMatchObject({ forMode: 'note' });
});

test('desktop: bar pilihan di atas tabel (Batalkan pilihan + jumlah), tanpa menu Riwayat/Kosongkan di header', async () => {
  seedDraft({ itemId: 'item1', rows: [makeExistingRow(whSerial())] });
  await renderPage();
  const bar = await screen.findByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByText('1 dipilih')).toBeInTheDocument();
  expect(within(bar).getByRole('button', { name: 'Batalkan pilihan' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Aksi lainnya' })).toBeNull();
  await userEvent.click(within(bar).getByRole('button', { name: 'Batalkan pilihan' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Aksi massal' })).toBeNull());
});

test('ponsel: satu bar bawah berisi ✕, kotak centang, N dipilih, Batal, dan Simpan; tanpa bar di atas kartu', async () => {
  media.set(false);
  window.innerWidth = 390;
  seedDraft({ itemId: 'item1', rows: [makeExistingRow(whSerial())] });
  await renderPage();
  const summary = await screen.findByText('1 dipilih');
  const bar = summary.closest('[data-slot="selection-summary"]') as HTMLElement;
  expect(bar).not.toBeNull();
  expect(within(bar).getByRole('button', { name: 'Batalkan pilihan' })).toBeInTheDocument();
  expect(within(bar).getByRole('checkbox')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Aksi massal' })).toBeNull();
  expect(document.querySelector('[data-slot="selection-bar"]')).toBeNull();
  expect(screen.getByRole('button', { name: 'Batal' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Salin ke clipboard \(1\)/ })).toBeInTheDocument();
});
