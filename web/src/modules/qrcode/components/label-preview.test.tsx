import { DEFAULT_QR_LAYOUT } from '@shared/qrcode';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { LabelPreview } from './label-preview';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

const base = {
  title: 'Panduan',
  subtitle: 'Sub',
  footer: 'foot',
  link: 'https://contoh.com/a',
  layout: DEFAULT_QR_LAYOUT,
  logoUrl: null,
};

test('pratinjau 3 × 3 cm: kanvas berlabel dan tanpa peringatan untuk isi normal', () => {
  render(<LabelPreview {...base} />);
  expect(screen.getByLabelText('Pratinjau label 3 × 3 cm')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('isi melebihi kanvas: peringatan ekspor diblokir', () => {
  render(<LabelPreview {...base} title={'kata '.repeat(60)} />);
  expect(screen.getByRole('alert')).toHaveTextContent('melebihi kanvas');
});

test('QR terlalu padat: peringatan (bukan galat) agar link dipendekkan atau QR diperbesar', () => {
  render(
    <LabelPreview
      {...base}
      link={`https://contoh.com/${'a'.repeat(280)}`}
      layout={{ ...DEFAULT_QR_LAYOUT, qrSize: 12 }}
    />,
  );
  expect(screen.getByText(/terlalu padat/i)).toBeInTheDocument();
});

test('link kosong: tetap menampilkan pratinjau dengan QR contoh dan petunjuk', () => {
  render(<LabelPreview {...base} link="" />);
  expect(screen.getByText(/Isi link/i)).toBeInTheDocument();
});
