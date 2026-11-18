import type { MeDto, SerialCaseRowDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { pickLink, pickSelect } from '@/test/link-field';
import { type CaseSearch, caseSearchSchema } from '../lib/case-filter';

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
  onOpen = () => undefined,
  initial = {},
  onReport,
}: {
  onOpen?: (serialId: string, caseId: string) => void;
  initial?: Record<string, unknown>;
  onReport?: () => void;
}) {
  const [search, setSearch] = useState<CaseSearch>(caseSearchSchema.parse(initial));
  return (
    <CaseListPage
      search={search}
      onSearchChange={(patch) => setSearch((prev) => ({ ...prev, ...patch }))}
      onOpen={onOpen}
      onReport={onReport}
    />
  );
}

function renderPage(
  onOpen?: (serialId: string, caseId: string) => void,
  initial?: Record<string, unknown>,
  onReport?: () => void,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness
        {...(onOpen ? { onOpen } : {})}
        {...(initial ? { initial } : {})}
        {...(onReport ? { onReport } : {})}
      />
    </QueryClientProvider>,
  );
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
      countrylock: 'none',
    },
    businessUnits: [
      {
        id: 'b1',
        code: 'BU1',
        name: 'Satu',
        status: 'active',
        permissions: { item: 'none', serial: 'none', serialservice: 'view' },
      },
      {
        id: 'b2',
        code: 'BU2',
        name: 'Dua',
        status: 'active',
        permissions: { item: 'none', serial: 'none', serialservice: 'view' },
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

test('merender kolom laporan; filter bawaan = aktif (juga bagi tim servis murni)', async () => {
  renderPage();
  expect(await screen.findByText('LP/SBY/2611-0001')).toBeInTheDocument();
  expect(lastInput()).toEqual({ status: 'active' });
  const rows = screen.getAllByRole('row');
  const first = rows[1] as HTMLElement;
  expect(within(first).getByText('ABC123')).toBeInTheDocument();
  expect(within(first).getByText('Cisco C9200')).toBeInTheDocument();
  expect(within(first).getByText('BU1')).toBeInTheDocument();
  expect(within(first).getByText('Dilaporkan')).toBeInTheDocument();
  expect(within(first).getByText('3 hari')).toBeInTheDocument();
  expect(within(first).getByText('Gudang A')).toBeInTheDocument();
  expect(within(first).getByText('Di QC')).toBeInTheDocument();
  expect(within(first).getByText('budi@x.com')).toBeInTheDocument();
  expect(within(first).getByText('Port 3 mati')).toBeInTheDocument();
  const second = rows[2] as HTMLElement;
  expect(within(second).getByText('Di servis')).toBeInTheDocument();
  expect(within(second).getByText('Hari ini')).toBeInTheDocument();
  expect(within(second).getByText('—')).toBeInTheDocument();
  for (const header of [
    'Nomor LP',
    'Serial Number',
    'Item',
    'BU',
    'Status',
    'Lokasi saat ini',
    'Lama',
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
  renderPage();
  const line = (await screen.findByText('LP/SBY/2611-0009')).closest('tr') as HTMLElement;
  expect(within(line).getByText('Hasil: Rusak')).toBeInTheDocument();
  expect(within(line).getByText(/Selesai .* status sekarang Rusak/)).toBeInTheDocument();
  expect(within(line).getByText('Selesai dalam 4 hari')).toBeInTheDocument();
  expect(within(line).getByText('Gudang B')).toBeInTheDocument();
});

test('filter status dan BU menjadi parameter; Semua laporan tanpa status', async () => {
  renderPage();
  await screen.findByText('LP/SBY/2611-0001');
  await pickSelect(screen, 'Filter status laporan', 'Laporan selesai');
  await waitFor(() => expect(lastInput()).toMatchObject({ status: 'closed' }));
  await pickSelect(screen, 'Filter status laporan', 'Semua laporan');
  await waitFor(() => expect(lastInput()).toEqual({}));
  await pickLink(screen, 'Filter BU', 'BU2 · Dua');
  await waitFor(() => expect(lastInput()).toEqual({ buId: 'b2' }));
  await pickSelect(screen, 'Filter status laporan', 'Laporan aktif');
  await waitFor(() => expect(lastInput()).toEqual({ status: 'active', buId: 'b2' }));
});

test('pencarian mengirim query awalan nomor LP atau serial setelah jeda', async () => {
  renderPage();
  await screen.findByText('LP/SBY/2611-0001');
  fireEvent.change(screen.getByLabelText('Cari nomor LP atau Serial Number'), {
    target: { value: 'LP/SBY/2611' },
  });
  await waitFor(() =>
    expect(lastInput()).toMatchObject({ status: 'active', query: 'LP/SBY/2611' }),
  );
});

test('muat berikutnya memakai kursor server', async () => {
  renderPage();
  await screen.findByText('LP/SBY/2611-0001');
  await userEvent.click(screen.getByRole('button', { name: 'Muat lebih banyak' }));
  expect(await screen.findByText('LP/SBY/2611-0002')).toBeInTheDocument();
  expect(lastInput()).toMatchObject({ cursor: 'k1' });
  expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).toBeNull();
});

test('klik nomor LP membuka detail serial pada tab laporan itu', async () => {
  const onOpen = vi.fn();
  renderPage(onOpen);
  await userEvent.click(await screen.findByRole('button', { name: 'LP/SBY/2611-0004' }));
  expect(onOpen).toHaveBeenCalledWith('s2', 'c2');
});

test('tombol Lapor Rusak ada di halaman Laporan bagi yang berhak menulis, dan menuju halaman lapor', async () => {
  const onReport = vi.fn();
  const { unmount } = renderPage(undefined, undefined, onReport);
  await userEvent.click(await screen.findByRole('button', { name: 'Lapor Rusak' }));
  expect(onReport).toHaveBeenCalledTimes(1);
  unmount();
  // Tanpa hak menulis (hanya baca atau tim servis): tombol tidak tampil.
  renderPage();
  await screen.findByRole('button', { name: 'LP/SBY/2611-0004' });
  expect(screen.queryByRole('button', { name: 'Lapor Rusak' })).toBeNull();
});

test('daftar kosong menampilkan teks santai; galat memuat tampil sebagai pesan', async () => {
  apiMock.mockImplementation(() => Promise.resolve({ items: [], nextCursor: null }));
  const { unmount } = renderPage();
  expect(await screen.findByText(/Belum ada laporan di sini/)).toBeInTheDocument();
  unmount();
  apiMock.mockImplementation(() => Promise.reject(new Error('putus')));
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent('Gagal memuat laporan');
});

test('search params tak sah dibuang; URL status=all dibaca', () => {
  expect(caseSearchSchema.parse({ status: 'zzz', bu: 5 })).toEqual({});
  expect(caseSearchSchema.parse({ status: 'all' })).toEqual({ status: 'all' });
});
