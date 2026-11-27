import type { MeDto, WarehouseOrderDto } from '@shared/contract';
import { screen, waitFor } from '@testing-library/react';
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

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { OrderDetailPage } from './order-detail-page';

const baseOrder = (over: Partial<WarehouseOrderDto> = {}): WarehouseOrderDto => ({
  id: 'o1',
  number: 'SO-001',
  buId: 'b1',
  buCode: 'BU1',
  customerId: 'c1',
  customerName: 'PT Maju',
  dispatchCount: 2,
  serialCount: 5,
  lastDispatchedOn: '2026-11-20',
  hasPending: true,
  handoverCount: 2,
  createdAt: '2026-11-19T01:00:00.000Z',
  updatedAt: '2026-11-20T01:00:00.000Z',
  createdBy: 'wh@x.com',
  canEdit: true,
  handovers: [
    {
      id: 'h1',
      number: 'ST-20261119-001',
      status: 'in_progress',
      customerName: 'PT Maju',
      createdAt: '2026-11-19T02:00:00.000Z',
      readable: true,
    },
    {
      id: 'h2',
      number: 'ST-20261119-002',
      status: 'done',
      customerName: 'PT Maju',
      createdAt: '2026-11-19T03:00:00.000Z',
      readable: false,
    },
  ],
  dispatches: [
    {
      id: 'd1',
      number: 'OUT/SPC/2611-0001',
      itemId: 'i1',
      itemLabel: 'Tenda AX300',
      dispatchedOn: '2026-11-20',
      note: 'Kirim cepat',
      mode: 'clipboard',
      status: 'done',
      serialTotal: 3,
      chunkCount: 1,
      chunksReceived: 1,
      createdCount: 1,
      createdBy: 'wh@x.com',
      createdAt: '2026-11-20T01:00:00.000Z',
      completedAt: '2026-11-20T01:00:05.000Z',
      cancelledAt: '',
    },
    {
      id: 'd2',
      number: 'OUT/SPC/2611-0002',
      itemId: 'i1',
      itemLabel: 'Tenda AX300',
      dispatchedOn: '2026-11-21',
      note: '',
      mode: 'clipboard',
      status: 'pending',
      serialTotal: 400,
      chunkCount: 2,
      chunksReceived: 1,
      createdCount: 0,
      createdBy: 'wh@x.com',
      createdAt: '2026-11-21T01:00:00.000Z',
      completedAt: '',
      cancelledAt: '',
    },
  ],
  ...over,
});

beforeEach(() => {
  apiMock.mockReset();
  copyMock.mockReset();
  draftIdMock.mockReset();
  draftIdMock.mockReturnValue(null);
  toastMock.success.mockReset();
  toastMock.error.mockReset();
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

const activityCalls: Record<string, unknown>[] = [];

function mockOrder(order: WarehouseOrderDto) {
  apiMock.mockImplementation((id: string, input: unknown) => {
    if (id === 'serialWarehouse.getOrder') return Promise.resolve(order);
    if (id === 'serialWarehouse.copyText') {
      return Promise.resolve({ text: 'A1\nA2\nA3', count: 3 });
    }
    if (id === 'serialWarehouse.handoverCandidates') {
      return Promise.resolve({ linked: [], items: [], nextCursor: null });
    }
    if (id === 'activity.list') {
      activityCalls.push(input as Record<string, unknown>);
      return Promise.resolve({
        hasMore: false,
        entries: [
          {
            id: 'a1',
            ts: '2026-11-20T01:00:05.000Z',
            actor: 'wh@x.com',
            action: 'serialwh.dispatch_done',
          },
        ],
        nextCursor: null,
      });
    }
    if (id === 'serialWarehouse.options') {
      return Promise.resolve({ locations: [], customers: [], inactiveCustomerNames: [] });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id} ${JSON.stringify(input)}`));
  });
}

test('task tak terbaca hanya nomor tanpa tautan; yang terbaca menaut ke task', async () => {
  mockOrder(baseOrder());
  await renderInRouter(<OrderDetailPage orderId="o1" />);
  const link = await screen.findByRole('link', { name: 'ST-20261119-001' });
  expect(link).toHaveAttribute('href', '/handover/h1');
  expect(screen.getByText('ST-20261119-002')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'ST-20261119-002' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Lepas task ST-20261119-002' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Lepas task ST-20261119-001' })).toBeInTheDocument();
});

test('Tautkan task dan Lepas hanya bagi pemegang edit', async () => {
  mockOrder(baseOrder({ canEdit: false }));
  await renderInRouter(<OrderDetailPage orderId="o1" />);
  await screen.findByText('ST-20261119-001');
  expect(screen.queryByRole('button', { name: 'Tautkan task' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Lepas task/ })).toBeNull();
});

test('Salin ulang hanya pada pengeluaran selesai dan menyalin teks dari server', async () => {
  copyMock.mockResolvedValue(true);
  mockOrder(baseOrder());
  await renderInRouter(<OrderDetailPage orderId="o1" />);
  await screen.findByText('Kirim cepat');
  const buttons = screen.getAllByRole('button', { name: 'Salin ulang' });
  expect(buttons).toHaveLength(1);
  await userEvent.click(buttons[0] as HTMLElement);
  await waitFor(() => expect(copyMock).toHaveBeenCalledTimes(1));
  const arg = copyMock.mock.calls[0]?.[0] as Promise<string>;
  await expect(arg).resolves.toBe('A1\nA2\nA3');
});

test('gagal menyalin: dialog Salin lagi memuat teksnya', async () => {
  copyMock.mockResolvedValue(false);
  mockOrder(baseOrder());
  await renderInRouter(<OrderDetailPage orderId="o1" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Salin ulang' }));
  const area = await screen.findByRole('textbox', { name: 'Daftar Serial Number' });
  expect(area).toHaveValue('A1\nA2\nA3');
});

test('pengeluaran pending tanpa draf di perangkat: penjelasan, tanpa Lanjutkan', async () => {
  mockOrder(baseOrder());
  await renderInRouter(<OrderDetailPage orderId="o1" />);
  expect(await screen.findByText(/1 dari 2 potongan terkirim/)).toBeInTheDocument();
  expect(screen.getByText(/dibatalkan otomatis setelah 7 hari/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Lanjutkan' })).toBeNull();
});

test('pengeluaran pending dengan draf yang cocok: tombol Lanjutkan', async () => {
  draftIdMock.mockReturnValue('d2');
  mockOrder(baseOrder());
  await renderInRouter(<OrderDetailPage orderId="o1" />);
  expect(await screen.findByRole('button', { name: 'Lanjutkan' })).toBeInTheDocument();
});

test('Lepas task mengirim daftar tanpa task itu dengan expectedUpdatedAt; 412 basi = pesan muat ulang', async () => {
  const order = baseOrder();
  mockOrder(order);
  const original = apiMock.getMockImplementation();
  apiMock.mockImplementation((id: string, input: unknown) => {
    if (id === 'serialWarehouse.setLinks') {
      return Promise.reject(new ApiError('CONFLICT', 'stale', 'r1', undefined, { status: 412 }));
    }
    return (original as (a: string, b: unknown) => Promise<unknown>)(id, input);
  });
  await renderInRouter(<OrderDetailPage orderId="o1" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Lepas task ST-20261119-001' }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith('serialWarehouse.setLinks', {
      id: 'o1',
      expectedUpdatedAt: '2026-11-20T01:00:00.000Z',
      handoverIds: [],
    }),
  );
  await waitFor(() =>
    expect(toastMock.error).toHaveBeenCalledWith(
      expect.stringMatching(/baru saja diubah orang lain/),
    ),
  );
});

test('catatan tak ditemukan: pesan dan tautan kembali', async () => {
  apiMock.mockRejectedValue(new ApiError('NOT_FOUND', 'x', 'r1'));
  await renderInRouter(<OrderDetailPage orderId="zzz" />);
  expect(await screen.findByText('Catatan SO tidak ditemukan')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Kembali ke Riwayat Gudang' })).toHaveAttribute(
    'href',
    '/serial/gudang/riwayat',
  );
});

test('panel samping memuat Log aktivitas catatan SO dengan label aksi', async () => {
  activityCalls.length = 0;
  mockOrder(baseOrder());
  await renderInRouter(<OrderDetailPage orderId="o1" />);
  expect(await screen.findByText('Penjualan Gudang selesai')).toBeInTheDocument();
  expect(activityCalls[0]).toMatchObject({ kind: 'warehouseOrder', id: 'o1' });
});
