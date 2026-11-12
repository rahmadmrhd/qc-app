import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}));

import {
  notifyChunkLoadFailure,
  resetPwaUpdateForTests,
  usePwaUpdateSnapshotForTests,
} from '@/app/pwa/update';
import { ErrorView } from './error-view';

const info = { componentStack: '' };

beforeEach(() => {
  resetPwaUpdateForTests();
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
