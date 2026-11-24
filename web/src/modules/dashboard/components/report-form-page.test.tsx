import type { MeDto } from '@shared/contract';
import type { DashboardReportDto } from '@shared/dashboard-report';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { makeMe } from '@/test/make-me';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { parseRecipients, ReportFormPage } from './report-form-page';

const SAVED: DashboardReportDto = {
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
    widgets: [{ id: 'sn.recorded', filters: {} }],
    offers: [],
  },
  recipients: ['lama@contoh.id'],
  recipientCount: 1,
  linkDays: 14,
  lastStatus: '',
  lastNote: '',
  lastRunAt: '',
  nextRunAt: '2026-11-30T01:00:00.000Z',
  createdAt: '2026-11-20T01:00:00.000Z',
  updatedAt: '2026-11-22T01:00:00.000Z',
  canEdit: true,
};

const onDone = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  installIntersectionObserver();
  apiMock.mockReset();
  onDone.mockReset();
  onCancel.mockReset();
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
  apiMock.mockImplementation(async (id: string, input: unknown) => {
    if (id === 'dashboardReports.save') return { ...SAVED, ...(input as object), id: 'r1' };
    if (id === 'dashboard.options') {
      return { customers: [], items: [], stickerTypes: [], stickers: [] };
    }
    throw new Error(`api tak terduga: ${id}`);
  });
});

const form = (report?: DashboardReportDto) =>
  renderInRouter(<ReportFormPage report={report} onDone={onDone} onCancel={onCancel} />);

const goTab = (name: string) => userEvent.click(screen.getByRole('tab', { name }));

/** Isi minimal: nama, satu widget (tab Isi), dan penerima (tab Penerima). */
async function fillValid(recipients: string) {
  await userEvent.type(screen.getByLabelText('Nama laporan'), 'Uji');
  await goTab('Isi');
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Serial dicatat' }));
  await goTab('Penerima');
  await userEvent.type(screen.getByLabelText('Alamat surel penerima'), recipients);
}

const saveInput = () =>
  apiMock.mock.calls.find((call) => call[0] === 'dashboardReports.save')?.[1] as Record<
    string,
    unknown
  >;

describe('parseRecipients', () => {
  test('dipisah baris, koma, titik koma, atau spasi; huruf kecil; duplikat dibuang', () => {
    expect(parseRecipients('A@x.id, b@y.id;\n a@x.id  c@z.id\n\n')).toEqual([
      'a@x.id',
      'b@y.id',
      'c@z.id',
    ]);
    expect(parseRecipients('   ')).toEqual([]);
  });
});

describe('ReportFormPage: laporan baru', () => {
  test('isian kosong: galat per field, tidak memanggil server', async () => {
    await form();
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Nama wajib diisi')).toBeTruthy();
    expect(screen.getByText('Pilih minimal satu widget')).toBeTruthy();
    expect(screen.getByText('Isi minimal satu alamat surel')).toBeTruthy();
    expect(apiMock.mock.calls.some((call) => call[0] === 'dashboardReports.save')).toBe(false);
  });

  test('alamat bernama atau rusak ditolak sebelum dikirim', async () => {
    await form();
    await fillValid('A <a@x.id>');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText(/Ada alamat yang tidak sah/)).toBeTruthy();
    expect(apiMock.mock.calls.some((call) => call[0] === 'dashboardReports.save')).toBe(false);
  });

  test('menyimpan: konfirmasi dulu, lalu masukan lengkap tanpa id dan tanpa expectedUpdatedAt', async () => {
    await form();
    await fillValid('Satu@Contoh.id{Enter}dua@contoh.id{Enter}satu@contoh.id');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Simpan laporan dan kirim ke 2 alamat?')).toBeTruthy();
    expect(apiMock.mock.calls.some((call) => call[0] === 'dashboardReports.save')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Simpan', hidden: false }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('r1'));
    const input = saveInput();
    expect(input).toEqual({
      name: 'Uji',
      schedule: { frequency: 'weekly', hour: 8, weekday: 1, monthDay: 1 },
      period: 'lastWeek',
      filter: { from: '', to: '' },
      locationFiltered: false,
      widgets: [{ id: 'sn.recorded', filters: {} }],
      offers: [],
      recipients: ['satu@contoh.id', 'dua@contoh.id'],
      linkDays: 14,
    });
  });

  test('Periksa lagi menutup konfirmasi tanpa menyimpan', async () => {
    await form();
    await fillValid('a@contoh.id');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Periksa lagi' }));
    await waitFor(() => expect(screen.queryByText(/kirim ke 1 alamat/)).toBeNull());
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('ReportFormPage: ubah laporan', () => {
  test('tanpa perubahan penerima atau widget: langsung simpan dengan expectedUpdatedAt dan id', async () => {
    await form(SAVED);
    await userEvent.clear(screen.getByLabelText('Nama laporan'));
    await userEvent.type(screen.getByLabelText('Nama laporan'), 'Nama baru');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('r1'));
    expect(screen.queryByText(/Simpan laporan dan kirim/)).toBeNull();
    expect(saveInput()).toMatchObject({
      id: 'r1',
      expectedUpdatedAt: '2026-11-22T01:00:00.000Z',
      name: 'Nama baru',
      recipients: ['lama@contoh.id'],
      filter: { from: '', to: '', buIds: ['b1'] },
    });
  });

  test('mengubah penerima meminta konfirmasi', async () => {
    await form(SAVED);
    await goTab('Penerima');
    await userEvent.type(screen.getByLabelText('Alamat surel penerima'), '{Enter}baru@contoh.id');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Simpan laporan dan kirim ke 2 alamat?')).toBeTruthy();
  });

  test('versi usang (412) menampilkan pesan muat ulang dan tidak menutup form', async () => {
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'dashboardReports.save') {
        throw new ApiError('CONFLICT', 'Data sudah berubah', 'req-1', undefined, { status: 412 });
      }
      return { customers: [], items: [], stickerTypes: [], stickers: [] };
    });
    await form(SAVED);
    await userEvent.type(screen.getByLabelText('Nama laporan'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText(/sudah diubah orang lain/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  test('galat per field dari server tampil pada fieldnya', async () => {
    apiMock.mockImplementation(async (id: string) => {
      if (id === 'dashboardReports.save') {
        throw new ApiError('VALIDATION', 'Input tidak valid', 'req-1', {
          name: 'Nama sudah dipakai',
        });
      }
      return { customers: [], items: [], stickerTypes: [], stickers: [] };
    });
    await form(SAVED);
    await userEvent.type(screen.getByLabelText('Nama laporan'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Nama sudah dipakai')).toBeTruthy();
  });
});
