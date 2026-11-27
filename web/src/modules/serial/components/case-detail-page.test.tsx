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
import { clickMoreAction, hasNoMoreActions, moreActionNames } from '@/test/more-actions';
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
      serialwh: 'none',
      countrylock: 'none',
      dashboard: 'none',
    },
    businessUnits: [
      {
        id: 'b1',
        code: 'SBY',
        name: 'Surabaya',
        status: 'active',
        permissions: { item: 'none', serial, serialservice: 'none', serialwh: 'none' },
      },
    ],
    locations: [],
  };
}

/** Tim servis: `serialservice: edit` pada BU laporan, serial hanya baca. */
function serviceMe(): MeDto {
  const base = meWith('view');
  return {
    ...base,
    permissions: { ...base.permissions, serialservice: 'edit', serialwh: 'none' },
    businessUnits: base.businessUnits.map((bu) => ({
      ...bu,
      permissions: { ...bu.permissions, serialservice: 'edit', serialwh: 'none' },
    })),
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

describe('aksi di header (bobot aksi, K7)', () => {
  test('laporan terbuka (Dilaporkan): Cek ulang + Kirim ke servis sebagai tombol; Tempel stiker dan Catatan hanya di menu; tanpa Lapor rusak, Ubah data, Hapus; Serial induk dimuat', async () => {
    mockApi(REPORT);
    const { container } = await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Cek ulang' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kirim ke servis' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tempel stiker' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Catatan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lapor rusak' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ubah data' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
    // Target panduan `serial-actions` ada di header (bar atas desktop); tombol utama berurut Cek ulang, Kirim ke servis.
    const wrapper = container.querySelector('[data-tour="serial-actions"]') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(
      [...wrapper.querySelectorAll('button')].map(
        (button) => button.textContent?.trim() || button.getAttribute('aria-label'),
      ),
    ).toEqual(['Cek ulang', 'Kirim ke servis', 'Aksi lainnya']);
    expect(await moreActionNames()).toEqual(['Tempel stiker', 'Catatan']);
    await waitFor(() => expect(calls('serials.get')).toHaveLength(1));
    expect(calls('serials.get')[0]?.[1]).toEqual({ id: 's1' });
  });

  test('Catatan dari menu membuka dialog catatan untuk Serial induk', async () => {
    mockApi(REPORT);
    await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    // Tombol aktif setelah Serial induk selesai dimuat.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cek ulang' })).toBeEnabled());
    await clickMoreAction('Catatan');
    expect(await screen.findByRole('dialog', { name: 'Tambah catatan' })).toBeInTheDocument();
  });

  test('Tempel stiker dari menu membuka dialog Tempel stiker', async () => {
    mockApi(REPORT);
    await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cek ulang' })).toBeEnabled());
    await clickMoreAction('Tempel stiker');
    expect(await screen.findByRole('dialog', { name: 'Tempel stiker' })).toBeInTheDocument();
  });

  test('dikirim ke servis (tim servis): Terima di servis + Diagnosis sebagai tombol; Catatan di menu', async () => {
    me = serviceMe();
    mockApi({ ...REPORT, status: 'at_service', custody: 'transit', serialStatus: 'at_service' });
    await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Terima di servis' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diagnosis' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Catatan' })).toBeNull();
    expect(await moreActionNames()).toEqual(['Catatan']);
  });

  test('diagnosis: hanya Diagnosis sebagai tombol; Catatan di menu', async () => {
    me = serviceMe();
    mockApi({ ...REPORT, status: 'diagnosis', custody: 'service', serialStatus: 'diagnosis' });
    await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Diagnosis' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Terima di servis' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Catatan' })).toBeNull();
    expect(await moreActionNames()).toEqual(['Catatan']);
  });

  test('dikembalikan ke QC: Terima di QC + Cek ulang sebagai tombol; Catatan di menu', async () => {
    mockApi({ ...REPORT, status: 'recheck', custody: 'transit', serialStatus: 'recheck' });
    await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Terima di QC' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cek ulang' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Catatan' })).toBeNull();
    expect(await moreActionNames()).toEqual(['Catatan']);
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
    expect(screen.queryByRole('button', { name: 'Cek ulang' })).toBeNull();
    expect(hasNoMoreActions()).toBe(true);
    expect(container.querySelector('[data-tour="serial-actions"]')).toBeNull();
    expect(calls('serials.get')).toHaveLength(0);
  });

  test('pengguna serial: view tidak melihat aksi dan serials.get tidak dipanggil', async () => {
    me = meWith('view');
    mockApi(REPORT);
    await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    expect(await screen.findByText('Laporan aktif')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cek ulang' })).toBeNull();
    expect(hasNoMoreActions()).toBe(true);
    expect(calls('serials.get')).toHaveLength(0);
  });
});

test('serials.get induk gagal: tanpa aksi (tombol maupun menu), tidak ada tombol yang terus sibuk', async () => {
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'serialCases.get') return REPORT;
    if (id === 'serials.history') return historyOf([]);
    if (id === 'serials.get') throw new ApiError('UNAVAILABLE', 'Tidak ada koneksi', 'req-3');
    throw new Error(`api tak terduga: ${id}`);
  });
  await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
  expect(await screen.findByText('Laporan aktif')).toBeInTheDocument();
  await waitFor(() => expect(calls('serials.get')).toHaveLength(1));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Cek ulang' })).toBeNull());
  expect(hasNoMoreActions()).toBe(true);
  expect(screen.queryByRole('button', { name: /…$/ })).toBeNull();
});

describe('diagram alur (stepper) di atas Ringkasan', () => {
  const activeStep = () =>
    within(screen.getByRole('list', { name: 'Tahap' }))
      .getAllByRole('listitem')
      .filter((li) => li.getAttribute('aria-current') === 'step');

  test('laporan terbuka: tahap sekarang = status Serial kini, tepat di atas bagian Ringkasan', async () => {
    mockApi({ ...REPORT, status: 'at_service', serialStatus: 'at_service', custody: 'service' });
    const { container } = await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    await screen.findByRole('heading', { level: 1, name: REPORT.number });
    expect(activeStep()).toHaveLength(1);
    expect(activeStep()[0]).toHaveTextContent('Di servis');
    // Urutan DOM: diagram sebelum bagian Ringkasan.
    const steps = screen.getByRole('list', { name: 'Tahap' });
    const summary = screen.getByRole('region', { name: 'Ringkasan laporan' });
    expect(steps.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Tidak menambah target panduan baru.
    expect(container.querySelector('[data-tour="serial-stepper"]')).toBeNull();
  });

  test('laporan selesai rusak: tahap akhir "Rusak"', async () => {
    mockApi({
      ...REPORT,
      closedOn: '2026-11-15',
      outcome: 'broken',
      status: 'broken',
      serialStatus: 'broken',
    });
    await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    await screen.findByText('Selesai: Rusak');
    expect(activeStep()).toHaveLength(1);
    expect(activeStep()[0]).toHaveTextContent('Rusak');
  });

  test('laporan selesai lolos: tahap akhir "Lolos"', async () => {
    mockApi({
      ...REPORT,
      closedOn: '2026-11-15',
      outcome: 'good',
      status: 'good',
      serialStatus: 'good',
    });
    await renderInRouter(<CaseDetailPage caseId="c1" onBack={vi.fn()} />);
    await screen.findByText('Selesai: Lolos');
    expect(activeStep()).toHaveLength(1);
    expect(activeStep()[0]).toHaveTextContent('Lolos');
    // Tahap awal "Lolos" bukan tahap aktif (hasCases = true => tahap akhir).
    expect(
      within(screen.getByRole('list', { name: 'Tahap' })).getAllByRole('listitem')[0],
    ).not.toHaveAttribute('aria-current');
  });
});
