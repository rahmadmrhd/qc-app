import type { MeDto } from '@shared/contract';
import type { DashboardReportDto } from '@shared/dashboard-report';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { makeMe } from '@/test/make-me';
import { clickMoreAction } from '@/test/more-actions';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { ReportView } from './report-view';

function report(overrides: Partial<DashboardReportDto> = {}): DashboardReportDto {
  return {
    id: 'r1',
    name: 'Ringkasan mingguan',
    owner: 'a@x.com',
    enabled: true,
    schedule: { frequency: 'weekly', hour: 8, weekday: 1, monthDay: 1 },
    period: 'lastWeek',
    scope: {
      buIds: ['b1'],
      locationIds: [],
      locationFiltered: false,
      widgets: [
        { id: 'sn.recorded', filters: {} },
        { id: 'hs.created', filters: { status: ['done'] } },
      ],
      offers: [],
    },
    recipients: ['rahasia@contoh.id'],
    recipientCount: 1,
    linkDays: 14,
    lastStatus: 'ok',
    lastNote: '',
    lastRunAt: '2026-11-23T01:00:00.000Z',
    nextRunAt: '2026-11-30T01:00:00.000Z',
    createdAt: '2026-11-20T01:00:00.000Z',
    updatedAt: '2026-11-22T01:00:00.000Z',
    canEdit: true,
    links: [
      {
        id: 'ds1',
        title: 'Ringkasan mingguan',
        createdBy: 'a@x.com',
        createdAt: '2026-11-23T01:00:00.000Z',
        expiresAt: '2026-12-07T01:00:00.000Z',
        revokedAt: '',
        status: 'active',
        widgetCount: 2,
        reportId: 'r1',
        url: 'https://qc.example/dashboard-publik/v1.ds1.1.sig',
      },
    ],
    ...overrides,
  };
}

let current: DashboardReportDto;
const onBack = vi.fn();
const onEdit = vi.fn();

beforeEach(() => {
  installIntersectionObserver();
  current = report();
  onBack.mockReset();
  onEdit.mockReset();
  me = makeMe({
    permissions: { dashboard: 'manage' },
    businessUnits: [
      {
        id: 'b1',
        code: 'B1',
        name: 'BU Satu',
        status: 'active',
        permissions: { item: 'none', serial: 'view', serialservice: 'none' },
      },
    ],
  });
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'dashboardReports.get') return current;
    if (id === 'dashboardReports.preview') {
      return { subject: 'Ringkasan mingguan: 16 Nov - 22 Nov', html: '<p>isi surel</p>' };
    }
    if (id === 'dashboardReports.remove') return { ok: true };
    if (id === 'dashboardReports.setEnabled') return { ...current, enabled: false };
    if (id === 'activity.list') return { entries: [], nextCursor: null };
    throw new Error(`api tak terduga: ${id}`);
  });
});

const view = () => renderInRouter(<ReportView reportId="r1" onBack={onBack} onEdit={onEdit} />);

describe('ReportView: pemilik', () => {
  test('menampilkan ringkasan, cakupan per grup, penerima, dan tautan terkirim', async () => {
    await view();
    expect(await screen.findByRole('heading', { name: 'Ringkasan mingguan' })).toBeTruthy();
    expect(screen.getByText('Senin 08.00 WIB')).toBeTruthy();
    expect(screen.getByText('B1 · BU Satu')).toBeTruthy();
    const handover = screen.getByRole('region', { name: 'Serah Terima' });
    expect(within(handover).getByText(/Status papan: Selesai/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Serial Number' })).toBeTruthy();
    expect(screen.getByText('rahasia@contoh.id')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salin tautan' })).toBeTruthy();
  });

  test('pratinjau dimuat hanya atas permintaan dan tampil di iframe tanpa izin apa pun', async () => {
    await view();
    await screen.findByRole('heading', { name: 'Ringkasan mingguan' });
    expect(apiMock.mock.calls.some((call) => call[0] === 'dashboardReports.preview')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Muat pratinjau' }));
    const frame = (await screen.findByTitle('Pratinjau surel')) as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toBe('<p>isi surel</p>');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(screen.getByText('Ringkasan mingguan: 16 Nov - 22 Nov')).toBeTruthy();
  });

  test('aksi Ubah memanggil onEdit', async () => {
    await view();
    await userEvent.click(await screen.findByRole('button', { name: 'Ubah' }));
    expect(onEdit).toHaveBeenCalled();
  });

  test('menghapus: konfirmasi dulu, lalu kembali ke daftar', async () => {
    await view();
    await screen.findByRole('heading', { name: 'Ringkasan mingguan' });
    await clickMoreAction(/Hapus/);
    expect(apiMock.mock.calls.some((call) => call[0] === 'dashboardReports.remove')).toBe(false);
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus' }));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('dashboardReports.remove', { id: 'r1' });
  });
});

describe('ReportView: bukan pemilik', () => {
  test('hanya metadata: tanpa penerima, pratinjau, tautan, dan aksi ubah', async () => {
    current = report({ canEdit: false, recipients: [], links: undefined });
    await view();
    expect(await screen.findByRole('heading', { name: 'Ringkasan mingguan' })).toBeTruthy();
    expect(screen.getByText(/Anda melihat metadata laporan/)).toBeTruthy();
    expect(screen.queryByText('rahasia@contoh.id')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Muat pratinjau' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salin tautan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aksi lainnya' })).toBeNull();
    // BU dan lokasi (nama milik pemilik) juga tidak ditampilkan kepada non-pemilik
    expect(screen.queryByText('B1 · BU Satu')).toBeNull();
  });
});

describe('ReportView: galat', () => {
  test('laporan tidak ada: pesan seragam dan tombol kembali', async () => {
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'dashboardReports.get')
        throw new ApiError('NOT_FOUND', 'Tidak ditemukan', 'req-1');
      return { entries: [], nextCursor: null };
    });
    await view();
    expect(await screen.findByRole('heading', { name: 'Laporan tidak ditemukan' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar laporan' }));
    expect(onBack).toHaveBeenCalled();
  });
});
