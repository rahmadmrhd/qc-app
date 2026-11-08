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
    updatedAt: '',
  },
];

function renderTable(props: Partial<Parameters<typeof ItemsTable>[0]> = {}) {
  const handlers = { onOpen: vi.fn(), onEdit: vi.fn(), onToggleStatus: vi.fn() };
  render(
    <ItemsTable items={items} canEdit canManage pendingStatusId={null} {...handlers} {...props} />,
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
      canEdit={false}
      canManage={false}
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
  renderTable({ canEdit: true, canManage: false });
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
