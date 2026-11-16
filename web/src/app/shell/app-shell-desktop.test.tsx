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
import { afterEach, beforeEach, expect, test } from 'vitest';
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
    countrylock: 'none',
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

test('AppShell di peramban: tanpa spanduk dan tanpa menu Country Lock', async () => {
  renderShell();
  expect(await screen.findByText('isi')).toBeInTheDocument();
  expect(screen.queryByText(/versi ui baru tersedia/i)).not.toBeInTheDocument();
  expect(screen.queryByText('Country Lock')).not.toBeInTheDocument();
});
