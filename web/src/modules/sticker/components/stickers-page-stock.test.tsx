import type {
  BusinessUnitOptionDto,
  MeDto,
  StickerDto,
  StickerStockDto,
  StickerTypeDto,
} from '@shared/contract';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ActiveLocationsProvider } from '@/modules/location/active-locations-context';
import { pickLink, pickSelect } from '@/test/link-field';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { type StickersFilter, StickersPage, type StickersPageProps } from './stickers-page';

let me: MeDto;
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me }));
vi.mock('@/modules/item/components/image-thumb', () => ({ ImageThumb: () => null }));
const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { info: toastInfo, success: vi.fn(), error: vi.fn() } }));

function located(permission: 'view' | 'edit' | 'manage') {
  return { handover: 'none', qc: 'none', stock: 'none', stickerstock: permission } as const;
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  localStorage.clear();
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
      sticker: 'view',
      stickerstock: 'none',
      serial: 'none',
      serialservice: 'none',
      countrylock: 'none',
    },
    businessUnits: [],
    locations: [
      { id: 'l-a', code: 'JKT', name: 'Jakarta', permissions: located('manage') },
      { id: 'l-b', code: 'BDG', name: 'Bandung', permissions: located('manage') },
    ],
  };
});

const types: StickerTypeDto[] = [
  {
    id: 'tp-bu',
    name: 'QC Hijau',
    rule: 'bu',
    status: 'active',
    stickerCount: 1,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: '',
  },
  {
    id: 'tp-none',
    name: 'Segel',
    rule: 'none',
    status: 'active',
    stickerCount: 1,
    systemKind: '',
    defaultMinQty: 0,
    updatedAt: '',
  },
];
const businessUnits: BusinessUnitOptionDto[] = [
  { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active' },
];

function catalogSticker(overrides: Partial<StickerDto>): StickerDto {
  return {
    id: 's1',
    typeId: 'tp-bu',
    typeName: 'QC Hijau',
    name: 'QC Hijau Besar',
    alias: 'Hijau-B',
    fileId: null,
    minQty: 100,
    status: 'active',
    businessUnitIds: ['bu-a'],
    low: true,
    latestManualBookVersion: false,
    updatedAt: '2026-11-09 11:00:00',
    ...overrides,
  };
}

const catalog: StickerDto[] = [
  catalogSticker({}),
  catalogSticker({
    id: 's2',
    typeId: 'tp-none',
    typeName: 'Segel',
    name: 'Segel Polos',
    alias: '',
    minQty: 0,
    low: false,
  }),
  // Ada di katalog tetapi tanpa baris stok (mis. stok 0 dan nonaktif disembunyikan server).
  catalogSticker({
    id: 's3',
    typeId: 'tp-none',
    typeName: 'Segel',
    name: 'Segel Lawas',
    alias: '',
    minQty: 0,
    low: false,
    status: 'inactive',
  }),
];

const rows: StickerStockDto[] = [
  {
    stickerId: 's1',
    name: 'Hijau-B',
    typeName: 'QC Hijau',
    typeStatus: 'active',
    status: 'active',
    minQty: 100,
    low: true,
    total: 150,
    byLocation: [
      { locationId: 'l-a', qty: 120 },
      { locationId: 'l-b', qty: 30 },
    ],
  },
  {
    stickerId: 's2',
    name: 'Segel Polos',
    typeName: 'Segel',
    typeStatus: 'active',
    status: 'active',
    minQty: 0,
    low: false,
    total: 40,
    byLocation: [
      { locationId: 'l-a', qty: 40 },
      { locationId: 'l-b', qty: 0 },
    ],
  },
];

const bothLocations = [
  { id: 'l-a', code: 'JKT', name: 'Jakarta' },
  { id: 'l-b', code: 'BDG', name: 'Bandung' },
];

type StockPanel = NonNullable<StickersPageProps['stock']>;

interface Control {
  setStock?: (update: (current: StockPanel | undefined) => StockPanel | undefined) => void;
}

/** Pemegang state: filter (pengganti search params Router) dan stok (agar tes dapat "memuat ulang" stok). */
function Harness({
  control,
  initialStock,
  ...props
}: Omit<StickersPageProps, 'filter' | 'onFilterChange' | 'stock'> & {
  control: Control;
  initialStock: StockPanel | undefined;
}): ReactNode {
  const [filter, setFilter] = useState<StickersFilter>({ q: '', typeIds: [], status: 'all' });
  const [stock, setStock] = useState(initialStock);
  control.setStock = setStock;
  return (
    <ActiveLocationsProvider>
      <StickersPage
        {...props}
        stock={stock}
        filter={filter}
        onFilterChange={(patch) => setFilter((current) => ({ ...current, ...patch }))}
      />
    </ActiveLocationsProvider>
  );
}

async function openChip(label: string) {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}(:|$)`) }));
}

async function renderPage(
  stockOverrides: Partial<StockPanel> = {},
  props: Partial<StickersPageProps> = {},
) {
  const onWrite = vi.fn().mockResolvedValue(null);
  const onStartOpname = vi.fn();
  const onStartEntry = vi.fn();
  const control: Control = {};
  const { stock: stockProp, ...rest } = props;
  await renderInRouter(
    <Harness
      control={control}
      initialStock={
        'stock' in props
          ? stockProp
          : {
              rows,
              locations: bothLocations,
              canEdit: true,
              canManage: true,
              onWrite,
              ...stockOverrides,
            }
      }
      stickers={catalog}
      types={types}
      businessUnits={businessUnits}
      canEdit
      canManage
      pendingStatusId={null}
      onSave={vi.fn().mockResolvedValue(null)}
      onToggleStatus={vi.fn()}
      mutations={{
        setStatus: vi.fn().mockResolvedValue([]),
        remove: vi.fn().mockResolvedValue([]),
        restore: vi.fn().mockResolvedValue([]),
        reload: vi.fn(),
      }}
      onStartOpname={onStartOpname}
      onStartEntry={onStartEntry}
      {...rest}
    />,
  );
  return {
    onWrite,
    onStartOpname,
    onStartEntry,
    /** Memuat ulang halaman dengan data stok baru (mis. setelah refetch). */
    update: (stock: Partial<StockPanel>) =>
      act(() => control.setStock?.((current) => (current ? { ...current, ...stock } : current))),
  };
}

async function openStockMenu(label: string, item: string) {
  await userEvent.click(screen.getByRole('button', { name: `Stok ${label}` }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
}

test('katalog dan stok dalam satu tabel: total, penanda Menipis, dan rincian per lokasi', async () => {
  await renderPage();
  const first = screen.getByRole('row', { name: /Hijau-B/ });
  expect(within(first).getByText('QC Hijau')).toBeInTheDocument();
  expect(within(first).getByText('150')).toBeInTheDocument();
  expect(within(first).getByText('Menipis')).toBeInTheDocument();
  expect(within(first).getByText('JKT 120')).toBeInTheDocument();
  expect(within(first).getByText('BDG 30')).toBeInTheDocument();
  // Kolom katalog tetap ada di tabel yang sama.
  expect(screen.getByRole('columnheader', { name: 'BU' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Batas minimum' })).toBeInTheDocument();
  const second = screen.getByRole('row', { name: /Segel Polos/ });
  expect(within(second).queryByText('Menipis')).toBeNull();
});

test('stiker katalog tanpa baris stok tampil stok 0 dan tanpa menu Stok', async () => {
  await renderPage();
  const lawas = screen.getByRole('row', { name: /Segel Lawas/ });
  // Kolom: checkbox, Aksi, Stiker, Jenis, BU, Stok.
  expect(within(lawas).getAllByRole('cell')[5]).toHaveTextContent(/^0$/);
  expect(screen.queryByRole('button', { name: 'Stok Segel Lawas' })).toBeNull();
});

test('satu lokasi: tanpa kolom rincian per lokasi', async () => {
  await renderPage({ locations: [bothLocations[0] as (typeof bothLocations)[number]] });
  expect(screen.queryByRole('columnheader', { name: 'Per lokasi' })).toBeNull();
});

test('tanpa izin stok (stock tidak diberikan): tanpa kolom Stok, menu Stok, dan Stok opname', async () => {
  await renderPage({}, { stock: undefined });
  expect(screen.queryByRole('columnheader', { name: 'Stok' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Stok / })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Stok opname' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Tambah stiker' })).toBeInTheDocument();
});

test('hanya izin stok (tanpa katalog): baris dari stok, tanpa kolom/aksi katalog, filter jenis dari data stok', async () => {
  await renderPage({}, { stickers: undefined, types: [], businessUnits: [] });
  expect(screen.getByRole('row', { name: /Hijau-B/ })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'BU' })).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'Batas minimum' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Tambah stiker' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Ubah / })).toBeNull();
  expect(screen.queryByRole('button', { name: /^(Aktifkan|Nonaktifkan) / })).toBeNull();
  // Stok tetap bisa dilihat dan dicatat.
  expect(screen.getByRole('button', { name: 'Stok Hijau-B' })).toBeInTheDocument();
  await openChip('Jenis');
  await pickLink(screen, 'Filter jenis', 'Segel');
  expect(screen.queryByRole('row', { name: /Hijau-B/ })).toBeNull();
  expect(screen.getByRole('row', { name: /Segel Polos/ })).toBeInTheDocument();
});

test('tombol Stok opname hanya bagi pemegang manage dan membuka halaman opname lewat callback', async () => {
  const { onStartOpname } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Stok opname' }));
  expect(onStartOpname).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

test('Koreksi dan Stok opname tersembunyi bagi pemegang edit; Catat masuk/keluar tetap ada', async () => {
  await renderPage({ canManage: false });
  expect(screen.queryByRole('button', { name: 'Stok opname' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Stok Hijau-B' }));
  expect(await screen.findByRole('menuitem', { name: 'Catat masuk' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Catat keluar' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Koreksi' })).toBeNull();
});

test('pemegang view saja tidak melihat aksi tulis, tetapi tetap melihat Riwayat', async () => {
  await renderPage({ canEdit: false, canManage: false });
  await userEvent.click(screen.getByRole('button', { name: 'Stok Hijau-B' }));
  expect(screen.queryByRole('menuitem', { name: /^Catat/ })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: 'Koreksi' })).toBeNull();
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Riwayat' }));
  expect(await screen.findByRole('dialog', { name: 'Riwayat Hijau-B' })).toBeInTheDocument();
});

test('tombol Entri stok membuka halaman entri pada mode yang dipilih; Koreksi hanya bagi manage', async () => {
  const { onStartEntry } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Entri stok' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Catat keluar' }));
  expect(onStartEntry).toHaveBeenCalledWith('out');
  cleanup();
  await renderPage({ canManage: false });
  await userEvent.click(screen.getByRole('button', { name: 'Entri stok' }));
  expect(await screen.findByRole('menuitem', { name: 'Catat masuk' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Koreksi' })).toBeNull();
});

test('pemegang stok saja: tanpa checkbox, kolom BU/minimum, aksi katalog, dan tautan nama', async () => {
  await renderPage(
    {},
    { stickers: undefined, types: [], businessUnits: [], canEdit: false, canManage: false },
  );
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'BU' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Hijau-B' })).toBeNull();
  expect(screen.getByText('Hijau-B')).toBeInTheDocument();
});

test('pemegang katalog saja: tanpa kolom Stok, Per lokasi, menu Stok, Entri stok, dan Stok opname', async () => {
  await renderPage({}, { stock: undefined });
  expect(screen.queryByRole('columnheader', { name: 'Stok' })).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'Per lokasi' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Stok / })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Entri stok' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Hijau-B' })).toBeInTheDocument();
});

test('tampilan Terhapus: tanpa kolom Stok, menu Stok, Entri stok, dan Stok opname', async () => {
  await renderPage(
    {},
    {
      stickers: [
        catalogSticker({
          id: 'd1',
          alias: '',
          name: 'Stiker Dihapus',
          status: 'inactive',
          deleted: { deletedAt: '2026-11-20T03:00:00.000Z', deletedBy: 'admin@x.com' },
        }),
      ],
    },
  );
  await openChip('Status');
  await pickSelect(screen, 'Filter status', 'Terhapus');
  expect(screen.queryByRole('columnheader', { name: 'Stok' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Stok / })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Entri stok' })).toBeNull();
});

test('Masuk disembunyikan bila stiker ATAU jenisnya nonaktif; Keluar dan Koreksi tetap ada', async () => {
  const [first, second] = rows as [StickerStockDto, StickerStockDto];
  await renderPage({
    rows: [
      { ...first, typeStatus: 'inactive' },
      { ...second, status: 'inactive' },
    ],
  });
  for (const label of ['Hijau-B', 'Segel Polos']) {
    await userEvent.click(screen.getByRole('button', { name: `Stok ${label}` }));
    expect(await screen.findByRole('menuitem', { name: 'Catat keluar' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Catat masuk' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Koreksi' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
  }
});

test('"Stok saat ini" di dialog ikut diperbarui saat stok dimuat ulang dengan dialog terbuka', async () => {
  const { update } = await renderPage();
  await openStockMenu('Hijau-B', 'Catat keluar');
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  expect(within(dialog).getByText('Stok saat ini: 120 butir')).toBeInTheDocument();
  const [first, ...rest] = rows as [StickerStockDto, ...StickerStockDto[]];
  update({
    rows: [
      {
        ...first,
        total: 35,
        byLocation: [
          { locationId: 'l-a', qty: 5 },
          { locationId: 'l-b', qty: 30 },
        ],
      },
      ...rest,
    ],
  });
  expect(within(dialog).getByText('Stok saat ini: 5 butir')).toBeInTheDocument();
});

test('baris hilang saat dialog terbuka: dialog menutup bersih dengan pemberitahuan dan tidak terbuka lagi sendiri', async () => {
  toastInfo.mockClear();
  const { update } = await renderPage();
  await openStockMenu('Hijau-B', 'Catat keluar');
  await screen.findByRole('alertdialog');
  const [first, second] = rows as [StickerStockDto, StickerStockDto];
  update({ rows: [second] });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(toastInfo).toHaveBeenCalledWith('Stok stiker berubah; dialog ditutup');
  // Baris kembali: dialog tidak terbuka lagi dengan sendirinya.
  update({ rows: [first, second] });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(toastInfo).toHaveBeenCalledTimes(1);
});

test('dialog keluar mewajibkan alasan', async () => {
  const { onWrite } = await renderPage();
  await openStockMenu('Hijau-B', 'Catat keluar');
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  await userEvent.type(within(dialog).getByLabelText('Jumlah butir'), '20');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onWrite).not.toHaveBeenCalled();
  expect(await within(dialog).findByText('Alasan wajib diisi')).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText('Alasan'), 'Dipakai QC');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onWrite).toHaveBeenCalledWith({
    type: 'record',
    input: {
      locationId: 'l-a',
      stickerId: 's1',
      kind: 'out',
      quantity: 20,
      reason: 'Dipakai QC',
    },
  });
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
});

test('dialog masuk: alasan opsional dan hitungan lembar dikirim sebagai count', async () => {
  const { onWrite } = await renderPage();
  await openStockMenu('Hijau-B', 'Catat masuk');
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Bandung (BDG)');
  await pickSelect(within(dialog), 'Cara input', 'Hitung lembar');
  await userEvent.type(within(dialog).getByLabelText('Lembar baris 1'), '10');
  await userEvent.type(within(dialog).getByLabelText('Isi per lembar baris 1'), '12');
  await userEvent.type(within(dialog).getByLabelText('Butir'), '5');
  expect(within(dialog).getByText('125 butir')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onWrite).toHaveBeenCalledWith({
    type: 'record',
    input: {
      locationId: 'l-b',
      stickerId: 's1',
      kind: 'in',
      count: { rows: [{ sheets: 10, perSheet: 12 }], loose: 5 },
      reason: '',
    },
  });
});

test('galat server tampil pada field jumlah dan dialog tetap terbuka', async () => {
  const { onWrite } = await renderPage();
  onWrite.mockResolvedValueOnce({ message: 'Stok tidak cukup', quantity: 'Stok tidak cukup' });
  await openStockMenu('Segel Polos', 'Catat keluar');
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  await userEvent.type(within(dialog).getByLabelText('Jumlah butir'), '99');
  await userEvent.type(within(dialog).getByLabelText('Alasan'), 'Uji');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Stok tidak cukup');
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});

test('koreksi: perubahan bertanda dan alasan wajib', async () => {
  const { onWrite } = await renderPage();
  await openStockMenu('Hijau-B', 'Koreksi');
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  await userEvent.type(within(dialog).getByLabelText('Perubahan (butir)'), '-5');
  await userEvent.type(within(dialog).getByLabelText('Alasan'), 'Rusak');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onWrite).toHaveBeenCalledWith({
    type: 'adjust',
    input: { locationId: 'l-a', stickerId: 's1', delta: -5, reason: 'Rusak' },
  });
});

test('koreksi tanpa perubahan atau tanpa alasan tidak dikirim', async () => {
  const { onWrite } = await renderPage();
  await openStockMenu('Hijau-B', 'Koreksi');
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));
  expect(onWrite).not.toHaveBeenCalled();
  expect(await within(dialog).findByText('Perubahan wajib diisi (bukan 0)')).toBeInTheDocument();
  expect(within(dialog).getByText('Alasan wajib diisi')).toBeInTheDocument();
});

test('stok negatif tampil "Kurang N" dengan warna peringatan di tabel dan di dialog stok keluar', async () => {
  const [first, ...rest] = rows as [StickerStockDto, ...StickerStockDto[]];
  await renderPage({
    rows: [
      {
        ...first,
        total: -2,
        byLocation: [
          { locationId: 'l-a', qty: -2 },
          { locationId: 'l-b', qty: 0 },
        ],
      },
      ...rest,
    ],
  });
  const total = screen.getAllByText('Kurang 2')[0];
  expect(total?.className).toContain('text-destructive');
  await openStockMenu('Hijau-B', 'Catat keluar');
  const dialog = await screen.findByRole('alertdialog');
  await pickLink(within(dialog), 'Lokasi', 'Jakarta (JKT)');
  expect(within(dialog).getByText('Stok saat ini: Kurang 2')).toBeInTheDocument();
});

test('filter jenis memakai nama jenis dan menyaring baris gabungan', async () => {
  await renderPage();
  await openChip('Jenis');
  await pickLink(screen, 'Filter jenis', 'Segel');
  expect(screen.queryByRole('row', { name: /Hijau-B/ })).toBeNull();
  expect(screen.getByRole('row', { name: /Segel Polos/ })).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /Segel Lawas/ })).toBeInTheDocument();
});

test('aksi stok masuk ke kolom Aksi: tanpa kolom "Aksi stok" terpisah', async () => {
  await renderPage();
  expect(screen.queryByRole('columnheader', { name: 'Aksi stok' })).toBeNull();
  const row = screen.getByRole('row', { name: /Hijau-B/ });
  // Satu sel Aksi memuat Ubah dan menu Stok berdampingan.
  const aksi = within(row).getByRole('button', { name: 'Ubah Hijau-B' }).closest('td');
  expect(
    within(aksi as HTMLElement).getByRole('button', { name: 'Stok Hijau-B' }),
  ).toBeInTheDocument();
});

test('hanya izin stok (tanpa katalog): kolom Aksi tetap berisi entri Stok', async () => {
  await renderPage({}, { stickers: undefined, types: [], businessUnits: [] });
  expect(screen.getByRole('columnheader', { name: 'Aksi' })).toBeInTheDocument();
  await openStockMenu('Hijau-B', 'Riwayat');
  expect(await screen.findByRole('dialog', { name: 'Riwayat Hijau-B' })).toBeInTheDocument();
});

test('ponsel: aksi stok menjadi grup datar "Stok" di menu ⋯ (tanpa submenu bersarang)', async () => {
  window.innerWidth = 360;
  const media = mockMatchMedia(false);
  try {
    await renderPage();
    const card = screen
      .getAllByRole('listitem')
      .find((node) => within(node).queryByText('Hijau-B'));
    await userEvent.click(within(card as HTMLElement).getByRole('button', { name: /^Aksi/ }));
    const menu = await screen.findByRole('menu');
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    expect(within(menu).getByText('Stok')).toBeInTheDocument();
    for (const name of ['Catat masuk', 'Catat keluar', 'Koreksi', 'Riwayat']) {
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
    }
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Riwayat' }));
    expect(await screen.findByRole('dialog', { name: 'Riwayat Hijau-B' })).toBeInTheDocument();
  } finally {
    media.restore();
    window.innerWidth = 1024;
  }
});
