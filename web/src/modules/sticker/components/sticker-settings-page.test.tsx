import type { PostelSettingsDto, StickerSettingsDto, UserDto } from '@shared/contract';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { hasUnsavedChanges, resetUnsavedChangesForTests } from '@/app/pwa/unsaved-changes';
import { pickLink } from '@/test/link-field';
import { addMailAddress, BCC_FIELD, CC_FIELD, TO_FIELD, typeInMailField } from '@/test/mail-lists';
import { mockMatchMedia } from '@/test/match-media';
import { renderInRouter } from '@/test/render-in-router';
import { StickerSettingsPage, type StickerSettingsPageProps } from './sticker-settings-page';

afterEach(() => {
  cleanup();
});

const settings: StickerSettingsDto = {
  alert: {
    enabled: true,
    recipients: ['qc@contoh.com'],
    cc: [],
    bcc: [],
    digestHour: 8,
    intervalDays: 1,
  },
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
    cc: [],
    bcc: [],
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

test('dua tab: Ringkasan stok (aktif) dan Peringatan Postel; tanpa tab Minimum stok; judul halaman', async () => {
  await renderPage();
  expect(screen.getByRole('heading', { level: 1, name: 'Konfigurasi Stiker' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Ringkasan stok', selected: true })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Peringatan Postel' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Minimum stok' })).toBeNull();
  expect(screen.getAllByRole('tab')).toHaveLength(2);
});

test('tidak lagi menampilkan minimum stok bawaan (diatur di form Jenis); pengaturan email tampil', async () => {
  await renderPage();
  expect(screen.queryByText(/Minimum stok bawaan/)).toBeNull();
  expect(screen.queryByLabelText(/Minimum bawaan/)).toBeNull();
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

test('menyimpan: expectedUpdatedAt dan alert saja, tanpa field defaults', async () => {
  const { onSave, onSavePostel } = await renderPage();
  const hour = digest().getByLabelText('Jam kirim (WIB)');
  await userEvent.clear(hour);
  await userEvent.type(hour, '9');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).toHaveBeenCalledWith({
    expectedUpdatedAt: '2026-11-10 09:00:00',
    alert: {
      enabled: true,
      recipients: ['qc@contoh.com'],
      cc: [],
      bcc: [],
      digestHour: 9,
      intervalDays: 1,
    },
  });
  expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('defaults');
  expect(onSavePostel).not.toHaveBeenCalled();
});

test('isian dipertahankan saat berpindah tab (pindah ke Postel lalu kembali)', async () => {
  await renderPage();
  await openTab('Ringkasan stok');
  const hour = digest().getByLabelText('Jam kirim (WIB)');
  await userEvent.clear(hour);
  await userEvent.type(hour, '11');
  await openTab('Peringatan Postel');
  await addMailAddress(TO_FIELD, 'baru@contoh.com');
  await openTab('Ringkasan stok');
  expect(digest().getByLabelText('Jam kirim (WIB)')).toHaveValue(11);
  await openTab('Peringatan Postel');
  expect(postel().getByText('baru@contoh.com')).toBeInTheDocument();
});

test('Simpan di tab Postel hanya menyimpan peringatan Postel; tab lain hanya pengaturan stok', async () => {
  const { onSave, onSavePostel } = await renderPage();
  await openTab('Peringatan Postel');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => expect(onSavePostel).toHaveBeenCalledTimes(1));
  expect(onSavePostel.mock.calls[0]?.[0].expectedUpdatedAt).toBe('2026-11-10 09:30:00');
  expect(onSave).not.toHaveBeenCalled();
});

test('galat validasi menandai tab Ringkasan stok dengan titik galat', async () => {
  const { onSave } = await renderPage();
  const hour = digest().getByLabelText('Jam kirim (WIB)');
  await userEvent.clear(hour);
  await userEvent.type(hour, '24');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(await screen.findByText('Jam harus bilangan bulat 0 sampai 23')).toBeInTheDocument();
  const tab = screen.getByRole('tab', { name: 'Ringkasan stok', selected: true });
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

test('penerima: memilih user aktif, mengetik email bebas, dan menghapus', async () => {
  const { onSave } = await renderPage();
  await openTab('Ringkasan stok');
  await pickLink(screen, TO_FIELD, /Budi/);
  await addMailAddress(TO_FIELD, 'Luar@Contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Hapus qc@contoh.com' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave.mock.calls[0]?.[0].alert.recipients).toEqual([
    'budi@contoh.com',
    'luar@contoh.com',
  ]);
});

test('CC dan BCC ikut terkirim pada payload simpan', async () => {
  const { onSave } = await renderPage();
  await openTab('Ringkasan stok');
  await addMailAddress(CC_FIELD, 'CC@contoh.com');
  await addMailAddress(BCC_FIELD, 'bcc@contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  const alert = onSave.mock.calls[0]?.[0].alert;
  expect(alert.recipients).toEqual(['qc@contoh.com']);
  expect(alert.cc).toEqual(['cc@contoh.com']);
  expect(alert.bcc).toEqual(['bcc@contoh.com']);
});

test('user nonaktif tidak ditawarkan dan yang sudah dipilih tidak muncul lagi', async () => {
  await renderPage();
  await openTab('Ringkasan stok');
  await userEvent.click(screen.getByRole('combobox', { name: TO_FIELD }));
  // Daftar saran dirender di body (portal), bukan di dalam panel.
  const names = (await screen.findAllByRole('option')).map((option) => option.textContent ?? '');
  expect(names.some((name) => name.includes('Budi'))).toBe(true);
  expect(names.some((name) => name.includes('Sari'))).toBe(true);
  expect(names.some((name) => name.includes('Lama'))).toBe(false);
  await userEvent.click(screen.getByRole('option', { name: /Budi/ }));
  // Alamat yang sudah dipilih (di daftar mana pun) tidak ditawarkan lagi.
  await userEvent.click(screen.getByRole('combobox', { name: CC_FIELD }));
  const after = (await screen.findAllByRole('option')).map((option) => option.textContent ?? '');
  expect(after.some((name) => name.includes('Budi'))).toBe(false);
  expect(after.some((name) => name.includes('Sari'))).toBe(true);
});

test('tanpa daftar user (tidak berhak melihat Akses): email bebas tetap dapat diketik', async () => {
  const { onSave } = await renderPage({ users: null });
  await openTab('Ringkasan stok');
  await addMailAddress(TO_FIELD, 'x@contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave.mock.calls[0]?.[0].alert.recipients).toEqual(['qc@contoh.com', 'x@contoh.com']);
});

test('alamat rusak tidak jadi chip dan alamat yang sudah dipilih tidak ditawarkan lagi', async () => {
  await renderPage();
  await openTab('Ringkasan stok');
  await typeInMailField(CC_FIELD, 'bukan-email');
  expect(await screen.findByText(/Ketik alamat email lengkap/)).toBeInTheDocument();
  await userEvent.clear(screen.getByRole('combobox', { name: CC_FIELD }));
  await typeInMailField(CC_FIELD, 'QC@contoh.com');
  expect(screen.queryByRole('option', { name: 'qc@contoh.com' })).not.toBeInTheDocument();
});

test('batas 20 penerima per daftar', async () => {
  const many = Array.from({ length: 20 }, (_, index) => `u${index}@contoh.com`);
  await renderPage({
    settings: {
      ...settings,
      alert: { enabled: true, recipients: many, cc: [], bcc: [], digestHour: 8, intervalDays: 1 },
    },
  });
  await openTab('Ringkasan stok');
  await userEvent.click(screen.getByRole('combobox', { name: TO_FIELD }));
  expect(await screen.findByText(/Maksimal 20 pilihan/)).toBeInTheDocument();
});

test('jam di luar 0-23 tidak dikirim', async () => {
  const { onSave } = await renderPage();
  await openTab('Ringkasan stok');
  const hour = digest().getByLabelText('Jam kirim (WIB)');
  await userEvent.clear(hour);
  await userEvent.type(hour, '24');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(await screen.findByText('Jam harus bilangan bulat 0 sampai 23')).toBeInTheDocument();
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

test('M-g: menambah alamat terdaftar sebagai belum disimpan; menghapusnya kembali melepas', async () => {
  resetUnsavedChangesForTests();
  await renderPage();
  await openTab('Ringkasan stok');
  expect(hasUnsavedChanges()).toBe(false);
  await addMailAddress(BCC_FIELD, 'baru@contoh.com');
  expect(hasUnsavedChanges()).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus baru@contoh.com' }));
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
    expect(screen.getByRole('tab', { name: 'Ringkasan stok' })).toBeInTheDocument();
    const bar = screen.getByRole('region', { name: 'Aksi form' });
    expect(within(bar).getByRole('button', { name: 'Batal' })).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole('button', { name: 'Simpan' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  } finally {
    media.restore();
  }
});
