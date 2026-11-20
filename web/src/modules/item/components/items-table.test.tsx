import type { ItemSummaryDto } from '@shared/contract';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { useRowSelection } from '@/components/data-table';
import { renderInRouter } from '@/test/render-in-router';
import { ItemsTable, type ItemsTableProps } from './items-table';

const items: ItemSummaryDto[] = [
  {
    id: 'i1',
    brandId: 'b1',
    brand: 'Ubiquiti',
    model: 'AF 5XHD',
    isCountryLock: true,
    status: 'active',
    aliases: ['AirFiber 5XHD'],
    imageCount: 2,
    hasInstructions: true,
    hasManualBook: false,
    hasPostel: false,
    businessUnits: [
      { id: 'bu-a', code: 'RTL', name: 'Retail' },
      { id: 'bu-b', code: 'WHL', name: 'Wholesale' },
    ],
    updatedAt: '',
  },
  {
    id: 'i2',
    brandId: 'b2',
    brand: 'Mikrotik',
    model: 'hAP ac2',
    isCountryLock: false,
    status: 'inactive',
    aliases: [],
    imageCount: 0,
    hasInstructions: false,
    hasManualBook: false,
    hasPostel: false,
    businessUnits: [],
    updatedAt: '',
  },
];

type Props = Partial<ItemsTableProps>;

function handlers() {
  return {
    onEdit: vi.fn(),
    onToggleStatus: vi.fn(),
    onDelete: vi.fn(),
    onRestore: vi.fn(),
  };
}

async function renderTable(props: Props = {}) {
  const fns = handlers();
  await renderInRouter(
    <ItemsTable items={items} canEdit={() => true} canManage={() => true} {...fns} {...props} />,
  );
  return fns;
}

test('menampilkan merk, tipe, nama lain, country lock, jumlah gambar, dan status', async () => {
  await renderTable();
  expect(screen.getByText('AF 5XHD')).toBeInTheDocument();
  expect(screen.getByText('AirFiber 5XHD')).toBeInTheDocument();
  expect(screen.getByText('Country lock')).toBeInTheDocument();
  expect(screen.getByText('Aktif')).toBeInTheDocument();
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
});

test('merk dan tipe berupa tautan ke View; tidak ada tombol "Lihat"', async () => {
  await renderTable();
  expect(screen.getByRole('link', { name: 'Ubiquiti' })).toHaveAttribute('href', '/item/brands/b1');
  expect(screen.getByRole('link', { name: 'AF 5XHD' })).toHaveAttribute('href', '/item/i1');
  expect(screen.queryByRole('button', { name: /^Lihat/ })).toBeNull();
});

test('tanpa hak buka merk, nama merk tampil sebagai teks biasa', async () => {
  await renderTable({ canOpenBrand: false });
  expect(screen.queryByRole('link', { name: 'Ubiquiti' })).toBeNull();
  expect(screen.getByText('Ubiquiti')).toBeInTheDocument();
});

test('kode BU menaut ke halaman BU bila berhak', async () => {
  await renderTable();
  const link = screen.getByRole('link', { name: 'RTL' });
  expect(link).toHaveAttribute('href', '/access/business-units/bu-a');
  expect(link).toHaveAttribute('title', 'Retail');
});

test('kode BU tanpa hak buka tampil sebagai lencana tanpa tautan', async () => {
  await renderTable({ canOpenBusinessUnit: false });
  expect(screen.queryByRole('link', { name: 'RTL' })).toBeNull();
  expect(screen.getByText('RTL')).toHaveAttribute('title', 'Retail');
});

test('merk terhapus diberi penanda Terhapus', async () => {
  await renderTable({ items: [{ ...(items[0] as ItemSummaryDto), brandDeleted: true }] });
  expect(screen.getByText('Terhapus')).toBeInTheDocument();
});

test('aksi baris berupa tombol ikon bernama; Hapus hanya untuk item Nonaktif', async () => {
  const { onEdit, onToggleStatus, onDelete } = await renderTable();
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Ubiquiti AF 5XHD' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan Ubiquiti AF 5XHD' }));
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan Mikrotik hAP ac2' }));
  expect(onEdit).toHaveBeenCalledWith(items[0]);
  expect(onToggleStatus).toHaveBeenNthCalledWith(1, items[0]);
  expect(onToggleStatus).toHaveBeenNthCalledWith(2, items[1]);
  expect(screen.queryByRole('button', { name: 'Hapus Ubiquiti AF 5XHD' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus Mikrotik hAP ac2' }));
  expect(onDelete).toHaveBeenCalledWith(items[1]);
});

test('hak ubah dan nonaktifkan dinilai per item', async () => {
  await renderTable({
    canEdit: (item) => item.id === 'i1',
    canManage: (item) => item.id === 'i2',
  });
  expect(screen.getByRole('button', { name: 'Ubah Ubiquiti AF 5XHD' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ubah Mikrotik hAP ac2' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan Ubiquiti AF 5XHD' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Aktifkan Mikrotik hAP ac2' })).toBeInTheDocument();
});

test('tampilan Terhapus: hanya aksi Pulihkan', async () => {
  const deleted = items.map((item) => ({
    ...item,
    status: 'inactive' as const,
    deleted: { deletedAt: '2026-11-20T00:00:00.000Z', deletedBy: 'a@x.com' },
  }));
  const { onRestore } = await renderTable({ items: deleted, deletedView: true });
  expect(screen.queryByRole('button', { name: /^Ubah/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Hapus/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Pulihkan Mikrotik hAP ac2' }));
  expect(onRestore).toHaveBeenCalledWith(deleted[1]);
});

test('daftar kosong menampilkan pesan', async () => {
  await renderTable({ items: [] });
  expect(screen.getByText('Tidak ada item yang cocok.')).toBeInTheDocument();
});

function WithSelection() {
  const selection = useRowSelection('x');
  return (
    <ItemsTable
      items={items}
      canEdit={() => true}
      canManage={() => true}
      selection={selection}
      {...handlers()}
    />
  );
}

test('checkbox baris berlabel "Pilih <merk> <tipe>" hanya bila selection diberikan', async () => {
  const { unmount } = await renderInRouter(<WithSelection />);
  expect(screen.getByRole('checkbox', { name: 'Pilih Ubiquiti AF 5XHD' })).toBeInTheDocument();
  unmount();
  await renderTable();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('tanda "Belum ada instruksi stiker" hanya pada baris tanpa instruksi', async () => {
  await renderTable();
  const marks = screen.getAllByText('Belum ada instruksi stiker');
  expect(marks).toHaveLength(1);
  expect(screen.getByRole('row', { name: /Mikrotik/ })).toContainElement(marks[0] as HTMLElement);
});

const withManualBook: ItemSummaryDto = {
  id: 'i3',
  brandId: 'b3',
  brand: 'Cisco',
  model: 'C9200',
  isCountryLock: false,
  status: 'active',
  aliases: [],
  imageCount: 0,
  hasInstructions: true,
  hasManualBook: true,
  hasPostel: false,
  businessUnits: [],
  updatedAt: '',
};

test('tanda "Belum ada QR Manual Book" hanya untuk item aktif tanpa Manual Book', async () => {
  await renderTable({ items: [...items, withManualBook] });
  const marks = screen.getAllByText('Belum ada QR Manual Book');
  expect(marks).toHaveLength(1);
  expect(screen.getByRole('row', { name: /Ubiquiti/ })).toContainElement(marks[0] as HTMLElement);
  expect(screen.getByRole('row', { name: /Mikrotik/ })).not.toHaveTextContent('QR Manual Book');
  expect(screen.getByRole('row', { name: /Cisco/ })).not.toHaveTextContent('QR Manual Book');
});

test('tanda "Belum ada Postel" hanya untuk item aktif tanpa Postel, tanpa syarat izin sticker', async () => {
  const withPostel: ItemSummaryDto = {
    ...withManualBook,
    id: 'i4',
    brand: 'Juniper',
    hasPostel: true,
  };
  await renderTable({ items: [...items, withPostel] });
  const marks = screen.getAllByText('Belum ada Postel');
  expect(marks).toHaveLength(1);
  expect(screen.getByRole('row', { name: /Ubiquiti/ })).toContainElement(marks[0] as HTMLElement);
  const juniper = screen.getByRole('row', { name: /Juniper/ });
  expect(within(juniper).queryByText('Belum ada Postel')).toBeNull();
});

test('merk terhapus tanpa hak Pulihkan: teks + Terhapus tanpa tautan', async () => {
  await renderTable({
    items: [{ ...(items[0] as ItemSummaryDto), brandDeleted: true }],
    canOpenDeletedBrand: false,
  });
  expect(screen.queryByRole('link', { name: 'Ubiquiti' })).toBeNull();
  expect(screen.getByText('Ubiquiti')).toBeInTheDocument();
  expect(screen.getByText('Terhapus')).toBeInTheDocument();
});

test('tampilan Terhapus: kolom Dihapus oleh dan Dihapus pada menggantikan Lock/Gambar/Status', async () => {
  const deleted = items.map((item) => ({
    ...item,
    status: 'inactive' as const,
    deleted: { deletedAt: '2026-11-20T03:04:00.000Z', deletedBy: 'admin@x.com' },
  }));
  await renderTable({ items: deleted, deletedView: true });
  expect(screen.getByRole('columnheader', { name: 'Dihapus oleh' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Dihapus pada' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Gambar' })).toBeNull();
  expect(screen.getAllByText('admin@x.com')).toHaveLength(2);
  expect(screen.getAllByText(/20 Nov 2026/)).toHaveLength(2);
});

test('tampilan biasa tidak memuat kolom Dihapus', async () => {
  await renderTable();
  expect(screen.queryByRole('columnheader', { name: 'Dihapus oleh' })).toBeNull();
  expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
});
