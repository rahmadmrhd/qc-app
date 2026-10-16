import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('@/modules/files/use-upload-image', () => ({ useUploadImage: () => uploadMock }));
vi.mock('@/modules/files/queries', () => ({
  useFileUrl: () => ({ url: 'data:image/png;base64,AAA', isLoading: false, isError: false }),
}));

import { toItemFormDefaults } from '../schemas';
import { ItemForm } from './item-form';

function renderForm(props: Partial<Parameters<typeof ItemForm>[0]> = {}) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <ItemForm
      title="Form item"
      defaultValues={toItemFormDefaults()}
      onSubmit={onSubmit}
      onCancel={() => undefined}
      {...props}
    />,
  );
  return { onSubmit };
}

beforeEach(() => {
  uploadMock.mockReset();
});

test('merk dan tipe wajib; tidak mengirim bila kosong', async () => {
  const { onSubmit } = renderForm();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findAllByText('Wajib diisi')).toHaveLength(2);
  expect(onSubmit).not.toHaveBeenCalled();
});

test('mengirim nilai lengkap: country lock, nama lain per baris, stiker, kelengkapan, detail', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Merk'), 'Ubiquiti');
  await userEvent.type(screen.getByLabelText('Tipe'), 'ES 24 250W');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Country lock (wajib)' }));
  await userEvent.type(screen.getByLabelText('Nama lain'), 'ES24{enter}AirSwitch');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  await userEvent.type(screen.getByLabelText('Nama stiker 1'), 'Label SNI');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah kelengkapan' }));
  await userEvent.type(screen.getByLabelText('Nama kelengkapan 1'), 'Kabel daya');
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Detail dan spesifikasi' }),
    '## Spesifikasi',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({
      brand: 'Ubiquiti',
      model: 'ES 24 250W',
      isCountryLock: true,
      aliasesText: 'ES24\nAirSwitch',
      stickers: [{ name: 'Label SNI', note: '', fileId: null }],
      accessories: [{ name: 'Kabel daya', qty: 1 }],
      attachments: [],
      detail: '## Spesifikasi',
    }),
  );
});

test('pesan galat stiker dan kelengkapan bernomor tampil di bagiannya', async () => {
  renderForm();
  await userEvent.type(screen.getByLabelText('Merk'), 'A');
  await userEvent.type(screen.getByLabelText('Tipe'), 'B');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah stiker' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tambah kelengkapan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Stiker 1: nama wajib diisi')).toBeInTheDocument();
  expect(screen.getByText('Kelengkapan 1: nama wajib diisi')).toBeInTheDocument();
});

test('galat per field dari server tampil di bawah field terkait dan galat umum sebagai alert', () => {
  renderForm({
    fieldErrors: {
      model: 'Merk dan tipe sudah dipakai item lain',
      aliases: 'Nama lain "ES24" sudah dipakai item X',
    },
    submitError: 'Terjadi kesalahan',
  });
  expect(screen.getByText('Merk dan tipe sudah dipakai item lain')).toBeInTheDocument();
  expect(screen.getByText('Nama lain "ES24" sudah dipakai item X')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Terjadi kesalahan');
});

test('mode ubah memuat nilai awal', () => {
  renderForm({
    defaultValues: {
      ...toItemFormDefaults(),
      brand: 'Ubiquiti',
      model: 'AF 5XHD',
      isCountryLock: true,
      aliasesText: 'AirFiber',
      attachments: ['a', 'b'],
      detail: '# isi',
    },
  });
  expect(screen.getByLabelText('Merk')).toHaveValue('Ubiquiti');
  expect(screen.getByRole('checkbox', { name: 'Country lock (wajib)' })).toBeChecked();
  expect(screen.getByLabelText('Nama lain')).toHaveValue('AirFiber');
  expect(screen.getByText('2/10')).toBeInTheDocument();
  expect(
    within(screen.getByRole('group', { name: 'Gambar lampiran' })).getAllByRole('img'),
  ).toHaveLength(2);
});

test('merk: saran dari merk yang ada, petunjuk merk baru, dipakai ulang, dan nonaktif', async () => {
  const brands = [
    {
      id: 'b1',
      externalId: '',
      name: 'Ubiquiti',
      status: 'active' as const,
      itemCount: 1,
      updatedAt: '',
    },
    {
      id: 'b2',
      externalId: '',
      name: 'Lama',
      status: 'inactive' as const,
      itemCount: 0,
      updatedAt: '',
    },
  ];
  render(
    <ItemForm
      title="Form item"
      brands={brands}
      defaultValues={toItemFormDefaults()}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  const options = [...document.querySelectorAll('#item-brand-options option')].map((o) =>
    o.getAttribute('value'),
  );
  expect(options).toEqual(['Ubiquiti']);
  const input = screen.getByLabelText('Merk');
  await userEvent.type(input, 'Mikrotik');
  expect(screen.getByText(/Merk baru "Mikrotik" akan dibuat/)).toBeInTheDocument();
  await userEvent.clear(input);
  await userEvent.type(input, 'ubiquiti');
  expect(screen.getByText(/Memakai merk yang sudah ada: "Ubiquiti"/)).toBeInTheDocument();
  await userEvent.clear(input);
  await userEvent.type(input, 'lama');
  expect(screen.getByText(/dinonaktifkan; aktifkan dulu/)).toBeInTheDocument();
});

test('mengedit item yang merknya sudah nonaktif tidak menampilkan petunjuk menyesatkan', () => {
  const brands = [
    {
      id: 'b2',
      externalId: '',
      name: 'Lama',
      status: 'inactive' as const,
      itemCount: 1,
      updatedAt: '',
    },
  ];
  render(
    <ItemForm
      title="Form item"
      brands={brands}
      defaultValues={{ ...toItemFormDefaults(), brand: 'Lama', model: 'X' }}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.queryByText(/aktifkan dulu/)).toBeNull();
});

test('galat server pada sebuah field hilang begitu user mengoreksi field itu; field lain tetap', async () => {
  renderForm({
    defaultValues: { ...toItemFormDefaults(), brand: 'Ubiquiti', model: 'ES 24' },
    fieldErrors: { model: 'Merk dan tipe sudah dipakai item lain', aliases: 'Nama lain bentrok' },
  });
  expect(screen.getByText('Merk dan tipe sudah dipakai item lain')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Tipe'), ' V2');
  expect(screen.queryByText('Merk dan tipe sudah dipakai item lain')).toBeNull();
  expect(screen.getByText('Nama lain bentrok')).toBeInTheDocument();
});

test('galeri memberi alt yang memuat nama item', () => {
  renderForm({
    defaultValues: {
      ...toItemFormDefaults(),
      brand: 'Ubiquiti',
      model: 'ES 24',
      attachments: ['f1'],
    },
  });
  expect(screen.getByAltText('Gambar 1 Ubiquiti ES 24')).toBeInTheDocument();
});
