import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DeletedBadge } from './deleted-badge';

it('menampilkan Terhapus sebagai badge secondary soft', () => {
  render(<DeletedBadge />);
  const badge = screen.getByText('Terhapus');
  expect(badge).toHaveAttribute('data-color', 'secondary');
  expect(badge).toHaveAttribute('data-variant', 'soft');
});
