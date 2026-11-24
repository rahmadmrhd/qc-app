import type { DashboardReportDto, DashboardReportListDto } from '@shared/dashboard-report';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

import { ReportsPage } from './reports-page';

function row(id: string, overrides: Partial<DashboardReportDto> = {}): DashboardReportDto {
  return {
    id,
    name: `Laporan ${id}`,
    owner: 'a@x.com',
    enabled: true,
    schedule: { frequency: 'daily', hour: 7, weekday: 1, monthDay: 1 },
    period: 'yesterday',
    scope: { buIds: [], locationIds: [], locationFiltered: false, widgets: [], offers: [] },
    recipients: [],
    recipientCount: 2,
    linkDays: 14,
    lastStatus: '',
    lastNote: '',
    lastRunAt: '',
    nextRunAt: '2026-11-25T00:00:00.000Z',
    createdAt: '2026-11-20T01:00:00.000Z',
    updatedAt: '2026-11-22T01:00:00.000Z',
    canEdit: true,
    ...overrides,
  };
}

let list: DashboardReportListDto;
const onSearchChange = vi.fn();

beforeEach(() => {
  installIntersectionObserver();
  onSearchChange.mockReset();
  list = {
    reports: [row('a'), row('b', { enabled: false }), row('c', { canEdit: false })],
    smtpConfigured: true,
    limit: 20,
  };
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string, input: { id?: string; enabled?: boolean }) => {
    if (id === 'dashboardReports.list') return list;
    if (id === 'dashboardReports.setEnabled') {
      return { ...list.reports.find((report) => report.id === input.id), enabled: input.enabled };
    }
    if (id === 'dashboardReports.remove') return { ok: true };
    if (id === 'dashboardReports.sendTest') return { ok: true };
    throw new Error(`api tak terduga: ${id}`);
  });
});

const page = (props: Partial<{ q: string; state: 'all' | 'active' | 'paused' }> = {}) =>
  renderInRouter(
    <ReportsPage q={props.q ?? ''} state={props.state ?? 'all'} onSearchChange={onSearchChange} />,
  );

describe('ReportsPage', () => {
  test('daftar menampilkan semua laporan beserta batas per pemilik', async () => {
    await page();
    expect(await screen.findByText('Laporan a')).toBeTruthy();
    expect(screen.getByText('Laporan b')).toBeTruthy();
    expect(screen.getByText('Laporan c')).toBeTruthy();
    expect(screen.getByText(/Maksimal 20 laporan per pemilik/)).toBeTruthy();
  });

  test('pencarian dan filter status bekerja di klien', async () => {
    await page({ q: 'laporan b' });
    await screen.findByText('Laporan b');
    expect(screen.queryByText('Laporan a')).toBeNull();
  });

  test('filter Dijeda hanya menampilkan laporan yang dijeda', async () => {
    await page({ state: 'paused' });
    await screen.findByText('Laporan b');
    expect(screen.queryByText('Laporan a')).toBeNull();
  });

  test('SMTP belum diatur: peringatan tampil dan Kirim uji dinonaktifkan', async () => {
    list = { ...list, smtpConfigured: false };
    await page();
    expect((await screen.findAllByText(/SMTP belum diatur di server/)).length).toBeGreaterThan(0);
    const sendTest = screen.getByRole('button', { name: 'Kirim uji Laporan a' });
    expect((sendTest as HTMLButtonElement).disabled).toBe(true);
  });

  test('aksi baris hanya untuk pemilik: laporan orang lain tanpa Ubah/Jeda/Hapus', async () => {
    await page();
    await screen.findByText('Laporan a');
    expect(screen.getByRole('button', { name: 'Ubah Laporan a' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ubah Laporan c' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hapus Laporan c' })).toBeNull();
  });

  test('menjeda satu laporan memanggil setEnabled false', async () => {
    await page();
    await userEvent.click(await screen.findByRole('button', { name: 'Jeda Laporan a' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('dashboardReports.setEnabled', {
        id: 'a',
        enabled: false,
      }),
    );
  });

  test('hapus: konfirmasi dulu, lalu memanggil remove', async () => {
    await page();
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus Laporan a' }));
    expect(apiMock.mock.calls.some((call) => call[0] === 'dashboardReports.remove')).toBe(false);
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('dashboardReports.remove', { id: 'a' }),
    );
  });

  test('aksi massal Jeda hanya mengirim laporan aktif milik sendiri', async () => {
    await page();
    await screen.findByText('Laporan a');
    await userEvent.click(screen.getByRole('checkbox', { name: /Laporan a/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Laporan b/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Jeda' }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('dashboardReports.setEnabled', {
        id: 'a',
        enabled: false,
      }),
    );
    expect(
      apiMock.mock.calls.filter(
        (call) => call[0] === 'dashboardReports.setEnabled' && call[1].id === 'b',
      ),
    ).toHaveLength(0);
  });

  test('daftar kosong menawarkan membuat laporan pertama', async () => {
    list = { reports: [], smtpConfigured: true, limit: 20 };
    await page();
    expect(
      await screen.findByRole('button', { name: 'Buat laporan terjadwal pertama' }),
    ).toBeTruthy();
  });
});
