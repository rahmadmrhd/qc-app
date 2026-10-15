import type { HandoverSummaryDto } from '@shared/rpc';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { HandoversTable } from './handovers-table';

const rows: HandoverSummaryDto[] = [
  {
    id: 'h1',
    number: 'ST-20261015-001',
    locationId: 'a',
    customerId: 'c',
    customerName: 'PT Maju',
    note: '',
    status: 'in_progress',
    lineCount: 2,
    doneUnits: 12,
    totalUnits: 20,
    createdAt: '2026-10-15T03:00:00.000Z',
    updatedAt: '',
  },
  {
    id: 'h2',
    number: 'ST-20261014-001',
    locationId: 'b',
    customerId: 'c',
    customerName: 'Budi',
    note: '',
    status: 'cancelled',
    lineCount: 1,
    doneUnits: 0,
    totalUnits: 3,
    createdAt: '2026-10-14T03:00:00.000Z',
    updatedAt: '',
  },
];
const locations = new Map([
  ['a', 'Lokasi A'],
  ['b', 'Lokasi B'],
]);

test('menampilkan nomor, customer, ringkasan progres "12/20 unit", dan status berlabel', () => {
  render(
    <HandoversTable
      handovers={rows}
      showLocation={false}
      locationNames={locations}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText('ST-20261015-001')).toBeInTheDocument();
  expect(screen.getByText('PT Maju')).toBeInTheDocument();
  expect(screen.getByText('12/20 unit')).toBeInTheDocument();
  expect(screen.getByText('Dikerjakan')).toBeInTheDocument();
  expect(screen.getByText('Dibatalkan')).toBeInTheDocument();
  expect(screen.queryByText('Lokasi A')).toBeNull();
});

test('kolom Lokasi hanya bila lebih dari satu lokasi terpilih; klik baris membuka detail', async () => {
  const onOpen = vi.fn();
  render(
    <HandoversTable handovers={rows} showLocation locationNames={locations} onOpen={onOpen} />,
  );
  expect(screen.getByText('Lokasi A')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Buka ST-20261015-001' }));
  expect(onOpen).toHaveBeenCalledWith(rows[0]);
});

test('daftar kosong menampilkan pesan', () => {
  render(
    <HandoversTable
      handovers={[]}
      showLocation={false}
      locationNames={locations}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText('Tidak ada task yang cocok.')).toBeInTheDocument();
});

test('task tanpa customer menampilkan strip', () => {
  render(
    <HandoversTable
      handovers={[{ ...rows[0], customerId: '', customerName: '' } as (typeof rows)[number]]}
      showLocation={false}
      locationNames={locations}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText('—')).toBeInTheDocument();
});
