import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

const SOURCE = readFileSync(resolve(process.cwd(), 'public', 'push-sw.js'), 'utf8');
const ORIGIN = 'https://qc.test';

interface FakeClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
}

/** Memuat `push-sw.js` ke sandbox dengan `self` palsu (skrip klasik: hanya memakai `self`). */
function load(clients: FakeClient[] = []) {
  const handlers = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn(() => Promise.resolve());
  const openWindow = vi.fn(() => Promise.resolve(null));
  const self = {
    location: { origin: ORIGIN },
    registration: { showNotification },
    clients: { matchAll: vi.fn(() => Promise.resolve(clients)), openWindow },
    addEventListener: (type: string, fn: (event: unknown) => void) => handlers.set(type, fn),
  };
  new Function('self', SOURCE)(self);
  return { handlers, showNotification, openWindow, self };
}

/** Menjalankan handler `push` dan mengembalikan promise yang diserahkan ke `waitUntil`. */
async function push(sandbox: ReturnType<typeof load>, data: unknown) {
  let pending: Promise<unknown> | undefined;
  const event = {
    data: data === undefined ? null : { json: () => (typeof data === 'function' ? data() : data) },
    waitUntil: (promise: Promise<unknown>) => {
      pending = promise;
    },
  };
  sandbox.handlers.get('push')?.(event);
  expect(pending, 'waitUntil dipanggil dengan promise').toBeInstanceOf(Promise);
  await pending;
}

async function click(sandbox: ReturnType<typeof load>, url: unknown) {
  const close = vi.fn();
  let pending: Promise<unknown> | undefined;
  sandbox.handlers.get('notificationclick')?.({
    notification: { close, data: url === undefined ? undefined : { url } },
    waitUntil: (promise: Promise<unknown>) => {
      pending = promise;
    },
  });
  await pending;
  return close;
}

describe('push', () => {
  test('payload valid: tampil dengan judul, isi, tag, ikon, dan url di data', async () => {
    const sandbox = load();
    await push(sandbox, {
      title: 'Task baru',
      body: 'ST-1 - PT A\ncatatan',
      url: '/handover/h1?loc=l1',
      tag: 'created:h1',
    });
    expect(sandbox.showNotification).toHaveBeenCalledWith(
      'Task baru',
      expect.objectContaining({
        body: 'ST-1 - PT A\ncatatan',
        tag: 'created:h1',
        renotify: true,
        icon: '/icons/icon-192.png',
        data: { url: '/handover/h1?loc=l1' },
      }),
    );
  });

  test('tanpa data, JSON rusak, atau bentuk salah: tetap tampil notifikasi generik', async () => {
    for (const data of [
      undefined,
      () => {
        throw new SyntaxError('rusak');
      },
      'teks',
      42,
      null,
      { title: 7, body: { x: 1 } },
    ]) {
      const sandbox = load();
      await push(sandbox, data);
      expect(sandbox.showNotification).toHaveBeenCalledTimes(1);
      const calls = sandbox.showNotification.mock.calls as unknown as [
        string,
        { data: { url: string } },
      ][];
      expect(calls[0]?.[0]).toBe('QC App');
      expect(calls[0]?.[1].data.url).toBe('/');
    }
  });

  test('url berbahaya di payload dinormalkan ke "/"', async () => {
    for (const url of [
      '//evil.test/x',
      'https://evil.test',
      'javascript:alert(1)',
      '',
      'handover/h1',
      '/..//evil.test',
      '/.//evil.test',
      '/a/..//evil.test',
      '/%2e%2e//evil.test',
      '/x/%2E%2E//evil.test',
      `/${String.fromCharCode(92)}evil.test`,
      '/\t/evil.test',
      '/\n/evil.test',
      7,
    ]) {
      const sandbox = load();
      await push(sandbox, { title: 'T', body: 'B', url });
      const calls = sandbox.showNotification.mock.calls as unknown as [
        string,
        { data: { url: string } },
      ][];
      expect(calls[0]?.[1].data.url, String(url)).toBe('/');
    }
  });
});

describe('notificationclick', () => {
  test('menutup notifikasi, memfokuskan window aplikasi, lalu menavigasi ke url', async () => {
    const other: FakeClient = { url: 'https://lain.test/x', focus: vi.fn(() => Promise.resolve()) };
    const mine: FakeClient = {
      url: `${ORIGIN}/handover`,
      focus: vi.fn(() => Promise.resolve()),
      navigate: vi.fn(() => Promise.resolve(null)),
    };
    const sandbox = load([other, mine]);
    const close = await click(sandbox, '/handover/h1?loc=l1');
    expect(close).toHaveBeenCalled();
    expect(other.focus).not.toHaveBeenCalled();
    expect(mine.focus).toHaveBeenCalled();
    expect(mine.navigate).toHaveBeenCalledWith('/handover/h1?loc=l1');
    expect(sandbox.openWindow).not.toHaveBeenCalled();
  });

  test('tanpa window aplikasi: membuka window baru; navigasi gagal: juga membuka window baru', async () => {
    const empty = load([]);
    await click(empty, '/handover/h1');
    expect(empty.openWindow).toHaveBeenCalledWith('/handover/h1');
    const failing: FakeClient = {
      url: `${ORIGIN}/`,
      focus: vi.fn(() => Promise.resolve()),
      navigate: vi.fn(() => Promise.reject(new Error('tak terkontrol'))),
    };
    const sandbox = load([failing]);
    await click(sandbox, '/handover/h2');
    expect(sandbox.openWindow).toHaveBeenCalledWith('/handover/h2');
  });

  test('url tak aman atau tanpa data: hanya membuka "/"', async () => {
    for (const url of ['//evil.test', 'https://evil.test', undefined]) {
      const sandbox = load([]);
      await click(sandbox, url);
      expect(sandbox.openWindow, String(url)).toHaveBeenCalledWith('/');
    }
  });
});
