import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { PageLoading } from './page-loading';

test('menampilkan keterangan memuat data (dapat diganti) sebagai status yang dibacakan', () => {
  const { rerender } = render(<PageLoading />);
  expect(screen.getAllByRole('status')[0]).toHaveTextContent('Memuat data…');
  rerender(<PageLoading label="Memuat log audit…" />);
  expect(screen.getAllByRole('status')[0]).toHaveTextContent('Memuat log audit…');
});
