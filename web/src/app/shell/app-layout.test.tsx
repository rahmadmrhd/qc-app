import type { MeDto } from '@shared/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { meQueryKey } from '@/modules/auth/queries';
import { createFakeBridge } from '@/modules/countrylock/fake-bridge';
import { ThemeProvider } from '@/modules/theme/theme-provider';
import { raiseOutdatedLevel, resetOutdatedForTests } from '../pwa/client-outdated';
import { AppLayout } from './app-layout';

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
  resetOutdatedForTests();
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

function renderLayout() {
  const root = createRootRoute({ component: AppLayout });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => <p>isi</p> });
  const lock = createRoute({
    getParentRoute: () => root,
    path: '/country-lock',
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, lock]),
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

test('tidak tertahan: layout _app menampilkan cangkang dan isi rute', async () => {
  (window as unknown as { qcBridge?: unknown }).qcBridge = createFakeBridge();
  renderLayout();
  expect(await screen.findByText('isi')).toBeInTheDocument();
  expect(screen.queryByText('Perlu pembaruan')).toBeNull();
});

test('tertahan di desktop (426): layar Perlu pembaruan menggantikan isi dan cangkang', async () => {
  (window as unknown as { qcBridge?: unknown }).qcBridge = createFakeBridge();
  raiseOutdatedLevel('outdated');
  renderLayout();
  expect(await screen.findByText('Perlu pembaruan')).toBeInTheDocument();
  expect(screen.queryByText('isi')).toBeNull();
  expect(screen.queryByRole('banner')).toBeNull();
});

test('peramban tidak pernah tertahan walau level outdated', async () => {
  raiseOutdatedLevel('outdated');
  renderLayout();
  expect(await screen.findByText('isi')).toBeInTheDocument();
  expect(screen.queryByText('Perlu pembaruan')).toBeNull();
});
