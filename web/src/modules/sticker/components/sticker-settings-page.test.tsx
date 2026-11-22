import type { PostelSettingsDto, StickerSettingsDto, UserDto } from '@shared/contract';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { hasUnsavedChanges, resetUnsavedChangesForTests } from '@/app/pwa/unsaved-changes';
import { pickLink } from '@/test/link-field';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { StickerSettingsPage, type StickerSettingsPageProps } from './sticker-settings-page';

afterEach(() => {
  cleanup();
});

const settings: StickerSettingsDto = {
  alert: { enabled: true, recipients: ['qc@contoh.com'], digestHour: 8, intervalDays: 1 },
  types: [
    { id: 't-bu', name: 'QC Hijau', systemKind: '', defaultMinQty: 0 },
    { id: 't-mb', name: 'Manual Book', systemKind: 'manual_book', defaultMinQty: 50 },
  ],
  updatedAt: '2026-11-10 09:00:00',
  smtpConfigured: true,
};

const postelSettings: PostelSettingsDto = {
  alert: {
    enabled: false,
    recipients: [],
    sendHour: 8,
    thresholds: [90, 60, 30],
    repeatEveryDays: 7,
  },
  updatedAt: '2026-11-10 09:30:00',
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
    sharedAccount: false,
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

async function renderPage(props: Partial<StickerSettingsPageProps> = {}) {
  const onSave = vi.fn().mockResolvedValue(null);
  const onSavePostel = vi.fn().mockResolvedValue(null);
  const onCancel = vi.fn();
  await renderInRouter(
    <StickerSettingsPage
      settings={settings}
      postelSettings={postelSettings}
      users={users}
      onSave={onSave}
      onSavePostel={onSavePostel}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onSave, onSavePostel, onCancel };
}

async function openTab(name: string) {
  await userEvent.click(screen.getByRole('tab', { name }));
}

// Semua panel tab tetap ter-mount (hanya disembunyikan), jadi label yang sama di dua tab dicari lewat panel aktifnya.
const digest = () => within(screen.getByRole('tabpanel', { name: 'Ringkasan stok' }));
const postel = () => within(screen.getByRole('tabpanel', { name: 'Peringatan Postel' }));

test('tiga tab: Minimum stok (aktif), Ringkasan stok, Peringatan Postel; judul halaman', async () => {
  await renderPage();
  expect(screen.getByRole('heading', { level: 1, name: 'Konfigurasi Stiker' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Minimum stok', selected: true })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Ringkasan stok' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Peringatan Postel' })).toBeInTheDocument();
});

test('menampilkan minimum bawaan tiap jenis (jenis sistem diberi label) dan pengaturan email', async () => {
  await renderPage();
  expect(screen.getByLabelText('Minimum bawaan QC Hijau')).toHaveValue(0);
  expect(screen.getByLabelText('Minimum bawaan Manual Book')).toHaveValue(50);
  expect(screen.getByText('Sistem')).toBeInTheDocument();
  await openTab('Ringkasan stok');
  expect(screen.getByLabelText('Kirim ringkasan harian stok menipis dan habis')).toBeChecked();
  expect(
    screen.getByText(/Bagian "Habis": stiker aktif yang total stok semua lokasinya 0 atau kurang/),
  ).toBeInTheDocument();
  const explanation = screen.getByText(/Bagian "Habis"/).textContent ?? '';
  expect(explanation).toContain('apa pun minimumnya');
  expect(explanation).toContain('minimum lebih dari 0');
  expect(explanation).toContain('minimum 0 tidak pernah menipis');
  expect(explanation).toContain('Stiker nonaktif dan stiker usang (deprecated) tidak dihitung');
  expect(digest().getByLabelText('Jam kirim (WIB)')).toHaveValue(8);
  expect(screen.getByText('qc@contoh.com')).toBeInTheDocument();
});

test('menyimpan: expectedUpdatedAt, alert, dan hanya jenis yang minimumnya berubah', async () => {
  const { onSave, onSavePostel } = await renderPage();
  const input = screen.getByLabelText('Minimum bawaan QC Hijau');
  await userEvent.clear(input);
  await userEvent.type(input, '25');
  await openTab('Ringkasan stok');
  const hour = digest().getByLabelText('Jam kirim (WIB)');
  await userEvent.clear(hour);
  await userEvent.type(hour, '9');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({
    expectedUpdatedAt: '2026-11-10 09:00:00',
    alert: { enabled: true, recipients: ['qc@contoh.com'], digestHour: 9, intervalDays: 1 },
    defaults: [{ typeId: 't-bu', defaultMinQty: 25 }],
  });
  expect(onSavePostel).not.toHaveBeenCalled();
});

test('isian dipertahankan saat berpindah tab (pindah ke Postel lalu kembali)', async () => {
  await renderPage();
  const input = screen.getByLabelText('Minimum bawaan QC Hijau');
  await userEvent.clear(input);
  await userEvent.type(input, '25');
  await openTab('Peringatan Postel');
  await userEvent.type(postel().getByLabelText('Email lain'), 'baru@contoh.com');
  await openTab('Minimum stok');
  expect(screen.getByLabelText('Minimum bawaan QC Hijau')).toHaveValue(25);
  await openTab('Peringatan Postel');
  expect(postel().getByLabelText('Email lain')).toHaveValue('baru@contoh.com');
});

test('Simpan di tab Postel hanya menyimpan peringatan Postel; tab lain hanya pengaturan stok', async () => {
  const { onSave, onSavePostel } = await renderPage();
  await openTab('Peringatan Postel');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSavePostel).toHaveBeenCalledTimes(1));
  expect(onSavePostel.mock.calls[0]?.[0].expectedUpdatedAt).toBe('2026-11-10 09:30:00');
  expect(onSave).not.toHaveBeenCalled();
});

test('galat validasi di tab lain membuka tab itu dan memberi titik galat pada tabnya', async () => {
  const { onSave } = await renderPage();
  await openTab('Ringkasan stok');
  const hour = digest().getByLabelText('Jam kirim (WIB)');
  await userEvent.clear(hour);
  await userEvent.type(hour, '24');
  await openTab('Minimum stok');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(await screen.findByRole('tab', { name: 'Ringkasan stok', selected: true })).toBeVisible();
  expect(await screen.findByText('Jam harus bilangan bulat 0 sampai 23')).toBeInTheDocument();
  const tab = screen.getByRole('tab', { name: 'Ringkasan stok' });
  expect(tab.querySelector('[data-slot="tab-error-dot"]')).not.toBeNull();
});

test('selang kirim (hari): tampil, ikut dikirim saat simpan, dan di luar 1-365 ditolak', async () => {
  const { onSave } = await renderPage();
  await openTab('Ringkasan stok');
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
  const { onSave } = await renderPage();
  await openTab('Ringkasan stok');
  const field = within(screen.getByRole('group', { name: 'Penerima ringkasan' }));
  await pickLink(field, 'Penerima', /Budi/);
  await userEvent.type(digest().getByLabelText('Email lain'), 'Luar@Contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  await userEvent.click(screen.getByRole('button', { name: 'Hapus qc@contoh.com' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave.mock.calls[0]?.[0].alert.recipients).toEqual([
    'budi@contoh.com',
    'luar@contoh.com',
  ]);
});

test('user nonaktif tidak ditawarkan dan yang sudah dipilih tidak muncul lagi', async () => {
  await renderPage();
  await openTab('Ringkasan stok');
  const field = within(screen.getByRole('group', { name: 'Penerima ringkasan' }));
  await userEvent.click(field.getByRole('combobox', { name: 'Penerima' }));
  // Daftar saran dirender di body (portal), bukan di dalam grup.
  const names = (await screen.findAllByRole('option')).map((option) => option.textContent ?? '');
  expect(names.some((name) => name.includes('Budi'))).toBe(true);
  expect(names.some((name) => name.includes('Sari'))).toBe(true);
  expect(names.some((name) => name.includes('Lama'))).toBe(false);
});

test('tanpa daftar user (tidak berhak melihat Akses): email bebas tetap dapat ditambahkan', async () => {
  const { onSave } = await renderPage({ users: null });
  await openTab('Ringkasan stok');
  await userEvent.type(digest().getByLabelText('Email lain'), 'x@contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave.mock.calls[0]?.[0].alert.recipients).toEqual(['qc@contoh.com', 'x@contoh.com']);
});

test('email tidak valid, ganda, atau melebihi 20 penerima ditolak dengan pesan', async () => {
  await renderPage();
  await openTab('Ringkasan stok');
  await userEvent.type(digest().getByLabelText('Email lain'), 'bukan-email');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  expect(await screen.findByText('Format email tidak valid')).toBeInTheDocument();
  await userEvent.clear(digest().getByLabelText('Email lain'));
  await userEvent.type(digest().getByLabelText('Email lain'), 'QC@contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  expect(await screen.findByText('Email sudah ada dalam daftar')).toBeInTheDocument();
});

test('batas 20 penerima', async () => {
  const many = Array.from({ length: 20 }, (_, index) => `u${index}@contoh.com`);
  await renderPage({
    settings: {
      ...settings,
      alert: { enabled: true, recipients: many, digestHour: 8, intervalDays: 1 },
    },
  });
  await openTab('Ringkasan stok');
  await userEvent.type(digest().getByLabelText('Email lain'), 'lebih@contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  expect(await screen.findByText('Maksimal 20 penerima')).toBeInTheDocument();
});

test('jam di luar 0-23 atau minimum negatif tidak dikirim', async () => {
  const { onSave } = await renderPage();
  await openTab('Ringkasan stok');
  const hour = digest().getByLabelText('Jam kirim (WIB)');
  await userEvent.clear(hour);
  await userEvent.type(hour, '24');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(await screen.findByText('Jam harus bilangan bulat 0 sampai 23')).toBeInTheDocument();
});

test('minimum bawaan negatif ditolak dan tab Minimum stok diberi titik galat', async () => {
  const { onSave } = await renderPage();
  const input = screen.getByLabelText('Minimum bawaan QC Hijau');
  await userEvent.clear(input);
  await userEvent.type(input, '-1');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(await screen.findByText(/Minimum bawaan QC Hijau: bilangan bulat 0 sampai/)).toBeVisible();
  const tab = screen.getByRole('tab', { name: 'Minimum stok' });
  expect(tab.querySelector('[data-slot="tab-error-dot"]')).not.toBeNull();
});

test('kartu peringatan SMTP hanya bila server belum punya SMTP', async () => {
  await renderPage();
  expect(screen.queryByText(/SMTP belum dikonfigurasi/)).toBeNull();
  cleanup();
  await renderPage({ settings: { ...settings, smtpConfigured: false } });
  expect(screen.getByText(/SMTP belum dikonfigurasi/)).toBeInTheDocument();
});

test('galat dari server tampil dan tombol Simpan pulih', async () => {
  const onSave = vi.fn().mockResolvedValue('Data sudah diubah orang lain; muat ulang lalu ulangi');
  await renderPage({ onSave });
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Data sudah diubah orang lain');
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled();
});

test('M-g: alamat di "Email lain" yang belum ditambahkan terdaftar sebagai belum disimpan', async () => {
  resetUnsavedChangesForTests();
  await renderPage();
  await openTab('Ringkasan stok');
  expect(hasUnsavedChanges()).toBe(false);
  await userEvent.type(digest().getByLabelText('Email lain'), 'baru@contoh.com');
  expect(hasUnsavedChanges()).toBe(true);
  await userEvent.clear(digest().getByLabelText('Email lain'));
  expect(hasUnsavedChanges()).toBe(false);
});

test('Batal memanggil onCancel dan tidak menyimpan apa pun', async () => {
  const { onCancel, onSave, onSavePostel } = await renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
  expect(onSavePostel).not.toHaveBeenCalled();
});

test('tab terkendali: prop tab menentukan tab aktif dan perubahan dilaporkan', async () => {
  const onTabChange = vi.fn();
  await renderPage({ tab: 'postel', onTabChange });
  expect(
    screen.getByRole('tab', { name: 'Peringatan Postel', selected: true }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Ringkasan stok' }));
  expect(onTabChange).toHaveBeenLastCalledWith('ringkasan');
});

test('ponsel (360 px): tab dan bar aksi bawah (Batal, Simpan) tersedia; Simpan menyimpan', async () => {
  const media = mockMatchMedia(false);
  try {
    const { onSave } = await renderPage();
    expect(screen.getByRole('tab', { name: 'Minimum stok' })).toBeInTheDocument();
    const bar = screen.getByRole('region', { name: 'Aksi form' });
    expect(within(bar).getByRole('button', { name: 'Batal' })).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  } finally {
    media.restore();
  }
});
