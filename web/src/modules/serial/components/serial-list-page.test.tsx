import type { MeDto, SerialSummaryDto } from '@shared/contract';
import { listSerialsTooLong } from '@shared/serials';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { linkOptionNames, pickLink, pickSelect } from '@/test/link-field';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { type SerialSearch, serialSearchSchema } from '../lib/list-filter';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

vi.mock('./camera-scan-button', () => ({
  CameraScanButton: ({ onScan }: { onScan: (text: string) => unknown }) => (
    <button
      type="button"
      aria-label="Scan dengan kamera"
      // Seperti "Simpan" di dialog kamera: onScan satu kali per serial, berurutan (sinkron, sebelum render ulang).
      onClick={() => {
        for (const serial of ['bbb222', 'AAA111', 'ccc333']) onScan(serial);
      }}
    >
      kamera
    </button>
  ),
}));

import { SerialListPage } from './serial-list-page';

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

const PAGE_1 = [row({}), row({ id: 's2', serial: 'XYZ789', sample: true, status: 'reported' })];

function Harness({
  onNew,
  initial = {},
}: {
  onNew?: () => void;
  initial?: Record<string, unknown>;
}) {
  const [search, setSearch] = useState<SerialSearch>(serialSearchSchema.parse(initial));
  return (
    <SerialListPage
      search={search}
      onSearchChange={(patch) => setSearch((prev) => ({ ...prev, ...patch }))}
      onNew={onNew}
    />
  );
}

function renderPage(initial?: Record<string, unknown>, onNew?: () => void) {
  return renderInRouter(
    <Harness {...(initial ? { initial } : {})} {...(onNew ? { onNew } : {})} />,
  );
}

/** Membuka popover chip filter (nama tombol = label chip, dengan atau tanpa nilai terisi). */
async function openChip(label: string) {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}(:|$)`) }));
}

const listCalls = () => apiMock.mock.calls.filter((call) => call[0] === 'serials.list');
const lastListInput = () => listCalls().at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  apiMock.mockReset();
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
      serial: 'view',
      serialservice: 'none',
      countrylock: 'none',
    },
    businessUnits: [],
    locations: [
      {
        id: 'l1',
        code: 'JKT',
        name: 'Jakarta',
        permissions: { handover: 'none', qc: 'none', stock: 'none', stickerstock: 'none' },
      },
    ],
  };
  apiMock.mockImplementation((id: string, input: { cursor?: string }) => {
    if (id === 'serials.list') {
      return Promise.resolve(
        input.cursor
          ? { items: [row({ id: 's3', serial: 'LAST1' })], nextCursor: null }
          : { items: PAGE_1, nextCursor: 'c1' },
      );
    }
    if (id === 'serials.locationOptions') {
      return Promise.resolve({
        locations: [
          { id: 'l1', code: 'JKT', name: 'Jakarta' },
          { id: 'l2', code: 'SBY', name: 'Surabaya' },
        ],
      });
    }
    if (id === 'serials.itemOptions') {
      return Promise.resolve({
        items: [
          { id: 'i1', label: 'Cisco C9200', buIds: ['b1'], buOptions: [{ id: 'b1', code: 'BU1' }] },
        ],
        nextCursor: null,
      });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

test('merender baris dengan kolom Tanggal uji, status, posisi, dan sample; paginasi kursor', async () => {
  await renderPage();
  expect(await screen.findByText('ABC123')).toBeInTheDocument();
  const rows = screen.getAllByRole('row');
  expect(within(rows[1] as HTMLElement).getByText('10 Nov 2026')).toBeInTheDocument();
  expect(within(rows[1] as HTMLElement).getByText('Lolos')).toBeInTheDocument();
  expect(within(rows[1] as HTMLElement).getByText('Di QC')).toBeInTheDocument();
  expect(within(rows[2] as HTMLElement).getByText('Dilaporkan')).toBeInTheDocument();
  expect(within(rows[2] as HTMLElement).getByText('Ya')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Tanggal uji' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
  expect(await screen.findByText('LAST1')).toBeInTheDocument();
  expect(listCalls().at(-1)?.[1]).toMatchObject({ cursor: 'c1' });
});

test('serial menaut ke View-nya (LinkCell) dengan target panduan serial-open', async () => {
  await renderPage();
  const link = await screen.findByRole('link', { name: 'XYZ789' });
  expect(link).toHaveAttribute('href', '/serial/s2');
  expect(link).toHaveAttribute('data-tour', 'serial-open');
});

test('pencarian banyak serial mengirim bentuk ternormalisasi', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  fireEvent.change(screen.getByLabelText('Cari serial (satu per baris)'), {
    target: { value: ' abc123 \n4c:5e:0c:1a:2b:3d\nABC123\n' },
  });
  await waitFor(() => expect(lastListInput()).toMatchObject({ serials: 'ABC123\n4C5E0C1A2B3D' }), {
    timeout: 3000,
  });
  expect(lastListInput()).not.toHaveProperty('query');
});

test('satu serial dikirim sebagai awalan (query)', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  fireEvent.change(screen.getByLabelText('Cari serial (satu per baris)'), {
    target: { value: 'abc' },
  });
  await waitFor(() => expect(lastListInput()).toMatchObject({ query: 'ABC' }), { timeout: 3000 });
});

test('hanya ada satu field pencarian serial (tanpa field "Pindai untuk mencari")', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  expect(screen.queryByLabelText('Pindai untuk mencari')).not.toBeInTheDocument();
  expect(screen.getAllByRole('textbox', { name: /serial/i })).toHaveLength(1);
});

test('Enter menetapkan baris yang ditulis: sah tetap dan pindah baris, duplikat dibuang dengan umpan balik', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  const field = screen.getByLabelText('Cari serial (satu per baris)');
  await userEvent.type(field, 'aaa111{Enter}');
  expect(field).toHaveValue('AAA111\n');
  expect(screen.getByText('Ditambahkan')).toBeInTheDocument();
  await userEvent.type(field, 'bbb222{Enter}');
  expect(field).toHaveValue('AAA111\nBBB222\n');
  await userEvent.type(field, 'AAA111{Enter}');
  expect(screen.getByText('Sudah ada')).toBeInTheDocument();
  expect(field).toHaveValue('AAA111\nBBB222\n');
  await waitFor(() => expect(lastListInput()).toMatchObject({ serials: 'AAA111\nBBB222' }), {
    timeout: 3000,
  });
  // Baris baru di ujung tidak dihapus oleh gema URL setelah jeda.
  expect(field).toHaveValue('AAA111\nBBB222\n');
});

test('Enter pada baris tak sah menolak dan membuang barisnya; baris kosong diabaikan', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  const field = screen.getByLabelText('Cari serial (satu per baris)');
  await userEvent.type(field, 'AAA111{Enter}');
  await userEvent.type(field, `${'X'.repeat(200)}{Enter}`);
  expect(screen.getByText('Ditolak')).toBeInTheDocument();
  expect(field).toHaveValue('AAA111\n');
  await userEvent.type(field, '{Enter}');
  expect(field).toHaveValue('AAA111\n');
});

test('tombol kamera memakai jalur yang sama: banyak baris dipecah, duplikat dan tak sah ditangani', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  const field = screen.getByLabelText('Cari serial (satu per baris)');
  await userEvent.type(field, 'aaa111{Enter}');
  await userEvent.click(screen.getByRole('button', { name: 'Scan dengan kamera' }));
  expect(field).toHaveValue('AAA111\nBBB222\nCCC333');
  expect(screen.getByText('Ditambahkan')).toBeInTheDocument();
  expect(screen.getByText('3 serial dicari (maks. 50)')).toBeInTheDocument();
});

test('Enter tidak membuang sisa teks yang melebihi batas, juga setelah gema URL', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  const field = screen.getByLabelText('Cari serial (satu per baris)') as HTMLTextAreaElement;
  const many = Array.from({ length: 80 }, (_, i) => `S${String(i).padStart(3, '0')}`).join('\n');
  fireEvent.change(field, { target: { value: `${many}\nbaru` } });
  expect(screen.getByRole('alert')).toHaveTextContent('Terlalu banyak serial');
  field.setSelectionRange(field.value.length, field.value.length);
  await userEvent.type(field, '{Enter}');
  expect(field.value.split('\n').filter(Boolean)).toHaveLength(81);
  await waitFor(() => expect(lastListInput()).toHaveProperty('serials'), { timeout: 3000 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(field.value.split('\n').filter(Boolean)).toHaveLength(81);
  expect(screen.getByRole('alert')).toHaveTextContent('Terlalu banyak serial');
});

test('hasil kamera menambah baris di ujung tanpa mengubah awalan yang sedang diketik', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  const field = screen.getByLabelText('Cari serial (satu per baris)') as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: 'ab' } });
  await userEvent.click(screen.getByRole('button', { name: 'Scan dengan kamera' }));
  expect(field.value).toBe('ab\nBBB222\nAAA111\nCCC333');
});

test('Enter di baris tengah menetapkan baris itu saja', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  const field = screen.getByLabelText('Cari serial (satu per baris)') as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: 'aaa\nbbb\nccc' } });
  field.focus();
  field.setSelectionRange(5, 5);
  await userEvent.keyboard('{Enter}');
  expect(field.value).toBe('aaa\nBBB\nccc');
  expect(field.selectionStart).toBe(8);
});

test('Enter berturut-turut di baris tengah yang sudah normal: kursor selalu pindah ke baris berikutnya', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  const field = screen.getByLabelText('Cari serial (satu per baris)') as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: 'AAA\nBBB\nCCC\nDDD' } });
  field.focus();
  field.setSelectionRange(1, 1);
  await userEvent.keyboard('{Enter}');
  expect(field.value).toBe('AAA\nBBB\nCCC\nDDD');
  expect(field.selectionStart).toBe(4);
  // Teks dan umpan balik sama dengan sebelumnya (tanpa render ulang): kursor tetap harus maju.
  await userEvent.keyboard('{Enter}');
  expect(field.value).toBe('AAA\nBBB\nCCC\nDDD');
  expect(field.selectionStart).toBe(8);
  await userEvent.keyboard('{Enter}');
  expect(field.selectionStart).toBe(12);
});

test('Tab menjadi penutup bacaan hanya bila baris yang ditulis tidak kosong', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  const field = screen.getByLabelText('Cari serial (satu per baris)') as HTMLTextAreaElement;
  await userEvent.type(field, 'aaa111{Tab}');
  expect(field).toHaveValue('AAA111\n');
  expect(field).toHaveFocus();
  expect(screen.getByText('Ditambahkan')).toBeInTheDocument();
  await userEvent.type(field, 'AAA111{Tab}');
  expect(screen.getByText('Sudah ada')).toBeInTheDocument();
  expect(field).toHaveValue('AAA111\n');
  expect(field).toHaveFocus();
  // Baris kosong: Tab memindahkan fokus seperti biasa dan tidak mengubah teks.
  await userEvent.tab();
  expect(field).not.toHaveFocus();
  expect(field).toHaveValue('AAA111\n');
});

test('Shift+Tab tidak diintersep dan Tab pada field kosong memindahkan fokus', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  const field = screen.getByLabelText('Cari serial (satu per baris)') as HTMLTextAreaElement;
  field.focus();
  await userEvent.tab();
  expect(field).not.toHaveFocus();
  fireEvent.change(field, { target: { value: 'bbb222' } });
  field.focus();
  await userEvent.tab({ shift: true });
  expect(field).toHaveValue('bbb222');
  expect(field).not.toHaveFocus();
});

test('filter status, lokasi, item, dan rentang tanggal menjadi parameter pencarian', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  await openChip('Status');
  await pickSelect(screen, 'Filter status', 'Dilaporkan');
  await waitFor(() => expect(lastListInput()).toMatchObject({ status: 'reported' }));
  await userEvent.keyboard('{Escape}');
  await openChip('Lokasi');
  await pickLink(screen, 'Filter lokasi', 'Jakarta (JKT)');
  await waitFor(() => expect(lastListInput()).toMatchObject({ locationId: 'l1' }));
  await userEvent.keyboard('{Escape}');
  await openChip('Item');
  await pickLink(screen, 'Filter item', 'Cisco C9200');
  await waitFor(() => expect(lastListInput()).toMatchObject({ itemId: 'i1' }));
  await userEvent.keyboard('{Escape}');
  await openChip('Tanggal uji');
  fireEvent.change(screen.getByLabelText('Tanggal uji dari'), { target: { value: '2026-11-01' } });
  fireEvent.change(screen.getByLabelText('Tanggal uji sampai'), {
    target: { value: '2026-11-30' },
  });
  await waitFor(() =>
    expect(lastListInput()).toMatchObject({
      status: 'reported',
      locationId: 'l1',
      itemId: 'i1',
      from: '2026-11-01',
      to: '2026-11-30',
    }),
  );
});

test('tanpa hasil menampilkan pesan kosong', async () => {
  apiMock.mockImplementation((id: string) =>
    id === 'serials.list'
      ? Promise.resolve({ items: [], nextCursor: null })
      : Promise.resolve({ items: [], nextCursor: null }),
  );
  await renderPage();
  expect(await screen.findByText('Belum ada Serial Number yang tercatat.')).toBeInTheDocument();
});

test('tempelan melebihi batas: pesan jelas, hanya serial pertama yang dicari', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  const many = Array.from({ length: 57 }, (_, index) => `S${index}`).join(String.fromCharCode(10));
  fireEvent.change(screen.getByLabelText('Cari serial (satu per baris)'), {
    target: { value: many },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'hanya 50 serial pertama yang dicari, 7 serial lain diabaikan',
  );
  await waitFor(
    () =>
      expect((lastListInput().serials as string).split(String.fromCharCode(10))).toHaveLength(50),
    { timeout: 3000 },
  );
});

test('pembaca tanpa serial: edit tidak memanggil serials.locationOptions; filter lokasi memakai lokasi miliknya', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  await openChip('Lokasi');
  const names = await linkOptionNames(screen, 'Filter lokasi');
  expect(names).toEqual(['Jakarta (JKT)']);
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.locationOptions')).toBe(false);
});

test('pembaca serialservice: view juga tidak memanggil serials.locationOptions', async () => {
  me = {
    ...me,
    permissions: { ...me.permissions, serial: 'none', serialservice: 'view', countrylock: 'none' },
  };
  await renderPage();
  await screen.findByText('ABC123');
  await openChip('Lokasi');
  await linkOptionNames(screen, 'Filter lokasi');
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.locationOptions')).toBe(false);
});

test('editor (serial: edit) memuat semua lokasi aktif dari serials.locationOptions', async () => {
  me = { ...me, permissions: { ...me.permissions, serial: 'edit' } };
  await renderPage();
  await screen.findByText('ABC123');
  await openChip('Lokasi');
  const names = await linkOptionNames(screen, 'Filter lokasi');
  expect(names).toEqual(['Jakarta (JKT)', 'Surabaya (SBY)']);
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.locationOptions')).toBe(true);
});

test('tempelan serial lebar melebihi panjang URL: pesan khusus dan hanya awalan yang dikirim', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  const nl = String.fromCharCode(10);
  const wide = Array.from(
    { length: 40 },
    (_, index) => `${String.fromCharCode(233).repeat(60)}${index}`,
  );
  fireEvent.change(screen.getByLabelText('Cari serial (satu per baris)'), {
    target: { value: wide.join(nl) },
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Daftar terlalu panjang untuk satu pencarian',
  );
  await waitFor(
    () => {
      const sent = lastListInput().serials as string;
      expect(sent.split(nl).length).toBeLessThan(40);
      expect(listSerialsTooLong(sent)).toBe(false);
    },
    { timeout: 3000 },
  );
});

test('pembaca tanpa penugasan lokasi: peringatan tampil di daftar serial; editor atau yang punya lokasi tidak melihatnya', async () => {
  me = { ...me, locations: [] };
  const { unmount } = await renderPage();
  await screen.findByText('ABC123');
  expect(screen.getByText(/belum ditugaskan ke lokasi mana pun/)).toBeInTheDocument();
  unmount();

  // Editor memakai serials.locationOptions: tidak bergantung penugasan, jadi tanpa peringatan.
  me = { ...me, permissions: { ...me.permissions, serial: 'edit' } };
  await renderPage();
  await screen.findAllByText('ABC123');
  expect(screen.queryByText(/belum ditugaskan ke lokasi mana pun/)).toBeNull();
});

test('filter item berfungsi bagi pembaca (serial: view): item dimuat dari serials.itemOptions tanpa gerbang edit', async () => {
  me = {
    ...me,
    permissions: { ...me.permissions, serial: 'none', serialservice: 'view', countrylock: 'none' },
  };
  await renderPage();
  await screen.findByText('ABC123');
  await openChip('Item');
  const names = await linkOptionNames(screen, 'Filter item');
  expect(names).toEqual(['Cisco C9200']);
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.itemOptions')).toBe(true);
});

function withBus(
  levels: [string, 'none' | 'view' | 'edit', 'none' | 'view' | 'edit'][],
): MeDto['businessUnits'] {
  return levels.map(([id, serial, serialservice]) => ({
    id,
    code: id.toUpperCase(),
    name: `Unit ${id}`,
    status: 'active' as const,
    permissions: { item: 'none' as const, serial, serialservice },
  }));
}

test('kolom posisi: "Dalam pengiriman · 3 hari" dengan tujuan, dan nomor kasus terbuka', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-13T03:00:00.000Z') });
  try {
    apiMock.mockImplementation((id: string) =>
      id === 'serials.list'
        ? Promise.resolve({
            items: [
              row({
                id: 's7',
                serial: 'KIRIM1',
                status: 'at_service',
                custody: 'transit',
                transitOn: '2026-11-10',
                transitToLocationId: 'l2',
                transitToLocationName: 'Surabaya',
                openCaseNumber: 'LP/SBY/2611-0001',
              }),
              row({
                id: 's8',
                serial: 'DIAM1',
                status: 'reported',
                openCaseNumber: 'LP/SBY/2611-0004',
              }),
            ],
            nextCursor: null,
          })
        : Promise.resolve({ locations: [], items: [], nextCursor: null }),
    );
    await renderPage();
    expect(await screen.findByText('KIRIM1')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    const sending = within(rows[1] as HTMLElement);
    expect(sending.getByText('Dalam pengiriman · 3 hari')).toBeInTheDocument();
    expect(sending.getByText('ke Surabaya')).toBeInTheDocument();
    expect(sending.getByText('LP/SBY/2611-0001')).toBeInTheDocument();
    const still = within(rows[2] as HTMLElement);
    expect(still.getByText('Di QC')).toBeInTheDocument();
    expect(still.getByText('LP/SBY/2611-0004')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('filter posisi masuk masukan serials.list lewat Select', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  await openChip('Posisi');
  await pickSelect(screen, 'Filter posisi', 'Dalam pengiriman');
  await waitFor(() => expect(lastListInput()).toMatchObject({ custody: 'transit' }));
  await pickSelect(screen, 'Filter posisi', 'Semua posisi');
  await waitFor(() => expect(lastListInput()).not.toHaveProperty('custody'));
});

test('filter BU hanya menawarkan BU yang terbaca (serial atau serialservice) dan mengirim buId', async () => {
  me = {
    ...me,
    businessUnits: withBus([
      ['b1', 'view', 'none'],
      ['b2', 'none', 'view'],
      ['b3', 'none', 'none'],
    ]),
  };
  await renderPage();
  await screen.findByText('ABC123');
  await openChip('BU');
  const names = await linkOptionNames(screen, 'Filter BU');
  expect(names).toEqual(['B1 · Unit b1', 'B2 · Unit b2']);
  // Teks bantu hanya selagi filter BU aktif: serial yang pernah di BU itu ikut tampil.
  expect(screen.queryByText(/pernah di BU ini/)).toBeNull();
  await userEvent.click(await screen.findByRole('option', { name: 'B2 · Unit b2' }));
  await waitFor(() => expect(lastListInput()).toMatchObject({ buId: 'b2' }));
  expect(await screen.findByText('Termasuk serial yang pernah di BU ini.')).toBeInTheDocument();
});

test('sakelar "Dicatat oleh saya" mengisi createdBy dengan email akun', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  expect(lastListInput()).not.toHaveProperty('createdBy');
  await openChip('Pencatat');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Dicatat oleh saya' }));
  await waitFor(() => expect(lastListInput()).toMatchObject({ createdBy: 'a@gmail.com' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Dicatat oleh saya' }));
  await waitFor(() => expect(lastListInput()).not.toHaveProperty('createdBy'));
});

test('filter BU dari URL yang tidak dikenal tidak menampilkan id mentah', async () => {
  await renderPage({ bu: 'b-rahasia-123' });
  await screen.findByText('ABC123');
  expect(screen.queryByText(/b-rahasia-123/)).toBeNull();
  expect(screen.getByRole('button', { name: /^BU: BU tidak dikenal/ })).toBeInTheDocument();
});

test('tombol "Tambah Serial Number" hanya tampil bila ada jalan masuk mencatat, dan memanggilnya', async () => {
  const { unmount } = await renderPage();
  await screen.findByText('ABC123');
  expect(screen.queryByRole('button', { name: 'Tambah Serial Number' })).toBeNull();
  unmount();
  const onNew = vi.fn();
  await renderPage(undefined, onNew);
  await userEvent.click(await screen.findByRole('button', { name: 'Tambah Serial Number' }));
  expect(onNew).toHaveBeenCalledTimes(1);
});

test('badge Bukti foto QC tampil hanya pada baris yang punya foto', async () => {
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.list') {
      return Promise.resolve({
        items: [
          row({ id: 's1', serial: 'ADA1', hasProofPhotos: true }),
          row({ id: 's2', serial: 'TANPA2' }),
        ],
        nextCursor: null,
      });
    }
    return Promise.resolve({ locations: [] });
  });
  await renderPage();
  const withPhoto = (await screen.findByRole('link', { name: 'ADA1' })).closest(
    'tr',
  ) as HTMLElement;
  const without = screen.getByRole('link', { name: 'TANPA2' }).closest('tr') as HTMLElement;
  expect(within(withPhoto).getByText('Bukti foto QC')).toBeInTheDocument();
  expect(within(without).queryByText('Bukti foto QC')).not.toBeInTheDocument();
});

test('badge Foto bermasalah tampil hanya pada baris dengan proofProblemCount > 0, berdampingan dengan Bukti foto QC', async () => {
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.list') {
      return Promise.resolve({
        items: [
          row({ id: 's1', serial: 'MASALAH1', hasProofPhotos: true, proofProblemCount: 2 }),
          row({ id: 's2', serial: 'AMAN2', hasProofPhotos: true }),
        ],
        nextCursor: null,
      });
    }
    return Promise.resolve({ locations: [] });
  });
  await renderPage();
  const bad = (await screen.findByRole('link', { name: 'MASALAH1' })).closest('tr') as HTMLElement;
  const fine = screen.getByRole('link', { name: 'AMAN2' }).closest('tr') as HTMLElement;
  expect(within(bad).getByText('Foto bermasalah')).toBeInTheDocument();
  expect(within(bad).getByText('Bukti foto QC')).toBeInTheDocument();
  expect(within(fine).queryByText('Foto bermasalah')).not.toBeInTheDocument();
  expect(within(fine).getByText('Bukti foto QC')).toBeInTheDocument();
});

// ---------------------------------------------------------------------------------------------------------------------
// Fase 4d: kit CRUD, hapus/pulihkan massal (serial: manage), tampilan Terhapus, dan kartu ponsel.

let media: ReturnType<typeof mockMatchMedia> | undefined;
afterEach(() => {
  media?.restore();
  media = undefined;
  window.innerWidth = 1024;
});

/** Pemegang `serial: manage` pada BU "b1" (BU baris contoh). */
function manageMe(level: 'edit' | 'manage' = 'manage'): MeDto {
  return {
    ...me,
    permissions: { ...me.permissions, serial: level },
    businessUnits: [
      {
        id: 'b1',
        code: 'BU1',
        name: 'Satu',
        status: 'active',
        permissions: { item: 'none', serial: level, serialservice: 'none' },
      },
    ],
  };
}

const callsOf = (id: string) => apiMock.mock.calls.filter((call) => call[0] === id);

test('kolom checkbox hanya bagi pemegang serial: manage; pembaca dan editor tanpa checkbox', async () => {
  me = manageMe('edit');
  const { unmount } = await renderPage();
  await screen.findByText('ABC123');
  expect(screen.queryByRole('checkbox', { name: 'Pilih semua' })).toBeNull();
  unmount();

  me = manageMe('manage');
  await renderPage();
  await screen.findByText('ABC123');
  expect(screen.getByRole('checkbox', { name: 'Pilih semua' })).toBeInTheDocument();
});

test('canManage dari server menentukan checkbox dan Hapus baris (serial yang pernah di BU lain tak dapat dipilih)', async () => {
  me = manageMe();
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.list') {
      return Promise.resolve({
        items: [
          row({ canManage: true }),
          row({ id: 's2', serial: 'XYZ789', canManage: false }),
        ],
        nextCursor: null,
      });
    }
    return Promise.resolve({ locations: [], items: [], nextCursor: null });
  });
  await renderPage();
  await screen.findByText('ABC123');
  expect(screen.getByRole('checkbox', { name: 'Pilih ABC123' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Pilih XYZ789' })).toBeNull();
});

test('tidak ada ubah massal: bar aksi hanya memuat Hapus', async () => {
  me = manageMe();
  await renderPage();
  await screen.findByText('ABC123');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih ABC123' }));
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Ubah massal|Edit/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Nonaktifkan|Aktifkan/ })).toBeNull();
});

test('Hapus massal: konfirmasi lalu serials.removeBatch dengan id terpilih', async () => {
  me = manageMe();
  apiMock.mockImplementation((id: string, input: { ids?: string[] }) => {
    if (id === 'serials.list') return Promise.resolve({ items: PAGE_1, nextCursor: null });
    if (id === 'serials.removeBatch') return Promise.resolve({ ids: input.ids });
    return Promise.resolve({ locations: [], items: [], nextCursor: null });
  });
  await renderPage();
  await screen.findByText('ABC123');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText('Hapus 2 Serial Number?')).toBeInTheDocument();
  expect(within(dialog).getByText(/Stok stiker yang sudah dipotong/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('serials.removeBatch')).toHaveLength(1));
  expect(callsOf('serials.removeBatch')[0]?.[1]).toEqual({ ids: ['s1', 's2'] });
});

test('250 serial terpilih: Hapus dikirim 100/100/50 dan berhenti di tahap yang gagal', async () => {
  me = manageMe();
  const many = Array.from({ length: 250 }, (_, index) =>
    row({ id: `m${index}`, serial: `MASSAL${String(index).padStart(3, '0')}` }),
  );
  let removeCalls = 0;
  apiMock.mockImplementation((id: string, input: { ids?: string[] }) => {
    if (id === 'serials.list') return Promise.resolve({ items: many, nextCursor: null });
    if (id === 'serials.removeBatch') {
      removeCalls += 1;
      // Tahap kedua gagal: tahap ketiga tidak boleh terkirim.
      return removeCalls === 2
        ? Promise.reject(new Error('Gagal di tahap dua'))
        : Promise.resolve({ ids: input.ids });
    }
    return Promise.resolve({ locations: [], items: [], nextCursor: null });
  });
  await renderPage();
  await screen.findByText('MASSAL000');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(callsOf('serials.removeBatch')).toHaveLength(2));
  const sizes = callsOf('serials.removeBatch').map(
    (call) => (call[1] as { ids: string[] }).ids.length,
  );
  expect(sizes).toEqual([100, 100]);
  // Tidak ada tahap ketiga walau ditunggu.
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(callsOf('serials.removeBatch')).toHaveLength(2);
}, 60_000);

test('rowSelectable: baris di BU yang tak dikelola tanpa checkbox', async () => {
  me = manageMe();
  apiMock.mockImplementation((id: string) =>
    id === 'serials.list'
      ? Promise.resolve({
          items: [
            row({ id: 's1', serial: 'MILIKKU1' }),
            row({ id: 's9', serial: 'ORANGLAIN9', buId: 'b9' }),
          ],
          nextCursor: null,
        })
      : Promise.resolve({ locations: [], items: [], nextCursor: null }),
  );
  await renderPage();
  await screen.findByText('MILIKKU1');
  expect(screen.getByRole('checkbox', { name: 'Pilih MILIKKU1' })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: 'Pilih ORANGLAIN9' })).toBeNull();
});

test('chip Tampilan hanya bagi manage; deleted=true tulisan tangan bagi non-manage diabaikan', async () => {
  await renderPage({ deleted: true });
  await screen.findByText('ABC123');
  expect(screen.queryByRole('button', { name: /^Tampilan/ })).toBeNull();
  expect(lastListInput()).not.toHaveProperty('deleted');
});

test('tampilan Terhapus (manage): deleted:true ke server, kolom Dihapus oleh, aksi Pulihkan massal', async () => {
  me = manageMe();
  const gone = row({
    id: 's5',
    serial: 'HAPUS55',
    deleted: { deletedAt: '2026-11-20T03:00:00.000Z', deletedBy: 'adm@x.com' },
  });
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.list') return Promise.resolve({ items: [gone], nextCursor: null });
    if (id === 'serials.restoreBatch') {
      return Promise.resolve({ items: [row({ id: 's5', serial: 'HAPUS55' })] });
    }
    return Promise.resolve({ locations: [], items: [], nextCursor: null });
  });
  await renderPage({ deleted: true });
  await screen.findByText('HAPUS55');
  expect(lastListInput()).toMatchObject({ deleted: true });
  expect(screen.getAllByText('Terhapus').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('adm@x.com')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih HAPUS55' }));
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan' }));
  await waitFor(() => expect(callsOf('serials.restoreBatch')).toHaveLength(1));
  expect(callsOf('serials.restoreBatch')[0]?.[1]).toEqual({ ids: ['s5'] });
});

test('aksi baris di desktop: tombol ikon Ubah dan Hapus; Hapus membuka konfirmasi satu serial', async () => {
  me = manageMe();
  await renderPage();
  await screen.findByText('ABC123');
  expect(screen.getByRole('button', { name: 'Ubah ABC123' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus ABC123' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText('Hapus 1 Serial Number?')).toBeInTheDocument();
});

test('ponsel (360 px): kartu dengan serial sebagai judul, status sebagai badge, meta berlabel; aksi lewat menu ⋯', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  me = manageMe();
  await renderPage();
  await screen.findByRole('link', { name: 'ABC123' });
  expect(screen.queryByRole('table')).toBeNull();
  const card = screen.getAllByRole('listitem')[0] as HTMLElement;
  expect(within(card).getByRole('link', { name: 'ABC123' })).toBeInTheDocument();
  expect(within(card).getByText('Lolos')).toBeInTheDocument();
  expect(within(card).getByText('Cisco C9200')).toBeInTheDocument();
  expect(within(card).getByText('Tanggal uji')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus ABC123' })).toBeNull();
  await userEvent.click(within(card).getByRole('button', { name: /Aksi ABC123/ }));
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: /Hapus ABC123/ })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitem', { name: /Ubah ABC123/ })).toBeInTheDocument();
});

test('target panduan: serial-new pada tombol Tambah, serial-table dan serial-filters ada', async () => {
  await renderPage(undefined, () => undefined);
  await screen.findByText('ABC123');
  expect(screen.getByRole('button', { name: 'Tambah Serial Number' })).toHaveAttribute(
    'data-tour',
    'serial-new',
  );
  expect(document.querySelector('[data-tour="serial-table"]')).not.toBeNull();
  expect(document.querySelector('[data-tour="serial-filters"]')).not.toBeNull();
});
