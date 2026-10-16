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
  render(
    <QueryClientProvider client={client}>
      <QrDesignForm
        defaultValues={toQrFormDefaults()}
        designs={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onSubmit };
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
