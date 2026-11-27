import type {
  WarehouseHandoverContextDto,
  WarehouseOrderOptionDto,
  WarehouseSerialDto,
} from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pickSelect } from '@/test/link-field';
import { mockMatchMedia } from '@/test/match-media';
import { makeExistingRow, makeNewRow } from '../lib/draft';
import type { WarehouseDraftRow } from '../lib/draft-store';
import { whItem, whSerial } from '../lib/test-support';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: apiMock,
}));

// Pemilih tautan (jalur E) diganti pengganti sederhana: yang diuji di sini hanya props yang diteruskan dialog.
vi.mock('./handover-link-picker', () => ({
  HandoverLinkPicker: (props: { value: string[]; lockedIds?: string[]; customerName?: string }) => (
    <div data-testid="picker">
      {props.value.join(',')}|{(props.lockedIds ?? []).join(',')}|{props.customerName ?? ''}
    </div>
  ),
}));

import { ConfirmDialog, type ConfirmDialogProps, type WarehousePurpose } from './confirm-dialog';

let media: ReturnType<typeof mockMatchMedia>;
let orders: WarehouseOrderOptionDto[] = [];
let inOrderIds: string[] = [];

beforeEach(() => {
  media = mockMatchMedia(true);
  orders = [];
  inOrderIds = [];
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serialWarehouse.orderOptions') {
      return Promise.resolve({ items: orders, nextCursor: null });
    }
    if (id === 'serialWarehouse.lookup') {
      const ids = (input.ids as string[]) ?? [];
      const found: WarehouseSerialDto[] = ids.map((serialId) =>
        whSerial({ id: serialId, serial: `S-${serialId}`, inOrder: inOrderIds.includes(serialId) }),
      );
      return Promise.resolve({ found });
    }
    return Promise.resolve({ items: [], linked: [], nextCursor: null });
  });
});

afterEach(() => {
  media.restore();
  apiMock.mockReset();
});

const order = (over: Partial<WarehouseOrderOptionDto> = {}): WarehouseOrderOptionDto => ({
  id: 'o1',
  number: 'SO-1',
  buId: 'bu2',
  buCode: 'B',
  customerId: 'c1',
  customerName: 'PT Maju',
  lastDispatchedOn: '2026-11-10',
  ...over,
});

function Host(props: Omit<ConfirmDialogProps, 'purpose' | 'onPurposeChange'>) {
  const [purpose, setPurpose] = useState<WarehousePurpose>('order');
  return <ConfirmDialog {...props} purpose={purpose} onPurposeChange={setPurpose} />;
}

function setup(
  rows: WarehouseDraftRow[],
  over: Partial<Omit<ConfirmDialogProps, 'purpose' | 'onPurposeChange'>> = {},
) {
  const props: Omit<ConfirmDialogProps, 'purpose' | 'onPurposeChange'> = {
    open: true,
    onOpenChange: vi.fn(),
    rows,
    item: whItem(),
    formBuId: 'bu1',
    buOptions: [
      { id: 'bu1', label: 'A - BU 1' },
      { id: 'bu2', label: 'B - BU 2' },
    ],
    options: {
      locations: [],
      customers: [{ id: 'c1', name: 'PT Maju' }],
      inactiveCustomerNames: [],
    },
    onRemoveRows: vi.fn(),
    onConfirm: vi.fn(),
    ...over,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Host {...props} />
    </QueryClientProvider>,
  );
  return props;
}

const newRow = (serial: string, testDate = '2026-11-20') =>
  makeNewRow({ serial, itemId: 'item1', buId: 'bu1', locationId: 'loc1', testDate });

test('No SO yang belum ada = SO baru (lencana), dibuat otomatis saat disimpan', async () => {
  setup([makeExistingRow(whSerial())]);
  await userEvent.type(await screen.findByLabelText('No SO'), 'SO-99');
  expect(await screen.findByText('SO baru')).toBeInTheDocument();
  expect(screen.getByText('Dibuat saat disimpan.')).toBeInTheDocument();
});

test('SO lama mengunci BU dan customer; BU baru dikirim hanya saat Simpan', async () => {
  orders = [order()];
  const props = setup([makeExistingRow(whSerial())]);
  await userEvent.type(await screen.findByLabelText('No SO'), 'so-1');
  expect(await screen.findByText('SO yang ada')).toBeInTheDocument();
  expect(screen.getByLabelText('Customer')).toBeDisabled();
  expect(screen.getByLabelText('Customer')).toHaveValue('PT Maju');
  expect(props.onConfirm).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledWith(expect.objectContaining({ buId: 'bu2' }));
});

test('serial baru pada Item yang bukan milik BU tujuan ditolak di dialog', async () => {
  const props = setup([newRow('N1')], {
    item: whItem({ buIds: ['bu2'] }),
    formBuId: 'bu1',
  });
  await userEvent.type(await screen.findByLabelText('No SO'), 'SO-7');
  await userEvent.type(screen.getByLabelText('Customer'), 'PT Baru');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
  expect(await screen.findByText(/Item ini bukan milik BU tersebut/)).toBeInTheDocument();
});

test('banner foto muncul hanya bila ada serial baru milik item wajib foto', async () => {
  setup([newRow('N1')], { item: whItem({ proofRequired: true, proofMin: 2 }) });
  expect(
    await screen.findByText(/Serial baru untuk item wajib foto dicatat tanpa foto bukti/),
  ).toBeInTheDocument();
});

test('tanpa serial baru tidak ada banner foto', async () => {
  setup([makeExistingRow(whSerial())], { item: whItem({ proofRequired: true }) });
  await screen.findByLabelText('No SO');
  expect(screen.queryByText(/dicatat tanpa foto bukti/)).toBeNull();
});

test('warning menampilkan jumlah serial: tanggal uji beda dan BU berbeda', async () => {
  setup([
    makeExistingRow(whSerial({ id: 'a', serial: 'A', testDate: '2026-11-20', buId: 'bu2' })),
    makeExistingRow(whSerial({ id: 'b', serial: 'B', testDate: '2026-11-20' })),
    makeExistingRow(whSerial({ id: 'c', serial: 'C', testDate: '2026-11-01' })),
  ]);
  expect(await screen.findByText(/1 serial punya tanggal uji yang berbeda/)).toBeInTheDocument();
  expect(screen.getByText(/1 serial ada di BU yang berbeda/)).toBeInTheDocument();
});

test('task asal tercentang dan terkunci, dengan info penautan ke SO yang ada', async () => {
  orders = [order({ buId: 'bu1' })];
  const context: WarehouseHandoverContextDto = {
    handover: {
      id: 'h1',
      number: 'ST-1',
      customerId: 'c1',
      customerName: 'PT Maju',
      status: 'in_progress',
    },
    orders: [],
    detected: [],
  };
  setup([makeExistingRow(whSerial())], { handoverContext: context, originHandoverId: 'h1' });
  expect(await screen.findByTestId('picker')).toHaveTextContent('h1|h1|PT Maju');
  await userEvent.type(screen.getByLabelText('No SO'), 'SO-1');
  expect(await screen.findByText(/SO ini akan ditautkan ke task ST-1/)).toBeInTheDocument();
});

test('serial yang sudah ada di SO menahan simpan dan dapat dikeluarkan dari pilihan', async () => {
  orders = [order({ buId: 'bu1' })];
  inOrderIds = ['dup1'];
  const props = setup([
    makeExistingRow(whSerial({ id: 'dup1', serial: 'D1' })),
    makeExistingRow(whSerial({ id: 'ok1', serial: 'O1' })),
  ]);
  await userEvent.type(await screen.findByLabelText('No SO'), 'SO-1');
  expect(await screen.findByText(/1 serial sudah ada di SO ini/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Keluarkan dari pilihan' }));
  expect(props.onRemoveRows).toHaveBeenCalledWith(['dup1']);
});

test('simpan mengirim nilai dan dipanggil sinkron dari klik', async () => {
  const props = setup([makeExistingRow(whSerial())]);
  await userEvent.type(await screen.findByLabelText('No SO'), ' SO-7 ');
  await userEvent.type(screen.getByLabelText('Customer'), 'PT Baru');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledWith(
    expect.objectContaining({ orderNumber: 'SO-7', customerName: 'PT Baru', buId: 'bu1' }),
  );
});

test('No SO atau customer kosong tidak dikirim', async () => {
  const props = setup([makeExistingRow(whSerial())]);
  await userEvent.click(await screen.findByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
  expect(await screen.findByText('No SO wajib diisi')).toBeInTheDocument();
});

test('tujuan bawaan Penjualan mengirim mode order dan field SO', async () => {
  const props = setup([makeExistingRow(whSerial())]);
  await userEvent.type(await screen.findByLabelText('No SO'), 'SO-7');
  await userEvent.type(screen.getByLabelText('Customer'), 'PT Baru');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledWith(
    expect.objectContaining({ mode: 'order', orderNumber: 'SO-7' }),
  );
});

test('Ready Stock menyembunyikan No SO, customer, dan tautan task; mengirim mode ready tanpa SO', async () => {
  const props = setup([makeExistingRow(whSerial())]);
  await userEvent.type(await screen.findByLabelText('Catatan'), '  stok ready ');
  await pickSelect(screen, 'Tujuan', 'Ready Stock');
  expect(screen.queryByLabelText('No SO')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Customer')).not.toBeInTheDocument();
  expect(screen.queryByTestId('picker')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
  const values = vi.mocked(props.onConfirm).mock.calls[0]?.[0];
  expect(values).toEqual({
    mode: 'ready',
    dispatchedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    orderNumber: '',
    buId: 'bu1',
    customerName: '',
    note: 'stok ready',
    handoverIds: [],
  });
});

test('Ready Stock: label Tanggal catat, tanpa peringatan SO, dengan keterangan serial Tercatat WH', async () => {
  setup([
    makeExistingRow(
      whSerial({ recorded: true, dispatches: [{ buCode: 'Z', dispatchedOn: '2026-11-10' }] }),
    ),
  ]);
  expect(await screen.findByLabelText('Tanggal keluar')).toBeInTheDocument();
  await pickSelect(screen, 'Tujuan', 'Ready Stock');
  expect(screen.getByLabelText('Tanggal catat')).toBeInTheDocument();
  expect(screen.queryByLabelText('Tanggal keluar')).not.toBeInTheDocument();
  expect(screen.queryByText(/pernah keluar/i)).not.toBeInTheDocument();
  expect(screen.getByText(/sudah Tercatat WH akan dilewati/)).toBeInTheDocument();
});

test('Ready Stock tetap mewajibkan BU', async () => {
  const props = setup([makeExistingRow(whSerial())], { formBuId: '' });
  await pickSelect(screen, 'Tujuan', 'Ready Stock');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
  expect(await screen.findByText('BU wajib dipilih')).toBeInTheDocument();
});
