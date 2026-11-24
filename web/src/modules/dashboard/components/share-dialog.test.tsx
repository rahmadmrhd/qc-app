import type { MeDto } from '@shared/contract';
import { widgetMeta } from '@shared/dashboard';
import type { DashboardShareDto } from '@shared/dashboard-share';
import { wibDateIso } from '@shared/postel';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { installIntersectionObserver } from '@/test/intersection-observer';
import { pickLink, pickSelect } from '@/test/link-field';
import { renderInRouter } from '@/test/render-in-router';
import { type DashboardSearch, groupFilterParam, parseDashboardSearch } from '../lib/search';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { DashboardPage } from './dashboard-page';
import { ShareDialog } from './share-dialog';

const NONE_LEVELS = {
  access: 'none',
  item: 'none',
  qrcode: 'none',
  handover: 'none',
  qc: 'none',
  stock: 'none',
  sticker: 'none',
  stickerstock: 'none',
  serial: 'none',
  serialservice: 'none',
  countrylock: 'none',
  dashboard: 'none',
} as MeDto['permissions'];

function makeUser(options: { manage?: boolean; edit?: boolean; serial?: boolean }): MeDto {
  return {
    email: 'a@x.com',
    name: 'A',
    isSuperAdmin: false,
    canManageSerialSettings: false,
    sharedAccount: false,
    permissions: {
      ...NONE_LEVELS,
      dashboard: options.manage ? 'manage' : options.edit ? 'edit' : 'none',
    },
    locations: [
      {
        id: 'l1',
        code: 'L1',
        name: 'Lokasi Satu',
        permissions: { handover: 'view', qc: 'none', stock: 'none', stickerstock: 'none' },
      },
    ],
    businessUnits: options.serial
      ? [
          {
            id: 'b1',
            code: 'B1',
            name: 'BU Satu',
            status: 'active',
            permissions: { item: 'none', serial: 'view', serialservice: 'none' },
          },
        ]
      : [],
  } as unknown as MeDto;
}

const CREATED: DashboardShareDto = {
  id: 'ds1',
  title: 'Rekap',
  createdBy: 'a@x.com',
  createdAt: '2026-11-24T01:00:00.000Z',
  expiresAt: '2026-12-24T01:00:00.000Z',
  revokedAt: '',
  status: 'active',
  widgetCount: 1,
  reportId: '',
  url: 'https://qc.example/dashboard-publik/v1.ds1.1.sig',
};

beforeEach(() => {
  installIntersectionObserver();
  apiMock.mockReset();
  apiMock.mockImplementation(async (id: string, input: unknown) => {
    if (id === 'dashboard.options') {
      return {
        customers: [
          { value: 'c1', label: 'PT Satu' },
          { value: 'c2', label: 'PT Dua' },
        ],
        items: [],
        stickerTypes: [],
        stickers: [],
      };
    }
    if (id === 'dashboard.query') {
      const request = input as { widgets: { id: string }[]; filter: { from: string; to: string } };
      return {
        generatedAt: '2026-11-24T00:00:00.000Z',
        range: request.filter,
        bucket: 'day',
        widgets: request.widgets.map((widget) => ({
          id: widget.id,
          status: 'ok',
          data: { kind: 'number', value: 1 },
        })),
      };
    }
    if (id === 'dashboardShares.create') return CREATED;
    if (id === 'dashboardShares.list') return [];
    throw new Error(`api tak terduga: ${id}`);
  });
});

const today = wibDateIso(Date.now());

function DialogHarness({ initial = {} }: { initial?: Record<string, unknown> }) {
  const [search] = useState<DashboardSearch>(parseDashboardSearch(initial));
  return <ShareDialog onClose={() => undefined} search={search} today={today} />;
}

const widgetBox = (id: Parameters<typeof widgetMeta>[0]) =>
  screen.getByRole('checkbox', { name: widgetMeta(id).title });

test('tanpa izin dashboard (edit), tombol Bagikan tidak tampil', async () => {
  me = makeUser({ manage: false });
  await renderInRouter(
    <DashboardPage search={parseDashboardSearch({})} onSearchChange={() => undefined} />,
  );
  await screen.findByRole('heading', { name: 'Serah Terima' });
  expect(screen.queryByRole('button', { name: 'Bagikan' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Tautan dibagikan' })).toBeNull();
});

test('pemegang dashboard: edit melihat tombol Bagikan dan Tautan dibagikan (mengelola miliknya sendiri)', async () => {
  me = makeUser({ edit: true });
  await renderInRouter(
    <DashboardPage search={parseDashboardSearch({})} onSearchChange={() => undefined} />,
  );
  await screen.findByRole('heading', { name: 'Serah Terima' });
  expect(screen.getByRole('button', { name: 'Bagikan' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Tautan dibagikan' })).toBeTruthy();
});

test('pemegang dashboard: manage melihat tombol Bagikan dan Tautan dibagikan', async () => {
  me = makeUser({ manage: true });
  await renderInRouter(
    <DashboardPage search={parseDashboardSearch({})} onSearchChange={() => undefined} />,
  );
  await screen.findByRole('heading', { name: 'Serah Terima' });
  expect(screen.getByRole('button', { name: 'Bagikan' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Tautan dibagikan' })).toBeTruthy();
});

test('menekan Bagikan membuka dialog', async () => {
  me = makeUser({ manage: true });
  await renderInRouter(
    <DashboardPage search={parseDashboardSearch({})} onSearchChange={() => undefined} />,
  );
  await userEvent.click(await screen.findByRole('button', { name: 'Bagikan' }));
  expect(await screen.findByRole('alertdialog', { name: 'Bagikan dashboard' })).toBeTruthy();
});

test('simpan tanpa judul dan tanpa widget ditolak dengan pesan di tempat', async () => {
  me = makeUser({ manage: true });
  await renderInRouter(<DialogHarness />);
  await userEvent.click(await screen.findByRole('button', { name: 'Buat tautan' }));
  expect(await screen.findByText('Judul wajib diisi')).toBeTruthy();
  expect(screen.getByText('Pilih minimal satu widget')).toBeTruthy();
  expect(apiMock.mock.calls.some((call) => call[0] === 'dashboardShares.create')).toBe(false);
});

test('hanya widget yang boleh dilihat pengguna yang ditawarkan', async () => {
  me = makeUser({ manage: true });
  await renderInRouter(<DialogHarness />);
  await screen.findByRole('alertdialog', { name: 'Bagikan dashboard' });
  expect(widgetBox('hs.created')).toBeTruthy();
  expect(document.getElementById('share-widget-sn.recorded')).toBeNull();
  expect(document.getElementById('share-group-serial')).toBeNull();
});

test('widget berisi baris data memunculkan peringatan, widget angka tidak', async () => {
  me = makeUser({ manage: true });
  await renderInRouter(<DialogHarness />);
  await screen.findByRole('alertdialog', { name: 'Bagikan dashboard' });
  await userEvent.click(widgetBox('hs.created'));
  expect(screen.queryByText(/Baris data \(mis\. nama customer/)).toBeNull();
  await userEvent.click(widgetBox('hs.oldest'));
  expect(screen.getByText(/Baris data \(mis\. nama customer/)).toBeTruthy();
});

test('kirim: BU dan lokasi dari filter aktif, masa berlaku 30 hari, lalu tautan dapat disalin', async () => {
  me = makeUser({ manage: true, serial: true });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  await renderInRouter(<DialogHarness initial={{ bu: ['b1'], loc: ['l1'] }} />);
  await screen.findByRole('alertdialog', { name: 'Bagikan dashboard' });
  await userEvent.type(screen.getByLabelText(/Judul tautan/), 'Rekap');
  await userEvent.click(widgetBox('hs.created'));
  await userEvent.click(screen.getByRole('button', { name: 'Buat tautan' }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith(
      'dashboardShares.create',
      expect.objectContaining({
        title: 'Rekap',
        expiresInDays: 30,
        locationFiltered: true,
        filter: expect.objectContaining({ buIds: ['b1'], locationIds: ['l1'] }),
        widgets: [{ id: 'hs.created', filters: {} }],
        offers: [],
      }),
    ),
  );
  const url = (await screen.findByLabelText('Tautan')) as HTMLInputElement;
  expect(url.value).toBe(CREATED.url);
  await userEvent.click(screen.getByRole('button', { name: 'Salin tautan' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(CREATED.url));
});

test('butir 9: tanggal tertentu dikirim sebagai expiresOn (bukan expiresInDays)', async () => {
  me = makeUser({ manage: true });
  await renderInRouter(<DialogHarness />);
  await screen.findByRole('alertdialog', { name: 'Bagikan dashboard' });
  await userEvent.type(screen.getByLabelText(/Judul tautan/), 'Rekap');
  await userEvent.click(widgetBox('hs.created'));
  await pickSelect(screen, 'Masa berlaku', 'Tanggal tertentu');
  const date = new Date(Date.parse(`${today}T00:00:00.000Z`) + 10 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const input = (await screen.findByLabelText('Berlaku sampai tanggal')) as HTMLInputElement;
  expect(input.min).toBe(today);
  fireEvent.change(input, { target: { value: date } });
  await userEvent.click(screen.getByRole('button', { name: 'Buat tautan' }));
  await waitFor(() => {
    const call = apiMock.mock.calls.find((entry) => entry[0] === 'dashboardShares.create');
    expect(call).toBeTruthy();
    const sent = (call as unknown[])[1] as Record<string, unknown>;
    expect(sent.expiresOn).toBe(date);
    expect('expiresInDays' in sent).toBe(false);
  });
});

test('butir 9: tanggal tertentu kosong atau lewat dari 365 hari ditolak di tempat', async () => {
  me = makeUser({ manage: true });
  await renderInRouter(<DialogHarness />);
  await screen.findByRole('alertdialog', { name: 'Bagikan dashboard' });
  await userEvent.type(screen.getByLabelText(/Judul tautan/), 'Rekap');
  await userEvent.click(widgetBox('hs.created'));
  await pickSelect(screen, 'Masa berlaku', 'Tanggal tertentu');
  await userEvent.click(screen.getByRole('button', { name: 'Buat tautan' }));
  expect(
    await screen.findByText(/Pilih tanggal dari hari ini sampai 365 hari ke depan/),
  ).toBeTruthy();
  expect(apiMock.mock.calls.some((call) => call[0] === 'dashboardShares.create')).toBe(false);
});

test('butir 8: filter grup aktif di halaman menjadi filter awal widget grup itu saat dicentang', async () => {
  me = makeUser({ manage: true });
  const param = groupFilterParam('handover', 'customer');
  await renderInRouter(<DialogHarness initial={{ [param]: ['c1'] }} />);
  await screen.findByRole('alertdialog', { name: 'Bagikan dashboard' });
  await userEvent.type(screen.getByLabelText(/Judul tautan/), 'Rekap');
  await userEvent.click(widgetBox('hs.created'));
  await userEvent.click(screen.getByRole('button', { name: 'Buat tautan' }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith(
      'dashboardShares.create',
      expect.objectContaining({
        widgets: [{ id: 'hs.created', filters: { customer: ['c1'] } }],
      }),
    ),
  );
});

test('butir 8: tanpa filter grup aktif, widget dicentang tanpa filter', async () => {
  me = makeUser({ manage: true });
  await renderInRouter(<DialogHarness />);
  await screen.findByRole('alertdialog', { name: 'Bagikan dashboard' });
  await userEvent.type(screen.getByLabelText(/Judul tautan/), 'Rekap');
  await userEvent.click(widgetBox('hs.created'));
  await userEvent.click(screen.getByRole('button', { name: 'Buat tautan' }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith(
      'dashboardShares.create',
      expect.objectContaining({ widgets: [{ id: 'hs.created', filters: {} }] }),
    ),
  );
});

test('saklar "penonton boleh mempersempit" hanya untuk filter relasi yang terisi', async () => {
  me = makeUser({ manage: true });
  await renderInRouter(<DialogHarness />);
  await screen.findByRole('alertdialog', { name: 'Bagikan dashboard' });
  await userEvent.click(widgetBox('hs.created'));
  expect(screen.queryByRole('checkbox', { name: /Penonton boleh mempersempit/ })).toBeNull();
  await pickLink(screen, 'Customer', 'PT Satu');
  expect(
    await screen.findByRole('checkbox', { name: /Penonton boleh mempersempit customer/i }),
  ).toBeTruthy();
});
