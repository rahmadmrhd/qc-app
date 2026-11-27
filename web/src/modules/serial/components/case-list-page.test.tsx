import type { MeDto, SerialCaseRowDto } from '@shared/contract';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { closeFilterChip, pickLink, pickSelect } from '@/test/link-field';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { type CaseSearch, caseFilterOfSearch, caseSearchSchema } from '../lib/case-filter';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { CaseListPage } from './case-list-page';

const row = (over: Partial<SerialCaseRowDto>): SerialCaseRowDto => ({
  id: 'c1',
  number: 'LP/SBY/2611-0001',
  serialId: 's1',
  serial: 'ABC123',
  buId: 'b1',
  buCode: 'BU1',
  itemLabel: 'Cisco C9200',
  status: 'reported',
  custody: 'qc',
  openedOn: '2026-11-13',
  closedOn: null,
  outcome: null,
  daysInStatus: 3,
  locationName: 'Gudang A',
  durationDays: 3,
  reporter: 'budi@x.com',
  summary: 'Port 3 mati',
  ...over,
});

const PAGE_1 = [
  row({}),
  row({
    id: 'c2',
    number: 'LP/SBY/2611-0004',
    serialId: 's2',
    serial: 'XYZ789',
    status: 'at_service',
    daysInStatus: 0,
    summary: '',
  }),
];

function Harness({
  initial = {},
  onReport,
}: {
  initial?: Record<string, unknown>;
  onReport?: () => void;
}) {
  const [search, setSearch] = useState<CaseSearch>(caseSearchSchema.parse(initial));
  return (
    <CaseListPage
      search={search}
      onSearchChange={(patch) => setSearch((prev) => ({ ...prev, ...patch }))}
      onReport={onReport}
    />
  );
}

function renderPage(initial?: Record<string, unknown>, onReport?: () => void) {
  return renderInRouter(
    <Harness {...(initial ? { initial } : {})} {...(onReport ? { onReport } : {})} />,
  );
}

let media: ReturnType<typeof mockMatchMedia> | undefined;
afterEach(() => {
  media?.restore();
  media = undefined;
  window.innerWidth = 1024;
});

/** Membuka popover chip filter (nama tombol = label chip, dengan atau tanpa nilai terisi). */
async function openChip(label: string) {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}(:|$)`) }));
}

const listCalls = () => apiMock.mock.calls.filter((call) => call[0] === 'serialCases.list');
const lastInput = () => listCalls().at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  apiMock.mockReset();
  me = {
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
      serial: 'none',
      serialservice: 'view',
      serialwh: 'none',
      countrylock: 'none',
      dashboard: 'none',
    },
    businessUnits: [
      {
        id: 'b1',
        code: 'BU1',
        name: 'Satu',
        status: 'active',
        permissions: { item: 'none', serial: 'none', serialservice: 'view', serialwh: 'none' },
      },
      {
        id: 'b2',
        code: 'BU2',
        name: 'Dua',
        status: 'active',
        permissions: { item: 'none', serial: 'none', serialservice: 'view', serialwh: 'none' },
      },
    ],
    locations: [],
  };
  apiMock.mockImplementation((id: string, input: { cursor?: string }) => {
    if (id === 'serialCases.list') {
      return Promise.resolve(
        input.cursor
          ? {
              items: [row({ id: 'c3', number: 'LP/SBY/2611-0002', serial: 'LAST1' })],
              nextCursor: null,
            }
          : { items: PAGE_1, nextCursor: 'k1' },
      );
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

test('merender kolom laporan; filter bawaan = semua laporan (juga bagi tim servis murni)', async () => {
  await renderPage();
  expect(await screen.findByText('LP/SBY/2611-0001')).toBeInTheDocument();
  expect(lastInput()).toEqual({});
  const rows = screen.getAllByRole('row');
  const first = rows[1] as HTMLElement;
  expect(within(first).getByText('ABC123')).toBeInTheDocument();
  expect(within(first).getByText('Cisco C9200')).toBeInTheDocument();
  expect(within(first).getByText('BU1')).toBeInTheDocument();
  expect(within(first).getByText('Dilaporkan')).toBeInTheDocument();
  expect(within(first).getByText('3 hari di status ini')).toBeInTheDocument();
  expect(within(first).getByText('Gudang A')).toBeInTheDocument();
  expect(within(first).getByText('Di QC')).toBeInTheDocument();
  expect(within(first).getByText('budi@x.com')).toBeInTheDocument();
  expect(within(first).getByText('Port 3 mati')).toBeInTheDocument();
  const second = rows[2] as HTMLElement;
  expect(within(second).getByText('Di servis')).toBeInTheDocument();
  expect(within(second).getByText('0 hari di status ini')).toBeInTheDocument();
  expect(within(second).getByText('—')).toBeInTheDocument();
  for (const header of [
    'Nomor LP',
    'Serial Number',
    'Item',
    'BU',
    'Status',
    'Lokasi saat ini',
    'Durasi',
    'Pelapor',
    'Ringkasan',
  ]) {
    expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
  }
});

test('laporan tertutup menampilkan hasil, tanggal selesai, status sekarang, dan lama pengerjaan', async () => {
  apiMock.mockImplementation((id: string) =>
    id === 'serialCases.list'
      ? Promise.resolve({
          items: [
            row({
              id: 'c9',
              number: 'LP/SBY/2611-0009',
              closedOn: '2026-11-05',
              outcome: 'broken',
              status: 'broken',
              durationDays: 4,
              locationName: 'Gudang B',
            }),
          ],
          nextCursor: null,
        })
      : Promise.reject(new Error(`api tak dikenal: ${id}`)),
  );
  await renderPage();
  const line = (await screen.findByText('LP/SBY/2611-0009')).closest('tr') as HTMLElement;
  expect(within(line).getByText('Hasil: Rusak')).toBeInTheDocument();
  expect(within(line).getByText(/Selesai .* status sekarang Rusak/)).toBeInTheDocument();
  expect(within(line).getByText('Selesai dalam 4 hari')).toBeInTheDocument();
  expect(within(line).getByText('Gudang B')).toBeInTheDocument();
});

test('filter status dan BU menjadi parameter; Semua laporan tanpa status', async () => {
  await renderPage();
  await screen.findByText('LP/SBY/2611-0001');
  await openChip('Status');
  await pickSelect(screen, 'Filter status laporan', 'Laporan selesai');
  await waitFor(() => expect(lastInput()).toMatchObject({ status: 'closed' }));
  await openChip('Status');
  await pickSelect(screen, 'Filter status laporan', 'Semua laporan');
  await waitFor(() => expect(lastInput()).toEqual({}));
  await openChip('BU');
  await pickLink(screen, 'Filter BU', 'BU2 - Dua');
  // Mode banyak pilihan: pilihan kedua menambah draf; daftar baru diminta SEKALI saat chip menutup.
  await pickLink(screen, 'Filter BU', 'BU1 - Satu');
  expect(lastInput()).toEqual({});
  await closeFilterChip();
  await waitFor(() => expect(lastInput()).toEqual({ buIds: ['b2', 'b1'] }));
  await openChip('Status');
  await pickSelect(screen, 'Filter status laporan', 'Laporan aktif');
  await waitFor(() => expect(lastInput()).toEqual({ status: 'active', buIds: ['b2', 'b1'] }));
});

test('pencarian mengirim query awalan nomor LP atau serial setelah jeda', async () => {
  await renderPage();
  await screen.findByText('LP/SBY/2611-0001');
  fireEvent.change(screen.getByLabelText('Cari nomor LP atau Serial Number'), {
    target: { value: 'LP/SBY/2611' },
  });
  await waitFor(() => expect(lastInput()).toEqual({ query: 'LP/SBY/2611' }));
});

test('muat berikutnya memakai kursor server', async () => {
  await renderPage();
  await screen.findByText('LP/SBY/2611-0001');
  await userEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
  expect(await screen.findByText('LP/SBY/2611-0002')).toBeInTheDocument();
  expect(lastInput()).toMatchObject({ cursor: 'k1' });
  expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).toBeNull();
});

test('nomor LP adalah tautan ke halaman detail laporan itu', async () => {
  await renderPage();
  const link = await screen.findByRole('link', { name: 'LP/SBY/2611-0004' });
  expect(link).toHaveAttribute('href', '/serial/reports/c2');
  expect(link).toHaveAttribute('data-tour', 'case-open');
});

test('tombol Lapor Rusak ada di halaman Laporan bagi yang berhak menulis, dan menuju halaman lapor', async () => {
  const onReport = vi.fn();
  const { unmount } = await renderPage(undefined, onReport);
  const button = await screen.findByRole('button', { name: 'Lapor Rusak' });
  expect(button).toHaveAttribute('data-tour', 'case-report');
  await userEvent.click(button);
  expect(onReport).toHaveBeenCalledTimes(1);
  unmount();
  // Tanpa hak menulis (hanya baca atau tim servis): tombol tidak tampil.
  await renderPage();
  await screen.findByRole('link', { name: 'LP/SBY/2611-0004' });
  expect(screen.queryByRole('button', { name: 'Lapor Rusak' })).toBeNull();
});

test('tanpa pilihan massal: tidak ada checkbox; kolom cari tersedia', async () => {
  await renderPage();
  await screen.findByText('LP/SBY/2611-0001');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(
    screen.getByRole('searchbox', { name: 'Cari nomor LP atau Serial Number' }),
  ).toBeInTheDocument();
});

test('ponsel (360 px): kartu dengan nomor LP sebagai judul, status sebagai badge, meta berlabel', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  await renderPage();
  await screen.findByRole('link', { name: 'LP/SBY/2611-0001' });
  expect(screen.queryByRole('table')).toBeNull();
  const card = screen.getAllByRole('listitem')[0] as HTMLElement;
  expect(within(card).getByRole('link', { name: 'LP/SBY/2611-0001' })).toBeInTheDocument();
  expect(within(card).getByText('Dilaporkan')).toBeInTheDocument();
  expect(within(card).getByText('Cisco C9200')).toBeInTheDocument();
  expect(within(card).getByText('Pelapor')).toBeInTheDocument();
});

test('target panduan: case-filters dan case-table ada', async () => {
  await renderPage();
  await screen.findByText('LP/SBY/2611-0001');
  expect(document.querySelector('[data-tour="case-filters"]')).not.toBeNull();
  expect(document.querySelector('[data-tour="case-table"]')).not.toBeNull();
});

test('daftar kosong menampilkan teks santai; galat memuat tampil sebagai pesan', async () => {
  apiMock.mockImplementation(() => Promise.resolve({ items: [], nextCursor: null }));
  const { unmount } = await renderPage();
  expect(await screen.findByText(/Belum ada laporan di sini/)).toBeInTheDocument();
  unmount();
  apiMock.mockImplementation(() => Promise.reject(new Error('putus')));
  await renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat data');
});

test('search params tak sah dibuang; URL status=all dibaca; bu tunggal lama dibaca sebagai buIds', () => {
  expect(caseSearchSchema.parse({ status: 'zzz', bu: 5, buIds: 'x' })).toEqual({});
  // Bawaan = semua laporan (tanpa status); aktif/selesai hanya bila dipilih.
  expect(caseFilterOfSearch({ bu: 'b1' })).toEqual({ buIds: ['b1'] });
  expect(caseFilterOfSearch({ bu: 'b1', buIds: ['b2', 'b3'] })).toEqual({
    buIds: ['b2', 'b3'],
  });
  expect(caseFilterOfSearch({ status: 'active' })).toEqual({ status: 'active' });
  expect(caseFilterOfSearch({ status: 'closed' })).toEqual({ status: 'closed' });
  expect(caseSearchSchema.parse({ status: 'all' })).toEqual({ status: 'all' });
});

test('ponsel: mengetuk badan kartu laporan membuka View laporan itu; desktop: klik baris juga membuka View (C5/C13; K9 2026-11-23)', async () => {
  window.innerWidth = 360;
  media = mockMatchMedia(false);
  const { router, unmount } = await renderPage();
  await screen.findByRole('link', { name: 'LP/SBY/2611-0004' });
  const card = screen.getAllByRole('listitem')[1] as HTMLElement;
  await userEvent.click(within(card).getByText('Pelapor'));
  expect(router.state.location.pathname).toBe('/serial/reports/c2');
  unmount();
  media.set(true);
  window.innerWidth = 1024;
  const desktop = await renderPage();
  await screen.findByRole('table', { name: 'Daftar laporan rusak' });
  await userEvent.click(screen.getAllByText('Gudang A')[0] as HTMLElement);
  expect(desktop.router.state.location.pathname).toBe('/serial/reports/c1');
});
