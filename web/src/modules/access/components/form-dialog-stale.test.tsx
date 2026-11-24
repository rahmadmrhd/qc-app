import type { BusinessUnitDto, LocationDto, RoleDto, UserDto } from '@shared/contract';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api/api-error';
import { ACCESS_STALE_MESSAGE } from '../lib/stale';
import { BusinessUnitFormDialog } from './business-unit-form-dialog';
import { LocationFormDialog } from './location-form-dialog';
import { RoleFormDialog } from './role-form-dialog';
import { UserFormDialog } from './user-form-dialog';

// Form Ubah Pengguna, Role, Lokasi, dan BU mengirim `expectedUpdatedAt` dari record yang dimuat; form Tambah tidak.
// Galat basi (412, code CONFLICT) menampilkan pesan santai yang menyuruh memuat ulang (keputusan pemilik 2026-11-24).

const UPDATED_AT = '2026-11-24T01:00:00.000Z';
const staleError = () =>
  new ApiError('CONFLICT', 'Lokasi diubah orang lain; muat ulang halaman', 'req-1', undefined, {
    status: 412,
  });

const location: LocationDto = {
  id: 'l1',
  code: 'JKT',
  name: 'Jakarta',
  status: 'active',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: UPDATED_AT,
  updatedBy: 'a@x.com',
};
const businessUnit: BusinessUnitDto = {
  id: 'b1',
  code: 'RTL',
  name: 'Retail',
  status: 'active',
  itemCount: 0,
  userCount: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: UPDATED_AT,
  updatedBy: 'a@x.com',
};
const role: RoleDto = {
  id: 'r1',
  name: 'QC Staff',
  description: '',
  permissions: {},
  userCount: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: UPDATED_AT,
  updatedBy: 'a@x.com',
};
const user: UserDto = {
  id: 'u1',
  email: 'a@gmail.com',
  name: 'Ani',
  status: 'active',
  assignments: [],
  buAssignments: [],
  sharedAccount: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: UPDATED_AT,
  updatedBy: 'x@x.com',
} as UserDto;

const save = () => userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
const renameTo = async (label: string, value: string) => {
  const field = screen.getByLabelText(label);
  await userEvent.clear(field);
  await userEvent.type(field, value);
};

test('Lokasi: Ubah mengirim expectedUpdatedAt, Tambah tidak', async () => {
  const onSave = vi.fn(async (_input: unknown) => undefined);
  const { unmount } = render(
    <LocationFormDialog open onOpenChange={() => undefined} location={location} onSave={onSave} />,
  );
  await renameTo('Nama', 'Jakarta Pusat');
  await save();
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave).toHaveBeenCalledWith({
    id: 'l1',
    code: 'JKT',
    name: 'Jakarta Pusat',
    expectedUpdatedAt: UPDATED_AT,
  });
  unmount();
  const onCreate = vi.fn(async (_input: unknown) => undefined);
  render(<LocationFormDialog open onOpenChange={() => undefined} onSave={onCreate} />);
  await userEvent.type(screen.getByLabelText('Kode'), 'SBY');
  await userEvent.type(screen.getByLabelText('Nama'), 'Surabaya');
  await save();
  await waitFor(() => expect(onCreate).toHaveBeenCalled());
  expect(onCreate.mock.calls[0]?.[0]).not.toHaveProperty('expectedUpdatedAt');
  expect(onCreate.mock.calls[0]?.[0]).not.toHaveProperty('id');
});

test('Lokasi: galat basi menampilkan pesan santai muat ulang', async () => {
  const onSave = vi.fn(async (_input: unknown) => {
    throw staleError();
  });
  render(
    <LocationFormDialog open onOpenChange={() => undefined} location={location} onSave={onSave} />,
  );
  await renameTo('Nama', 'Jakarta Pusat');
  await save();
  expect(await screen.findByRole('alert')).toHaveTextContent(ACCESS_STALE_MESSAGE);
});

test('Business Unit: Ubah mengirim expectedUpdatedAt dan galat basi tampil santai', async () => {
  const onSave = vi.fn(async (_input: unknown) => {
    throw staleError();
  });
  render(
    <BusinessUnitFormDialog
      open
      onOpenChange={() => undefined}
      businessUnit={businessUnit}
      onSave={onSave}
    />,
  );
  await renameTo('Nama', 'Retail Baru');
  await save();
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave).toHaveBeenCalledWith({
    id: 'b1',
    code: 'RTL',
    name: 'Retail Baru',
    expectedUpdatedAt: UPDATED_AT,
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(ACCESS_STALE_MESSAGE);
});

test('Role: Ubah mengirim expectedUpdatedAt dan galat basi tampil santai', async () => {
  const onSave = vi.fn(async (_input: unknown) => {
    throw staleError();
  });
  render(<RoleFormDialog open onOpenChange={() => undefined} role={role} onSave={onSave} />);
  await renameTo('Nama role', 'QC Senior');
  await save();
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({
    id: 'r1',
    name: 'QC Senior',
    expectedUpdatedAt: UPDATED_AT,
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(ACCESS_STALE_MESSAGE);
});

test('Pengguna: Ubah mengirim expectedUpdatedAt dan galat basi tampil santai', async () => {
  const onSave = vi.fn(async (_input: unknown) => {
    throw staleError();
  });
  render(
    <UserFormDialog
      open
      onOpenChange={() => undefined}
      user={user}
      roles={[role]}
      locations={[location]}
      businessUnits={[{ id: 'b1', code: 'RTL', name: 'Retail', status: 'active' }]}
      onSave={onSave}
    />,
  );
  await renameTo('Nama', 'Ani Baru');
  await save();
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(onSave.mock.calls[0]?.[0]).toMatchObject({
    id: 'u1',
    name: 'Ani Baru',
    expectedUpdatedAt: UPDATED_AT,
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(ACCESS_STALE_MESSAGE);
});

// Query record dimuat ulang otomatis (polling 30 dtk, invalidasi setelah 412) saat dialog terbuka: versi yang dikirim
// harus versi saat dialog dibuka, bukan versi terbaru di prop (kalau tidak, penyimpan kedua diam-diam menimpa pertama).
const NEWER = '2026-11-24T02:00:00.000Z';

interface DialogCase {
  label: string;
  field: string;
  /** Render dialog untuk satu keadaan `open` dan record (`updatedAt` + nama) tertentu. */
  element: (
    open: boolean,
    record: { updatedAt: string; name: string },
    onSave: (input: unknown) => Promise<unknown>,
  ) => React.ReactElement;
}

const CASES: DialogCase[] = [
  {
    label: 'Lokasi',
    field: 'Nama',
    element: (open, r, onSave) => (
      <LocationFormDialog
        open={open}
        onOpenChange={() => undefined}
        location={{ ...location, ...r }}
        onSave={onSave}
      />
    ),
  },
  {
    label: 'Business Unit',
    field: 'Nama',
    element: (open, r, onSave) => (
      <BusinessUnitFormDialog
        open={open}
        onOpenChange={() => undefined}
        businessUnit={{ ...businessUnit, ...r }}
        onSave={onSave}
      />
    ),
  },
  {
    label: 'Role',
    field: 'Nama role',
    element: (open, r, onSave) => (
      <RoleFormDialog
        open={open}
        onOpenChange={() => undefined}
        role={{ ...role, ...r }}
        onSave={onSave}
      />
    ),
  },
  {
    label: 'Pengguna',
    field: 'Nama',
    element: (open, r, onSave) => (
      <UserFormDialog
        open={open}
        onOpenChange={() => undefined}
        user={{ ...user, ...r }}
        roles={[role]}
        locations={[location]}
        businessUnits={[{ id: 'b1', code: 'RTL', name: 'Retail', status: 'active' }]}
        onSave={onSave}
      />
    ),
  },
];

describe.each(CASES)('versi dibekukan saat dialog dibuka: $label', (c) => {
  const first = { updatedAt: UPDATED_AT, name: 'Awal' };
  const refreshed = { updatedAt: NEWER, name: 'Punya Admin A' };

  test('rerender dengan updatedAt baru (refetch) tetap mengirim versi awal', async () => {
    const onSave = vi.fn(async (_input: unknown) => undefined);
    const { rerender } = render(c.element(true, first, onSave));
    rerender(c.element(true, refreshed, onSave));
    await renameTo(c.field, 'Perubahan Admin B');
    await save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ expectedUpdatedAt: UPDATED_AT });
  });

  test('setelah 412 dan refetch, simpan ulang tanpa menutup dialog tetap memakai versi lama (ditolak lagi)', async () => {
    const onSave = vi.fn(async (_input: unknown) => {
      throw staleError();
    });
    const { rerender } = render(c.element(true, first, onSave));
    await renameTo(c.field, 'Perubahan Admin B');
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent(ACCESS_STALE_MESSAGE);
    // Invalidasi setelah 412 memuat versi baru ke prop; dialog yang sama tidak boleh memakainya.
    rerender(c.element(true, refreshed, onSave));
    await save();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1]?.[0]).toMatchObject({ expectedUpdatedAt: UPDATED_AT });
  });

  test('buka, tutup, buka lagi = versi segar', async () => {
    const onSave = vi.fn(async (_input: unknown) => undefined);
    const { rerender } = render(c.element(true, first, onSave));
    rerender(c.element(false, first, onSave));
    rerender(c.element(true, refreshed, onSave));
    await renameTo(c.field, 'Setelah buka ulang');
    await save();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ expectedUpdatedAt: NEWER });
  });
});
