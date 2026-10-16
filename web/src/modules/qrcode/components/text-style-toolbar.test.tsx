import { DEFAULT_QR_STYLE } from '@shared/qrcode';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { TextStyleToolbar } from './text-style-toolbar';

const plain = { bold: false, italic: false, underline: false, strike: false, uppercase: false };

test('lima tombol gaya per bagian, berlabel dengan nama bagian, dan status tekan sesuai nilai', () => {
  render(<TextStyleToolbar part="Title" value={DEFAULT_QR_STYLE.title} onChange={vi.fn()} />);
  expect(screen.getByRole('group', { name: 'Gaya Title' })).toBeInTheDocument();
  for (const name of ['Tebal', 'Miring', 'Garis bawah', 'Coret', 'Huruf kapital']) {
    expect(screen.getByRole('button', { name: `${name} Title` })).toBeInTheDocument();
  }
  expect(screen.getByRole('button', { name: 'Tebal Title' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: 'Miring Title' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('menekan tombol membalik satu gaya dan mempertahankan yang lain', async () => {
  const onChange = vi.fn();
  render(
    <TextStyleToolbar part="Footer" value={{ ...plain, underline: true }} onChange={onChange} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Miring Footer' }));
  expect(onChange).toHaveBeenLastCalledWith({ ...plain, underline: true, italic: true });
  await userEvent.click(screen.getByRole('button', { name: 'Garis bawah Footer' }));
  expect(onChange).toHaveBeenLastCalledWith({ ...plain, underline: false });
});
