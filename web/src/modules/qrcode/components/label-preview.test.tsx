import { DEFAULT_QR_LAYOUT, DEFAULT_QR_STYLE } from '@shared/qrcode';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

test('isi melebihi kanvas: dilaporkan lewat onStatus; pratinjau sendiri tidak menampilkan pesan (banner ada di form)', () => {
  const onStatus = vi.fn();
  render(<LabelPreview {...base} title={'kata '.repeat(60)} onStatus={onStatus} />);
  expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ overflow: true }));
  expect(screen.queryByRole('alert')).toBeNull();
});

test('QR terlalu padat: dilaporkan tooDense (bukan overflow) beserta ukuran modul', () => {
  const onStatus = vi.fn();
  render(
    <LabelPreview
      {...base}
      link={`https://contoh.com/${'a'.repeat(280)}`}
      layout={{ ...DEFAULT_QR_LAYOUT, qrSize: 12 }}
      onStatus={onStatus}
    />,
  );
  expect(onStatus).toHaveBeenLastCalledWith(
    expect.objectContaining({ overflow: false, tooDense: true, moduleMm: expect.any(Number) }),
  );
});

test('isi normal: onStatus melaporkan tanpa masalah', () => {
  const onStatus = vi.fn();
  render(<LabelPreview {...base} onStatus={onStatus} />);
  expect(onStatus).toHaveBeenLastCalledWith(
    expect.objectContaining({ overflow: false, tooDense: false }),
  );
});

test('link kosong: tetap menampilkan pratinjau dengan QR contoh dan petunjuk', () => {
  render(<LabelPreview {...base} link="" />);
  expect(screen.getByText(/Isi link/i)).toBeInTheDocument();
});

test('pratinjau dapat diklik: membuka tampilan diperbesar dengan kanvas yang lebih besar; Escape menutup', async () => {
  render(<LabelPreview {...base} />);
  expect(screen.queryByLabelText('Pratinjau label diperbesar')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Perbesar pratinjau label' }));
  const zoom = await screen.findByLabelText('Pratinjau label diperbesar');
  expect(zoom).toBeInstanceOf(HTMLCanvasElement);
  expect(Number((zoom as HTMLCanvasElement).width)).toBeGreaterThan(360);
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByLabelText('Pratinjau label diperbesar')).toBeNull();
});

test('bingkai rapat ke QR dilaporkan lewat onStatus.frameTight', () => {
  const onStatus = vi.fn();
  render(
    <LabelPreview
      {...base}
      style={{ ...DEFAULT_QR_STYLE, frame: { ...DEFAULT_QR_STYLE.frame, kind: 'box', gap: 0.1 } }}
      onStatus={onStatus}
    />,
  );
  expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ frameTight: true }));
});
