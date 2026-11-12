import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  type RegisterSW,
  resetPwaUpdateForTests,
  startPwaUpdates,
  usePwaUpdate,
  usePwaUpdateSnapshotForTests,
} from './update';

type RegisterOptions = Parameters<RegisterSW>[0];

// Window palsu minimal: navigator, document (pendengar + visibilityState), dan penghitung waktu.
function fakeWindow(options: { serviceWorker?: boolean; onLine?: boolean } = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    }),
  };
  const nav: Record<string, unknown> = { onLine: options.onLine ?? true };
  if (options.serviceWorker ?? true) nav.serviceWorker = {};
  const location = { reload: vi.fn() };
  const win = {
    navigator: nav,
    document: doc,
    location,
    addEventListener: doc.addEventListener,
    removeEventListener: doc.removeEventListener,
    setInterval: (fn: () => void, ms: number) => globalThis.setInterval(fn, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => globalThis.clearInterval(id),
  } as unknown as Window;
  return {
    win,
    doc,
    nav,
    location,
    fire: (type: string) => {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

function fakeRegister(opts: { waiting?: boolean } = {}) {
  const updateSW = vi.fn(async (_reload?: boolean) => undefined);
  const update = vi.fn().mockResolvedValue(undefined);
  const registration = {
    update,
    waiting: opts.waiting === false ? null : {},
  } as unknown as ServiceWorkerRegistration;
  let options: RegisterOptions = {};
  const register: RegisterSW = (given) => {
    options = given;
    return updateSW;
  };
  return {
    register,
    updateSW,
    update,
    registration,
    registerSw: () => options.onRegisteredSW?.('/sw.js', registration),
    needRefresh: () => options.onNeedRefresh?.(),
    needReload: () => options.onNeedReload?.(),
    options: () => options,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetPwaUpdateForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

test('onNeedRefresh membuat needRefresh true', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  expect(usePwaUpdateSnapshotForTests()).toBe(false);
  reg.needRefresh();
  expect(usePwaUpdateSnapshotForTests()).toBe(true);
});

test('registration.update() dipanggil sekali saat terdaftar', () => {
  const reg = fakeRegister();
  startPwaUpdates({ register: reg.register, win: fakeWindow().win });
  expect(reg.update).not.toHaveBeenCalled();
  reg.registerSw();
  expect(reg.update).toHaveBeenCalledTimes(1);
});

test('registration.update() dipanggil saat visibilitychange ke visible', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  reg.update.mockClear();
  view.doc.visibilityState = 'hidden';
  view.fire('visibilitychange');
  expect(reg.update).not.toHaveBeenCalled();
  view.doc.visibilityState = 'visible';
  view.fire('visibilitychange');
  expect(reg.update).toHaveBeenCalledTimes(1);
});

test('registration.update() dipanggil berkala sesuai interval', () => {
  const reg = fakeRegister();
  startPwaUpdates({ register: reg.register, win: fakeWindow().win, intervalMs: 10 * 60_000 });
  reg.registerSw();
  reg.update.mockClear();
  vi.advanceTimersByTime(10 * 60_000);
  expect(reg.update).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(20 * 60_000);
  expect(reg.update).toHaveBeenCalledTimes(3);
});

test('interval bawaan 30 menit dan tak pernah lebih dari 60 menit', () => {
  const first = fakeRegister();
  const stop = startPwaUpdates({ register: first.register, win: fakeWindow().win });
  first.registerSw();
  first.update.mockClear();
  vi.advanceTimersByTime(30 * 60_000);
  expect(first.update).toHaveBeenCalledTimes(1);
  stop();

  const second = fakeRegister();
  startPwaUpdates({
    register: second.register,
    win: fakeWindow().win,
    intervalMs: 24 * 60 * 60_000,
  });
  second.registerSw();
  second.update.mockClear();
  vi.advanceTimersByTime(60 * 60_000);
  expect(second.update).toHaveBeenCalledTimes(1);
});

test('tidak memanggil update() saat navigator.onLine false', () => {
  const reg = fakeRegister();
  const view = fakeWindow({ onLine: false });
  startPwaUpdates({ register: reg.register, win: view.win, intervalMs: 60_000 });
  reg.registerSw();
  view.fire('visibilitychange');
  vi.advanceTimersByTime(5 * 60_000);
  expect(reg.update).not.toHaveBeenCalled();
  view.nav.onLine = true;
  vi.advanceTimersByTime(60_000);
  expect(reg.update).toHaveBeenCalledTimes(1);
});

test('update() yang ditolak atau melempar tidak merusak aplikasi', async () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.update.mockRejectedValueOnce(new Error('offline'));
  expect(() => reg.registerSw()).not.toThrow();
  reg.update.mockImplementationOnce(() => {
    throw new Error('sinkron');
  });
  expect(() => view.fire('visibilitychange')).not.toThrow();
  await vi.advanceTimersByTimeAsync(0);
});

test('galat pendaftaran tidak dilempar', () => {
  const reg = fakeRegister();
  startPwaUpdates({ register: reg.register, win: fakeWindow().win });
  expect(() => reg.options().onRegisterError?.(new Error('gagal'))).not.toThrow();
});

test('tanpa serviceWorker: register tidak dipanggil dan tanpa pendengar', () => {
  const register = vi.fn<RegisterSW>();
  const view = fakeWindow({ serviceWorker: false });
  const stop = startPwaUpdates({ register, win: view.win });
  expect(register).not.toHaveBeenCalled();
  expect(view.doc.addEventListener).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  expect(() => stop()).not.toThrow();
});

test('pembersih melepas pendengar dan interval', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  const stop = startPwaUpdates({ register: reg.register, win: view.win, intervalMs: 60_000 });
  reg.registerSw();
  expect(view.listenerCount()).toBe(2);
  expect(vi.getTimerCount()).toBe(1);
  stop();
  expect(view.listenerCount()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  reg.update.mockClear();
  view.fire('visibilitychange');
  vi.advanceTimersByTime(5 * 60_000);
  expect(reg.update).not.toHaveBeenCalled();
});

test('reload() memanggil fungsi pembaruan dengan true dan tidak ada muat ulang sebelumnya', () => {
  const reg = fakeRegister();
  startPwaUpdates({ register: reg.register, win: fakeWindow().win });
  const hook = renderHook(() => usePwaUpdate());
  act(() => reg.needRefresh());
  expect(hook.result.current.needRefresh).toBe(true);
  expect(reg.updateSW).not.toHaveBeenCalled();
  hook.result.current.reload();
  expect(reg.updateSW).toHaveBeenCalledTimes(1);
  expect(reg.updateSW).toHaveBeenCalledWith(true);
});

test('jendela kembali fokus memicu pemeriksaan; focus + visibilitychange berdekatan tidak berlipat', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  reg.update.mockClear();
  view.fire('focus');
  expect(reg.update).toHaveBeenCalledTimes(1);
  view.fire('visibilitychange');
  view.fire('focus');
  expect(reg.update).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(5_000);
  view.fire('focus');
  expect(reg.update).toHaveBeenCalledTimes(2);
});

test('onNeedReload dari pembaruan yang tidak diminta tab ini TIDAK memuat ulang (draf tab lain aman)', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  reg.needRefresh();
  reg.needReload();
  expect(view.location.reload).not.toHaveBeenCalled();
  expect(usePwaUpdateSnapshotForTests()).toBe(true);
});

test('onNeedReload sesudah tab ini menekan Muat ulang memuat ulang halaman', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  reg.needRefresh();
  const hook = renderHook(() => usePwaUpdate());
  hook.result.current.reload();
  expect(reg.updateSW).toHaveBeenCalledWith(true);
  expect(view.location.reload).not.toHaveBeenCalled();
  reg.needReload();
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});

test('reload() tanpa SW yang menunggu (sudah diaktifkan tab lain) langsung memuat ulang halaman', () => {
  const reg = fakeRegister({ waiting: false });
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  reg.needRefresh();
  const hook = renderHook(() => usePwaUpdate());
  hook.result.current.reload();
  expect(reg.updateSW).not.toHaveBeenCalled();
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});
