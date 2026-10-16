import { DEFAULT_QR_LAYOUT } from '@shared/qrcode';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { toQrFormDefaults } from '../schemas';
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
        defaultValues={toQrFormDefaults()}
        designs={[]}
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

test('sumber link: manual menampilkan isian link; PDF menampilkan unggahan', async () => {
  renderForm();
  expect(screen.getByLabelText('Link')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'PDF di Drive' }));
  expect(screen.queryByLabelText('Link')).toBeNull();
  expect(screen.getByLabelText('Pilih PDF')).toBeInTheDocument();
});

test('simpan: nilai valid dikirim; link tidak valid menampilkan galat dan tidak mengirim', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Title'), 'Panduan');
  await userEvent.type(screen.getByLabelText('Link'), 'ftp://x');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(await screen.findByText(/diawali http/)).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  await userEvent.clear(screen.getByLabelText('Link'));
  await userEvent.type(screen.getByLabelText('Link'), 'https://contoh.com');
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
  await userEvent.type(screen.getByLabelText('Link'), 'https://a.co');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit).not.toHaveBeenCalled();
});

test('gaya teks: tombol per bagian mengubah gaya yang dikirim saat simpan', async () => {
  const { onSubmit } = renderForm();
  await userEvent.type(screen.getByLabelText('Title'), 'Panduan');
  await userEvent.type(screen.getByLabelText('Link'), 'https://contoh.com');
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
  await userEvent.type(screen.getByLabelText('Link'), 'https://contoh.com');
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
  await userEvent.type(screen.getByLabelText('Link'), 'https://contoh.com');
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
  await userEvent.type(screen.getByLabelText('Link'), 'https://contoh.com');
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
  await userEvent.type(screen.getByLabelText('Link'), 'https://contoh.com');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  expect(onSubmit.mock.calls[0]?.[1]).toEqual({ overflow: false, thenExport: false });
});

test('isi tidak muat: Simpan tetap boleh dan melaporkan overflow=true', async () => {
  const { onSubmit } = renderForm({ canExport: true });
  await userEvent.click(screen.getByLabelText('Title'));
  await userEvent.paste('x'.repeat(60));
  await userEvent.type(screen.getByLabelText('Link'), 'https://contoh.com');
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
  await userEvent.type(screen.getByLabelText('Link'), 'https://contoh.com');
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
