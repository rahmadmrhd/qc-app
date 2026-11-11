import type { PostelSettingsDto, UserDto } from '@shared/contract';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
import { PostelAlertSettings, type PostelAlertSettingsProps } from './postel-alert-settings';

const settings: PostelSettingsDto = {
  alert: {
    enabled: true,
    recipients: ['qc@contoh.com'],
    sendHour: 8,
    thresholds: [90, 60, 30],
    repeatEveryDays: 7,
  },
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

const users = [user('budi@contoh.com', 'Budi'), user('lama@contoh.com', 'Lama', 'inactive')];

function renderSettings(props: Partial<PostelAlertSettingsProps> = {}) {
  const onSave = vi.fn().mockResolvedValue(null);
  render(<PostelAlertSettings settings={settings} users={users} onSave={onSave} {...props} />);
  return { onSave };
}

const save = () =>
  userEvent.click(screen.getByRole('button', { name: 'Simpan peringatan Postel' }));

test('menampilkan nilai awal dari settings', () => {
  renderSettings();
  expect(
    screen.getByRole('heading', { name: 'Peringatan masa berlaku Postel' }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Kirim email peringatan masa berlaku Postel')).toBeChecked();
  expect(screen.getByRole('combobox', { name: 'Jam kirim (WIB)' })).toHaveValue('08:00 WIB');
  expect(screen.getByLabelText('Pengingat 1 (hari sebelum habis)')).toHaveValue(90);
  expect(screen.getByLabelText('Pengingat 2 (hari sebelum habis)')).toHaveValue(60);
  expect(screen.getByLabelText('Pengingat 3 (hari sebelum habis)')).toHaveValue(30);
  expect(screen.getByLabelText('Ulangi setiap (hari)')).toHaveValue(7);
  expect(screen.getByText('qc@contoh.com')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('peringatan SMTP (role=status) hanya bila smtpConfigured false', () => {
  renderSettings({ settings: { ...settings, smtpConfigured: false } });
  expect(screen.getByRole('status')).toHaveTextContent('SMTP belum dikonfigurasi');
});

test('ambang ke-6 tak dapat ditambahkan (maksimal 5)', async () => {
  renderSettings({
    settings: { ...settings, alert: { ...settings.alert, thresholds: [100, 90, 60, 30, 14] } },
  });
  expect(screen.getByRole('button', { name: 'Tambah pengingat' })).toBeDisabled();
  expect(screen.queryByLabelText('Pengingat 6 (hari sebelum habis)')).not.toBeInTheDocument();
});

test('Tambah pengingat menambah baris kosong; Hapus pengingat menghapus', async () => {
  renderSettings();
  await userEvent.click(screen.getByRole('button', { name: 'Tambah pengingat' }));
  expect(screen.getByLabelText('Pengingat 4 (hari sebelum habis)')).toHaveValue(null);
  await userEvent.click(screen.getByRole('button', { name: 'Hapus pengingat 4' }));
  expect(screen.queryByLabelText('Pengingat 4 (hari sebelum habis)')).not.toBeInTheDocument();
});

test.each([
  ['0', 'Pengingat 3: bilangan bulat 1 sampai 730'],
  ['731', 'Pengingat 3: bilangan bulat 1 sampai 730'],
  ['60', 'Pengingat tidak boleh kembar'],
  ['', 'Pengingat 3: bilangan bulat 1 sampai 730'],
])('pengingat bernilai "%s" menolak simpan', async (value, message) => {
  const { onSave } = renderSettings();
  const input = screen.getByLabelText('Pengingat 3 (hari sebelum habis)');
  await userEvent.clear(input);
  if (value !== '') await userEvent.type(input, value);
  await save();
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});

test('tanpa pengingat sama sekali menolak simpan', async () => {
  const { onSave } = renderSettings({
    settings: { ...settings, alert: { ...settings.alert, thresholds: [30] } },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Hapus pengingat 1' }));
  await save();
  expect(await screen.findByText('Isi minimal satu pengingat')).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});

test('ulangi setiap di luar 0-365 menolak simpan', async () => {
  const { onSave } = renderSettings();
  const input = screen.getByLabelText('Ulangi setiap (hari)');
  await userEvent.clear(input);
  await userEvent.type(input, '366');
  await save();
  expect(await screen.findByText('Ulangi setiap: bilangan bulat 0 sampai 365')).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});

test('simpan mengirim ambang menurun, jam, ulangi, dan penerima (user dan email lain)', async () => {
  const { onSave } = renderSettings({
    settings: { ...settings, alert: { ...settings.alert, thresholds: [30, 90, 60] } },
  });
  await pickSelect('Jam kirim (WIB)', '09:00 WIB');
  const repeat = screen.getByLabelText('Ulangi setiap (hari)');
  await userEvent.clear(repeat);
  await userEvent.type(repeat, '0');
  const field = within(screen.getByRole('group', { name: 'Penerima peringatan Postel' }));
  await pickLink(field, 'Penerima peringatan Postel', /Budi/);
  await userEvent.type(screen.getByLabelText('Email lain'), 'Luar@Contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  await save();
  expect(onSave).toHaveBeenCalledWith({
    expectedUpdatedAt: '2026-11-10 09:00:00',
    alert: {
      enabled: true,
      recipients: ['qc@contoh.com', 'budi@contoh.com', 'luar@contoh.com'],
      sendHour: 9,
      thresholds: [90, 60, 30],
      repeatEveryDays: 0,
    },
  });
});

async function pickSelect(name: string, option: string) {
  await pickLink(screen, name, option);
}

test('saklar dapat dimatikan', async () => {
  const { onSave } = renderSettings();
  await userEvent.click(screen.getByLabelText('Kirim email peringatan masa berlaku Postel'));
  await save();
  expect(onSave.mock.calls[0]?.[0].alert.enabled).toBe(false);
});

test('email rusak atau ganda menolak penambahan', async () => {
  renderSettings();
  await userEvent.type(screen.getByLabelText('Email lain'), 'bukan-email');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  expect(await screen.findByText('Format email tidak valid')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Email lain'));
  await userEvent.type(screen.getByLabelText('Email lain'), 'QC@contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  expect(await screen.findByText('Email sudah ada dalam daftar')).toBeInTheDocument();
});

test('maksimal 20 penerima', async () => {
  const many = Array.from({ length: 20 }, (_, i) => `u${i}@contoh.com`);
  renderSettings({ settings: { ...settings, alert: { ...settings.alert, recipients: many } } });
  await userEvent.type(screen.getByLabelText('Email lain'), 'baru@contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  expect(await screen.findByText('Maksimal 20 penerima')).toBeInTheDocument();
});

test('onSave mengembalikan teks galat => tampil sebagai alert', async () => {
  renderSettings({ onSave: vi.fn().mockResolvedValue('Data sudah diubah orang lain') });
  await save();
  expect(await screen.findByRole('alert')).toHaveTextContent('Data sudah diubah orang lain');
});

test('pesan galat dihubungkan ke inputnya lewat aria-describedby', async () => {
  renderSettings();
  const threshold = screen.getByLabelText('Pengingat 3 (hari sebelum habis)');
  await userEvent.clear(threshold);
  await userEvent.type(threshold, '0');
  const repeat = screen.getByLabelText('Ulangi setiap (hari)');
  await userEvent.clear(repeat);
  await userEvent.type(repeat, '999');
  await userEvent.type(screen.getByLabelText('Email lain'), 'rusak');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah email' }));
  const extraError = (screen.getByLabelText('Email lain').getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent);
  expect(extraError).toContain('Format email tidak valid');
  await save();
  const describedBy = (element: HTMLElement) =>
    (element.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
  expect(describedBy(threshold)).toContain('Pengingat 3: bilangan bulat 1 sampai 730');
  expect(describedBy(repeat)).toContain('Ulangi setiap: bilangan bulat 0 sampai 365');
});

test('pengingat kembar: kedua input yang bermasalah menunjuk pesan umum', async () => {
  renderSettings();
  const third = screen.getByLabelText('Pengingat 3 (hari sebelum habis)');
  await userEvent.clear(third);
  await userEvent.type(third, '60');
  await save();
  const message = await screen.findByText('Pengingat tidak boleh kembar');
  expect(third.getAttribute('aria-describedby')).toContain(message.id);
});
