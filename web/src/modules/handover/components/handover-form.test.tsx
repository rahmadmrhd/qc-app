import type { HandoverOptionsDto, MeDto } from '@shared/rpc';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const meMock = vi.hoisted(() => ({
  me: {
    email: 'wh@qc.local',
    name: 'WH',
    isSuperAdmin: false,
    permissions: {
      access: 'none',
      item: 'view',
      qrcode: 'none',
      handover: 'none',
      qc: 'none',
      stock: 'none',
    },
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
vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => vi.fn() }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: null, isLoading: false, isError: true }),
}));

import { toHandoverFormDefaults } from '../schemas';
import { HandoverForm } from './handover-form';

const options: HandoverOptionsDto = {
  customers: [{ id: 'c1', name: 'PT Maju' }],
  inactiveCustomerNames: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

function renderForm(props: Partial<Parameters<typeof HandoverForm>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <HandoverForm
      title="Form task"
      mode="create"
      defaultValues={toHandoverFormDefaults(undefined, 'loc-a')}
      options={options}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
      {...props}
    />,
  );
  return { onSubmit };
}

test('form task tunggal tidak punya pemilihan item; mengirim {locationId, customerName, note}', async () => {
  const { onSubmit } = renderForm();
  expect(screen.queryByLabelText('Cari tipe')).not.toBeInTheDocument();
  expect(screen.queryByText(/qty/i)).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Customer'), 'Perusahaan Baru');
  await userEvent.click(screen.getByRole('button', { name: 'Checklist' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Catatan' }), 'RB5009');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0]?.[0]).toEqual({
    locationId: 'loc-a',
    customerName: 'Perusahaan Baru',
    note: '- [ ] RB5009',
  });
});

test('customer boleh kosong, tetapi catatan kosong ditolak dengan pesan jelas', async () => {
  const { onSubmit } = renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Catatan wajib diisi')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('customer kosong diterima bila catatan terisi', async () => {
  const { onSubmit } = renderForm({
    defaultValues: { locationId: 'loc-a', customerName: '', note: '- [ ] A = 1' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ customerName: '', note: '- [ ] A = 1' });
});

test('catatan di atas 5.000 karakter menampilkan galat tanpa mengosongkan draf', async () => {
  const { onSubmit } = renderForm({
    defaultValues: { locationId: 'loc-a', customerName: 'PT Maju', note: 'a'.repeat(5001) },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Maksimal 5000 karakter')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Customer')).toHaveValue('PT Maju');
  expect(screen.getByText('5001/5000')).toBeInTheDocument();
});

test('galat server tampil dan draf tetap ada', async () => {
  renderForm({
    submitError: 'Task sudah diubah orang lain',
    fieldErrors: { customerName: 'Customer dinonaktifkan' },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Task sudah diubah orang lain');
  expect(screen.getByText('Customer dinonaktifkan')).toBeInTheDocument();
});

test('mode ubah menampilkan nama lokasi sebagai teks', () => {
  renderForm({ mode: 'edit', locationName: 'Lokasi A' });
  expect(screen.getByText('Lokasi A')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Lokasi' })).not.toBeInTheDocument();
});
