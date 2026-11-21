import { ALL_BU_KEY } from '@shared/business-units';
import type { BusinessUnitOptionDto, LocationDto, RoleDto } from '@shared/contract';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { linkOptionNames, pickLink } from '@/test/link-field';
import { toUserFormDefaults } from '../schemas';
import { UserForm } from './user-form';

const role = (id: string, name: string): RoleDto => ({
  id,
  name,
  description: '',
  permissions: {},
  userCount: 0,
  createdAt: '',
  updatedAt: '',
  updatedBy: '',
});
const roles: RoleDto[] = [role('role-qc', 'QC Staff')];

const location = (id: string, code: string, name: string, status: 'active' | 'inactive') =>
  ({ id, code, name, status, createdAt: '', updatedAt: '', updatedBy: '' }) satisfies LocationDto;
const locations: LocationDto[] = [
  location('l-a', 'JKT', 'Jakarta', 'active'),
  location('l-mati', 'OLD', 'Lama', 'inactive'),
];

const businessUnits: BusinessUnitOptionDto[] = [
  { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active' },
  { id: 'bu-mati', code: 'OLD', name: 'Lama', status: 'inactive' },
];

const FORM_ID = 'user-form-test';

function renderForm(props: Partial<Parameters<typeof UserForm>[0]> = {}) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <>
      <UserForm
        formId={FORM_ID}
        mode="create"
        defaultValues={toUserFormDefaults()}
        roles={roles}
        locations={locations}
        businessUnits={businessUnits}
        onSubmit={onSubmit}
        {...props}
      />
      <button type="submit" form={FORM_ID}>
        Simpan
      </button>
    </>,
  );
  return { onSubmit };
}

const openTab = (name: string) => userEvent.click(screen.getByRole('tab', { name }));
const submit = () => userEvent.click(screen.getByRole('button', { name: 'Simpan' }));

const editDefaults = (patch: Record<string, unknown>) => ({
  email: 'a@gmail.com',
  name: 'A',
  status: 'active' as const,
  sharedAccount: false,
  assignments: [],
  buAssignments: [],
  ...patch,
});

test('form bertab: Identitas, Penugasan lokasi, Penugasan BU', () => {
  renderForm();
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Identitas',
    'Penugasan lokasi',
    'Penugasan BU',
  ]);
});

test('menampilkan error dan tidak mengirim bila field wajib kosong', async () => {
  const { onSubmit } = renderForm();
  await submit();
  expect(await screen.findAllByText('Wajib diisi')).toHaveLength(2);
  expect(onSubmit).not.toHaveBeenCalled();
});

test('menolak format email yang salah', async () => {
  renderForm();
  await userEvent.type(screen.getByLabelText('Email'), 'budi');
  await userEvent.type(screen.getByLabelText('Nama'), 'Budi');
  await submit();
  expect(await screen.findByText('Format email tidak valid')).toBeInTheDocument();
});

test('galat validasi di tab lain: tab bergalat diberi titik dan dibuka saat submit gagal', async () => {
  renderForm();
  await userEvent.type(screen.getByLabelText('Email'), 'b@gmail.com');
  await userEvent.type(screen.getByLabelText('Nama'), 'B');
  await openTab('Penugasan lokasi');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  await openTab('Identitas');
  await submit();
  expect(await screen.findByText('Penugasan 1: pilih lokasi')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /Penugasan lokasi/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(
    screen
      .getByRole('tab', { name: /Penugasan lokasi/ })
      .querySelector('[data-slot=tab-error-dot]'),
  ).not.toBeNull();
});

test('galat email dari server (fieldErrors) membuka tab Identitas dan tampil di field', async () => {
  const { onSubmit } = renderForm();
  expect(onSubmit).not.toHaveBeenCalled();
  cleanup();
  render(
    <UserForm
      formId={FORM_ID}
      mode="create"
      defaultValues={toUserFormDefaults()}
      roles={roles}
      locations={locations}
      businessUnits={businessUnits}
      fieldErrors={{ email: 'Email sudah terdaftar' }}
      onSubmit={vi.fn()}
    />,
  );
  expect(screen.getByRole('tab', { name: /Identitas/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Email sudah terdaftar')).toBeInTheDocument();
});

test('mengirim nilai yang sudah dinormalisasi, termasuk penugasan', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Email'), ' Budi@Gmail.COM ');
  await userEvent.type(screen.getByLabelText('Nama'), '  Budi ');
  await openTab('Penugasan lokasi');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  await pickLink(screen, 'Lokasi penugasan 1', 'Semua lokasi');
  await pickLink(screen, 'Role penugasan 1', 'QC Staff');
  await submit();
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      email: 'budi@gmail.com',
      name: 'Budi',
      status: 'active',
      sharedAccount: false,
      assignments: [{ locationId: null, roleIds: ['role-qc'] }],
      buAssignments: [],
    }),
  );
});

test('lokasi yang sudah dipakai tidak ditawarkan lagi pada penugasan lain; lokasi nonaktif tidak ditawarkan', async () => {
  renderForm();
  await openTab('Penugasan lokasi');
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
  await openTab('Penugasan lokasi');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  await submit();
  expect(await screen.findByText('Penugasan 1: pilih lokasi')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Hapus penugasan 1' }));
  expect(screen.queryByRole('group', { name: 'Penugasan 1' })).not.toBeInTheDocument();
});

test('email terkunci saat edit dan pesan error server ditampilkan', () => {
  renderForm({ mode: 'edit', submitError: 'Gagal menyimpan pengguna' });
  expect(screen.getByLabelText('Email')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('Gagal menyimpan pengguna');
});

test('lokasi TERHAPUS pada penugasan tampil bertanda, tidak dapat dipilih ulang, dan idnya tetap terkirim (T1)', async () => {
  const { onSubmit } = renderForm({
    mode: 'edit',
    deletedNames: {
      roles: new Map(),
      locations: new Map([['hilang', 'Gudang Lama']]),
      businessUnits: new Map(),
    },
    defaultValues: editDefaults({ assignments: [{ locationId: 'hilang', roleIds: ['role-qc'] }] }),
  });
  await openTab('Penugasan lokasi');
  expect(screen.getByRole('combobox', { name: 'Lokasi penugasan 1' })).toHaveValue(
    'Gudang Lama (Terhapus)',
  );
  await submit();
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ assignments: [{ locationId: 'hilang', roleIds: ['role-qc'] }] }),
    ),
  );
});

test('lokasi terhapus tanpa nama yang diketahui tampil dengan nama umum + Terhapus', async () => {
  renderForm({
    mode: 'edit',
    defaultValues: editDefaults({ assignments: [{ locationId: 'hilang', roleIds: ['role-qc'] }] }),
  });
  await openTab('Penugasan lokasi');
  expect(screen.getByRole('combobox', { name: 'Lokasi penugasan 1' })).toHaveValue(
    'Lokasi (Terhapus)',
  );
});

test('role TERHAPUS pada penugasan tampil sebagai chip "Terhapus" dan tetap terkirim; yang hidup tetap ditawarkan', async () => {
  const { onSubmit } = renderForm({
    mode: 'edit',
    deletedNames: {
      roles: new Map([['role-del', 'Admin Lama']]),
      locations: new Map(),
      businessUnits: new Map(),
    },
    defaultValues: editDefaults({
      assignments: [{ locationId: '*', roleIds: ['role-qc', 'role-del'] }],
    }),
  });
  await openTab('Penugasan lokasi');
  expect(screen.getByText('Admin Lama (Terhapus)')).toBeInTheDocument();
  await submit();
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        assignments: [{ locationId: null, roleIds: ['role-qc', 'role-del'] }],
      }),
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
  await openTab('Penugasan BU');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan BU' }));
  await pickLink(screen, 'BU penugasan 1', 'Semua BU');
  await pickLink(screen, 'Role penugasan BU 1', 'QC Staff');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan BU' }));
  await pickLink(screen, 'BU penugasan 2', 'Retail (RTL)');
  await pickLink(screen, 'Role penugasan BU 2', 'QC Staff');
  await submit();
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      email: 'b@gmail.com',
      name: 'B',
      status: 'active',
      sharedAccount: false,
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
  await openTab('Penugasan BU');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan BU' }));
  await submit();
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
  await openTab('Penugasan BU');
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
    defaultValues: editDefaults({ buAssignments: [{ buId: 'bu-mati', roleIds: ['role-qc'] }] }),
  });
  await openTab('Penugasan BU');
  expect(screen.getByRole('combobox', { name: 'BU penugasan 1' })).toHaveValue(
    'Lama (OLD) — nonaktif',
  );
  await submit();
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ buAssignments: [{ buId: 'bu-mati', roleIds: ['role-qc'] }] }),
    ),
  );
});

test('penugasan ke BU TERHAPUS tampil bertanda dan idnya tetap terkirim (BU terhapus tetap memberi hak)', async () => {
  const { onSubmit } = renderForm({
    mode: 'edit',
    deletedNames: {
      roles: new Map(),
      locations: new Map(),
      businessUnits: new Map([['hilang', 'Wholesale']]),
    },
    defaultValues: editDefaults({ buAssignments: [{ buId: 'hilang', roleIds: ['role-qc'] }] }),
  });
  await openTab('Penugasan BU');
  expect(screen.getByRole('combobox', { name: 'BU penugasan 1' })).toHaveValue(
    'Wholesale (Terhapus)',
  );
  await submit();
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ buAssignments: [{ buId: 'hilang', roleIds: ['role-qc'] }] }),
    ),
  );
});

test('BU terhapus pada daftar opsi (deleted) tidak ditawarkan untuk pilihan baru', async () => {
  renderForm({
    businessUnits: [
      ...businessUnits,
      { id: 'bu-x', code: 'DEL', name: 'Dihapus', status: 'active', deleted: true },
    ],
  });
  await openTab('Penugasan BU');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan BU' }));
  const options = await linkOptionNames(screen, 'BU penugasan 1');
  expect(options.join(' ')).not.toContain('Dihapus');
});

test('tautan Buka: lokasi dan BU hanya bila disediakan, tidak untuk "Semua ..."', async () => {
  const defaults = editDefaults({
    assignments: [
      { locationId: 'l-a', roleIds: ['role-qc'] },
      { locationId: '*', roleIds: ['role-qc'] },
    ],
    buAssignments: [
      { buId: 'bu-a', roleIds: ['role-qc'] },
      { buId: ALL_BU_KEY, roleIds: ['role-qc'] },
    ],
  });
  renderForm({ mode: 'edit', defaultValues: defaults });
  await openTab('Penugasan lokasi');
  expect(screen.queryByRole('link', { name: /Buka/ })).toBeNull();
  cleanup();
  renderForm({
    mode: 'edit',
    openBusinessUnitHref: (id) => `/access/business-units/${id}`,
    openLocationHref: (id) => `/access/locations/${id}`,
    openRoleHref: (id) => `/access/roles/${id}`,
    defaultValues: defaults,
  });
  await openTab('Penugasan lokasi');
  expect(screen.getByRole('link', { name: 'Buka Lokasi penugasan 1' })).toHaveAttribute(
    'href',
    '/access/locations/l-a',
  );
  expect(screen.queryByRole('link', { name: 'Buka Lokasi penugasan 2' })).toBeNull();
  await openTab('Penugasan BU');
  expect(screen.getByRole('link', { name: 'Buka BU penugasan 1' })).toHaveAttribute(
    'href',
    '/access/business-units/bu-a',
  );
  expect(screen.queryByRole('link', { name: 'Buka BU penugasan 2' })).toBeNull();
});

test('Tambah lokasi dari baris penugasan membuka dialog di luar form dan memilih hasilnya', async () => {
  const onCreateLocation = vi.fn().mockResolvedValue(location('l-baru', 'NEW', 'Baru', 'active'));
  const { onSubmit } = renderForm({ onCreateLocation });
  await fillBasics();
  await openTab('Penugasan lokasi');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  await userEvent.click(screen.getByRole('combobox', { name: 'Lokasi penugasan 1' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Tambah Lokasi penugasan 1' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah lokasi' });
  // Dialog dirender di luar <form> pengguna: tombol Simpan-nya tidak men-submit form pengguna.
  expect(dialog.closest('form')).toBeNull();
  await userEvent.type(within(dialog).getByLabelText('Kode'), 'NEW');
  await userEvent.type(within(dialog).getByLabelText('Nama'), 'Baru');
  await userEvent.click(within(dialog).getByRole('button', { name: /Simpan/ }));
  await waitFor(() => expect(onCreateLocation).toHaveBeenCalledWith({ code: 'NEW', name: 'Baru' }));
  expect(onSubmit).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog', { name: 'Tambah lokasi' })).toBeNull(),
  );
  expect(screen.getByRole('combobox', { name: 'Lokasi penugasan 1' })).toHaveValue('Baru (NEW)');
});

test('Tambah role dari baris penugasan membuka dialog role dan menambahkannya ke baris itu', async () => {
  const onCreateRole = vi.fn().mockResolvedValue(role('role-baru', 'Role Baru'));
  renderForm({ onCreateRole });
  await openTab('Penugasan BU');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan BU' }));
  await userEvent.click(screen.getByRole('combobox', { name: 'Role penugasan BU 1' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Tambah Role penugasan BU 1' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Tambah role' });
  await userEvent.type(within(dialog).getByLabelText('Nama role'), 'Role Baru');
  await userEvent.click(within(dialog).getByRole('button', { name: /Simpan/ }));
  await waitFor(() => expect(onCreateRole).toHaveBeenCalledTimes(1));
  expect(onCreateRole.mock.calls[0]?.[0]).toMatchObject({ name: 'Role Baru' });
  expect(await screen.findByText('Role Baru')).toBeInTheDocument();
});

test('Escape pada dialog Tambah bertumpuk menutup dialog teratas saja', async () => {
  renderForm({ onCreateLocation: vi.fn() });
  await openTab('Penugasan lokasi');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  await userEvent.click(screen.getByRole('combobox', { name: 'Lokasi penugasan 1' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Tambah Lokasi penugasan 1' }));
  await screen.findByRole('alertdialog', { name: 'Tambah lokasi' });
  await userEvent.keyboard('{Escape}');
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog', { name: 'Tambah lokasi' })).toBeNull(),
  );
  // Form pengguna di belakangnya tetap ada.
  expect(screen.getByRole('button', { name: 'Tambah penugasan' })).toBeInTheDocument();
});

test('baris Tambah dan tautan Buka tidak ada tanpa izin', async () => {
  renderForm();
  await openTab('Penugasan lokasi');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah penugasan' }));
  await userEvent.click(screen.getByRole('combobox', { name: 'Lokasi penugasan 1' }));
  expect(screen.queryByRole('option', { name: /^Tambah / })).toBeNull();
});

test('opsi Akun bersama tampil dengan keterangan dan terkirim saat dicentang', async () => {
  const { onSubmit } = renderForm();
  const checkbox = screen.getByRole('checkbox', { name: 'Akun bersama' });
  expect(checkbox).not.toBeChecked();
  expect(screen.getByText(/Panduan ditampilkan ulang di tiap perangkat/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Email'), 'bersama@gmail.com');
  await userEvent.type(screen.getByLabelText('Nama'), 'Meja QC');
  await userEvent.click(checkbox);
  await submit();
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ sharedAccount: true })),
  );
});

test('Akun bersama terpasang dari defaultValues saat edit', () => {
  renderForm({
    mode: 'edit',
    defaultValues: {
      ...toUserFormDefaults(),
      email: 'a@gmail.com',
      name: 'A',
      sharedAccount: true,
    },
  });
  expect(screen.getByRole('checkbox', { name: 'Akun bersama' })).toBeChecked();
});
