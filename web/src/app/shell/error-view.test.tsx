import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}));

import { resetUnsavedChangesForTests, useUnsavedChanges } from '@/app/pwa/unsaved-changes';
import {
  notifyChunkLoadFailure,
  type RegisterSW,
  resetPwaUpdateForTests,
  startPwaUpdates,
  usePwaUpdateSnapshotForTests,
} from '@/app/pwa/update';
import { ErrorView } from './error-view';

const info = { componentStack: '' };

function Dirty() {
  useUnsavedChanges(true);
  return null;
}

beforeEach(() => {
  resetPwaUpdateForTests();
  resetUnsavedChangesForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test('galat muat potongan rute (tanpa pendengar vite:preloadError) menyalakan status versi baru', () => {
  const error = new TypeError('Failed to fetch dynamically imported module: /assets/qrcode-x.js');
  render(<ErrorView error={error} reset={() => undefined} info={info} />);
  expect(usePwaUpdateSnapshotForTests()).toBe(true);
});

test('galat biasa tidak menyalakan status versi baru dan menawarkan Coba lagi', () => {
  render(<ErrorView error={new Error('Gagal')} reset={() => undefined} info={info} />);
  expect(usePwaUpdateSnapshotForTests()).toBe(false);
  expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
});

test('jalur SW aktif: preloadError dicegah sehingga rute melempar TypeError (reading component); ErrorView mengarahkan ke Muat ulang', async () => {
  const reload = vi.fn();
  vi.stubGlobal('location', { reload });
  // Urutan nyata: vite:preloadError menyalakan spanduk, lalu import() rute bernilai undefined dan TanStack
  // melempar TypeError yang bukan galat muat potongan.
  act(() => notifyChunkLoadFailure());
  const error = new TypeError("Cannot read properties of undefined (reading 'component')");
  render(<ErrorView error={error} reset={() => undefined} info={info} />);
  expect(screen.getByText(/Versi baru aplikasi tersedia/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Muat ulang' }));
  expect(reload).toHaveBeenCalledTimes(1);
});

test('B3: dengan formulir belum disimpan, ErrorView memperingatkan perubahan akan hilang bila dimuat ulang', () => {
  act(() => notifyChunkLoadFailure());
  render(
    <>
      <Dirty />
      <ErrorView error={new Error('x')} reset={() => undefined} info={info} />
    </>,
  );
  expect(screen.getByText(/formulir yang belum disimpan/i)).toBeInTheDocument();
  expect(screen.getByText(/hilang bila dimuat ulang/i)).toBeInTheDocument();
});

test('B3: tanpa formulir kotor, kalimat tidak menjanjikan perbaikan untuk galat apa pun', () => {
  act(() => notifyChunkLoadFailure());
  render(<ErrorView error={new Error('x')} reset={() => undefined} info={info} />);
  expect(
    screen.getByText('Versi baru aplikasi tersedia; muat ulang bila galat berlanjut.'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/formulir yang belum disimpan/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/memperbaiki halaman ini/i)).not.toBeInTheDocument();
});

test('B4: tombol Muat ulang di ErrorView menampilkan Memuat… dan nonaktif selama menunggu', async () => {
  const updateSW = vi.fn(async (_reload?: boolean) => undefined);
  let options: Parameters<RegisterSW>[0] = {};
  const register: RegisterSW = (given) => {
    options = given;
    return updateSW;
  };
  const noop = () => undefined;
  startPwaUpdates({
    register,
    win: {
      navigator: { serviceWorker: { addEventListener: noop, removeEventListener: noop } },
      document: { addEventListener: noop, removeEventListener: noop },
      addEventListener: noop,
      removeEventListener: noop,
      location: { reload: vi.fn() },
      setInterval: () => 0,
      clearInterval: noop,
      setTimeout: () => 0,
      clearTimeout: noop,
    } as unknown as Window,
  });
  const registration = { update: vi.fn().mockResolvedValue(undefined), waiting: {} };
  options.onRegisteredSW?.('/sw.js', registration as unknown as ServiceWorkerRegistration);
  act(() => options.onNeedRefresh?.());
  render(<ErrorView error={new Error('x')} reset={() => undefined} info={info} />);
  await userEvent.click(screen.getByRole('button', { name: 'Muat ulang' }));
  expect(updateSW).toHaveBeenCalledWith(true);
  expect(screen.getByRole('button', { name: 'Memuat…' })).toBeDisabled();
});
