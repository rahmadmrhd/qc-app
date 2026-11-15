import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  clearAllDeviceStores,
  type DeviceRecord,
  deleteOutboxRecords,
  putOutboxRecord,
  readOutboxRecords,
} from '@/lib/device-db';
import { resetOutboxEnv } from '@/test/outbox-env';
import { isOutboxEntry } from './outbox';

const SOURCE = readFileSync(resolve(process.cwd(), 'public', 'sync-sw.js'), 'utf8');
const OWNER = 'a@x.com';
const NOW = Date.now();

type Responder = (url: string, init: RequestInit, index: number) => Response | Promise<Response>;

interface Sandbox {
  handlers: Map<string, (event: unknown) => void>;
  fetch: ReturnType<typeof vi.fn>;
  lockNames: string[];
  posted: Array<{ type: string; [key: string]: unknown }>;
  channels: string[];
  windows: Array<{ postMessage: ReturnType<typeof vi.fn> }>;
  matchAll: ReturnType<typeof vi.fn>;
  hook: ReturnType<typeof vi.fn>;
}

const jsonResponse = (status: number, body: unknown, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
const problem = (status: number, body: Record<string, unknown>) =>
  jsonResponse(status, body, 'application/problem+json');
const ok = (body: unknown = {}) => jsonResponse(200, body);

/** Jawaban bawaan: `/me` = pemilik sah, semua pengiriman sukses. */
const defaultResponder: Responder = (url) =>
  url.endsWith('/api/v1/me') ? ok({ email: OWNER }) : ok({});

/** Memuat `sync-sw.js` ke sandbox dengan `self` palsu (skrip klasik: hanya memakai `self` dan global standar). */
function load(
  options: {
    respond?: Responder;
    indexedDB?: unknown;
    navigator?: unknown;
    windowCount?: number;
  } = {},
): Sandbox {
  const handlers = new Map<string, (event: unknown) => void>();
  const lockNames: string[] = [];
  const posted: Sandbox['posted'] = [];
  const channels: string[] = [];
  const windows = Array.from({ length: options.windowCount ?? 1 }, () => ({
    postMessage: vi.fn(),
  }));
  const matchAll = vi.fn(async () => windows);
  const respond = options.respond ?? defaultResponder;
  let index = 0;
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => respond(url, init, index++));
  const hook = vi.fn();
  class FakeChannel {
    constructor(name: string) {
      channels.push(name);
    }
    postMessage(message: Sandbox['posted'][number]) {
      posted.push(message);
    }
    close() {}
  }
  const self = {
    location: { origin: 'https://qc.test' },
    indexedDB: 'indexedDB' in options ? options.indexedDB : globalThis.indexedDB,
    fetch: fetchMock,
    navigator:
      'navigator' in options
        ? options.navigator
        : {
            locks: {
              request: (name: string, callback: () => Promise<unknown>) => {
                lockNames.push(name);
                return callback();
              },
            },
          },
    BroadcastChannel: FakeChannel,
    clients: { matchAll },
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      handlers.set(type, handler),
    __qcSyncTest: hook,
  };
  new Function('self', SOURCE)(self);
  return { handlers, fetch: fetchMock, lockNames, posted, channels, windows, matchAll, hook };
}

/** Menjalankan peristiwa `sync`; mengembalikan promise `waitUntil` (undefined bila tak dipanggil). */
function fire(sandbox: Sandbox, tag = 'qc-outbox'): Promise<unknown> | undefined {
  let pending: Promise<unknown> | undefined;
  sandbox.handlers.get('sync')?.({
    tag,
    waitUntil: (promise: Promise<unknown>) => {
      pending = promise;
    },
  });
  return pending;
}

const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_B = '22222222-2222-4222-8222-222222222222';

const checkEntry = (id: string, over: Record<string, unknown> = {}) => ({
  kind: 'check',
  id,
  taskId: 't1',
  locationId: 'loc-a',
  index: 0,
  text: 'A = 1',
  checked: true,
  at: NOW,
  ...over,
});
const commentEntry = (id: string, over: Record<string, unknown> = {}) => ({
  kind: 'comment',
  id,
  clientId: CLIENT_A,
  taskId: 't2',
  locationId: 'loc-a',
  quote: 'kutipan',
  before: 'sebelum',
  after: 'sesudah',
  body: 'isi komentar',
  at: NOW,
  ...over,
});
const createEntry = (id: string, over: Record<string, unknown> = {}) => ({
  kind: 'create',
  id,
  locationId: 'loc-a',
  tasks: [{ clientId: CLIENT_B, customerName: 'PT A', note: 'catatan A' }],
  at: NOW,
  ...over,
});

/** Menulis rekaman ke toko seperti halaman (bentuk rekaman Tahap C/D). */
async function seed(
  entry: { id: string; at: number },
  options: { owner?: string; seq?: number; savedAt?: number; v?: number } = {},
): Promise<void> {
  const owner = options.owner ?? OWNER;
  const record = {
    key: `${owner}|${entry.id}`,
    owner,
    v: options.v ?? 1,
    savedAt: options.savedAt ?? entry.at,
    seq: options.seq ?? 1,
    entry,
  } as DeviceRecord;
  expect(await putOutboxRecord(owner, record, {}, () => true)).toBe('ok');
}

const stored = async (): Promise<DeviceRecord[]> =>
  ((await readOutboxRecords()) ?? []).sort((a, b) => (a.key < b.key ? -1 : 1));
const storedIds = async () => (await stored()).map((r) => (r.entry as { id: string }).id);

/** Panggilan fetch selain `/me`. */
const sends = (sandbox: Sandbox) =>
  sandbox.fetch.mock.calls.filter(([url]) => !String(url).endsWith('/api/v1/me')) as Array<
    [string, RequestInit]
  >;

beforeEach(() => resetOutboxEnv());
afterEach(() => vi.useRealTimers());

describe('pendengar dan prasyarat', () => {
  test('sync dengan tag lain diabaikan', async () => {
    await seed(checkEntry('c1'));
    const sandbox = load();
    expect(fire(sandbox, 'tag-lain')).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sandbox.fetch).not.toHaveBeenCalled();
    expect(await storedIds()).toEqual(['c1']);
  });

  test('tanpa navigator.locks tidak mengirim apa pun', async () => {
    await seed(checkEntry('c1'));
    const sandbox = load({ navigator: {} });
    await expect(fire(sandbox)).resolves.toBeUndefined();
    expect(sandbox.fetch).not.toHaveBeenCalled();
    expect(await storedIds()).toEqual(['c1']);
  });

  test('berjalan di dalam kunci Web Locks "qc-outbox-flush"', async () => {
    await seed(checkEntry('c1'));
    const sandbox = load();
    await fire(sandbox);
    expect(sandbox.lockNames).toEqual(['qc-outbox-flush']);
  });

  test('IndexedDB tidak ada atau toko outbox tak ada: selesai tanpa galat dan tanpa menghapus', async () => {
    // (a) tanpa IndexedDB sama sekali
    const none = load({ indexedDB: undefined });
    await expect(fire(none)).resolves.toBeUndefined();
    expect(none.fetch).not.toHaveBeenCalled();

    // (b) basis data belum pernah dibuat: tidak boleh dibuat kosong oleh service worker
    globalThis.indexedDB = new IDBFactory();
    const fresh = load();
    await expect(fire(fresh)).resolves.toBeUndefined();
    expect(fresh.fetch).not.toHaveBeenCalled();
    expect(await globalThis.indexedDB.databases()).toEqual([]);

    // (c) basis data lama tanpa toko outbox: tak disentuh (versi dan toko tetap)
    globalThis.indexedDB = new IDBFactory();
    await new Promise<void>((done, fail) => {
      const request = globalThis.indexedDB.open('qc-device', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('lain');
      request.onsuccess = () => {
        request.result.close();
        done();
      };
      request.onerror = () => fail(request.error);
    });
    const old = load();
    await expect(fire(old)).resolves.toBeUndefined();
    expect(old.fetch).not.toHaveBeenCalled();
    const info = await globalThis.indexedDB.databases();
    expect(info).toEqual([{ name: 'qc-device', version: 1 }]);
  });

  test('rekaman versi lebih baru dan jenis tak dikenal dibiarkan', async () => {
    await seed(checkEntry('baru'), { v: 2 });
    await seed({ id: 'asing', kind: 'pindah-lokasi', at: NOW } as never);
    await seed({ id: 'rusak', kind: 'check', at: NOW } as never);
    await seed(checkEntry('lama'), { v: 0 });
    await seed(checkEntry('ok', { taskId: 'tok' }));
    const before = await stored();
    const sandbox = load();
    await fire(sandbox);
    expect(sends(sandbox)).toHaveLength(1);
    expect(sends(sandbox)[0]?.[0]).toBe('/api/v1/handovers/tok/checks');
    const after = await stored();
    expect(after.map((r) => r.key)).toEqual(
      before.filter((r) => !r.key.endsWith('|ok')).map((r) => r.key),
    );
    expect(after).toEqual(before.filter((r) => !r.key.endsWith('|ok')));
  });
});

describe('pemilik sesi', () => {
  test('/me beda email: tidak mengirim, entri tetap', async () => {
    await seed(checkEntry('c1'));
    const before = await stored();
    const sandbox = load({
      respond: (url) => (url.endsWith('/me') ? ok({ email: 'lain@x.com' }) : ok()),
    });
    await expect(fire(sandbox)).resolves.toBeUndefined();
    expect(sends(sandbox)).toEqual([]);
    expect(await stored()).toEqual(before);
    expect(sandbox.matchAll).not.toHaveBeenCalled();
  });

  test('/me 401: tidak mengirim dan tidak melempar', async () => {
    await seed(checkEntry('c1'));
    const sandbox = load({
      respond: (url) => (url.endsWith('/me') ? problem(401, { code: 'UNAUTHENTICATED' }) : ok()),
    });
    await expect(fire(sandbox)).resolves.toBeUndefined();
    expect(sends(sandbox)).toEqual([]);
    expect(await storedIds()).toEqual(['c1']);
  });

  test('/me meminta dengan cookie sesi, tanpa cache, dan header Accept JSON', async () => {
    await seed(checkEntry('c1'));
    const sandbox = load();
    await fire(sandbox);
    const [url, init] = sandbox.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/me');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
    expect(init.method ?? 'GET').toBe('GET');
  });

  test.each([
    [403, new Response('', { status: 403 })],
    [404, problem(404, { code: 'NOT_FOUND' })],
  ])('/me %s: selesai tanpa mengirim dan tanpa melempar', async (_status, meResponse) => {
    await seed(checkEntry('c1'));
    const before = await stored();
    const sandbox = load({
      respond: (url) => (url.endsWith('/me') ? meResponse.clone() : ok()),
    });
    await expect(fire(sandbox)).resolves.toBeUndefined();
    expect(sends(sandbox)).toEqual([]);
    expect(await stored()).toEqual(before);
  });

  test.each([
    ['JSON tanpa email', {}],
    ['email bukan string', { email: 42 }],
    ['JSON bukan objek', ['a@x.com']],
  ])('/me 2xx %s: selesai tanpa mengirim dan tanpa melempar', async (_name, body) => {
    await seed(checkEntry('c1'));
    const before = await stored();
    const sandbox = load({ respond: (url) => (url.endsWith('/me') ? ok(body) : ok()) });
    await expect(fire(sandbox)).resolves.toBeUndefined();
    expect(sends(sandbox)).toEqual([]);
    expect(await stored()).toEqual(before);
  });

  test('toko dikosongkan (keluar) lalu sync: tidak ada fetch sama sekali, termasuk /me', async () => {
    await seed(checkEntry('c1'));
    await seed(commentEntry('ko'));
    await clearAllDeviceStores();
    const sandbox = load();
    await expect(fire(sandbox)).resolves.toBeUndefined();
    expect(sandbox.fetch).not.toHaveBeenCalled();
    expect(await stored()).toEqual([]);
  });

  test('/me gagal jaringan atau 503: melempar agar dijadwalkan ulang', async () => {
    await seed(checkEntry('c1'));
    const network = load({
      respond: () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(fire(network)).rejects.toThrow();
    const unavailable = load({
      respond: (url) => (url.endsWith('/me') ? new Response('', { status: 503 }) : ok()),
    });
    await expect(fire(unavailable)).rejects.toThrow();
    const rateLimited = load({
      respond: (url) => (url.endsWith('/me') ? new Response('', { status: 429 }) : ok()),
    });
    await expect(fire(rateLimited)).rejects.toThrow();
    expect(sends(network)).toEqual([]);
    expect(sends(unavailable)).toEqual([]);
    expect(await storedIds()).toEqual(['c1']);
  });

  test('entri pemilik lain tidak disentuh', async () => {
    await seed(checkEntry('milik-lain', { taskId: 'tlain' }), { owner: 'lain@x.com' });
    await seed(checkEntry('milikku', { taskId: 'tku' }));
    const sandbox = load();
    await fire(sandbox);
    expect(sends(sandbox).map(([url]) => url)).toEqual(['/api/v1/handovers/tku/checks']);
    const left = await stored();
    expect(left.map((r) => r.key)).toEqual(['lain@x.com|milik-lain']);
  });

  test('entri rejected tidak dikirim lagi', async () => {
    await seed({ ...checkEntry('ditolak'), state: 'rejected', reason: 'sudah ditolak' } as never);
    const before = await stored();
    const sandbox = load();
    await fire(sandbox);
    expect(sandbox.fetch).not.toHaveBeenCalled();
    expect(await stored()).toEqual(before);
  });
});

describe('pengiriman', () => {
  test('ketiga jenis dikirim berurutan menurut savedAt lalu seq dengan jalur, verba, header, dan badan yang benar', async () => {
    await seed(createEntry('cr', { at: NOW + 3 }));
    await seed(commentEntry('ko', { at: NOW + 2 }));
    await seed(checkEntry('ca', { taskId: 'a/b', at: NOW + 1, text: 'A', index: 4 }), { seq: 2 });
    await seed(checkEntry('cb', { taskId: 'tb', at: NOW + 1, text: 'B', index: 5 }), { seq: 1 });
    const sandbox = load();
    await fire(sandbox);
    const calls = sends(sandbox);
    expect(calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'PUT /api/v1/handovers/tb/checks',
      'PUT /api/v1/handovers/a%2Fb/checks',
      'POST /api/v1/handovers/t2/comments',
      'POST /api/v1/handovers/batch',
    ]);
    for (const [, init] of calls) {
      expect(init.credentials).toBe('same-origin');
      expect(init.cache).toBe('no-store');
      expect(init.headers).toEqual({
        Accept: 'application/json',
        'X-Requested-With': 'qc',
        'Content-Type': 'application/json',
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    const bodies = calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies[0]).toEqual({ locationId: 'loc-a', index: 5, text: 'B', checked: true });
    expect(bodies[1]).toEqual({ locationId: 'loc-a', index: 4, text: 'A', checked: true });
    expect(bodies[2]).toEqual({
      locationId: 'loc-a',
      quote: 'kutipan',
      before: 'sebelum',
      after: 'sesudah',
      body: 'isi komentar',
      clientId: CLIENT_A,
    });
    expect(bodies[3]).toEqual({
      locationId: 'loc-a',
      tasks: [{ customerName: 'PT A', note: 'catatan A', clientId: CLIENT_B }],
    });
  });

  test('sukses menghapus rekaman dan menyiarkan changed, sending, sending-done (check tanpa sending)', async () => {
    await seed(checkEntry('c1'));
    const onlyCheck = load();
    await fire(onlyCheck);
    expect(await storedIds()).toEqual([]);
    expect(onlyCheck.posted.map((m) => m.type)).toEqual(['changed']);
    expect(onlyCheck.channels).toEqual(['qc-outbox']);

    await seed(commentEntry('ko', { at: NOW + 1 }));
    await seed(createEntry('cr', { at: NOW + 2 }));
    const both = load();
    await fire(both);
    expect(await storedIds()).toEqual([]);
    expect(both.posted.map((m) => m.type)).toEqual([
      'sending',
      'changed',
      'sending-done',
      'sending',
      'changed',
      'sending-done',
    ]);
    expect(both.posted[0]).toMatchObject({ type: 'sending', ids: ['ko'] });
    expect((both.posted[0]?.until as number) - Date.now()).toBeGreaterThan(40_000);
    expect((both.posted[0]?.until as number) - Date.now()).toBeLessThanOrEqual(45_000);
    expect(both.posted[2]).toEqual({ type: 'sending-done', ids: ['ko'] });
  });

  test('penolakan menandai rejected dengan reason dan TIDAK menghapus', async () => {
    await seed(commentEntry('ko', { at: NOW + 1 }), { seq: 7 });
    await seed(createEntry('cr', { at: NOW + 2 }));
    const sandbox = load({
      respond: (url) => {
        if (url.endsWith('/me')) return ok({ email: OWNER });
        if (url.endsWith('/comments')) {
          return problem(409, { code: 'CONFLICT', detail: 'Task sudah dibatalkan' });
        }
        return problem(422, {
          code: 'VALIDATION',
          title: 'Input tidak valid',
          fields: { 'tasks.0.note': 'Catatan wajib diisi', x: 'Catatan wajib diisi' },
        });
      },
    });
    await fire(sandbox);
    const left = await stored();
    expect(left).toHaveLength(2);
    const byId = Object.fromEntries(
      left.map((r) => [(r.entry as { id: string }).id, r as DeviceRecord]),
    );
    expect(byId.ko?.entry).toMatchObject({
      kind: 'comment',
      state: 'rejected',
      reason: 'Task sudah dibatalkan',
      body: 'isi komentar',
      clientId: CLIENT_A,
    });
    expect(byId.ko).toMatchObject({ savedAt: NOW + 1, seq: 7, owner: OWNER, v: 1 });
    expect(byId.cr?.entry).toMatchObject({
      state: 'rejected',
      reason: 'Input tidak valid: Catatan wajib diisi',
    });
    // Penolakan tidak menghentikan putaran: kedua entri dicoba.
    expect(sends(sandbox)).toHaveLength(2);
    expect(sandbox.posted.filter((m) => m.type === 'changed')).toHaveLength(2);
  });

  test('kedaluwarsa menandai rejected', async () => {
    await seed(commentEntry('lama', { at: NOW - 24 * 60 * 60 * 1000 - 1000 }));
    await seed(checkEntry('masa-depan', { at: NOW + 5 * 60 * 1000 + 60_000 }));
    await seed(createEntry('segar', { at: NOW }));
    const sandbox = load();
    await fire(sandbox);
    expect(sends(sandbox).map(([url]) => url)).toEqual(['/api/v1/handovers/batch']);
    const left = await stored();
    expect(left.map((r) => (r.entry as { id: string }).id).sort()).toEqual(['lama', 'masa-depan']);
    for (const record of left) {
      expect(record.entry).toMatchObject({ state: 'rejected' });
      expect((record.entry as { reason: string }).reason).toMatch(/^Kedaluwarsa/);
    }
  });

  test.each([
    ['UNAVAILABLE', () => new Response('', { status: 503 })],
    ['INTERNAL', () => new Response('<html>502</html>', { status: 502 })],
  ])('%s menghentikan putaran, entri tetap, melempar setelah pemberitahuan', async (_name, bad) => {
    await seed(checkEntry('c1', { taskId: 'ok1', at: NOW + 1 }));
    await seed(commentEntry('ko', { at: NOW + 2 }));
    await seed(createEntry('cr', { at: NOW + 3 }));
    const sandbox = load({
      respond: (url) => {
        if (url.endsWith('/me')) return ok({ email: OWNER });
        return url.endsWith('/comments') ? bad() : ok();
      },
    });
    await expect(fire(sandbox)).rejects.toThrow();
    // Yang pertama sudah terkirim; yang gagal dan yang sesudahnya tetap utuh dan tak ditandai.
    expect(await storedIds()).toEqual(['cr', 'ko']);
    for (const record of await stored()) expect(record.entry).not.toHaveProperty('state');
    expect(sends(sandbox)).toHaveLength(2);
    // Pemberitahuan terkirim SEBELUM galat dilempar.
    expect(sandbox.windows[0]?.postMessage).toHaveBeenCalledWith({
      type: 'qc-outbox-synced',
      taskIds: ['ok1'],
      created: false,
      rejected: 0,
    });
    expect(sandbox.posted.at(-1)).toEqual({ type: 'sending-done', ids: ['ko'] });
  });

  test('UNAUTHENTICATED menghentikan tanpa melempar', async () => {
    await seed(checkEntry('c1', { at: NOW + 1 }));
    await seed(commentEntry('ko', { at: NOW + 2 }));
    const sandbox = load({
      respond: (url) => {
        if (url.endsWith('/me')) return ok({ email: OWNER });
        return new Response('', { status: 401 });
      },
    });
    await expect(fire(sandbox)).resolves.toBeUndefined();
    expect(sends(sandbox)).toHaveLength(1);
    expect(await storedIds()).toEqual(['c1', 'ko']);
    for (const record of await stored()) expect(record.entry).not.toHaveProperty('state');
  });

  test('batas 30 dtk memetakan ke UNAVAILABLE (timer palsu)', async () => {
    await seed(checkEntry('c1'));
    const sandbox = load({
      respond: (url, init) => {
        if (url.endsWith('/me')) return ok({ email: OWNER });
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      },
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = fire(sandbox);
    const outcome = expect(pending).rejects.toThrow();
    for (let i = 0; i < 200 && sends(sandbox).length === 0; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(sends(sandbox)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    await outcome;
    vi.useRealTimers();
    expect(await storedIds()).toEqual(['c1']);
    expect((await stored())[0]?.entry).not.toHaveProperty('state');
  });
});

describe('pemberitahuan dan kejar-kejaran', () => {
  test('jendela terbuka menerima qc-outbox-synced dengan taskIds, created, rejected', async () => {
    await seed(checkEntry('c1', { taskId: 't1', at: NOW + 1 }));
    await seed(commentEntry('k1', { taskId: 't2', at: NOW + 2 }));
    await seed(commentEntry('k2', { taskId: 't3', at: NOW + 3, clientId: CLIENT_B }));
    await seed(createEntry('cr', { at: NOW + 4 }));
    const sandbox = load({
      windowCount: 2,
      respond: (url) => {
        if (url.endsWith('/me')) return ok({ email: OWNER });
        if (url.includes('/t3/comments')) {
          return problem(409, { code: 'CONFLICT', detail: 'Task sudah selesai' });
        }
        return ok();
      },
    });
    await fire(sandbox);
    expect(sandbox.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    for (const win of sandbox.windows) {
      expect(win.postMessage).toHaveBeenCalledTimes(1);
      expect(win.postMessage).toHaveBeenCalledWith({
        type: 'qc-outbox-synced',
        taskIds: ['t1', 't2'],
        created: true,
        rejected: 1,
      });
    }
  });

  test('galat siaran dan postMessage ditelan', async () => {
    await seed(checkEntry('c1'));
    const sandbox = load();
    sandbox.windows[0]?.postMessage.mockImplementation(() => {
      throw new Error('jendela mati');
    });
    sandbox.matchAll.mockRejectedValueOnce(new Error('clients gagal'));
    await expect(fire(sandbox)).resolves.toBeUndefined();
    expect(await storedIds()).toEqual([]);
  });

  test('rekaman yang dihapus halaman di tengah putaran dilewati', async () => {
    await seed(commentEntry('ko', { taskId: 'pertama', at: NOW + 1 }));
    await seed(commentEntry('kedua', { taskId: 'kedua', at: NOW + 2, clientId: CLIENT_B }));
    const sandbox = load({
      respond: async (url) => {
        if (url.endsWith('/me')) return ok({ email: OWNER });
        // Halaman membuang entri kedua selagi entri pertama dikirim.
        await deleteOutboxRecords([`${OWNER}|kedua`]);
        return ok();
      },
    });
    await fire(sandbox);
    expect(sends(sandbox).map(([url]) => url)).toEqual(['/api/v1/handovers/pertama/comments']);
    expect(await storedIds()).toEqual([]);
  });

  test('reason non-string dari server tetap menghasilkan rekaman yang lolos isOutboxEntry', async () => {
    for (const body of [
      { code: 'CONFLICT', detail: 123 },
      { code: 'CONFLICT', detail: { a: 1 } },
      { code: 'CONFLICT', detail: null, title: 9 },
      { code: 'VALIDATION', detail: 'Tak valid', fields: { a: 5, b: null } },
    ]) {
      resetOutboxEnv();
      await seed(commentEntry('ko'));
      const sandbox = load({
        respond: (url) => (url.endsWith('/me') ? ok({ email: OWNER }) : problem(409, body)),
      });
      await fire(sandbox);
      const [record] = await stored();
      expect(record?.entry).toMatchObject({ state: 'rejected' });
      expect(typeof (record?.entry as { reason: unknown } | undefined)?.reason).toBe('string');
      expect(isOutboxEntry(record?.entry)).toBe(true);
    }
  });

  test('halaman membuang rekaman antara kirim dan penandaan: markRejected tidak menghidupkannya', async () => {
    await seed(checkEntry('lama'));
    const sandbox = load({
      respond: async (url) => {
        if (url.endsWith('/me')) return ok({ email: OWNER });
        await deleteOutboxRecords([`${OWNER}|lama`]);
        return problem(409, { code: 'CONFLICT', detail: 'Ditolak' });
      },
    });
    await fire(sandbox);
    expect(await stored()).toEqual([]);
  });

  test('halaman mengganti centang antara kirim dan penandaan: pengganti tidak ditimpa dan tidak ditandai', async () => {
    await seed(checkEntry('lama', { text: 'lama' }));
    const sandbox = load({
      respond: async (url) => {
        if (url.endsWith('/me')) return ok({ email: OWNER });
        // Seperti `enqueueOutbox`: rekaman lama diganti rekaman baru berkunci lain.
        await deleteOutboxRecords([`${OWNER}|lama`]);
        await seed(checkEntry('baru', { text: 'baru', at: NOW + 10 }));
        return problem(409, { code: 'CONFLICT', detail: 'Ditolak' });
      },
    });
    await fire(sandbox);
    const left = await stored();
    expect(left.map((r) => r.key)).toEqual([`${OWNER}|baru`]);
    expect(left[0]?.entry).toMatchObject({ id: 'baru', text: 'baru' });
    expect(left[0]?.entry).not.toHaveProperty('state');
  });

  test('pengait uji menerima konstanta bersama', () => {
    const sandbox = load();
    expect(sandbox.hook).toHaveBeenCalledTimes(1);
    const [arg] = sandbox.hook.mock.calls[0] as [{ constants: Record<string, unknown> }];
    const { constants } = arg;
    expect(Object.keys(constants).sort()).toEqual(
      [
        'API_BASE',
        'CHANNEL',
        'DB_NAME',
        'ERROR_CODES',
        'FLUSH_LOCK',
        'KINDS',
        'MAX_AGE_MS',
        'MAX_FUTURE_SKEW_MS',
        'RECORD_VERSION',
        'SEND_TIMEOUT_MS',
        'SENDING_TTL_MS',
        'STORE',
        'TAG',
      ].sort(),
    );
  });
});
