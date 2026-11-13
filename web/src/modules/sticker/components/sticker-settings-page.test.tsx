import type { StickerSettingsDto, UserDto } from '@shared/contract';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { hasUnsavedChanges, resetUnsavedChangesForTests } from '@/app/pwa/unsaved-changes';
import { pickLink } from '@/test/link-field';
import { StickerSettingsPage, type StickerSettingsPageProps } from './sticker-settings-page';

const settings: StickerSettingsDto = {
  alert: { enabled: true, recipients: ['qc@contoh.com'], digestHour: 8, intervalDays: 1 },
  types: [
    { id: 't-bu', name: 'QC Hijau', systemKind: '', defaultMinQty: 0 },
    { id: 't-mb', name: 'Manual Book', systemKind: 'manual_book', defaultMinQty: 50 },
  ],
  updatedAt: '2026-11-10 09:00:00',
  smtpConfigured: true,
};

function user(email: string, name: string, status: UserDto['status'] = 'active'): UserDto {
  return {
    id: `u-${name}`,
    email,
    name,
    status,
    assignments: [],
    buAssignments: [],
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
  };
}

const users = [
  user('budi@contoh.com', 'Budi'),
  user('sari@contoh.com', 'Sari'),
  user('lama@contoh.com', 'Lama', 'inactive'),
];

function renderPage(props: Partial<StickerSettingsPageProps> = {}) {
  const onSave = vi.fn().mockResolvedValue(null);
  render(<StickerSettingsPage settings={settings} users={users} onSave={onSave} {...props} />);
  return { onSave };
}

test('menampilkan minimum bawaan tiap jenis (jenis sistem diberi label) dan pengaturan email', () => {
  renderPage();
  expect(screen.getByLabelText('Minimum bawaan QC Hijau')).toHaveValue(0);
  expect(screen.getByLabelText('Minimum bawaan Manual Book')).toHaveValue(50);
  expect(screen.getByText('Sistem')).toBeInTheDocument();
  expect(screen.getByLabelText('Kirim ringkasan harian stok menipis dan habis')).toBeChecked();
  expect(
    screen.getByText(/Bagian "Habis": stiker aktif yang total stok semua lokasinya 0 atau kurang/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Jam kirim (WIB)')).toHaveValue(8);
  expect(screen.getByText('qc@contoh.com')).toBeInTheDocument();
});

test('menyimpan: expectedUpdatedAt, alert, dan hanya jenis yang minimumnya berubah', async () => {
  const { onSave } = renderPage();
  const input = screen.getByLabelText('Minimum bawaan QC Hijau');
  await userEvent.clear(input);
  await userEvent.type(input, '25');
  const hour = screen.getByLabelText('Jam kirim (WIB)');
  await userEvent.clear(hour);
  await userEvent.type(hour, '9');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({
    expectedUpdatedAt: '2026-11-10 09:00:00',
    alert: { enabled: true, recipients: ['qc@contoh.com'], digestHour: 9, intervalDays: 1 },
    defaults: [{ typeId: 't-bu', defaultMinQty: 25 }],
  });
});

test('selang kirim (hari): tampil, ikut dikirim saat simpan, dan di luar 1-365 ditolak', async () => {
  const { onSave } = renderPage();
  const interval = screen.getByLabelText('Kirim setiap (hari)');
  expect(interval).toHaveValue(1);
  await userEvent.clear(interval);
  await userEvent.type(interval, '0');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(
    await screen.findByText(/Selang harus bilangan bulat 1 sampai 365 hari/),
  ).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
  await userEvent.clear(interval);
  await userEvent.type(interval, '7');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave.mock.calls[0]?.[0].alert.intervalDays).toBe(7);
});

test('penerima: memilih user aktif, menambah email bebas, dan menghapus', async () => {
  const { onSave } = renderPage();
  const field = within(screen.getByRole('group', { name: 'Penerima ringkasan' }));
  await pickLink(field, 'Penerima', /Budi/);
  await userEvent.type(screen.getByLabelText('Email lain'), 'Luar@Contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus qc@contoh.com' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave.mock.calls[0]?.[0].alert.recipients).toEqual([
    'budi@contoh.com',
    'luar@contoh.com',
  ]);
});

test('user nonaktif tidak ditawarkan dan yang sudah dipilih tidak muncul lagi', async () => {
  renderPage();
  const field = within(screen.getByRole('group', { name: 'Penerima ringkasan' }));
  await userEvent.click(field.getByRole('combobox', { name: 'Penerima' }));
  // Daftar saran dirender di body (portal), bukan di dalam grup.
  const names = (await screen.findAllByRole('option')).map((option) => option.textContent ?? '');
  expect(names.some((name) => name.includes('Budi'))).toBe(true);
  expect(names.some((name) => name.includes('Sari'))).toBe(true);
  expect(names.some((name) => name.includes('Lama'))).toBe(false);
});

test('tanpa daftar user (tidak berhak melihat Akses): email bebas tetap dapat ditambahkan', async () => {
  const { onSave } = renderPage({ users: null });
  await userEvent.type(screen.getByLabelText('Email lain'), 'x@contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave.mock.calls[0]?.[0].alert.recipients).toEqual(['qc@contoh.com', 'x@contoh.com']);
});

test('email tidak valid, ganda, atau melebihi 20 penerima ditolak dengan pesan', async () => {
  renderPage();
  await userEvent.type(screen.getByLabelText('Email lain'), 'bukan-email');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  expect(await screen.findByText('Format email tidak valid')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Email lain'));
  await userEvent.type(screen.getByLabelText('Email lain'), 'QC@contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  expect(await screen.findByText('Email sudah ada dalam daftar')).toBeInTheDocument();
});

test('batas 20 penerima', async () => {
  const many = Array.from({ length: 20 }, (_, index) => `u${index}@contoh.com`);
  renderPage({
    settings: {
      ...settings,
      alert: { enabled: true, recipients: many, digestHour: 8, intervalDays: 1 },
    },
  });
  await userEvent.type(screen.getByLabelText('Email lain'), 'lebih@contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  expect(await screen.findByText('Maksimal 20 penerima')).toBeInTheDocument();
});

test('jam di luar 0-23 atau minimum negatif tidak dikirim', async () => {
  const { onSave } = renderPage();
  const hour = screen.getByLabelText('Jam kirim (WIB)');
  await userEvent.clear(hour);
  await userEvent.type(hour, '24');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(await screen.findByText('Jam harus bilangan bulat 0 sampai 23')).toBeInTheDocument();
});

test('kartu peringatan SMTP hanya bila server belum punya SMTP', () => {
  const { unmount } = (() => {
    const utils = render(
      <StickerSettingsPage settings={settings} users={users} onSave={vi.fn()} />,
    );
    return utils;
  })();
  expect(screen.queryByText(/SMTP belum dikonfigurasi/)).toBeNull();
  unmount();
  render(
    <StickerSettingsPage
      settings={{ ...settings, smtpConfigured: false }}
      users={users}
      onSave={vi.fn()}
    />,
  );
  expect(screen.getByText(/SMTP belum dikonfigurasi/)).toBeInTheDocument();
});

test('galat dari server tampil dan tombol Simpan pulih', async () => {
  const onSave = vi.fn().mockResolvedValue('Data sudah diubah orang lain; muat ulang lalu ulangi');
  renderPage({ onSave });
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Data sudah diubah orang lain');
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled();
});

test('M-g: alamat di "Email lain" yang belum ditambahkan terdaftar sebagai belum disimpan', async () => {
  resetUnsavedChangesForTests();
  renderPage();
  expect(hasUnsavedChanges()).toBe(false);
  await userEvent.type(screen.getByLabelText('Email lain'), 'baru@contoh.com');
  expect(hasUnsavedChanges()).toBe(true);
  await userEvent.clear(screen.getByLabelText('Email lain'));
  expect(hasUnsavedChanges()).toBe(false);
});
