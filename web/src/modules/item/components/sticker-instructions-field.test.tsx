import type { StickerDto, StickerTypeDto } from '@shared/contract';
import { INSTRUCTION_LIMITS } from '@shared/stickers';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

// Dialog berkas sudah diuji sendiri: di sini cukup tiruan yang menyerahkan pilihan tetap.
const dialogState = vi.hoisted(() => ({
  items: [] as unknown[],
  props: undefined as undefined | Record<string, unknown>,
}));
vi.mock('@/components/file-dialog', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/file-dialog')>();
  return {
    ...original,
    FileDialog: (props: {
      open: boolean;
      onSelect: (items: unknown[]) => void;
      onOpenChange: (open: boolean) => void;
    }) => {
      dialogState.props = props as unknown as Record<string, unknown>;
      return props.open ? (
        <div role="dialog" aria-label="Dialog berkas tiruan">
          <button
            type="button"
            onClick={() => {
              props.onSelect(dialogState.items);
              props.onOpenChange(false);
            }}
          >
            Pilih contoh
          </button>
        </div>
      ) : null;
    },
  };
});

import type { ItemFormInput } from '../schemas';
import {
  StickerInstructionsField,
  type StickerInstructionsFieldProps,
} from './sticker-instructions-field';

type Photos = ItemFormInput['stickerPhotos'];

const stickers: StickerDto[] = [
  {
    id: 's1',
    typeId: 't1',
    typeName: 'Postel',
    name: 'Stiker Postel',
    alias: '',
    fileId: null,
    minQty: 0,
    status: 'active',
    businessUnitIds: [],
    low: false,
    updatedAt: '',
  },
  {
    id: 's2',
    typeId: 't1',
    typeName: 'Postel',
    name: 'Postel Lama',
    alias: '',
    fileId: null,
    minQty: 0,
    status: 'inactive',
    businessUnitIds: [],
    low: false,
    updatedAt: '',
  },
];
const types: StickerTypeDto[] = [
  {
    id: 't1',
    name: 'Postel',
    rule: 'bu',
    status: 'active',
    stickerCount: 2,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: '',
  },
];
const STICKER_PLAIN = stickers[0] as StickerDto;
const TYPE_PLAIN = types[0] as StickerTypeDto;
const businessUnits = [
  { id: 'bu-a', label: 'Retail (RTL)' },
  { id: 'bu-b', label: 'Wholesale (WHL)' },
];

const mark = (patch: Record<string, unknown> = {}) => ({
  x: 100,
  y: 200,
  target: { kind: 'sticker' as const, stickerId: 's1' },
  note: '',
  ...patch,
});
const photo = (guideId: string, patch: Record<string, unknown> = {}) => ({
  guideId,
  caption: '',
  buId: null,
  marks: [] as ReturnType<typeof mark>[],
  ...patch,
});
const libraryItem = (id: string, usageCount = 0) => ({
  id,
  name: `Gambar ${id}`,
  size: 1,
  width: 800,
  height: 600,
  uploadedBy: 'a@x.com',
  createdAt: '',
  usageCount,
  canRename: false,
  canRemove: false,
  thumbUrl: `/t/${id}`,
  previewUrl: `/p/${id}`,
});

let latest: Photos = [];

function Harness({
  initial = [],
  ...props
}: { initial?: Photos } & Partial<StickerInstructionsFieldProps>) {
  const [value, setValue] = useState<Photos>(initial);
  latest = value;
  return (
    <StickerInstructionsField
      value={value}
      onChange={setValue}
      businessUnits={businessUnits}
      stickers={stickers}
      types={types}
      knownGuides={[
        { id: 'g1', name: 'Belakang', width: 800, height: 600 },
        { id: 'g2', name: 'Samping', width: 400, height: 400 },
      ]}
      {...props}
    />
  );
}

function renderField(props: { initial?: Photos } & Partial<StickerInstructionsFieldProps> = {}) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  dialogState.items = [];
  latest = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function addPhotosFromDialog(items: unknown[]) {
  dialogState.items = items;
  await userEvent.click(screen.getByRole('button', { name: 'Tambah foto' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Pilih contoh' }));
}

test('tanpa foto: pesan kosong dan tombol Tambah foto', () => {
  renderField();
  expect(screen.getByText('Belum ada foto instruksi.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tambah foto' })).toBeEnabled();
});

test('Tambah foto membuka dialog berkas (mode banyak, gambar); pilihan menambah kartu foto tanpa penanda', async () => {
  renderField();
  await addPhotosFromDialog([libraryItem('g1'), libraryItem('g2')]);
  expect(latest).toEqual([photo('g1'), photo('g2')]);
  expect(screen.getByRole('group', { name: 'Foto instruksi 1' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Foto instruksi 2' })).toBeInTheDocument();
  expect(dialogState.props).toMatchObject({ mode: 'multiple', accept: ['image'] });
  // gambar penuh dari pembaca pustaka
  const first = screen.getByRole('group', { name: 'Foto instruksi 1' });
  expect(first.querySelector('img')?.getAttribute('src')).toBe('/api/v1/files/g1');
  expect(apiMock).not.toHaveBeenCalled();
});

test('pada batas 10 foto tombol Tambah foto dinonaktifkan', () => {
  const ten = Array.from({ length: 9 }, (_, i) => photo(`x${i}`));
  renderField({ initial: [...ten, photo('g1')] });
  expect(screen.getByRole('button', { name: 'Tambah foto' })).toBeDisabled();
  expect(latest).toHaveLength(INSTRUCTION_LIMITS.photos);
});

test('pilihan melebihi sisa kuota hanya menambah yang muat dan menampilkan pemberitahuan', async () => {
  const eight = Array.from({ length: 8 }, (_, i) => photo(`x${i}`));
  renderField({ initial: eight });
  await addPhotosFromDialog([libraryItem('g1'), libraryItem('g2'), libraryItem('g3')]);
  expect(latest.map((p) => p.guideId)).toEqual([...eight.map((p) => p.guideId), 'g1', 'g2']);
  expect(screen.getByRole('status')).toHaveTextContent('1 gambar tidak ditambahkan');
});

test('gambar kembar dilewati dengan pemberitahuan', async () => {
  renderField({ initial: [photo('g1')] });
  await addPhotosFromDialog([libraryItem('g1'), libraryItem('g2')]);
  expect(latest.map((p) => p.guideId)).toEqual(['g1', 'g2']);
  expect(screen.getByRole('status')).toHaveTextContent('1 gambar tidak ditambahkan');
});

test('foto tanpa pemakai langsung ditambahkan; foto yang dipakai item lain menawarkan salin penanda', async () => {
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'stickerGuides.usages')
      return [{ itemId: 'i1', label: 'Mikrotik hAP', status: 'active' }];
    return {
      id: 'i1',
      stickerPhotos: [
        {
          guideId: 'g1',
          guideName: 'Belakang',
          width: 800,
          height: 600,
          caption: 'Catatan sumber',
          buId: null,
          marks: [
            {
              ...mark({ x: 10, y: 20, note: 'Pojok' }),
              targetName: 'S',
              resolved: [],
              unresolved: false,
            },
          ],
        },
      ],
    };
  });
  renderField();
  await addPhotosFromDialog([libraryItem('g1', 2)]);
  const dialog = await screen.findByRole('dialog', { name: /Salin penanda/ });
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Salin penanda dari Mikrotik hAP' }),
  );
  await waitFor(() => expect(latest[0]?.marks).toHaveLength(1));
  expect(latest[0]).toEqual({
    guideId: 'g1',
    caption: '', // catatan foto tidak ikut
    buId: null,
    marks: [{ x: 10, y: 20, target: { kind: 'sticker', stickerId: 's1' }, note: 'Pojok' }],
  });
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: /Salin penanda/ })).not.toBeInTheDocument(),
  );
  // mengubah penanda hasil salinan tidak mengubah sumber (data sumber dari cache/permintaan terpisah)
  expect(screen.getByRole('textbox', { name: 'Catatan penanda 1' })).toHaveValue('Pojok');
});

test('Lewati pada tawaran salin: foto tetap ada tanpa penanda', async () => {
  apiMock.mockResolvedValue([{ itemId: 'i1', label: 'Mikrotik hAP', status: 'active' }]);
  renderField();
  await addPhotosFromDialog([libraryItem('g1', 1)]);
  await userEvent.click(await screen.findByRole('button', { name: 'Lewati' }));
  expect(latest).toEqual([photo('g1')]);
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: /Salin penanda/ })).not.toBeInTheDocument(),
  );
});

test('Tambah penanda menambah penanda di tengah (500,500) dan memfokuskan barisnya', async () => {
  renderField({ initial: [photo('g1')] });
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penanda pada foto 1' }));
  expect(latest[0]?.marks).toEqual([
    { x: 500, y: 500, target: { kind: 'sticker', stickerId: '' }, note: '' },
  ]);
  const row = screen.getByRole('group', { name: 'Baris penanda 1' });
  await waitFor(() => expect(within(row).getByRole('combobox', { name: 'Stiker' })).toHaveFocus());
  expect(screen.getByRole('button', { name: 'Penanda 1' })).toBeInTheDocument();
});

test('batas 30 penanda per foto menonaktifkan Tambah penanda', () => {
  const marks = Array.from({ length: 30 }, () => mark());
  renderField({ initial: [photo('g1', { marks })] });
  expect(screen.getByRole('button', { name: 'Tambah penanda pada foto 1' })).toBeDisabled();
});

test('ketuk foto menambah penanda pada posisi ketukan; seret memindahkan; penanda terpilih menyorot barisnya', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 1000,
    x: 0,
    y: 0,
    right: 1000,
    bottom: 1000,
    toJSON: () => ({}),
  });
  renderField({ initial: [photo('g1', { marks: [mark({ x: 100, y: 100 })] })] });
  fireEvent.click(screen.getByRole('group', { name: 'Foto dengan penanda' }), {
    clientX: 300,
    clientY: 400,
  });
  expect(latest[0]?.marks).toHaveLength(2);
  expect(latest[0]?.marks[1]).toEqual({
    x: 300,
    y: 400,
    target: { kind: 'sticker', stickerId: '' },
    note: '',
  });

  const marker = screen.getByRole('button', { name: 'Penanda 1' });
  fireEvent.pointerDown(marker, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(marker, { pointerId: 1, clientX: 650, clientY: 250 });
  expect(latest[0]?.marks[0]).toMatchObject({ x: 650, y: 250 });
  expect(screen.getByRole('group', { name: 'Baris penanda 1' })).toHaveAttribute(
    'data-selected',
    'true',
  );
  expect(screen.getByRole('group', { name: 'Baris penanda 2' })).not.toHaveAttribute(
    'data-selected',
  );
});

test('hapus penanda: pilihan bergeser dan nomor menyesuaikan', async () => {
  renderField({
    initial: [
      photo('g1', { marks: [mark({ note: 'a' }), mark({ note: 'b' }), mark({ note: 'c' })] }),
    ],
  });
  await userEvent.click(screen.getByRole('button', { name: 'Hapus penanda 2' }));
  expect(latest[0]?.marks.map((m) => m.note)).toEqual(['a', 'c']);
  expect(screen.getAllByRole('button', { name: /^Penanda \d+$/ })).toHaveLength(2);
});

test('catatan foto diubah; foto dapat dinaikkan, diturunkan, dan dihapus', async () => {
  renderField({ initial: [photo('g1'), photo('g2')] });
  fireEvent.change(screen.getByRole('textbox', { name: 'Catatan foto 1' }), {
    target: { value: 'Bagian belakang kardus' },
  });
  expect(latest[0]?.caption).toBe('Bagian belakang kardus');
  expect(screen.getByRole('button', { name: 'Naikkan foto 1' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Turunkan foto 2' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Turunkan foto 1' }));
  expect(latest.map((p) => p.guideId)).toEqual(['g2', 'g1']);
  await userEvent.click(screen.getByRole('button', { name: 'Naikkan foto 2' }));
  expect(latest.map((p) => p.guideId)).toEqual(['g1', 'g2']);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus foto 1' }));
  expect(latest.map((p) => p.guideId)).toEqual(['g2']);
});

test('label BU foto: pilihan = BU item; mengosongkan; BU yang dilepas dari item mengosongkan label', async () => {
  const view = (extra: Partial<StickerInstructionsFieldProps> = {}) => (
    <QueryClientProvider client={new QueryClient()}>
      <Harness initial={[photo('g1', { buId: 'bu-b' })]} {...extra} />
    </QueryClientProvider>
  );
  const { rerender } = render(view());
  const combo = screen.getByRole('combobox', { name: 'Label BU foto 1' });
  expect(combo).toHaveValue('Wholesale (WHL)');
  await userEvent.click(combo);
  expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
    'Retail (RTL)',
    'Wholesale (WHL)',
  ]);
  await userEvent.click(screen.getByRole('option', { name: 'Retail (RTL)' }));
  expect(latest[0]?.buId).toBe('bu-a');
  await userEvent.click(screen.getByRole('button', { name: 'Kosongkan Label BU foto 1' }));
  expect(latest[0]?.buId).toBeNull();

  // BU dilepas dari item: label foto yang memakainya otomatis dikosongkan
  await userEvent.click(screen.getByRole('combobox', { name: 'Label BU foto 1' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Wholesale (WHL)' }));
  expect(latest[0]?.buId).toBe('bu-b');
  rerender(view({ businessUnits: [{ id: 'bu-a', label: 'Retail (RTL)' }] }));
  await waitFor(() => expect(latest[0]?.buId).toBeNull());
});

test('galat bernomor tampil pada foto, baris penanda, dan umum', () => {
  renderField({
    initial: [photo('g1', { marks: [mark({ target: { kind: 'sticker', stickerId: '' } })] })],
    errors: [
      'Maksimal 10 foto instruksi',
      'Foto 1: catatan maksimal 200 karakter',
      'Foto 1, penanda 1: pilih stiker atau jenis',
    ],
  });
  const card = screen.getByRole('group', { name: 'Foto instruksi 1' });
  expect(within(card).getByText('Catatan maksimal 200 karakter')).toBeInTheDocument();
  expect(within(card).getByRole('textbox', { name: 'Catatan foto 1' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  const row = screen.getByRole('group', { name: 'Baris penanda 1' });
  expect(within(row).getByRole('alert')).toHaveTextContent('Pilih stiker atau jenis');
  expect(screen.getByText('Maksimal 10 foto instruksi')).toBeInTheDocument();
});

test('pilihan stiker memakai katalog: stiker nonaktif tersimpan berlabel dan tak jadi pilihan baru', async () => {
  const onCreateSticker = vi.fn();
  renderField({
    initial: [photo('g1', { marks: [mark({ target: { kind: 'sticker', stickerId: 's2' } })] })],
    onCreateSticker,
  });
  const combo = screen.getByRole('combobox', { name: 'Stiker' });
  expect(combo).toHaveValue('Postel Lama — nonaktif');
  await userEvent.click(combo);
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
    'Stiker PostelPostel',
    'Tambah Stiker',
  ]);
});

test('Tambah stiker dibungkus per penanda: stiker baru langsung terpilih pada penanda itu', async () => {
  let created: ((sticker: StickerDto) => void) | undefined;
  const onCreateSticker = vi.fn((done: (sticker: StickerDto) => void) => {
    created = done;
  });
  renderField({
    initial: [
      photo('g1', {
        marks: [mark(), mark({ target: { kind: 'sticker', stickerId: '' } })],
      }),
    ],
    onCreateSticker,
  });
  const row = screen.getByRole('group', { name: 'Baris penanda 2' });
  await userEvent.click(within(row).getByRole('combobox', { name: 'Stiker' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Stiker' }));
  expect(onCreateSticker).toHaveBeenCalledTimes(1);
  created?.({ ...STICKER_PLAIN, id: 's9', name: 'Baru' });
  await waitFor(() =>
    expect(latest[0]?.marks[1]?.target).toEqual({ kind: 'sticker', stickerId: 's9' }),
  );
  expect(latest[0]?.marks[0]?.target).toEqual({ kind: 'sticker', stickerId: 's1' });
});

test('Tambah jenis dibungkus per penanda dan hanya ada bila disediakan', async () => {
  let created: ((type: StickerTypeDto) => void) | undefined;
  const onCreateType = vi.fn((done: (type: StickerTypeDto) => void) => {
    created = done;
  });
  renderField({
    initial: [photo('g1', { marks: [mark({ target: { kind: 'type', typeId: '' } })] })],
    onCreateType,
  });
  await userEvent.click(screen.getByRole('combobox', { name: 'Jenis' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Jenis' }));
  created?.({ ...TYPE_PLAIN, id: 't9', name: 'Baru' });
  await waitFor(() => expect(latest[0]?.marks[0]?.target).toEqual({ kind: 'type', typeId: 't9' }));
});

test('Tambah stiker: menghapus penanda sebelumnya selagi dialog terbuka tetap memasang stiker baru ke penanda yang sama', async () => {
  let created: ((sticker: StickerDto) => void) | undefined;
  const onCreateSticker = vi.fn((done: (sticker: StickerDto) => void) => {
    created = done;
  });
  renderField({
    initial: [
      photo('g1', {
        marks: [
          mark({ note: 'a' }),
          mark({ note: 'b', target: { kind: 'sticker', stickerId: '' } }),
        ],
      }),
    ],
    onCreateSticker,
  });
  const row = screen.getByRole('group', { name: 'Baris penanda 2' });
  await userEvent.click(within(row).getByRole('combobox', { name: 'Stiker' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Stiker' }));
  // penanda 1 dihapus sebelum stiker baru selesai dibuat: "b" kini penanda 1
  await userEvent.click(screen.getByRole('button', { name: 'Hapus penanda 1' }));
  expect(latest[0]?.marks.map((m) => m.note)).toEqual(['b']);
  created?.({ ...STICKER_PLAIN, id: 's9', name: 'Baru' });
  await waitFor(() =>
    expect(latest[0]?.marks[0]).toMatchObject({
      note: 'b',
      target: { kind: 'sticker', stickerId: 's9' },
    }),
  );
});

test('Tambah stiker: bila penanda pemintanya dihapus, stiker baru tidak dipasang ke penanda lain', async () => {
  let created: ((sticker: StickerDto) => void) | undefined;
  const onCreateSticker = vi.fn((done: (sticker: StickerDto) => void) => {
    created = done;
  });
  renderField({
    initial: [
      photo('g1', {
        marks: [
          mark({ note: 'a', target: { kind: 'sticker', stickerId: '' } }),
          mark({ note: 'b', target: { kind: 'sticker', stickerId: '' } }),
        ],
      }),
    ],
    onCreateSticker,
  });
  const row = screen.getByRole('group', { name: 'Baris penanda 2' });
  await userEvent.click(within(row).getByRole('combobox', { name: 'Stiker' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Stiker' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus penanda 2' }));
  const before = JSON.stringify(latest);
  created?.({ ...STICKER_PLAIN, id: 's9', name: 'Baru' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(JSON.stringify(latest)).toBe(before);
  expect(latest[0]?.marks[0]?.target).toEqual({ kind: 'sticker', stickerId: '' });
});

test('Tambah jenis: bila penanda pemintanya sudah tidak ada (dihapus lalu ada penanda baru), jenis baru tidak dipasang', async () => {
  let created: ((type: StickerTypeDto) => void) | undefined;
  const onCreateType = vi.fn((done: (type: StickerTypeDto) => void) => {
    created = done;
  });
  renderField({
    initial: [photo('g1', { marks: [mark({ target: { kind: 'type', typeId: '' } })] })],
    onCreateType,
  });
  await userEvent.click(screen.getByRole('combobox', { name: 'Jenis' }));
  await userEvent.click(screen.getByRole('option', { name: 'Tambah Jenis' }));
  // penanda diganti dengan objek baru oleh sumber lain (salin penanda)
  await userEvent.click(screen.getByRole('button', { name: 'Hapus penanda 1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penanda pada foto 1' }));
  created?.({ ...TYPE_PLAIN, id: 't9', name: 'Baru' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(latest[0]?.marks[0]?.target).toEqual({ kind: 'sticker', stickerId: '' });
});

test('penanda bersasaran nonaktif diberi tanda di baris penanda pada form', () => {
  renderField({
    initial: [photo('g1', { marks: [mark({ target: { kind: 'sticker', stickerId: 's2' } })] })],
  });
  expect(screen.getByRole('status')).toHaveTextContent('Stiker nonaktif');
});

test('salin penanda menerima katalog agar sasaran nonaktif ditandai di ringkasan', async () => {
  apiMock.mockImplementation(async (id: string) => {
    if (id === 'stickerGuides.usages')
      return [{ itemId: 'i1', label: 'Mikrotik hAP', status: 'active' }];
    return {
      id: 'i1',
      stickerPhotos: [
        {
          guideId: 'g1',
          guideName: 'Belakang',
          width: 800,
          height: 600,
          caption: '',
          buId: null,
          marks: [
            {
              ...mark({ target: { kind: 'sticker', stickerId: 's2' } }),
              targetName: 'Postel Lama',
              resolved: [],
              unresolved: false,
            },
          ],
        },
      ],
    };
  });
  renderField();
  await addPhotosFromDialog([libraryItem('g1', 1)]);
  const dialog = await screen.findByRole('dialog', { name: /Salin penanda/ });
  await userEvent.click(
    within(dialog).getByRole('button', { name: 'Salin penanda dari Mikrotik hAP' }),
  );
  expect(await within(dialog).findByText(/Postel Lama — nonaktif/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Tetap salin 1 penanda' }));
  await waitFor(() => expect(latest[0]?.marks).toHaveLength(1));
  // setelah disalin, baris penanda menandai sasaran nonaktif
  expect(screen.getByRole('status')).toHaveTextContent('Stiker nonaktif');
});
