import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  isChunkLoadError,
  notifyChunkLoadFailure,
  type RegisterSW,
  resetPwaUpdateForTests,
  startPwaUpdates,
  usePwaUpdate,
  usePwaUpdateSnapshotForTests,
} from './update';

type RegisterOptions = Parameters<RegisterSW>[0];

// Window palsu minimal: navigator, document (pendengar + visibilityState), dan penghitung waktu.
function fakeWindow(options: { serviceWorker?: boolean; onLine?: boolean } = {}) {
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: vi.fn((type: string, listener: (event?: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: (event?: unknown) => void) => {
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
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
  } as unknown as Window;
  return {
    win,
    doc,
    nav,
    location,
    fire: (type: string, event?: unknown) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
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
  expect(view.listenerCount()).toBe(3);
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
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  const hook = renderHook(() => usePwaUpdate());
  act(() => reg.needRefresh());
  expect(hook.result.current.needRefresh).toBe(true);
  expect(reg.updateSW).not.toHaveBeenCalled();
  hook.result.current.reload();
  expect(view.location.reload).not.toHaveBeenCalled();
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

test('vite:preloadError menyalakan needRefresh dan menekan muat ulang otomatis router (diganti spanduk), tanpa muat ulang sendiri', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  const event = { preventDefault: vi.fn() };
  view.fire('vite:preloadError', event);
  expect(usePwaUpdateSnapshotForTests()).toBe(true);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
  expect(view.location.reload).not.toHaveBeenCalled();
  expect(reg.updateSW).not.toHaveBeenCalled();
});

test('pembersih juga melepas pendengar vite:preloadError', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  const stop = startPwaUpdates({ register: reg.register, win: view.win });
  stop();
  const event = { preventDefault: vi.fn() };
  view.fire('vite:preloadError', event);
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(usePwaUpdateSnapshotForTests()).toBe(false);
});

test('tombol Muat ulang setelah preloadError tanpa SW menunggu dan tanpa SW terpasang memuat ulang halaman', () => {
  const reg = fakeRegister({ waiting: false });
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  view.fire('vite:preloadError', { preventDefault: vi.fn() });
  const hook = renderHook(() => usePwaUpdate());
  expect(hook.result.current.needRefresh).toBe(true);
  hook.result.current.reload();
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});

test('isChunkLoadError mengenali galat muat potongan dinamis; galat lain tidak', () => {
  for (const message of [
    'Failed to fetch dynamically imported module: https://x/assets/qrcode-abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Unable to preload CSS for /assets/a.css',
  ]) {
    expect(isChunkLoadError(new TypeError(message)), message).toBe(true);
  }
  const chunk = new Error('x');
  chunk.name = 'ChunkLoadError';
  expect(isChunkLoadError(chunk)).toBe(true);
  expect(isChunkLoadError(new Error('Gagal menyimpan'))).toBe(false);
  expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
});

test('notifyChunkLoadFailure menyalakan needRefresh', () => {
  expect(usePwaUpdateSnapshotForTests()).toBe(false);
  notifyChunkLoadFailure();
  expect(usePwaUpdateSnapshotForTests()).toBe(true);
});

test('dismiss menyembunyikan tanpa membatalkan needRefresh; pemicu baru mereset', () => {
  const reg = fakeRegister();
  startPwaUpdates({ register: reg.register, win: fakeWindow().win });
  reg.needRefresh();
  const hook = renderHook(() => usePwaUpdate());
  expect(hook.result.current.dismissed).toBe(false);
  act(() => hook.result.current.dismiss());
  expect(hook.result.current.needRefresh).toBe(true);
  expect(hook.result.current.dismissed).toBe(true);
  act(() => reg.needRefresh());
  expect(hook.result.current.dismissed).toBe(false);
  act(() => hook.result.current.dismiss());
  act(() => notifyChunkLoadFailure());
  expect(hook.result.current.dismissed).toBe(false);
});

test('N1: tanpa registrasi SW terpakai (registrasi gagal/belum selesai) Muat ulang memuat ulang halaman', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  // registerSw() tidak pernah dipanggil: registrasi gagal atau belum selesai.
  view.fire('vite:preloadError', { preventDefault: vi.fn() });
  const hook = renderHook(() => usePwaUpdate());
  expect(hook.result.current.needRefresh).toBe(true);
  hook.result.current.reload();
  expect(reg.updateSW).not.toHaveBeenCalled();
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});

test('N1: tanpa startPwaUpdates sama sekali (dev/tanpa serviceWorker) Muat ulang memuat ulang window', () => {
  const reload = vi.fn();
  vi.stubGlobal('location', { reload });
  try {
    notifyChunkLoadFailure();
    const hook = renderHook(() => usePwaUpdate());
    expect(hook.result.current.needRefresh).toBe(true);
    hook.result.current.reload();
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('N9: pembersih mengosongkan rujukan modul sehingga reload() memakai window, bukan jendela lama', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  const stop = startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  stop();
  const reload = vi.fn();
  vi.stubGlobal('location', { reload });
  try {
    notifyChunkLoadFailure();
    renderHook(() => usePwaUpdate()).result.current.reload();
    expect(view.location.reload).not.toHaveBeenCalled();
    expect(reg.updateSW).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('N5: offline, vite:preloadError tidak menyalakan spanduk dan tidak mencegah penanganan bawaan', () => {
  const reg = fakeRegister();
  const view = fakeWindow({ onLine: false });
  startPwaUpdates({ register: reg.register, win: view.win });
  const event = { preventDefault: vi.fn() };
  view.fire('vite:preloadError', event);
  expect(usePwaUpdateSnapshotForTests()).toBe(false);
  expect(event.preventDefault).not.toHaveBeenCalled();
});

test('N5: offline, notifyChunkLoadFailure tidak menyalakan spanduk (dengan atau tanpa startPwaUpdates)', () => {
  const view = fakeWindow({ onLine: false });
  const reg = fakeRegister();
  const stop = startPwaUpdates({ register: reg.register, win: view.win });
  notifyChunkLoadFailure();
  expect(usePwaUpdateSnapshotForTests()).toBe(false);
  stop();
  const offline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  try {
    notifyChunkLoadFailure();
    expect(usePwaUpdateSnapshotForTests()).toBe(false);
  } finally {
    offline.mockRestore();
  }
});

test('N3: vite:preloadError dan notifyChunkLoadFailure memeriksa pembaruan (registration.update)', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  reg.update.mockClear();
  view.fire('vite:preloadError', { preventDefault: vi.fn() });
  expect(reg.update).toHaveBeenCalledTimes(1);
  notifyChunkLoadFailure();
  expect(reg.update).toHaveBeenCalledTimes(2);
});

function fakeWorker(state: ServiceWorkerState = 'installing') {
  const listeners = new Set<() => void>();
  const worker = {
    state,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  return {
    worker: worker as unknown as ServiceWorker,
    setState: (next: ServiceWorkerState) => {
      worker.state = next;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

test('N3: SW baru masih installing: Muat ulang menunggu sampai installed lalu mengaktifkannya (bukan memuat ulang cangkang lama)', () => {
  const reg = fakeRegister({ waiting: false });
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  const installing = fakeWorker();
  Object.assign(reg.registration, { installing: installing.worker });
  notifyChunkLoadFailure();
  const hook = renderHook(() => usePwaUpdate());
  hook.result.current.reload();
  expect(view.location.reload).not.toHaveBeenCalled();
  expect(reg.updateSW).not.toHaveBeenCalled();
  // SW baru selesai dipasang dan kini menunggu.
  Object.assign(reg.registration, { waiting: {}, installing: null });
  installing.setState('installed');
  expect(reg.updateSW).toHaveBeenCalledWith(true);
  expect(view.location.reload).not.toHaveBeenCalled();
  expect(installing.listenerCount()).toBe(0);
});

test('N3: SW baru gagal dipasang (redundant) atau melewati batas waktu: halaman dimuat ulang', () => {
  for (const mode of ['redundant', 'timeout'] as const) {
    resetPwaUpdateForTests();
    const reg = fakeRegister({ waiting: false });
    const view = fakeWindow();
    const stop = startPwaUpdates({ register: reg.register, win: view.win });
    reg.registerSw();
    const installing = fakeWorker();
    Object.assign(reg.registration, { installing: installing.worker });
    notifyChunkLoadFailure();
    renderHook(() => usePwaUpdate()).result.current.reload();
    expect(view.location.reload).not.toHaveBeenCalled();
    if (mode === 'redundant') installing.setState('redundant');
    else vi.advanceTimersByTime(20_000);
    expect(view.location.reload, mode).toHaveBeenCalledTimes(1);
    expect(reg.updateSW).not.toHaveBeenCalled();
    stop();
  }
});

test('N3: klik berulang saat menunggu SW installing tidak menumpuk penunggu', () => {
  const reg = fakeRegister({ waiting: false });
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  const installing = fakeWorker();
  Object.assign(reg.registration, { installing: installing.worker });
  notifyChunkLoadFailure();
  const hook = renderHook(() => usePwaUpdate());
  hook.result.current.reload();
  hook.result.current.reload();
  expect(installing.listenerCount()).toBe(1);
});
