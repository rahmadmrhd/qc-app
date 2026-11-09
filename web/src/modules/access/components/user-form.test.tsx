import type { BusinessUnitOptionDto, LocationDto, RoleDto } from '@shared/contract';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { toUserFormDefaults } from '../schemas';
import { UserForm } from './user-form';

const roles: RoleDto[] = [
  {
    id: 'role-qc',
    name: 'QC Staff',
    description: '',
    permissions: {},
    userCount: 0,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
  },
];

const locations: LocationDto[] = [
  {
    id: 'l-a',
    code: 'JKT',
    name: 'Jakarta',
    status: 'active',
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
  },
  {
    id: 'l-mati',
    code: 'OLD',
    name: 'Lama',
    status: 'inactive',
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
  },
];

const businessUnits: BusinessUnitOptionDto[] = [
  { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active' },
  { id: 'bu-mati', code: 'OLD', name: 'Lama', status: 'inactive' },
];

function renderForm(props: Partial<Parameters<typeof UserForm>[0]> = {}) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <UserForm
      mode="create"
      defaultValues={toUserFormDefaults()}
      roles={roles}
      locations={locations}
      businessUnits={businessUnits}
      onSubmit={onSubmit}
      onCancel={() => undefined}
      {...props}
    />,
  );
  return { onSubmit };
}
test('menampilkan error dan tidak mengirim bila field wajib kosong', async () => {
  const { onSubmit } = renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findAllByText('Wajib diisi')).toHaveLength(2);
  expect(onSubmit).not.toHaveBeenCalled();
});

test('menolak format email yang salah', async () => {
  renderForm();
  await userEvent.type(screen.getByLabelText('Email'), 'budi');
  await userEvent.type(screen.getByLabelText('Nama'), 'Budi');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Format email tidak valid')).toBeInTheDocument();
});

test('mengirim nilai yang sudah dinormalisasi, termasuk penugasan', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Email'), ' Budi@Gmail.COM ');
  await userEvent.type(screen.getByLabelText('Nama'), '  Budi ');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  await userEvent.selectOptions(screen.getByLabelText('Lokasi penugasan 1'), 'Semua lokasi');
  const row = screen.getByRole('group', { name: 'Penugasan 1' });
  await userEvent.click(within(row).getByRole('checkbox', { name: 'QC Staff' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      email: 'budi@gmail.com',
      name: 'Budi',
      status: 'active',
      assignments: [{ locationId: null, roleIds: ['role-qc'] }],
      buAssignments: [],
    }),
  );
});

test('lokasi yang sudah dipakai tidak ditawarkan lagi pada penugasan lain; lokasi nonaktif tidak ditawarkan', async () => {
  renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  await userEvent.selectOptions(screen.getByLabelText('Lokasi penugasan 1'), 'Semua lokasi');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  const options = within(screen.getByLabelText('Lokasi penugasan 2'))
    .getAllByRole('option')
    .map((option) => option.textContent);
  expect(options).not.toContain('Semua lokasi');
  expect(options).toContain('Jakarta (JKT)');
  expect(options.join(' ')).not.toContain('Lama');
});

test('penugasan dapat dihapus dan pesan error penugasan tampil', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Email'), 'b@gmail.com');
  await userEvent.type(screen.getByLabelText('Nama'), 'B');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Penugasan 1: pilih lokasi')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus penugasan 1' }));
  expect(screen.queryByRole('group', { name: 'Penugasan 1' })).not.toBeInTheDocument();
});

test('email terkunci saat edit dan pesan error server ditampilkan', () => {
  renderForm({ mode: 'edit', submitError: 'Email sudah terdaftar' });
  expect(screen.getByLabelText('Email')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Email sudah terdaftar');
});

test('penugasan ke lokasi yang tidak dikenal tetap tampil jelas, tidak berpindah ke opsi lain', () => {
  renderForm({
    mode: 'edit',
    defaultValues: {
      email: 'a@gmail.com',
      name: 'A',
      status: 'active',
      assignments: [{ locationId: 'hilang', roleIds: ['role-qc'] }],
      buAssignments: [],
    },
  });
  const select = screen.getByLabelText('Lokasi penugasan 1');
  expect(select).toHaveValue('hilang');
  expect(
    within(select).getByRole('option', { name: '(lokasi tidak dikenal)' }),
  ).toBeInTheDocument();
});

async function fillBasics() {
  await userEvent.type(screen.getByLabelText('Email'), 'b@gmail.com');
  await userEvent.type(screen.getByLabelText('Nama'), 'B');
}

test('mengirim buAssignments: Semua BU menjadi null dan BU tertentu tetap id-nya', async () => {
  const { onSubmit } = renderForm();
  await fillBasics();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan BU' }));
  await userEvent.selectOptions(screen.getByLabelText('BU penugasan 1'), 'Semua BU');
  await userEvent.click(
    within(screen.getByRole('group', { name: 'Penugasan BU 1' })).getByRole('checkbox', {
      name: 'QC Staff',
    }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan BU' }));
  await userEvent.selectOptions(screen.getByLabelText('BU penugasan 2'), 'Retail (RTL)');
  await userEvent.click(
    within(screen.getByRole('group', { name: 'Penugasan BU 2' })).getByRole('checkbox', {
      name: 'QC Staff',
    }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      email: 'b@gmail.com',
      name: 'B',
      status: 'active',
      assignments: [],
      buAssignments: [
        { buId: null, roleIds: ['role-qc'] },
        { buId: 'bu-a', roleIds: ['role-qc'] },
      ],
    }),
  );
});

test('penugasan BU tanpa role atau tanpa BU ditolak dengan pesan bernomor', async () => {
  const { onSubmit } = renderForm();
  await fillBasics();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan BU' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Penugasan BU 1: pilih BU')).toBeInTheDocument();
  expect(
    screen.getByText('Penugasan BU 1: pilih minimal satu role atau hapus penugasannya'),
  ).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus penugasan BU 1' }));
  expect(screen.queryByRole('group', { name: 'Penugasan BU 1' })).not.toBeInTheDocument();
});

test('BU yang sudah dipakai atau nonaktif tidak ditawarkan pada penugasan BU lain', async () => {
  renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan BU' }));
  await userEvent.selectOptions(screen.getByLabelText('BU penugasan 1'), 'Semua BU');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan BU' }));
  const options = within(screen.getByLabelText('BU penugasan 2'))
    .getAllByRole('option')
    .map((option) => option.textContent);
  expect(options).not.toContain('Semua BU');
  expect(options).toContain('Retail (RTL)');
  expect(options.join(' ')).not.toContain('Lama');
});

test('penugasan BU nonaktif yang sudah ada tampil dengan label nonaktif dan ikut terkirim', async () => {
  const { onSubmit } = renderForm({
    mode: 'edit',
    defaultValues: {
      email: 'a@gmail.com',
      name: 'A',
      status: 'active',
      assignments: [],
      buAssignments: [{ buId: 'bu-mati', roleIds: ['role-qc'] }],
    },
  });
  const select = screen.getByLabelText('BU penugasan 1');
  expect(select).toHaveValue('bu-mati');
  expect(within(select).getByRole('option', { name: 'Lama (OLD) — nonaktif' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ buAssignments: [{ buId: 'bu-mati', roleIds: ['role-qc'] }] }),
    ),
  );
});

test('penugasan ke BU yang tidak dikenal tetap tampil jelas', () => {
  renderForm({
    mode: 'edit',
    defaultValues: {
      email: 'a@gmail.com',
      name: 'A',
      status: 'active',
      assignments: [],
      buAssignments: [{ buId: 'hilang', roleIds: ['role-qc'] }],
    },
  });
  const select = screen.getByLabelText('BU penugasan 1');
  expect(select).toHaveValue('hilang');
  expect(within(select).getByRole('option', { name: '(BU tidak dikenal)' })).toBeInTheDocument();
});
