import type { HandoverOptionsDto, MeDto } from '@shared/rpc';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const meMock = vi.hoisted(() => ({
  me: {
    email: 'wh@qc.local',
    name: 'WH',
    isSuperAdmin: false,
    permissions: { access: 'none', item: 'view', handover: 'none', qc: 'none', stock: 'none' },
    locations: [
      {
        id: 'loc-a',
        code: 'A',
        name: 'Lokasi A',
        permissions: { handover: 'manage', qc: 'none', stock: 'none' },
      },
    ],
  } as MeDto,
}));
vi.mock('@/modules/auth/use-me', () => ({ useMe: () => meMock.me }));
vi.mock('@/modules/location/active-locations-context', () => ({
  useActiveLocations: () => ({ selectedIds: ['loc-a'] }),
}));

import { toHandoverFormDefaults } from '../schemas';
import { HandoverForm } from './handover-form';

const options: HandoverOptionsDto = {
  items: [{ id: 'i1', brand: 'Ubiquiti', model: 'ES 24', aliases: [] }],
  customers: [{ id: 'c1', name: 'PT Maju' }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

test('mengisi customer (ketik), memilih tipe dari saran, mengatur qty, lalu menyimpan tanpa form tambahan', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <HandoverForm
      mode="create"
      defaultValues={toHandoverFormDefaults(undefined, 'loc-a')}
      options={options}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  );
  await userEvent.type(screen.getByLabelText('Customer'), 'Perusahaan Baru');
  await userEvent.type(screen.getByLabelText('Cari tipe'), 'ubiquiti');
  await userEvent.click(await screen.findByRole('option', { name: 'Ubiquiti ES 24' }));
  await userEvent.type(screen.getByLabelText('Catatan'), 'segera');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
    locationId: 'loc-a',
    customerName: 'Perusahaan Baru',
    note: 'segera',
    lines: [{ itemId: 'i1', qty: 1 }],
  });
});

test('tanpa baris: tidak mengirim dan menampilkan pesan di field baris', async () => {
  const onSubmit = vi.fn();
  render(
    <HandoverForm
      mode="create"
      defaultValues={toHandoverFormDefaults(undefined, 'loc-a')}
      options={options}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  );
  await userEvent.type(screen.getByLabelText('Customer'), 'PT A');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Minimal satu baris')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('galat dari server ditampilkan per field (customerName dan lines)', () => {
  render(
    <HandoverForm
      mode="create"
      defaultValues={toHandoverFormDefaults(undefined, 'loc-a')}
      options={options}
      fieldErrors={{
        customerName: 'Customer dinonaktifkan; aktifkan dulu di halaman Customer',
        lines: 'Baris 1: tipe tidak ditemukan',
      }}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(
    screen.getByText('Customer dinonaktifkan; aktifkan dulu di halaman Customer'),
  ).toBeInTheDocument();
  expect(screen.getByText('Baris 1: tipe tidak ditemukan')).toBeInTheDocument();
});

test('mode ubah: lokasi tampil sebagai teks (tidak dapat dipindah)', () => {
  render(
    <HandoverForm
      mode="edit"
      locationName="Lokasi A"
      defaultValues={{
        locationId: 'loc-a',
        customerName: 'PT Maju',
        note: '',
        lines: [{ itemId: 'i1', label: 'Ubiquiti ES 24', qty: 2 }],
      }}
      options={options}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText('Lokasi A')).toBeInTheDocument();
  expect(screen.queryByLabelText('Lokasi')).toBeNull();
});
