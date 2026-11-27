import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const handoffMock = vi.hoisted(() => ({ openInDesktop: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/modules/countrylock/lib/handoff', () => handoffMock);

import { meQueryKey } from '@/modules/auth/queries';
import { createFakeBridge } from '@/modules/countrylock/fake-bridge';
import { ThemeProvider } from '@/modules/theme/theme-provider';
import { AppShell } from './app-shell';

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

afterEach(() => {
  delete (window as unknown as { qcBridge?: unknown }).qcBridge;
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
    serialwh: 'none',
    countrylock: 'view',
    dashboard: 'none',
  },
  businessUnits: [],
  canManageSerialSettings: true,
  sharedAccount: false,
  locations: [],
};

function renderShell() {
  const root = createRootRoute({ component: AppShell });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => <p>isi</p> });
  const router = createRouter({
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const queryClient = new QueryClient();
  queryClient.setQueryData(meQueryKey, me);
  render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

test('AppShell di desktop memasang spanduk pembaruan UI dan menu Country Lock', async () => {
  let emit: (info: { uiVersion: string }) => void = () => undefined;
  (window as unknown as { qcBridge?: unknown }).qcBridge = createFakeBridge({
    ui: {
      onUpdateReady: (cb) => {
        emit = cb;
        return () => undefined;
      },
    },
  });
  renderShell();
  expect(await screen.findByText('isi')).toBeInTheDocument();
  expect(screen.queryByText(/versi ui baru tersedia/i)).not.toBeInTheDocument();
  act(() => emit({ uiVersion: 'v2' }));
  expect(await screen.findByText(/versi ui baru tersedia/i)).toBeInTheDocument();
  expect(screen.getAllByText('Country Lock').length).toBeGreaterThan(0);
});

test('AppShell di peramban: tanpa spanduk; menu Country Lock tampil bagi yang berizin countrylock', async () => {
  renderShell();
  expect(await screen.findByText('isi')).toBeInTheDocument();
  expect(screen.queryByText(/versi ui baru tersedia/i)).not.toBeInTheDocument();
  // Sejak 2026-11-16 butir ini mengikuti izin `countrylock`, bukan lagi hanya desktop (di peramban membuka desktop).
  expect(screen.getAllByText('Country Lock').length).toBeGreaterThan(0);
});

test('di peramban, menekan butir Country Lock di sidebar membawa akun ke aplikasi desktop', async () => {
  renderShell();
  expect(await screen.findByText('isi')).toBeInTheDocument();
  handoffMock.openInDesktop.mockClear();
  const link = screen.getAllByRole('link', { name: /country lock/i })[0];
  if (!link) throw new Error('butir Country Lock tidak ada');
  await userEvent.click(link);
  expect(handoffMock.openInDesktop).toHaveBeenCalledTimes(1);
});

test('di aplikasi desktop, butir Country Lock rute biasa (tanpa serah-terima)', async () => {
  (window as unknown as { qcBridge?: unknown }).qcBridge = createFakeBridge();
  renderShell();
  expect(await screen.findByText('isi')).toBeInTheDocument();
  handoffMock.openInDesktop.mockClear();
  const link = screen.getAllByRole('link', { name: /country lock/i })[0];
  if (!link) throw new Error('butir Country Lock tidak ada');
  await userEvent.click(link);
  expect(handoffMock.openInDesktop).not.toHaveBeenCalled();
});
