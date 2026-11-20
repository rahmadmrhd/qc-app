import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { raiseOutdatedLevel, resetOutdatedForTests } from '@/app/pwa/client-outdated';
import { resetServerApisForTests } from '@/lib/api/versions';
import { createFakeBridge } from '@/modules/countrylock/fake-bridge';
import { DesktopUpdateGate } from './desktop-update-gate';

function installBridge(overrides: Parameters<typeof createFakeBridge>[0] = {}) {
  (window as unknown as { qcBridge?: unknown }).qcBridge = createFakeBridge(overrides);
}

/** Gerbang dirender di dalam router karena tautan "Buka Country Lock" memakai `Link`. */
function renderGate() {
  const root = createRootRoute({
    component: () => (
      <DesktopUpdateGate>
        <p>isi aplikasi</p>
      </DesktopUpdateGate>
    ),
  });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => null });
  const lock = createRoute({
    getParentRoute: () => root,
    path: '/country-lock',
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([home, lock]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
}

beforeEach(() => {
  localStorage.clear();
  resetServerApisForTests();
  resetOutdatedForTests();
});
afterEach(() => {
  delete (window as unknown as { qcBridge?: unknown }).qcBridge;
  resetServerApisForTests();
  resetOutdatedForTests();
});

describe('DesktopUpdateGate', () => {
  test('tidak menahan: anak tampil, layar penahan tidak', async () => {
    installBridge();
    renderGate();
    expect(await screen.findByText('isi aplikasi')).toBeInTheDocument();
    expect(screen.queryByText('Perlu pembaruan')).toBeNull();
  });

  test('menahan: anak tidak dirender, layar penahan tampil tanpa tombol Nanti', async () => {
    installBridge();
    raiseOutdatedLevel('outdated');
    renderGate();
    expect(await screen.findByText('Perlu pembaruan')).toBeInTheDocument();
    expect(screen.queryByText('isi aplikasi')).toBeNull();
    expect(screen.getByRole('button', { name: 'Perbarui sekarang' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /nanti/i })).toBeNull();
  });

  test('tautan Buka Country Lock menuju /country-lock', async () => {
    installBridge();
    raiseOutdatedLevel('outdated');
    renderGate();
    const link = await screen.findByRole('link', { name: 'Buka Country Lock' });
    expect(link).toHaveAttribute('href', '/country-lock');
  });

  test('klik Perbarui sekarang memanggil app.update sekali dan menonaktifkan tombol selama menunggu', async () => {
    let finish: (value: { status: 'restarting'; message: string }) => void = () => undefined;
    const update = vi.fn(
      () =>
        new Promise<{ status: 'restarting'; message: string }>((resolve) => {
          finish = resolve;
        }),
    );
    installBridge({ app: { update } });
    raiseOutdatedLevel('outdated');
    renderGate();
    await userEvent.click(await screen.findByRole('button', { name: 'Perbarui sekarang' }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Perbarui sekarang' })).toBeDisabled();
    await act(async () => {
      finish({ status: 'restarting', message: 'dari server' });
    });
    expect(
      screen.getByText('Memasang pembaruan, aplikasi akan mulai ulang...'),
    ).toBeInTheDocument();
    // Sedang memasang: tidak ada tautan unduh manual.
    expect(screen.queryByRole('button', { name: 'Unduh manual' })).toBeNull();
  });

  test('hasil failed menampilkan pesannya dan tautan Unduh manual yang memanggil openDownloads', async () => {
    const openDownloads = vi.fn(async () => undefined);
    installBridge({
      app: {
        update: async () => ({ status: 'failed', message: 'Pembaruan gagal diunduh' }),
        openDownloads,
      },
    });
    raiseOutdatedLevel('outdated');
    renderGate();
    await userEvent.click(await screen.findByRole('button', { name: 'Perbarui sekarang' }));
    expect(await screen.findByText('Pembaruan gagal diunduh')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unduh manual' }));
    expect(openDownloads).toHaveBeenCalledTimes(1);
  });

  test.each(['busy', 'up-to-date', 'unavailable'] as const)(
    'hasil %s menampilkan message-nya',
    async (status) => {
      installBridge({ app: { update: async () => ({ status, message: `pesan ${status}` }) } });
      raiseOutdatedLevel('outdated');
      renderGate();
      await userEvent.click(await screen.findByRole('button', { name: 'Perbarui sekarang' }));
      expect(await screen.findByText(`pesan ${status}`)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Unduh manual' })).toBeInTheDocument();
    },
  );

  test('app.update menolak: pesan galat tampil dan tombol aktif lagi, tidak melempar', async () => {
    installBridge({
      app: {
        update: async () => {
          throw new Error('IPC putus');
        },
      },
    });
    raiseOutdatedLevel('outdated');
    renderGate();
    await userEvent.click(await screen.findByRole('button', { name: 'Perbarui sekarang' }));
    expect(await screen.findByText('Pembaruan gagal dijalankan.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Perbarui sekarang' })).toBeEnabled();
  });

  test('openDownloads menolak: pesan galat tampil, tidak melempar', async () => {
    installBridge({
      app: {
        update: async () => ({ status: 'failed', message: 'gagal' }),
        openDownloads: async () => {
          throw new Error('alamat server tidak sah');
        },
      },
    });
    raiseOutdatedLevel('outdated');
    renderGate();
    await userEvent.click(await screen.findByRole('button', { name: 'Perbarui sekarang' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Unduh manual' }));
    expect(await screen.findByText('Halaman unduhan gagal dibuka.')).toBeInTheDocument();
  });
});
