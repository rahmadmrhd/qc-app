import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signedIn: false,
  openInDesktop: vi.fn(),
}));

vi.mock('@/modules/auth/session', () => ({ isAuthenticated: () => mocks.signedIn }));
vi.mock('../lib/handoff', () => ({ openInDesktop: mocks.openInDesktop }));

import { ApiError } from '@/lib/api/api-error';
import { OpenInDesktop } from './open-in-desktop';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signedIn = false;
  mocks.openInDesktop.mockResolvedValue(undefined);
});

describe('OpenInDesktop', () => {
  test('belum login: tautan qc://country-lock biasa dan teks unduhan belum tersedia', () => {
    render(<OpenInDesktop />);
    const link = screen.getByRole('link', { name: /buka di aplikasi desktop/i });
    expect(link).toHaveAttribute('href', 'qc://country-lock');
    expect(screen.getByText(/unduhan tersedia setelah rilis/i)).toBeInTheDocument();
  });

  test('sudah login: tombol membawa akun ke aplikasi desktop dan menjelaskan konfirmasi akun berbeda', async () => {
    mocks.signedIn = true;
    render(<OpenInDesktop />);
    expect(screen.queryByRole('link', { name: /buka di aplikasi desktop/i })).toBeNull();
    expect(screen.getByText(/ditanya dulu/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /buka di aplikasi desktop/i }));
    expect(mocks.openInDesktop).toHaveBeenCalledTimes(1);
  });

  test('tanpa izin countrylock: pesan jelas dan kembali ke tautan biasa', async () => {
    mocks.signedIn = true;
    mocks.openInDesktop.mockRejectedValue(new ApiError('FORBIDDEN', 'Tidak punya akses', 'rid'));
    render(<OpenInDesktop />);
    await userEvent.click(screen.getByRole('button', { name: /buka di aplikasi desktop/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/belum punya izin country lock/i);
    expect(screen.getByRole('link', { name: /buka di aplikasi desktop/i })).toHaveAttribute(
      'href',
      'qc://country-lock',
    );
  });

  test('galat lain (server mati): pesan coba lagi dan tombol tetap bisa dipakai', async () => {
    mocks.signedIn = true;
    mocks.openInDesktop.mockRejectedValue(new ApiError('UNAVAILABLE', 'Tidak ada koneksi', 'rid'));
    render(<OpenInDesktop />);
    await userEvent.click(screen.getByRole('button', { name: /buka di aplikasi desktop/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/coba lagi/i);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /buka di aplikasi desktop/i })).toBeEnabled(),
    );
  });
});
