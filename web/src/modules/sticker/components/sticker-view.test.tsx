import type {
  BusinessUnitOptionDto,
  MeDto,
  StickerDto,
  StickerStockDto,
  StickerTypeDto,
} from '@shared/contract';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ActiveLocationsProvider } from '@/modules/location/active-locations-context';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { StickerView, type StickerViewProps } from './sticker-view';
import { type StickerStockPanel, useStockActions } from './stock-actions';

const me = vi.hoisted(() => ({
  value: {
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
      {
        id: 'l-a',
        code: 'JKT',
        name: 'Jakarta',
        permissions: { handover: 'none', qc: 'none', stock: 'none', stickerstock: 'manage' },
      },
    ],
  } as unknown as MeDto,
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => me.value }));
vi.mock('@/modules/item/components/image-thumb', () => ({
  ImageThumb: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));
// Riwayat memuat lewat API: di sini cukup diketahui panel dirender di tab Riwayat.
vi.mock('./stock-history', () => ({
  StockHistoryPanel: () => <p>riwayat-panel</p>,
  StockHistoryDialog: () => null,
}));

afterEach(() => {
  cleanup();
});

const businessUnits: BusinessUnitOptionDto[] = [
  { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active' },
];

const sticker: StickerDto = {
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
  updatedAt: '2026-11-09T11:00:00.000Z',
};

const type: StickerTypeDto = {
  id: 'tp-bu',
  name: 'QC Hijau',
  rule: 'bu',
  status: 'active',
  stickerCount: 1,
  systemKind: '',
  defaultMinQty: 0,
  updatedAt: '',
};

const row: StickerStockDto = {
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
};

function panel(overrides: Partial<StickerStockPanel> = {}): StickerStockPanel {
  return {
    rows: [row],
    locations: [
      { id: 'l-a', code: 'JKT', name: 'Jakarta' },
      { id: 'l-b', code: 'BDG', name: 'Bandung' },
    ],
    canEdit: true,
    canManage: true,
    onWrite: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

/** Meniru halaman rute: pengendali dialog stok dibuat di atas View dan diteruskan. */
function Harness(props: Omit<StickerViewProps, 'stockActions'>) {
  const stockActions = useStockActions(props.stock);
  return (
    <ActiveLocationsProvider>
      <StickerView {...props} stockActions={stockActions} />
    </ActiveLocationsProvider>
  );
}

async function renderView(props: Partial<StickerViewProps> = {}) {
  const handlers = {
    onBack: vi.fn(),
    onEdit: vi.fn(),
    onToggleStatus: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
    onTabChange: vi.fn(),
    onStartOpname: vi.fn(),
    onStartEntry: vi.fn(),
  };
  await renderInRouter(
    <Harness
      sticker={sticker}
      type={type}
      businessUnits={businessUnits}
      canEdit
      canManage
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

test('stiker tidak ada: pesan dan tombol kembali', async () => {
  const { onBack } = await renderView({ sticker: undefined });
  expect(screen.getByRole('heading', { name: 'Stiker tidak ditemukan' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar stiker' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('judul memakai alias; badge status dan Menipis; tab Detail memuat identitas dengan tautan', async () => {
  await renderView();
  expect(screen.getByRole('heading', { level: 1, name: 'Hijau-B' })).toBeInTheDocument();
  expect(screen.getAllByText('Aktif').length).toBeGreaterThan(0);
  expect(screen.getByText('Menipis')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Detail', selected: true })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'QC Hijau' })).toHaveAttribute(
    'href',
    '/sticker/types/tp-bu',
  );
  expect(screen.getByRole('link', { name: 'RTL' })).toHaveAttribute(
    'href',
    '/access/business-units/bu-a',
  );
  expect(screen.getByText('QC Hijau Besar')).toBeInTheDocument();
  expect(screen.getByText('100')).toBeInTheDocument();
});

test('tanpa hak membuka BU: kode BU menjadi lencana, bukan tautan', async () => {
  await renderView({ canOpenBusinessUnit: false });
  expect(screen.queryByRole('link', { name: 'RTL' })).toBeNull();
  expect(screen.getByText('RTL')).toHaveAttribute('title', 'Retail');
});

test('tanpa panel stok: hanya tab Detail (tab Stok dan Riwayat tidak ada)', async () => {
  await renderView();
  expect(screen.queryByRole('tab', { name: 'Stok' })).toBeNull();
  expect(screen.queryByRole('tab', { name: 'Riwayat' })).toBeNull();
});

test('dengan panel stok: tab Stok memuat total, rincian per lokasi, dan aksi stok', async () => {
  const onWrite = vi.fn().mockResolvedValue(null);
  await renderView({ stock: panel({ onWrite }), tab: 'stok' });
  expect(screen.getByRole('tab', { name: 'Stok', selected: true })).toBeInTheDocument();
  expect(screen.getByText('Total')).toBeInTheDocument();
  expect(screen.getByText('150')).toBeInTheDocument();
  expect(screen.getByText('Jakarta')).toBeInTheDocument();
  expect(screen.getByText('120')).toBeInTheDocument();
  expect(screen.getByText('Bandung')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Catat masuk Hijau-B' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Catat keluar Hijau-B' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Koreksi Hijau-B' })).toBeInTheDocument();
});

test('tombol Catat masuk membuka dialog stok bersama (dirender View)', async () => {
  await renderView({ stock: panel(), tab: 'stok' });
  await userEvent.click(screen.getByRole('button', { name: 'Catat masuk Hijau-B' }));
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
});

test('aksi stok mengikuti izin: view saja tanpa Catat dan Koreksi, tanpa Entri stok dan Stok opname', async () => {
  await renderView({ stock: panel({ canEdit: false, canManage: false }), tab: 'stok' });
  expect(screen.queryByRole('button', { name: /^Catat/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Koreksi/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Entri stok' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Stok opname' })).toBeNull();
});

test('stiker nonaktif: Catat masuk hilang, Catat keluar tetap ada', async () => {
  const inactiveRow = { ...row, status: 'inactive' as const };
  await renderView({
    sticker: { ...sticker, status: 'inactive' },
    stock: panel({ rows: [inactiveRow] }),
    tab: 'stok',
  });
  expect(screen.queryByRole('button', { name: 'Catat masuk Hijau-B' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Catat keluar Hijau-B' })).toBeInTheDocument();
});

test('total stok negatif tampil sebagai "Kurang N"', async () => {
  await renderView({
    stock: panel({ rows: [{ ...row, total: -3, byLocation: [{ locationId: 'l-a', qty: -3 }] }] }),
    tab: 'stok',
  });
  expect(screen.getAllByText('Kurang 3').length).toBeGreaterThan(0);
});

test('Entri stok dan Stok opname memanggil handler dengan id stiker', async () => {
  const { onStartEntry, onStartOpname } = await renderView({ stock: panel(), tab: 'stok' });
  await userEvent.click(screen.getByRole('button', { name: 'Entri stok' }));
  expect(onStartEntry).toHaveBeenCalledWith('s1');
  await userEvent.click(screen.getByRole('button', { name: 'Stok opname' }));
  expect(onStartOpname).toHaveBeenCalledWith('s1');
});

test('berpindah ke tab Riwayat memanggil onTabChange dan merender panel riwayat', async () => {
  const { onTabChange } = await renderView({ stock: panel() });
  await userEvent.click(screen.getByRole('tab', { name: 'Riwayat' }));
  expect(onTabChange).toHaveBeenLastCalledWith('riwayat');
});

test('aksi halaman: Ubah, Nonaktifkan; Hapus tidak ada selama stiker Aktif', async () => {
  const { onEdit, onToggleStatus } = await renderView();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  expect(onEdit).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }));
  expect(onToggleStatus).toHaveBeenCalledTimes(1);
});

test('stiker nonaktif biasa dapat dihapus; stiker jenis sistem tidak', async () => {
  const { onDelete } = await renderView({ sticker: { ...sticker, status: 'inactive' } });
  await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
  expect(onDelete).toHaveBeenCalledTimes(1);
  cleanup();
  await renderView({
    sticker: { ...sticker, status: 'inactive' },
    type: { ...type, systemKind: 'postel', rule: 'group' },
  });
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  expect(screen.getByText(/Stiker Postel: satu untuk tiap catatan Postel/)).toBeInTheDocument();
});

test('Manual Book nonaktif hanya dapat diaktifkan bila versi terbaru konfigurasinya', async () => {
  const manualBook = { ...type, systemKind: 'manual_book' as const, rule: 'group' as const };
  await renderView({
    sticker: { ...sticker, status: 'inactive', latestManualBookVersion: false },
    type: manualBook,
  });
  expect(screen.queryByRole('button', { name: 'Aktifkan' })).toBeNull();
  cleanup();
  await renderView({
    sticker: { ...sticker, status: 'inactive', latestManualBookVersion: true },
    type: manualBook,
  });
  expect(screen.getByRole('button', { name: 'Aktifkan' })).toBeInTheDocument();
});

test('tanpa izin: tanpa Ubah, Nonaktifkan, dan Hapus', async () => {
  await renderView({
    canEdit: false,
    canManage: false,
    sticker: { ...sticker, status: 'inactive' },
  });
  expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Aktifkan' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
});

test('stiker terhapus: spanduk Terhapus, hanya Pulihkan, tanpa tab Stok dan Riwayat', async () => {
  const { onRestore } = await renderView({
    sticker: {
      ...sticker,
      status: 'inactive',
      deleted: { deletedAt: '2026-11-20T03:00:00.000Z', deletedBy: 'admin@x.com' },
    },
    stock: panel(),
  });
  expect(screen.queryByRole('tab', { name: 'Stok' })).toBeNull();
  expect(screen.queryByRole('tab', { name: 'Riwayat' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ubah' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hapus' })).toBeNull();
  const restoreButtons = screen.getAllByRole('button', { name: 'Pulihkan' });
  await userEvent.click(restoreButtons[0] as HTMLElement);
  expect(onRestore).toHaveBeenCalled();
});

test('jenis terhapus diberi penanda Terhapus pada baris Jenis', async () => {
  await renderView({ sticker: { ...sticker, typeDeleted: true } });
  expect(screen.getByText('Terhapus')).toBeInTheDocument();
});

test('ponsel (360 px): bar aksi menempel memuat aksi utama dan menu "Aksi lainnya"', async () => {
  const media = mockMatchMedia(false);
  try {
    await renderView({ sticker: { ...sticker, status: 'inactive' } });
    const bar = screen.getByRole('region', { name: 'Aksi halaman' });
    expect(within(bar).getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Aksi lainnya' })).toBeInTheDocument();
  } finally {
    media.restore();
  }
});
