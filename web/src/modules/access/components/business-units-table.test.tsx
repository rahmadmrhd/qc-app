import type { BusinessUnitDto } from '@shared/contract';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { BusinessUnitsTable } from './business-units-table';

function unit(overrides: Partial<BusinessUnitDto>): BusinessUnitDto {
  return {
    id: 'bu-a',
    code: 'RTL',
    name: 'Retail',
    status: 'active',
    itemCount: 0,
    userCount: 0,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
    ...overrides,
  };
}

function renderTable(
  businessUnits: BusinessUnitDto[],
  props: Partial<Parameters<typeof BusinessUnitsTable>[0]> = {},
) {
  const onToggleStatus = vi.fn();
  const onEdit = vi.fn();
  render(
    <BusinessUnitsTable
      businessUnits={businessUnits}
      canManage
      pendingStatusId={null}
      onEdit={onEdit}
      onToggleStatus={onToggleStatus}
      {...props}
    />,
  );
  return { onToggleStatus, onEdit };
}

test('menampilkan kode, nama, status, jumlah item dan jumlah user', () => {
  renderTable([
    unit({ itemCount: 12, userCount: 3 }),
    unit({ id: 'bu-b', code: 'OLD', name: 'Lama', status: 'inactive' }),
  ]);
  const row = screen.getByRole('row', { name: /Retail/ });
  expect(within(row).getByText('RTL')).toBeInTheDocument();
  expect(within(row).getByText('Aktif')).toBeInTheDocument();
  expect(within(row).getByText('12')).toBeInTheDocument();
  expect(within(row).getByText('3')).toBeInTheDocument();
  expect(
    within(screen.getByRole('row', { name: /Lama/ })).getByText('Nonaktif'),
  ).toBeInTheDocument();
});

test('tanpa access: manage kolom dan tombol aksi tidak tampil', () => {
  renderTable([unit({})], { canManage: false });
  expect(screen.queryByRole('columnheader', { name: 'Aksi' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ubah' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan' })).not.toBeInTheDocument();
});

test('menonaktifkan BU yang masih dipakai meminta konfirmasi dengan jumlah item dan user', async () => {
  const { onToggleStatus } = renderTable([unit({ itemCount: 12, userCount: 3 })]);
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('12 item');
  expect(dialog).toHaveTextContent('3 user');
  expect(onToggleStatus).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Nonaktifkan' }));
  expect(onToggleStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'bu-a' }));
});

test('membatalkan konfirmasi tidak mengubah status', async () => {
  const { onToggleStatus } = renderTable([unit({ itemCount: 1 })]);
  await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }));
  await userEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Batal' }),
  );
  expect(onToggleStatus).not.toHaveBeenCalled();
});

test('BU yang tidak dipakai langsung dinonaktifkan; mengaktifkan kembali tanpa konfirmasi', async () => {
  const { onToggleStatus } = renderTable([
    unit({}),
    unit({ id: 'bu-b', code: 'OLD', name: 'Lama', status: 'inactive', itemCount: 5, userCount: 2 }),
  ]);
  await userEvent.click(
    within(screen.getByRole('row', { name: /Retail/ })).getByRole('button', {
      name: 'Nonaktifkan',
    }),
  );
  expect(onToggleStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'bu-a' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await userEvent.click(
    within(screen.getByRole('row', { name: /Lama/ })).getByRole('button', { name: 'Aktifkan' }),
  );
  expect(onToggleStatus).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'bu-b' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('tombol Ubah memanggil onEdit', async () => {
  const { onEdit } = renderTable([unit({})]);
  await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
  expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'bu-a' }));
});
