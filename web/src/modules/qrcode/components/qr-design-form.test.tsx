import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { pickLink } from '@/test/link-field';
import { toPresetFormValues, toQrFormDefaults } from '../schemas';
import { QrDesignForm } from './qr-design-form';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

function renderForm(props: Partial<React.ComponentProps<typeof QrDesignForm>> = {}) {
  const onSubmit = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <QrDesignForm
        title="Form QR"
        defaultValues={{ ...toQrFormDefaults(), linkSource: 'url', link: 'https://contoh.com' }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onSubmit, unmount: view.unmount };
}

test('pratinjau 3×3 tampil di form; tombol Pratinjau lembar membuka dialog (bukan pratinjau lembar di form)', async () => {
  renderForm();
  expect(screen.getByLabelText('Pratinjau label 3 × 3 cm')).toBeInTheDocument();
  expect(screen.queryByLabelText('Gambar lembar 10 × 14')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Pratinjau lembar' }));
  expect(await screen.findByLabelText('Gambar lembar 10 × 14')).toBeInTheDocument();
});

test('mengubah teks memperbarui pratinjau (peringatan overflow muncul untuk title sangat panjang)', async () => {
  renderForm();
  await userEvent.click(screen.getByLabelText('Title'));
  await userEvent.paste('kata '.repeat(30));
  expect(await screen.findByRole('alert')).toHaveTextContent('melebihi kanvas');
});

test('sumber link: hanya PDF (unggah atau salin dari Drive); link lama non-Drive ditampilkan sebagai catatan', () => {
  renderForm();
  expect(screen.queryByRole('radio', { name: 'Link manual' })).toBeNull();
  expect(screen.queryByLabelText('Link')).toBeNull();
  expect(screen.getByLabelText('Pilih PDF')).toBeInTheDocument();
  expect(screen.getByLabelText('Atau salin dari Google Drive')).toBeInTheDocument();
  expect(screen.getByText(/bukan link Drive/)).toBeInTheDocument();
});

test('simpan: nilai valid dikirim', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Title'), 'Panduan');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
    title: 'Panduan',
    link: 'https://contoh.com',
    layout: DEFAULT_QR_LAYOUT,
  });
});

test('ukuran: isian per bagian dengan satuan; nilai di luar rentang menampilkan galat langsung dan memblokir simpan', async () => {
  const { onSubmit } = renderForm();
  expect(screen.getByLabelText('Ukuran QR (mm)')).toHaveValue(17);
  await userEvent.clear(screen.getByLabelText('Ukuran QR (mm)'));
  await userEvent.type(screen.getByLabelText('Ukuran QR (mm)'), '99');
  expect(await screen.findByText('Maksimal 26 mm')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Title'), 'x');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit).not.toHaveBeenCalled();
});

test('gaya teks: tombol per bagian mengubah gaya yang dikirim saat simpan', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Title'), 'Panduan');
  await userEvent.click(screen.getByRole('button', { name: 'Miring Title' }));
  await userEvent.click(screen.getByRole('button', { name: 'Garis bawah Subtitle' }));
  await userEvent.click(screen.getByRole('button', { name: 'Coret Footer' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tebal Title' })); // matikan tebal bawaan
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  const style = onSubmit.mock.calls[0]?.[0].style;
  expect(style.title).toMatchObject({ italic: true, bold: false });
  expect(style.subtitle.underline).toBe(true);
  expect(style.footer.strike).toBe(true);
});

test('bingkai QR: pilihan jenis; isian ukuran hanya tampil bila ada bingkai; terkirim saat simpan', async () => {
  const { onSubmit } = renderForm();
  expect(screen.getByRole('radio', { name: 'Tanpa bingkai' })).toBeChecked();
  expect(screen.queryByLabelText('Tebal bingkai (mm)')).toBeNull();
  await userEvent.click(screen.getByRole('radio', { name: 'Siku di sudut' }));
  expect(screen.getByLabelText('Tebal bingkai (mm)')).toHaveValue(0.5);
  await userEvent.clear(screen.getByLabelText('Tebal bingkai (mm)'));
  await userEvent.type(screen.getByLabelText('Tebal bingkai (mm)'), '9');
  expect(await screen.findByText('Maksimal 1.5 mm')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Tebal bingkai (mm)'));
  await userEvent.type(screen.getByLabelText('Tebal bingkai (mm)'), '0.8');
  await userEvent.type(screen.getByLabelText('Title'), 'Panduan');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit.mock.calls[0]?.[0].style.frame).toMatchObject({
    kind: 'corners',
    thickness: 0.8,
  });
});

test('ukuran font ada di tiap bagian teks (bukan di bagian Ukuran) dan terkirim saat simpan; di luar rentang menampilkan galat', async () => {
  const { onSubmit } = renderForm();
  for (const part of ['Title', 'Subtitle', 'Footer']) {
    expect(screen.getByLabelText(`Ukuran ${part} (pt)`)).toBeInTheDocument();
  }
  expect(screen.queryByLabelText('Ukuran title (pt)')).toBeNull(); // isian lama di bagian Ukuran sudah pindah
  expect(screen.getByLabelText('Ukuran Title (pt)')).toHaveValue(6);
  await userEvent.clear(screen.getByLabelText('Ukuran Title (pt)'));
  await userEvent.type(screen.getByLabelText('Ukuran Title (pt)'), '99');
  expect(await screen.findByText('Maksimal 14 pt')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Ukuran Title (pt)'));
  await userEvent.type(screen.getByLabelText('Ukuran Title (pt)'), '8');
  await userEvent.clear(screen.getByLabelText('Ukuran Footer (pt)'));
  await userEvent.type(screen.getByLabelText('Ukuran Footer (pt)'), '5');
  await userEvent.type(screen.getByLabelText('Title'), 'Panduan');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit.mock.calls[0]?.[0].layout).toMatchObject({
    titleSize: 8,
    footerSize: 5,
    subtitleSize: 5,
  });
});

test('bingkai: sudut membulat dan gaya garis (solid, putus-putus, titik-titik) dapat diatur dan terkirim', async () => {
  const { onSubmit } = renderForm();
  await userEvent.click(screen.getByRole('radio', { name: 'Kotak penuh' }));
  expect(screen.getByLabelText('Sudut membulat (mm)')).toHaveValue(1.5);
  expect(screen.getByRole('radio', { name: 'Solid' })).toBeChecked();
  await userEvent.click(screen.getByRole('radio', { name: 'Putus-putus' }));
  expect(screen.getByRole('radio', { name: 'Putus-putus' })).toBeChecked();
  await userEvent.clear(screen.getByLabelText('Sudut membulat (mm)'));
  await userEvent.type(screen.getByLabelText('Sudut membulat (mm)'), '3');
  await userEvent.type(screen.getByLabelText('Title'), 'Panduan');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit.mock.calls[0]?.[0].style.frame).toMatchObject({
    kind: 'box',
    line: 'dashed',
    radius: 3,
  });
});

test('panjang siku hanya untuk bingkai siku di sudut; kotak penuh tidak menampilkannya', async () => {
  renderForm();
  await userEvent.click(screen.getByRole('radio', { name: 'Siku di sudut' }));
  expect(screen.getByLabelText('Panjang siku (%)')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'Kotak penuh' }));
  expect(screen.queryByLabelText('Panjang siku (%)')).toBeNull();
  expect(screen.getByLabelText('Sudut membulat (mm)')).toBeInTheDocument();
});

test('submit membawa opsi: overflow dari pratinjau dan thenExport=false untuk Simpan biasa', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Title'), 'Panduan');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit.mock.calls[0]?.[1]).toEqual({ overflow: false, thenExport: false });
});

test('isi tidak muat: Simpan tetap boleh dan melaporkan overflow=true', async () => {
  const { onSubmit } = renderForm({ canExport: true });
  await userEvent.click(screen.getByLabelText('Title'));
  await userEvent.paste('x'.repeat(60));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit.mock.calls[0]?.[1]).toEqual({ overflow: true, thenExport: false });
});

test('Simpan dan ekspor: hanya untuk pemegang izin ekspor; memanggil onSubmit dengan thenExport=true', async () => {
  const none = renderForm();
  expect(screen.queryByRole('button', { name: 'Simpan dan ekspor' })).toBeNull();
  none.unmount();
  const { onSubmit } = renderForm({ canExport: true });
  await userEvent.type(screen.getByLabelText('Title'), 'Panduan');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan dan ekspor' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit.mock.calls[0]?.[1]).toEqual({ overflow: false, thenExport: true });
});

test('Simpan dan ekspor dinonaktifkan selama isi tidak muat (ekspor pasti ditolak)', async () => {
  renderForm({ canExport: true });
  await userEvent.click(screen.getByLabelText('Title'));
  await userEvent.paste('x'.repeat(60));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Simpan dan ekspor' })).toBeDisabled();
});

const BUS = [
  { id: 'bu1', code: 'SPC', name: 'Spectrum', status: 'active' as const },
  { id: 'bu2', code: 'NXT', name: 'Nexus', status: 'active' as const },
  { id: 'bu3', code: 'OLD', name: 'Lama', status: 'inactive' as const },
];

test('mode default: tanpa sumber link dan ekspor; nama, BU, dan penempatan nama wajib; title boleh kosong; logo awal dari pustaka', async () => {
  const { onSubmit } = renderForm({
    mode: 'defaults',
    canExport: true,
    logoLibrary: ['x'],
    businessUnits: BUS,
    defaultValues: toPresetFormValues(),
  });
  expect(screen.queryByText('Sumber link')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Simpan dan ekspor' })).toBeNull();
  expect(screen.getByText('Logo awal')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Logo 1' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan default' }));
  expect(await screen.findByText('Pilih Business Unit')).toBeInTheDocument();
  expect(screen.getByText('Pilih bagian label untuk nama Manual Book')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText('Nama konfigurasi default'), 'Standar');
  await pickLink(screen, 'Business Unit', 'Spectrum');
  await userEvent.selectOptions(screen.getByLabelText('Penempatan nama Manual Book'), 'subtitle');
  await userEvent.click(screen.getByRole('radio', { name: 'Logo 1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Simpan default' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
    name: 'Standar',
    title: '',
    logoFileId: 'x',
    buId: 'bu1',
    namePlacement: 'subtitle',
  });
});

test('mode default: BU nonaktif tidak ditawarkan, BU yang sudah punya preset lain nonaktif; bagian terpilih diberi keterangan', async () => {
  renderForm({
    mode: 'defaults',
    businessUnits: BUS,
    takenBuIds: new Set(['bu2']),
    defaultValues: toPresetFormValues(),
  });
  await userEvent.click(screen.getByRole('combobox', { name: 'Business Unit' }));
  const listbox = await screen.findByRole('listbox', { name: 'Business Unit' });
  const options = within(listbox).getAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual([
    expect.stringContaining('Spectrum'),
    expect.stringContaining('Nexus'),
  ]);
  expect(within(listbox).getByRole('option', { name: /Nexus/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await userEvent.keyboard('{Escape}');
  await userEvent.selectOptions(screen.getByLabelText('Penempatan nama Manual Book'), 'footer');
  expect(screen.getByLabelText('Footer')).toBeDisabled();
  expect(screen.getAllByText(/diisi nama Manual Book/i).length).toBeGreaterThan(0);
  expect(screen.getByLabelText('Title')).toBeEnabled();
});

const preset = (id: string, name: string, title: string) => ({
  id,
  name,
  title,
  subtitle: 'Sub',
  footer: 'foot',
  layout: { ...DEFAULT_QR_LAYOUT, qrSize: 18 },
  style: DEFAULT_QR_STYLE,
  defaultLogoId: '',
  buId: '',
  namePlacement: '' as const,
  createdAt: 't',
  createdBy: 'a',
  updatedAt: 't',
  updatedBy: 'a',
});

test('QR baru: wajib memilih konfigurasi default dulu; isian lain tersembunyi sampai dipilih, lalu terisi dari default', async () => {
  const { onSubmit } = renderForm({
    presets: [preset('p1', 'Standar', 'PT Contoh'), preset('p2', 'Promo', 'Diskon')],
    defaultValues: toQrFormDefaults(),
  });
  expect(screen.getByLabelText('Pilih konfigurasi default')).toBeInTheDocument();
  expect(screen.queryByLabelText('Title')).toBeNull();
  expect(screen.queryByText('Bingkai QR')).toBeNull();
  expect(screen.queryByText('Sumber link')).toBeNull();
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
  await pickLink(screen, 'Pilih konfigurasi default', 'Standar');
  expect(screen.getByLabelText('Title')).toHaveValue('PT Contoh');
  expect(screen.getByLabelText('Subtitle')).toHaveValue('Sub');
  expect(screen.getByLabelText('Ukuran QR (mm)')).toHaveValue(18);
  expect(screen.getByText('Sumber link')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled();
  // memilih default lain mengisi ulang semua isian
  await pickLink(screen, 'Pilih konfigurasi default', 'Promo');
  expect(screen.getByLabelText('Title')).toHaveValue('Diskon');
  expect(onSubmit).not.toHaveBeenCalled();
});

test('QR baru tanpa konfigurasi default: pesan dan tidak ada isian lain', () => {
  renderForm({ presets: [], defaultValues: toQrFormDefaults() });
  expect(screen.getByText(/Belum ada konfigurasi default/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Title')).toBeNull();
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
});

test('mode QR: logo dipilih dari pustaka (tanpa unggah)', () => {
  renderForm({ logoLibrary: ['x'] });
  expect(screen.getByRole('radio', { name: 'Logo 1' })).toBeInTheDocument();
  expect(screen.queryByLabelText(/Unggah logo/i)).toBeNull();
});

test('ubah/duplikat: "Perbarui sesuai konfigurasi default" menyalin ulang bagian terpilih; gaya, ukuran, bingkai selalu ikut', async () => {
  renderForm({
    updatePresets: [preset('p1', 'Standar', 'PT Contoh')],
    defaultValues: {
      ...toQrFormDefaults(),
      title: 'Lama',
      footer: 'footer lama',
      linkSource: 'url',
      link: 'https://contoh.com',
    },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Perbarui sesuai konfigurasi default' }),
  );
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/selalu ikut/)).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Terapkan' })).toBeDisabled();
  await pickLink(within(dialog), 'Konfigurasi default', 'Standar');
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Footer' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Terapkan' }));
  expect(screen.getByLabelText('Title')).toHaveValue('PT Contoh');
  expect(screen.getByLabelText('Subtitle')).toHaveValue('Sub');
  expect(screen.getByLabelText('Footer')).toHaveValue('footer lama'); // tidak dicentang: dipertahankan
  expect(screen.getByLabelText('Ukuran QR (mm)')).toHaveValue(18); // ukuran selalu ikut
});

test('tombol "Perbarui sesuai konfigurasi default" tidak ada tanpa daftar default (QR baru, mode default)', () => {
  renderForm();
  expect(screen.queryByRole('button', { name: 'Perbarui sesuai konfigurasi default' })).toBeNull();
});
