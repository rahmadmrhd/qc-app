import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { LabelStatusAlerts } from './label-status-alerts';

test('tanpa masalah atau belum ada status: tidak ada banner', () => {
  const { container, rerender } = render(<LabelStatusAlerts status={null} />);
  expect(container).toBeEmptyDOMElement();
  rerender(
    <LabelStatusAlerts
      status={{ overflow: false, tooDense: false, frameTight: false, moduleMm: 0.5 }}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});

test('overflow: banner galat berjudul dan menjelaskan ekspor diblokir', () => {
  render(
    <LabelStatusAlerts
      status={{ overflow: true, tooDense: false, frameTight: false, moduleMm: 0.5 }}
    />,
  );
  const banner = screen.getByRole('alert');
  expect(banner).toHaveTextContent('Isi melebihi kanvas 3 × 3 cm');
  expect(banner).toHaveTextContent('Ekspor diblokir');
});

test('QR terlalu padat: banner peringatan (status, bukan alert) dengan ukuran modul; ekspor tetap boleh', () => {
  render(
    <LabelStatusAlerts
      status={{ overflow: false, tooDense: true, frameTight: false, moduleMm: 0.2144 }}
    />,
  );
  expect(screen.queryByRole('alert')).toBeNull();
  const banner = screen.getByRole('status');
  expect(banner).toHaveTextContent('QR terlalu padat');
  expect(banner).toHaveTextContent('0,21 mm');
  expect(banner).toHaveTextContent('Ekspor tetap diizinkan');
});

test('keduanya sekaligus: dua banner', () => {
  render(
    <LabelStatusAlerts
      status={{ overflow: true, tooDense: true, frameTight: false, moduleMm: 0.2 }}
    />,
  );
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('status')).toBeInTheDocument();
});

test('angka ukuran modul dibulatkan KE BAWAH agar tidak tampil 0,30 saat disebut terlalu padat', () => {
  render(
    <LabelStatusAlerts
      status={{ overflow: false, tooDense: true, frameTight: false, moduleMm: 0.2999 }}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('0,29 mm');
  expect(screen.getByRole('status')).toHaveTextContent('di bawah 0,30 mm');
});

test('bingkai terlalu dekat ke QR: banner peringatan tersendiri; ekspor tetap diizinkan', () => {
  render(
    <LabelStatusAlerts
      status={{ overflow: false, tooDense: false, frameTight: true, moduleMm: 0.5 }}
    />,
  );
  const banner = screen.getByRole('status');
  expect(banner).toHaveTextContent('Bingkai terlalu dekat dengan QR');
  expect(banner).toHaveTextContent('Ekspor tetap diizinkan');
});
