import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { LabelStatusAlerts } from './label-status-alerts';

test('tanpa masalah atau belum ada status: tidak ada banner', () => {
  const { container, rerender } = render(<LabelStatusAlerts status={null} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<LabelStatusAlerts status={{ overflow: false, tooDense: false, moduleMm: 0.5 }} />);
  expect(container).toBeEmptyDOMElement();
});

test('overflow: banner galat berjudul dan menjelaskan ekspor diblokir', () => {
  render(<LabelStatusAlerts status={{ overflow: true, tooDense: false, moduleMm: 0.5 }} />);
  const banner = screen.getByRole('alert');
  expect(banner).toHaveTextContent('Isi melebihi kanvas 3 × 3 cm');
  expect(banner).toHaveTextContent('Ekspor diblokir');
});

test('QR terlalu padat: banner peringatan (status, bukan alert) dengan ukuran modul; ekspor tetap boleh', () => {
  render(<LabelStatusAlerts status={{ overflow: false, tooDense: true, moduleMm: 0.2144 }} />);
  expect(screen.queryByRole('alert')).toBeNull();
  const banner = screen.getByRole('status');
  expect(banner).toHaveTextContent('QR terlalu padat');
  expect(banner).toHaveTextContent('0,21 mm');
  expect(banner).toHaveTextContent('Ekspor tetap diizinkan');
});

test('keduanya sekaligus: dua banner', () => {
  render(<LabelStatusAlerts status={{ overflow: true, tooDense: true, moduleMm: 0.2 }} />);
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('status')).toBeInTheDocument();
});
