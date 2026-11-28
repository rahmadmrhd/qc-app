import type { MeDto, SerialExistingDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { expectLinkValue, pickLink } from '@/test/link-field';
import type { StagingExisting, StagingRow } from '../lib/draft';
import { clearAllDrafts, resumeDraftWrites, saveDraft } from '../lib/draft-store';
import { makeRow, testMe } from '../test-support';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn(), dismiss: vi.fn() } }));

// Pencarian serial memakai jeda (debounce): di bawah beban tes paralel waktu tunggu bawaan 1 dtk terlalu sempit.
configure({ asyncUtilTimeout: 5000 });

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { RecordPage } from './record-page';

// Mencatat serial yang sudah ada = Cek ulang (keunikan se-sistem; spek serial unik §6).

function existing(over: Partial<SerialExistingDto> = {}): SerialExistingDto {
  return {
    serial: 'OLD001',
    id: 'sn-old',
    itemId: 'i9',
    itemLabel: 'Item Catatan',
    buId: 'b2',
    buCode: 'BU2',
    buName: 'Business Unit 2',
    status: 'good',
    hasOpenCase: false,
    proofRequired: false,
    proofMin: 0,
    recheckBuIds: ['b2', 'b3'],
    ...over,
  };
}

let found: SerialExistingDto[] = [];
let lookupCalls: string[][] = [];
let lookupFails = false;
/** Bila diisi, jawaban `serials.lookupMany` tertahan sampai janji ini diselesaikan (tes deterministik, tanpa waktu). */
let lookupGate: Promise<void> | null = null;
let stickerCalls: { itemId: string; buId: string; serialId?: unknown }[] = [];
let saved: {
  serial: string;
  itemId: string;
  buId: string;
  sample: boolean;
  stickers: unknown[];
}[] = [];
let saveResult: 'created' | 'rechecked' = 'created';

beforeEach(() => {
  localStorage.clear();
  me = testMe();
  found = [];
  lookupCalls = [];
  lookupFails = false;
  lookupGate = null;
  stickerCalls = [];
  saved = [];
  saveResult = 'created';
  toastSuccess.mockClear();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.locationOptions') {
      return Promise.resolve({ locations: [{ id: 'l1', code: 'JKT', name: 'Jakarta' }] });
    }
    if (id === 'serials.buOptions') {
      return Promise.resolve({
        businessUnits: [
          { id: 'b1', code: 'BU1', name: 'Business Unit 1' },
          { id: 'b2', code: 'BU2', name: 'Business Unit 2' },
          { id: 'b3', code: 'BU3', name: 'Business Unit 3' },
        ],
      });
    }
    if (id === 'serials.itemOptions') {
      const items = [
        {
          id: 'i1',
          label: 'Cisco C9200',
          buIds: ['b1'],
          buOptions: [{ id: 'b1', code: 'BU1', name: 'Business Unit 1' }],
        },
      ];
      const ids = input.itemIds as string[] | undefined;
      return Promise.resolve({
        items: ids ? items.filter((item) => ids.includes(item.id)) : items,
        nextCursor: null,
      });
    }
    if (id === 'serials.stickerOptions') {
      stickerCalls.push({
        itemId: String(input.itemId),
        buId: String(input.buId),
        serialId: input.serialId,
      });
      // Item catatan (i9) tak terlihat bagi pengguna: hanya jalur cek ulang (serialId) yang boleh memuat stikernya.
      if (input.itemId !== 'i1' && input.serialId === undefined) {
        return Promise.reject(new Error('tidak ditemukan'));
      }
      return Promise.resolve({
        stickers: [{ id: 's1', name: 'Stiker A', alias: '', typeName: 'Jenis', defaultQty: 1 }],
      });
    }
    if (id === 'serials.lookupMany') {
      lookupCalls.push(input.serials as string[]);
      if (lookupFails) return Promise.reject(new Error('jaringan'));
      const asked = new Set(input.serials as string[]);
      const answer = () => ({ found: found.filter((entry) => asked.has(entry.serial)) });
      return lookupGate ? lookupGate.then(answer) : Promise.resolve(answer());
    }
    if (id === 'serials.saveBatch') {
      const rows = input.rows as {
        clientId: string;
        serial: string;
        itemId: string;
        buId: string;
        sample: boolean;
        stickers: unknown[];
      }[];
      for (const row of rows) saved.push(row);
      return Promise.resolve({
        results: rows.map((row) => ({
          clientId: row.clientId,
          result: row.serial === 'OLD001' ? saveResult : 'created',
          message: '',
        })),
      });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

afterEach(() => {
  clearAllDrafts();
  vi.restoreAllMocks();
  apiMock.mockReset();
});

function renderPage(props: { onAllSaved?: (created: number) => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RecordPage {...props} />
    </QueryClientProvider>,
  );
}

async function pickDefaults() {
  await pickLink(screen, 'Item', 'Cisco C9200');
  await expectLinkValue(screen, 'Lokasi', 'Jakarta (JKT)');
  await expectLinkValue(screen, 'Business Unit', 'BU1 - Business Unit 1');
}

async function paste(text: string) {
  await userEvent.click(screen.getByLabelText('Scan atau tempel serial (satu per baris)'));
  await userEvent.paste(text);
  if (!text.includes('\n')) await userEvent.keyboard('{Enter}');
}

const rowOf = async (serial: string) =>
  (await screen.findByLabelText(`Pilih baris ${serial}`)).closest('tr') as HTMLElement;

const sameSite = {
  unitLocationId: 'l1',
  unitLocationLabel: 'Jakarta (JKT)',
  lastEventAt: '2026-11-25T03:00:00.000Z',
  lastActorName: 'Budi',
};

test('BU dan lokasi sama dengan catatan terakhir: dialog muncul, Lanjut menyimpan memanggil saveBatch', async () => {
  found = [existing({ buId: 'b1', buCode: 'BU1', recheckBuIds: ['b1'], ...sameSite })];
  saveResult = 'rechecked';
  renderPage();
  await pickDefaults();
  await paste('OLD001');
  await waitFor(() => expect(screen.getByText('Cek ulang')).toBeInTheDocument());
  await userEvent.click(await screen.findByRole('button', { name: /^Simpan/ }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText('Lanjut atau tidak?')).toBeInTheDocument();
  expect(within(dialog).getByText('OLD001')).toBeInTheDocument();
  expect(within(dialog).getByText(/oleh Budi/)).toBeInTheDocument();
  expect(saved).toHaveLength(0);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Lanjut menyimpan' }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

test('Batal pada dialog tidak menyimpan dan draf tetap utuh', async () => {
  found = [existing({ buId: 'b1', buCode: 'BU1', recheckBuIds: ['b1'], ...sameSite })];
  renderPage();
  await pickDefaults();
  await paste('OLD001');
  await waitFor(() => expect(screen.getByText('Cek ulang')).toBeInTheDocument());
  await userEvent.click(await screen.findByRole('button', { name: /^Simpan/ }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(saved).toHaveLength(0);
  expect(await rowOf('OLD001')).toBeInTheDocument();
});

test('lokasi unit beda dengan lokasi baris: dialog ringkasan tampil lalu tersimpan', async () => {
  found = [
    existing({
      buId: 'b1',
      buCode: 'BU1',
      recheckBuIds: ['b1'],
      ...sameSite,
      unitLocationId: 'l-lain',
    }),
  ];
  saveResult = 'rechecked';
  renderPage();
  await pickDefaults();
  await paste('OLD001');
  await waitFor(() => expect(screen.getByText('Cek ulang')).toBeInTheDocument());
  await clickSaveRow(/^Simpan/);
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

test('tidak ada dialog setelah scan dan sebelum Simpan', async () => {
  found = [existing({ buId: 'b1', buCode: 'BU1', recheckBuIds: ['b1'], ...sameSite })];
  renderPage();
  await pickDefaults();
  await paste('OLD001');
  await waitFor(() => expect(screen.getByText('Cek ulang')).toBeInTheDocument());
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

/** Baris draf Cek ulang (lokasi l1 = lokasi unit) yang sudah cocok persis dengan `existing()` bu `buId`. */
function seedRecheckRow(rowBuId: string, serialBuId: string): StagingRow {
  const state: StagingExisting = {
    id: 'sn-old',
    itemId: 'i9',
    itemLabel: 'Item Catatan',
    buId: serialBuId,
    buCode: serialBuId.toUpperCase(),
    buName: `Business Unit ${serialBuId.slice(1)}`,
    status: 'good',
    hasOpenCase: false,
    recheckBuIds: ['b1', 'b2'],
    proofMin: 0,
    unitLocationId: 'l1',
    lastEventAt: '2026-11-25T03:00:00.000Z',
    lastActorName: 'Budi',
  };
  return makeRow('OLD001', {
    itemId: 'i9',
    itemLabel: 'Item Catatan',
    buId: rowBuId,
    buLabel: `BU${rowBuId.slice(1)} - Business Unit ${rowBuId.slice(1)}`,
    stickers: [{ stickerId: 's1', name: 'Stiker A', qty: 2 }],
    existing: state,
  });
}

function foundFor(serialBuId: string) {
  return existing({
    buId: serialBuId,
    buCode: serialBuId.toUpperCase(),
    buName: `Business Unit ${serialBuId.slice(1)}`,
    recheckBuIds: ['b1', 'b2'],
    ...sameSite,
  });
}

test('BU baris beda dengan lokasi sama: dialog ringkasan tampil lalu tersimpan', async () => {
  found = [foundFor('b2')];
  saveResult = 'rechecked';
  resumeDraftWrites();
  saveDraft(me.email, [seedRecheckRow('b1', 'b2')]);
  renderPage();
  await rowOf('OLD001');
  await clickSaveRow(/^Simpan/);
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(saved[0]).toMatchObject({ buId: 'b1' });
});

test('hanya metadata serial berubah antara pencarian dan Simpan: tidak diblokir, dialog memakai data segar', async () => {
  found = [existing({ buId: 'b1', buCode: 'BU1', recheckBuIds: ['b1'], ...sameSite })];
  saveResult = 'rechecked';
  renderPage();
  await pickDefaults();
  await paste('OLD001');
  await waitFor(() => expect(screen.getByText('Cek ulang')).toBeInTheDocument());
  // Orang lain mencatat kejadian pada serial itu setelah pencarian pertama.
  found = [
    existing({
      buId: 'b1',
      buCode: 'BU1',
      recheckBuIds: ['b1'],
      ...sameSite,
      lastActorName: 'Sari',
      lastEventAt: '2026-11-26T04:00:00.000Z',
    }),
  ];
  await userEvent.click(await screen.findByRole('button', { name: /^Simpan/ }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText(/oleh Sari/)).toBeInTheDocument();
  expect(within(dialog).queryByText(/oleh Budi/)).toBeNull();
  expect(screen.queryByText(/baris berubah karena/)).toBeNull();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Lanjut menyimpan' }));
  await waitFor(() => expect(saved).toHaveLength(1));
});

test('dua klik Simpan cepat hanya membuka satu dialog', async () => {
  found = [existing({ buId: 'b1', buCode: 'BU1', recheckBuIds: ['b1'], ...sameSite })];
  renderPage();
  await pickDefaults();
  await paste('OLD001');
  await waitFor(() => expect(screen.getByText('Cek ulang')).toBeInTheDocument());
  const button = screen.getByRole('button', { name: /^Simpan/ });
  fireEvent.click(button);
  fireEvent.click(button);
  await screen.findByRole('alertdialog');
  expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  expect(saved).toHaveLength(0);
});

test('nilai BU, lokasi, dan stiker baris sama sebelum dan sesudah Batal', async () => {
  found = [foundFor('b1')];
  saveResult = 'rechecked';
  resumeDraftWrites();
  saveDraft(me.email, [seedRecheckRow('b1', 'b1')]);
  renderPage();
  await rowOf('OLD001');
  await userEvent.click(await screen.findByRole('button', { name: /^Simpan/ }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(saved).toHaveLength(0);
  await userEvent.click(await screen.findByRole('button', { name: /^Simpan/ }));
  const again = await screen.findByRole('alertdialog');
  await userEvent.click(within(again).getByRole('button', { name: 'Lanjut menyimpan' }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]).toMatchObject({
    itemId: 'i9',
    buId: 'b1',
    locationId: 'l1',
    stickers: [{ stickerId: 's1', qty: 2 }],
  });
});

/** Klik Simpan pada baris/halaman, lalu konfirmasi ringkasan (dialog `alertdialog`) bila tampil. */
async function clickSaveRow(namePattern: RegExp) {
  await userEvent.click(await screen.findByRole('button', { name: namePattern }));
  const dialog = screen.queryByRole('alertdialog');
  if (dialog) {
    await userEvent.click(
      within(dialog).getByRole('button', { name: /^(Simpan|Lanjut menyimpan)$/ }),
    );
  }
}
