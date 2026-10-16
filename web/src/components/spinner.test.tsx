import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { BusyLabel, Spinner } from './spinner';

test('Spinner: indikator status dengan animasi putar dan label aksesibel', () => {
  render(<Spinner />);
  const spinner = screen.getByRole('status', { name: 'Memuat' });
  expect(spinner.getAttribute('class')).toContain('animate-spin');
});

test('BusyLabel: spinner di samping teks, dan label menggantikan nama status', () => {
  const { container } = render(<BusyLabel>Memeriksa berkas…</BusyLabel>);
  expect(screen.getByText('Memeriksa berkas…')).toBeInTheDocument();
  expect(container.querySelector('.animate-spin')).not.toBeNull();
  expect(screen.queryByRole('status')).toBeNull(); // dekoratif: nama tombol tetap hanya teks
});
