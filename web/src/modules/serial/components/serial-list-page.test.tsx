import type { MeDto, SerialSummaryDto } from '@shared/contract';
import { listSerialsTooLong } from '@shared/serials';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { linkOptionNames, pickLink, pickSelect } from '@/test/link-field';
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
      onClick={() => onScan('bbb222\nAAA111\nccc333')}
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
  createdAt: '2026-11-10T03:00:00.000Z',
  ...over,
});

const PAGE_1 = [row({}), row({ id: 's2', serial: 'XYZ789', sample: true, status: 'reported' })];

function Harness({
  onOpen = () => undefined,
  onNew,
  initial = {},
}: {
  onOpen?: (id: string) => void;
  onNew?: () => void;
  initial?: Record<string, unknown>;
}) {
  const [search, setSearch] = useState<SerialSearch>(serialSearchSchema.parse(initial));
  return (
    <SerialListPage
      search={search}
      onSearchChange={(patch) => setSearch((prev) => ({ ...prev, ...patch }))}
      onOpen={onOpen}
      onNew={onNew}
    />
  );
}

function renderPage(
  onOpen?: (id: string) => void,
  initial?: Record<string, unknown>,
  onNew?: () => void,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness
        {...(onOpen ? { onOpen } : {})}
        {...(initial ? { initial } : {})}
        {...(onNew ? { onNew } : {})}
      />
    </QueryClientProvider>,
  );
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
  renderPage();
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

test('klik serial membuka detail', async () => {
  const onOpen = vi.fn();
  renderPage(onOpen);
  await userEvent.click(await screen.findByRole('button', { name: 'XYZ789' }));
  expect(onOpen).toHaveBeenCalledWith('s2');
});

test('pencarian banyak serial mengirim bentuk ternormalisasi', async () => {
  renderPage();
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
  renderPage();
  await screen.findByText('ABC123');
  fireEvent.change(screen.getByLabelText('Cari serial (satu per baris)'), {
    target: { value: 'abc' },
  });
  await waitFor(() => expect(lastListInput()).toMatchObject({ query: 'ABC' }), { timeout: 3000 });
});

test('hanya ada satu field pencarian serial (tanpa field "Pindai untuk mencari")', async () => {
  renderPage();
  await screen.findByText('ABC123');
  expect(screen.queryByLabelText('Pindai untuk mencari')).not.toBeInTheDocument();
  expect(screen.getAllByRole('textbox', { name: /serial/i })).toHaveLength(1);
});

test('Enter menetapkan baris yang ditulis: sah tetap dan pindah baris, duplikat dibuang dengan umpan balik', async () => {
  renderPage();
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
  renderPage();
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
  renderPage();
  await screen.findByText('ABC123');
  const field = screen.getByLabelText('Cari serial (satu per baris)');
  await userEvent.type(field, 'aaa111{Enter}');
  await userEvent.click(screen.getByRole('button', { name: 'Scan dengan kamera' }));
  expect(field).toHaveValue('AAA111\nBBB222\nCCC333');
  expect(screen.getByText('Ditambahkan')).toBeInTheDocument();
  expect(screen.getByText('3 serial dicari (maks. 50)')).toBeInTheDocument();
});

test('Enter tidak membuang sisa teks yang melebihi batas, juga setelah gema URL', async () => {
  renderPage();
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
  renderPage();
  await screen.findByText('ABC123');
  const field = screen.getByLabelText('Cari serial (satu per baris)') as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: 'ab' } });
  await userEvent.click(screen.getByRole('button', { name: 'Scan dengan kamera' }));
  expect(field.value).toBe('ab\nBBB222\nAAA111\nCCC333');
});

test('Enter di baris tengah menetapkan baris itu saja', async () => {
  renderPage();
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
  renderPage();
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
  renderPage();
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
  renderPage();
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
  renderPage();
  await screen.findByText('ABC123');
  await pickSelect(screen, 'Filter status', 'Dilaporkan');
  await waitFor(() => expect(lastListInput()).toMatchObject({ status: 'reported' }));
  await pickLink(screen, 'Filter lokasi', 'Jakarta (JKT)');
  await waitFor(() => expect(lastListInput()).toMatchObject({ locationId: 'l1' }));
  await pickLink(screen, 'Filter item', 'Cisco C9200');
  await waitFor(() => expect(lastListInput()).toMatchObject({ itemId: 'i1' }));
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
  renderPage();
  expect(await screen.findByText('Tidak ada serial yang cocok.')).toBeInTheDocument();
});

test('tempelan melebihi batas: pesan jelas, hanya serial pertama yang dicari', async () => {
  renderPage();
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
  renderPage();
  await screen.findByText('ABC123');
  const names = await linkOptionNames(screen, 'Filter lokasi');
  expect(names).toEqual(['Jakarta (JKT)']);
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.locationOptions')).toBe(false);
});

test('pembaca serialservice: view juga tidak memanggil serials.locationOptions', async () => {
  me = { ...me, permissions: { ...me.permissions, serial: 'none', serialservice: 'view' } };
  renderPage();
  await screen.findByText('ABC123');
  await linkOptionNames(screen, 'Filter lokasi');
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.locationOptions')).toBe(false);
});

test('editor (serial: edit) memuat semua lokasi aktif dari serials.locationOptions', async () => {
  me = { ...me, permissions: { ...me.permissions, serial: 'edit' } };
  renderPage();
  await screen.findByText('ABC123');
  const names = await linkOptionNames(screen, 'Filter lokasi');
  expect(names).toEqual(['Jakarta (JKT)', 'Surabaya (SBY)']);
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.locationOptions')).toBe(true);
});

test('tempelan serial lebar melebihi panjang URL: pesan khusus dan hanya awalan yang dikirim', async () => {
  renderPage();
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
  const { unmount } = renderPage();
  await screen.findByText('ABC123');
  expect(screen.getByText(/belum ditugaskan ke lokasi mana pun/)).toBeInTheDocument();
  unmount();

  // Editor memakai serials.locationOptions: tidak bergantung penugasan, jadi tanpa peringatan.
  me = { ...me, permissions: { ...me.permissions, serial: 'edit' } };
  renderPage();
  await screen.findAllByText('ABC123');
  expect(screen.queryByText(/belum ditugaskan ke lokasi mana pun/)).toBeNull();
});

test('filter item berfungsi bagi pembaca (serial: view): item dimuat dari serials.itemOptions tanpa gerbang edit', async () => {
  me = { ...me, permissions: { ...me.permissions, serial: 'none', serialservice: 'view' } };
  renderPage();
  await screen.findByText('ABC123');
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
                openCaseNumber: 'LP-20261110-001',
              }),
              row({
                id: 's8',
                serial: 'DIAM1',
                status: 'reported',
                openCaseNumber: 'LP-20261112-004',
              }),
            ],
            nextCursor: null,
          })
        : Promise.resolve({ locations: [], items: [], nextCursor: null }),
    );
    renderPage();
    expect(await screen.findByText('KIRIM1')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    const sending = within(rows[1] as HTMLElement);
    expect(sending.getByText('Dalam pengiriman · 3 hari')).toBeInTheDocument();
    expect(sending.getByText('ke Surabaya')).toBeInTheDocument();
    expect(sending.getByText('LP-20261110-001')).toBeInTheDocument();
    const still = within(rows[2] as HTMLElement);
    expect(still.getByText('Di QC')).toBeInTheDocument();
    expect(still.getByText('LP-20261112-004')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('filter posisi masuk masukan serials.list lewat Select', async () => {
  renderPage();
  await screen.findByText('ABC123');
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
  renderPage();
  await screen.findByText('ABC123');
  const names = await linkOptionNames(screen, 'Filter BU');
  expect(names).toEqual(['B1 · Unit b1', 'B2 · Unit b2']);
  await userEvent.click(await screen.findByRole('option', { name: 'B2 · Unit b2' }));
  await waitFor(() => expect(lastListInput()).toMatchObject({ buId: 'b2' }));
});

test('sakelar "Dicatat oleh saya" mengisi createdBy dengan email akun', async () => {
  renderPage();
  await screen.findByText('ABC123');
  expect(lastListInput()).not.toHaveProperty('createdBy');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Dicatat oleh saya' }));
  await waitFor(() => expect(lastListInput()).toMatchObject({ createdBy: 'a@gmail.com' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Dicatat oleh saya' }));
  await waitFor(() => expect(lastListInput()).not.toHaveProperty('createdBy'));
});

test('filter BU dari URL yang tidak dikenal tidak menampilkan id mentah', async () => {
  renderPage(undefined, { bu: 'b-rahasia-123' });
  await screen.findByText('ABC123');
  expect(screen.queryByDisplayValue('b-rahasia-123')).toBeNull();
  expect(screen.queryByText('b-rahasia-123')).toBeNull();
  expect(screen.getByDisplayValue('BU tidak dikenal')).toBeInTheDocument();
});

test('tombol "Tambah Serial Number" hanya tampil bila ada jalan masuk mencatat, dan memanggilnya', async () => {
  const { unmount } = renderPage();
  await screen.findByText('ABC123');
  expect(screen.queryByRole('button', { name: 'Tambah Serial Number' })).toBeNull();
  unmount();
  const onNew = vi.fn();
  renderPage(undefined, undefined, onNew);
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
  renderPage();
  const withPhoto = (await screen.findByRole('button', { name: 'ADA1' })).closest(
    'tr',
  ) as HTMLElement;
  const without = screen.getByRole('button', { name: 'TANPA2' }).closest('tr') as HTMLElement;
  expect(within(withPhoto).getByText('Bukti foto QC')).toBeInTheDocument();
  expect(within(without).queryByText('Bukti foto QC')).not.toBeInTheDocument();
});
