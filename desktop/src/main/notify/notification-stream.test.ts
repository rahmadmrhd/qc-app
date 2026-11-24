import { describe, expect, test } from 'vitest';
import type { StreamNotice } from './notice';
import { createNotificationStream, STREAM_PATH } from './notification-stream';

const enc = new TextEncoder();

function frame(id: string, extra: Record<string, unknown> = {}): string {
  const data = {
    id,
    title: `Judul ${id}`,
    body: 'Isi',
    url: '/handover/h1',
    tag: 'h1',
    createdAt: '2026-11-16T03:00:00.000Z',
    ...extra,
  };
  return `id: 2026-11-16T03:00:00.000Z|${id}\nevent: notification\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Peniru perilaku fetch nyata: `abort()` pada sinyal membuat pembacaan aliran gagal. */
const errorers = new WeakMap<Response, () => void>();

/** Respons stream yang dikendalikan tes: `send` mengirim potongan, `end` menutup. */
function controlledResponse(status = 200) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const response = new Response(status === 200 ? body : null, { status });
  errorers.set(response, () => {
    try {
      controller.error(new Error('dibatalkan'));
    } catch {
      // Sudah ditutup.
    }
  });
  return {
    response,
    send: (text: string) => controller.enqueue(enc.encode(text)),
    end: () => controller.close(),
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('waktu habis menunggu kondisi');
    await wait(5);
  }
}

interface Call {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal | null | undefined;
}

function setup(options: { token?: string | null; responses: Array<() => Response> }) {
  const calls: Call[] = [];
  const notices: StreamNotice[] = [];
  const unauthorized: string[] = [];
  const signedOut: string[] = [];
  let token: string | null = options.token === undefined ? 'tok' : options.token;
  let index = 0;
  const stream = createNotificationStream({
    serverUrl: () => 'https://qc.test',
    token: () => token,
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        headers: init?.headers as Record<string, string>,
        signal: init?.signal,
      });
      const make = options.responses[Math.min(index, options.responses.length - 1)];
      index += 1;
      if (!make) throw new Error('tanpa respons');
      const response = make();
      init?.signal?.addEventListener('abort', () => errorers.get(response)?.());
      return response;
    }) as typeof fetch,
    onNotice: (n) => notices.push(n),
    onUnauthorized: (t) => unauthorized.push(t),
    onSignedOut: () => signedOut.push('x'),
    retryMinMs: 10,
    retryMaxMs: 40,
    idleTimeoutMs: 200,
  });
  return {
    stream,
    calls,
    notices,
    unauthorized,
    signedOut,
    setToken: (t: string | null) => (token = t),
  };
}

describe('createNotificationStream', () => {
  test('tanpa token tidak membuka koneksi', async () => {
    const { stream, calls } = setup({ token: null, responses: [] });
    stream.start();
    await wait(30);
    expect(calls).toHaveLength(0);
    expect(stream.isRunning()).toBe(false);
  });

  test('membuka dengan Bearer, meneruskan notifikasi sah, melewati bingkai rusak dan ready', async () => {
    const live = controlledResponse();
    const { stream, calls, notices } = setup({ responses: [() => live.response] });
    stream.start();
    await until(() => calls.length === 1);
    expect(calls[0]?.url).toBe(`https://qc.test${STREAM_PATH}`);
    expect(calls[0]?.headers.authorization).toBe('Bearer tok');
    expect(calls[0]?.headers['last-event-id']).toBeUndefined();
    live.send('retry: 3000\nevent: ready\ndata: {}\n\n');
    live.send(': ping\n\n');
    live.send('event: notification\ndata: bukan json\n\n');
    live.send(frame('n1'));
    live.send(frame('n2', { url: 'https://evil.com' })); // tautan asing ditolak
    live.send(frame('n3'));
    await until(() => notices.length === 2);
    expect(notices.map((n) => n.id)).toEqual(['n1', 'n3']);
    stream.stop();
  });

  test('putus lalu sambung ulang membawa Last-Event-ID terakhir', async () => {
    const first = controlledResponse();
    const second = controlledResponse();
    const { stream, calls, notices } = setup({
      responses: [() => first.response, () => second.response],
    });
    stream.start();
    await until(() => calls.length === 1);
    first.send(frame('n1'));
    await until(() => notices.length === 1);
    first.end();
    await until(() => calls.length === 2);
    expect(calls[1]?.headers['last-event-id']).toBe('2026-11-16T03:00:00.000Z|n1');
    stream.stop();
  });

  test('401: berhenti, melapor dengan token yang dipakai, dan tidak mencoba lagi', async () => {
    const { stream, calls, unauthorized } = setup({
      responses: [() => new Response(null, { status: 401 })],
    });
    stream.start();
    await until(() => unauthorized.length === 1);
    expect(unauthorized).toEqual(['tok']);
    await wait(60);
    expect(calls).toHaveLength(1);
    expect(stream.isRunning()).toBe(false);
  });

  test('galat jaringan dan 5xx dicoba lagi dengan jeda', async () => {
    const live = controlledResponse();
    const { stream, calls, notices } = setup({
      responses: [
        () => {
          throw new Error('jaringan putus');
        },
        () => new Response(null, { status: 503 }),
        () => live.response,
      ],
    });
    stream.start();
    await until(() => calls.length === 3);
    live.send(frame('n1'));
    await until(() => notices.length === 1);
    stream.stop();
  });

  test('stop membatalkan permintaan yang berjalan dan sambung ulang yang tertunda', async () => {
    const live = controlledResponse();
    const { stream, calls } = setup({ responses: [() => live.response] });
    stream.start();
    await until(() => calls.length === 1);
    stream.stop();
    expect(calls[0]?.signal?.aborted).toBe(true);
    await wait(80);
    expect(calls).toHaveLength(1);
    expect(stream.isRunning()).toBe(false);
  });

  test('tanpa byte melewati batas idle: koneksi basi dibatalkan dan disambung ulang', async () => {
    const silent = controlledResponse();
    const next = controlledResponse();
    const { stream, calls } = setup({ responses: [() => silent.response, () => next.response] });
    stream.start();
    await until(() => calls.length === 1);
    await until(() => calls.length === 2, 3000);
    expect(calls[0]?.signal?.aborted).toBe(true);
    stream.stop();
  });

  test('start berulang tidak membuka koneksi ganda; start setelah stop berjalan lagi', async () => {
    const a = controlledResponse();
    const b = controlledResponse();
    const { stream, calls } = setup({ responses: [() => a.response, () => b.response] });
    stream.start();
    stream.start();
    await until(() => calls.length === 1);
    await wait(30);
    expect(calls).toHaveLength(1);
    stream.stop();
    stream.start();
    await until(() => calls.length === 2);
    stream.stop();
  });

  test('token dihapus saat menunggu sambung ulang: berhenti', async () => {
    const first = controlledResponse();
    const { stream, calls, setToken, signedOut } = setup({ responses: [() => first.response] });
    stream.start();
    await until(() => calls.length === 1);
    setToken(null);
    first.end();
    await until(() => !stream.isRunning());
    expect(calls).toHaveLength(1);
    // Pemanggil diberi tahu (menyegarkan status login/tray) walau token hilang tanpa 401.
    expect(signedOut).toHaveLength(1);
  });

  test('token berubah (ganti akun tanpa keluar): koneksi lama diputus, koneksi baru memakai token baru dan Last-Event-ID direset', async () => {
    const a = controlledResponse();
    const b = controlledResponse();
    const { stream, calls, notices, setToken } = setup({
      token: 'tokenA',
      responses: [() => a.response, () => b.response],
    });
    stream.start();
    await until(() => calls.length === 1);
    expect(calls[0]?.headers.authorization).toBe('Bearer tokenA');
    a.send(frame('n1'));
    await until(() => notices.length === 1);

    setToken('tokenB');
    stream.start();
    await until(() => calls.length === 2);
    expect(calls[1]?.headers.authorization).toBe('Bearer tokenB');
    expect(calls[1]?.headers['last-event-id']).toBeUndefined();
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(stream.isRunning()).toBe(true);

    // Bingkai dari koneksi lama tak lagi diteruskan; yang baru diteruskan.
    try {
      a.send(frame('lama'));
    } catch {
      // Aliran lama sudah dibatalkan.
    }
    b.send(frame('n2'));
    await until(() => notices.length === 2);
    expect(notices.map((n) => n.id)).toEqual(['n1', 'n2']);
    stream.stop();
  });

  test('start dengan token yang sama tetap tanpa efek', async () => {
    const a = controlledResponse();
    const { stream, calls } = setup({ token: 'tokenA', responses: [() => a.response] });
    stream.start();
    await until(() => calls.length === 1);
    stream.start();
    await wait(30);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal?.aborted).toBe(false);
    stream.stop();
  });
});
