import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { OpenInDesktop } from './open-in-desktop';

describe('OpenInDesktop', () => {
  test('di browser menampilkan tautan qc://country-lock dan teks unduhan belum tersedia', () => {
    render(<OpenInDesktop />);
    const link = screen.getByRole('link', { name: /buka di aplikasi desktop/i });
    expect(link).toHaveAttribute('href', 'qc://country-lock');
    expect(screen.getByText(/unduhan tersedia setelah rilis/i)).toBeInTheDocument();
  });
});
