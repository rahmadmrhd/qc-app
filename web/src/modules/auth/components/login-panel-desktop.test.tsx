import type { AuthStatus } from '@countrylock/bridge-contract';
import type { MeDto } from '@shared/contract';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { createFakeBridge } from '@/modules/countrylock/fake-bridge';
import { LoginPanel, type LoginPanelProps } from './login-panel';

afterEach(() => {
  delete (window as unknown as { qcBridge?: unknown }).qcBridge;
});

const me = { email: 'a@x.com', name: 'A' } as MeDto;
const STATUS: AuthStatus = { signedIn: true, email: 'a@x.com', serverUrl: 'https://qc.rhd.my.id' };

function setBridge(bridge: unknown) {
  (window as unknown as { qcBridge?: unknown }).qcBridge = bridge;
}

/** Panel login memakai `Link` (Country Lock) sehingga di desktop perlu router. */
async function renderInRouter(props: Partial<LoginPanelProps> = {}) {
  const root = createRootRoute({
    component: () => (
      <LoginPanel loginUrl="/auth/login" authError={null} authErrorEmail={null} {...props} />
    ),
  });
  const countryLock = createRoute({
    getParentRoute: () => root,
    path: '/country-lock',
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([countryLock]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByText('QC App');
}

/** Jembatan yang menyimpan pendengar `auth.onChange` agar tes dapat memicunya. */
function bridgeWithEmitter() {
  const emitter: { emit: (s: AuthStatus) => void } = { emit: () => undefined };
  const bridge = createFakeBridge({
    auth: {
      onChange: (cb) => {
        emitter.emit = cb;
        return () => undefined;
      },
    },
  });
  return { bridge, emitter };
}

test('di browser: tautan /auth/login dan tanpa tautan Country Lock (perilaku lama)', () => {
  render(<LoginPanel loginUrl="/auth/login" authError={null} authErrorEmail={null} />);
  expect(screen.getByRole('link', { name: 'Masuk dengan Google' })).toHaveAttribute(
    'href',
    '/auth/login',
  );
  expect(screen.queryByRole('link', { name: /country lock/i })).not.toBeInTheDocument();
});

test('desktop: panel login memanggil bridge.auth.login dan tidak mengarahkan ke /auth/login', async () => {
  const login = vi.fn(async () => undefined);
  setBridge(createFakeBridge({ auth: { login } }));
  await renderInRouter();

  expect(document.querySelector('a[href="/auth/login"]')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Masuk dengan Google' }));
  expect(login).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/lanjutkan login di browser/i)).toBeInTheDocument();
});

test('desktop: setelah onChange signedIn, me dimuat ulang dan onDesktopSignedIn dipanggil', async () => {
  const { bridge, emitter } = bridgeWithEmitter();
  setBridge(bridge);
  const loadMeState = vi.fn(async () => ({ me, unreachable: false }));
  const onDesktopSignedIn = vi.fn();
  await renderInRouter({ loadMeState, onDesktopSignedIn });
  await userEvent.click(screen.getByRole('button', { name: 'Masuk dengan Google' }));

  // Perubahan status yang bukan signedIn diabaikan.
  act(() => emitter.emit({ ...STATUS, signedIn: false, email: null }));
  expect(loadMeState).not.toHaveBeenCalled();

  act(() => emitter.emit(STATUS));
  await waitFor(() => expect(onDesktopSignedIn).toHaveBeenCalledWith(me));
  expect(loadMeState).toHaveBeenCalledTimes(1);
});

test('desktop: signedIn tetapi me gagal dimuat menampilkan galat, bukan masuk', async () => {
  const { bridge, emitter } = bridgeWithEmitter();
  setBridge(bridge);
  const loadMeState = vi.fn(async () => ({ me: null, unreachable: true }));
  const onDesktopSignedIn = vi.fn();
  await renderInRouter({ loadMeState, onDesktopSignedIn });
  await userEvent.click(screen.getByRole('button', { name: 'Masuk dengan Google' }));
  act(() => emitter.emit(STATUS));
  expect(await screen.findByText(/tidak dapat terhubung ke server/i)).toBeInTheDocument();
  expect(onDesktopSignedIn).not.toHaveBeenCalled();
});

test('desktop: gagal membuka peramban menampilkan galat dan tombol dapat dicoba lagi', async () => {
  const login = vi.fn(async () => {
    throw new Error('ipc');
  });
  setBridge(createFakeBridge({ auth: { login } }));
  await renderInRouter();
  await userEvent.click(screen.getByRole('button', { name: 'Masuk dengan Google' }));
  expect(await screen.findByText(/tidak dapat membuka browser/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Masuk dengan Google' })).toBeEnabled();
});

test('desktop: tautan Country Lock selalu ada; keadaan server tak terjangkau hanya bila boot gagal', async () => {
  setBridge(createFakeBridge());
  await renderInRouter();
  expect(screen.getByRole('link', { name: /country lock/i })).toHaveAttribute(
    'href',
    '/country-lock',
  );
  expect(screen.queryByText(/tidak dapat terhubung ke server/i)).not.toBeInTheDocument();
});

test('desktop: server tak terjangkau saat boot menampilkan peringatan dengan tautan Country Lock', async () => {
  setBridge(createFakeBridge());
  await renderInRouter({ serverUnreachable: true });
  expect(screen.getByText(/tidak dapat terhubung ke server/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /country lock/i })).toBeInTheDocument();
});
