import type { BusinessUnitDto } from '@shared/contract';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { BusinessUnitDetailView } from './business-unit-detail-view';

const bu: BusinessUnitDto = {
  id: 'bu-a',
  code: 'RTL',
  name: 'Retail',
  status: 'active',
  itemCount: 7,
  userCount: 2,
  createdAt: '2026-11-08T01:00:00.000Z',
  updatedAt: '2026-11-09T01:00:00.000Z',
  updatedBy: 'admin@gmail.com',
};

test('menampilkan nama, kode, jumlah item, dan jumlah user', () => {
  render(<BusinessUnitDetailView businessUnit={bu} onBack={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Retail' })).toBeInTheDocument();
  expect(screen.getByText('RTL')).toBeInTheDocument();
  expect(screen.getByText('7')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
});

test('BU tidak ada: pesan dan tombol kembali', async () => {
  const onBack = vi.fn();
  render(<BusinessUnitDetailView businessUnit={undefined} onBack={onBack} />);
  expect(screen.getByRole('heading', { name: 'BU tidak ditemukan' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar BU' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});
