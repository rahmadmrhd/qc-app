import type {
  WarehouseHandoverCandidateDto,
  WarehouseHandoverContextDto,
  WarehouseOrderOptionDto,
  WarehouseSerialDto,
} from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pickLink, pickSelect } from '@/test/link-field';
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
const candidatesMock = vi.hoisted(() => ({ list: [] as WarehouseHandoverCandidateDto[] }));
vi.mock('./handover-link-picker', () => ({
  HandoverLinkPicker: (props: {
    value: string[];
    lockedIds?: string[];
    customerName?: string;
    locationId?: string;
    registry?: { current: Map<string, WarehouseHandoverCandidateDto> };
  }) => {
    for (const entry of candidatesMock.list) props.registry?.current.set(entry.id, entry);
    return (
      <div data-testid="picker">
        {props.value.join(',')}|{(props.lockedIds ?? []).join(',')}|{props.customerName ?? ''}|
        {props.locationId ?? '-'}
      </div>
    );
  },
}));

import { ConfirmDialog, type ConfirmDialogProps, type WarehousePurpose } from './confirm-dialog';

let media: ReturnType<typeof mockMatchMedia>;
let orders: WarehouseOrderOptionDto[] = [];
let inOrderIds: string[] = [];
let maxBoxNumber: number | null = null;

beforeEach(() => {
  media = mockMatchMedia(true);
  orders = [];
  inOrderIds = [];
  maxBoxNumber = null;
  candidatesMock.list = [];
  apiMock.mockImplementation((id: string, input: Record<string, unknown>) => {
    if (id === 'serialWarehouse.orderOptions') {
      return Promise.resolve({ items: orders, nextCursor: null });
    }
    if (id === 'serialWarehouse.readyStock') {
      return Promise.resolve({
        boxes: [],
        nextCursor: null,
        totals: { units: 0, fullBoxes: 0, looseBoxes: 0, maxBoxNumber: maxBoxNumber ?? 0 },
      });
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
    locationOptions: [
      { id: 'loc1', label: 'Gudang QC' },
      { id: 'loc2', label: 'Gudang Utama' },
    ],
    defaultLocationId: '',
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

const candidate = (
  over: Partial<WarehouseHandoverCandidateDto> = {},
): WarehouseHandoverCandidateDto => ({
  id: 'h9',
  number: 'ST-9',
  createdAt: '2026-11-20T02:00:00.000Z',
  preview: '',
  status: 'in_progress',
  linked: false,
  mentionsItem: true,
  note: '- [ ] Tenda AX300 5 unit',
  checklist: [{ index: 0, text: 'Tenda AX300 5 unit', checked: false, by: '', at: '' }],
  matchedLines: ['Tenda AX300 5 unit'],
  mismatchLines: [],
  ...over,
});

const handoverContext = (): WarehouseHandoverContextDto => ({
  handover: { id: 'h9', number: 'ST-9', customerId: 'c1', customerName: 'PT Maju', status: 'new' },
  orders: [],
  sales: [],
  detected: [],
});

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
    sales: [],
    detected: [],
  };
  setup([makeExistingRow(whSerial())], { handoverContext: context, originHandoverId: 'h1' });
  expect(await screen.findByTestId('picker')).toHaveTextContent('h1|h1|PT Maju|');
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

test('No SO opsional: kosong = Penjualan tanpa SO, customer tidak wajib', async () => {
  const props = setup([makeExistingRow(whSerial())]);
  const field = await screen.findByLabelText('No SO');
  expect(field).not.toBeRequired();
  expect(screen.queryByText('No SO wajib diisi')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
  const values = vi.mocked(props.onConfirm).mock.calls[0]?.[0];
  expect(values).toMatchObject({ mode: 'order', orderNumber: '', customerName: '' });
  expect(values).not.toHaveProperty('orderId');
});

test('No SO terisi SO baru: customer wajib', async () => {
  const props = setup([makeExistingRow(whSerial())]);
  await userEvent.type(await screen.findByLabelText('No SO'), 'SO-77');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
  expect(await screen.findByText('Customer wajib diisi')).toBeInTheDocument();
});

test('urutan field Penjualan: Tujuan, Tanggal, No SO, BU, Lokasi, Customer, Tautan, Catatan', async () => {
  setup([makeExistingRow(whSerial())]);
  await screen.findByLabelText('No SO');
  const fields = ['Tujuan', 'Tanggal keluar', 'No SO', 'BU', 'Lokasi', 'Customer'].map((label) =>
    screen.getByLabelText(label),
  );
  fields.push(screen.getByTestId('picker'), screen.getByLabelText('Catatan'));
  for (let index = 1; index < fields.length; index++) {
    const previous = fields[index - 1] as HTMLElement;
    const current = fields[index] as HTMLElement;
    expect(
      previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
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
  const props = setup([makeExistingRow(whSerial())], { item: whItem({ boxSize: 10 }) });
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
    locationId: 'loc1',
    boxStart: 1,
    boxSize: 10,
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
  const props = setup([makeExistingRow(whSerial({ buId: 'bu9' }))], {
    formBuId: '',
    item: whItem({ buIds: ['bu1', 'bu2'] }),
  });
  await pickSelect(screen, 'Tujuan', 'Ready Stock');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
  expect(await screen.findByText('BU wajib dipilih')).toBeInTheDocument();
});

test('serial baru tanpa lokasi: Lokasi dialog wajib dan dipakai; tidak ada isian tanggal uji', async () => {
  const props = setup(
    [makeNewRow({ serial: 'N1', itemId: 'item1', buId: '', locationId: '', testDate: '' })],
    { formBuId: 'bu1' },
  );
  await userEvent.type(await screen.findByLabelText('No SO'), 'SO-7');
  await userEvent.type(screen.getByLabelText('Customer'), 'PT Baru');
  expect(screen.queryByLabelText('Tanggal uji serial baru')).toBeNull();
  expect(screen.queryByLabelText('Lokasi serial baru')).toBeNull();
  expect(screen.getByText('Dipakai juga untuk serial baru.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
  expect(await screen.findByText('Lokasi wajib dipilih')).toBeInTheDocument();
  await pickLink(screen, 'Lokasi', 'Gudang QC');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  const values = vi.mocked(props.onConfirm).mock.calls[0]?.[0];
  expect(values).toMatchObject({ locationId: 'loc1' });
  expect(values).not.toHaveProperty('newTestDate');
  expect(values).not.toHaveProperty('newLocationId');
});

test('serial baru yang sudah berlokasi: Lokasi dialog tetap wajib dan dipakai untuk semua serial baru', async () => {
  const props = setup([newRow('N2')], { defaultLocationId: '' });
  await screen.findByLabelText('No SO');
  expect(screen.getByText('Dipakai juga untuk serial baru.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
  expect(await screen.findByText('Lokasi wajib dipilih')).toBeInTheDocument();
});

test('BU dan Lokasi terisi dari serial yang sudah ada bila semuanya sama', async () => {
  const props = setup(
    [
      makeExistingRow(whSerial({ id: 'a', serial: 'A', buId: 'bu2', locationId: 'loc2' })),
      makeExistingRow(whSerial({ id: 'b', serial: 'B', buId: 'bu2', locationId: 'loc2' })),
    ],
    { formBuId: '' },
  );
  await screen.findByLabelText('No SO');
  expect(screen.getByLabelText('BU')).toHaveValue('B - BU 2');
  expect(screen.getByLabelText('Lokasi')).toHaveValue('Gudang Utama');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledWith(
    expect.objectContaining({ buId: 'bu2', locationId: 'loc2' }),
  );
});

test('BU dan Lokasi: serial berbeda jatuh ke BU Item tunggal dan lokasi aktif tunggal', async () => {
  const mixed = [
    makeExistingRow(whSerial({ id: 'a', serial: 'A', buId: 'bu1', locationId: 'loc1' })),
    makeExistingRow(whSerial({ id: 'b', serial: 'B', buId: 'bu2', locationId: 'loc2' })),
  ];
  setup(mixed, { formBuId: '', item: whItem({ buIds: ['bu2'] }), activeLocationIds: ['loc2'] });
  await screen.findByLabelText('No SO');
  expect(screen.getByLabelText('BU')).toHaveValue('B - BU 2');
  expect(screen.getByLabelText('Lokasi')).toHaveValue('Gudang Utama');
});

test('data serial seragam menang atas chip BU dan Lokasi form; chip dipakai bila serial berbeda', async () => {
  setup([makeExistingRow(whSerial({ buId: 'bu2', locationId: 'loc2' }))], {
    formBuId: 'bu1',
    defaultLocationId: 'loc1',
  });
  await screen.findByLabelText('No SO');
  expect(screen.getByLabelText('BU')).toHaveValue('B - BU 2');
  expect(screen.getByLabelText('Lokasi')).toHaveValue('Gudang Utama');
});

test('chip BU dan Lokasi form dipakai bila serial yang ada berbeda-beda', async () => {
  setup(
    [
      makeExistingRow(whSerial({ id: 'a', serial: 'A', buId: 'bu1', locationId: 'loc1' })),
      makeExistingRow(whSerial({ id: 'b', serial: 'B', buId: 'bu2', locationId: 'loc2' })),
    ],
    { formBuId: 'bu2', defaultLocationId: 'loc1' },
  );
  await screen.findByLabelText('No SO');
  expect(screen.getByLabelText('BU')).toHaveValue('B - BU 2');
  expect(screen.getByLabelText('Lokasi')).toHaveValue('Gudang QC');
});

test('SO yang ada mengisi Lokasi dari lokasi SO, dan Lokasi tetap dapat diubah', async () => {
  orders = [order({ buId: 'bu1', locationId: 'loc2' })];
  const props = setup([makeExistingRow(whSerial({ locationId: 'loc1' }))], {
    defaultLocationId: 'loc1',
  });
  await userEvent.type(await screen.findByLabelText('No SO'), 'SO-1');
  await waitFor(() => expect(screen.getByLabelText('Lokasi')).toHaveValue('Gudang Utama'));
  await pickLink(screen, 'Lokasi', 'Gudang QC');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledWith(
    expect.objectContaining({ orderId: 'o1', locationId: 'loc1' }),
  );
});

test('pemilih tautan menerima Lokasi dialog (kosong = terkunci)', async () => {
  setup([makeExistingRow(whSerial({ locationId: '' }))]);
  expect(await screen.findByTestId('picker')).toHaveTextContent(/\|-$|\|$/);
  await pickLink(screen, 'Lokasi', 'Gudang QC');
  await waitFor(() => expect(screen.getByTestId('picker')).toHaveTextContent('loc1'));
});

test('konfirmasi kecocokan: task yang tak menyebut Item menahan simpan sampai disetujui', async () => {
  candidatesMock.list = [
    candidate({
      mentionsItem: false,
      matchedLines: [],
      note: '- [ ] Router lain 2 unit',
      checklist: [{ index: 0, text: 'Router lain 2 unit', checked: false, by: '', at: '' }],
      mismatchLines: ['Router lain 2 unit'],
    }),
  ];
  const props = setup([makeExistingRow(whSerial())], {
    handoverContext: handoverContext(),
    originHandoverId: 'h9',
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Simpan & salin' }));
  expect(
    await screen.findByText('Apakah daftar permintaan item ini sudah sesuai?'),
  ).toBeInTheDocument();
  expect(screen.getByText('Catatan task ini tidak menyebut Item ini.')).toBeInTheDocument();
  expect(props.onConfirm).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Sesuai, lanjut simpan' }));
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
  expect(props.onConfirm).toHaveBeenCalledWith(
    expect.objectContaining({ handoverIds: ['h9'], mode: 'order' }),
  );
});

test('konfirmasi kecocokan: baris Item lain pada task yang menyebut Item juga memicu dialog', async () => {
  candidatesMock.list = [
    candidate({
      note: '- [ ] Tenda AX300 5 unit\n- [ ] Router lain 2 unit',
      checklist: [
        { index: 0, text: 'Tenda AX300 5 unit', checked: false, by: '', at: '' },
        { index: 1, text: 'Router lain 2 unit', checked: false, by: '', at: '' },
      ],
      mismatchLines: ['Router lain 2 unit'],
    }),
  ];
  const props = setup([makeExistingRow(whSerial())], {
    handoverContext: handoverContext(),
    originHandoverId: 'h9',
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Simpan & salin' }));
  expect(await screen.findByText(/Ada baris yang mungkin tidak cocok/)).toBeInTheDocument();
  expect(props.onConfirm).not.toHaveBeenCalled();
});

test('konfirmasi kecocokan: task yang cocok langsung disimpan tanpa dialog', async () => {
  candidatesMock.list = [candidate()];
  const props = setup([makeExistingRow(whSerial())], {
    handoverContext: handoverContext(),
    originHandoverId: 'h9',
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Apakah daftar permintaan item ini sudah sesuai?')).toBeNull();
});

test('konfirmasi kecocokan: task yang DTO-nya tak dikenal dilewati', async () => {
  const props = setup([makeExistingRow(whSerial())], {
    handoverContext: handoverContext(),
    originHandoverId: 'h9',
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
});

const manyRows = (n: number) =>
  Array.from({ length: n }, (_, i) => makeExistingRow(whSerial({ id: `s${i}`, serial: `SN${i}` })));

test('Ready Stock: nomor awal = kardus tertinggi + 1, isi bawaan dari Item, ringkasan perkiraan', async () => {
  maxBoxNumber = 11;
  setup(manyRows(25), { item: whItem({ boxSize: 10 }) });
  await pickSelect(screen, 'Tujuan', 'Ready Stock');
  expect(await screen.findByLabelText('Nomor kardus awal')).toHaveValue(12);
  expect(screen.getByLabelText('Isi per kardus')).toHaveValue(10);
  expect(await screen.findByText('Kardus 12-14: 2 penuh, 1 ecer (5 unit)')).toBeInTheDocument();
});

test('Ready Stock: Simpan terblokir bila isi per kardus kosong atau 0', async () => {
  const props = setup(manyRows(3), { item: whItem({ boxSize: 0 }) });
  await pickSelect(screen, 'Tujuan', 'Ready Stock');
  const size = await screen.findByLabelText('Isi per kardus');
  expect(size).toHaveValue(null);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
  expect(await screen.findByText('Isi per kardus harus lebih dari 0')).toBeInTheDocument();
  await userEvent.type(size, '0');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
});

test('Ready Stock: nilai kardus yang diubah ikut terkirim', async () => {
  maxBoxNumber = 4;
  const props = setup(manyRows(3), { item: whItem({ boxSize: 10 }) });
  await pickSelect(screen, 'Tujuan', 'Ready Stock');
  const start = await screen.findByLabelText('Nomor kardus awal');
  await waitFor(() => expect(start).toHaveValue(5));
  await userEvent.clear(start);
  await userEvent.type(start, '20');
  const size = screen.getByLabelText('Isi per kardus');
  await userEvent.clear(size);
  await userEvent.type(size, '2');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledWith(
    expect.objectContaining({ mode: 'ready', boxStart: 20, boxSize: 2 }),
  );
});

test('Ready Stock: galat "Nomor kardus sudah dipakai" dari server tampil pada field nomor', async () => {
  setup(manyRows(3), {
    item: whItem({ boxSize: 10 }),
    boxStartError: 'Nomor kardus sudah dipakai',
  });
  await pickSelect(screen, 'Tujuan', 'Ready Stock');
  expect(await screen.findByText('Nomor kardus sudah dipakai')).toBeInTheDocument();
});

test('mode Penjualan tidak menampilkan isian kardus dan tidak mengirimnya', async () => {
  const props = setup([makeExistingRow(whSerial())], { item: whItem({ boxSize: 10 }) });
  await userEvent.type(await screen.findByLabelText('No SO'), 'SO-5');
  await userEvent.type(screen.getByLabelText('Customer'), 'PT Baru');
  expect(screen.queryByLabelText('Nomor kardus awal')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Isi per kardus')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  const values = vi.mocked(props.onConfirm).mock.calls[0]?.[0];
  expect(values).not.toHaveProperty('boxStart');
  expect(values).not.toHaveProperty('boxSize');
});

test('Task asal yang tak ada di pemilih: tanda belum diperiksa, simpan tidak diblokir', async () => {
  const props = setup([makeExistingRow(whSerial())], {
    handoverContext: handoverContext(),
    originHandoverId: 'h9',
  });
  expect(await screen.findByText(/Task asal belum diperiksa kecocokannya/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
});

test('Penjualan tanpa No SO tertaut task tampil hanya-baca di dialog', async () => {
  const context: WarehouseHandoverContextDto = {
    ...handoverContext(),
    sales: [
      {
        dispatchId: 'd1',
        number: 'OUT/WH/2611-0001',
        label: 'Penjualan 2026-11-20 OUT/WH/2611-0001',
        dispatchedOn: '2026-11-20',
        status: 'done',
        buId: 'bu1',
        buCode: 'WH',
        orderId: '',
      },
    ],
  };
  setup([makeExistingRow(whSerial())], { handoverContext: context, historyLinkable: true });
  expect(await screen.findByText('OUT/WH/2611-0001')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'OUT/WH/2611-0001' })).toHaveAttribute(
    'href',
    '/serial/gudang/riwayat/d1',
  );
});
