import type {
  MeDto,
  SerialCaseDetailDto,
  SerialDto,
  SerialEventDto,
  SerialHistoryOutput,
} from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { renderInRouter } from '@/test/render-in-router';
import { formatDay } from '../lib/labels';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));
let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));
// Editor Tiptap tidak dapat diketik di jsdom: diganti kolom teks.
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

import { CaseDetailPage } from './case-detail-page';

const REPORT: SerialCaseDetailDto = {
  id: 'c1',
  number: 'LP/SBY/2611-0001',
  serialId: 's1',
  serial: 'ABC123',
  buId: 'b1',
  buCode: 'SBY',
  itemLabel: 'Cisco C9200',
  status: 'reported',
  custody: 'qc',
  openedOn: '2026-11-13',
  closedOn: null,
  outcome: null,
  daysInStatus: 3,
  locationName: 'Surabaya',
  durationDays: 9,
  reporter: 'budi@x.com',
  summary: 'Port mati',
  serialStatus: 'reported',
};

const SERIAL: SerialDto = {
  buHistory: [],
  id: 's1',
  buId: 'b1',
  buCode: 'SBY',
  serial: 'ABC123',
  itemId: 'i1',
  itemLabel: 'Cisco C9200',
  testDate: '2026-11-10',
  sample: false,
  locationId: 'l1',
  locationName: 'Surabaya',
  status: 'reported',
  custody: 'qc',
  transitToLocationId: null,
  transitToLocationName: null,
  transitOn: null,
  openCaseNumber: 'LP/SBY/2611-0001',
  createdAt: '2026-11-10T03:00:00.000Z',
  note: '',
  recordedLocationId: 'l1',
  stickers: [],
  hasProofPhotos: false,
  proofProblemCount: 0,
  openCaseId: 'c1',
  transitFromLocationId: null,
  transitFromLocationName: null,
  openCase: null,
  cases: [],
  createdBy: 'budi@x.com',
  updatedAt: '2026-11-11T03:00:00.000Z',
  updatedBy: 'budi@x.com',
};

function meWith(serial: 'none' | 'view' | 'edit'): MeDto {
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
        code: 'SBY',
        name: 'Surabaya',
        status: 'active',
        permissions: { item: 'none', serial, serialservice: 'none' },
      },
    ],
    locations: [],
  };
}

const event = (
  seq: number,
  type: SerialEventDto['type'],
  over: Partial<SerialEventDto> = {},
): SerialEventDto => ({
  id: `e${seq}`,
  caseId: 'c1',
  seq,
  type,
  occurredOn: '2026-11-13',
  createdAt: '2026-11-13T03:00:00.000Z',
  actorName: 'Budi',
  actorTeam: 'qc',
  message: '',
  changes: [],
  data: {},
  proofPhotos: [],
  ...over,
});

const historyOf = (events: SerialEventDto[]): SerialHistoryOutput => ({
  events,
  nextCursor: null,
  counts: { all: events.length, checks: 0, changes: 0, byCase: { c1: events.length } },
});

function mockApi(report: SerialCaseDetailDto | ApiError, events: SerialEventDto[] = []) {
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'serialCases.get') {
      if (report instanceof ApiError) throw report;
      return report;
    }
    if (id === 'serials.history') return historyOf(events);
    if (id === 'serials.get') {
      return { serial: SERIAL, events: [], eventsTruncated: false, problemPhotos: [] };
    }
    if (id === 'serials.stickerOptions') return { stickers: [] };
    if (id === 'serials.locationOptions') return { locations: [] };
    throw new Error(`api tak terduga: ${id}`);
  });
}

const calls = (id: string) => apiMock.mock.calls.filter((call) => call[0] === id);

beforeEach(() => {
  apiMock.mockReset();
  me = meWith('edit');
});

test('laporan terbuka: ringkasan lengkap, Serial Number bertautan, dan linimasa kejadian laporan itu', async () => {
  mockApi(REPORT, [
    event(2, 'send', { actorName: 'Dewi', data: { leg: 'to_service' } }),
    event(1, 'report_failure', { data: { caseNumber: REPORT.number, damage: 'Port mati' } }),
  ]);
  await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
  expect(await screen.findByRole('heading', { level: 1, name: REPORT.number })).toBeInTheDocument();
  expect(screen.getByText('Laporan aktif')).toBeInTheDocument();
  const summary = screen.getByRole('region', { name: 'Ringkasan laporan' });
  expect(within(summary).getByRole('link', { name: 'ABC123' })).toHaveAttribute(
    'href',
    '/serial/s1',
  );
  expect(within(summary).getByText('Cisco C9200')).toBeInTheDocument();
  expect(within(summary).getByText('SBY')).toBeInTheDocument();
  expect(within(summary).getByText('budi@x.com')).toBeInTheDocument();
  expect(within(summary).getByText(formatDay('2026-11-13'))).toBeInTheDocument();
  expect(within(summary).getByText('Belum ditutup')).toBeInTheDocument();
  expect(within(summary).getByText('Belum ada (laporan masih terbuka)')).toBeInTheDocument();
  expect(within(summary).getByText('Dilaporkan')).toBeInTheDocument();
  expect(within(summary).getByText('Surabaya · Di QC')).toBeInTheDocument();
  // R5: "Lama" diganti "Durasi penanganan", dengan isi yang menyebut ukurannya.
  expect(within(summary).getByText('Durasi penanganan')).toBeInTheDocument();
  expect(within(summary).queryByText('Lama')).toBeNull();
  expect(within(summary).getByText('Berjalan 9 hari · di status ini 3 hari')).toBeInTheDocument();
  // Linimasa memakai serials.history ber-caseId; yang terbaru tampil, yang lama dilipat.
  expect(apiMock).toHaveBeenCalledWith('serials.history', {
    id: 's1',
    group: 'all',
    caseId: 'c1',
  });
  const list = await screen.findByRole('list', { name: 'Linimasa' });
  expect(within(list).getByText('Terbaru')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tampilkan riwayat sebelumnya' }));
  expect(within(list).getByText('Laporan LP/SBY/2611-0001 dibuka: Port mati')).toBeInTheDocument();
  // R4: panel kanan tanpa tautan "Buka Serial Number" dan "Lihat semua laporan" (tautan serial di ringkasan tetap).
  expect(screen.queryByRole('link', { name: 'Buka Serial Number' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Lihat semua laporan' })).toBeNull();
});

test('laporan tertutup: hasil, penutup beserta timnya, dan durasi penanganan', async () => {
  mockApi(
    {
      ...REPORT,
      closedOn: '2026-11-15',
      outcome: 'broken',
      status: 'broken',
      serialStatus: 'broken',
      closedBy: 'Citra',
      closedByTeam: 'service',
      durationDays: 2,
    },
    [event(1, 'declare_broken', { actorName: 'Citra', actorTeam: 'service' })],
  );
  await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
  expect(await screen.findByText('Selesai: Rusak')).toBeInTheDocument();
  const summary = screen.getByRole('region', { name: 'Ringkasan laporan' });
  expect(
    within(summary).getByText(`${formatDay('2026-11-15')} oleh Citra (Servis)`),
  ).toBeInTheDocument();
  // Hasil laporan dan status Serial kini sama-sama Rusak.
  expect(within(summary).getAllByText('Rusak')).toHaveLength(2);
  expect(within(summary).getByText('Durasi penanganan')).toBeInTheDocument();
  expect(within(summary).getByText('Selesai dalam 2 hari')).toBeInTheDocument();
  expect(within(summary).queryByText('Belum ditutup')).toBeNull();
});

test('laporan tidak ada atau tak terbaca (NOT_FOUND): pesan tidak ditemukan dan kembali ke daftar', async () => {
  mockApi(new ApiError('NOT_FOUND', 'Laporan tidak ditemukan', 'req-1'));
  const onBack = vi.fn();
  await renderInRouter(<CaseDetailPage caseId="x" onBack={onBack} />);
  expect(
    await screen.findByRole('heading', { name: 'Laporan tidak ditemukan' }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(apiMock).not.toHaveBeenCalledWith('serials.history', expect.anything());
  await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar Laporan' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('galat lain (server tak terjangkau): pesan galat, bukan "tidak ditemukan"', async () => {
  mockApi(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', 'req-2'));
  await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
  expect(
    await screen.findByRole('heading', { name: 'Laporan tidak dapat dimuat' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Tidak ada koneksi');
});

describe('aksi di header (R3)', () => {
  test('laporan terbuka: Tempel stiker dan Update, tanpa Lapor rusak dan Ubah data; Serial induk dimuat', async () => {
    mockApi(REPORT);
    const { container } = await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Tempel stiker' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lapor rusak' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ubah data' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
    // Target panduan `serial-actions` ada di header (bar atas desktop).
    expect(container.querySelector('[data-tour="serial-actions"]')).not.toBeNull();
    await waitFor(() => expect(calls('serials.get')).toHaveLength(1));
    expect(calls('serials.get')[0]?.[1]).toEqual({ id: 's1' });
  });

  test('Update membuka dropdown; Catatan membuka dialog catatan untuk Serial induk', async () => {
    mockApi(REPORT);
    await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    // Tombol aktif setelah Serial induk selesai dimuat.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(expect.arrayContaining(['Kirim ke servis', 'Catatan']));
    // Tempel stiker bukan bagian Update.
    expect(within(menu).queryByRole('menuitem', { name: 'Tempel stiker' })).toBeNull();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Catatan' }));
    expect(await screen.findByRole('dialog', { name: 'Tambah catatan' })).toBeInTheDocument();
  });

  test('Tempel stiker membuka dialog Tempel stiker', async () => {
    mockApi(REPORT);
    await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Tempel stiker' })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tempel stiker' }));
    expect(await screen.findByRole('dialog', { name: 'Tempel stiker' })).toBeInTheDocument();
  });

  test('laporan selesai: tanpa aksi dan serials.get tidak dipanggil', async () => {
    mockApi({
      ...REPORT,
      closedOn: '2026-11-15',
      outcome: 'good',
      status: 'good',
      serialStatus: 'good',
    });
    const { container } = await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    expect(await screen.findByText('Selesai: Lolos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tempel stiker' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    expect(container.querySelector('[data-tour="serial-actions"]')).toBeNull();
    expect(calls('serials.get')).toHaveLength(0);
  });

  test('pengguna serial: view tidak melihat aksi dan serials.get tidak dipanggil', async () => {
    me = meWith('view');
    mockApi(REPORT);
    await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    expect(await screen.findByText('Laporan aktif')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tempel stiker' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    expect(calls('serials.get')).toHaveLength(0);
  });
});
