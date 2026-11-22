import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createAppRouter } from '@/app/router';
import { meQueryKey } from '@/modules/auth/queries';
import { ANONYMOUS_SESSION, initSession, markAuthenticated } from '@/modules/auth/session';
import { createFakeBridge } from '@/modules/countrylock/fake-bridge';
import { ThemeProvider } from '@/modules/theme/theme-provider';

beforeEach(() => {
  // Sidebar (use-mobile) dan tema membaca matchMedia, yang tidak ada di jsdom.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

const me: MeDto = {
  email: 'a@x.com',
  name: 'A',
  isSuperAdmin: true,
  permissions: {
    access: 'manage',
    item: 'manage',
    qrcode: 'manage',
    handover: 'manage',
    qc: 'manage',
    stock: 'manage',
    sticker: 'manage',
    stickerstock: 'manage',
    serial: 'manage',
    serialservice: 'manage',
    countrylock: 'none',
  },
  businessUnits: [],
  canManageSerialSettings: true,
  sharedAccount: false,
  locations: [],
};

afterEach(() => {
  initSession(ANONYMOUS_SESSION);
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
  expect(
    await screen.findByText(/unduhan tersedia setelah rilis/i, {}, { timeout: 8000 }),
  ).toBeInTheDocument();
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
  expect(
    await screen.findByRole('combobox', { name: 'Merk' }, { timeout: 8000 }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/unduhan tersedia setelah rilis/i)).not.toBeInTheDocument();
  expect(window.location.pathname).toBe('/country-lock');
  // Pembungkus ringan memakai latar yang sama dengan bar judul (bg-background), bukan pita bg-muted di belakangnya.
  const wrapper = screen.getByRole('main').parentElement as HTMLElement;
  expect(wrapper).toHaveClass('bg-background');
  expect(wrapper).not.toHaveClass('bg-muted/40');
});

test('/country-lock bagi pengguna login yang data penggunanya belum termuat: pembungkus ringan dengan tautan kembali ke aplikasi, bukan Masuk', async () => {
  markAuthenticated('a@x.com');
  window.history.replaceState(null, '', '/country-lock');
  const router = createAppRouter(new QueryClient());
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  expect(
    await screen.findByRole('link', { name: 'Kembali ke aplikasi' }, { timeout: 8000 }),
  ).toHaveAttribute('href', '/');
  expect(screen.queryByRole('link', { name: 'Masuk' })).not.toBeInTheDocument();
});

test('/country-lock di desktop menampilkan spanduk pembaruan UI saat bundel baru siap; tidak di peramban', async () => {
  let emit: (info: { uiVersion: string }) => void = () => undefined;
  (window as unknown as { qcBridge?: unknown }).qcBridge = createFakeBridge({
    ui: {
      onUpdateReady: (cb) => {
        emit = cb;
        return () => undefined;
      },
    },
  });
  window.history.replaceState(null, '', '/country-lock');
  const router = createAppRouter(new QueryClient());
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  await screen.findByRole('combobox', { name: 'Merk' }, { timeout: 8000 });
  expect(screen.queryByText(/versi ui baru tersedia/i)).not.toBeInTheDocument();
  act(() => emit({ uiVersion: 'v2' }));
  expect(await screen.findByText(/versi ui baru tersedia/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Muat ulang' })).toBeInTheDocument();
});

test('/country-lock bagi pengguna login (data pengguna tersedia) tampil di dalam AppShell: ada sidebar dan tanpa tautan "Kembali ke aplikasi"', async () => {
  (window as unknown as { qcBridge?: unknown }).qcBridge = createFakeBridge();
  markAuthenticated('a@x.com');
  window.history.replaceState(null, '', '/country-lock');
  const queryClient = new QueryClient();
  queryClient.setQueryData(meQueryKey, me);
  const router = createAppRouter(queryClient);
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  // Isi halaman Country Lock tetap ada...
  expect(
    await screen.findByRole('combobox', { name: 'Merk' }, { timeout: 8000 }),
  ).toBeInTheDocument();
  // ...di dalam cangkang aplikasi: sidebar dengan menu lain (mis. "Handover"/menu Country Lock) dan pemicu sidebar.
  expect(document.querySelector('[data-tour="sidebar-trigger"]')).not.toBeNull();
  expect(document.querySelector('[data-sidebar="sidebar"]')).not.toBeNull();
  expect(screen.queryByRole('link', { name: 'Kembali ke aplikasi' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Masuk' })).not.toBeInTheDocument();
  expect(window.location.pathname).toBe('/country-lock');
});

test('/country-lock tanpa sesi tetap tanpa cangkang (tanpa sidebar), walau data pengguna ada di cache', async () => {
  (window as unknown as { qcBridge?: unknown }).qcBridge = createFakeBridge();
  window.history.replaceState(null, '', '/country-lock');
  const queryClient = new QueryClient();
  queryClient.setQueryData(meQueryKey, me);
  render(
    <ThemeProvider>
      <RouterProvider router={createAppRouter(queryClient)} />
    </ThemeProvider>,
  );
  await screen.findByRole('combobox', { name: 'Merk' }, { timeout: 8000 });
  expect(document.querySelector('[data-sidebar="sidebar"]')).toBeNull();
  expect(screen.getByRole('link', { name: 'Masuk' })).toBeInTheDocument();
});
