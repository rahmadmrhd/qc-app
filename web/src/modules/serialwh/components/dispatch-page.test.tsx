import type { MeDto, WarehouseSerialDto, WarehouseSubmitInput } from '@shared/contract';
import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
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
        locations: [{ id: 'loc1', name: 'Gudang 1' }],
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
        orderId: 'o1',
        orderNumber: body.header.orderNumber,
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

test('scan serial yang ada: dipilih, Item terisi lalu terkunci dengan pesan', async () => {
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

test('scan belum ada tanpa BU, Lokasi, Tanggal uji: ditahan dan menyebut yang kurang', async () => {
  seedDraft({
    itemId: 'item1',
    rows: [],
    filters: { buId: '', locationId: '', testDate: '', hideRecorded: true },
  });
  await renderPage();
  await scan('baru1');
  expect(await screen.findByText('Isi BU, Lokasi dan Tanggal uji dulu')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Salin ke clipboard \(0\)/ })).toBeDisabled();
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
  await userEvent.type(await screen.findByLabelText('No SO'), 'SO-1');
  await userEvent.type(await screen.findByLabelText('Customer'), 'PT Maju');
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
    await userEvent.type(await screen.findByLabelText('No SO'), 'SO-1');
    await userEvent.type(await screen.findByLabelText('Customer'), 'PT Maju');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
    expect(await screen.findByRole('button', { name: 'Salin lagi' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Daftar Serial Number' })).toHaveValue('AAA');
    expect(submitCalls).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

const draftRow = (serial: string) =>
  makeNewRow({ serial, itemId: 'item1', buId: 'bu1', locationId: 'loc1', testDate: '2026-11-20' });

function usePhone() {
  media.set(false);
  window.innerWidth = 375;
}

const modeExit = () => screen.queryByRole('button', { name: 'Keluar dari mode pilih' });
const copyButton = (count: number) =>
  screen.getByRole('button', {
    name: new RegExp(`Salin ke clipboard \\(${count}\\)`),
    hidden: true,
  });

test('ponsel: draf tidak memicu mode pilih; tekan lama masuk, X keluar tanpa menghapus draf', async () => {
  usePhone();
  seedDraft({ itemId: 'item1', rows: [draftRow('AAA'), draftRow('BBB')] });
  await renderPage();
  const card = (await screen.findByText('AAA')).closest('li') as HTMLElement;
  expect(modeExit()).toBeNull();
  await longPress(card);
  const exit = await screen.findByRole('button', { name: 'Keluar dari mode pilih' });
  // Tekan lama pada baris draf hanya masuk mode: baris tidak keluar dari pilihan.
  expect(copyButton(2)).toBeEnabled();
  await userEvent.click(exit);
  await waitFor(() => expect(modeExit()).toBeNull());
  expect(copyButton(2)).toBeEnabled();
});

test('ponsel: tombol kembali saat mode pilih hanya menutup mode, bukan terjebak dan bukan menghapus draf', async () => {
  usePhone();
  seedDraft({ itemId: 'item1', rows: [draftRow('AAA')] });
  await renderPage();
  await longPress((await screen.findByText('AAA')).closest('li') as HTMLElement);
  await screen.findByRole('button', { name: 'Keluar dari mode pilih' });
  act(() => window.history.back());
  await waitFor(() => expect(modeExit()).toBeNull());
  expect(copyButton(1)).toBeEnabled();
});

test('ponsel: Pilih semua yang mengeluarkan draf baru meminta konfirmasi', async () => {
  usePhone();
  seedDraft({ itemId: 'item1', rows: [draftRow('AAA'), draftRow('BBB')] });
  await renderPage();
  await longPress((await screen.findByText('AAA')).closest('li') as HTMLElement);
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Pilih semua' }));
  expect(await screen.findByText('Keluarkan dari pilihan?')).toBeInTheDocument();
  expect(copyButton(2)).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali' }));
  await waitFor(() => expect(screen.queryByText('Keluarkan dari pilihan?')).toBeNull());
  expect(copyButton(2)).toBeEnabled();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Keluarkan' }));
  await waitFor(() => expect(copyButton(0)).toBeDisabled());
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
  await userEvent.type(await screen.findByLabelText('No SO'), 'SO-1');
  await userEvent.type(await screen.findByLabelText('Customer'), 'PT Maju');
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
    await userEvent.type(await screen.findByLabelText('No SO'), 'SO-1');
    await userEvent.type(await screen.findByLabelText('Customer'), 'PT Maju');
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

test('scan ditahan karena isian kosong: chip yang kurang diberi bingkai merah', async () => {
  seedDraft({
    itemId: 'item1',
    rows: [],
    filters: { buId: 'bu1', locationId: '', testDate: '', hideRecorded: true },
  });
  await renderPage();
  await scan('baru1');
  await screen.findByText('Isi Lokasi dan Tanggal uji dulu');
  const invalid = Array.from(document.querySelectorAll('[data-invalid]')).map(
    (node) => node.textContent ?? '',
  );
  expect(invalid).toHaveLength(2);
  expect(invalid.some((text) => text.includes('Lokasi'))).toBe(true);
  expect(invalid.some((text) => text.includes('Tanggal uji'))).toBe(true);
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
  await userEvent.type(await screen.findByLabelText('No SO'), 'SO-1');
  await userEvent.type(await screen.findByLabelText('Customer'), 'PT Maju');
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
