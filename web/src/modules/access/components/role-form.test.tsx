import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { toRoleFormDefaults } from '../schemas';
import { RoleForm } from './role-form';

test('nama wajib diisi', async () => {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <RoleForm
      defaultValues={toRoleFormDefaults()}
      onSubmit={onSubmit}
      onCancel={() => undefined}
    />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Wajib diisi')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('matriks level per modul dikirim lengkap', async () => {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <RoleForm
      defaultValues={toRoleFormDefaults()}
      onSubmit={onSubmit}
      onCancel={() => undefined}
    />,
  );
  await userEvent.type(screen.getByLabelText('Nama role'), ' QC Staff ');
  const itemGroup = screen.getByRole('group', { name: 'Level Data Item' });
  await userEvent.click(within(itemGroup).getByRole('button', { name: 'Kelola' }));
  expect(within(itemGroup).getByRole('button', { name: 'Kelola' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'QC Staff',
      description: '',
      permissions: { access: 'none', item: 'manage', handover: 'none', stock: 'none' },
    }),
  );
});
