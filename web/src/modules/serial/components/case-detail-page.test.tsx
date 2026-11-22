import type { SerialCaseDetailDto, SerialEventDto, SerialHistoryOutput } from '@shared/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { renderInRouter } from '@/test/render-in-router';
import { formatDay } from '../lib/labels';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

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
    throw new Error(`api tak terduga: ${id}`);
  });
}

beforeEach(() => {
  apiMock.mockReset();
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
  expect(within(summary).getByText('Terbuka 9 hari; di status ini 3 hari')).toBeInTheDocument();
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
  // Panel kanan menaut ke detail Serial dan daftar Laporan.
  expect(screen.getByRole('link', { name: 'Buka Serial Number' })).toHaveAttribute(
    'href',
    '/serial/s1',
  );
  expect(screen.getByRole('link', { name: 'Lihat semua laporan' })).toHaveAttribute(
    'href',
    '/serial/reports',
  );
});

test('laporan tertutup: hasil, penutup beserta timnya, dan lama penyelesaian', async () => {
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
