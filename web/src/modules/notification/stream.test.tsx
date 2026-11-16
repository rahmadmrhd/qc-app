import { NOTIFICATIONS_STREAM_EVENT, NOTIFICATIONS_STREAM_PATH } from '@shared/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  NOTIFICATIONS_REFETCH_MS,
  NOTIFICATIONS_SAFETY_REFETCH_MS,
  notificationKeys,
  notificationsQueryOptions,
} from './queries';
import {
  REFRESH_DEBOUNCE_MS,
  STREAM_REOPEN_MS,
  type StreamSource,
  startBridgeNotifications,
  startNotificationStream,
  useNotificationStream,
} from './stream';
import { isNotificationStreamConnected, setNotificationStreamConnected } from './stream-state';

class FakeSource implements StreamSource {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<() => void>>();
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  fail(readyState: number): void {
    this.readyState = readyState;
    this.onerror?.(new Event('error'));
  }
}

let client: QueryClient;
let invalidate: ReturnType<typeof vi.spyOn>;
let sources: FakeSource[];
const create = (url: string) => {
  const source = new FakeSource(url);
  sources.push(source);
  return source;
};

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient();
  invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  sources = [];
  setNotificationStreamConnected(false);
});
afterEach(() => {
  vi.useRealTimers();
  setNotificationStreamConnected(false);
});

describe('startNotificationStream', () => {
  test('membuka stream di jalur bersama dan belum dianggap tersambung sebelum onopen', () => {
    const stop = startNotificationStream(client, { createSource: create });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toBe(NOTIFICATIONS_STREAM_PATH);
    expect(isNotificationStreamConnected()).toBe(false);
    stop();
  });

  test('onopen: tersambung dan daftar dimuat ulang (menutup sinyal yang lewat saat putus)', () => {
    const stop = startNotificationStream(client, { createSource: create });
    sources[0]?.open();
    expect(isNotificationStreamConnected()).toBe(true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: notificationKeys.list });
    stop();
  });

  test('bingkai notification memuat ulang daftar; event lain (ready) tidak', () => {
    const stop = startNotificationStream(client, { createSource: create });
    sources[0]?.open();
    invalidate.mockClear();
    sources[0]?.emit('ready');
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 2);
    expect(invalidate).not.toHaveBeenCalled();
    sources[0]?.emit(NOTIFICATIONS_STREAM_EVENT);
    expect(invalidate).not.toHaveBeenCalled(); // digabung dulu, belum seketika
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: notificationKeys.list });
    stop();
  });

  test('tunggakan sambung ulang (puluhan bingkai sekaligus) digabung menjadi SATU pemuatan', () => {
    const stop = startNotificationStream(client, { createSource: create });
    sources[0]?.open();
    invalidate.mockClear();
    for (let i = 0; i < 50; i++) sources[0]?.emit(NOTIFICATIONS_STREAM_EVENT);
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(1);
    // Bingkai berikutnya setelah jendela lewat memuat lagi.
    sources[0]?.emit(NOTIFICATIONS_STREAM_EVENT);
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(2);
    stop();
  });

  test('menutup stream membatalkan pemuatan yang tertunda', () => {
    const stop = startNotificationStream(client, { createSource: create });
    sources[0]?.open();
    invalidate.mockClear();
    sources[0]?.emit(NOTIFICATIONS_STREAM_EVENT);
    stop();
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 4);
    expect(invalidate).not.toHaveBeenCalled();
  });

  test('putus sementara (peramban menyambung ulang sendiri): polling cepat ambil alih, tanpa membuka stream baru', () => {
    const stop = startNotificationStream(client, { createSource: create });
    sources[0]?.open();
    invalidate.mockClear();
    sources[0]?.fail(0);
    expect(isNotificationStreamConnected()).toBe(false);
    expect(invalidate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(STREAM_REOPEN_MS * 2);
    expect(sources).toHaveLength(1);
    // Tersambung lagi: status pulih dan daftar dimuat ulang.
    sources[0]?.open();
    expect(isNotificationStreamConnected()).toBe(true);
    stop();
  });

  test('server mati lama (percobaan sambung ulang berulang): daftar dimuat ulang SEKALI saat status berbalik, bukan tiap percobaan', () => {
    const stop = startNotificationStream(client, { createSource: create });
    sources[0]?.open();
    invalidate.mockClear();
    sources[0]?.fail(0);
    sources[0]?.fail(0);
    sources[0]?.fail(0);
    expect(invalidate).toHaveBeenCalledTimes(1);
    // Pulih lalu putus lagi = berbalik lagi = satu pemuatan lagi (pemuatan karena open dihitung terpisah).
    sources[0]?.open();
    invalidate.mockClear();
    sources[0]?.fail(0);
    expect(invalidate).toHaveBeenCalledTimes(1);
    stop();
  });

  test('stream yang tak pernah tersambung (mis. 401 terus): tidak memuat daftar sama sekali, polling 10 dtk yang bekerja', () => {
    const stop = startNotificationStream(client, { createSource: create });
    sources[0]?.fail(2);
    vi.advanceTimersByTime(STREAM_REOPEN_MS);
    sources[1]?.fail(2);
    vi.advanceTimersByTime(STREAM_REOPEN_MS);
    sources[2]?.fail(2);
    expect(sources).toHaveLength(3);
    expect(invalidate).not.toHaveBeenCalled();
    stop();
  });

  test('stream ditutup peramban (mis. 401): dibuka ulang setelah jeda, stream lama ditutup', () => {
    const stop = startNotificationStream(client, { createSource: create });
    sources[0]?.fail(2);
    expect(isNotificationStreamConnected()).toBe(false);
    vi.advanceTimersByTime(STREAM_REOPEN_MS - 1);
    expect(sources).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sources).toHaveLength(2);
    expect(sources[0]?.closed).toBe(true);
    sources[1]?.open();
    expect(isNotificationStreamConnected()).toBe(true);
    stop();
  });

  test('tab kembali terlihat saat stream tertutup: dibuka ulang segera', () => {
    const stop = startNotificationStream(client, { createSource: create });
    sources[0]?.fail(2);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sources).toHaveLength(2);
    stop();
  });

  test('peristiwa dari stream lama (sudah diganti) diabaikan', () => {
    const stop = startNotificationStream(client, { createSource: create });
    sources[0]?.fail(2);
    vi.advanceTimersByTime(STREAM_REOPEN_MS);
    sources[1]?.open();
    invalidate.mockClear();
    sources[0]?.emit(NOTIFICATIONS_STREAM_EVENT);
    sources[0]?.fail(2);
    expect(invalidate).not.toHaveBeenCalled();
    expect(isNotificationStreamConnected()).toBe(true);
    stop();
  });

  test('penutup: stream ditutup, status putus, tak ada pembukaan ulang atau pemuatan lagi', () => {
    const stop = startNotificationStream(client, { createSource: create });
    sources[0]?.open();
    sources[0]?.fail(2);
    stop();
    expect(sources[0]?.closed).toBe(true);
    expect(isNotificationStreamConnected()).toBe(false);
    invalidate.mockClear();
    vi.advanceTimersByTime(STREAM_REOPEN_MS * 3);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sources).toHaveLength(1);
    sources[0]?.emit(NOTIFICATIONS_STREAM_EVENT);
    expect(invalidate).not.toHaveBeenCalled();
  });

  test('tanpa dukungan EventSource: tidak melempar dan tidak pernah dianggap tersambung', () => {
    const stop = startNotificationStream(client, { createSource: () => null });
    expect(isNotificationStreamConnected()).toBe(false);
    expect(() => stop()).not.toThrow();
  });
});

describe('sumber stream bawaan (EventSource peramban)', () => {
  const opened: string[] = [];
  class FakeEventSource {
    readyState = 0;
    onopen = null;
    onerror = null;
    constructor(url: string) {
      opened.push(url);
    }
    addEventListener(): void {}
    close(): void {}
  }
  const win = window as unknown as { qcBridge?: unknown };

  beforeEach(() => {
    opened.length = 0;
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete win.qcBridge;
  });

  test('peramban biasa: membuka EventSource pada jalur bersama', () => {
    const stop = startNotificationStream(client);
    expect(opened).toEqual([NOTIFICATIONS_STREAM_PATH]);
    stop();
  });

  test('aplikasi desktop (window.qcBridge): TIDAK membuka aliran dari lonceng, hanya polling', () => {
    win.qcBridge = { version: 1 };
    const stop = startNotificationStream(client);
    expect(opened).toEqual([]);
    expect(isNotificationStreamConnected()).toBe(false);
    stop();
  });
});

describe('desktop: sinyal dari proses utama lewat jembatan (lonceng seketika, konsisten dengan notifikasi Windows)', () => {
  /** Jembatan palsu: `fire()` meniru satu sinyal dari proses utama. */
  function fakeBridge(version: number, withNotifications = true) {
    const listeners = new Set<() => void>();
    const unsubscribed = vi.fn();
    const bridge = {
      version,
      ...(withNotifications
        ? {
            notifications: {
              onChange: (cb: () => void) => {
                listeners.add(cb);
                return () => {
                  listeners.delete(cb);
                  unsubscribed();
                };
              },
            },
          }
        : {}),
    };
    return {
      bridge: bridge as unknown as Parameters<typeof startBridgeNotifications>[1],
      fire: () => {
        for (const listener of [...listeners]) listener();
      },
      listeners,
      unsubscribed,
    };
  }
  const win = window as unknown as { qcBridge?: unknown };
  afterEach(() => {
    delete win.qcBridge;
  });

  test('jembatan v4: tiap sinyal memuat ulang daftar, digabung dalam jendela debounce', () => {
    const { bridge, fire } = fakeBridge(4);
    const stop = startBridgeNotifications(client, bridge);
    expect(invalidate).not.toHaveBeenCalled();
    fire();
    expect(invalidate).not.toHaveBeenCalled(); // digabung dulu
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: notificationKeys.list });
    for (let i = 0; i < 20; i++) fire();
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(2);
    stop();
  });

  test('menutup: berhenti mendengarkan dan membatalkan pemuatan yang tertunda', () => {
    const { bridge, fire, listeners, unsubscribed } = fakeBridge(4);
    const stop = startBridgeNotifications(client, bridge);
    expect(listeners.size).toBe(1);
    fire();
    stop();
    expect(unsubscribed).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS * 4);
    expect(invalidate).not.toHaveBeenCalled();
  });

  test('status polling TIDAK berubah: renderer tak tahu kesehatan aliran proses utama, polling 10 dtk tetap jaring pengaman', () => {
    const { bridge, fire } = fakeBridge(4);
    const stop = startBridgeNotifications(client, bridge);
    fire();
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(isNotificationStreamConnected()).toBe(false);
    stop();
  });

  test('jembatan lama (v3, tanpa notifications), tanpa jembatan, atau notifications rusak: tidak melempar, hanya polling', () => {
    for (const bridge of [
      fakeBridge(3, false).bridge,
      fakeBridge(4, false).bridge, // versi benar tetapi metode tak ada
      null,
    ]) {
      const stop = startBridgeNotifications(client, bridge);
      expect(() => stop()).not.toThrow();
    }
    const old = fakeBridge(3);
    const stop = startBridgeNotifications(client, old.bridge);
    expect(old.listeners.size).toBe(0); // v3 tak diperlakukan punya fitur walau objeknya ada
    stop();
    expect(invalidate).not.toHaveBeenCalled();
  });

  test('useNotificationStream di desktop memakai sinyal jembatan (bukan EventSource) dan berhenti saat dilepas', () => {
    const { bridge, fire, listeners } = fakeBridge(4);
    win.qcBridge = bridge;
    const opened: string[] = [];
    vi.stubGlobal(
      'EventSource',
      class {
        constructor(url: string) {
          opened.push(url);
        }
      },
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useNotificationStream(), { wrapper });
    expect(listeners.size).toBe(1);
    expect(opened).toEqual([]);
    fire();
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(listeners.size).toBe(0);
    vi.unstubAllGlobals();
  });
});

describe('selang polling lonceng', () => {
  const intervalNow = () => {
    const options = notificationsQueryOptions();
    const interval = options.refetchInterval;
    if (typeof interval !== 'function') throw new Error('refetchInterval harus fungsi');
    return (interval as () => number)();
  };

  test('stream putus: 10 dtk; tersambung: jaring pengaman 60 dtk', () => {
    expect(NOTIFICATIONS_REFETCH_MS).toBe(10_000);
    expect(NOTIFICATIONS_SAFETY_REFETCH_MS).toBe(60_000);
    expect(intervalNow()).toBe(NOTIFICATIONS_REFETCH_MS);
    setNotificationStreamConnected(true);
    expect(intervalNow()).toBe(NOTIFICATIONS_SAFETY_REFETCH_MS);
    setNotificationStreamConnected(false);
    expect(intervalNow()).toBe(NOTIFICATIONS_REFETCH_MS);
  });

  test('tetap memuat ulang saat jendela fokus', () => {
    expect(notificationsQueryOptions().refetchOnWindowFocus).toBe('always');
  });
});
