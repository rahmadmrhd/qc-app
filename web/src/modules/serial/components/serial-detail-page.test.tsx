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
  transitToLocationId: null,
  transitToLocationName: null,
  transitOn: null,
  openCaseNumber: null,
  createdAt: '2026-11-10T03:00:00.000Z',
  note: 'catatan awal',
  recordedLocationId: 'l2',
  stickers: [{ stickerId: 'st1', name: 'Stiker A', alias: '', qty: 2, stickerStatus: 'active' }],
  openCaseId: null,
  transitFromLocationId: null,
  transitFromLocationName: null,
  openCase: null,
  cases: [],
  createdBy: 'budi@x.com',
  updatedAt: '2026-11-11T03:00:00.000Z',
  updatedBy: 'budi@x.com',
};

const event = (
  over: Partial<SerialEventDto> & Pick<SerialEventDto, 'id' | 'seq' | 'type'>,
): SerialEventDto => ({
  caseId: null,
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

const CHECK_TYPES = ['recorded', 'recheck', 'recheck_pass', 'recheck_fail'];
let historyLimit = 50;

/** Meniru `serials.history`: terbaru di atas, kursor = seq terakhir, jumlah dihitung atas semua kejadian. */
function historyOf(input: Record<string, unknown>) {
  const {
    group = 'all',
    caseId,
    cursor,
  } = input as {
    group?: string;
    caseId?: string;
    cursor?: string;
  };
  const limit = historyLimit;
  let list = [...state.events].sort((a, b) => b.seq - a.seq);
  if (group === 'checks') list = list.filter((entry) => CHECK_TYPES.includes(entry.type));
  if (group === 'changes') list = list.filter((entry) => entry.type === 'data_changed');
  if (caseId) list = list.filter((entry) => entry.caseId === caseId);
  if (cursor) list = list.filter((entry) => entry.seq < Number(cursor));
  const page = list.slice(0, limit);
  const byCase: Record<string, number> = {};
  for (const entry of state.events) {
    if (entry.caseId) byCase[entry.caseId] = (byCase[entry.caseId] ?? 0) + 1;
  }
  return {
    events: page,
    nextCursor: list.length > limit ? String(page.at(-1)?.seq) : null,
    counts: {
      all: state.events.length,
      checks: state.events.filter((entry) => CHECK_TYPES.includes(entry.type)).length,
      changes: state.events.filter((entry) => entry.type === 'data_changed').length,
      byCase,
    },
  };
}

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
  historyLimit = 50;
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.get') return Promise.resolve(structuredClone(state));
    if (id === 'serials.history') return Promise.resolve(historyOf(input));
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

  const cards = within(await screen.findByRole('list', { name: 'Linimasa' })).getAllByRole(
    'listitem',
    { name: '' },
  );
  const top = cards.filter((card) => card.hasAttribute('data-seq'));
  expect(top.map((card) => card.getAttribute('data-seq'))).toEqual(['3', '2', '1']);
  expect(screen.getByText('Lokasi: Surabaya → Jakarta')).toBeInTheDocument();
  expect(screen.getByText(/Stiker ditempel dan stok dipotong: Stiker A ×2/)).toBeInTheDocument();
  expect(screen.getByText('dicek')).toBeInTheDocument();
});

test('cek ulang mengirim serials.act dengan expectedUpdatedAt dan menampilkan kartu baru', async () => {
  renderPage();
  await screen.findByRole('region', { name: 'Update baru' });
  expect(screen.getByRole('textbox', { name: 'Catatan' })).toHaveAttribute('data-mode', 'message');
  expect(screen.getByLabelText('Tanggal')).toBeInTheDocument();
  expect(screen.queryByLabelText('Tanggal kejadian')).not.toBeInTheDocument();
  await pickSelect(screen, 'Jenis update', 'Cek ulang');
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
  await screen.findByRole('region', { name: 'Update baru' });
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
  expect(screen.queryByRole('region', { name: 'Update baru' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ubah data' })).not.toBeInTheDocument();
});

test('versi usang (412) menampilkan pesan dan memuat ulang detail', async () => {
  renderPage();
  await screen.findByRole('region', { name: 'Update baru' });
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
  expect(screen.getByRole('alert')).toHaveTextContent(
    'lokasi dan jumlah stiker kembali ke data terbaru',
  );
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
  expect(
    within(dialog).getByText(/Orang lain sudah mengubahnya jadi: catatan B/),
  ).toBeInTheDocument();
  // Tanggal uji belum disentuh pengguna: diganti nilai server tanpa tanda.
  expect(within(dialog).getByLabelText('Tanggal uji')).toHaveValue('2026-11-09');
  expect(within(dialog).queryByText(/Orang lain sudah mengubahnya jadi: 2026-11-09/)).toBeNull();
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
  expect(
    within(dialog).getByText(/Orang lain sudah mengubahnya jadi: Bandung/),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByText(/Orang lain sudah mengubahnya jadi: Lain BU/),
  ).toBeInTheDocument();
  // Sample: nilai server sama dengan nilai pengguna, jadi tak ada konflik.
  expect(within(dialog).queryByText(/Orang lain sudah mengubahnya jadi: Sample/)).toBeNull();
  expect(within(dialog).queryByText(/Orang lain sudah mengubahnya jadi: Bukan sample/)).toBeNull();
  // Nilai pengguna dipertahankan sampai ia memutuskan.
  expect(within(dialog).getByRole('combobox', { name: 'Lokasi' })).toHaveValue('Surabaya (SBY)');
});

test('linimasa memuat berkursor: tombol "Muat yang lebih lama" mengirim cursor dan tidak ada catatan terpotong', async () => {
  historyLimit = 2;
  state = { ...state, eventsTruncated: true };
  renderPage();
  await screen.findByRole('list', { name: 'Linimasa' });
  expect(screen.queryByText(/Hanya 500 entri terbaru/)).toBeNull();
  const seqs = () =>
    within(screen.getByRole('list', { name: 'Linimasa' }))
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('data-seq'))
      .filter(Boolean);
  expect(seqs()).toEqual(['3', '2']);
  await userEvent.click(screen.getByRole('button', { name: 'Muat yang lebih lama' }));
  await waitFor(() => expect(seqs()).toEqual(['3', '2', '1']));
  expect(calls('serials.history')[1]?.[1]).toMatchObject({ id: 's1', cursor: '2' });
  expect(screen.queryByRole('button', { name: 'Muat yang lebih lama' })).toBeNull();
});

test('tab linimasa: jumlah dari counts, Pengecekan dan tab kasus mengirim group dan caseId', async () => {
  state = {
    ...state,
    serial: {
      ...SERIAL,
      cases: [
        {
          id: 'c1',
          number: 'LP-20261113-001',
          openedOn: '2026-11-13',
          closedOn: null,
          damage: 'Port mati',
          outcome: null,
        },
      ],
    },
    events: [
      event({
        id: 'e4',
        seq: 4,
        type: 'report_failure',
        caseId: 'c1',
        data: { caseNumber: 'LP-20261113-001', damage: 'Port mati' },
      }),
      ...state.events,
    ],
  };
  renderPage();
  expect(await screen.findByRole('tab', { name: 'Semua (4)' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Pengecekan (2)' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Perubahan data (1)' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'LP-20261113-001 (1)' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('tab', { name: 'Pengecekan (2)' }));
  await waitFor(() =>
    expect(calls('serials.history').some((call) => call[1].group === 'checks')).toBe(true),
  );
  await userEvent.click(screen.getByRole('tab', { name: 'LP-20261113-001 (1)' }));
  await waitFor(() =>
    expect(calls('serials.history').some((call) => call[1].caseId === 'c1')).toBe(true),
  );
  const list = await screen.findByRole('list', { name: 'Linimasa' });
  expect(
    within(list)
      .getAllByRole('listitem')
      .filter((li) => li.hasAttribute('data-seq')),
  ).toHaveLength(1);
  expect(within(list).getByText('Kasus LP-20261113-001 dibuka: Port mati')).toBeInTheDocument();
  // Jumlah tab tetap terlihat setelah berpindah tab.
  expect(screen.getByRole('tab', { name: 'Semua (4)' })).toBeInTheDocument();
});

test('kartu declare_broken, kirim, dan terima menampilkan rincian kasus dan pengiriman', async () => {
  state = {
    ...state,
    events: [
      event({
        id: 'e7',
        seq: 7,
        type: 'declare_broken',
        actorTeam: 'service',
        data: { caseNumber: 'LP-20261113-001', outcome: 'broken' },
      }),
      event({
        id: 'e6',
        seq: 6,
        type: 'receive',
        actorTeam: 'service',
        data: {
          leg: 'at_service',
          fromLocationName: 'Jakarta',
          toLocationName: 'Surabaya',
          daysInTransit: 3,
        },
      }),
      event({
        id: 'e5',
        seq: 5,
        type: 'send',
        data: {
          leg: 'to_service',
          fromLocationName: 'Jakarta',
          toLocationName: 'Surabaya',
          shipmentNote: 'JNE resi 123',
        },
      }),
      ...state.events,
    ],
  };
  renderPage();
  const list = await screen.findByRole('list', { name: 'Linimasa' });
  expect(within(list).getByText('Kasus LP-20261113-001 ditutup: rusak')).toBeInTheDocument();
  expect(within(list).getByText('Diterima di servis')).toBeInTheDocument();
  expect(within(list).getByText('Dikirim ke servis')).toBeInTheDocument();
  expect(within(list).getByText('Lama di perjalanan: 3 hari')).toBeInTheDocument();
  expect(within(list).getByText('Catatan pengiriman: JNE resi 123')).toBeInTheDocument();
});

const CASE_DTO = {
  id: 'c1',
  number: 'LP-20261113-001',
  openedOn: '2026-11-13',
  closedOn: null,
  damage: 'x',
  outcome: null,
} as const;

const STEP_CASES: [SerialDto['status'], string, boolean][] = [
  ['good', 'Lolos', false],
  ['failed', 'Tidak lolos', true],
  ['qc_repair', 'Perbaikan QC', true],
  ['at_service', 'Di servis', true],
  ['service_repair', 'Perbaikan servis', true],
  ['recheck', 'Cek ulang', true],
  ['broken', 'Rusak', true],
  ['good', 'Lolos', true],
];

test.each(STEP_CASES)(
  'baris tahap menyorot tahap untuk status %s (%s, kasus: %s)',
  async (status, label, hasCase) => {
    state = {
      ...state,
      serial: {
        ...SERIAL,
        status,
        custody:
          status === 'at_service' || status === 'service_repair' || status === 'broken'
            ? 'service'
            : 'qc',
        cases: hasCase ? [CASE_DTO] : [],
        openCase: null,
      },
    };
    renderPage();
    const steps = await screen.findByRole('list', { name: 'Tahap' });
    const active = within(steps)
      .getAllByRole('listitem')
      .filter((li) => li.getAttribute('aria-current') === 'step');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent(label);
  },
);

test('panel pengiriman: dari ke, catatan, dan "3 hari belum diterima" (tanggal dipatok)', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-13T03:00:00.000Z') });
  try {
    state = {
      ...state,
      serial: {
        ...SERIAL,
        status: 'at_service',
        custody: 'transit',
        transitFromLocationId: 'l1',
        transitFromLocationName: 'Jakarta',
        transitToLocationId: 'l2',
        transitToLocationName: 'Surabaya',
        transitOn: '2026-11-10',
      },
      events: [
        event({
          id: 'e5',
          seq: 5,
          type: 'send',
          data: { leg: 'to_service', shipmentNote: 'JNE resi 123' },
        }),
        ...state.events,
      ],
    };
    renderPage();
    const panel = await screen.findByRole('region', { name: 'Pengiriman' });
    expect(within(panel).getByText('Jakarta')).toBeInTheDocument();
    expect(within(panel).getByText('Surabaya')).toBeInTheDocument();
    expect(within(panel).getByText('JNE resi 123')).toBeInTheDocument();
    expect(within(panel).getByText('3 hari belum diterima')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('kepala menampilkan posisi dengan lokasi dan lencana kasus terbuka; panel pengiriman tidak muncul di QC', async () => {
  state = {
    ...state,
    serial: {
      ...SERIAL,
      status: 'failed',
      openCaseId: 'c1',
      openCaseNumber: 'LP-20261113-001',
      openCase: { ...CASE_DTO, damage: 'Port mati' },
    },
  };
  renderPage();
  expect(await screen.findByText('LP-20261113-001 (terbuka)')).toBeInTheDocument();
  expect(screen.getByText('Di QC · Jakarta')).toBeInTheDocument();
  expect(screen.getByText('Kerusakan: Port mati')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Pengiriman' })).toBeNull();
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
  await screen.findByRole('region', { name: 'Update baru' });
  await pickSelect(screen, 'Jenis update', 'Cek ulang');
  expect(await screen.findByRole('button', { name: 'Tambah Stiker A' })).toBeDisabled();
  expect(screen.getByText('Stiker nonaktif: jumlah tidak bisa ditambah')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tambah Stiker B' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah Stiker A' }));
  expect(screen.getByLabelText('Jumlah Stiker A')).toHaveTextContent('2');
});

test('galat server pada stickers dan message (karakter pengatur arah) tampil lewat jalur galat yang ada', async () => {
  renderPage();
  await screen.findByRole('region', { name: 'Update baru' });
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) =>
    id === 'serials.act'
      ? Promise.reject(
          new ApiError('VALIDATION', 'Data tidak valid', '-', {
            stickers: 'Jumlah stiker nonaktif tidak bisa ditambah',
            message: 'Pesan memuat karakter pengatur arah teks',
          }),
        )
      : original?.(id, input),
  );
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'halo');
  await userEvent.click(screen.getByRole('button', { name: 'Kirim catatan' }));
  // Kolom stiker tidak tampil pada Catatan: galatnya jatuh ke pesan umum (jalur galat yang ada); `message` tampil
  // di bawah editor pesan.
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Jumlah stiker nonaktif tidak bisa ditambah',
  );
  expect(screen.getByText('Pesan memuat karakter pengatur arah teks')).toBeInTheDocument();
});

test('linimasa terpotong tanpa kejadian recorded: "Lokasi awal" tetap tampil dari recordedLocationId (editor: serials.locationOptions)', async () => {
  state = {
    ...state,
    events: state.events.filter((event) => event.type !== 'recorded'),
    eventsTruncated: true,
  };
  renderPage();
  const summary = await screen.findByRole('region', { name: 'Ringkasan' });
  await waitFor(() => {
    const awal = within(summary).getByText('Lokasi awal').parentElement as HTMLElement;
    expect(within(awal).getByText('Surabaya')).toBeInTheDocument();
  });
});

test('linimasa terpotong: pembaca tanpa serial: edit memakai me.locations untuk "Lokasi awal"', async () => {
  me = meWith('view');
  state = {
    ...state,
    events: state.events.filter((event) => event.type !== 'recorded'),
    eventsTruncated: true,
  };
  renderPage();
  const summary = await screen.findByRole('region', { name: 'Ringkasan' });
  const awal = within(summary).getByText('Lokasi awal').parentElement as HTMLElement;
  expect(within(awal).getByText('Surabaya')).toBeInTheDocument();
  expect(apiMock.mock.calls.some((call) => call[0] === 'serials.locationOptions')).toBe(false);
});

test('lokasi awal tak dikenal dan kejadian recorded tidak termuat: tampil "—" (bukan galat)', async () => {
  state = {
    serial: { ...SERIAL, recordedLocationId: 'lHantu' },
    events: state.events.filter((event) => event.type !== 'recorded'),
    eventsTruncated: true,
  };
  renderPage();
  const summary = await screen.findByRole('region', { name: 'Ringkasan' });
  const awal = within(summary).getByText('Lokasi awal').parentElement as HTMLElement;
  expect(within(awal).getByText('—')).toBeInTheDocument();
});
