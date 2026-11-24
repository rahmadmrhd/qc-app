import type { DashboardShareDetailDto } from '@shared/dashboard-share';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { clickMoreAction, hasNoMoreActions } from '@/test/more-actions';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

import { ShareDetailView } from './share-detail-view';

function detail(overrides: Partial<DashboardShareDetailDto> = {}): DashboardShareDetailDto {
  return {
    id: 'ds1',
    title: 'Rekap mingguan',
    createdBy: 'a@x.com',
    createdAt: '2026-11-20T01:00:00.000Z',
    expiresAt: '2026-12-20T01:00:00.000Z',
    revokedAt: '',
    status: 'active',
    widgetCount: 2,
    reportId: '',
    url: 'https://qc.example/dashboard-publik/v1.ds1.1.sig',
    revokedBy: '',
    visitCount: 0,
    firstVisitAt: '',
    lastVisitAt: '',
    visits: [],
    scope: {
      buNames: ['BU Ex'],
      buDeleted: [false],
      locationNames: ['Lokasi A'],
      locationDeleted: [false],
      locationFiltered: false,
      range: { mode: 'fixed', from: '2026-11-01', to: '2026-11-23' },
      widgets: [
        { id: 'sn.recorded', filters: {} },
        { id: 'hs.created', filters: { customer: ['c1', 'c-hilang'], status: ['done'] } },
      ],
      valueNames: { c1: 'PT Maju' },
      offers: ['customer'],
    },
    ...overrides,
  };
}

let current: DashboardShareDetailDto;

beforeEach(() => {
  current = detail();
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'dashboardShares.get') return current;
    if (id === 'dashboardShares.revoke') return { ok: true };
    if (id === 'activity.list') return { entries: [], nextCursor: null };
    throw new Error(`api tak terduga: ${id}`);
  });
});

const view = () => renderInRouter(<ShareDetailView shareId="ds1" onBack={() => undefined} />);

describe('ShareDetailView', () => {
  test('menampilkan ringkasan, cakupan dengan NAMA, dan widget per grup', async () => {
    await view();
    expect(await screen.findByRole('heading', { name: 'Rekap mingguan' })).toBeTruthy();
    expect(screen.getAllByText('Aktif').length).toBeGreaterThan(0);
    expect(screen.getAllByText('a@x.com', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText('BU Ex')).toBeTruthy();
    expect(screen.getByText('Lokasi A')).toBeTruthy();
    expect(screen.getByText(/1 Nov 2026 – 23 Nov 2026 \(tetap\)/)).toBeTruthy();
    const handover = screen.getByRole('region', { name: 'Serah Terima' });
    expect(within(handover).getByText(/Customer: PT Maju, Tidak dikenal/)).toBeTruthy();
    expect(within(handover).getByText(/Status papan: Selesai/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Serial Number' })).toBeTruthy();
    // Id internal tak pernah tampil
    expect(document.body.textContent).not.toContain('c-hilang');
    expect(document.body.textContent).not.toContain('bu-x');
  });

  test('M2: BU dan lokasi terhapus tetap bernama dengan penanda Terhapus', async () => {
    current = detail({
      scope: {
        ...detail().scope,
        buNames: ['BU Ex', 'BU Lama'],
        buDeleted: [false, true],
        locationNames: ['Lokasi Lama'],
        locationDeleted: [true],
      },
    });
    await view();
    expect(await screen.findByText('BU Lama')).toBeTruthy();
    expect(screen.getByText('Lokasi Lama')).toBeTruthy();
    // Penanda hanya pada yang terhapus (satu untuk BU Lama, satu untuk Lokasi Lama).
    expect(screen.getAllByText('Terhapus')).toHaveLength(2);
  });

  test('periode bergulir ditulis "N hari terakhir"', async () => {
    current = detail({
      scope: { ...detail().scope, range: { mode: 'rolling', days: 14 } },
    });
    await view();
    expect(await screen.findByText('14 hari terakhir (bergulir)')).toBeTruthy();
  });

  test('tanpa kunjungan: keadaan kosong', async () => {
    await view();
    expect(await screen.findByText('Belum ada yang membuka tautan.')).toBeTruthy();
    expect(screen.queryByRole('table', { name: /Kunjungan/ })).toBeNull();
  });

  test('kunjungan tampil sebagai teks: negara, perangkat, awalan jaringan, dan jumlah total', async () => {
    current = detail({
      visitCount: 120,
      firstVisitAt: '2026-11-21T01:00:00.000Z',
      lastVisitAt: '2026-11-22T01:00:00.000Z',
      visits: [
        {
          visitedAt: '2026-11-22T01:00:00.000Z',
          country: 'ID',
          device: 'Desktop · Chrome · Windows',
          ipPrefix: '203.0.113.0/24',
        },
        { visitedAt: '2026-11-21T01:00:00.000Z', country: '', device: '', ipPrefix: '' },
      ],
    });
    await view();
    expect(await screen.findByText('120')).toBeTruthy();
    expect(screen.getByText('Desktop · Chrome · Windows')).toBeTruthy();
    expect(screen.getByText('203.0.113.0/24')).toBeTruthy();
    expect(screen.getByText(/Indonesia \(ID\)|^ID$/)).toBeTruthy();
    expect(screen.getAllByText('Tidak diketahui').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/Tabel menampilkan 2 kunjungan terbaru/)).toBeTruthy();
  });

  test('"Salin tautan" hanya bila DTO membawa url', async () => {
    await view();
    expect(await screen.findByRole('button', { name: 'Salin tautan' })).toBeTruthy();
  });

  test('tanpa url (bukan pembagi): tidak ada "Salin tautan"', async () => {
    current = detail({ url: undefined });
    await view();
    await screen.findByRole('heading', { name: 'Rekap mingguan' });
    expect(screen.queryByRole('button', { name: 'Salin tautan' })).toBeNull();
  });

  test('mencabut: konfirmasi lalu dashboardShares.revoke', async () => {
    await view();
    await screen.findByRole('heading', { name: 'Rekap mingguan' });
    await clickMoreAction('Cabut tautan');
    expect(await screen.findByText(/Cabut tautan "Rekap mingguan"\?/)).toBeTruthy();
    expect(apiMock.mock.calls.some((call) => call[0] === 'dashboardShares.revoke')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Cabut tautan' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('dashboardShares.revoke', { id: 'ds1' }),
    );
  });

  test.each([
    ['revoked', 'Dicabut'],
    ['expired', 'Kedaluwarsa'],
  ] as const)('tautan %s: tanpa aksi cabut dan tanpa salin', async (status, label) => {
    current = detail({
      status,
      url: undefined,
      revokedAt: status === 'revoked' ? '2026-11-21T01:00:00.000Z' : '',
      revokedBy: status === 'revoked' ? 'b@x.com' : '',
    });
    await view();
    await screen.findByRole('heading', { name: 'Rekap mingguan' });
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(hasNoMoreActions()).toBe(true);
    expect(screen.queryByRole('button', { name: 'Salin tautan' })).toBeNull();
    if (status === 'revoked') expect(screen.getByText(/oleh b@x\.com/)).toBeTruthy();
  });

  test('log aktivitas dimuat untuk kind dashboardShare', async () => {
    await view();
    await screen.findByRole('heading', { name: 'Rekap mingguan' });
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        'activity.list',
        expect.objectContaining({ kind: 'dashboardShare', id: 'ds1' }),
      ),
    );
  });

  test('tautan tidak ditemukan', async () => {
    apiMock.mockImplementation(async () => {
      throw new ApiError('NOT_FOUND', 'Tautan tidak ditemukan', 'req-1');
    });
    await view();
    expect(await screen.findByRole('heading', { name: 'Tautan tidak ditemukan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Kembali ke Dashboard' })).toBeTruthy();
  });
});
