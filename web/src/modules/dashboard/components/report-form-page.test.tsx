import type { MeDto } from '@shared/contract';
import type { DashboardReportDto } from '@shared/dashboard-report';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { pickLink } from '@/test/link-field';
import { addMailAddress, BCC_FIELD, CC_FIELD, TO_FIELD, typeInMailField } from '@/test/mail-lists';
import { makeMe } from '@/test/make-me';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { ReportFormPage } from './report-form-page';

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
    widgets: [{ id: 'sn.status', filters: {} }],
    offers: [],
  },
  recipients: ['lama@contoh.id'],
  cc: [],
  bcc: [],
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
async function fillValid(recipients: string[]) {
  await userEvent.type(screen.getByLabelText('Nama laporan'), 'Uji');
  await goTab('Isi');
  await userEvent.click(await screen.findByRole('checkbox', { name: 'Komposisi status' }));
  await goTab('Penerima');
  for (const address of recipients) await addMailAddress(TO_FIELD, address);
}

const saveInput = () =>
  apiMock.mock.calls.find((call) => call[0] === 'dashboardReports.save')?.[1] as Record<
    string,
    unknown
  >;

describe('ReportFormPage: laporan baru', () => {
  test('isian kosong: galat per field, tidak memanggil server', async () => {
    await form();
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Nama wajib diisi')).toBeTruthy();
    expect(screen.getByText('Pilih minimal satu widget')).toBeTruthy();
    expect(screen.getByText('Isi minimal satu alamat surel (Kepada, CC, atau BCC)')).toBeTruthy();
    expect(apiMock.mock.calls.some((call) => call[0] === 'dashboardReports.save')).toBe(false);
  });

  test('alamat bernama atau rusak tidak jadi chip, jadi simpan tetap ditolak sebagai kosong', async () => {
    await form();
    await fillValid([]);
    await typeInMailField(TO_FIELD, 'A <a@x.id>');
    expect(await screen.findByText(/Ketik alamat email lengkap/)).toBeTruthy();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(
      await screen.findByText('Isi minimal satu alamat surel (Kepada, CC, atau BCC)'),
    ).toBeTruthy();
    expect(apiMock.mock.calls.some((call) => call[0] === 'dashboardReports.save')).toBe(false);
  });

  test('alamat yang sudah ada di satu daftar tidak ditawarkan di daftar lain', async () => {
    await form();
    await goTab('Penerima');
    await addMailAddress(TO_FIELD, 'satu@contoh.id');
    await typeInMailField(BCC_FIELD, 'satu@contoh.id');
    expect(screen.queryByRole('option', { name: 'satu@contoh.id' })).toBeNull();
  });

  test('menyimpan: konfirmasi dulu, lalu masukan lengkap tanpa id dan tanpa expectedUpdatedAt', async () => {
    await form();
    await fillValid(['Satu@Contoh.id', 'dua@contoh.id']);
    await addMailAddress(CC_FIELD, 'Tembus@Contoh.id');
    await addMailAddress(BCC_FIELD, 'rahasia@contoh.id');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(await screen.findByText('Simpan laporan dan kirim ke 4 alamat?')).toBeTruthy();
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
      widgets: [{ id: 'sn.status', filters: {} }],
      offers: [],
      recipients: ['satu@contoh.id', 'dua@contoh.id'],
      cc: ['tembus@contoh.id'],
      bcc: ['rahasia@contoh.id'],
      linkDays: 14,
    });
  });

  test('Periksa lagi menutup konfirmasi tanpa menyimpan', async () => {
    await form();
    await fillValid(['a@contoh.id']);
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
    await addMailAddress(TO_FIELD, 'baru@contoh.id');
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

describe('ReportFormPage: cakupan lokasi tidak berubah saat menyimpan ulang (I1)', () => {
  const LOCATION = {
    id: 'l1',
    code: 'L1',
    name: 'Lokasi Satu',
    permissions: { handover: 'view', qc: 'none', stock: 'none', stickerstock: 'none' },
  };
  const withLocation = () => {
    me = { ...me, locations: [LOCATION] } as MeDto;
  };
  const MIXED = (locationFiltered: boolean): DashboardReportDto => ({
    ...SAVED,
    scope: {
      buIds: ['b1'],
      // Himpunan BEKU hasil hak pemilik, bukan pilihan pengguna, bila locationFiltered false.
      locationIds: ['l1'],
      locationFiltered,
      widgets: [
        { id: 'hs.created', filters: {} },
        { id: 'sn.status', filters: {} },
      ],
      offers: [],
    },
  });

  test('locationFiltered false tetap false walau daftar lokasi beku tidak kosong', async () => {
    withLocation();
    await form(MIXED(false));
    await userEvent.clear(screen.getByLabelText('Nama laporan'));
    await userEvent.type(screen.getByLabelText('Nama laporan'), 'Nama baru');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(saveInput()).toMatchObject({
      locationFiltered: false,
      filter: { buIds: ['b1'], locationIds: ['l1'] },
    });
  });

  test('locationFiltered true tetap true', async () => {
    withLocation();
    await form(MIXED(true));
    await userEvent.type(screen.getByLabelText('Nama laporan'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(saveInput()).toMatchObject({
      locationFiltered: true,
      filter: { locationIds: ['l1'] },
    });
  });

  test('memilih lokasi sendiri menyalakan pembatasan; mengosongkannya mematikan', async () => {
    withLocation();
    await form({ ...MIXED(false), scope: { ...MIXED(false).scope, locationIds: [] } });
    await goTab('Isi');
    await pickLink(screen, 'Lokasi', 'L1 · Lokasi Satu');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(saveInput()).toMatchObject({ locationFiltered: true, filter: { locationIds: ['l1'] } });
  });
});

describe('ReportFormPage: himpunan beku BU/lokasi lebih dari 20 tidak dikosongkan', () => {
  test('25 BU dan 30 lokasi tersimpan dikirim apa adanya saat simpan ulang', async () => {
    const buIds = Array.from({ length: 25 }, (_, index) => `bu-${index}`);
    const locationIds = Array.from({ length: 30 }, (_, index) => `loc-${index}`);
    await form({
      ...SAVED,
      scope: {
        buIds,
        locationIds,
        locationFiltered: true,
        widgets: [{ id: 'sn.status', filters: {} }],
        offers: [],
      },
    });
    await userEvent.type(screen.getByLabelText('Nama laporan'), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const sent = saveInput() as {
      filter: { buIds?: string[]; locationIds?: string[] };
      locationFiltered: boolean;
    };
    expect(sent.filter.buIds).toEqual(buIds);
    expect(sent.filter.locationIds).toEqual(locationIds);
    expect(sent.locationFiltered).toBe(true);
  });
});

describe('ReportFormPage: laporan milik orang lain', () => {
  test('tab Isi menjelaskan bahwa cakupan dipertahankan dan perubahannya harus dalam hak pengguna', async () => {
    await form({ ...SAVED, owner: 'lain@x.com' });
    await goTab('Isi');
    expect(await screen.findByText(/Laporan ini milik lain@x\.com/)).toBeTruthy();
  });

  test('super admin tidak melihat penjelasan itu (perilaku lama)', async () => {
    me = { ...me, isSuperAdmin: true };
    await form({ ...SAVED, owner: 'lain@x.com' });
    await goTab('Isi');
    await screen.findByRole('checkbox', { name: 'Komposisi status' });
    expect(screen.queryByText(/Laporan ini milik/)).toBeNull();
  });

  test('laporan milik sendiri tidak memuat penjelasan itu', async () => {
    await form(SAVED);
    await goTab('Isi');
    await screen.findByRole('checkbox', { name: 'Komposisi status' });
    expect(screen.queryByText(/Laporan ini milik/)).toBeNull();
  });
});
