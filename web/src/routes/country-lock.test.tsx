import { QueryClient } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { createAppRouter } from '@/app/router';
import { createFakeBridge } from '@/modules/countrylock/fake-bridge';
import { ThemeProvider } from '@/modules/theme/theme-provider';

afterEach(() => {
  delete (window as unknown as { qcBridge?: unknown }).qcBridge;
});

test('/country-lock di peramban tanpa sesi: menampilkan OpenInDesktop dan tautan Masuk', async () => {
  window.history.replaceState(null, '', '/country-lock');
  const router = createAppRouter(new QueryClient());
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  expect(await screen.findByText(/unduhan tersedia setelah rilis/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Masuk' })).toHaveAttribute('href', '/login');
  expect(window.location.pathname).toBe('/country-lock');
});

test('/country-lock di aplikasi desktop (jembatan ada): menampilkan halaman Country Lock tanpa sesi', async () => {
  (window as unknown as { qcBridge?: unknown }).qcBridge = createFakeBridge();
  window.history.replaceState(null, '', '/country-lock');
  const router = createAppRouter(new QueryClient());
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  expect(await screen.findByRole('combobox', { name: 'Merk' })).toBeInTheDocument();
  expect(screen.queryByText(/unduhan tersedia setelah rilis/i)).not.toBeInTheDocument();
  expect(window.location.pathname).toBe('/country-lock');
});
