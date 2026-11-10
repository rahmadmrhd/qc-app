import { ALL_BU_KEY } from '@shared/business-units';
import type { BusinessUnitOptionDto, LocationDto, RoleDto } from '@shared/contract';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { linkOptionNames, pickLink } from '@/test/link-field';
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
  await pickLink(screen, 'Lokasi penugasan 1', 'Semua lokasi');
  await pickLink(screen, 'Role penugasan 1', 'QC Staff');
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
  await pickLink(screen, 'Lokasi penugasan 1', 'Semua lokasi');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  const options = await linkOptionNames(screen, 'Lokasi penugasan 2');
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

test('penugasan ke lokasi yang tidak dikenal tetap tampil jelas, tidak berpindah ke opsi lain, dan idnya tetap terkirim', async () => {
  const { onSubmit } = renderForm({
    mode: 'edit',
    defaultValues: {
      email: 'a@gmail.com',
      name: 'A',
      status: 'active',
      assignments: [{ locationId: 'hilang', roleIds: ['role-qc'] }],
      buAssignments: [],
    },
  });
  expect(screen.getByRole('combobox', { name: 'Lokasi penugasan 1' })).toHaveValue(
    '(lokasi tidak dikenal)',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ assignments: [{ locationId: 'hilang', roleIds: ['role-qc'] }] }),
    ),
  );
});

async function fillBasics() {
  await userEvent.type(screen.getByLabelText('Email'), 'b@gmail.com');
  await userEvent.type(screen.getByLabelText('Nama'), 'B');
}

test('mengirim buAssignments: Semua BU menjadi null dan BU tertentu tetap id-nya', async () => {
  const { onSubmit } = renderForm();
  await fillBasics();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan BU' }));
  await pickLink(screen, 'BU penugasan 1', 'Semua BU');
  await pickLink(screen, 'Role penugasan BU 1', 'QC Staff');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan BU' }));
  await pickLink(screen, 'BU penugasan 2', 'Retail (RTL)');
  await pickLink(screen, 'Role penugasan BU 2', 'QC Staff');
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
  await pickLink(screen, 'BU penugasan 1', 'Semua BU');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan BU' }));
  const options = await linkOptionNames(screen, 'BU penugasan 2');
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
  expect(screen.getByRole('combobox', { name: 'BU penugasan 1' })).toHaveValue(
    'Lama (OLD) — nonaktif',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ buAssignments: [{ buId: 'bu-mati', roleIds: ['role-qc'] }] }),
    ),
  );
});

test('penugasan ke BU yang tidak dikenal tetap tampil jelas dan idnya tetap terkirim', async () => {
  const { onSubmit } = renderForm({
    mode: 'edit',
    defaultValues: {
      email: 'a@gmail.com',
      name: 'A',
      status: 'active',
      assignments: [],
      buAssignments: [{ buId: 'hilang', roleIds: ['role-qc'] }],
    },
  });
  expect(screen.getByRole('combobox', { name: 'BU penugasan 1' })).toHaveValue(
    '(BU tidak dikenal)',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ buAssignments: [{ buId: 'hilang', roleIds: ['role-qc'] }] }),
    ),
  );
});

test('penugasan BU: tautan Buka hanya muncul bila disediakan dan tidak untuk "Semua BU"', async () => {
  renderForm({
    mode: 'edit',
    defaultValues: {
      email: 'a@gmail.com',
      name: 'A',
      status: 'active',
      assignments: [],
      buAssignments: [
        { buId: 'bu-a', roleIds: ['role-qc'] },
        { buId: ALL_BU_KEY, roleIds: ['role-qc'] },
      ],
    },
  });
  expect(screen.queryByRole('link', { name: /Buka/ })).toBeNull();
  cleanup();
  renderForm({
    mode: 'edit',
    openBusinessUnitHref: (id) => `/access/business-units/${id}`,
    defaultValues: {
      email: 'a@gmail.com',
      name: 'A',
      status: 'active',
      assignments: [],
      buAssignments: [
        { buId: 'bu-a', roleIds: ['role-qc'] },
        { buId: ALL_BU_KEY, roleIds: ['role-qc'] },
      ],
    },
  });
  expect(screen.getByRole('link', { name: 'Buka BU penugasan 1' })).toHaveAttribute(
    'href',
    '/access/business-units/bu-a',
  );
  expect(screen.getAllByRole('link', { name: /Buka/ })).toHaveLength(1);
});
