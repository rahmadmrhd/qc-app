import type { MeDto, WarehouseOrderSummaryDto } from '@shared/contract';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { closeFilterChip, pickLink, pickSelect } from '@/test/link-field';
import { renderInRouter } from '@/test/render-in-router';
import { type OrdersSearchParams, ordersSearchSchema } from '../lib/orders-filter';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));

import { OrdersPage } from './orders-page';

const order = (over: Partial<WarehouseOrderSummaryDto>): WarehouseOrderSummaryDto => ({
  id: 'o1',
  number: 'SO-001',
  buId: 'b1',
  buCode: 'BU1',
  customerId: 'c1',
  customerName: 'PT Maju',
  dispatchCount: 2,
  serialCount: 40,
  lastDispatchedOn: '2026-11-20',
  hasPending: false,
  handoverCount: 1,
  createdAt: '2026-11-19T01:00:00.000Z',
  updatedAt: '2026-11-20T01:00:00.000Z',
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

const listCalls = () =>
  apiMock.mock.calls.filter((call) => call[0] === 'serialWarehouse.listOrders');
const lastInput = () => listCalls().at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  apiMock.mockReset();
  const perms = { item: 'none', serial: 'none', serialservice: 'none', serialwh: 'edit' } as const;
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
      serialservice: 'none',
      serialwh: 'none',
      countrylock: 'none',
      dashboard: 'none',
    },
    businessUnits: [
      { id: 'b1', code: 'BU1', name: 'Satu', status: 'active', permissions: perms },
      { id: 'b2', code: 'BU2', name: 'Dua', status: 'active', permissions: perms },
    ],
    locations: [],
  } as MeDto;
  apiMock.mockImplementation((id: string) => {
    if (id === 'serialWarehouse.listOrders') {
      return Promise.resolve({
        items: [
          order({}),
          order({
            id: 'o2',
            number: 'SO-002',
            hasPending: true,
            customerId: 'c2',
            customerName: 'CV Jaya',
          }),
        ],
        nextCursor: null,
      });
    }
    if (id === 'serialWarehouse.options') {
      return Promise.resolve({
        locations: [],
        customers: [
          { id: 'c1', name: 'PT Maju' },
          { id: 'c2', name: 'CV Jaya' },
        ],
        inactiveCustomerNames: [],
      });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

test('merender kolom dan tautan No SO ke detail; status Belum selesai', async () => {
  await renderInRouter(<Harness />);
  const link = await screen.findByRole('link', { name: 'SO-001' });
  expect(link).toHaveAttribute('href', '/serial/gudang/riwayat/o1');
  const rows = screen.getAllByRole('row');
  const second = rows[2] as HTMLElement;
  expect(within(second).getByText('Belum selesai')).toBeInTheDocument();
  expect(within(second).getByText('CV Jaya')).toBeInTheDocument();
  const first = rows[1] as HTMLElement;
  expect(within(first).getByText('Selesai')).toBeInTheDocument();
  expect(within(first).getByText('40')).toBeInTheDocument();
  for (const header of [
    'No SO',
    'BU',
    'Customer',
    'Pengeluaran',
    'Serial',
    'Terakhir',
    'Status',
    'Task',
  ]) {
    expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
  }
  expect(lastInput()).toEqual({});
});

test('filter status Belum selesai dikirim ke server', async () => {
  await renderInRouter(<Harness />);
  await screen.findByText('SO-001');
  await userEvent.click(screen.getByRole('button', { name: /^Status(:|$)/ }));
  await pickSelect(screen, 'Filter status', 'Belum selesai');
  await waitFor(() => expect(lastInput()).toEqual({ status: 'pending' }));
});

test('filter customer dan BU jamak dikirim sebagai daftar', async () => {
  await renderInRouter(<Harness />);
  await screen.findByText('SO-001');
  await userEvent.click(screen.getByRole('button', { name: /^Customer(:|$)/ }));
  await pickLink(screen, 'Filter customer', 'PT Maju');
  await pickLink(screen, 'Filter customer', 'CV Jaya');
  await closeFilterChip();
  await waitFor(() => expect(lastInput()).toEqual({ customerIds: ['c1', 'c2'] }));
  await userEvent.click(screen.getByRole('button', { name: /^BU(:|$)/ }));
  await pickLink(screen, 'Filter BU', /BU1/);
  await closeFilterChip();
  await waitFor(() => expect(lastInput()).toEqual({ customerIds: ['c1', 'c2'], buIds: ['b1'] }));
});

test('kosong tanpa filter: ajakan', async () => {
  apiMock.mockImplementation((id: string) =>
    id === 'serialWarehouse.listOrders'
      ? Promise.resolve({ items: [], nextCursor: null })
      : Promise.resolve({ locations: [], customers: [], inactiveCustomerNames: [] }),
  );
  await renderInRouter(<Harness />);
  expect(await screen.findByText('Belum ada Keluar Gudang yang tercatat.')).toBeInTheDocument();
});
