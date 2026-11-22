import type {
  GetSerialOutput,
  MeDto,
  SerialDto,
  SerialEventDto,
  SerialProofPhotoDto,
} from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { linkOptionNames, pickLink } from '@/test/link-field';
import { mockMatchMedia } from '@/test/match-media';
import { clickMoreAction, hasNoMoreActions, moreActionNames } from '@/test/more-actions';
import { renderInRouter } from '@/test/render-in-router';
import { formatDay } from '../lib/labels';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), pop: vi.fn() }));
vi.mock('@/hooks/use-stack-navigation', () => ({ useStackNavigation: () => nav }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock, Toaster: () => null }));

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
  note: 'catatan awal',
  recordedLocationId: 'l2',
  stickers: [{ stickerId: 'st1', name: 'Stiker A', alias: '', qty: 2, stickerStatus: 'active' }],
  hasProofPhotos: false,
  proofProblemCount: 0,
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
  proofPhotos: [],
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

/**
 * Meniru `serials.history`: terbaru di atas, kursor = seq terakhir, jumlah dihitung atas semua kejadian; `all` = jumlah
 * ENTRI pada "Semua Riwayat" (kejadian lepas satu per kejadian, tiap laporan satu kartu).
 */
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
      all: state.events.filter((entry) => !entry.caseId).length + Object.keys(byCase).length,
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
      serial,
      serialservice: 'none',
      countrylock: 'none',
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

/** Bawaan: tab Riwayat (kebanyakan tes memeriksa linimasa dan tombol update); tes ringkasan memakai `tab: 'detail'`. */
function renderPage(props: { tab?: 'detail' | 'riwayat' | 'foto' } = {}) {
  return renderInRouter(
    <SerialDetailPage serialId="s1" onBack={() => undefined} tab="riwayat" {...props} />,
  );
}

test('catatan serial berbentuk Markdown dirender sebagai Markdown pada ringkasan', async () => {
  state = { ...state, serial: { ...SERIAL, note: '**Penting** cek kabel' } };
  await renderPage({ tab: 'detail' });
  const summary = await screen.findByRole('region', { name: 'Ringkasan' });
  const strong = summary.querySelector('strong');
  expect(strong).toHaveTextContent('Penting');
});

test('catatan lama teks biasa: baris baru tunggal tetap terpisah (pembungkus memberi pre-line pada paragraf, newline ada di DOM)', async () => {
  state = { ...state, serial: { ...SERIAL, note: 'baris satu\nbaris dua' } };
  await renderPage({ tab: 'detail' });
  const summary = await screen.findByRole('region', { name: 'Ringkasan' });
  const paragraph = within(summary).getByText(/baris satu/);
  expect(paragraph.tagName).toBe('P');
  // Pembungkus Markdown memberi `white-space: pre-line` pada paragraf (jsdom tidak menghitung CSS: periksa kelasnya).
  expect(paragraph.parentElement?.className).toContain('[&_p]:whitespace-pre-line');
  // Satu paragraf; baris baru tunggal dipertahankan sebagai newline (dan ditampilkan oleh pre-line), tidak dilebur.
  expect(paragraph.textContent).toBe('baris satu\nbaris dua');
});

test('catatan lama dengan garis bawah di tengah kata (SN_123_456) tidak menjadi miring', async () => {
  state = { ...state, serial: { ...SERIAL, note: 'cek SN_123_456 dan file_name_ini' } };
  await renderPage({ tab: 'detail' });
  const summary = await screen.findByRole('region', { name: 'Ringkasan' });
  expect(within(summary).getByText('cek SN_123_456 dan file_name_ini')).toBeInTheDocument();
  expect(summary.querySelector('em, strong')).toBeNull();
});

test('batas perilaku: garis bawah/bintang yang mengapit kata TETAP menjadi miring/tebal (Markdown), tidak dapat dicegah tanpa mengubah penerjemah', async () => {
  state = { ...state, serial: { ...SERIAL, note: '_miring_ dan *juga*' } };
  await renderPage({ tab: 'detail' });
  const summary = await screen.findByRole('region', { name: 'Ringkasan' });
  expect([...summary.querySelectorAll('em')].map((node) => node.textContent)).toEqual([
    'miring',
    'juga',
  ]);
});

const calls = (id: string) => apiMock.mock.calls.filter((call) => call[0] === id);

beforeEach(() => {
  apiMock.mockReset();
  nav.pop.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  state = { serial: SERIAL, events: EVENTS, eventsTruncated: false, problemPhotos: [] };
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
        problemPhotos: [],
      };
      return Promise.resolve(nextSerial);
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

test('merender kepala, ringkasan, dan linimasa lama di atas, terbaru terbuka dengan chip perubahan', async () => {
  // Tanpa `tab`: View membuka tab Detail lebih dulu; linimasa ada di tab Riwayat.
  await renderPage({ tab: undefined });
  expect(await screen.findByRole('heading', { name: 'ABC123' })).toBeInTheDocument();
  expect(screen.getByText('Cisco C9200')).toBeInTheDocument();
  const summary = screen.getByRole('region', { name: 'Ringkasan' });
  expect(within(summary).getByText('10 Nov 2026')).toBeInTheDocument();
  // Terakhir lolos = kejadian lolos terbaru (cek ulang 12 Nov).
  expect(within(summary).getByText('12 Nov 2026')).toBeInTheDocument();
  expect(within(summary).getByText('Surabaya')).toBeInTheDocument();
  expect(within(summary).getByText('Stiker A ×2')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Riwayat' }));

  const cards = within(await screen.findByRole('list', { name: 'Linimasa' })).getAllByRole(
    'listitem',
    { name: '' },
  );
  const top = cards.filter((card) => card.hasAttribute('data-seq'));
  // Keputusan pemilik 2026-11-22: tanpa pelipat riwayat lama, semua entri (1, 2, 3) terbuka sejak awal.
  expect(top.map((card) => card.getAttribute('data-seq'))).toEqual(['1', '2', '3']);
  expect(screen.queryByRole('button', { name: /riwayat sebelumnya/i })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Riwayat saat ini' })).toBeNull();
  const opened = within(screen.getByRole('list', { name: 'Linimasa' }))
    .getAllByRole('listitem')
    .filter((card) => card.hasAttribute('data-seq'));
  expect(opened.map((card) => card.getAttribute('data-seq'))).toEqual(['1', '2', '3']);
  expect(screen.getByText('Lokasi: Surabaya → Jakarta')).toBeInTheDocument();
  expect(screen.getByText(/Stiker ditempel dan stok dipotong: Stiker A ×2/)).toBeInTheDocument();
  expect(screen.getByText('dicek')).toBeInTheDocument();
});

/** Teks tombol di pembungkus aksi: label tombol bergambar+teks, atau aria-label bagi tombol ikon (⋯). */
function actionLabels(wrapper: HTMLElement): (string | null)[] {
  return [...wrapper.querySelectorAll('button')].map(
    (button) => button.textContent?.trim() || button.getAttribute('aria-label'),
  );
}

test('header (Lolos): aksi utama Lapor rusak + Ubah data; Tempel stiker, Cek ulang, Catatan di menu "Aksi lainnya"; tak ada tombol Update atau aksi di Riwayat', async () => {
  const { container } = await renderPage();
  const report = await screen.findByRole('button', { name: 'Lapor rusak' });
  const edit = screen.getByRole('button', { name: 'Ubah data' });
  // Satu pembungkus aksi (bar judul) dengan target panduan; urutan sesuai bobot.
  const wrapper = container.querySelector('[data-tour="serial-actions"]') as HTMLElement;
  expect(wrapper).not.toBeNull();
  expect(actionLabels(wrapper)).toEqual(['Lapor rusak', 'Ubah data', 'Aksi lainnya']);
  for (const button of [report, edit]) expect(wrapper).toContainElement(button);
  expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Tempel stiker' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cek ulang' })).toBeNull();
  expect(await moreActionNames()).toEqual(['Tempel stiker', 'Cek ulang', 'Catatan']);
  // Tab Riwayat hanya memuat linimasa: tidak ada kelompok "Update baru".
  const section = screen.getByRole('region', { name: 'Riwayat' });
  expect(screen.queryByRole('group', { name: 'Update baru' })).toBeNull();
  expect(within(section).queryByRole('button', { name: 'Catatan' })).toBeNull();
});

test('Catatan dari menu "Aksi lainnya" membuka dialog dan mengirim serials.act', async () => {
  await renderPage();
  await screen.findByRole('button', { name: 'Lapor rusak' });
  await clickMoreAction('Catatan');
  const dialog = await screen.findByRole('dialog', { name: 'Tambah catatan' });
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Catatan' }), 'Cek kabel');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Kirim catatan' }));
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(calls('serials.act')[0]?.[1]).toMatchObject({
    id: 's1',
    expectedUpdatedAt: '2026-11-11T03:00:00.000Z',
    action: 'note',
    message: 'Cek kabel',
  });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tambah catatan' })).toBeNull());
  // Detail dimuat ulang: kartu kejadian baru muncul dan hanya ia yang berlabel Terbaru.
  await waitFor(() => {
    const seqs = screen
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('data-seq'))
      .filter(Boolean);
    expect(seqs).toContain('4');
  });
  await waitFor(() => expect(screen.getAllByText('Terbaru')).toHaveLength(1));
  const newest = document.querySelector('[data-seq="4"]') as HTMLElement;
  expect(within(newest).getByText('Terbaru')).toBeInTheDocument();
});

test('Tempel stiker dari menu membuka dialog dan mengirim serials.act apply_stickers', async () => {
  await renderPage();
  await screen.findByRole('button', { name: 'Lapor rusak' });
  await clickMoreAction('Tempel stiker');
  const dialog = await screen.findByRole('dialog', { name: 'Tempel stiker' });
  const send = within(dialog).getByRole('button', { name: 'Tempel stiker' });
  expect(send).toBeDisabled();
  await userEvent.click(await within(dialog).findByRole('checkbox', { name: 'Stiker B' }));
  expect(send).toBeEnabled();
  await userEvent.click(send);
  await waitFor(() => expect(calls('serials.act')).toHaveLength(1));
  expect(calls('serials.act')[0]?.[1]).toMatchObject({
    id: 's1',
    action: 'apply_stickers',
    stickerIds: ['st2'],
  });
});

test('Lapor rusak = ActionButton di sebelah Ubah data (bar judul); membuka dialog laporan', async () => {
  await renderPage();
  const report = await screen.findByRole('button', { name: 'Lapor rusak' });
  const edit = screen.getByRole('button', { name: 'Ubah data' });
  // Sebelum Ubah data, di bar judul yang sama.
  expect(report.parentElement).toBe(edit.parentElement);
  expect(report.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.click(report);
  expect(await screen.findByRole('dialog', { name: /Lapor rusak/ })).toBeInTheDocument();
});

test('Dilaporkan: Cek ulang + Kirim ke servis jadi aksi utama; Lapor rusak tak ada; Ubah data pindah ke menu', async () => {
  state = {
    ...state,
    serial: {
      ...SERIAL,
      status: 'reported',
      openCaseId: 'c1',
      openCaseNumber: 'LP/SBY/2611-0001',
      openCase: CASE_DTO,
    },
  };
  const { container } = await renderPage();
  await screen.findByRole('button', { name: 'Cek ulang' });
  const wrapper = container.querySelector('[data-tour="serial-actions"]') as HTMLElement;
  expect(actionLabels(wrapper)).toEqual(['Cek ulang', 'Kirim ke servis', 'Aksi lainnya']);
  expect(screen.queryByRole('button', { name: 'Lapor rusak' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ubah data' })).toBeNull();
  expect(await moreActionNames()).toEqual(['Ubah data', 'Tempel stiker', 'Catatan']);
  // Ubah data dari menu tetap membuka dialog ubah data.
  await clickMoreAction('Ubah data');
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});

test.each([
  ['at_service', 'transit', ['Terima di servis', 'Diagnosis', 'Catatan']],
  ['at_service', 'service', ['Diagnosis', 'Catatan']],
  ['diagnosis', 'service', ['Diagnosis', 'Catatan']],
  ['service_repair', 'service', ['Diagnosis', 'Catatan']],
  ['recheck', 'transit', ['Terima di QC', 'Cek ulang', 'Catatan']],
] as const)(
  'status %s (%s): hanya Ubah data yang jadi tombol, aksi alur semua di menu',
  async (status, custody, menu) => {
    me = adminMe();
    state = { ...state, serial: { ...SERIAL, status, custody } as SerialDto };
    const { container } = await renderPage();
    await screen.findByRole('button', { name: 'Ubah data' });
    const wrapper = container.querySelector('[data-tour="serial-actions"]') as HTMLElement;
    expect(actionLabels(wrapper)).toEqual(['Ubah data', 'Aksi lainnya']);
    expect(await moreActionNames()).toEqual(menu);
  },
);

test('pengguna serial: view tidak melihat aksi alur maupun tombol ubah', async () => {
  me = meWith('view');
  await renderPage();
  expect(await screen.findByRole('heading', { name: 'ABC123' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tempel stiker' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ubah data' })).not.toBeInTheDocument();
  expect(hasNoMoreActions()).toBe(true);
});

test('lencana Terbaru hanya di tab Semua dan tepat satu', async () => {
  await renderPage();
  await screen.findByRole('list', { name: 'Linimasa' });
  expect(screen.getAllByText('Terbaru')).toHaveLength(1);
  const top = document.querySelector('[data-seq="3"]') as HTMLElement;
  expect(within(top).getByText('Terbaru')).toBeInTheDocument();
});

test('dialog ubah data mengirim data lengkap dan menampilkan "Serial sudah terdaftar" pada duplikat', async () => {
  await renderPage();
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
  // Item tidak lagi dibatasi pada BU serial (BU tidak terikat BU item): semua item yang terlihat ditawarkan.
  const names = await linkOptionNames(within(dialog), 'Item');
  expect(names).toContain('Aruba 2930');
  expect(names).toContain('Lain BU');
});

test('dialog ubah data setelah 412: formulir dibasiskan ulang ke data server dan simpan ulang memakai versi baru', async () => {
  await renderPage();
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
        state = { serial: fresh, events: state.events, eventsTruncated: false, problemPhotos: [] };
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
  await renderPage();
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
      state = { serial: fresh, events: state.events, eventsTruncated: false, problemPhotos: [] };
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
  await renderPage();
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
      state = { serial: fresh, events: state.events, eventsTruncated: false, problemPhotos: [] };
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
  state = { ...state, eventsTruncated: true, problemPhotos: [] };
  await renderPage();
  await screen.findByRole('list', { name: 'Linimasa' });
  expect(screen.queryByText(/Hanya 500 entri terbaru/)).toBeNull();
  const seqs = () =>
    within(screen.getByRole('list', { name: 'Linimasa' }))
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('data-seq'))
      .filter(Boolean);
  // Tanpa pelipat: halaman pertama langsung terbuka dan tombol muat berada di ATAS daftar.
  expect(seqs()).toEqual(['2', '3']);
  const loadOlder = screen.getByRole('button', { name: 'Muat yang lebih lama' });
  const firstCard = document.querySelector('[data-seq="2"]') as HTMLElement;
  expect(
    loadOlder.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Muat yang lebih lama' }));
  await waitFor(() => expect(seqs()).toEqual(['1', '2', '3']));
  expect(calls('serials.history')[1]?.[1]).toMatchObject({ id: 's1', cursor: '2' });
  expect(screen.queryByRole('button', { name: 'Muat yang lebih lama' })).toBeNull();
});

const CASE_C1 = {
  id: 'c1',
  number: 'LP/SBY/2611-0001',
  openedOn: '2026-11-13',
  closedOn: null,
  outcome: null,
};

test('filter Riwayat: tombol dropdown, jumlah dari counts di butir menu; Riwayat Pengecekan mengirim group; tanpa tab per laporan', async () => {
  state = {
    ...state,
    serial: { ...SERIAL, cases: [CASE_C1] },
    events: [
      event({
        id: 'e4',
        seq: 4,
        type: 'report_failure',
        caseId: 'c1',
        data: { caseNumber: 'LP/SBY/2611-0001', damage: 'Port mati' },
      }),
      ...state.events,
    ],
  };
  await renderPage();
  const trigger = await screen.findByRole('button', { name: 'Filter riwayat: Semua Riwayat' });
  expect(trigger).toHaveTextContent('Semua Riwayat');
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  // Laporan tidak punya tab sendiri: ia menjadi satu kartu di pilihan Semua.
  expect(screen.queryByRole('tab', { name: /LP\/SBY\/2611-0001/ })).toBeNull();
  await userEvent.click(trigger);
  const menu = await screen.findByRole('menu');
  const options = within(menu).getAllByRole('menuitemradio');
  expect(options.map((option) => option.textContent)).toEqual([
    'Semua Riwayat4',
    'Riwayat Pengecekan2',
    'Riwayat Perubahan Data1',
  ]);
  expect(within(menu).getByRole('menuitemradio', { name: /^Semua Riwayat/ })).toBeChecked();

  await userEvent.click(within(menu).getByRole('menuitemradio', { name: /^Riwayat Pengecekan/ }));
  await waitFor(() =>
    expect(calls('serials.history').some((call) => call[1].group === 'checks')).toBe(true),
  );
  // Label tombol mengikuti pilihan; pilihan Pengecekan tetap per kejadian, tanpa kartu laporan.
  expect(
    await screen.findByRole('button', { name: 'Filter riwayat: Riwayat Pengecekan' }),
  ).toHaveTextContent('Riwayat Pengecekan');
  const list = await screen.findByRole('list', { name: 'Linimasa' });
  expect(list.querySelector('[data-case-id]')).toBeNull();
  // Jumlah di menu tetap terlihat setelah berpindah pilihan.
  await userEvent.click(screen.getByRole('button', { name: /^Filter riwayat/ }));
  expect(
    within(await screen.findByRole('menu')).getByRole('menuitemradio', { name: /^Semua Riwayat/ }),
  ).toHaveTextContent('4');
});

test('jumlah Semua Riwayat = entri yang tampil: laporan berisi banyak kejadian dihitung satu, badge Terbaru berwarna primary', async () => {
  const caseEvents = Array.from({ length: 10 }, (_, index) =>
    event({
      id: `c${index}`,
      seq: 10 + index,
      type: 'note',
      caseId: 'c1',
      data: { caseNumber: 'LP/SBY/2611-0001' },
    }),
  );
  state = {
    ...state,
    serial: { ...SERIAL, status: 'reported', cases: [CASE_C1] },
    events: [...caseEvents, ...state.events],
  };
  await renderPage();
  const trigger = await screen.findByRole('button', { name: 'Filter riwayat: Semua Riwayat' });
  const list = await screen.findByRole('list', { name: 'Linimasa' });
  // 3 kejadian lepas + 1 kartu laporan (10 kejadian) = 4 entri tampil, bukan 13.
  expect(list.querySelectorAll('[data-seq], [data-case-id]')).toHaveLength(4);
  await userEvent.click(trigger);
  expect(
    within(await screen.findByRole('menuitemradio', { name: /^Semua Riwayat/ })).getByText('4'),
  ).toBeInTheDocument();
  // Badge "Terbaru" hanya satu (kartu laporan, entri terbaru) dan berwarna primary.
  await userEvent.keyboard('{Escape}');
  const latest = screen.getAllByText('Terbaru');
  expect(latest).toHaveLength(1);
  expect(latest[0]).toHaveAttribute('data-color', 'primary');
});

test('tab Semua: kejadian satu laporan diringkas jadi SATU kartu yang membuka detail laporan', async () => {
  state = {
    ...state,
    serial: { ...SERIAL, status: 'reported', cases: [CASE_C1] },
    events: [
      event({
        id: 'e5',
        seq: 5,
        type: 'send',
        caseId: 'c1',
        actorName: 'Dewi',
        data: { leg: 'to_service' },
      }),
      event({
        id: 'e4',
        seq: 4,
        type: 'report_failure',
        caseId: 'c1',
        actorName: 'Budi',
        data: { caseNumber: 'LP/SBY/2611-0001', damage: 'Port mati' },
      }),
      ...state.events,
    ],
  };
  await renderPage();
  const link = await screen.findByRole('link', { name: 'Buka laporan LP/SBY/2611-0001' });
  expect(link).toHaveAttribute('href', '/serial/reports/c1');
  const list = screen.getByRole('list', { name: 'Linimasa' });
  const card = list.querySelector('[data-case-id="c1"]') as HTMLElement;
  expect(card).toHaveTextContent('Dilaporkan oleh Budi (QC)');
  expect(card).toHaveTextContent('Masih terbuka · status Serial kini: Dilaporkan');
  expect(card).toHaveTextContent('2 kejadian');
  // Kejadian laporan tidak tampil sebagai kartu terpisah; kartu laporan (terbaru) ditandai.
  expect(within(list).queryByText('Laporan LP/SBY/2611-0001 dibuka: Port mati')).toBeNull();
  expect(within(card).getByText('Terbaru')).toBeInTheDocument();
  // Kejadian di luar laporan tetap per kartu, semuanya terbuka tanpa pelipat.
  expect(list.querySelectorAll('[data-seq]')).toHaveLength(3);
});

test('kartu laporan yang sudah selesai menampilkan hasil serta kapan dan oleh siapa diselesaikan', async () => {
  state = {
    ...state,
    serial: {
      ...SERIAL,
      status: 'broken',
      cases: [{ ...CASE_C1, closedOn: '2026-11-15', outcome: 'broken' }],
    },
    events: [
      event({
        id: 'e5',
        seq: 5,
        type: 'declare_broken',
        caseId: 'c1',
        actorName: 'Citra',
        actorTeam: 'service',
        data: { caseNumber: 'LP/SBY/2611-0001' },
      }),
      event({ id: 'e4', seq: 4, type: 'report_failure', caseId: 'c1', actorName: 'Budi' }),
      ...state.events,
    ],
  };
  await renderPage();
  await screen.findByRole('link', { name: 'Buka laporan LP/SBY/2611-0001' });
  const card = screen
    .getByRole('list', { name: 'Linimasa' })
    .querySelector('[data-case-id="c1"]') as HTMLElement;
  expect(card).toHaveTextContent('Hasil: Rusak');
  expect(card).toHaveTextContent(`Selesai ${formatDay('2026-11-15')} oleh Citra (Servis)`);
  expect(card).not.toHaveTextContent('Masih terbuka');
});

test('filter Riwayat bukan tab: tombol ghost + chevron di baris bertarget panduan, tanpa tablist di dalam Riwayat', async () => {
  const { container } = await renderPage();
  const trigger = await screen.findByRole('button', { name: /^Filter riwayat/ });
  const row = container.querySelector('[data-tour="serial-timeline"]') as HTMLElement;
  expect(row).not.toBeNull();
  expect(row).toContainElement(trigger);
  expect(trigger.querySelector('svg')).not.toBeNull();
  const section = screen.getByRole('region', { name: 'Riwayat' });
  expect(within(section).queryByRole('tablist')).toBeNull();
  expect(within(section).queryByRole('tab')).toBeNull();
});

test('filter Riwayat: kartu laporan dan lencana Terbaru hanya di pilihan Semua', async () => {
  state = { ...state, serial: { ...SERIAL, cases: [CASE_C1] } };
  await renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /^Filter riwayat/ }));
  await userEvent.click(
    within(await screen.findByRole('menu')).getByRole('menuitemradio', {
      name: /^Riwayat Perubahan Data/,
    }),
  );
  await waitFor(() =>
    expect(calls('serials.history').some((call) => call[1].group === 'changes')).toBe(true),
  );
  await screen.findByRole('list', { name: 'Linimasa' });
  await waitFor(() => expect(screen.queryByText('Terbaru')).toBeNull());
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
        data: { caseNumber: 'LP/SBY/2611-0001', outcome: 'broken' },
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
  await renderPage();
  const list = await screen.findByRole('list', { name: 'Linimasa' });
  expect(within(list).getByText('Laporan LP/SBY/2611-0001 ditutup: rusak')).toBeInTheDocument();
  expect(within(list).getByText('Diterima di servis')).toBeInTheDocument();
  expect(within(list).getByText('Dikirim ke servis')).toBeInTheDocument();
  expect(within(list).getByText('Lama di perjalanan: 3 hari')).toBeInTheDocument();
  expect(within(list).getByText('Catatan pengiriman: JNE resi 123')).toBeInTheDocument();
});

const CASE_DTO = {
  id: 'c1',
  number: 'LP/SBY/2611-0001',
  openedOn: '2026-11-13',
  closedOn: null,
  outcome: null,
} as const;

const STEP_CASES: [SerialDto['status'], string, boolean][] = [
  ['good', 'Lolos', false],
  ['reported', 'Dilaporkan', true],
  ['at_service', 'Di servis', true],
  ['diagnosis', 'Diagnosis', true],
  ['service_repair', 'Sedang diperbaiki', true],
  ['recheck', 'Menunggu cek ulang', true],
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
          status === 'at_service' ||
          status === 'diagnosis' ||
          status === 'service_repair' ||
          status === 'broken'
            ? 'service'
            : 'qc',
        cases: hasCase ? [CASE_DTO] : [],
        openCase: null,
      },
    };
    await renderPage({ tab: 'detail' });
    const steps = await screen.findByRole('list', { name: 'Tahap' });
    const active = within(steps)
      .getAllByRole('listitem')
      .filter((li) => li.getAttribute('aria-current') === 'step');
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent(label);
  },
);

test('panel pengiriman: dari ke dan "3 hari belum diterima" (tanggal dipatok)', async () => {
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
    };
    await renderPage({ tab: 'detail' });
    const panel = await screen.findByRole('region', { name: 'Pengiriman' });
    expect(within(panel).getByText('Jakarta')).toBeInTheDocument();
    expect(within(panel).getByText('Surabaya')).toBeInTheDocument();
    expect(within(panel).getByText('3 hari belum diterima')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('kepala menampilkan posisi dengan lokasi dan lencana laporan terbuka; panel pengiriman tidak muncul di QC', async () => {
  state = {
    ...state,
    serial: {
      ...SERIAL,
      status: 'reported',
      openCaseId: 'c1',
      openCaseNumber: 'LP/SBY/2611-0001',
      openCase: CASE_DTO,
    },
  };
  await renderPage();
  expect(await screen.findByText('LP/SBY/2611-0001 (terbuka)')).toBeInTheDocument();
  expect(screen.getByText('Di QC · Jakarta')).toBeInTheDocument();
  expect(screen.queryByText(/^Kerusakan:/)).toBeNull();
  expect(screen.queryByRole('region', { name: 'Pengiriman' })).toBeNull();
});

test('linimasa terpotong tanpa kejadian recorded: "Lokasi awal" tetap tampil dari recordedLocationId (editor: serials.locationOptions)', async () => {
  state = {
    ...state,
    events: state.events.filter((event) => event.type !== 'recorded'),
    eventsTruncated: true,
    problemPhotos: [],
  };
  await renderPage({ tab: 'detail' });
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
    problemPhotos: [],
  };
  await renderPage({ tab: 'detail' });
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
    problemPhotos: [],
  };
  await renderPage({ tab: 'detail' });
  const summary = await screen.findByRole('region', { name: 'Ringkasan' });
  const awal = within(summary).getByText('Lokasi awal').parentElement as HTMLElement;
  expect(within(awal).getByText('—')).toBeInTheDocument();
});

test('dialog ubah data: lokasi dikunci dengan keterangan selama dalam pengiriman atau di servis, aktif di QC', async () => {
  state = { ...state, serial: { ...SERIAL, status: 'at_service', custody: 'transit' } };
  const { unmount } = await renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah data' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('combobox', { name: 'Lokasi' })).toBeDisabled();
  expect(
    within(dialog).getByText(
      /Lokasi tidak bisa diubah selama Serial Number masih dalam pengiriman/,
    ),
  ).toBeInTheDocument();
  unmount();
  state = { ...state, serial: { ...SERIAL } };
  await renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Ubah data' }));
  const open = await screen.findByRole('dialog');
  expect(within(open).getByRole('combobox', { name: 'Lokasi' })).toBeEnabled();
  expect(within(open).queryByText(/Lokasi tidak bisa diubah selama/)).toBeNull();
});

test('lencana posisi saat dalam pengiriman menyebut tujuan, bukan lokasi asal', async () => {
  state = {
    ...state,
    serial: {
      ...SERIAL,
      status: 'at_service',
      custody: 'transit',
      locationName: 'Jakarta',
      transitFromLocationName: 'Jakarta',
      transitToLocationId: 'l2',
      transitToLocationName: 'Surabaya',
      transitOn: '2026-11-10',
    },
  };
  await renderPage();
  expect(await screen.findByText('Dalam pengiriman · ke Surabaya')).toBeInTheDocument();
  expect(screen.queryByText('Dalam pengiriman · Jakarta')).toBeNull();
});

const PHOTO = {
  id: 'aaaaaaaa-1',
  state: 'done' as const,
  mime: 'image/webp',
  size: 1,
  width: 1,
  height: 1,
  filename: 'bukti-aaaaaaaa.webp',
  error: null,
  canManage: true,
  canRetry: true,
  failedAt: null,
  expiresAt: null,
};

test('kepala dan kartu riwayat menampilkan badge Bukti foto QC hanya bila serial punya foto', async () => {
  const first = await renderPage();
  expect(await screen.findByRole('heading', { name: 'ABC123' })).toBeInTheDocument();
  expect(screen.queryByText('Bukti foto QC')).not.toBeInTheDocument();
  first.unmount();

  state = {
    serial: { ...SERIAL, hasProofPhotos: true },
    events: state.events.map((entry) =>
      entry.seq === 3 ? { ...entry, proofPhotos: [PHOTO] } : entry,
    ),
    eventsTruncated: false,
    problemPhotos: [],
  };
  await renderPage();
  expect(await screen.findByRole('heading', { name: 'ABC123' })).toBeInTheDocument();
  // Satu di kepala, satu di kartu riwayat saat ini (seq 3) yang berfoto.
  await waitFor(() => expect(screen.getAllByText('Bukti foto QC')).toHaveLength(2));
  expect(screen.getByRole('img', { name: 'Foto bukti 1' })).toHaveAttribute(
    'src',
    '/api/v1/serial-proofs/aaaaaaaa-1',
  );
});

test('Coba lagi pada foto gagal mengikuti canManage dari server, bukan kecocokan nama pelaku', async () => {
  const failed = { ...PHOTO, state: 'failed' as const, error: 'rusak' };
  const withFailed = (canManage: boolean) => ({
    serial: { ...SERIAL, hasProofPhotos: true },
    events: state.events.map((entry) =>
      // actorName = nama pengguna uji (me.name = 'A') pada kedua kasus.
      entry.seq === 3
        ? { ...entry, actorName: 'A', proofPhotos: [{ ...failed, canManage, canRetry: canManage }] }
        : entry,
    ),
    eventsTruncated: false,
    problemPhotos: [],
  });
  state = withFailed(false);
  const first = await renderPage();
  await screen.findByText('rusak');
  expect(screen.queryByRole('button', { name: 'Coba lagi' })).not.toBeInTheDocument();
  first.unmount();

  state = withFailed(true);
  await renderPage();
  expect(await screen.findByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
});

describe('foto bukti bermasalah: banner dan badge', () => {
  const failedPhoto = (
    id: string,
    over: Partial<SerialProofPhotoDto> = {},
  ): SerialProofPhotoDto => ({
    ...PHOTO,
    id,
    state: 'failed' as const,
    error: 'Berkas gambar rusak',
    failedAt: '2026-11-16T03:00:00.000Z',
    expiresAt: '2026-11-30T03:00:00.000Z',
    ...over,
  });
  const withPhotos = (photos: SerialProofPhotoDto[], count = photos.length) => {
    state = {
      serial: { ...SERIAL, hasProofPhotos: true, proofProblemCount: count },
      events: state.events.map((entry) =>
        entry.seq === 3 ? { ...entry, proofPhotos: photos } : entry,
      ),
      eventsTruncated: false,
      problemPhotos: photos.filter((photo) => photo.state === 'failed'),
    };
  };
  const banner = () => screen.findByRole('region', { name: 'Foto bukti QC bermasalah' });

  test('tanpa foto gagal: tidak ada banner maupun badge Foto bermasalah', async () => {
    withPhotos([{ ...PHOTO, id: 'ok-1' }], 0);
    await renderPage();
    expect(await screen.findByRole('heading', { name: 'ABC123' })).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Foto bukti QC bermasalah' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Foto bermasalah')).not.toBeInTheDocument();
  });

  test('ada foto gagal: banner memuat jumlah dan tanggal batas terdekat (WIB), badge di kepala', async () => {
    withPhotos([
      failedPhoto('f-1', { expiresAt: '2026-12-05T03:00:00.000Z' }),
      failedPhoto('f-2', { expiresAt: '2026-11-30T20:00:00.000Z' }),
    ]);
    await renderPage();
    const region = await banner();
    expect(region).toHaveTextContent('Foto bukti QC bermasalah (2 foto).');
    // 2026-11-30T20:00Z = 1 Des 2026 03.00 WIB: batas terdekat menurut kalender WIB.
    expect(region).toHaveTextContent(`pada ${formatDay('2026-12-01')}`);
    expect(screen.getByRole('heading', { name: 'ABC123' }).parentElement).toHaveTextContent(
      'Foto bermasalah',
    );
  });

  test('tombol Unggah ulang di banner hanya untuk foto yang canManage; pembaca biasa hanya melihat teksnya', async () => {
    withPhotos([failedPhoto('f-1', { canManage: false, canRetry: false })]);
    const first = await renderPage();
    const readOnly = await banner();
    expect(readOnly).toHaveTextContent('Foto bukti QC bermasalah (1 foto).');
    expect(
      within(readOnly).queryByRole('button', { name: 'Unggah ulang' }),
    ).not.toBeInTheDocument();
    first.unmount();

    withPhotos([failedPhoto('f-1'), failedPhoto('f-2', { canManage: false, canRetry: false })]);
    await renderPage();
    const manage = await banner();
    expect(within(manage).getAllByRole('button', { name: 'Unggah ulang' })).toHaveLength(1);
  });

  test('foto gagal yang tidak ada di kejadian termuat (riwayat terpotong): banner tetap memuat tanggal dan tombol', async () => {
    state = {
      serial: { ...SERIAL, hasProofPhotos: true, proofProblemCount: 1 },
      events: state.events,
      eventsTruncated: true,
      problemPhotos: [failedPhoto('f-lama', { expiresAt: '2026-12-02T03:00:00.000Z' })],
    };
    await renderPage();
    const region = await banner();
    expect(region).toHaveTextContent('Foto bukti QC bermasalah (1 foto).');
    expect(region).toHaveTextContent(`pada ${formatDay('2026-12-02')}`);
    expect(within(region).getByRole('button', { name: 'Unggah ulang' })).toBeInTheDocument();
    // Foto itu tidak ada di kartu riwayat mana pun: tidak digandakan di galeri.
    expect(screen.queryByRole('list', { name: 'Foto bukti QC' })).not.toBeInTheDocument();
  });

  test('problemPhotos dengan canManage false: banner tanpa tombol', async () => {
    state = {
      serial: { ...SERIAL, hasProofPhotos: true, proofProblemCount: 1 },
      events: state.events,
      eventsTruncated: true,
      problemPhotos: [failedPhoto('f-lama', { canManage: false, canRetry: false })],
    };
    await renderPage();
    const region = await banner();
    expect(region).toHaveTextContent('(1 foto)');
    expect(within(region).queryByRole('button', { name: 'Unggah ulang' })).not.toBeInTheDocument();
  });

  test('foto gagal ada di galeri kejadian dan di problemPhotos: galeri tidak menggandakan', async () => {
    withPhotos([failedPhoto('f-1')]);
    await renderPage();
    const region = await banner();
    expect(within(region).getAllByRole('img')).toHaveLength(1);
    // Satu di banner, satu di kartu riwayat (seq 3).
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Unggah ulang' })).toHaveLength(2),
    );
  });

  test('foto gagal karena ukuran: Unggah ulang tampil di banner tanpa Coba lagi', async () => {
    withPhotos([failedPhoto('f-1', { error: 'Ukuran gambar terlalu besar', canRetry: false })]);
    await renderPage();
    const region = await banner();
    expect(within(region).getByRole('button', { name: 'Unggah ulang' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Coba lagi' })).not.toBeInTheDocument();
  });

  test('Unggah ulang di banner membuka dialog foto bukti (tanpa Pustaka)', async () => {
    withPhotos([failedPhoto('f-1')]);
    await renderPage();
    const region = await banner();
    await userEvent.click(within(region).getByRole('button', { name: 'Unggah ulang' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Unggah ulang foto bukti QC' });
    expect(within(dialog).getByRole('button', { name: 'Telusuri' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('tab')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('tab', { name: /Pustaka/ })).not.toBeInTheDocument();
  });
});

test('"Pernah di" menampilkan BU yang sudah ditinggalkan, urut kronologis, tanpa BU saat ini', async () => {
  state = {
    ...state,
    serial: {
      ...SERIAL,
      buHistory: [
        {
          buId: 'b3',
          buCode: 'BU3',
          firstAt: '2026-11-03T00:00:00.000Z',
          leftAt: '2026-11-08T00:00:00.000Z',
        },
        {
          buId: 'b2',
          buCode: 'BU2',
          firstAt: '2026-11-01T00:00:00.000Z',
          leftAt: '2026-11-03T00:00:00.000Z',
        },
        { buId: 'b1', buCode: 'BU1', firstAt: '2026-11-08T00:00:00.000Z', leftAt: '' },
      ],
    },
  };
  await renderPage({ tab: 'detail' });
  expect(await screen.findByText('Pernah di: BU2, BU3')).toBeInTheDocument();
});

test('tanpa riwayat BU yang ditinggalkan, "Pernah di" tidak tampil', async () => {
  state = {
    ...state,
    serial: {
      ...SERIAL,
      buHistory: [{ buId: 'b1', buCode: 'BU1', firstAt: '2026-11-01T00:00:00.000Z', leftAt: '' }],
    },
  };
  await renderPage({ tab: 'detail' });
  await screen.findByRole('region', { name: 'Ringkasan' });
  expect(screen.queryByText(/Pernah di/)).toBeNull();
});

// ---------------------------------------------------------------------------------------------------------------------
// Fase 4d: View bertab, Hapus/Pulihkan (serial: manage pada semua BU riwayat).

function manageMe(): MeDto {
  const base = meWith('edit');
  return {
    ...base,
    permissions: { ...base.permissions, serial: 'manage' },
    businessUnits: base.businessUnits.map((bu) => ({
      ...bu,
      permissions: { ...bu.permissions, serial: 'manage' },
    })),
  };
}

test('tab Detail, Riwayat, dan Foto bukti tampil; mengklik tab memanggil onTabChange', async () => {
  const onTabChange = vi.fn();
  await renderInRouter(
    <SerialDetailPage
      serialId="s1"
      onBack={() => undefined}
      tab="detail"
      onTabChange={onTabChange}
    />,
  );
  await screen.findByRole('heading', { name: 'ABC123' });
  expect(screen.getByRole('tab', { name: 'Detail' })).toHaveAttribute('aria-selected', 'true');
  expect(document.querySelector('[data-tour="serial-stepper"]')).not.toBeNull();
  await userEvent.click(screen.getByRole('tab', { name: 'Riwayat' }));
  expect(onTabChange).toHaveBeenCalledWith('riwayat');
  await userEvent.click(screen.getByRole('tab', { name: 'Foto bukti' }));
  expect(onTabChange).toHaveBeenCalledWith('foto');
});

test('pengguna tanpa serial: manage tidak melihat Hapus (tombol maupun menu)', async () => {
  await renderPage({ tab: 'detail' });
  await screen.findByRole('heading', { name: 'ABC123' });
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(await moreActionNames()).not.toContain('Hapus');
});

test('Hapus dari View: konfirmasi, serials.removeBatch, lalu kembali ke daftar dengan toast', async () => {
  me = manageMe();
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.get') return Promise.resolve(structuredClone(state));
    if (id === 'serials.history') return Promise.resolve(historyOf(input));
    if (id === 'serials.removeBatch') return Promise.resolve({ ids: ['s1'] });
    return Promise.resolve({ stickers: [], locations: [], items: [], nextCursor: null });
  });
  await renderPage({ tab: 'detail' });
  await screen.findByRole('heading', { name: 'ABC123' });
  await clickMoreAction('Hapus');
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Hapus' }));
  await waitFor(() => expect(calls('serials.removeBatch')).toHaveLength(1));
  expect(calls('serials.removeBatch')[0]?.[1]).toEqual({ ids: ['s1'] });
  await waitFor(() => expect(nav.pop).toHaveBeenCalledWith({ to: '/serial' }));
  expect(toastMock.success).toHaveBeenCalledWith('Dihapus', expect.anything());
});

test('serial terhapus: spanduk Terhapus dan Pulihkan (manage), tanpa Ubah data dan Hapus', async () => {
  me = manageMe();
  state = {
    ...state,
    serial: {
      ...SERIAL,
      deleted: { deletedAt: '2026-11-20T03:00:00.000Z', deletedBy: 'adm@x.com' },
    },
  };
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serials.get') return Promise.resolve(structuredClone(state));
    if (id === 'serials.history') return Promise.resolve(historyOf(input));
    if (id === 'serials.restoreBatch') return Promise.resolve({ items: [SERIAL] });
    return Promise.resolve({ stickers: [], locations: [], items: [], nextCursor: null });
  });
  await renderPage({ tab: 'riwayat' });
  await screen.findByRole('heading', { name: 'ABC123' });
  expect(screen.getAllByText('Terhapus').length).toBeGreaterThanOrEqual(1);
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ubah data' })).toBeNull();
  // Serial terhapus tidak menawarkan aksi alur.
  expect(screen.queryByRole('button', { name: 'Lapor rusak' })).toBeNull();
  expect(hasNoMoreActions()).toBe(true);
  const restoreButtons = screen.getAllByRole('button', { name: 'Pulihkan' });
  await userEvent.click(restoreButtons[0] as HTMLElement);
  await waitFor(() => expect(calls('serials.restoreBatch')).toHaveLength(1));
  expect(calls('serials.restoreBatch')[0]?.[1]).toEqual({ ids: ['s1'] });
});

test('ponsel (P7): menu "Aksi lainnya" memuat aksi sisanya sebelum Hapus; memilih Catatan membuka dialog yang sama', async () => {
  const media = mockMatchMedia(false);
  window.innerWidth = 360;
  me = manageMe();
  await renderPage({ tab: 'detail' });
  const bar = await screen.findByRole('region', { name: 'Aksi halaman' });
  expect(within(bar).getByRole('button', { name: 'Lapor rusak' })).toBeInTheDocument();
  expect(within(bar).getByRole('button', { name: 'Ubah data' })).toBeInTheDocument();
  await userEvent.click(within(bar).getByRole('button', { name: 'Aksi lainnya' }));
  const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent);
  expect(items).toEqual(['Tempel stiker', 'Cek ulang', 'Catatan', 'Hapus']);
  // Entri datar (tanpa grup "Update" dan tanpa menu bersarang).
  expect(screen.queryByText('Update')).toBeNull();
  expect(document.querySelector('[data-tour="serial-actions"]')).not.toBeNull();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Catatan' }));
  expect(await screen.findByRole('dialog', { name: 'Tambah catatan' })).toBeInTheDocument();
  media.restore();
  window.innerWidth = 1024;
});

test('ponsel (P7): pengguna tanpa manage tetap punya menu "Aksi lainnya" berisi aksi alur (tanpa Hapus)', async () => {
  const media = mockMatchMedia(false);
  window.innerWidth = 360;
  me = meWith('edit');
  await renderPage({ tab: 'detail' });
  const bar = await screen.findByRole('region', { name: 'Aksi halaman' });
  await userEvent.click(within(bar).getByRole('button', { name: 'Aksi lainnya' }));
  expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
    'Tempel stiker',
    'Cek ulang',
    'Catatan',
  ]);
  media.restore();
  window.innerWidth = 1024;
});

test('desktop: bar judul memuat Lapor rusak dan Ubah data; Tempel stiker, Cek ulang, Catatan, Hapus hanya di menu "Aksi lainnya"', async () => {
  const media = mockMatchMedia(true);
  me = manageMe();
  await renderPage({ tab: 'detail' });
  await screen.findByRole('heading', { name: 'ABC123' });
  const wrapper = document.querySelector('[data-tour="serial-actions"]') as HTMLElement;
  expect(actionLabels(wrapper)).toEqual(['Lapor rusak', 'Ubah data', 'Aksi lainnya']);
  expect(screen.queryByRole('button', { name: 'Catatan' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cek ulang' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(await moreActionNames()).toEqual(['Tempel stiker', 'Cek ulang', 'Catatan', 'Hapus']);
  media.restore();
});

/** Admin: `serial: edit` dan `serialservice: edit` pada BU serial (QC sekaligus tim servis). */
function adminMe(): MeDto {
  const base = meWith('edit');
  return {
    ...base,
    permissions: { ...base.permissions, serialservice: 'edit' },
    businessUnits: base.businessUnits.map((bu) => ({
      ...bu,
      permissions: { ...bu.permissions, serialservice: 'edit' },
    })),
  };
}

/** Tim servis: `serialservice: edit` pada BU serial, tanpa hak `serial` (hanya baca). */
function serviceMe(): MeDto {
  const base = meWith('view');
  return {
    ...base,
    permissions: { ...base.permissions, serialservice: 'edit' },
    businessUnits: base.businessUnits.map((bu) => ({
      ...bu,
      permissions: { ...bu.permissions, serialservice: 'edit' },
    })),
  };
}

const AT_SERVICE = { ...SERIAL, status: 'at_service', custody: 'transit' } as SerialDto;

test('tim servis desktop: Terima di servis + Diagnosis jadi tombol (tanpa Lapor rusak, Ubah data, Tempel stiker, Hapus); Catatan di menu', async () => {
  const media = mockMatchMedia(true);
  me = serviceMe();
  state = { ...state, serial: AT_SERVICE };
  await renderPage({ tab: 'detail' });
  await screen.findByRole('heading', { name: 'ABC123' });
  const wrapper = document.querySelector('[data-tour="serial-actions"]') as HTMLElement;
  expect(actionLabels(wrapper)).toEqual(['Terima di servis', 'Diagnosis', 'Aksi lainnya']);
  expect(await moreActionNames()).toEqual(['Catatan']);
  media.restore();
});

test('tim servis ponsel: bar bawah memuat Terima di servis + Diagnosis dan ⋯ (Catatan di menu)', async () => {
  const media = mockMatchMedia(false);
  window.innerWidth = 360;
  me = serviceMe();
  state = { ...state, serial: AT_SERVICE };
  await renderPage({ tab: 'detail' });
  const bar = await screen.findByRole('region', { name: 'Aksi halaman' });
  expect(actionLabels(bar)).toEqual(['Terima di servis', 'Diagnosis', 'Aksi lainnya']);
  expect(await moreActionNames()).toEqual(['Catatan']);
  media.restore();
  window.innerWidth = 1024;
});
