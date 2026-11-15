import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentType, Suspense } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// Rute dipasang tanpa router sungguhan: createFileRoute diganti pembungkus opsi, useNavigate/useBlocker diganti tiruan.
const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  blockerFn: undefined as (() => boolean) | undefined,
}));
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<object>('@tanstack/react-router')),
  createFileRoute: () => (options: { component: () => unknown }) => ({ options }),
  useNavigate: () => state.navigate,
  useBlocker: (opts: { shouldBlockFn: () => boolean }) => {
    state.blockerFn = opts.shouldBlockFn;
  },
}));
vi.mock('@/modules/auth/permissions', () => ({ requirePermission: vi.fn() }));
// RecordPage diganti kerangka yang memicu callback rute.
vi.mock('@/modules/serial/components/record-page', () => ({
  RecordPage: (props: { onDirtyChange?: (dirty: boolean) => void; onAllSaved?: () => void }) => (
    <div>
      <button type="button" onClick={() => props.onDirtyChange?.(true)}>
        isi
      </button>
      <button type="button" onClick={() => props.onAllSaved?.()}>
        semua tersimpan
      </button>
    </div>
  ),
}));

import { Route } from './new';

// Komponen rute dipecah otomatis (lazy): dimuat dulu agar render pertama langsung memakai isinya.
const Component = (
  Route as unknown as { options: { component: ComponentType & { preload?: () => Promise<void> } } }
).options.component;

async function mount() {
  await Component.preload?.();
  return render(
    <Suspense fallback={<p>memuat</p>}>
      <Component />
    </Suspense>,
  );
}

beforeEach(() => {
  state.navigate.mockReset();
  state.blockerFn = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('draf berisi: keluar halaman meminta konfirmasi; ditolak = diblokir', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'isi' }));
  expect(state.blockerFn?.()).toBe(true);
  expect(confirm).toHaveBeenCalledTimes(1);
});

test('semua baris tersimpan: berpindah ke daftar tanpa konfirmasi keluar', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'isi' }));
  await userEvent.click(screen.getByRole('button', { name: 'semua tersimpan' }));
  expect(state.navigate).toHaveBeenCalledWith({ to: '/serial' });
  // Penjaga keluar sudah tidak menahan (draf kosong) dan tidak menampilkan konfirmasi.
  expect(state.blockerFn?.()).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
});
