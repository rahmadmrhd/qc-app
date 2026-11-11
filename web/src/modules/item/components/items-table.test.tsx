import type { ItemSummaryDto } from '@shared/contract';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ItemsTable } from './items-table';

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
    brandId: 'b1',
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

function renderTable(props: Partial<Parameters<typeof ItemsTable>[0]> = {}) {
  const handlers = { onOpen: vi.fn(), onEdit: vi.fn(), onToggleStatus: vi.fn() };
  render(
    <ItemsTable
      items={items}
      canEdit={() => true}
      canManage={() => true}
      pendingStatusId={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

test('menampilkan merk, tipe, nama lain, country lock, jumlah gambar, dan status', () => {
  renderTable();
  expect(screen.getByText('AF 5XHD')).toBeInTheDocument();
  expect(screen.getByText('AirFiber 5XHD')).toBeInTheDocument();
  expect(screen.getByText('Country lock')).toBeInTheDocument();
  expect(screen.getByText('Aktif')).toBeInTheDocument();
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
});

test('tombol aksi mengikuti izin: view hanya Lihat; edit menambah Ubah; manage menambah Nonaktifkan/Aktifkan', () => {
  const { unmount } = render(
    <ItemsTable
      items={items}
      canEdit={() => false}
      canManage={() => false}
      pendingStatusId={null}
      onOpen={() => undefined}
      onEdit={() => undefined}
      onToggleStatus={() => undefined}
    />,
  );
  expect(screen.getAllByRole('button', { name: /^Lihat/ })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /^Ubah/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Nonaktifkan|Aktifkan/ })).not.toBeInTheDocument();
  unmount();
  renderTable({ canManage: () => false });
  expect(screen.getAllByRole('button', { name: /^Ubah/ })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /Nonaktifkan|Aktifkan/ })).not.toBeInTheDocument();
});

test('memanggil handler untuk item yang dipilih', async () => {
  const { onOpen, onEdit, onToggleStatus } = renderTable();
  await userEvent.click(screen.getByRole('button', { name: 'Lihat Ubiquiti AF 5XHD' }));
  await userEvent.click(screen.getByRole('button', { name: 'Ubah Mikrotik hAP ac2' }));
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan Ubiquiti AF 5XHD' }));
  await userEvent.click(screen.getByRole('button', { name: 'Aktifkan Mikrotik hAP ac2' }));
  expect(onOpen).toHaveBeenCalledWith(items[0]);
  expect(onEdit).toHaveBeenCalledWith(items[1]);
  expect(onToggleStatus).toHaveBeenNthCalledWith(1, items[0]);
  expect(onToggleStatus).toHaveBeenNthCalledWith(2, items[1]);
});

test('daftar kosong menampilkan pesan', () => {
  renderTable({ items: [] });
  expect(screen.getByText('Tidak ada item yang cocok.')).toBeInTheDocument();
});

test('menampilkan chip BU (kode) per item', () => {
  renderTable();
  expect(screen.getByText('RTL')).toHaveAttribute('title', 'Retail');
  expect(screen.getByText('WHL')).toBeInTheDocument();
});

test('hak ubah dan nonaktifkan dinilai per item', () => {
  renderTable({ canEdit: (item) => item.id === 'i1', canManage: (item) => item.id === 'i2' });
  expect(screen.getByRole('button', { name: 'Ubah Ubiquiti AF 5XHD' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ubah Mikrotik hAP ac2' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan Ubiquiti AF 5XHD' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Aktifkan Mikrotik hAP ac2' })).toBeInTheDocument();
});

test('tanda "Belum ada instruksi stiker" hanya pada baris tanpa instruksi', () => {
  renderTable();
  const marks = screen.getAllByText('Belum ada instruksi stiker');
  expect(marks).toHaveLength(1);
  expect(screen.getByRole('row', { name: /Mikrotik/ })).toContainElement(marks[0] as HTMLElement);
});

const withManualBook: ItemSummaryDto = {
  id: 'i3',
  brandId: 'b1',
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

test('tanda "Belum ada QR Manual Book" hanya untuk item aktif tanpa Manual Book, berdampingan dengan tanda instruksi', () => {
  renderTable({ items: [...items, withManualBook] });
  const marks = screen.getAllByText('Belum ada QR Manual Book');
  expect(marks).toHaveLength(1);
  // i1 aktif tanpa Manual Book; i2 nonaktif (tanpa tanda); i3 sudah punya Manual Book
  expect(screen.getByRole('row', { name: /Ubiquiti/ })).toContainElement(marks[0] as HTMLElement);
  expect(screen.getByRole('row', { name: /Mikrotik/ })).not.toHaveTextContent('QR Manual Book');
  expect(screen.getByRole('row', { name: /Cisco/ })).not.toHaveTextContent('QR Manual Book');
  expect(screen.getByRole('row', { name: /Mikrotik/ })).toHaveTextContent(
    'Belum ada instruksi stiker',
  );
});
