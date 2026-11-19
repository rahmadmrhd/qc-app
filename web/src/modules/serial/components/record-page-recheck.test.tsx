import type { MeDto, SerialExistingDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { expectLinkValue, linkOptionNames, pickLink } from '@/test/link-field';
import { clearAllDrafts, resumeDraftWrites, saveDraft } from '../lib/draft-store';
import { exportQcsn } from '../lib/qcsn';
import { makeRow, testMe } from '../test-support';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn(), dismiss: vi.fn() } }));

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
        { id: 'i1', label: 'Cisco C9200', buIds: ['b1'], buOptions: [{ id: 'b1', code: 'BU1' }] },
      ];
      const ids = input.itemIds as string[] | undefined;
      return Promise.resolve({
        items: ids ? items.filter((item) => ids.includes(item.id)) : items,
        nextCursor: null,
      });
    }
    if (id === 'serials.stickerOptions') {
      if (input.itemId !== 'i1') return Promise.reject(new Error('tidak ditemukan'));
      return Promise.resolve({
        stickers: [{ id: 's1', name: 'Stiker A', alias: '', typeName: 'Jenis', defaultQty: 1 }],
      });
    }
    if (id === 'serials.lookupMany') {
      lookupCalls.push(input.serials as string[]);
      if (lookupFails) return Promise.reject(new Error('jaringan'));
      const asked = new Set(input.serials as string[]);
      return Promise.resolve({ found: found.filter((entry) => asked.has(entry.serial)) });
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
  await expectLinkValue(screen, 'Business Unit', 'BU1');
}

async function paste(text: string) {
  await userEvent.click(screen.getByLabelText('Scan atau tempel serial (satu per baris)'));
  await userEvent.paste(text);
  if (!text.includes('\n')) await userEvent.keyboard('{Enter}');
}

const rowOf = async (serial: string) =>
  (await screen.findByLabelText(`Pilih baris ${serial}`)).closest('tr') as HTMLElement;

test('serial yang sudah ada menjadi baris Cek ulang: satu permintaan untuk semua serial baru, item dan BU dari catatan, stiker kosong', async () => {
  found = [existing()];
  renderPage();
  await pickDefaults();
  await paste('OLD001\nNEW002');

  const old = await rowOf('OLD001');
  await waitFor(() => expect(within(old).getByText('Cek ulang')).toBeInTheDocument());
  // Dikumpulkan per kelompok: SATU permintaan memuat kedua serial.
  expect(lookupCalls).toEqual([['OLD001', 'NEW002']]);
  expect(within(old).getByText('Item Catatan')).toBeInTheDocument();
  expect(within(old).getByText('BU2')).toBeInTheDocument();
  expect(within(old).getByText('Tanpa stiker')).toBeInTheDocument();
  // Baris baru tidak berubah.
  const fresh = await rowOf('NEW002');
  expect(within(fresh).queryByText('Cek ulang')).toBeNull();
  expect(within(fresh).getByText('Cisco C9200')).toBeInTheDocument();
});

test('Simpan mengirim baris Cek ulang dengan item catatan, BU saat ini, stiker kosong; hasil rechecked masuk ringkasan', async () => {
  found = [existing()];
  saveResult = 'rechecked';
  renderPage();
  await pickDefaults();
  await paste('OLD001');
  await waitFor(() => expect(screen.getByText('Cek ulang')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]).toMatchObject({
    serial: 'OLD001',
    itemId: 'i9',
    buId: 'b2',
    sample: false,
    stickers: [],
  });
  expect(
    await screen.findByText(/Dibuat 0, 1 dicek ulang, duplikat 0, gagal 0/),
  ).toBeInTheDocument();
});

test('semua baris tersimpan dengan cek ulang: toast menyebut jumlah dicek ulang', async () => {
  found = [existing()];
  saveResult = 'rechecked';
  const onAllSaved = vi.fn();
  renderPage({ onAllSaved });
  await pickDefaults();
  await paste('OLD001\nNEW002');
  await waitFor(() => expect(screen.getByText('Cek ulang')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(onAllSaved).toHaveBeenCalledWith(2));
  expect(toastSuccess).toHaveBeenCalledWith(
    'Serial Number berhasil disimpan (1 dibuat, 1 dicek ulang)',
  );
});

test('serial dengan laporan aktif atau Rusak tampil bermasalah dan tidak dikirim saat Simpan', async () => {
  found = [
    existing({ serial: 'OLD001', hasOpenCase: true }),
    existing({ serial: 'OLD002', id: 'sn2', status: 'broken' }),
  ];
  renderPage();
  await pickDefaults();
  await paste('OLD001\nOLD002');

  const first = await rowOf('OLD001');
  await waitFor(() =>
    expect(
      within(first).getByText(
        'Serial ini sedang ada laporan aktif; selesaikan lewat halaman laporannya.',
      ),
    ).toBeInTheDocument(),
  );
  const second = await rowOf('OLD002');
  expect(within(second).getByText('Unit ini sudah dinyatakan rusak.')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  expect(
    await screen.findByText(/2 baris belum lengkap atau tidak bisa dicek ulang/),
  ).toBeInTheDocument();
  expect(saved).toHaveLength(0);
});

test('Ubah baris Cek ulang: item terkunci, BU hanya recheckBuIds, Sample tidak ada, pindah BU tampil sebagai lencana', async () => {
  found = [existing()];
  renderPage();
  await pickDefaults();
  await paste('OLD001');
  await waitFor(() => expect(screen.getByText('Cek ulang')).toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: 'Detail OLD001' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('textbox', { name: 'Item baris' })).toHaveAttribute('readonly');
  expect(within(dialog).queryByRole('combobox', { name: 'Item baris' })).toBeNull();
  expect(within(dialog).queryByRole('checkbox', { name: 'Sample' })).toBeNull();
  // Hanya BU yang lolos aturan (BU1 ada di BU tulis tetapi tidak di recheckBuIds).
  expect(await linkOptionNames(within(dialog), 'Business Unit baris')).toEqual(['BU2', 'BU3']);
  await userEvent.click(await screen.findByRole('option', { name: 'BU3' }));
  await expectLinkValue(within(dialog), 'Business Unit baris', 'BU3');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Terapkan' }));

  const old = await rowOf('OLD001');
  expect(within(old).getByText('Pindah BU: BU2 → BU3')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  await waitFor(() => expect(saved[0]).toMatchObject({ buId: 'b3', stickers: [] }));
});

test('draf yang dimuat disegarkan: baris tanpa penanda yang serialnya sudah ada menjadi Cek ulang', async () => {
  found = [existing()];
  resumeDraftWrites();
  saveDraft('a@gmail.com', [
    makeRow('OLD001', { itemId: 'i1', itemLabel: 'Cisco C9200', stickers: null }),
  ]);
  renderPage();
  const old = await rowOf('OLD001');
  await waitFor(() => expect(within(old).getByText('Cek ulang')).toBeInTheDocument());
  expect(within(old).getByText('Item Catatan')).toBeInTheDocument();
});

test('pencarian gagal (jaringan): Simpan berhenti dengan pesan dan tidak mengirim apa pun (stiker bawaan tak boleh memotong stok cek ulang)', async () => {
  found = [existing()];
  lookupFails = true;
  renderPage();
  await pickDefaults();
  await paste('OLD001');
  await rowOf('OLD001');
  await userEvent.click(screen.getByRole('button', { name: /^Simpan/ }));
  expect(
    await screen.findByText(/Pengecekan serial yang sudah tercatat gagal/),
  ).toBeInTheDocument();
  expect(saved).toHaveLength(0);
});

test('Ubah baris dibuka sebelum pencarian selesai: setelah baris menjadi Cek ulang dialog dipasang ulang dengan item catatan', async () => {
  found = [existing()];
  renderPage();
  await pickDefaults();
  await paste('OLD001');
  await userEvent.click(await screen.findByRole('button', { name: 'Detail OLD001' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  // Pencarian selesai selagi dialog terbuka: dialog dipasang ulang dalam bentuk Cek ulang (item terkunci, tanpa Sample).
  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Item baris' })).toHaveValue('Item Catatan'),
  );
  expect(screen.queryByRole('checkbox', { name: 'Sample' })).toBeNull();
});

test('pencarian gagal (jaringan): baris tetap biasa dan halaman tidak rusak', async () => {
  found = [existing()];
  lookupFails = true;
  renderPage();
  await pickDefaults();
  await paste('OLD001');
  const old = await rowOf('OLD001');
  await waitFor(() => expect(lookupCalls.length).toBeGreaterThan(0));
  expect(within(old).queryByText('Cek ulang')).toBeNull();
});

test('impor .qcsn: serial yang sudah ada menjadi Cek ulang (item berkas diganti item catatan), yang bermasalah ditandai', async () => {
  found = [existing(), existing({ serial: 'OLD002', id: 'sn2', hasOpenCase: true })];
  const base = makeRow('OLD001', {
    clientId: 'row-imp-0001',
    itemId: 'ghost',
    itemLabel: 'Item Hantu',
  });
  const second = makeRow('OLD002', {
    clientId: 'row-imp-0002',
    itemId: 'ghost',
    itemLabel: 'Item Hantu',
  });
  const text = await exportQcsn([base, second], { name: 'qc-web', version: '1' }, new Date());
  renderPage();
  await userEvent.upload(
    screen.getByLabelText('Impor berkas .qcsn'),
    new File([text], 'serial.qcsn', { type: 'application/json' }),
  );
  const first = await rowOf('OLD001');
  await waitFor(() => expect(within(first).getByText('Cek ulang')).toBeInTheDocument());
  // Item hantu dari berkas tidak lagi dituntut dipilih ulang: item mengikuti catatan.
  expect(within(first).getByText('Item Catatan')).toBeInTheDocument();
  expect(within(first).queryByText(/Pilih ulang/)).toBeNull();
  expect(
    await screen.findByText(
      /serial\.qcsn: 2 baris baru.*2 baris jadi Cek ulang.*1 tidak bisa dicek ulang/,
    ),
  ).toBeInTheDocument();
});
