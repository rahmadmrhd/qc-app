import type { GetSerialOutput, MeDto, SerialDto, SerialEventDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { linkOptionNames, pickLink, pickSelect } from '@/test/link-field';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));
// Editor Tiptap tidak dapat diketik di jsdom: diganti kolom teks, mode dicatat di atribut.
vi.mock('@/modules/markdown/wysiwyg-editor', () => ({
  WysiwygEditor: (props: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    labelledBy?: string;
    mode?: string;
  }) => (
    <textarea
      id={props.id}
      aria-labelledby={props.labelledBy}
      data-mode={props.mode}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

import { SerialDetailPage } from './serial-detail-page';

const SERIAL: SerialDto = {
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
  createdAt: '2026-11-10T03:00:00.000Z',
  note: 'catatan awal',
  recordedLocationId: 'l2',
  stickers: [{ stickerId: 'st1', name: 'Stiker A', alias: '', qty: 2, stickerStatus: 'active' }],
  openCaseId: null,
  createdBy: 'budi@x.com',
  updatedAt: '2026-11-11T03:00:00.000Z',
  updatedBy: 'budi@x.com',
};

const event = (
  over: Partial<SerialEventDto> & Pick<SerialEventDto, 'id' | 'seq' | 'type'>,
): SerialEventDto => ({
  occurredOn: '2026-11-10',
  createdAt: '2026-11-10T03:00:00.000Z',
  actorName: 'Budi',
  actorTeam: 'qc',
  message: '',
  changes: [],
  data: {},
  ...over,
});

const EVENTS: SerialEventDto[] = [
  event({
    id: 'e3',
    seq: 3,
    type: 'recheck',
    occurredOn: '2026-11-12',
    message: 'Sudah **dicek** ulang',
    data: { result: 'pass' },
  }),
  event({
    id: 'e1',
    seq: 1,
    type: 'recorded',
    data: {
      stickers: [{ stickerId: 'st1', name: 'Stiker A', qty: 2 }],
      locationId: 'l2',
      locationName: 'Surabaya',
    },
  }),
  event({
    id: 'e2',
    seq: 2,
    type: 'data_changed',
    occurredOn: '2026-11-11',
    changes: [{ field: 'location', from: 'Surabaya', to: 'Jakarta' }],
  }),
].sort((a, b) => b.seq - a.seq); // urutan server: terbaru di atas

let state: GetSerialOutput;

function meWith(serial: 'view' | 'edit'): MeDto {
  return {
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
      serial,
      serialservice: 'none',
    },
    businessUnits: [
      {
        id: 'b1',
        code: 'BU1',
        name: 'Satu',
        status: 'active',
        permissions: { item: 'none', serial, serialservice: 'none' },
      },
    ],
    locations: [
      {
        id: 'l1',
        code: 'JKT',
        name: 'Jakarta',
        permissions: { handover: 'none', qc: 'none', stock: 'none', stickerstock: 'none' },
      },
      {
        id: 'l2',
        code: 'SBY',
        name: 'Surabaya',
        permissions: { handover: 'none', qc: 'none', stock: 'none', stickerstock: 'none' },
      },
    ],
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SerialDetailPage serialId="s1" onBack={() => undefined} />
    </QueryClientProvider>,
  );
}

const calls = (id: string) => apiMock.mock.calls.filter((call) => call[0] === id);

beforeEach(() => {
  apiMock.mockReset();
  state = { serial: SERIAL, events: EVENTS, eventsTruncated: false };
  me = meWith('edit');
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.get') return Promise.resolve(structuredClone(state));
    if (id === 'serials.stickerOptions') {
      return Promise.resolve({
        stickers: [
          { id: 'st1', name: 'Stiker A', alias: '', typeName: 'J', defaultQty: 1 },
          { id: 'st2', name: 'Stiker B', alias: '', typeName: 'J', defaultQty: 1 },
        ],
      });
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
          { id: 'i2', label: 'Aruba 2930', buIds: ['b1'], buOptions: [{ id: 'b1', code: 'BU1' }] },
          { id: 'i9', label: 'Lain BU', buIds: ['b9'], buOptions: [{ id: 'b9', code: 'BU9' }] },
        ],
        nextCursor: null,
      });
    }
    if (id === 'serials.act') {
      const act = input as {
        action: string;
        locationId?: string;
        stickers?: { stickerId: string; qty: number }[];
        message: string;
        occurredOn: string;
      };
      const nextSerial = { ...state.serial, updatedAt: '2026-11-13T03:00:00.000Z' };
      state = {
        serial: nextSerial,
        events: [
          event({
            id: 'e4',
            seq: 4,
            type: act.action === 'recheck' ? 'recheck' : 'note',
            occurredOn: act.occurredOn,
            message: act.message,
          }),
          ...state.events,
        ],
        eventsTruncated: false,
      };
      return Promise.resolve(nextSerial);
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

test('merender kepala, ringkasan, dan linimasa terbaru di atas (urutan server) dengan chip perubahan', async () => {
  renderPage();
  expect(await screen.findByRole('heading', { name: 'ABC123' })).toBeInTheDocument();
  expect(screen.getByText('Cisco C9200')).toBeInTheDocument();
  const summary = screen.getByRole('region', { name: 'Ringkasan' });
  expect(within(summary).getByText('10 Nov 2026')).toBeInTheDocument();
  // Terakhir lolos = kejadian lolos terbaru (cek ulang 12 Nov).
  expect(within(summary).getByText('12 Nov 2026')).toBeInTheDocument();
  expect(within(summary).getByText('Surabaya')).toBeInTheDocument();
  expect(within(summary).getByText('Stiker A ×2')).toBeInTheDocument();

  const cards = within(screen.getByRole('list', { name: 'Linimasa' })).getAllByRole('listitem', {
    name: '',
  });
  const top = cards.filter((card) => card.hasAttribute('data-seq'));
  expect(top.map((card) => card.getAttribute('data-seq'))).toEqual(['3', '2', '1']);
  expect(screen.getByText('Lokasi: Surabaya → Jakarta')).toBeInTheDocument();
  expect(screen.getByText(/Stiker ditempel dan stok dipotong: Stiker A ×2/)).toBeInTheDocument();
  expect(screen.getByText('dicek')).toBeInTheDocument();
});

test('cek ulang mengirim serials.act dengan expectedUpdatedAt dan menampilkan kartu baru', async () => {
  renderPage();
  await screen.findByRole('region', { name: 'Pembaruan baru' });
  expect(screen.getByRole('textbox', { name: 'Catatan' })).toHaveAttribute('data-mode', 'message');
  await pickSelect(screen, 'Aksi', 'Cek ulang');
  await pickLink(screen, 'Lokasi cek ulang', 'Surabaya (SBY)');
  const kurangi = await screen.findByRole('button', { name: 'Kurangi Stiker A' });
  // Jumlah sekarang 2: tidak dapat turun di bawah nilai itu.
  expect(kurangi).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Stiker A' }));
  expect(screen.getByLabelText('Jumlah Stiker A')).toHaveTextContent('3');
  expect(screen.getByRole('button', { name: 'Kurangi Stiker A' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Stiker B' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan cek ulang' }));

  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(calls('serials.act')[0]?.[1]).toMatchObject({
    id: 's1',
    expectedUpdatedAt: '2026-11-11T03:00:00.000Z',
    action: 'recheck',
    locationId: 'l2',
    stickers: [
      { stickerId: 'st1', qty: 3 },
      { stickerId: 'st2', qty: 1 },
    ],
  });
  // Detail dimuat ulang: kartu kejadian baru muncul.
  await waitFor(() => {
    const seqs = screen
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('data-seq'))
      .filter(Boolean);
    expect(seqs).toContain('4');
  });
});

test('catatan wajib berisi; mengirim catatan mengosongkan kolom', async () => {
  renderPage();
  await screen.findByRole('region', { name: 'Pembaruan baru' });
  const send = screen.getByRole('button', { name: 'Kirim catatan' });
  expect(send).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'Cek kabel');
  expect(send).toBeEnabled();
  await userEvent.click(send);
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(calls('serials.act')[0]?.[1]).toMatchObject({ action: 'note', message: 'Cek kabel' });
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Catatan' })).toHaveValue(''));
});

test('pengguna serial: view tidak melihat composer maupun tombol ubah', async () => {
  me = meWith('view');
  renderPage();
  expect(await screen.findByRole('heading', { name: 'ABC123' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Pembaruan baru' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ubah data' })).not.toBeInTheDocument();
});

test('versi usang (412) menampilkan pesan dan memuat ulang detail', async () => {
  renderPage();
  await screen.findByRole('region', { name: 'Pembaruan baru' });
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.act'
      ? Promise.reject(new ApiError('CONFLICT', 'basi', '-', undefined, { status: 412 }))
      : original?.(id, input),
  );
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'halo');
  const before = calls('serials.get').length;
  await userEvent.click(screen.getByRole('button', { name: 'Kirim catatan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Data sudah diubah orang lain');
  expect(screen.getByRole('alert')).toHaveTextContent('lokasi dan jumlah stiker dikembalikan');
  await waitFor(() => expect(calls('serials.get').length).toBeGreaterThan(before));
  // Pesan pengguna tidak hilang.
  expect(screen.getByRole('textbox', { name: 'Catatan' })).toHaveValue('halo');
});

test('dialog ubah data mengirim data lengkap dan menampilkan "Serial sudah terdaftar" pada duplikat', async () => {
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah data' }));
  const dialog = await screen.findByRole('dialog');
  const save = within(dialog).getByRole('button', { name: 'Simpan' });
  expect(save).toBeDisabled();
  const serialInput = within(dialog).getByLabelText('Serial');
  await userEvent.clear(serialInput);
  await userEvent.type(serialInput, 'xyz-9');
  expect(save).toBeEnabled();

  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.update'
      ? Promise.reject(
          new ApiError('CONFLICT', 'Serial sudah terdaftar', '-', {
            serial: 'Serial sudah terdaftar',
          }),
        )
      : original?.(id, input),
  );
  await userEvent.click(save);
  expect(await within(dialog).findByText('Serial sudah terdaftar')).toBeInTheDocument();
  expect(calls('serials.update')[0]?.[1]).toEqual({
    id: 's1',
    expectedUpdatedAt: '2026-11-11T03:00:00.000Z',
    serial: 'XYZ-9',
    itemId: 'i1',
    testDate: '2026-11-10',
    sample: false,
    note: 'catatan awal',
    locationId: 'l1',
  });
  // Hanya item pada BU serial yang ditawarkan.
  const names = await linkOptionNames(within(dialog), 'Item');
  expect(names).toContain('Aruba 2930');
  expect(names).not.toContain('Lain BU');
});

test('dialog ubah data setelah 412: formulir dibasiskan ulang ke data server dan simpan ulang memakai versi baru', async () => {
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah data' }));
  const dialog = await screen.findByRole('dialog');
  const noteInput = within(dialog).getByLabelText('Catatan');
  await userEvent.clear(noteInput);
  await userEvent.type(noteInput, 'catatan A');

  // Orang lain memindahkan lokasi ke Surabaya sementara dialog terbuka.
  const fresh = {
    ...SERIAL,
    locationId: 'l2',
    locationName: 'Surabaya',
    updatedAt: '2026-11-13T03:00:00.000Z',
  };
  const original = apiMock.getMockImplementation();
  let updates = 0;
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.update') {
      updates++;
      if (updates === 1) {
        state = { serial: fresh, events: state.events, eventsTruncated: false };
        return Promise.reject(new ApiError('CONFLICT', 'basi', '-', undefined, { status: 412 }));
      }
      return Promise.resolve(fresh);
    }
    return original?.(id, input);
  });

  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(await within(dialog).findByRole('status')).toHaveTextContent(
    'Data sudah diubah orang lain',
  );
  // Lokasi mengikuti server (belum disentuh pengguna); catatan pengguna dipertahankan.
  expect(within(dialog).getByRole('combobox', { name: 'Lokasi' })).toHaveValue('Surabaya (SBY)');
  expect(within(dialog).getByLabelText('Catatan')).toHaveValue('catatan A');

  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(calls('serials.update')).toHaveLength(2));
  expect(calls('serials.update')[1]?.[1]).toMatchObject({
    id: 's1',
    expectedUpdatedAt: '2026-11-13T03:00:00.000Z',
    note: 'catatan A',
    locationId: 'l2',
  });
});

test('dialog ubah data setelah 412: bidang yang juga diubah orang lain ditandai; catatan hanya spasi bukan perubahan', async () => {
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah data' }));
  const dialog = await screen.findByRole('dialog');
  const noteInput = within(dialog).getByLabelText('Catatan');
  await userEvent.clear(noteInput);
  await userEvent.type(noteInput, 'catatan A');
  const serialInput = within(dialog).getByLabelText('Serial');
  await userEvent.type(serialInput, ' ');

  // Orang lain mengubah catatan dan tanggal uji; serial hanya bertambah spasi di sisi pengguna.
  const fresh = {
    ...SERIAL,
    note: 'catatan B',
    testDate: '2026-11-09',
    updatedAt: '2026-11-13T03:00:00.000Z',
  };
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.update') {
      state = { serial: fresh, events: state.events, eventsTruncated: false };
      return Promise.reject(new ApiError('CONFLICT', 'basi', '-', undefined, { status: 412 }));
    }
    return original?.(id, input);
  });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  await within(dialog).findByRole('status');
  // Catatan: pengguna dan orang lain sama-sama mengubah, nilainya berbeda: ditandai.
  expect(within(dialog).getByText(/Diubah orang lain menjadi: catatan B/)).toBeInTheDocument();
  // Tanggal uji belum disentuh pengguna: diganti nilai server tanpa tanda.
  expect(within(dialog).getByLabelText('Tanggal uji')).toHaveValue('2026-11-09');
  expect(within(dialog).queryByText(/Diubah orang lain menjadi: 2026-11-09/)).toBeNull();
  // Serial hanya ditambah spasi (setelah normalisasi tak berubah): mengikuti server, tanpa tanda.
  expect(within(dialog).getByLabelText('Serial')).toHaveValue('ABC123');
  expect(within(dialog).getByLabelText('Catatan')).toHaveValue('catatan A');
});

test('dialog ubah data setelah 412: lokasi dan item yang juga diubah orang lain ditandai; sample yang sama-sama diubah tidak', async () => {
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah data' }));
  const dialog = await screen.findByRole('dialog');
  await pickLink(within(dialog), 'Lokasi', 'Surabaya (SBY)');
  await pickLink(within(dialog), 'Item', 'Aruba 2930');
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Sample' }));

  // Orang lain mengubah lokasi (ke Bandung), item (ke Lain BU), dan sample (ke true) juga.
  const fresh = {
    ...SERIAL,
    locationId: 'l3',
    locationName: 'Bandung',
    itemId: 'i9',
    itemLabel: 'Lain BU',
    sample: true,
    updatedAt: '2026-11-13T03:00:00.000Z',
  };
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.update') {
      state = { serial: fresh, events: state.events, eventsTruncated: false };
      return Promise.reject(new ApiError('CONFLICT', 'basi', '-', undefined, { status: 412 }));
    }
    return original?.(id, input);
  });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  await within(dialog).findByRole('status');
  expect(within(dialog).getByText(/Diubah orang lain menjadi: Bandung/)).toBeInTheDocument();
  expect(within(dialog).getByText(/Diubah orang lain menjadi: Lain BU/)).toBeInTheDocument();
  // Sample: nilai server sama dengan nilai pengguna, jadi tak ada konflik.
  expect(within(dialog).queryByText(/Diubah orang lain menjadi: Sample/)).toBeNull();
  expect(within(dialog).queryByText(/Diubah orang lain menjadi: Bukan sample/)).toBeNull();
  // Nilai pengguna dipertahankan sampai ia memutuskan.
  expect(within(dialog).getByRole('combobox', { name: 'Lokasi' })).toHaveValue('Surabaya (SBY)');
});

test('linimasa terpotong: catatan "hanya 500 kejadian terbaru" tampil; tidak tampil bila tidak terpotong', async () => {
  state = { ...state, eventsTruncated: true };
  const { unmount } = renderPage();
  expect(await screen.findByRole('note')).toHaveTextContent('Hanya 500 kejadian terbaru');
  unmount();
  state = { ...state, eventsTruncated: false };
  renderPage();
  await screen.findByRole('heading', { name: 'ABC123' });
  expect(screen.queryByText(/Hanya 500 kejadian terbaru/)).toBeNull();
});

test('cek ulang: penaik jumlah stiker nonaktif dimatikan dengan keterangan; deprecated tetap boleh', async () => {
  state = {
    ...state,
    serial: {
      ...SERIAL,
      stickers: [
        { stickerId: 'st1', name: 'Stiker A', alias: '', qty: 2, stickerStatus: 'inactive' },
        { stickerId: 'st2', name: 'Stiker B', alias: '', qty: 1, stickerStatus: 'deprecated' },
      ],
    },
  };
  renderPage();
  await screen.findByRole('region', { name: 'Pembaruan baru' });
  await pickSelect(screen, 'Aksi', 'Cek ulang');
  expect(await screen.findByRole('button', { name: 'Tambah Stiker A' })).toBeDisabled();
  expect(screen.getByText('Stiker nonaktif: jumlah tidak dapat ditambah')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tambah Stiker B' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Stiker A' }));
  expect(screen.getByLabelText('Jumlah Stiker A')).toHaveTextContent('2');
});

test('galat server pada stickers dan message (karakter pengatur arah) tampil lewat jalur galat yang ada', async () => {
  renderPage();
  await screen.findByRole('region', { name: 'Pembaruan baru' });
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.act'
      ? Promise.reject(
          new ApiError('VALIDATION', 'Data tidak valid', '-', {
            stickers: 'Stiker nonaktif tidak dapat ditambah jumlahnya',
            message: 'Pesan memuat karakter pengatur arah teks',
          }),
        )
      : original?.(id, input),
  );
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'halo');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim catatan' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Stiker nonaktif tidak dapat ditambah jumlahnya');
  expect(alert).toHaveTextContent('Pesan memuat karakter pengatur arah teks');
});
