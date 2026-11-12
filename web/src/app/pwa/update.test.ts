import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { beginBusy, resetBusyForTests } from './busy';
import { resetSafeReloadForTests, setMutationSource } from './safe-reload';
import { resetUnsavedChangesForTests, useUnsavedChanges } from './unsaved-changes';
import {
  attachNavigationTrigger,
  isChunkLoadError,
  notifyChunkLoadFailure,
  notifyNavigation,
  type RegisterSW,
  resetPwaUpdateForTests,
  startPwaUpdates,
  usePwaUpdate,
  usePwaUpdateSnapshotForTests,
} from './update';

type RegisterOptions = Parameters<RegisterSW>[0];

// Window palsu minimal: navigator, document (pendengar + visibilityState), dan penghitung waktu.
function fakeWindow(
  options: {
    serviceWorker?: boolean;
    onLine?: boolean;
    storage?: 'ok' | 'throws' | 'none' | 'probe-only';
  } = {},
) {
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
  if (options.serviceWorker ?? true) {
    nav.serviceWorker = {
      addEventListener: doc.addEventListener,
      removeEventListener: doc.removeEventListener,
    };
  }
  const location = { reload: vi.fn() };
  const store = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (options.storage === 'throws') throw new Error('kuota penuh');
      // Probe lulus, penulisan sesudahnya melempar (kuota penuh di tengah sesi).
      if (options.storage === 'probe-only' && key !== 'qc-pwa-probe') {
        throw new Error('kuota penuh');
      }
      store.set(key, value);
    },
    removeItem: (key: string) => void store.delete(key),
  };
  const win = {
    navigator: nav,
    ...(options.storage === 'none' ? {} : { sessionStorage }),
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
    store,
    fire: (type: string, event?: unknown) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

function fakeRegister(opts: { waiting?: boolean } = {}) {
  const updateSW = vi.fn(async (_reload?: boolean) => undefined);
  const update = vi.fn().mockResolvedValue(undefined);
  const regListeners = new Set<() => void>();
  const registration = {
    update,
    waiting: opts.waiting === false ? null : {},
    addEventListener: (_type: string, listener: () => void) => regListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => regListeners.delete(listener),
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
    fireUpdateFound: () => {
      for (const listener of [...regListeners]) listener();
    },
    updateFoundListenerCount: () => regListeners.size,
    needRefresh: () => options.onNeedRefresh?.(),
    needReload: () => options.onNeedReload?.(),
    options: () => options,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetPwaUpdateForTests();
  resetSafeReloadForTests();
  resetBusyForTests();
  resetUnsavedChangesForTests();
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
  notifyChunkLoadFailure();
  const lit = usePwaUpdateSnapshotForTests();
  offline.mockRestore();
  expect(lit).toBe(false);
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

test('N4/B1: deploy berikutnya muncul lagi setelah Nanti pada urutan nyata (installing lalu installed), tanpa focus kedua', async () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  await vi.advanceTimersByTimeAsync(0);
  // SW menunggu pertama (sw1) diumumkan lewat pemeriksaan saat terdaftar.
  const hook = renderHook(() => usePwaUpdate());
  expect(hook.result.current.needRefresh).toBe(true);
  act(() => hook.result.current.dismiss());
  expect(hook.result.current.dismissed).toBe(true);
  // SW yang sama setelah pemeriksaan berikutnya: tetap disembunyikan.
  view.fire('focus');
  await vi.advanceTimersByTimeAsync(0);
  expect(hook.result.current.dismissed).toBe(true);
  // Deploy berikutnya: update() selesai SAAT sw2 masih installing (waiting baru terisi setelah pra-cache).
  const sw2 = fakeWorker();
  reg.update.mockImplementationOnce(async () => {
    Object.assign(reg.registration, { installing: sw2.worker });
  });
  vi.advanceTimersByTime(5_000);
  view.fire('focus');
  await vi.advanceTimersByTimeAsync(0);
  expect(hook.result.current.dismissed).toBe(true);
  // Pra-cache selesai: waiting berganti dan statechange installed -> spanduk muncul tanpa pemeriksaan lagi.
  Object.assign(reg.registration, { waiting: { name: 'sw2' }, installing: null });
  act(() => sw2.setState('installed'));
  expect(hook.result.current.dismissed).toBe(false);
  expect(hook.result.current.needRefresh).toBe(true);
  expect(sw2.listenerCount()).toBe(0);
});

test('B1: pembersih melepas pendengar statechange SW yang sedang dipasang; redundant juga melepasnya', async () => {
  const reg = fakeRegister({ waiting: false });
  const view = fakeWindow();
  const sw = fakeWorker();
  reg.update.mockImplementation(async () => {
    Object.assign(reg.registration, { installing: sw.worker });
  });
  const stop = startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  await vi.advanceTimersByTimeAsync(0);
  expect(sw.listenerCount()).toBe(1);
  stop();
  expect(sw.listenerCount()).toBe(0);

  const redundant = fakeWorker();
  const reg2 = fakeRegister({ waiting: false });
  reg2.update.mockImplementation(async () => {
    Object.assign(reg2.registration, { installing: redundant.worker });
  });
  startPwaUpdates({ register: reg2.register, win: fakeWindow().win });
  reg2.registerSw();
  await vi.advanceTimersByTimeAsync(0);
  expect(redundant.listenerCount()).toBe(1);
  act(() => redundant.setState('redundant'));
  expect(redundant.listenerCount()).toBe(0);
  expect(usePwaUpdateSnapshotForTests()).toBe(false);
});

test('B2: SW yang sama tidak membatalkan Nanti walau onNeedRefresh pustaka tiba sebelum registrasi diketahui', async () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  // Pustaka mengumumkan SW menunggu SEBELUM onRegisteredSW (registration belum diketahui).
  reg.needRefresh();
  const hook = renderHook(() => usePwaUpdate());
  act(() => hook.result.current.dismiss());
  expect(hook.result.current.dismissed).toBe(true);
  reg.registerSw();
  await vi.advanceTimersByTimeAsync(0);
  expect(hook.result.current.dismissed).toBe(true);
});
test('N4: Muat ulang memasang controllerchange sendiri sehingga muat ulang terjadi walau pustaka tak memanggil onNeedReload (tepat sekali)', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  reg.needRefresh();
  renderHook(() => usePwaUpdate()).result.current.reload();
  expect(reg.updateSW).toHaveBeenCalledWith(true);
  expect(view.location.reload).not.toHaveBeenCalled();
  view.fire('controllerchange');
  expect(view.location.reload).toHaveBeenCalledTimes(1);
  // Pustaka juga memanggil onNeedReload untuk peristiwa yang sama: jangan memuat ulang dua kali.
  reg.needReload();
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});

test('B4: selama menunggu pengambilalihan SW, pending menyala; controllerchange memuat ulang dan menghapus pending; klik ulang diabaikan', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  reg.needRefresh();
  const hook = renderHook(() => usePwaUpdate());
  expect(hook.result.current.pending).toBe(false);
  act(() => hook.result.current.reload());
  expect(hook.result.current.pending).toBe(true);
  act(() => hook.result.current.reload());
  expect(reg.updateSW).toHaveBeenCalledTimes(1);
  act(() => view.fire('controllerchange'));
  expect(view.location.reload).toHaveBeenCalledTimes(1);
  expect(hook.result.current.pending).toBe(false);
});

test('B4: controllerchange yang tak kunjung datang: setelah batas waktu halaman dimuat ulang (tidak buntu)', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  reg.needRefresh();
  const hook = renderHook(() => usePwaUpdate());
  act(() => hook.result.current.reload());
  vi.advanceTimersByTime(9_000);
  expect(view.location.reload).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(2_000);
  });
  expect(view.location.reload).toHaveBeenCalledTimes(1);
  expect(hook.result.current.pending).toBe(false);
});

test('N1: selama fase menunggu (pending) Nanti diabaikan: tak membatalkan, tak menyembunyikan, muat ulang tetap berlanjut', () => {
  for (const mode of ['activate', 'installing'] as const) {
    resetPwaUpdateForTests();
    const reg = fakeRegister({ waiting: mode === 'activate' });
    const view = fakeWindow();
    startPwaUpdates({ register: reg.register, win: view.win });
    reg.registerSw();
    const sw = fakeWorker();
    if (mode === 'installing') Object.assign(reg.registration, { installing: sw.worker });
    notifyChunkLoadFailure();
    const hook = renderHook(() => usePwaUpdate());
    act(() => hook.result.current.reload());
    expect(hook.result.current.pending, mode).toBe(true);
    act(() => hook.result.current.dismiss());
    expect(hook.result.current.pending, mode).toBe(true);
    expect(hook.result.current.dismissed, mode).toBe(false);
    if (mode === 'installing') {
      Object.assign(reg.registration, { waiting: {}, installing: null });
      act(() => sw.setState('installed'));
    }
    act(() => view.fire('controllerchange'));
    expect(view.location.reload, mode).toHaveBeenCalledTimes(1);
  }
});

test('B4: pembersih membatalkan penunggu yang berjalan (timer dan pendengar dilepas, tanpa muat ulang)', () => {
  for (const mode of ['activate', 'installing'] as const) {
    resetPwaUpdateForTests();
    const reg = fakeRegister({ waiting: mode === 'activate' });
    const view = fakeWindow();
    const stop = startPwaUpdates({ register: reg.register, win: view.win });
    reg.registerSw();
    const sw = fakeWorker();
    if (mode === 'installing') Object.assign(reg.registration, { installing: sw.worker });
    notifyChunkLoadFailure();
    renderHook(() => usePwaUpdate()).result.current.reload();
    stop();
    expect(view.listenerCount(), mode).toBe(0);
    expect(sw.listenerCount(), mode).toBe(0);
    vi.advanceTimersByTime(30_000);
    expect(view.location.reload, mode).not.toHaveBeenCalled();
  }
});

test('N4/putaran 4: pembaruan SW yang dimulai peramban sendiri (updatefound) juga dipantau tanpa menunggu pemeriksaan berikutnya; pendengar dilepas oleh pembersih', async () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  const stop = startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  await vi.advanceTimersByTimeAsync(0);
  expect(reg.updateFoundListenerCount()).toBe(1);
  const hook = renderHook(() => usePwaUpdate());
  act(() => hook.result.current.dismiss());
  expect(hook.result.current.dismissed).toBe(true);
  reg.update.mockClear();
  // Peramban memulai pembaruan sendiri: SW baru installing, tanpa update() dari kita.
  const sw2 = fakeWorker();
  Object.assign(reg.registration, { installing: sw2.worker });
  act(() => reg.fireUpdateFound());
  expect(reg.update).not.toHaveBeenCalled();
  expect(sw2.listenerCount()).toBe(1);
  Object.assign(reg.registration, { waiting: { name: 'sw2' }, installing: null });
  act(() => sw2.setState('installed'));
  expect(hook.result.current.dismissed).toBe(false);
  expect(hook.result.current.needRefresh).toBe(true);
  stop();
  expect(reg.updateFoundListenerCount()).toBe(0);
});

test('N5: jalur penuh installing -> installed -> klik Muat ulang -> controllerchange: muat ulang tepat sekali dan pending kembali false', () => {
  const reg = fakeRegister({ waiting: false });
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  const sw2 = fakeWorker();
  Object.assign(reg.registration, { installing: sw2.worker });
  notifyChunkLoadFailure();
  const hook = renderHook(() => usePwaUpdate());
  act(() => hook.result.current.reload());
  expect(hook.result.current.pending).toBe(true);
  expect(reg.updateSW).not.toHaveBeenCalled();
  // SW baru selesai dipasang: pending tetap menyala (tanpa kedipan) sampai SW mengambil alih.
  Object.assign(reg.registration, { waiting: {}, installing: null });
  act(() => sw2.setState('installed'));
  expect(reg.updateSW).toHaveBeenCalledWith(true);
  expect(hook.result.current.pending).toBe(true);
  expect(view.location.reload).not.toHaveBeenCalled();
  act(() => view.fire('controllerchange'));
  expect(view.location.reload).toHaveBeenCalledTimes(1);
  expect(hook.result.current.pending).toBe(false);
  // Peristiwa ganda dari pustaka dan batas waktu tidak memuat ulang lagi.
  reg.needReload();
  vi.advanceTimersByTime(30_000);
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});

// ---- Putaran 5: muat ulang otomatis bila aman (keputusan pemilik 2026-11-13)

function armed(opts: { waiting?: boolean } = {}) {
  const reg = fakeRegister(opts);
  const view = fakeWindow();
  const stop = startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  reg.needRefresh();
  const hook = renderHook(() => usePwaUpdate());
  return { reg, view, hook, stop };
}

test('R5/M-a: aman + berpindah halaman: SW diaktifkan lalu tepat satu muat ulang (location.reload, bukan assign); spanduk tidak tampil', () => {
  const { reg, view, hook } = armed();
  expect(hook.result.current.needRefresh).toBe(true);
  expect(hook.result.current.visible).toBe(false);
  act(() => notifyNavigation());
  expect(reg.updateSW).toHaveBeenCalledWith(true);
  expect(view.location.reload).not.toHaveBeenCalled();
  act(() => view.fire('controllerchange'));
  expect(view.location.reload).toHaveBeenCalledTimes(1);
  reg.needReload();
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});

test('R5: berpindah lagi saat muat ulang sedang berjalan tidak menumpuk penunggu', () => {
  const { reg, view } = armed();
  act(() => notifyNavigation());
  act(() => notifyNavigation());
  expect(reg.updateSW).toHaveBeenCalledTimes(1);
  act(() => view.fire('controllerchange'));
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});

test('R5: aman + tab kembali terlihat: muat ulang otomatis (halaman yang sama); tab tersembunyi tidak', () => {
  const { reg, view } = armed();
  view.doc.visibilityState = 'hidden';
  act(() => view.fire('visibilitychange'));
  expect(reg.updateSW).not.toHaveBeenCalled();
  view.doc.visibilityState = 'visible';
  act(() => view.fire('visibilitychange'));
  expect(reg.updateSW).toHaveBeenCalledWith(true);
  act(() => view.fire('controllerchange'));
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});

test('R5: formulir belum disimpan: tidak memuat ulang pada pemicu apa pun dan spanduk tampil', () => {
  const dirty = renderHook(() => useUnsavedChanges(true));
  const { reg, view, hook } = armed();
  expect(hook.result.current.visible).toBe(true);
  act(() => notifyNavigation());
  view.doc.visibilityState = 'visible';
  act(() => view.fire('visibilitychange'));
  expect(reg.updateSW).not.toHaveBeenCalled();
  expect(view.location.reload).not.toHaveBeenCalled();
  dirty.unmount();
});

test('R5: penulisan berjalan (registri sibuk atau mutasi): tidak memuat ulang dan spanduk tampil', () => {
  const end = beginBusy();
  const { reg, view, hook } = armed();
  // M-d: spanduk karena sibuk hanya setelah sibuk bertahan >= 1 dtk.
  expect(hook.result.current.visible).toBe(false);
  act(() => {
    vi.advanceTimersByTime(1_100);
  });
  expect(hook.result.current.visible).toBe(true);
  act(() => notifyNavigation());
  expect(reg.updateSW).not.toHaveBeenCalled();
  end();
  // Mutasi react-query yang berjalan sama saja.
  let count = 1;
  setMutationSource({ isMutating: () => count, subscribe: () => () => undefined });
  act(() => notifyNavigation());
  expect(reg.updateSW).not.toHaveBeenCalled();
  expect(view.location.reload).not.toHaveBeenCalled();
  count = 0;
});

test('R5: kotor lalu disimpan lalu berpindah halaman: spanduk hilang sendiri dan muat ulang otomatis berlaku', () => {
  const dirty = renderHook(() => useUnsavedChanges(true));
  const { reg, view, hook } = armed();
  expect(hook.result.current.visible).toBe(true);
  act(() => dirty.unmount());
  expect(hook.result.current.visible).toBe(false);
  expect(reg.updateSW).not.toHaveBeenCalled();
  act(() => notifyNavigation());
  expect(reg.updateSW).toHaveBeenCalledWith(true);
  act(() => view.fire('controllerchange'));
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});

test('R5: galat muat potongan (rusak) tetap menampilkan spanduk walau aman', () => {
  const { hook } = armed();
  expect(hook.result.current.visible).toBe(false);
  act(() => notifyChunkLoadFailure());
  expect(hook.result.current.visible).toBe(true);
});

test('R5: satu percobaan otomatis per versi; setelah batas waktu (aman) memuat ulang sekali, tidak mengulang', () => {
  const { reg, view, hook } = armed();
  act(() => notifyNavigation());
  expect(reg.updateSW).toHaveBeenCalledTimes(1);
  act(() => {
    vi.advanceTimersByTime(11_000);
  });
  expect(view.location.reload).toHaveBeenCalledTimes(1);
  expect(hook.result.current.pending).toBe(false);
  act(() => notifyNavigation());
  view.doc.visibilityState = 'visible';
  act(() => view.fire('visibilitychange'));
  expect(reg.updateSW).toHaveBeenCalledTimes(1);
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});

test('I1: menjadi tidak aman selama menunggu pengambilalihan (controllerchange): tidak memuat ulang, spanduk tampil, lalu Muat ulang memuat ulang langsung', () => {
  const { reg, view, hook } = armed();
  act(() => notifyNavigation());
  expect(hook.result.current.visible).toBe(false);
  const end = beginBusy();
  // SW baru sudah aktif: tidak ada lagi SW menunggu.
  Object.assign(reg.registration, { waiting: null });
  act(() => view.fire('controllerchange'));
  expect(view.location.reload).not.toHaveBeenCalled();
  expect(hook.result.current.pending).toBe(false);
  expect(hook.result.current.visible).toBe(true);
  reg.needReload();
  expect(view.location.reload).not.toHaveBeenCalled();
  end();
  // Pengguna menekan Muat ulang: memuat ulang langsung (SW baru sudah aktif).
  act(() => hook.result.current.reload());
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});

test('I1: menjadi tidak aman selama menunggu (batas waktu): tidak memuat ulang dan spanduk tampil', () => {
  const { view, hook } = armed();
  act(() => notifyNavigation());
  const form = renderHook(() => useUnsavedChanges(true));
  act(() => {
    vi.advanceTimersByTime(11_000);
  });
  expect(view.location.reload).not.toHaveBeenCalled();
  expect(hook.result.current.visible).toBe(true);
  expect(hook.result.current.pending).toBe(false);
  form.unmount();
});

test('I1: jalur installing: menjadi tidak aman sebelum SW selesai dipasang atau gagal: tidak memuat ulang', () => {
  for (const mode of ['installed', 'redundant'] as const) {
    resetPwaUpdateForTests();
    resetBusyForTests();
    const reg = fakeRegister({ waiting: false });
    const view = fakeWindow();
    startPwaUpdates({ register: reg.register, win: view.win });
    reg.registerSw();
    const sw = fakeWorker();
    Object.assign(reg.registration, { installing: sw.worker });
    // Halaman rusak menyalakan status versi baru; pindah halaman (aman) memulai penantian pemasangan.
    notifyChunkLoadFailure();
    const hook = renderHook(() => usePwaUpdate());
    act(() => notifyNavigation());
    expect(hook.result.current.pending, mode).toBe(true);
    beginBusy();
    if (mode === 'installed') {
      Object.assign(reg.registration, { waiting: {}, installing: null });
      act(() => sw.setState('installed'));
      act(() => view.fire('controllerchange'));
    } else {
      act(() => sw.setState('redundant'));
    }
    expect(view.location.reload, mode).not.toHaveBeenCalled();
    // A1: SW baru TIDAK boleh diaktifkan (SKIP_WAITING) selagi tidak aman.
    expect(reg.updateSW, mode).not.toHaveBeenCalled();
    expect(hook.result.current.pending, mode).toBe(false);
    expect(hook.result.current.visible, mode).toBe(true);
    expect(sw.listenerCount(), mode).toBe(0);
  }
});

test('A1: jalur installing yang tetap aman: setelah installed SW diaktifkan dan halaman dimuat ulang tepat sekali', () => {
  const reg = fakeRegister({ waiting: false });
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  const sw = fakeWorker();
  Object.assign(reg.registration, { installing: sw.worker });
  notifyChunkLoadFailure();
  const hook = renderHook(() => usePwaUpdate());
  act(() => notifyNavigation());
  Object.assign(reg.registration, { waiting: {}, installing: null });
  act(() => sw.setState('installed'));
  expect(reg.updateSW).toHaveBeenCalledWith(true);
  act(() => view.fire('controllerchange'));
  expect(view.location.reload).toHaveBeenCalledTimes(1);
  expect(hook.result.current.pending).toBe(false);
});

test('A1: klik Muat ulang manual pada jalur installing tidak diperiksa aman (keputusan pengguna)', () => {
  const reg = fakeRegister({ waiting: false });
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  const sw = fakeWorker();
  Object.assign(reg.registration, { installing: sw.worker });
  notifyChunkLoadFailure();
  const hook = renderHook(() => usePwaUpdate());
  act(() => hook.result.current.reload());
  beginBusy();
  Object.assign(reg.registration, { waiting: {}, installing: null });
  act(() => sw.setState('installed'));
  expect(reg.updateSW).toHaveBeenCalledWith(true);
});

test('I1: klik Muat ulang oleh pengguna tidak diblokir oleh pemeriksaan aman (keputusan pengguna)', () => {
  const { view, hook } = armed();
  beginBusy();
  act(() => hook.result.current.reload());
  act(() => view.fire('controllerchange'));
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});

test('M-b: percobaan otomatis yang berakhir di batas waktu menyimpan penanda macet tanpa kedaluwarsa; muat halaman berikutnya hanya spanduk', () => {
  const first = armed();
  act(() => notifyNavigation());
  act(() => {
    vi.advanceTimersByTime(11_000);
  });
  expect(first.view.store.get('qc-pwa-auto-stuck')).toBe('1');
  // Halaman berikutnya, jauh setelah pembatas 60 dtk, SW masih menunggu: hanya spanduk.
  vi.advanceTimersByTime(10 * 60_000);
  resetPwaUpdateForTests();
  const reg = fakeRegister();
  const view = fakeWindow();
  view.store.set('qc-pwa-auto-stuck', '1');
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  reg.needRefresh();
  const hook = renderHook(() => usePwaUpdate());
  expect(hook.result.current.visible).toBe(true);
  act(() => notifyNavigation());
  expect(reg.updateSW).not.toHaveBeenCalled();
});

test('M-b: penanda macet dihapus saat tak ada lagi SW menunggu (halaman dimuat dengan SW baru yang aktif)', () => {
  const reg = fakeRegister({ waiting: false });
  const view = fakeWindow();
  view.store.set('qc-pwa-auto-stuck', '1');
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  expect(view.store.has('qc-pwa-auto-stuck')).toBe(false);
});

test('M-b: sessionStorage melempar atau tidak ada: TIDAK ada percobaan otomatis (hanya spanduk)', () => {
  for (const storage of ['throws', 'none'] as const) {
    resetPwaUpdateForTests();
    const reg = fakeRegister();
    const view = fakeWindow({ storage });
    startPwaUpdates({ register: reg.register, win: view.win });
    reg.registerSw();
    reg.needRefresh();
    const hook = renderHook(() => usePwaUpdate());
    expect(hook.result.current.visible, storage).toBe(true);
    act(() => notifyNavigation());
    view.doc.visibilityState = 'visible';
    act(() => view.fire('visibilitychange'));
    expect(reg.updateSW, storage).not.toHaveBeenCalled();
  }
});

test('R5: pembatas lintas muat ulang (sessionStorage): setelah muat ulang otomatis barusan, tidak mengulang dan spanduk tampil', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  view.store.set('qc-pwa-auto-reload', String(Date.now()));
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  reg.needRefresh();
  const hook = renderHook(() => usePwaUpdate());
  expect(hook.result.current.visible).toBe(true);
  act(() => notifyNavigation());
  expect(reg.updateSW).not.toHaveBeenCalled();
});

test('R5: percobaan otomatis mencatat waktu di sessionStorage', () => {
  const { view } = armed();
  act(() => notifyNavigation());
  expect(Number(view.store.get('qc-pwa-auto-reload'))).toBeGreaterThan(0);
});

test('R5: tanpa registrasi dan bukan galat muat potongan, tidak ada muat ulang otomatis', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.needRefresh();
  act(() => notifyNavigation());
  expect(reg.updateSW).not.toHaveBeenCalled();
  expect(view.location.reload).not.toHaveBeenCalled();
});

test('R5: tanpa versi baru (needRefresh mati) berpindah halaman tidak memuat ulang', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  act(() => notifyNavigation());
  expect(reg.updateSW).not.toHaveBeenCalled();
});

test('R5: attachNavigationTrigger hanya meneruskan perpindahan path sungguhan (bukan muat awal atau ubah query)', () => {
  const { reg } = armed();
  let handler: (event: {
    fromLocation?: unknown;
    toLocation: { href: string };
    pathChanged: boolean;
  }) => void = () => undefined;
  const off = vi.fn();
  attachNavigationTrigger({
    subscribe: (_type, fn) => {
      handler = fn;
      return off;
    },
  });
  act(() => handler({ toLocation: { href: '/' }, pathChanged: true }));
  act(() => handler({ fromLocation: {}, toLocation: { href: '/?q=1' }, pathChanged: false }));
  expect(reg.updateSW).not.toHaveBeenCalled();
  act(() => handler({ fromLocation: {}, toLocation: { href: '/item' }, pathChanged: true }));
  expect(reg.updateSW).toHaveBeenCalledTimes(1);
});

test('M-d: sibuk singkat tidak menampilkan spanduk, tetapi tetap menghalangi muat ulang otomatis seketika', () => {
  const { reg, view, hook } = armed();
  const end = beginBusy();
  act(() => notifyNavigation());
  expect(reg.updateSW).not.toHaveBeenCalled();
  expect(hook.result.current.visible).toBe(false);
  act(() => end());
  act(() => notifyNavigation());
  expect(reg.updateSW).toHaveBeenCalledWith(true);
  act(() => view.fire('controllerchange'));
  expect(view.location.reload).toHaveBeenCalledTimes(1);
});

test('A2: penanda macet TIDAK dihapus selama SW masih installing; dihapus hanya bila tak ada SW menunggu maupun dipasang', () => {
  const stuckWhileInstalling = fakeRegister({ waiting: false });
  const sw = fakeWorker();
  Object.assign(stuckWhileInstalling.registration, { installing: sw.worker });
  const first = fakeWindow();
  first.store.set('qc-pwa-auto-stuck', '1');
  startPwaUpdates({ register: stuckWhileInstalling.register, win: first.win });
  stuckWhileInstalling.registerSw();
  expect(first.store.get('qc-pwa-auto-stuck')).toBe('1');

  resetPwaUpdateForTests();
  const idle = fakeRegister({ waiting: false });
  const second = fakeWindow();
  second.store.set('qc-pwa-auto-stuck', '1');
  startPwaUpdates({ register: idle.register, win: second.win });
  idle.registerSw();
  expect(second.store.has('qc-pwa-auto-stuck')).toBe(false);
});

test('A3: penulisan pembatas melempar di tengah sesi (probe lulus): tidak ada percobaan otomatis, hanya spanduk', () => {
  const reg = fakeRegister();
  const view = fakeWindow({ storage: 'probe-only' });
  startPwaUpdates({ register: reg.register, win: view.win });
  reg.registerSw();
  reg.needRefresh();
  const hook = renderHook(() => usePwaUpdate());
  // Probe lulus saat start, jadi pada awalnya percobaan dianggap boleh (tampil menunggu pemicu)...
  expect(hook.result.current.visible).toBe(false);
  act(() => notifyNavigation());
  // ...tetapi menulis pembatas gagal: batalkan, tanpa SKIP_WAITING, dan spanduk tampil.
  expect(reg.updateSW).not.toHaveBeenCalled();
  expect(view.location.reload).not.toHaveBeenCalled();
  expect(hook.result.current.visible).toBe(true);
});

test('A4: kunci probe tidak tertinggal di sessionStorage', () => {
  const reg = fakeRegister();
  const view = fakeWindow();
  startPwaUpdates({ register: reg.register, win: view.win });
  expect(view.store.has('qc-pwa-probe')).toBe(false);
});
