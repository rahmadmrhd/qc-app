import type {
  MeDto,
  WarehouseDispatchDetailDto,
  WarehouseDispatchSerialDto,
} from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { renderInRouter } from '@/test/render-in-router';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

const copyMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/clipboard', () => ({ copyLines: copyMock }));

const draftIdMock = vi.hoisted(() => vi.fn());
vi.mock('../lib/draft-store', () => ({ draftDispatchId: draftIdMock }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { DispatchDetailPage } from './dispatch-detail-page';

const detail = (over: Partial<WarehouseDispatchDetailDto> = {}): WarehouseDispatchDetailDto => ({
  id: 'd1',
  number: 'OUT/BU1/2611-0001',
  kind: 'order',
  orderId: 'o1',
  orderNumber: 'SO-001',
  buId: 'b1',
  buCode: 'BU1',
  customerId: 'c1',
  customerName: 'PT Maju',
  itemId: 'i1',
  itemLabel: 'Tenda AX300',
  serialCount: 3,
  dispatchedOn: '2026-11-20',
  status: 'done',
  handovers: [
    {
      id: 'h1',
      number: 'ST-20261119-001',
      status: 'in_progress',
      customerName: 'PT Maju',
      createdAt: '2026-11-19T02:00:00.000Z',
      readable: true,
    },
  ],
  createdBy: 'wh@x.com',
  createdAt: '2026-11-20T01:00:00.000Z',
  note: 'Kirim cepat',
  completedAt: '2026-11-20T01:00:05.000Z',
  cancelledAt: '',
  chunkCount: 1,
  chunksReceived: 1,
  createdCount: 1,
  canEdit: true,
  ...over,
});

const activityCalls: Record<string, unknown>[] = [];
let serialItems: WarehouseDispatchSerialDto[] | null = null;

function mockDispatch(dispatch: WarehouseDispatchDetailDto) {
  apiMock.mockImplementation((id: string, input: unknown) => {
    if (id === 'serialWarehouse.dispatchGet') return Promise.resolve(dispatch);
    if (id === 'serialWarehouse.dispatchSerials') {
      return Promise.resolve({
        items: serialItems ?? [
          { seq: 1, serialId: 's1', serial: 'A1', createdNew: true, deleted: false },
          { seq: 2, serialId: 's2', serial: 'A2', createdNew: false, deleted: false },
          { seq: 3, serialId: 's3', serial: 'A3', createdNew: false, deleted: true },
        ],
        nextCursor: null,
      });
    }
    if (id === 'serialWarehouse.copyText') return Promise.resolve({ text: 'A1\nA2\nA3', count: 3 });
    if (id === 'activity.list') {
      activityCalls.push(input as Record<string, unknown>);
      return Promise.resolve({ hasMore: false, entries: [], nextCursor: null });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
}

beforeEach(() => {
  apiMock.mockReset();
  copyMock.mockReset();
  draftIdMock.mockReset();
  draftIdMock.mockReturnValue(null);
  activityCalls.length = 0;
  serialItems = null;
  me = {
    email: 'wh@x.com',
    name: 'WH',
    isSuperAdmin: false,
    sharedAccount: false,
    canManageSerialSettings: false,
    permissions: {},
    businessUnits: [],
    locations: [],
  } as unknown as MeDto;
});

test('Penjualan: ringkasan, No SO menaut ke detail SO, task tertaut, dan serial langsung tampil', async () => {
  mockDispatch(detail());
  await renderInRouter(<DispatchDetailPage dispatchId="d1" />);
  expect(await screen.findByText('A1')).toBeInTheDocument();
  expect(screen.getByText('A2')).toBeInTheDocument();
  expect(screen.getByText('Penjualan')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'SO-001' })).toHaveAttribute(
    'href',
    '/serial/gudang/riwayat/so/o1',
  );
  expect(screen.getByRole('link', { name: 'ST-20261119-001' })).toHaveAttribute(
    'href',
    '/handover/h1',
  );
  // Serial tidak dibungkus tombol lipat "Lihat Serial Number".
  expect(screen.queryByRole('button', { name: 'Lihat Serial Number' })).toBeNull();
  await waitFor(() => expect(activityCalls[0]).toMatchObject({ kind: 'warehouseOrder', id: 'o1' }));
});

test('Ready Stock: tanpa No SO, customer, dan task; log aktivitas memakai id pengeluaran', async () => {
  mockDispatch(
    detail({
      kind: 'ready',
      number: 'RS/BU1/2611-0001',
      orderId: '',
      orderNumber: '',
      customerId: '',
      customerName: '',
      handovers: [],
    }),
  );
  await renderInRouter(<DispatchDetailPage dispatchId="d1" />);
  expect(await screen.findByText('Ready Stock')).toBeInTheDocument();
  expect(screen.queryByText('No SO')).toBeNull();
  expect(screen.queryByText('Customer')).toBeNull();
  expect(screen.queryByText('Task Serah Terima')).toBeNull();
  await waitFor(() => expect(activityCalls[0]).toMatchObject({ kind: 'warehouseReady', id: 'd1' }));
});

test('Salin ulang adalah aksi halaman (hanya pengeluaran selesai) dan menyalin teks dari server', async () => {
  copyMock.mockResolvedValue(true);
  mockDispatch(detail());
  await renderInRouter(<DispatchDetailPage dispatchId="d1" />);
  const button = await screen.findByRole('button', { name: 'Salin ulang' });
  await userEvent.click(button);
  await waitFor(() => expect(copyMock).toHaveBeenCalledTimes(1));
  await expect(copyMock.mock.calls[0]?.[0] as Promise<string>).resolves.toBe('A1\nA2\nA3');
});

test('pengeluaran belum selesai: tanpa Salin ulang; Lanjutkan hanya bila draf cocok', async () => {
  mockDispatch(detail({ status: 'pending', chunkCount: 2, chunksReceived: 1 }));
  await renderInRouter(<DispatchDetailPage dispatchId="d1" />);
  expect(await screen.findByText(/1 dari 2 potongan terkirim/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Salin ulang' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Lanjutkan' })).toBeNull();
  expect(screen.getByText(/dibatalkan otomatis setelah 7 hari/)).toBeInTheDocument();
});

test('pengeluaran belum selesai dengan draf yang cocok: tombol Lanjutkan', async () => {
  draftIdMock.mockReturnValue('d1');
  mockDispatch(detail({ status: 'pending', chunkCount: 2, chunksReceived: 1 }));
  await renderInRouter(<DispatchDetailPage dispatchId="d1" />);
  expect(await screen.findByRole('button', { name: 'Lanjutkan' })).toBeInTheDocument();
});

test('serial terhapus ditandai Terhapus; yang dibuat saat keluar ditandai', async () => {
  mockDispatch(detail());
  await renderInRouter(<DispatchDetailPage dispatchId="d1" />);
  const row = (await screen.findByText('A3')).closest('tr') as HTMLElement;
  expect(within(row).getByText('Terhapus')).toBeInTheDocument();
  const first = screen.getByText('A1').closest('tr') as HTMLElement;
  expect(within(first).getByText('Dibuat saat keluar')).toBeInTheDocument();
});

test('pengeluaran tak ditemukan: pesan dan tautan kembali', async () => {
  apiMock.mockRejectedValue(new ApiError('NOT_FOUND', 'x', 'r1'));
  await renderInRouter(<DispatchDetailPage dispatchId="zzz" />);
  expect(await screen.findByText('Pengeluaran tidak ditemukan')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Kembali ke Riwayat Gudang' })).toHaveAttribute(
    'href',
    '/serial/gudang/riwayat',
  );
});

test('Penjualan tanpa No SO: strip tanpa tautan, customer dari pengeluaran, log memakai id pengeluaran', async () => {
  mockDispatch(detail({ orderId: '', orderNumber: '', handovers: [] }));
  await renderInRouter(<DispatchDetailPage dispatchId="d1" />);
  expect(await screen.findByText('A1')).toBeInTheDocument();
  expect(screen.getByText('No SO')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'SO-001' })).toBeNull();
  expect(document.querySelector('a[href^="/serial/gudang/riwayat/so/"]')).toBeNull();
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
  expect(
    screen.getByText(/Belum ada task Serah Terima tertaut pada pengeluaran ini/),
  ).toBeInTheDocument();
  await waitFor(() => expect(activityCalls[0]).toMatchObject({ kind: 'warehouseOrder', id: 'd1' }));
});

test('Ready Stock: serial tampil per kardus dengan isi/kapasitas dan nada selang-seling', async () => {
  serialItems = [
    {
      seq: 0,
      serialId: 's1',
      serial: 'R1',
      createdNew: false,
      deleted: false,
      boxId: 'b1',
      boxNumber: 7,
      capacity: 2,
      boxCount: 2,
    },
    {
      seq: 1,
      serialId: 's2',
      serial: 'R2',
      createdNew: false,
      deleted: false,
      boxId: 'b1',
      boxNumber: 7,
      capacity: 2,
      boxCount: 2,
    },
    {
      seq: 2,
      serialId: 's3',
      serial: 'R3',
      createdNew: false,
      deleted: false,
      boxId: 'b2',
      boxNumber: 8,
      capacity: 2,
      boxCount: 2,
    },
    {
      seq: 3,
      serialId: 's4',
      serial: 'R4',
      createdNew: false,
      deleted: false,
      boxId: 'b2',
      boxNumber: 8,
      capacity: 2,
      boxCount: 2,
    },
    {
      seq: 4,
      serialId: 's5',
      serial: 'R5',
      createdNew: true,
      deleted: false,
      boxId: 'b3',
      boxNumber: 9,
      capacity: 2,
      boxCount: 1,
    },
  ];
  mockDispatch(
    detail({
      kind: 'ready',
      orderId: '',
      orderNumber: '',
      customerId: '',
      customerName: '',
      handovers: [],
    }),
  );
  await renderInRouter(<DispatchDetailPage dispatchId="d1" />);
  expect(await screen.findByText('R1')).toBeInTheDocument();
  const tone = (serial: string) =>
    (screen.getByText(serial).closest('tr') as HTMLElement).getAttribute('data-box-tone');
  expect(['R1', 'R2', 'R3', 'R4', 'R5'].map(tone)).toEqual(['a', 'a', 'b', 'b', 'a']);
  const last = screen.getByText('R5').closest('tr') as HTMLElement;
  expect(within(last).getByText('9')).toBeInTheDocument();
  expect(within(last).getByText('1/2')).toBeInTheDocument();
  expect(within(last).getByText('Dibuat saat keluar')).toBeInTheDocument();
  expect(
    screen.getByRole('table', { name: 'Serial Number pencatatan per kardus' }),
  ).toBeInTheDocument();
});

test('Penjualan (tanpa info kardus) memakai tabel biasa tanpa kolom Kardus', async () => {
  mockDispatch(detail());
  await renderInRouter(<DispatchDetailPage dispatchId="d1" />);
  await screen.findByText('A1');
  expect(screen.queryByRole('columnheader', { name: 'Kardus' })).toBeNull();
});
