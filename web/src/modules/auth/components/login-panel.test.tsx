import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { LoginPanel } from './login-panel';

test('menampilkan email yang belum terdaftar dan tombol login ke Google di jendela utama', () => {
  render(
    <LoginPanel
      loginUrl="https://accounts.google.com/x"
      authError="NOT_WHITELISTED"
      authErrorEmail="asing@gmail.com"
    />,
  );
  expect(screen.getByText(/asing@gmail\.com belum terdaftar/)).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Masuk dengan Google' });
  expect(link).toHaveAttribute('href', 'https://accounts.google.com/x');
  expect(link).toHaveAttribute('target', '_top');
});

test('menampilkan pesan login gagal', () => {
  render(<LoginPanel loginUrl="u" authError="LOGIN_FAILED" authErrorEmail={null} />);
  expect(screen.getByText('Login gagal')).toBeInTheDocument();
});

test('tanpa loginUrl tidak ada tombol login', () => {
  render(<LoginPanel loginUrl={null} authError={null} authErrorEmail={null} />);
  expect(screen.queryByRole('link')).toBeNull();
});
