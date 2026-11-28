import type {
  WarehouseHandoverCandidateDto,
  WarehouseHandoverContextDto,
  WarehouseOrderOptionDto,
  WarehouseSerialDto,
} from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
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

vi.mock('@/modules/markdown/wysiwyg-editor', () => ({
  WysiwygEditor: (props: { id: string; value: string; onChange: (v: string) => void }) => (
    <textarea
      id={props.id}
      aria-label="Isi catatan"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

import { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog';

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

const _order = (over: Partial<WarehouseOrderOptionDto> = {}): WarehouseOrderOptionDto => ({
  id: 'o1',
  number: 'SO-1',
  buId: 'bu2',
  buCode: 'B',
  customerId: 'c1',
  customerName: 'PT Maju',
  lastDispatchedOn: '2026-11-10',
  ...over,
});

function setup(rows: WarehouseDraftRow[], over: Partial<ConfirmDialogProps> = {}) {
  const props: ConfirmDialogProps = {
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
    onConfirm: vi.fn(),
    ...over,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConfirmDialog {...props} />
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

test('serial baru pada Item yang bukan milik BU tujuan ditolak di dialog', async () => {
  const props = setup([newRow('N1')], {
    item: whItem({ buIds: ['bu2'] }),
    formBuId: 'bu1',
  });
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
  await screen.findByLabelText('Nomor kardus awal');
  expect(screen.queryByText(/dicatat tanpa foto bukti/)).toBeNull();
});

test('serial baru tanpa lokasi: Lokasi dialog wajib dan dipakai; tidak ada isian tanggal uji', async () => {
  const props = setup(
    [makeNewRow({ serial: 'N1', itemId: 'item1', buId: '', locationId: '', testDate: '' })],
    { formBuId: 'bu1' },
  );
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
  await screen.findByLabelText('Nomor kardus awal');
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
  await screen.findByLabelText('Nomor kardus awal');
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
  await screen.findByLabelText('Nomor kardus awal');
  expect(screen.getByLabelText('BU')).toHaveValue('B - BU 2');
  expect(screen.getByLabelText('Lokasi')).toHaveValue('Gudang Utama');
});

test('data serial seragam menang atas chip BU dan Lokasi form; chip dipakai bila serial berbeda', async () => {
  setup([makeExistingRow(whSerial({ buId: 'bu2', locationId: 'loc2' }))], {
    formBuId: 'bu1',
    defaultLocationId: 'loc1',
  });
  await screen.findByLabelText('Nomor kardus awal');
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
  await screen.findByLabelText('Nomor kardus awal');
  expect(screen.getByLabelText('BU')).toHaveValue('B - BU 2');
  expect(screen.getByLabelText('Lokasi')).toHaveValue('Gudang QC');
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
    expect.objectContaining({ handoverIds: ['h9'], mode: 'note' }),
  );
});

test('konfirmasi kecocokan: task yang menyebut Item (ada baris hijau) langsung disimpan walau memuat baris Item lain', async () => {
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
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Apakah daftar permintaan item ini sudah sesuai?')).toBeNull();
});

test('konfirmasi kecocokan: cukup satu task hijau dari beberapa task terpilih untuk melewati dialog', async () => {
  candidatesMock.list = [
    candidate({ id: 'h9' }),
    candidate({
      id: 'h10',
      number: 'ST-2',
      mentionsItem: false,
      matchedLines: [],
      mismatchLines: ['Router lain 2 unit'],
    }),
  ];
  const props = setup([makeExistingRow(whSerial())], {
    handoverContext: handoverContext(),
    originHandoverId: 'h9',
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
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

test('Task asal yang tak ada di pemilih: tanda belum diperiksa, simpan tidak diblokir', async () => {
  const props = setup([makeExistingRow(whSerial())], {
    handoverContext: handoverContext(),
    originHandoverId: 'h9',
  });
  expect(await screen.findByText(/Task asal belum diperiksa kecocokannya/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
});

test('tanpa Tujuan, No SO, dan Customer; urutan field: Tanggal, BU, Lokasi, Kardus awal, Isi, Catatan, Link', async () => {
  setup([makeExistingRow(whSerial())], { item: whItem({ boxSize: 10 }) });
  await screen.findByLabelText('Nomor kardus awal');
  for (const label of ['Tujuan', 'No SO', 'Customer']) {
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
  }
  const fields = [
    screen.getByLabelText('Tanggal catat'),
    screen.getByLabelText('BU'),
    screen.getByLabelText('Lokasi'),
    screen.getByLabelText('Nomor kardus awal'),
    screen.getByLabelText('Isi per kardus'),
    screen.getByLabelText('Isi catatan'),
    screen.getByTestId('picker'),
  ];
  for (let index = 1; index < fields.length; index++) {
    expect(
      (fields[index - 1] as HTMLElement).compareDocumentPosition(fields[index] as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
});

test('simpan mengirim mode note dengan catatan Markdown, kardus awal 1, dan isi dari Item', async () => {
  const props = setup([makeExistingRow(whSerial())], { item: whItem({ boxSize: 10 }) });
  await userEvent.type(await screen.findByLabelText('Isi catatan'), '  halo ');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).toHaveBeenCalledTimes(1);
  expect(vi.mocked(props.onConfirm).mock.calls[0]?.[0]).toEqual({
    mode: 'note',
    dispatchedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    buId: 'bu1',
    note: 'halo',
    handoverIds: [],
    locationId: 'loc1',
    boxStart: 1,
    boxSize: 10,
  });
});

test('ringkasan perkiraan kardus dan Simpan terblokir bila isi per kardus kosong atau 0', async () => {
  const props = setup(manyRows(25), { item: whItem({ boxSize: 10 }) });
  expect(await screen.findByText('Kardus 1-3: 2 penuh, 1 ecer (5 unit)')).toBeInTheDocument();
  const size = screen.getByLabelText('Isi per kardus');
  await userEvent.clear(size);
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
  expect(await screen.findByText('Isi per kardus harus lebih dari 0')).toBeInTheDocument();
  await userEvent.type(size, '0');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
});

test('galat nomor kardus dari server tampil pada field nomor', async () => {
  setup(manyRows(3), {
    item: whItem({ boxSize: 10 }),
    boxStartError: 'Nomor kardus sudah dipakai',
  });
  expect(await screen.findByText('Nomor kardus sudah dipakai')).toBeInTheDocument();
});

test('BU wajib dipilih', async () => {
  const props = setup([newRow('N1')], { formBuId: '', item: whItem({ buIds: [], boxSize: 10 }) });
  await userEvent.click(await screen.findByRole('button', { name: 'Simpan & salin' }));
  expect(props.onConfirm).not.toHaveBeenCalled();
  expect(await screen.findByText('BU wajib dipilih')).toBeInTheDocument();
});
