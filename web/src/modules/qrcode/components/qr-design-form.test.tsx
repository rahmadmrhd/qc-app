import type { QrPresetDto } from '@shared/contract';
import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE, qrContentHash } from '@shared/qrcode';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { linkOptionNames, pickLink } from '@/test/link-field';
import type { QrEditContext } from '../schemas';
import { toPresetFormValues, toQrFormDefaults } from '../schemas';
import { QrDesignForm } from './qr-design-form';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: apiMock }));

const ITEM_OPTIONS = [
  { id: 'i1', brand: 'PBE', model: 'M5-400', businessUnitIds: ['bu1'], manualBookName: '' },
  { id: 'i2', brand: 'PBE', model: 'M5-200', businessUnitIds: ['bu1'], manualBookName: '' },
  { id: 'i3', brand: 'Nexus', model: 'N1', businessUnitIds: ['bu2'], manualBookName: '' },
  { id: 'i4', brand: 'Lama', model: 'L1', businessUnitIds: ['bu1'], manualBookName: 'Manual Lama' },
];

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  apiMock.mockReset();
  apiMock.mockResolvedValue({ items: ITEM_OPTIONS, nextCursor: null });
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

const presetOf = (id: string, name: string, extra: Partial<QrPresetDto> = {}) => ({
  ...preset(id, name, `Judul ${name}`),
  ...extra,
});
const URL_DEFAULTS = {
  ...toQrFormDefaults(),
  linkSource: 'url' as const,
  link: 'https://contoh.com',
};
const SPECTRUM = presetOf('p1', 'Standar Spectrum', { buId: 'bu1', namePlacement: 'subtitle' });
const NEXUS = presetOf('p2', 'Standar Nexus', { buId: 'bu2', namePlacement: 'footer' });

test('QR baru: isian tersembunyi sampai item dipilih; satu BU menarik preset otomatis, nama dibuat dari tipe item', async () => {
  renderForm({ presets: [SPECTRUM, NEXUS], defaultValues: toQrFormDefaults() });
  expect(screen.getByRole('combobox', { name: 'Item' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Title')).toBeNull();
  expect(screen.queryByText('Bingkai QR')).toBeNull();
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled();
  await pickLink(screen, 'Item', 'PBE M5-400');
  await pickLink(screen, 'Item', 'PBE M5-200');
  expect(screen.getByText(/Standar Spectrum/)).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Pilih konfigurasi default' })).toBeNull();
  expect(screen.getByLabelText('Nama Manual Book')).toHaveValue('M5-400/200');
  expect(screen.getByLabelText('Title')).toHaveValue('Judul Standar Spectrum');
  expect(screen.getByLabelText('Ukuran QR (mm)')).toHaveValue(18);
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled();
});

test('bagian yang ditampung nama terkunci (disabled) dan selalu sama dengan nama; nama yang sudah diedit tidak ditimpa', async () => {
  const { onSubmit } = renderForm({ presets: [SPECTRUM], defaultValues: URL_DEFAULTS });
  await pickLink(screen, 'Item', 'PBE M5-400');
  expect(screen.getByLabelText('Subtitle')).toBeDisabled();
  expect(screen.getByLabelText('Subtitle')).toHaveValue('M5-400');
  const name = screen.getByLabelText('Nama Manual Book');
  await userEvent.clear(name);
  await userEvent.type(name, 'Nama Saya');
  expect(screen.getByLabelText('Subtitle')).toHaveValue('Nama Saya');
  await pickLink(screen, 'Item', 'PBE M5-200');
  expect(name).toHaveValue('Nama Saya');
  expect(screen.getByLabelText('Subtitle')).toHaveValue('Nama Saya');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
    name: 'Nama Saya',
    presetId: 'p1',
    subtitle: 'Nama Saya',
    itemIds: ['i1', 'i2'],
  });
});

test('item lintas BU: pengguna memilih satu preset dari BU item; isian tersembunyi sampai dipilih', async () => {
  renderForm({ presets: [SPECTRUM, NEXUS, presetOf('p3', 'Lain', { buId: 'bu9' })] });
  await pickLink(screen, 'Item', 'PBE M5-400');
  await pickLink(screen, 'Item', 'Nexus N1');
  expect(screen.getByRole('combobox', { name: 'Pilih konfigurasi default' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Title')).toBeNull();
  expect(await linkOptionNames(screen, 'Pilih konfigurasi default')).toEqual([
    'Standar Spectrum',
    'Standar Nexus',
  ]);
  await userEvent.keyboard('{Escape}');
  await pickLink(screen, 'Pilih konfigurasi default', 'Standar Nexus');
  expect(screen.getByLabelText('Title')).toHaveValue('Judul Standar Nexus');
  expect(screen.getByLabelText('Footer')).toBeDisabled();
});

test('BU item tanpa preset: boleh memilih preset mana pun atau "Tanpa preset" (nama tidak terkunci)', async () => {
  const { onSubmit } = renderForm({
    presets: [presetOf('p3', 'Lain', { buId: 'bu9' })],
    defaultValues: URL_DEFAULTS,
  });
  await pickLink(screen, 'Item', 'PBE M5-400');
  expect(screen.queryByLabelText('Title')).toBeNull();
  await pickLink(screen, 'Pilih konfigurasi default', /Tanpa preset/);
  expect(screen.getByLabelText('Nama Manual Book')).toHaveValue('M5-400');
  expect(screen.getByLabelText('Title')).toBeEnabled();
  expect(screen.getByLabelText('Subtitle')).toBeEnabled();
  await userEvent.type(screen.getByLabelText('Title'), 'Panduan');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ presetId: '', title: 'Panduan' });
});

test('QR baru tanpa konfigurasi default sama sekali: tetap dapat dibuat setelah memilih item', async () => {
  renderForm({ presets: [], defaultValues: toQrFormDefaults() });
  await pickLink(screen, 'Item', 'PBE M5-400');
  expect(screen.getByText(/nilai bawaan aplikasi/)).toBeInTheDocument();
  expect(screen.getByLabelText('Title')).toBeInTheDocument();
});

test('item milik Manual Book lain tidak dapat dipilih', async () => {
  renderForm({ presets: [SPECTRUM] });
  await userEvent.click(screen.getByRole('combobox', { name: 'Item' }));
  const row = await screen.findByRole('option', { name: /Lama L1/ });
  expect(row).toHaveAttribute('aria-disabled', 'true');
  expect(row).toHaveTextContent('Manual Lama');
});

test('banner penyimpangan muncul saat gaya diubah dari preset dan tidak memblokir simpan', async () => {
  renderForm({ presets: [SPECTRUM], defaultValues: toQrFormDefaults() });
  await pickLink(screen, 'Item', 'PBE M5-400');
  expect(screen.queryByRole('status')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Miring Title' }));
  const banner = await screen.findByRole('status');
  expect(banner).toHaveTextContent('Standar Spectrum');
  expect(banner).toHaveTextContent('Gaya');
  expect(screen.getByRole('button', { name: 'Simpan' })).toBeEnabled();
});

const EDIT: QrEditContext = {
  items: [{ id: 'i1', brand: 'PBE', model: 'M5-400' }],
  hiddenItemCount: 2,
  namePlacement: 'subtitle',
  presetId: 'p1',
  exportedHash: null,
  legacy: false,
};

test('ubah: item tergabung tampil, nama tidak dibuat ulang, bagian terkunci mengikuti nama; menghapus semua item ditolak', async () => {
  const { onSubmit } = renderForm({
    edit: EDIT,
    updatePresets: [SPECTRUM],
    defaultValues: {
      ...toQrFormDefaults(),
      name: 'Nama Tersimpan',
      itemIds: ['i1'],
      presetId: 'p1',
      linkSource: 'url',
      link: 'https://contoh.com',
    },
  });
  expect(screen.getByRole('button', { name: 'Hapus PBE M5-400' })).toBeInTheDocument();
  expect(screen.getByText(/2 item lain tergabung/)).toBeInTheDocument();
  expect(screen.getByLabelText('Nama Manual Book')).toHaveValue('Nama Tersimpan');
  expect(screen.getByLabelText('Subtitle')).toBeDisabled();
  expect(screen.getByLabelText('Subtitle')).toHaveValue('Nama Tersimpan');
  // item tak terlihat tetap terpasang: menghapus semua item yang terlihat diperbolehkan (spek 4a §3 butir 17)
  await userEvent.click(screen.getByRole('button', { name: 'Hapus PBE M5-400' }));
  await userEvent.type(screen.getByLabelText('Title'), 'x');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit.mock.calls[0]?.[0].itemIds).toEqual([]);
});

test('ubah tanpa item tak terlihat: menghapus semua item ditolak', async () => {
  const { onSubmit } = renderForm({
    edit: { ...EDIT, hiddenItemCount: 0 },
    updatePresets: [SPECTRUM],
    defaultValues: {
      ...toQrFormDefaults(),
      name: 'Nama Tersimpan',
      itemIds: ['i1'],
      presetId: 'p1',
    },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Hapus PBE M5-400' }));
  await userEvent.type(screen.getByLabelText('Title'), 'x');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText('Pilih minimal satu item')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('"Perbarui sesuai konfigurasi default" tidak menimpa bagian label yang terkunci ke nama', async () => {
  renderForm({
    edit: { ...EDIT, namePlacement: 'title', hiddenItemCount: 0 },
    updatePresets: [SPECTRUM],
    defaultValues: {
      ...toQrFormDefaults(),
      name: 'Nama Tersimpan',
      title: 'Nama Tersimpan',
      itemIds: ['i1'],
      presetId: 'p1',
      linkSource: 'url',
      link: 'https://contoh.com',
    },
  });
  expect(screen.getByLabelText('Title')).toHaveValue('Nama Tersimpan');
  await userEvent.click(
    screen.getByRole('button', { name: 'Perbarui sesuai konfigurasi default' }),
  );
  const dialog = await screen.findByRole('dialog');
  await pickLink(within(dialog), 'Konfigurasi default', 'Standar Spectrum');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Terapkan' }));
  // title preset tidak boleh menimpa bagian yang terkunci ke nama; bagian lain ikut preset
  expect(screen.getByLabelText('Title')).toHaveValue('Nama Tersimpan');
  expect(screen.getByLabelText('Subtitle')).toHaveValue(SPECTRUM.subtitle);
  expect(screen.getByLabelText('Nama Manual Book')).toHaveValue('Nama Tersimpan');
});

test('ubah konfigurasi lama tanpa nama/item: boleh disimpan kosong (kelonggaran)', async () => {
  const { onSubmit } = renderForm({
    edit: {
      ...EDIT,
      items: [],
      hiddenItemCount: 0,
      namePlacement: '',
      presetId: '',
      legacy: true,
    },
    defaultValues: {
      ...toQrFormDefaults(),
      title: 'Lama',
      linkSource: 'url',
      link: 'https://contoh.com',
    },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test('peringatan perubahan label: muncul hanya pada konfigurasi yang pernah diekspor dan labelnya berubah, tidak saat hanya item berubah', async () => {
  const base = {
    ...toQrFormDefaults(),
    name: 'Nama',
    itemIds: ['i1'],
    title: 'Judul',
    linkSource: 'url' as const,
    link: 'https://contoh.com',
  };
  const exportedHash = qrContentHash({
    linkSource: 'url',
    link: 'https://contoh.com',
    title: 'Judul',
    subtitle: '',
    footer: '',
    logoFileId: '',
    layout: DEFAULT_QR_LAYOUT,
    style: DEFAULT_QR_STYLE,
  });
  const edit = { ...EDIT, namePlacement: '' as const, presetId: '', exportedHash };
  const first = renderForm({ edit, defaultValues: base });
  // hanya item berubah: tanpa dialog
  await pickLink(screen, 'Item', 'PBE M5-200');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(first.onSubmit).toHaveBeenCalledTimes(1);
  first.unmount();
  // label berubah: dialog, simpan baru berjalan setelah dikonfirmasi
  const second = renderForm({ edit, defaultValues: base });
  await userEvent.type(screen.getByLabelText('Title'), '!');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(/stiker Manual Book baru/i);
  expect(second.onSubmit).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan perubahan' }));
  expect(second.onSubmit).toHaveBeenCalledTimes(1);
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
