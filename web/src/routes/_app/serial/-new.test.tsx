import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentType, Suspense, useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { clearAllDrafts, resumeDraftWrites } from '@/modules/serial/lib/draft-store';

// Rute dipasang tanpa router sungguhan: createFileRoute diganti pembungkus opsi, useNavigate/useBlocker diganti tiruan.
// Penjaga pertama (tanpa resolver) = konfirmasi bawaan; penjaga kedua (withResolver) = dialog draft berfoto.
const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  blockerFn: undefined as (() => boolean) | undefined,
  dialogFn: undefined as (() => boolean) | undefined,
  proceed: vi.fn(),
  reset: vi.fn(),
  save: vi.fn<() => Promise<boolean>>(),
  /** Memicu penjaga dialog seperti navigasi keluar: mengembalikan hasil `shouldBlockFn` dan memasang status. */
  triggerDialog: undefined as (() => boolean) | undefined,
}));
vi.mock('@tanstack/react-router', async () => ({
  ...(await vi.importActual<object>('@tanstack/react-router')),
  createFileRoute: () => (options: { component: () => unknown }) => ({ options }),
  useNavigate: () => state.navigate,
  useBlocker: (opts: { shouldBlockFn: () => boolean; withResolver?: boolean }) => {
    const [status, setStatus] = useState<'idle' | 'blocked'>('idle');
    if (!opts.withResolver) {
      state.blockerFn = opts.shouldBlockFn;
      return undefined;
    }
    state.dialogFn = opts.shouldBlockFn;
    state.triggerDialog = () => {
      const blocked = opts.shouldBlockFn();
      if (blocked) setStatus('blocked');
      return blocked;
    };
    return status === 'blocked'
      ? {
          status,
          proceed: () => {
            state.proceed();
            setStatus('idle');
          },
          reset: () => {
            state.reset();
            setStatus('idle');
          },
        }
      : { status, proceed: undefined, reset: undefined };
  },
}));
vi.mock('@/modules/auth/permissions', () => ({ requirePermission: vi.fn() }));
// RecordPage diganti kerangka yang memicu callback rute.
vi.mock('@/modules/serial/components/record-page', () => ({
  RecordPage: (props: {
    onDirtyChange?: (dirty: boolean) => void;
    onAllSaved?: () => void;
    onProofChange?: (hasProof: boolean) => void;
    handleRef?: { current: { save(): Promise<boolean> } | null };
  }) => {
    if (props.handleRef) props.handleRef.current = { save: () => state.save() };
    return (
      <div>
        <button type="button" onClick={() => props.onDirtyChange?.(true)}>
          isi
        </button>
        <button
          type="button"
          onClick={() => {
            props.onDirtyChange?.(true);
            props.onProofChange?.(true);
          }}
        >
          isi dengan foto
        </button>
        <button type="button" onClick={() => props.onAllSaved?.()}>
          semua tersimpan
        </button>
      </div>
    );
  },
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
  state.proceed.mockReset();
  state.reset.mockReset();
  state.save.mockReset();
  state.blockerFn = undefined;
  state.dialogFn = undefined;
  state.triggerDialog = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  resumeDraftWrites();
  localStorage.clear();
});

test('draf berisi: keluar halaman meminta konfirmasi; ditolak = diblokir', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'isi' }));
  expect(state.blockerFn?.()).toBe(true);
  expect(confirm).toHaveBeenCalledTimes(1);
  // Draft tanpa foto: penjaga dialog tidak ikut menahan.
  expect(state.dialogFn?.()).toBe(false);
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
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

async function openProofDialog() {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'isi dengan foto' }));
  act(() => {
    expect(state.triggerDialog?.()).toBe(true);
  });
  return await screen.findByRole('alertdialog');
}

test('draft dengan foto: dialog tiga tombol menggantikan window.confirm', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'isi dengan foto' }));
  expect(state.blockerFn?.()).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  act(() => {
    state.triggerDialog?.();
  });
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveTextContent('7 hari');
  expect(screen.getByRole('button', { name: 'Simpan dulu' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Keluar tanpa menyimpan' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tetap di sini' })).toBeInTheDocument();
});

test('Simpan dulu sukses: navigasi dilanjutkan (proceed) dan tidak menahan lagi', async () => {
  state.save.mockResolvedValue(true);
  await openProofDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan dulu' }));
  await waitFor(() => expect(state.proceed).toHaveBeenCalledTimes(1));
  expect(state.reset).not.toHaveBeenCalled();
  // Tujuan semula yang dilanjutkan (bukan navigasi ke daftar dari rute) dan penjaga sudah lepas.
  expect(state.navigate).not.toHaveBeenCalled();
  expect(state.dialogFn?.()).toBe(false);
});

test('Simpan dulu sebagian gagal: tetap di halaman dan dialog menutup', async () => {
  state.save.mockResolvedValue(false);
  await openProofDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan dulu' }));
  await waitFor(() => expect(state.reset).toHaveBeenCalledTimes(1));
  expect(state.proceed).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
});

test('Simpan dulu: galat tak terduga = tetap di halaman', async () => {
  state.save.mockRejectedValue(new Error('putus'));
  await openProofDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Simpan dulu' }));
  await waitFor(() => expect(state.reset).toHaveBeenCalledTimes(1));
  expect(state.proceed).not.toHaveBeenCalled();
});

test('Keluar tanpa menyimpan: proceed tanpa menyimpan (draft tetap di perangkat)', async () => {
  await openProofDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Keluar tanpa menyimpan' }));
  expect(state.proceed).toHaveBeenCalledTimes(1);
  expect(state.save).not.toHaveBeenCalled();
});

test('Tetap di sini: reset, tanpa simpan', async () => {
  await openProofDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Tetap di sini' }));
  expect(state.reset).toHaveBeenCalledTimes(1);
  expect(state.proceed).not.toHaveBeenCalled();
  expect(state.save).not.toHaveBeenCalled();
});

test('keluar dari aplikasi (penulisan draft ditahan): tidak ada dialog maupun konfirmasi', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'isi dengan foto' }));
  clearAllDrafts();
  expect(state.dialogFn?.()).toBe(false);
  expect(state.blockerFn?.()).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
});

test('setelah semua tersimpan (dirty=false) navigasi internal tidak ditahan walau tadinya berfoto', async () => {
  await mount();
  await userEvent.click(screen.getByRole('button', { name: 'isi dengan foto' }));
  await userEvent.click(screen.getByRole('button', { name: 'semua tersimpan' }));
  expect(state.dialogFn?.()).toBe(false);
  expect(state.blockerFn?.()).toBe(false);
});
