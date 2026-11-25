import type { PostelSettingsDto, UserDto } from '@shared/contract';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { hasUnsavedChanges, resetUnsavedChangesForTests } from '@/app/pwa/unsaved-changes';
import { FormPage } from '@/components/page/form-page';
import { pickLink } from '@/test/link-field';
import { addMailAddress, BCC_FIELD, CC_FIELD, TO_FIELD, typeInMailField } from '@/test/mail-lists';
import { renderInRouter } from '@/test/render-in-router';
import { PostelAlertSettings, type PostelAlertSettingsProps } from './postel-alert-settings';

const settings: PostelSettingsDto = {
  alert: {
    enabled: true,
    recipients: ['qc@contoh.com'],
    cc: [],
    bcc: [],
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
    sharedAccount: false,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
  };
}

const users = [user('budi@contoh.com', 'Budi'), user('lama@contoh.com', 'Lama', 'inactive')];

const FORM_ID = 'postel-test';

/** Meniru halaman: FormPage memegang tombol Simpan; status busy dan galat datang dari komponen. */
function Harness(props: Omit<PostelAlertSettingsProps, 'formId'>) {
  const [busy, setBusy] = useState(false);
  const [hasError, setHasError] = useState(false);
  return (
    <FormPage
      formId={FORM_ID}
      title="Konfigurasi Stiker"
      onCancel={() => undefined}
      submitting={busy}
      submitLabel="Simpan peringatan Postel"
    >
      <PostelAlertSettings
        formId={FORM_ID}
        onBusyChange={setBusy}
        onHasErrorChange={setHasError}
        {...props}
      />
      <span data-testid="has-error">{String(hasError)}</span>
    </FormPage>
  );
}

async function renderSettings(props: Partial<PostelAlertSettingsProps> = {}) {
  const onSave = vi.fn().mockResolvedValue(null);
  await renderInRouter(<Harness settings={settings} users={users} onSave={onSave} {...props} />);
  return { onSave };
}

const save = () =>
  userEvent.click(screen.getByRole('button', { name: 'Simpan peringatan Postel' }));

beforeEach(() => {
  resetUnsavedChangesForTests();
});

afterEach(() => {
  cleanup();
});

test('mengubah isian mendaftarkan perubahan belum disimpan; mengembalikannya ke nilai awal melepas', async () => {
  await renderSettings();
  expect(hasUnsavedChanges()).toBe(false);
  const repeat = screen.getByLabelText('Ulangi setiap (hari)');
  await userEvent.clear(repeat);
  await userEvent.type(repeat, '14');
  expect(hasUnsavedChanges()).toBe(true);
  await userEvent.clear(repeat);
  await userEvent.type(repeat, '7');
  expect(hasUnsavedChanges()).toBe(false);
});

test('menampilkan nilai awal dari settings', async () => {
  await renderSettings();
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

test('peringatan SMTP (role=status) hanya bila smtpConfigured false', async () => {
  await renderSettings({ settings: { ...settings, smtpConfigured: false } });
  expect(screen.getByRole('status')).toHaveTextContent('SMTP belum dikonfigurasi');
});

test('ambang ke-6 tak dapat ditambahkan (maksimal 5)', async () => {
  await renderSettings({
    settings: { ...settings, alert: { ...settings.alert, thresholds: [100, 90, 60, 30, 14] } },
  });
  expect(screen.getByRole('button', { name: 'Tambah pengingat' })).toBeDisabled();
  expect(screen.queryByLabelText('Pengingat 6 (hari sebelum habis)')).not.toBeInTheDocument();
});

test('Tambah pengingat menambah baris kosong; Hapus pengingat menghapus', async () => {
  await renderSettings();
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
  const { onSave } = await renderSettings();
  const input = screen.getByLabelText('Pengingat 3 (hari sebelum habis)');
  await userEvent.clear(input);
  if (value !== '') await userEvent.type(input, value);
  await save();
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});

test('tanpa pengingat sama sekali menolak simpan', async () => {
  const { onSave } = await renderSettings({
    settings: { ...settings, alert: { ...settings.alert, thresholds: [30] } },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Hapus pengingat 1' }));
  await save();
  expect(await screen.findByText('Isi minimal satu pengingat')).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});

test('ulangi setiap di luar 0-365 menolak simpan', async () => {
  const { onSave } = await renderSettings();
  const input = screen.getByLabelText('Ulangi setiap (hari)');
  await userEvent.clear(input);
  await userEvent.type(input, '366');
  await save();
  expect(await screen.findByText('Ulangi setiap: bilangan bulat 0 sampai 365')).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});

test('simpan mengirim ambang menurun, jam, ulangi, dan penerima (user dan email lain)', async () => {
  const { onSave } = await renderSettings({
    settings: { ...settings, alert: { ...settings.alert, thresholds: [30, 90, 60] } },
  });
  await pickSelect('Jam kirim (WIB)', '09:00 WIB');
  const repeat = screen.getByLabelText('Ulangi setiap (hari)');
  await userEvent.clear(repeat);
  await userEvent.type(repeat, '0');
  await pickLink(screen, TO_FIELD, /Budi/);
  await addMailAddress(TO_FIELD, 'Luar@Contoh.com');
  await addMailAddress(CC_FIELD, 'cc@contoh.com');
  await addMailAddress(BCC_FIELD, 'bcc@contoh.com');
  await save();
  expect(onSave).toHaveBeenCalledWith({
    expectedUpdatedAt: '2026-11-10 09:00:00',
    alert: {
      enabled: true,
      recipients: ['qc@contoh.com', 'budi@contoh.com', 'luar@contoh.com'],
      cc: ['cc@contoh.com'],
      bcc: ['bcc@contoh.com'],
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
  const { onSave } = await renderSettings();
  await userEvent.click(screen.getByLabelText('Kirim email peringatan masa berlaku Postel'));
  await save();
  expect(onSave.mock.calls[0]?.[0].alert.enabled).toBe(false);
});

test('alamat rusak tidak jadi chip dan alamat yang sudah dipilih tidak ditawarkan lagi', async () => {
  await renderSettings();
  await typeInMailField(CC_FIELD, 'bukan-email');
  expect(await screen.findByText(/Ketik alamat email lengkap/)).toBeInTheDocument();
  await userEvent.clear(screen.getByRole('combobox', { name: CC_FIELD }));
  await typeInMailField(CC_FIELD, 'QC@contoh.com');
  expect(screen.queryByRole('option', { name: 'qc@contoh.com' })).not.toBeInTheDocument();
});

test.each(['x,a@b.co', 'a@b.co,c@d.co', 'a@b.co;c@d.co', 'Nama <a@b.co>', 'a@b.co c@d.co'])(
  'entri yang bukan satu alamat polos tidak jadi chip: %s',
  async (entry) => {
    const { onSave } = await renderSettings();
    await typeInMailField(TO_FIELD, entry);
    expect(await screen.findByText(/Ketik alamat email lengkap/)).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    await save();
    expect(onSave.mock.calls[0]?.[0].alert.recipients).toEqual(['qc@contoh.com']);
  },
);

test('maksimal 20 penerima per daftar', async () => {
  const many = Array.from({ length: 20 }, (_, i) => `u${i}@contoh.com`);
  await renderSettings({
    settings: { ...settings, alert: { ...settings.alert, recipients: many } },
  });
  await userEvent.click(screen.getByRole('combobox', { name: TO_FIELD }));
  expect(await screen.findByText(/Maksimal 20 pilihan/)).toBeInTheDocument();
});

test('onSave mengembalikan teks galat => tampil sebagai alert', async () => {
  await renderSettings({ onSave: vi.fn().mockResolvedValue('Data sudah diubah orang lain') });
  await save();
  expect(await screen.findByRole('alert')).toHaveTextContent('Data sudah diubah orang lain');
});

test('pesan galat dihubungkan ke inputnya lewat aria-describedby', async () => {
  await renderSettings();
  const threshold = screen.getByLabelText('Pengingat 3 (hari sebelum habis)');
  await userEvent.clear(threshold);
  await userEvent.type(threshold, '0');
  const repeat = screen.getByLabelText('Ulangi setiap (hari)');
  await userEvent.clear(repeat);
  await userEvent.type(repeat, '999');
  await save();
  const describedBy = (element: HTMLElement) =>
    (element.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
  expect(describedBy(threshold)).toContain('Pengingat 3: bilangan bulat 1 sampai 730');
  expect(describedBy(repeat)).toContain('Ulangi setiap: bilangan bulat 0 sampai 365');
});

test('pengingat kembar: kedua input yang bermasalah menunjuk pesan umum', async () => {
  await renderSettings();
  const third = screen.getByLabelText('Pengingat 3 (hari sebelum habis)');
  await userEvent.clear(third);
  await userEvent.type(third, '60');
  await save();
  const message = await screen.findByText('Pengingat tidak boleh kembar');
  expect(third.getAttribute('aria-describedby')).toContain(message.id);
});

test('M-g: menambah alamat terdaftar sebagai belum disimpan; menghapusnya kembali melepas', async () => {
  await renderSettings();
  expect(hasUnsavedChanges()).toBe(false);
  await addMailAddress(BCC_FIELD, 'baru@contoh.com');
  expect(hasUnsavedChanges()).toBe(true);
  const chip = screen.getByText('baru@contoh.com');
  await userEvent.click(within(chip.parentElement ?? chip).getByRole('button'));
  expect(hasUnsavedChanges()).toBe(false);
});

test('galat validasi memberi tahu induk (titik galat tab) dan hilang setelah diperbaiki', async () => {
  await renderSettings();
  expect(screen.getByTestId('has-error')).toHaveTextContent('false');
  const repeat = screen.getByLabelText('Ulangi setiap (hari)');
  await userEvent.clear(repeat);
  await userEvent.type(repeat, '999');
  await save();
  expect(await screen.findByText('Ulangi setiap: bilangan bulat 0 sampai 365')).toBeInTheDocument();
  expect(screen.getByTestId('has-error')).toHaveTextContent('true');
});

test('tombol Simpan ada di bar halaman (di luar form) dan terkait lewat atribut form', async () => {
  await renderSettings();
  const button = screen.getByRole('button', { name: 'Simpan peringatan Postel' });
  expect(button).toHaveAttribute('form', FORM_ID);
  expect(button.closest('form')).toBeNull();
  expect(document.getElementById(FORM_ID)?.tagName).toBe('FORM');
});

test('selama menyimpan, induk diberi tahu (busy) dan tombol Simpan terkunci', async () => {
  let finish: (value: string | null) => void = () => undefined;
  const onSave = vi.fn(
    () =>
      new Promise<string | null>((resolve) => {
        finish = resolve;
      }),
  );
  await renderSettings({ onSave });
  await save();
  expect(screen.getByRole('button', { name: /Menyimpan/ })).toBeDisabled();
  finish(null);
  expect(await screen.findByRole('button', { name: 'Simpan peringatan Postel' })).toBeEnabled();
});
