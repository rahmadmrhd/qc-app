import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { createFakeBridge } from '@/modules/countrylock/fake-bridge';
import { ANONYMOUS_SESSION, initSession, markAuthenticated } from './session';
import { useLogout } from './use-logout';

afterEach(() => {
  delete (window as unknown as { qcBridge?: unknown }).qcBridge;
  vi.unstubAllGlobals();
  initSession(ANONYMOUS_SESSION);
});

function Harness() {
  const logout = useLogout();
  return (
    <button type="button" onClick={logout}>
      Keluar
    </button>
  );
}

function renderHarness() {
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: Harness });
  const login = createRoute({
    getParentRoute: () => root,
    path: '/login',
    component: () => <p>halaman login</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, login]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const queryClient = new QueryClient();
  queryClient.setQueryData(['auth', 'me'], { email: 'a@x.com' });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

test('logout di desktop memanggil bridge.auth.logout, membersihkan sesi/cache, dan ke /login', async () => {
  const logout = vi.fn(async () => undefined);
  (window as unknown as { qcBridge?: unknown }).qcBridge = createFakeBridge({ auth: { logout } });
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  markAuthenticated('a@x.com');
  const { queryClient } = renderHarness();

  await userEvent.click(await screen.findByRole('button', { name: 'Keluar' }));
  expect(await screen.findByText('halaman login')).toBeInTheDocument();
  expect(logout).toHaveBeenCalledTimes(1);
  // Tanpa POST /auth/logout langsung dari renderer: proses utama yang mengurus token.
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(queryClient.getQueryData(['auth', 'me'])).toBeUndefined();
});

test('logout di desktop tetap lanjut bila bridge.auth.logout gagal', async () => {
  const logout = vi.fn(async () => {
    throw new Error('ipc');
  });
  (window as unknown as { qcBridge?: unknown }).qcBridge = createFakeBridge({ auth: { logout } });
  renderHarness();
  await userEvent.click(await screen.findByRole('button', { name: 'Keluar' }));
  await waitFor(() => expect(screen.getByText('halaman login')).toBeInTheDocument());
  expect(logout).toHaveBeenCalledTimes(1);
});

test('di browser perilaku lama tidak berubah: tetap ke /login tanpa jembatan', async () => {
  renderHarness();
  await userEvent.click(await screen.findByRole('button', { name: 'Keluar' }));
  expect(await screen.findByText('halaman login')).toBeInTheDocument();
});
