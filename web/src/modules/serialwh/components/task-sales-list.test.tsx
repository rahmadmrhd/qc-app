import type { WarehouseTaskSaleDto } from '@shared/contract';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { TaskSalesList } from './task-sales-list';

const sale = (over: Partial<WarehouseTaskSaleDto> = {}): WarehouseTaskSaleDto => ({
  dispatchId: 'd1',
  number: 'OUT/WH/2611-0001',
  label: 'Penjualan 2026-11-20 OUT/WH/2611-0001',
  dispatchedOn: '2026-11-20',
  status: 'done',
  buId: 'bu1',
  buCode: 'WH',
  buName: 'Gudang',
  orderId: '',
  ...over,
});

test('tanpa penjualan tidak menampilkan apa pun', () => {
  const { container } = render(<TaskSalesList sales={[]} linkable />);
  expect(container).toBeEmptyDOMElement();
});

test('menampilkan nomor riwayat, BU, dan status; nomor menaut bila boleh', () => {
  render(
    <TaskSalesList
      sales={[sale(), sale({ dispatchId: 'd2', number: 'OUT/WH/2611-0002', status: 'pending' })]}
      linkable
    />,
  );
  expect(screen.getByText('Penjualan tanpa No SO tertaut task ini:')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'OUT/WH/2611-0001' })).toHaveAttribute(
    'href',
    '/serial/gudang/riwayat/d1',
  );
  expect(screen.getAllByText('WH - Gudang')).toHaveLength(2);
  expect(screen.getByText('Selesai')).toBeInTheDocument();
  expect(screen.getByText('Belum selesai')).toBeInTheDocument();
});

test('tanpa hak baca Riwayat Gudang nomor hanya teks', () => {
  render(<TaskSalesList sales={[sale()]} linkable={false} />);
  expect(screen.getByText('OUT/WH/2611-0001')).toBeInTheDocument();
  expect(screen.queryByRole('link')).toBeNull();
});
