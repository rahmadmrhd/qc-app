import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ERROR_CODES } from '@shared/contract';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { OUTBOX_FLUSH_LOCK, startOutboxSync } from '@/app/outbox-sync';
import { API_BASE } from '@/lib/api/client';
import { DEVICE_DB_NAME, readOutboxRecords } from '@/lib/device-db';
import { ANONYMOUS_SESSION, initSession } from '@/modules/auth/session';
import { resetOutboxEnv } from '@/test/outbox-env';
import {
  enqueueOutbox,
  isOutboxEntry,
  OUTBOX_ENTRY_KINDS,
  OUTBOX_MAX_AGE_MS,
  OUTBOX_MAX_FUTURE_SKEW_MS,
  OUTBOX_RECORD_VERSION,
  type OutboxEntry,
} from './outbox';
import { OUTBOX_CHANNEL_NAME } from './outbox-channel';
import {
  flushOutbox,
  OUTBOX_SEND_TIMEOUT_MS,
  resetFlushForTests,
  sendOutboxEntry,
} from './outbox-flush';
import { SENDING_TTL_MS } from './outbox-status';

/*
 * Kesetaraan penguras halaman (`outbox-flush.ts` + `lib/api/client.ts`) dan `public/sync-sw.js`. Logika service worker
 * sengaja duplikat (skrip klasik tak dapat mengimpor modul); tes ini yang menjaganya tak menyimpang: konstanta,
 * bentuk permintaan, klasifikasi galat, dan teks alasan penolakan.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const SOURCE = readFileSync(resolve(process.cwd(), 'public', 'sync-sw.js'), 'utf8');
const OWNER = 'a@x.com';
const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_B = '22222222-2222-4222-8222-222222222222';

type Kind = OutboxEntry['kind'];
type Responder = (url: string, init: RequestInit) => Response | Promise<Response>;

// --- SW: sandbox minimal ---------------------------------------------------------------------------------------
interface Sandbox {
  handlers: Map<string, (event: unknown) => void>;
  fetch: ReturnType<typeof vi.fn>;
}

interface Locks {
  request: (name: string, callback: (lock: unknown) => Promise<unknown>) => Promise<unknown>;
}

function load(
  respond: Responder,
  options: { locks?: Locks; hook?: (arg: { constants: Record<string, unknown> }) => void } = {},
): Sandbox {
  const handlers = new Map<string, (event: unknown) => void>();
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => respond(url, init));
  class FakeChannel {
    postMessage() {}
    close() {}
  }
  const locks: Locks = options.locks ?? {
    request: (_name, callback) => callback({}),
  };
  const self = {
    location: { origin: 'https://qc.test' },
    indexedDB: globalThis.indexedDB,
    fetch: fetchMock,
    navigator: { locks },
    BroadcastChannel: FakeChannel,
    clients: { matchAll: vi.fn(async () => []) },
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      handlers.set(type, handler),
    __qcSyncTest: options.hook,
  };
  new Function('self', SOURCE)(self);
  return { handlers, fetch: fetchMock };
}

function fire(sandbox: Sandbox): Promise<unknown> {
  let pending: Promise<unknown> | undefined;
  sandbox.handlers.get('sync')?.({
    tag: 'qc-outbox',
    waitUntil: (promise: Promise<unknown>) => {
      pending = promise;
    },
  });
  return pending ?? Promise.resolve();
}

/** Mengembalikan apakah service worker melempar (= meminta peramban menjadwalkan ulang). */
async function swThrew(sandbox: Sandbox): Promise<boolean> {
  try {
    await fire(sandbox);
    return false;
  } catch {
    return true;
  }
}

// --- Data uji --------------------------------------------------------------------------------------------------
const entries: Record<Kind, () => OutboxEntry> = {
  check: () => ({
    kind: 'check',
    id: 'e-check',
    taskId: 'tugas/1',
    locationId: 'loc-a',
    index: 3,
    text: 'B3 = 1',
    checked: true,
    at: Date.now(),
  }),
  comment: () => ({
    kind: 'comment',
    id: 'e-comment',
    clientId: CLIENT_A,
    taskId: 't2',
    locationId: 'loc-a',
    quote: 'kutipan',
    before: 'sebelum',
    after: 'sesudah',
    body: 'isi komentar',
    at: Date.now(),
  }),
  create: () => ({
    kind: 'create',
    id: 'e-create',
    locationId: 'loc-a',
    tasks: [
      { clientId: CLIENT_B, customerName: 'PT A', note: 'catatan A' },
      { clientId: CLIENT_A, customerName: 'PT B', note: 'catatan B' },
    ],
    at: Date.now(),
  }),
};
const ALL_KINDS: Kind[] = ['check', 'comment', 'create'];

const jsonBody = (status: number, body: unknown, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
const problem = (status: number, body: Record<string, unknown>) =>
  jsonBody(status, body, 'application/problem+json');

interface Scenario {
  name: string;
  respond: Response | 'network-error' | 'abort';
  kinds: Kind[];
  expectEntry: 'removed' | 'rejected' | 'unchanged';
  expectReason?: string;
  swThrows: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'sukses 200',
    respond: jsonBody(200, {}),
    kinds: ALL_KINDS,
    expectEntry: 'removed',
    swThrows: false,
  },
  {
    name: 'sukses 201',
    respond: jsonBody(201, { id: 'x' }),
    kinds: ALL_KINDS,
    expectEntry: 'removed',
    swThrows: false,
  },
  {
    name: 'sukses 200 badan kosong',
    respond: new Response('', { status: 200 }),
    kinds: ALL_KINDS,
    expectEntry: 'removed',
    swThrows: false,
  },
  {
    name: 'CONFLICT dengan detail',
    respond: problem(409, { code: 'CONFLICT', detail: 'Task sudah selesai' }),
    kinds: ALL_KINDS,
    expectEntry: 'rejected',
    expectReason: 'Task sudah selesai',
    swThrows: false,
  },
  {
    name: 'FORBIDDEN problem+json',
    respond: problem(403, { code: 'FORBIDDEN', title: 'Tidak boleh' }),
    kinds: ALL_KINDS,
    expectEntry: 'rejected',
    expectReason: 'Tidak boleh',
    swThrows: false,
  },
  {
    name: 'NOT_FOUND problem+json tanpa detail dan title',
    respond: problem(404, { code: 'NOT_FOUND' }),
    kinds: ALL_KINDS,
    expectEntry: 'rejected',
    expectReason: 'Terjadi kesalahan pada server',
    swThrows: false,
  },
  {
    name: 'VALIDATION dengan fields',
    respond: problem(422, {
      code: 'VALIDATION',
      detail: 'Input tidak valid',
      fields: {
        note: 'Catatan wajib diisi',
        ulang: 'Catatan wajib diisi',
        sama: 'Input tidak valid',
        kosong: '',
      },
    }),
    kinds: ALL_KINDS,
    expectEntry: 'rejected',
    expectReason: 'Input tidak valid: Catatan wajib diisi',
    swThrows: false,
  },
  {
    name: '412 problem+json menjadi CONFLICT',
    respond: problem(412, { code: 'INTERNAL', detail: 'Data sudah berubah' }),
    kinds: ALL_KINDS,
    expectEntry: 'rejected',
    expectReason: 'Data sudah berubah',
    swThrows: false,
  },
  {
    name: '401 polos',
    respond: new Response('', { status: 401 }),
    kinds: ALL_KINDS,
    expectEntry: 'unchanged',
    swThrows: false,
  },
  {
    name: '401 problem+json UNAUTHENTICATED',
    respond: problem(401, { code: 'UNAUTHENTICATED', detail: 'Sesi berakhir' }),
    kinds: ALL_KINDS,
    expectEntry: 'unchanged',
    swThrows: false,
  },
  {
    name: '403 polos',
    respond: new Response('', { status: 403 }),
    kinds: ALL_KINDS,
    expectEntry: 'rejected',
    expectReason: 'Permintaan ditolak',
    swThrows: false,
  },
  {
    name: '413 polos',
    respond: new Response('', { status: 413 }),
    kinds: ALL_KINDS,
    expectEntry: 'rejected',
    expectReason: 'Badan permintaan terlalu besar',
    swThrows: false,
  },
  {
    name: '429',
    respond: new Response('', { status: 429 }),
    kinds: ALL_KINDS,
    expectEntry: 'unchanged',
    swThrows: true,
  },
  {
    name: '503',
    respond: new Response('', { status: 503 }),
    kinds: ALL_KINDS,
    expectEntry: 'unchanged',
    swThrows: true,
  },
  {
    name: 'problem+json UNAVAILABLE',
    respond: problem(500, { code: 'UNAVAILABLE', detail: 'Basis data tak terjangkau' }),
    kinds: ALL_KINDS,
    expectEntry: 'unchanged',
    swThrows: true,
  },
  {
    name: '500 polos',
    respond: new Response('boom', { status: 500 }),
    kinds: ALL_KINDS,
    expectEntry: 'unchanged',
    swThrows: true,
  },
  {
    name: 'problem+json INTERNAL',
    respond: problem(500, { code: 'INTERNAL', detail: 'Galat', requestId: 'r1' }),
    kinds: ALL_KINDS,
    expectEntry: 'unchanged',
    swThrows: true,
  },
  {
    name: '502 HTML',
    respond: new Response('<html>Bad Gateway</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }),
    kinds: ALL_KINDS,
    expectEntry: 'unchanged',
    swThrows: true,
  },
  {
    name: '200 bukan JSON',
    respond: new Response('<html>portal</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
    kinds: ALL_KINDS,
    expectEntry: 'unchanged',
    swThrows: true,
  },
  {
    name: 'fetch melempar',
    respond: 'network-error',
    kinds: ALL_KINDS,
    expectEntry: 'unchanged',
    swThrows: true,
  },
  { name: 'abort', respond: 'abort', kinds: ALL_KINDS, expectEntry: 'unchanged', swThrows: true },
];

/** Penjawab untuk `/me` (pemilik sah) dan satu skenario untuk pengiriman. */
function responderFor(respond: Scenario['respond']): Responder {
  return (url) => {
    if (url.endsWith('/api/v1/me')) return jsonBody(200, { email: OWNER });
    if (respond === 'network-error') throw new TypeError('Failed to fetch');
    if (respond === 'abort') throw new DOMException('Aborted', 'AbortError');
    return respond.clone();
  };
}

async function seed(kind: Kind): Promise<void> {
  expect(await enqueueOutbox(OWNER, entries[kind]())).toBe('ok');
}

type Final = { state: 'removed' } | { state: 'rejected'; reason: string } | { state: 'unchanged' };

async function finalOf(): Promise<Final> {
  const records = (await readOutboxRecords()) ?? [];
  if (records.length === 0) return { state: 'removed' };
  const entry = records[0]?.entry as { state?: string; reason?: string };
  if (entry.state === 'rejected') return { state: 'rejected', reason: String(entry.reason) };
  return { state: 'unchanged' };
}

interface PageRun {
  final: Final;
  held: boolean;
  calls: Array<[string, RequestInit]>;
}

/** Menjalankan penguras HALAMAN terhadap toko yang baru diisi satu entri. */
async function runPage(kind: Kind, respond: Responder): Promise<PageRun> {
  resetOutboxEnv();
  resetFlushForTests();
  await seed(kind);
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => respond(url, init));
  vi.stubGlobal('fetch', fetchMock);
  try {
    const result = await flushOutbox({
      owner: OWNER,
      now: () => Date.now(),
      send: sendOutboxEntry,
      isOwnerActive: () => true,
    });
    const stored = await finalOf();
    // Halaman MEMBUANG entri yang ditolak dan mengumumkannya lewat `result.rejected`; SW menandainya `rejected`.
    const final: Final =
      stored.state === 'removed' && result.rejected.length === 1
        ? { state: 'rejected', reason: String(result.rejected[0]?.reason) }
        : stored;
    return {
      final,
      held: result.stoppedBy === 'unavailable' || result.stoppedBy === 'server-error',
      calls: fetchMock.mock.calls as Array<[string, RequestInit]>,
    };
  } finally {
    vi.unstubAllGlobals();
  }
}

interface SwRun {
  final: Final;
  threw: boolean;
  calls: Array<[string, RequestInit]>;
}

/** Menjalankan peristiwa `sync` service worker terhadap toko yang baru diisi satu entri. */
async function runSw(kind: Kind, respond: Responder): Promise<SwRun> {
  resetOutboxEnv();
  resetFlushForTests();
  await seed(kind);
  const sandbox = load(respond);
  const threw = await swThrew(sandbox);
  const calls = (sandbox.fetch.mock.calls as Array<[string, RequestInit]>).filter(
    ([url]) => !url.endsWith('/api/v1/me'),
  );
  return { final: await finalOf(), threw, calls };
}

beforeEach(() => {
  resetOutboxEnv();
  resetFlushForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  initSession(ANONYMOUS_SESSION);
});

describe('konstanta', () => {
  test('konstanta sama', () => {
    let captured: Record<string, unknown> | undefined;
    load(responderFor(jsonBody(200, {})), {
      hook: ({ constants }) => {
        captured = constants;
      },
    });
    expect(captured).toEqual({
      DB_NAME: DEVICE_DB_NAME,
      STORE: 'outbox',
      RECORD_VERSION: OUTBOX_RECORD_VERSION,
      KINDS: [...OUTBOX_ENTRY_KINDS],
      MAX_AGE_MS: OUTBOX_MAX_AGE_MS,
      MAX_FUTURE_SKEW_MS: OUTBOX_MAX_FUTURE_SKEW_MS,
      SEND_TIMEOUT_MS: OUTBOX_SEND_TIMEOUT_MS,
      FLUSH_LOCK: OUTBOX_FLUSH_LOCK,
      CHANNEL: OUTBOX_CHANNEL_NAME,
      SENDING_TTL_MS,
      API_BASE,
      ERROR_CODES: [...ERROR_CODES],
      TAG: 'qc-outbox',
    });
  });
});

describe('permintaan', () => {
  test.each(ALL_KINDS)(
    'permintaan sama untuk entri %s: URL, verba, header, dan badan',
    async (kind) => {
      const respond = responderFor(jsonBody(200, {}));
      const page = await runPage(kind, respond);
      const sw = await runSw(kind, respond);
      expect(page.calls).toHaveLength(1);
      expect(sw.calls).toHaveLength(1);
      const [pageUrl, pageInit] = page.calls[0] as [string, RequestInit];
      const [swUrl, swInit] = sw.calls[0] as [string, RequestInit];
      expect(swUrl).toBe(pageUrl);
      expect(swInit.method).toBe(pageInit.method);
      expect(swInit.headers).toEqual(pageInit.headers);
      expect(swInit.body).toBe(pageInit.body);
      expect(swInit.credentials).toBe(pageInit.credentials);
      expect(swInit.cache).toBe(pageInit.cache);
      expect(swInit.signal).toBeInstanceOf(AbortSignal);
      expect(pageInit.signal).toBeInstanceOf(AbortSignal);
      expect(pageInit.headers).toMatchObject({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'qc',
      });
    },
  );
});

describe('skenario respons: keadaan akhir sama', () => {
  for (const scenario of SCENARIOS) {
    for (const kind of scenario.kinds) {
      test(`${scenario.name} (${kind})`, async () => {
        const respond = responderFor(scenario.respond);
        const page = await runPage(kind, respond);
        const sw = await runSw(kind, respond);

        expect(page.final.state).toBe(scenario.expectEntry);
        expect(sw.final.state).toBe(scenario.expectEntry);
        if (scenario.expectEntry === 'rejected') {
          expect(page.final).toEqual({ state: 'rejected', reason: scenario.expectReason });
          expect(sw.final).toEqual({ state: 'rejected', reason: scenario.expectReason });
        }
        // Halaman menahan (UNAVAILABLE/INTERNAL) tepat saat service worker melempar.
        expect(page.held).toBe(scenario.swThrows);
        expect(sw.threw).toBe(scenario.swThrows);
        // Keduanya mengirim tepat satu permintaan ke jalur yang sama.
        expect(sw.calls.map(([url]) => url)).toEqual(page.calls.map(([url]) => url));
      });
    }
  }
});

describe('siklus penuh', () => {
  test('rekaman ditandai SW lolos isOutboxEntry dan diumumkan halaman', async () => {
    await seed('comment');
    const sandbox = load(
      responderFor(problem(409, { code: 'CONFLICT', detail: 'Task sudah dibatalkan' })),
    );
    await fire(sandbox);
    const marked = (await readOutboxRecords()) ?? [];
    expect(marked).toHaveLength(1);
    expect(isOutboxEntry(marked[0]?.entry)).toBe(true);
    expect(marked[0]?.entry).toMatchObject({ state: 'rejected', reason: 'Task sudah dibatalkan' });

    const send = vi.fn();
    const result = await flushOutbox({
      owner: OWNER,
      now: () => Date.now(),
      send,
      isOwnerActive: () => true,
    });
    expect(send).not.toHaveBeenCalled();
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      entry: { kind: 'comment', id: 'e-comment' },
      reason: 'Task sudah dibatalkan',
    });
    expect(await readOutboxRecords()).toEqual([]);
  });
});

describe('kirim ganda', () => {
  /** Kunci Web Locks palsu yang benar-benar menserialkan (satu pemegang pada satu waktu). */
  function makeMutex(): Locks {
    let tail: Promise<unknown> = Promise.resolve();
    return {
      request: (name, callback) => {
        const run = tail.then(() => callback({ name }));
        tail = run.catch(() => undefined);
        return run;
      },
    };
  }

  test.each([
    ['halaman lebih dulu', true],
    ['service worker lebih dulu', false],
  ])(
    'kirim ganda dicegah: %s; satu komentar hanya memicu SATU fetch ke jalur komentar',
    async (_name, pageFirst) => {
      const locks = makeMutex();
      initSession({ ...ANONYMOUS_SESSION, authenticated: true, email: OWNER });
      vi.stubGlobal('navigator', { ...navigator, locks });
      await seed('comment');

      const comments: string[] = [];
      const respond: Responder = async (url) => {
        if (url.endsWith('/api/v1/me')) return jsonBody(200, { email: OWNER });
        comments.push(url);
        // Pengiriman lambat: yang kedua harus menunggu kuncinya, bukan mengirim bersamaan.
        await new Promise((resolve) => setTimeout(resolve, 40));
        return jsonBody(201, {});
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit) => respond(url, init)),
      );
      const sandbox = load(respond, { locks });

      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let stop: (() => void) | undefined;
      let swDone: Promise<unknown> = Promise.resolve();
      if (pageFirst) {
        stop = startOutboxSync(client);
        swDone = fire(sandbox);
      } else {
        swDone = fire(sandbox);
        stop = startOutboxSync(client);
      }
      try {
        await swDone;
        await vi.waitFor(async () => expect(await readOutboxRecords()).toEqual([]), {
          timeout: 3000,
        });
        // Beri kesempatan putaran kedua (yang bergiliran) selesai membaca toko yang sudah kosong.
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(comments.filter((url) => url.endsWith('/comments'))).toHaveLength(1);
      } finally {
        stop?.();
      }
    },
  );
});
