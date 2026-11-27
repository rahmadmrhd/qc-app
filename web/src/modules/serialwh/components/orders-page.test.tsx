import type { MeDto, WarehouseDispatchListItemDto } from '@shared/contract';
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

const dispatch = (over: Partial<WarehouseDispatchListItemDto>): WarehouseDispatchListItemDto => ({
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
  serialCount: 40,
  dispatchedOn: '2026-11-20',
  status: 'done',
  handovers: [
    {
      id: 'h1',
      number: 'ST-20261119-001',
      status: 'done',
      customerName: 'PT Maju',
      createdAt: '2026-11-19T01:00:00.000Z',
      readable: true,
    },
  ],
  createdBy: 'wh@x.com',
  createdAt: '2026-11-20T01:00:00.000Z',
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
  apiMock.mock.calls.filter((call) => call[0] === 'serialWarehouse.dispatchList');
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
    if (id === 'serialWarehouse.dispatchList') {
      return Promise.resolve({
        items: [
          dispatch({}),
          dispatch({
            id: 'd2',
            number: 'RS/BU1/2611-0001',
            kind: 'ready',
            orderId: '',
            orderNumber: '',
            customerId: '',
            customerName: '',
            status: 'pending',
            handovers: [],
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
    if (id === 'serialWarehouse.itemOptions') {
      return Promise.resolve({
        items: [
          {
            id: 'i1',
            label: 'Tenda AX300',
            brandName: 'Tenda',
            model: 'AX300',
            buIds: ['b1'],
            proofRequired: false,
            proofMin: 0,
          },
          {
            id: 'i2',
            label: 'Tenda SG8',
            brandName: 'Tenda',
            model: 'SG8',
            buIds: ['b1'],
            proofRequired: false,
            proofMin: 0,
          },
        ],
        nextCursor: null,
      });
    }
    return Promise.reject(new Error(`api tak dikenal: ${id}`));
  });
});

test('satu baris per pengeluaran: No Riwayat menaut ke detail pengeluaran, No SO ke detail SO', async () => {
  await renderInRouter(<Harness />);
  const link = await screen.findByRole('link', { name: 'OUT/BU1/2611-0001' });
  expect(link).toHaveAttribute('href', '/serial/gudang/riwayat/d1');
  expect(screen.getByRole('link', { name: 'SO-001' })).toHaveAttribute(
    'href',
    '/serial/gudang/riwayat/so/o1',
  );
  expect(screen.getByRole('link', { name: 'ST-20261119-001' })).toHaveAttribute(
    'href',
    '/handover/h1',
  );
  const rows = screen.getAllByRole('row');
  const first = rows[1] as HTMLElement;
  expect(within(first).getByText('Selesai')).toBeInTheDocument();
  expect(within(first).getByText('Tenda AX300')).toBeInTheDocument();
  expect(within(first).getByText('40')).toBeInTheDocument();
  const ready = rows[2] as HTMLElement;
  expect(within(ready).getByText('RS/BU1/2611-0001')).toBeInTheDocument();
  expect(within(ready).getByText('Belum selesai')).toBeInTheDocument();
  expect(within(ready).queryByRole('link', { name: /SO-/ })).not.toBeInTheDocument();
  for (const header of [
    'No Riwayat',
    'No SO',
    'BU',
    'Customer',
    'Tipe',
    'Serial',
    'Tanggal',
    'Task Serah Terima',
    'Status',
  ]) {
    expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
  }
  expect(lastInput()).toEqual({});
});

test('tombol Catat Serial WH membuka form bagi pemegang serialwh: edit', async () => {
  const { router } = await renderInRouter(<Harness />);
  await screen.findByText('OUT/BU1/2611-0001');
  await userEvent.click(screen.getByRole('button', { name: 'Catat Serial WH' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/serial/gudang'));
});

test('filter Jenis Ready Stock dikirim ke server', async () => {
  await renderInRouter(<Harness />);
  await screen.findByText('OUT/BU1/2611-0001');
  await userEvent.click(screen.getByRole('button', { name: /^Jenis(:|$)/ }));
  await pickSelect(screen, 'Filter jenis', 'Ready Stock');
  await waitFor(() => expect(lastInput()).toEqual({ kind: 'ready' }));
});

test('filter status Belum selesai dikirim ke server', async () => {
  await renderInRouter(<Harness />);
  await screen.findByText('OUT/BU1/2611-0001');
  await userEvent.click(screen.getByRole('button', { name: /^Status(:|$)/ }));
  await pickSelect(screen, 'Filter status', 'Belum selesai');
  await waitFor(() => expect(lastInput()).toEqual({ status: 'pending' }));
});

test('filter customer dan BU jamak dikirim sebagai daftar', async () => {
  await renderInRouter(<Harness />);
  await screen.findByText('OUT/BU1/2611-0001');
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

test('filter Tipe jamak dikirim sebagai daftar itemIds', async () => {
  await renderInRouter(<Harness />);
  await screen.findByText('OUT/BU1/2611-0001');
  await userEvent.click(screen.getByRole('button', { name: /^Tipe(:|$)/ }));
  await pickLink(screen, 'Filter Tipe', 'Tenda AX300');
  await pickLink(screen, 'Filter Tipe', 'Tenda SG8');
  await closeFilterChip();
  await waitFor(() => expect(lastInput()).toEqual({ itemIds: ['i1', 'i2'] }));
});

test('tombol Catat Serial WH berwarna primary (solid)', async () => {
  await renderInRouter(<Harness />);
  await screen.findByText('OUT/BU1/2611-0001');
  const button = screen.getByRole('button', { name: 'Catat Serial WH' });
  expect(button).toHaveAttribute('data-color', 'primary');
  expect(button).toHaveAttribute('data-variant', 'solid');
});

test('kosong tanpa filter: ajakan', async () => {
  apiMock.mockImplementation((id: string) =>
    id === 'serialWarehouse.dispatchList' || id === 'serialWarehouse.itemOptions'
      ? Promise.resolve({ items: [], nextCursor: null })
      : Promise.resolve({ locations: [], customers: [], inactiveCustomerNames: [] }),
  );
  await renderInRouter(<Harness />);
  expect(await screen.findByText('Belum ada pencatatan Gudang.')).toBeInTheDocument();
});
