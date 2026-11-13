import type { PushConfigDto } from '@shared/contract';
import { describe, expect, test, vi } from 'vitest';
import { getPushRegistration, subscribeThisDevice, urlBase64ToBytes } from './subscribe';

/** Kunci publik uji: 65 byte (0x04 diikuti 1..64), dikodekan URL-safe tanpa padding. */
const KEY_BYTES = Uint8Array.from([4, ...Array.from({ length: 64 }, (_, i) => i + 1)]);
const KEY = Buffer.from(KEY_BYTES).toString('base64url');
const OTHER_BYTES = Uint8Array.from([4, ...Array.from({ length: 64 }, (_, i) => 200 - i)]);
const OTHER_KEY = Buffer.from(OTHER_BYTES).toString('base64url');

const config = (patch: Partial<PushConfigDto> = {}): PushConfigDto => ({
  enabled: true,
  publicKey: KEY,
  userEnabled: true,
  ...patch,
});

function fakeSubscription(
  key: Uint8Array | null,
  endpoint = 'https://fcm.googleapis.com/fcm/send/x',
) {
  return {
    endpoint,
    options: { applicationServerKey: key === null ? null : key.slice().buffer },
    unsubscribe: vi.fn(() => Promise.resolve(true)),
    toJSON: () => ({ endpoint, keys: { p256dh: 'PUB', auth: 'AUTH' } }),
  };
}

function setup(existing: ReturnType<typeof fakeSubscription> | null) {
  const created = fakeSubscription(KEY_BYTES, 'https://fcm.googleapis.com/fcm/send/baru');
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(existing)),
    subscribe: vi.fn((_options: PushSubscriptionOptionsInit) => Promise.resolve(created)),
  };
  const send = vi.fn(() => Promise.resolve({ ok: true }));
  const unsubscribeServer = vi.fn(() => Promise.resolve({ ok: true }));
  return { pushManager, send, unsubscribeServer, created };
}

describe('urlBase64ToBytes', () => {
  test('mengubah kunci URL-safe tanpa padding menjadi byte aslinya', () => {
    expect(Array.from(urlBase64ToBytes(KEY))).toEqual(Array.from(KEY_BYTES));
    expect(KEY).not.toMatch(/[+/=]/);
  });
});

describe('subscribeThisDevice', () => {
  test('langganan baru: subscribe dengan kunci server lalu kirim endpoint dan kuncinya', async () => {
    const { pushManager, send, unsubscribeServer } = setup(null);
    const result = await subscribeThisDevice({
      registration: { pushManager } as never,
      config: config(),
      send,
      unsubscribeServer,
    });
    expect(result).toBe('subscribed');
    const options = pushManager.subscribe.mock.calls[0]?.[0] as PushSubscriptionOptionsInit;
    expect(options.userVisibleOnly).toBe(true);
    expect(Array.from(new Uint8Array(options.applicationServerKey as ArrayBuffer))).toEqual(
      Array.from(KEY_BYTES),
    );
    expect(send).toHaveBeenCalledWith({
      endpoint: 'https://fcm.googleapis.com/fcm/send/baru',
      p256dh: 'PUB',
      auth: 'AUTH',
    });
    expect(unsubscribeServer).not.toHaveBeenCalled();
  });

  test('langganan lama dengan kunci sama dipakai ulang tetapi tetap dikirim (akun kedua ikut tertaut)', async () => {
    const existing = fakeSubscription(KEY_BYTES, 'https://fcm.googleapis.com/fcm/send/lama');
    const { pushManager, send, unsubscribeServer } = setup(existing);
    await subscribeThisDevice({
      registration: { pushManager } as never,
      config: config(),
      send,
      unsubscribeServer,
    });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/lama' }),
    );
  });

  test('kunci server berubah: langganan lama dilepas di server dan peramban, lalu dibuat ulang', async () => {
    const existing = fakeSubscription(OTHER_BYTES, 'https://fcm.googleapis.com/fcm/send/lama');
    const { pushManager, send, unsubscribeServer } = setup(existing);
    await subscribeThisDevice({
      registration: { pushManager } as never,
      config: config({ publicKey: KEY }),
      send,
      unsubscribeServer,
    });
    expect(unsubscribeServer).toHaveBeenCalledWith({
      endpoint: 'https://fcm.googleapis.com/fcm/send/lama',
    });
    expect(existing.unsubscribe).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://fcm.googleapis.com/fcm/send/baru' }),
    );
    expect(OTHER_KEY).not.toBe(KEY);
  });

  test('push nonaktif di server atau kunci kosong: unavailable tanpa menyentuh peramban', async () => {
    for (const cfg of [config({ enabled: false }), config({ publicKey: '' })]) {
      const { pushManager, send, unsubscribeServer } = setup(null);
      const result = await subscribeThisDevice({
        registration: { pushManager } as never,
        config: cfg,
        send,
        unsubscribeServer,
      });
      expect(result).toBe('unavailable');
      expect(pushManager.getSubscription).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    }
  });

  test('peramban menolak berlangganan: galat diteruskan ke pemanggil dan tak ada yang dikirim', async () => {
    const { pushManager, send, unsubscribeServer } = setup(null);
    pushManager.subscribe.mockRejectedValueOnce(new DOMException('ditolak', 'NotAllowedError'));
    await expect(
      subscribeThisDevice({
        registration: { pushManager } as never,
        config: config(),
        send,
        unsubscribeServer,
      }),
    ).rejects.toThrow('ditolak');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('getPushRegistration', () => {
  test('mengembalikan registrasi yang siap; tanpa service worker atau tak kunjung siap = undefined', async () => {
    const registration = { scope: '/' } as unknown as ServiceWorkerRegistration;
    const ready = { navigator: { serviceWorker: { ready: Promise.resolve(registration) } } };
    expect(await getPushRegistration(ready as unknown as Window, 50)).toBe(registration);
    const none = { navigator: {} };
    expect(await getPushRegistration(none as unknown as Window, 50)).toBeUndefined();
    const never = { navigator: { serviceWorker: { ready: new Promise(() => {}) } } };
    expect(await getPushRegistration(never as unknown as Window, 20)).toBeUndefined();
  });
});
