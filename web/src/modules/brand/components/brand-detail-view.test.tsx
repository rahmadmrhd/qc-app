import type { BrandDto, BusinessUnitOptionDto } from '@shared/contract';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { BrandDetailView } from './brand-detail-view';

const brand: BrandDto = {
  id: 'b1',
  name: 'Ubiquiti',
  status: 'inactive',
  itemCount: 3,
  updatedAt: '2026-11-09T01:00:00.000Z',
  businessUnitIds: ['bu-a'],
};
const businessUnits: BusinessUnitOptionDto[] = [
  { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active' },
];

test('menampilkan nama, status, jumlah item, dan BU bawaan', () => {
  render(<BrandDetailView brand={brand} businessUnits={businessUnits} onBack={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Ubiquiti' })).toBeInTheDocument();
  expect(screen.getByText('Nonaktif')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.getByText('RTL')).toBeInTheDocument();
});

test('merk tidak ada: pesan dan tombol kembali', async () => {
  const onBack = vi.fn();
  render(<BrandDetailView brand={undefined} businessUnits={[]} onBack={onBack} />);
  expect(screen.getByRole('heading', { name: 'Merk tidak ditemukan' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar merk' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});
