import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { LoginPanel } from './login-panel';

test('menampilkan email yang belum terdaftar dan tautan login ke /auth/login', () => {
  render(
    <LoginPanel
      loginUrl="/auth/login"
      authError="NOT_WHITELISTED"
      authErrorEmail="asing@gmail.com"
    />,
  );
  expect(screen.getByText(/asing@gmail\.com belum terdaftar/)).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Masuk dengan Google' });
  expect(link).toHaveAttribute('href', '/auth/login');
});

test('NOT_WHITELISTED tanpa email memakai pesan umum', () => {
  render(<LoginPanel loginUrl="/auth/login" authError="NOT_WHITELISTED" authErrorEmail={null} />);
  expect(screen.getByText(/Email Anda belum terdaftar/)).toBeInTheDocument();
});

test('menampilkan pesan login gagal', () => {
  render(<LoginPanel loginUrl="/auth/login" authError="LOGIN_FAILED" authErrorEmail={null} />);
  expect(screen.getByText('Login gagal')).toBeInTheDocument();
});
