import type { MeDto, SerialSummaryDto } from '@shared/contract';
import { listSerialsTooLong } from '@shared/serials';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { closeFilterChip, linkOptionNames, pickLink, pickSelect } from '@/test/link-field';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { resetPendingApplyStickersForTest } from '../lib/apply-stickers-intent';
import { type SerialSearch, serialSearchSchema } from '../lib/list-filter';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

// Editor Tiptap tidak dapat diketik di jsdom: diganti kolom teks (dialog Lapor rusak dari aksi baris).
vi.mock('@/modules/markdown/wysiwyg-editor', () => ({
  WysiwygEditor: (props: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    labelledBy?: string;
  }) => (
    <textarea
      id={props.id}
      aria-labelledby={props.labelledBy}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

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
  resetPendingApplyStickersForTest();
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
      serialwh: 'none',
      countrylock: 'none',
      dashboard: 'none',
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
          {
            id: 'i1',
            label: 'Cisco C9200',
            buIds: ['b1'],
            buOptions: [{ id: 'b1', code: 'BU1', name: 'Business Unit 1' }],
          },
        ],
        nextCursor: null,
      });
    }
    if (id === 'serials.creatorOptions') {
      return Promise.resolve({
        items: [
          { email: 'budi@x.com', name: 'Budi' },
          { email: 'a@gmail.com', name: 'A' },
          { email: 'tanpa@x.com', name: 'tanpa@x.com' },
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
  // Draf: daftar baru diminta saat chip menutup.
  expect(lastListInput()).not.toHaveProperty('statuses');
  await closeFilterChip();
  await waitFor(() => expect(lastListInput()).toMatchObject({ statuses: ['reported'] }));
  await openChip('Lokasi');
  await pickLink(screen, 'Filter lokasi', 'Jakarta (JKT)');
  await closeFilterChip();
  await waitFor(() => expect(lastListInput()).toMatchObject({ locationIds: ['l1'] }));
  await openChip('Item');
  await pickLink(screen, 'Filter item', 'Cisco C9200');
  await closeFilterChip();
  await waitFor(() => expect(lastListInput()).toMatchObject({ itemIds: ['i1'] }));
  await openChip('Tanggal uji');
  fireEvent.change(screen.getByLabelText('Tanggal uji dari'), { target: { value: '2026-11-01' } });
  fireEvent.change(screen.getByLabelText('Tanggal uji sampai'), {
    target: { value: '2026-11-30' },
  });
  expect(lastListInput()).not.toHaveProperty('from');
  await closeFilterChip();
  await waitFor(() =>
    expect(lastListInput()).toMatchObject({
      statuses: ['reported'],
      locationIds: ['l1'],
      itemIds: ['i1'],
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
    permissions: {
      ...me.permissions,
      serial: 'none',
      serialservice: 'view',
      serialwh: 'none',
      countrylock: 'none',
      dashboard: 'none',
    },
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
    permissions: {
      ...me.permissions,
      serial: 'none',
      serialservice: 'view',
      serialwh: 'none',
      countrylock: 'none',
      dashboard: 'none',
    },
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
    permissions: { item: 'none' as const, serial, serialservice, serialwh: 'none' as const },
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

test('filter posisi multi-value masuk masukan serials.list lewat MultiSelect; hapus chip mengosongkannya', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  await openChip('Posisi');
  await pickSelect(screen, 'Filter posisi', 'Dalam pengiriman');
  await pickSelect(screen, 'Filter posisi', 'Di servis');
  // Dua pilihan berturut-turut = SATU permintaan, setelah chip menutup.
  expect(lastListInput()).not.toHaveProperty('custodies');
  await closeFilterChip();
  await waitFor(() => expect(lastListInput()).toMatchObject({ custodies: ['transit', 'service'] }));
  expect(
    screen.getByRole('button', { name: /^Posisi: Dalam pengiriman, Di servis/ }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus filter Posisi' }));
  await waitFor(() => expect(lastListInput()).not.toHaveProperty('custodies'));
  expect(lastListInput()).not.toHaveProperty('custody');
});

test('filter BU hanya menawarkan BU yang terbaca (serial atau serialservice) dan mengirim buIds (jamak)', async () => {
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
  expect(names).toEqual(['B1 - Unit b1', 'B2 - Unit b2']);
  // Teks bantu hanya selagi filter BU aktif: serial yang pernah di BU itu ikut tampil.
  expect(screen.queryByText(/pernah di BU ini/)).toBeNull();
  await userEvent.click(await screen.findByRole('option', { name: 'B2 - Unit b2' }));
  // Mode banyak pilihan tetap terbuka: pilihan kedua menambah draf dan daftar baru diminta saat chip menutup.
  await userEvent.click(await screen.findByRole('option', { name: 'B1 - Unit b1' }));
  expect(lastListInput()).not.toHaveProperty('buIds');
  await closeFilterChip();
  await waitFor(() => expect(lastListInput()).toMatchObject({ buIds: ['b2', 'b1'] }));
  // Teks bantu hanya selagi filter BU aktif (tampil di isi chip setelah diterapkan).
  await openChip('BU');
  expect(await screen.findByText('Termasuk serial yang pernah di BU ini.')).toBeInTheDocument();
});

test('filter Pencatat: Saya jadi saran pertama, pilihan banyak diterapkan saat chip menutup', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  expect(lastListInput()).not.toHaveProperty('createdBys');
  await openChip('Pencatat');
  const names = await linkOptionNames(screen, 'Filter pencatat');
  expect(names[0]).toBe('Saya');
  // Akun sendiri dari server tidak ditampilkan ganda; entri tanpa nama tampil dengan email.
  expect(names).toEqual(['Saya', 'Budi (budi@x.com)', 'tanpa@x.com']);
  await userEvent.click(await screen.findByRole('option', { name: 'Saya' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Budi (budi@x.com)' }));
  expect(lastListInput()).not.toHaveProperty('createdBys');
  await closeFilterChip();
  await waitFor(() =>
    expect(lastListInput()).toMatchObject({ createdBys: ['a@gmail.com', 'budi@x.com'] }),
  );
  expect(lastListInput()).not.toHaveProperty('createdBy');
  expect(screen.getByRole('button', { name: /^Pencatat: Saya/ })).toBeInTheDocument();
});

test('filter Pencatat: pencarian server dimulai dari 2 karakter', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  await openChip('Pencatat');
  await userEvent.type(screen.getByRole('combobox', { name: 'Filter pencatat' }), 'b');
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(
    apiMock.mock.calls.some(
      (call) => call[0] === 'serials.creatorOptions' && 'query' in (call[1] as object),
    ),
  ).toBe(false);
  await userEvent.type(screen.getByRole('combobox', { name: 'Filter pencatat' }), 'u');
  await waitFor(() =>
    expect(
      apiMock.mock.calls.some(
        (call) =>
          call[0] === 'serials.creatorOptions' && (call[1] as { query?: string }).query === 'bu',
      ),
    ).toBe(true),
  );
});

const creatorOptionCalls = () =>
  apiMock.mock.calls.filter(
    (call) => call[0] === 'serials.creatorOptions' && !('ids' in (call[1] as object)),
  );

test('opsi Pencatat tidak dimuat selagi chip tertutup; dibuka memanggilnya sekali', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.creatorOptions')).toBe(false);
  await openChip('Pencatat');
  await linkOptionNames(screen, 'Filter pencatat');
  expect(creatorOptionCalls()).toHaveLength(1);
  // Satu karakter tidak dikirim: kunci cache sama dengan daftar awal, jadi tidak ada permintaan baru.
  await userEvent.type(screen.getByRole('combobox', { name: 'Filter pencatat' }), 'b');
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(creatorOptionCalls()).toHaveLength(1);
});

test('param lama mine dibaca sebagai Saya; createdBys dari URL menang', async () => {
  await renderPage({ mine: true });
  await screen.findByText('ABC123');
  await waitFor(() => expect(lastListInput()).toMatchObject({ createdBys: ['a@gmail.com'] }));
  expect(screen.getByRole('button', { name: /^Pencatat: Saya/ })).toBeInTheDocument();
});

test('createdBys dari URL: nama nilai terpilih dimuat menurut email', async () => {
  await renderPage({ createdBys: ['budi@x.com'] });
  await screen.findByText('ABC123');
  expect(lastListInput()).toMatchObject({ createdBys: ['budi@x.com'] });
  expect(await screen.findByRole('button', { name: /^Pencatat: Budi/ })).toBeInTheDocument();
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
        permissions: { item: 'none', serial: level, serialservice: 'none', serialwh: 'none' },
      },
    ],
  };
}

const callsOf = (id: string) => apiMock.mock.calls.filter((call) => call[0] === id);

test('kolom checkbox bagi pemegang serial: edit (Tempel stiker) atau manage; pembaca tanpa checkbox', async () => {
  const { unmount: unmountReader } = await renderPage();
  await screen.findByText('ABC123');
  expect(screen.queryByRole('checkbox', { name: 'Pilih semua' })).toBeNull();
  unmountReader();

  me = manageMe('edit');
  const { unmount } = await renderPage();
  await screen.findByText('ABC123');
  expect(screen.getByRole('checkbox', { name: 'Pilih semua' })).toBeInTheDocument();
  unmount();

  me = manageMe('manage');
  await renderPage();
  await screen.findByText('ABC123');
  expect(screen.getByRole('checkbox', { name: 'Pilih semua' })).toBeInTheDocument();
});

test('canManage dari server menentukan Hapus (serial yang pernah di BU lain tak dapat dihapus, tetapi tetap dapat ditempeli stiker); hanya yang dapat dikelola dikirim', async () => {
  me = manageMe();
  apiMock.mockImplementation((id: string, input?: { ids?: string[] }) => {
    if (id === 'serials.removeBatch') return Promise.resolve({ ids: input?.ids ?? [] });
    if (id === 'serials.list') {
      return Promise.resolve({
        items: [row({ canManage: true }), row({ id: 's2', serial: 'XYZ789', canManage: false })],
        nextCursor: null,
      });
    }
    return Promise.resolve({ locations: [], items: [], nextCursor: null });
  });
  await renderPage();
  await screen.findByText('ABC123');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih ABC123' }));
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeInTheDocument();
  // XYZ789: Lolos di QC pada BU yang boleh diedit, jadi dapat dipilih (Tempel stiker) walau tak dapat dihapus.
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih XYZ789' }));
  expect(screen.getByRole('button', { name: 'Tempel stiker' })).toBeInTheDocument();
  // Hapus tampil karena ABC123 dapat dikelola; XYZ789 (canManage false) tidak ikut dikirim.
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus XYZ789' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText('Hapus 1 Serial Number?')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('serials.removeBatch', { ids: ['s1'] }));
});

test('tidak ada ubah massal: bar aksi memuat Tempel stiker dan Hapus saja', async () => {
  me = manageMe();
  await renderPage();
  await screen.findByText('ABC123');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih ABC123' }));
  expect(screen.getByRole('button', { name: 'Tempel stiker' })).toBeInTheDocument();
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

test('pilihan "Terhapus" ada pada chip Status HANYA bagi manage (tanpa chip Tampilan); deleted=true tulisan tangan bagi non-manage diabaikan', async () => {
  await renderPage({ deleted: true });
  await screen.findByText('ABC123');
  expect(screen.queryByRole('button', { name: /^Tampilan/ })).toBeNull();
  expect(lastListInput()).not.toHaveProperty('deleted');
  await openChip('Status');
  expect(await linkOptionNames(screen, 'Filter status')).not.toContain('Terhapus');
});

test('manage: chip Status memuat Terhapus; memilihnya mengosongkan status alur dan sebaliknya (eksklusif)', async () => {
  me = manageMe();
  await renderPage({ statuses: ['reported', 'good'] });
  await screen.findByText('ABC123');
  expect(screen.queryByRole('button', { name: /^Tampilan/ })).toBeNull();
  expect(lastListInput()).toMatchObject({ statuses: ['reported', 'good'] });
  await openChip('Status');
  expect(await linkOptionNames(screen, 'Filter status')).toContain('Terhapus');
  await pickSelect(screen, 'Filter status', 'Terhapus');
  // Eksklusif sudah berlaku pada draf: status alur terlepas seketika, permintaan baru setelah chip menutup.
  await closeFilterChip();
  await waitFor(() => expect(lastListInput()).toMatchObject({ deleted: true }));
  expect(lastListInput()).not.toHaveProperty('statuses');
  expect(screen.getByRole('button', { name: /^Status: Terhapus/ })).toBeInTheDocument();
  // Memilih status alur sesudahnya mengeluarkan tampilan Terhapus.
  await openChip('Status');
  await pickSelect(screen, 'Filter status', 'Dilaporkan');
  await closeFilterChip();
  await waitFor(() => expect(lastListInput()).toMatchObject({ statuses: ['reported'] }));
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
  expect(within(menu).getByRole('menuitem', { name: 'Hapus' })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitem', { name: 'Ubah' })).toBeInTheDocument();
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

// ---------------------------------------------------------------------------------------------------------------------
// Revisi lanjutan 2: aksi baris Lapor rusak (R2) dan Tempel stiker massal (R1).

const SERIAL_DETAIL = {
  buHistory: [],
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
  createdAt: '2026-11-10T03:00:00.000Z',
  note: '',
  recordedLocationId: 'l1',
  stickers: [],
  hasProofPhotos: false,
  proofProblemCount: 0,
  openCaseId: null,
  transitFromLocationId: null,
  transitFromLocationName: null,
  openCase: null,
  cases: [],
  createdBy: 'a@gmail.com',
  updatedAt: '2026-11-11T03:00:00.000Z',
  updatedBy: 'a@gmail.com',
};

test('aksi baris Lapor rusak: hanya pada serial Lolos di QC bagi pemegang edit, sebelum Ubah; membuka dialog setelah detail dimuat', async () => {
  me = manageMe('edit');
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.list') return Promise.resolve({ items: PAGE_1, nextCursor: null });
    if (id === 'serials.get') {
      return Promise.resolve({
        serial: SERIAL_DETAIL,
        events: [],
        eventsTruncated: false,
        problemPhotos: [],
      });
    }
    return Promise.resolve({ locations: [], items: [], stickers: [], nextCursor: null });
  });
  await renderPage();
  await screen.findByText('ABC123');
  const report = screen.getByRole('button', { name: 'Lapor rusak ABC123' });
  const edit = screen.getByRole('button', { name: 'Ubah ABC123' });
  expect(report.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // XYZ789 berstatus Dilaporkan: aksi `report_failure` tak tersedia.
  expect(screen.queryByRole('button', { name: 'Lapor rusak XYZ789' })).toBeNull();
  await userEvent.click(report);
  expect(await screen.findByRole('dialog', { name: 'Lapor rusak' })).toBeInTheDocument();
  expect(callsOf('serials.get')).toHaveLength(1);
  expect(callsOf('serials.get')[0]?.[1]).toEqual({ id: 's1' });
});

test('aksi baris Lapor rusak tidak ada bagi pembaca (serial: view)', async () => {
  await renderPage();
  await screen.findByText('ABC123');
  expect(screen.queryByRole('button', { name: /^Lapor rusak/ })).toBeNull();
});

test('Lapor rusak: kegagalan memuat detail menjadi toast dan dialog tidak terbuka', async () => {
  me = manageMe('edit');
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.list') return Promise.resolve({ items: PAGE_1, nextCursor: null });
    if (id === 'serials.get') return Promise.reject(new Error('Gagal memuat'));
    return Promise.resolve({ locations: [], items: [], stickers: [], nextCursor: null });
  });
  await renderPage();
  await screen.findByText('ABC123');
  await userEvent.click(screen.getByRole('button', { name: 'Lapor rusak ABC123' }));
  await waitFor(() => expect(callsOf('serials.get')).toHaveLength(1));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('Tempel stiker massal: pemegang edit melihat Tempel stiker tanpa Hapus; tanpa aksi per baris Tempel stiker', async () => {
  me = manageMe('edit');
  await renderPage();
  await screen.findByText('ABC123');
  expect(screen.queryByRole('button', { name: /^Tempel stiker/ })).toBeNull();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih ABC123' }));
  expect(screen.getByRole('button', { name: 'Tempel stiker' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
});

test('Tempel stiker tampil bila minimal satu terpilih dapat ditempeli; Hapus bila minimal satu dapat dikelola', async () => {
  me = manageMe();
  apiMock.mockImplementation((id: string) =>
    id === 'serials.list'
      ? Promise.resolve({
          items: [
            row({ id: 's1', serial: 'LOLOS1' }),
            // Rusak: aksi apply_stickers tak tersedia, tetapi pemegang manage masih dapat menghapusnya.
            row({ id: 's5', serial: 'RUSAK5', status: 'broken' }),
          ],
          nextCursor: null,
        })
      : Promise.resolve({ locations: [], items: [], stickers: [], nextCursor: null }),
  );
  await renderPage();
  await screen.findByText('LOLOS1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih LOLOS1' }));
  expect(screen.getByRole('button', { name: 'Tempel stiker' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih RUSAK5' }));
  // Pilihan campuran: LOLOS1 dapat ditempeli, RUSAK5 tidak (hanya dapat dihapus): kedua aksi tetap tampil.
  expect(screen.getByRole('button', { name: 'Tempel stiker' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeInTheDocument();
  // Hanya RUSAK5 terpilih: Tempel stiker tak tampil, Hapus tetap.
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih LOLOS1' }));
  expect(screen.queryByRole('button', { name: 'Tempel stiker' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Hapus' })).toBeInTheDocument();
});

test('baris yang tak dapat ditempeli maupun dikelola (editor, status Rusak) tanpa checkbox', async () => {
  me = manageMe('edit');
  apiMock.mockImplementation((id: string) =>
    id === 'serials.list'
      ? Promise.resolve({
          items: [row({ id: 's5', serial: 'RUSAK5', status: 'broken' })],
          nextCursor: null,
        })
      : Promise.resolve({ locations: [], items: [], stickers: [], nextCursor: null }),
  );
  await renderPage();
  await screen.findByText('RUSAK5');
  expect(screen.queryByRole('checkbox', { name: 'Pilih RUSAK5' })).toBeNull();
});

test('lebih dari 10 kombinasi Item dan BU: Tempel stiker nonaktif dengan alasan', async () => {
  me = manageMe('edit');
  const many = Array.from({ length: 11 }, (_, index) =>
    row({
      id: `g${index}`,
      serial: `GRUP${String(index).padStart(2, '0')}`,
      itemId: `item${index}`,
    }),
  );
  apiMock.mockImplementation((id: string) =>
    id === 'serials.list'
      ? Promise.resolve({ items: many, nextCursor: null })
      : Promise.resolve({ locations: [], items: [], stickers: [], nextCursor: null }),
  );
  await renderPage();
  await screen.findByText('GRUP00');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  expect(screen.getByRole('button', { name: 'Tempel stiker' })).toBeDisabled();
  expect(screen.getByText(/paling banyak 10 kombinasi Item dan BU/)).toBeInTheDocument();
  // Sepuluh kelompok masih boleh.
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih GRUP10' }));
  expect(screen.getByRole('button', { name: 'Tempel stiker' })).toBeEnabled();
});

test('Tempel stiker membuka dialog untuk serial terpilih; sukses membuang pilihan', async () => {
  me = manageMe('edit');
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.list') return Promise.resolve({ items: PAGE_1, nextCursor: null });
    if (id === 'serials.stickerOptions') {
      return Promise.resolve({
        stickers: [{ id: 'st1', name: 'Stiker A', alias: '', typeName: 'J', defaultQty: 1 }],
      });
    }
    if (id === 'serials.applyStickersBatch') return Promise.resolve({ ids: ['s1', 's2'] });
    return Promise.resolve({ locations: [], items: [], nextCursor: null });
  });
  await renderPage();
  await screen.findByText('ABC123');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tempel stiker' }));
  const dialog = await screen.findByRole('dialog', { name: 'Tempel stiker' });
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Stiker A' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tempel stiker' }));
  await waitFor(() => expect(callsOf('serials.applyStickersBatch')).toHaveLength(1));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  // Pilihan dibuang setelah sukses: bar aksi massal hilang.
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Tempel stiker' })).toBeNull());
});

test('Tempel stiker pada pilihan campuran hanya mengirim serial yang dapat ditempeli', async () => {
  me = manageMe();
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.list') {
      return Promise.resolve({
        items: [
          row({ id: 's1', serial: 'LOLOS1' }),
          row({ id: 's5', serial: 'RUSAK5', status: 'broken' }),
        ],
        nextCursor: null,
      });
    }
    if (id === 'serials.stickerOptions') {
      return Promise.resolve({
        stickers: [{ id: 'st1', name: 'Stiker A', alias: '', typeName: 'J', defaultQty: 1 }],
      });
    }
    if (id === 'serials.applyStickersBatch') return Promise.resolve({ ids: ['s1'] });
    return Promise.resolve({ locations: [], items: [], nextCursor: null });
  });
  await renderPage();
  await screen.findByText('LOLOS1');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tempel stiker' }));
  const dialog = await screen.findByRole('dialog', { name: 'Tempel stiker' });
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Stiker A' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tempel stiker' }));
  await waitFor(() => expect(callsOf('serials.applyStickersBatch')).toHaveLength(1));
  const body = callsOf('serials.applyStickersBatch')[0]?.[1] as { rows: { id: string }[] };
  expect(body.rows.map((entry) => entry.id)).toEqual(['s1']);
});

test('Tempel stiker gagal tak jelas lalu dialog ditutup: halaman menampilkan Kirim ulang dengan clientId yang sama; sukses membuang niat dan pilihan', async () => {
  me = manageMe('edit');
  let attempt = 0;
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.list') return Promise.resolve({ items: PAGE_1, nextCursor: null });
    if (id === 'serials.stickerOptions') {
      return Promise.resolve({
        stickers: [{ id: 'st1', name: 'Stiker A', alias: '', typeName: 'J', defaultQty: 1 }],
      });
    }
    if (id === 'serials.applyStickersBatch') {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-'))
        : Promise.resolve({ ids: ['s1', 's2'] });
    }
    return Promise.resolve({ locations: [], items: [], nextCursor: null });
  });
  await renderPage();
  await screen.findByText('ABC123');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tempel stiker' }));
  const dialog = await screen.findByRole('dialog', { name: 'Tempel stiker' });
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Stiker A' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tempel stiker' }));
  await within(dialog).findByRole('button', { name: 'Kirim ulang' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  // Niat tetap hidup di halaman: pemberitahuan dengan Kirim ulang.
  const notice = await screen.findByText(/belum jelas hasilnya/);
  expect(notice).toHaveTextContent('Kiriman Tempel stiker sebelumnya (2 Serial Number');
  expect(notice).toHaveTextContent('bukan pilihan saat ini');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim ulang' }));
  const reopened = await screen.findByRole('dialog', { name: 'Tempel stiker' });
  await userEvent.click(within(reopened).getByRole('button', { name: 'Kirim ulang' }));
  await waitFor(() => expect(callsOf('serials.applyStickersBatch')).toHaveLength(2));
  const [first, second] = callsOf('serials.applyStickersBatch').map((call) => call[1]);
  expect(second).toEqual(first);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByText(/belum jelas hasilnya/)).toBeNull();
});

test('niat Tempel stiker tertunda bertahan saat halaman di-unmount lalu dibuka lagi (id sama); akun lain tidak melihatnya', async () => {
  me = manageMe('edit');
  let attempt = 0;
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.list') return Promise.resolve({ items: PAGE_1, nextCursor: null });
    if (id === 'serials.stickerOptions') {
      return Promise.resolve({
        stickers: [{ id: 'st1', name: 'Stiker A', alias: '', typeName: 'J', defaultQty: 1 }],
      });
    }
    if (id === 'serials.applyStickersBatch') {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', '-'))
        : Promise.resolve({ ids: ['s1', 's2'] });
    }
    return Promise.resolve({ locations: [], items: [], nextCursor: null });
  });
  const first = await renderPage();
  await screen.findByText('ABC123');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tempel stiker' }));
  const dialog = await screen.findByRole('dialog', { name: 'Tempel stiker' });
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Stiker A' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tempel stiker' }));
  await within(dialog).findByRole('button', { name: 'Kirim ulang' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
  await screen.findByText(/belum jelas hasilnya/);
  first.unmount();

  // Akun lain: tidak ada pemberitahuan.
  const otherMe = me;
  me = { ...manageMe('edit'), email: 'lain@gmail.com' };
  const other = await renderPage();
  await screen.findByText('ABC123');
  expect(screen.queryByText(/belum jelas hasilnya/)).toBeNull();
  other.unmount();

  // Akun yang sama membuka daftar lagi: pemberitahuan muncul, kirim ulang memakai id dan isi yang sama.
  me = otherMe;
  await renderPage();
  await screen.findByText('ABC123');
  await screen.findByText(/belum jelas hasilnya/);
  await userEvent.click(screen.getByRole('button', { name: 'Kirim ulang' }));
  const reopened = await screen.findByRole('dialog', { name: 'Tempel stiker' });
  expect(within(reopened).getByText(/Kiriman sebelumnya/)).toBeInTheDocument();
  await userEvent.click(within(reopened).getByRole('button', { name: 'Kirim ulang' }));
  await waitFor(() => expect(callsOf('serials.applyStickersBatch')).toHaveLength(2));
  const [firstCall, secondCall] = callsOf('serials.applyStickersBatch').map((call) => call[1]);
  expect(secondCall).toEqual(firstCall);
  await waitFor(() => expect(screen.queryByText(/belum jelas hasilnya/)).toBeNull());
});

test('ponsel: bar aksi massal satu baris memuat Tempel stiker; lebih dari 10 kombinasi = nonaktif dengan alasan terlihat', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  me = manageMe('edit');
  const many = Array.from({ length: 11 }, (_, index) =>
    row({
      id: `g${index}`,
      serial: `GRUP${String(index).padStart(2, '0')}`,
      itemId: `item${index}`,
    }),
  );
  apiMock.mockImplementation((id: string) =>
    id === 'serials.list'
      ? Promise.resolve({ items: many, nextCursor: null })
      : Promise.resolve({ locations: [], items: [], stickers: [], nextCursor: null }),
  );
  await renderPage();
  await screen.findByRole('link', { name: 'GRUP00' });
  await userEvent.click(screen.getByRole('button', { name: /Aksi GRUP00/ }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Pilih' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih semua' }));
  const bar = screen.getByRole('region', { name: 'Aksi massal' });
  expect(within(bar).getByRole('button', { name: 'Tempel stiker' })).toBeDisabled();
  expect(within(bar).getByText(/paling banyak 10 kombinasi Item dan BU/)).toBeInTheDocument();
  // Sepuluh kelompok: aktif.
  await userEvent.click(screen.getByRole('checkbox', { name: 'Pilih GRUP10' }));
  expect(within(bar).getByRole('button', { name: 'Tempel stiker' })).toBeEnabled();
});

test('badge Tercatat WH dan Butuh foto tampil sesuai DTO', async () => {
  apiMock.mockImplementation((id: string) => {
    if (id === 'serials.list') {
      return Promise.resolve({
        items: [
          row({ id: 's1', serial: 'GUDANG1', whRecorded: true, needsProof: true }),
          row({ id: 's2', serial: 'BIASA2' }),
        ],
        nextCursor: null,
      });
    }
    return Promise.resolve({ locations: [] });
  });
  await renderPage();
  const wh = (await screen.findByRole('link', { name: 'GUDANG1' })).closest('tr') as HTMLElement;
  const plain = screen.getByRole('link', { name: 'BIASA2' }).closest('tr') as HTMLElement;
  expect(within(wh).getByText('Tercatat WH')).toBeInTheDocument();
  expect(within(wh).getByText('Butuh foto')).toBeInTheDocument();
  expect(within(plain).queryByText('Tercatat WH')).not.toBeInTheDocument();
  expect(within(plain).queryByText('Butuh foto')).not.toBeInTheDocument();
});

test('param whRecorded dan needsProof dari URL diteruskan ke serials.list', async () => {
  await renderPage({ whRecorded: 'no', needsProof: true });
  await screen.findByText('ABC123');
  await waitFor(() =>
    expect(lastListInput()).toMatchObject({ whRecorded: 'no', needsProof: true }),
  );
  expect(screen.getByRole('button', { name: /^Gudang: Belum tercatat WH/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Butuh foto: Butuh foto/ })).toBeInTheDocument();
});
