import { LEVEL_HINTS, levelHint, MODULES } from '@shared/permissions';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { toRoleFormDefaults } from '../schemas';
import { RoleForm } from './role-form';

test('nama wajib diisi', async () => {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <>
      <RoleForm formId="f" defaultValues={toRoleFormDefaults()} onSubmit={onSubmit} />
      <button type="submit" form="f">
        Simpan
      </button>
    </>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Wajib diisi')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('menampilkan arti level yang dipilih di tiap modul', async () => {
  render(
    <RoleForm formId="f" defaultValues={toRoleFormDefaults()} onSubmit={async () => undefined} />,
  );
  expect(screen.getAllByText(LEVEL_HINTS.none)).toHaveLength(MODULES.length);
  const itemGroup = screen.getByRole('group', { name: 'Level Data Item' });
  await userEvent.click(within(itemGroup).getByRole('button', { name: 'Kelola' }));
  expect(screen.getByText(levelHint('item', 'manage'))).toBeInTheDocument();
  expect(screen.getAllByText(LEVEL_HINTS.none)).toHaveLength(MODULES.length - 1);
});

test('tiap modul hanya menampilkan level yang bermakna baginya', () => {
  render(
    <RoleForm formId="f" defaultValues={toRoleFormDefaults()} onSubmit={async () => undefined} />,
  );
  const names = (module: string) =>
    within(screen.getByRole('group', { name: `Level ${module}` }))
      .getAllByRole('button')
      .map((button) => button.textContent);
  expect(names('Pengaturan Akses')).toEqual(['Tidak ada', 'Lihat', 'Kelola']);
  expect(names('Monitoring Stok')).toEqual(['Tidak ada', 'Lihat']);
  expect(names('Data Item')).toEqual(['Tidak ada', 'Lihat', 'Ubah', 'Kelola']);
});

test('matriks level per modul dikirim lengkap', async () => {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <>
      <RoleForm formId="f" defaultValues={toRoleFormDefaults()} onSubmit={onSubmit} />
      <button type="submit" form="f">
        Simpan
      </button>
    </>,
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
      permissions: {
        access: 'none',
        item: 'manage',
        qrcode: 'none',
        handover: 'none',
        qc: 'none',
        stock: 'none',
        sticker: 'none',
        stickerstock: 'none',
        serial: 'none',
        serialservice: 'none',
        serialwh: 'none',
        countrylock: 'none',
        dashboard: 'none',
      },
    }),
  );
});
