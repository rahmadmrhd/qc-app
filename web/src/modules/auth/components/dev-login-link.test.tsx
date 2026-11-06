import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { DevLoginLink } from './dev-login-link';

test('tautan dev-login mengarah ke /auth/dev-login (navigasi penuh, bukan rute klien)', () => {
  render(<DevLoginLink />);
  expect(screen.getByRole('link', { name: 'Masuk sebagai pengguna dev' })).toHaveAttribute(
    'href',
    '/auth/dev-login',
  );
});
