import type { DashboardShareDto } from '@shared/dashboard-share';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

import { SharesDialog } from './shares-dialog';

function share(overrides: Partial<DashboardShareDto>): DashboardShareDto {
  return {
    id: 'ds1',
    title: 'Rekap mingguan',
    createdBy: 'a@x.com',
    createdAt: '2026-11-20T01:00:00.000Z',
    expiresAt: '2026-12-20T01:00:00.000Z',
    revokedAt: '',
    status: 'active',
    widgetCount: 3,
    reportId: '',
    url: 'https://qc.example/dashboard-publik/v1.ds1.1.sig',
    ...overrides,
  };
}

let rows: DashboardShareDto[];

beforeEach(() => {
  rows = [
    share({}),
    share({ id: 'ds2', title: 'Milik orang lain', createdBy: 'b@x.com', url: undefined }),
    share({
      id: 'ds3',
      title: 'Sudah dicabut',
      status: 'revoked',
      revokedAt: '2026-11-21T01:00:00.000Z',
    }),
    share({ id: 'ds4', title: 'Sudah lewat', status: 'expired' }),
  ];
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'dashboardShares.list') return rows;
    if (id === 'dashboardShares.revoke') return { ok: true };
    throw new Error(`api tak terduga: ${id}`);
  });
});

const rowOf = async (title: string) => {
  const cell = await screen.findByText(title);
  return cell.closest('tr') as HTMLElement;
};

test('status tampil sebagai teks pada setiap baris', async () => {
  await renderInRouter(<SharesDialog onClose={() => undefined} />);
  expect(await screen.findByText('Rekap mingguan')).toBeTruthy();
  expect(within(await rowOf('Rekap mingguan')).getByText('Aktif')).toBeTruthy();
  expect(within(await rowOf('Sudah dicabut')).getByText('Dicabut')).toBeTruthy();
  expect(within(await rowOf('Sudah lewat')).getByText('Kedaluwarsa')).toBeTruthy();
});

test('"Salin tautan" hanya ada untuk baris yang membawa url', async () => {
  await renderInRouter(<SharesDialog onClose={() => undefined} />);
  expect(await screen.findByRole('button', { name: 'Salin tautan Rekap mingguan' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Salin tautan Milik orang lain' })).toBeNull();
});

test('mencabut meminta konfirmasi lalu memanggil dashboardShares.revoke', async () => {
  await renderInRouter(<SharesDialog onClose={() => undefined} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Cabut tautan Rekap mingguan' }));
  expect(await screen.findByText(/Cabut tautan "Rekap mingguan"\?/)).toBeTruthy();
  expect(apiMock.mock.calls.some((call) => call[0] === 'dashboardShares.revoke')).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Cabut tautan' }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('dashboardShares.revoke', { id: 'ds1' }),
  );
});

test('baris yang sudah dicabut atau kedaluwarsa tidak punya aksi cabut', async () => {
  await renderInRouter(<SharesDialog onClose={() => undefined} />);
  await screen.findByText('Rekap mingguan');
  expect(screen.queryByRole('button', { name: 'Cabut tautan Sudah dicabut' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cabut tautan Sudah lewat' })).toBeNull();
});
