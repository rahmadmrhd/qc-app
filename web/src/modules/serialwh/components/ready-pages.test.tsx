import type { MeDto, WarehouseReadyDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { closeFilterChip, pickLink } from '@/test/link-field';
import { renderInRouter } from '@/test/render-in-router';
import { type OrdersSearchParams, ordersSearchSchema } from '../lib/orders-filter';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

const copyMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/clipboard', () => ({ copyLines: copyMock }));

const draftIdMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/draft-store', () => ({ draftDispatchId: draftIdMock }));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { OrdersPage } from './orders-page';
import { ReadyDetailPage } from './ready-detail-page';

const ready = (over: Partial<WarehouseReadyDto> = {}): WarehouseReadyDto => ({
  id: 'r1',
  itemId: 'i1',
  itemLabel: 'Tenda AX300',
  dispatchedOn: '2026-11-20',
  note: 'Target ready minggu ini',
  mode: 'clipboard',
  status: 'done',
  serialTotal: 12,
  chunkCount: 1,
  chunksReceived: 1,
  createdCount: 2,
  createdBy: 'wh@x.com',
  createdAt: '2026-11-20T01:00:00.000Z',
  completedAt: '2026-11-20T01:00:05.000Z',
  cancelledAt: '',
  buId: 'b1',
  buCode: 'BU1',
  buName: 'Satu',
  canEdit: true,
  ...over,
});

function Harness({ initial = {} }: { initial?: Record<string, unknown> }) {
  const [search, setSearch] = useState<OrdersSearchParams>(ordersSearchSchema.parse(initial));
  return (
    <OrdersPage
      search={search}
      onSearchChange={(patch) => setSearch((prev) => ({ ...prev, ...patch }))}
    />
  );
}

const readyCalls = () =>
  apiMock.mock.calls.filter((call) => call[0] === 'serialWarehouse.readyList');
const lastReadyInput = () => readyCalls().at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  apiMock.mockReset();
  copyMock.mockReset();
  draftIdMock.mockReset();
  draftIdMock.mockReturnValue(null);
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  const perms = { item: 'none', serial: 'none', serialservice: 'none', serialwh: 'edit' } as const;
  me = {
    email: 'wh@x.com',
    name: 'WH',
    isSuperAdmin: false,
    sharedAccount: false,
    canManageSerialSettings: false,
    permissions: { serialwh: 'none' },
    businessUnits: [
      { id: 'b1', code: 'BU1', name: 'Satu', status: 'active', permissions: perms },
      { id: 'b2', code: 'BU2', name: 'Dua', status: 'active', permissions: perms },
    ],
    locations: [],
  } as unknown as MeDto;
});

function mockList() {
  apiMock.mockImplementation((id: string) => {
    if (id === 'serialWarehouse.listOrders')
      return Promise.resolve({ items: [], nextCursor: null });
    if (id === 'serialWarehouse.options') {
      return Promise.resolve({ locations: [], customers: [], inactiveCustomerNames: [] });
    }
    if (id === 'serialWarehouse.readyList') {
      return Promise.resolve({
        items: [
          ready(),
          ready({ id: 'r2', status: 'pending', dispatchedOn: '2026-11-21', serialTotal: 400 }),
        ],
        nextCursor: null,
      });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
}

test('tab Ready menampilkan daftar tanpa kolom No SO dan Customer, tautan ke detail ready', async () => {
  mockList();
  await renderInRouter(<Harness />);
  await userEvent.click(await screen.findByRole('tab', { name: 'Ready' }));
  const link = await screen.findAllByRole('link', { name: /20 Nov 2026|2026/ });
  expect(link[0]).toHaveAttribute('href', '/serial/gudang/riwayat/ready/r1');
  for (const header of ['Tanggal', 'BU', 'Tipe', 'Serial', 'Pencatat', 'Status']) {
    expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
  }
  expect(screen.queryByRole('columnheader', { name: 'No SO' })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Customer' })).not.toBeInTheDocument();
  const rows = screen.getAllByRole('row');
  expect(within(rows[2] as HTMLElement).getByText('Belum selesai')).toBeInTheDocument();
  expect(within(rows[1] as HTMLElement).getByText('Selesai')).toBeInTheDocument();
  expect(lastReadyInput()).toEqual({});
  // Tidak ada kolom cari No SO di tab ini.
  expect(screen.queryByLabelText('Cari No SO')).not.toBeInTheDocument();
});

test('tab Ready: filter BU dan status dikirim ke readyList; kembali ke tab Keluar ke SO', async () => {
  mockList();
  await renderInRouter(<Harness initial={{ tab: 'ready' }} />);
  await screen.findByRole('columnheader', { name: 'Tipe' });
  await userEvent.click(screen.getByRole('button', { name: /^BU(:|$)/ }));
  await pickLink(screen, 'Filter BU', 'BU1 - Satu');
  await closeFilterChip();
  await waitFor(() => expect(lastReadyInput()).toEqual({ buIds: ['b1'] }));
  await userEvent.click(screen.getByRole('tab', { name: 'Keluar ke SO' }));
  expect(await screen.findByLabelText('Cari No SO')).toBeInTheDocument();
});

const listOrdersCalls = () =>
  apiMock.mock.calls.filter((call) => call[0] === 'serialWarehouse.listOrders');

test('pindah tab membersihkan param yang tak berlaku: status cancelled tidak ikut ke tab SO', async () => {
  mockList();
  await renderInRouter(<Harness initial={{ tab: 'ready', status: 'cancelled' }} />);
  await screen.findByRole('columnheader', { name: 'Tipe' });
  expect(lastReadyInput()).toEqual({ status: 'cancelled' });
  await userEvent.click(screen.getByRole('tab', { name: 'Keluar ke SO' }));
  await screen.findByLabelText('Cari No SO');
  await waitFor(() => expect(listOrdersCalls().length).toBeGreaterThan(0));
  expect(listOrdersCalls().at(-1)?.[1]).toEqual({});
});

test('pindah tab membersihkan pencarian SO dan customer agar tak tersembunyi di tab Ready', async () => {
  mockList();
  await renderInRouter(<Harness initial={{ q: 'SO-9', customerIds: ['c1'] }} />);
  await userEvent.click(await screen.findByRole('tab', { name: 'Ready' }));
  await screen.findByRole('columnheader', { name: 'Tipe' });
  expect(lastReadyInput()).toEqual({});
  await userEvent.click(screen.getByRole('tab', { name: 'Keluar ke SO' }));
  expect(await screen.findByLabelText('Cari No SO')).toHaveValue('');
  expect(listOrdersCalls().at(-1)?.[1]).toEqual({});
});

test('tab Ready kosong menampilkan keadaan kosong', async () => {
  apiMock.mockImplementation((id: string) =>
    id === 'serialWarehouse.readyList'
      ? Promise.resolve({ items: [], nextCursor: null })
      : Promise.resolve({ items: [], nextCursor: null, locations: [], customers: [] }),
  );
  await renderInRouter(<Harness initial={{ tab: 'ready' }} />);
  expect(await screen.findByText('Belum ada pencatatan ready.')).toBeInTheDocument();
});

function mockDetail(dto: WarehouseReadyDto | ApiError) {
  apiMock.mockImplementation((id: string) => {
    if (id === 'serialWarehouse.ready') {
      return dto instanceof ApiError ? Promise.reject(dto) : Promise.resolve(dto);
    }
    if (id === 'serialWarehouse.dispatchSerials') {
      return Promise.resolve({
        items: [{ seq: 1, serialId: 's1', serial: 'AA11', createdNew: true, deleted: false }],
        nextCursor: null,
      });
    }
    if (id === 'serialWarehouse.copyText') return Promise.resolve({ text: 'AA11\nAA12', count: 2 });
    if (id === 'activity.list') {
      return Promise.resolve({
        hasMore: false,
        entries: [
          {
            id: 'a1',
            ts: '2026-11-20T01:00:05.000Z',
            actor: 'wh@x.com',
            action: 'serialwh.ready_done',
          },
        ],
        nextCursor: null,
      });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
}

test('detail ready: ringkasan tanpa SO/customer/task, Log aktivitas warehouseReady, label aksi', async () => {
  mockDetail(ready());
  await renderInRouter(<ReadyDetailPage readyId="r1" />);
  expect(await screen.findByText('Catat ready (tanpa SO)')).toBeInTheDocument();
  expect(screen.getByText('BU1 - Satu')).toBeInTheDocument();
  expect(screen.getByText('Tenda AX300')).toBeInTheDocument();
  expect(screen.queryByText('Task Serah Terima')).not.toBeInTheDocument();
  expect(screen.queryByText('Customer')).not.toBeInTheDocument();
  expect(screen.queryByText('No SO')).not.toBeInTheDocument();
  expect(await screen.findByText('Ready Gudang selesai')).toBeInTheDocument();
  const activity = apiMock.mock.calls.find((call) => call[0] === 'activity.list');
  expect(activity?.[1]).toMatchObject({ kind: 'warehouseReady', id: 'r1' });
});

test('detail ready: daftar Serial Number dan Salin ulang memakai copyText', async () => {
  mockDetail(ready());
  copyMock.mockResolvedValue(true);
  await renderInRouter(<ReadyDetailPage readyId="r1" />);
  await userEvent.click(await screen.findByRole('button', { name: /Lihat Serial Number/ }));
  expect(await screen.findByText('AA11')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Salin ulang/ }));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('2 Serial Number disalin'));
  expect(
    apiMock.mock.calls.some(
      (call) => call[0] === 'serialWarehouse.copyText' && (call[1] as { id: string }).id === 'r1',
    ),
  ).toBe(true);
});

test('detail ready yang tak ada atau di luar hak = tidak ditemukan', async () => {
  mockDetail(new ApiError('NOT_FOUND', 'Tidak ditemukan', '-'));
  await renderInRouter(<ReadyDetailPage readyId="x" />);
  expect(await screen.findByText('Catatan ready tidak ditemukan')).toBeInTheDocument();
});
