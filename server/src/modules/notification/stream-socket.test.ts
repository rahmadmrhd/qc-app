import { afterEach, beforeEach, expect, setDefaultTimeout, test } from 'bun:test';
import { app } from '@server/app';
import { signDesktopToken, signSessionToken } from '@server/core/session';
import { seedHandoverEnv } from '@server-test/handover-env';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { activeStreamCount, closeAllNotificationStreams } from './stream-hub';

setDefaultTimeout(60_000);

let env: TestEnv;
let server: ReturnType<typeof Bun.serve> | undefined;

beforeEach(async () => {
  env = await createTestEnv();
  await seedHandoverEnv(env);
});

afterEach(async () => {
  closeAllNotificationStreams();
  await server?.stop(true);
  server = undefined;
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Tes lewat soket TCP sungguhan (bukan `app.request`): memastikan perilaku `Bun.serve` yang tak terlihat tes
// dalam proses: batas idle bawaan 10 dtk tidak memutus aliran selama detak jantung 5 dtk berjalan, dan putusnya
// klien dikenali (`cancel()` pada aliran) sehingga koneksi tidak bocor di memori server.
test('soket nyata: aliran bertahan melewati batas idle 10 dtk berkat detak jantung, dan putus klien dikenali', async () => {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => app.fetch(request, { ...env, peerAddress: '127.0.0.1' }),
  });
  const token = await signDesktopToken(env, 'viewer@gmail.com', env.clock.now());
  const abort = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.port}/api/v1/notifications/stream`, {
    headers: { authorization: `Bearer ${token}` },
    signal: abort.signal,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let received = '';
  let ended = false;
  const pump = (async () => {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          ended = true;
          return;
        }
        received += decoder.decode(chunk.value, { stream: true });
      }
    } catch {
      // Dibatalkan di akhir tes.
    }
  })();

  await wait(13_000);
  expect(ended).toBe(false);
  expect(received).toContain('event: ready');
  expect(received.split(': ping').length - 1).toBeGreaterThanOrEqual(2);
  expect(activeStreamCount()).toBe(1);

  abort.abort();
  await pump;
  for (let i = 0; i < 30 && activeStreamCount() > 0; i++) await wait(100);
  expect(activeStreamCount()).toBe(0);
});

// Jalur cookie (lonceng web) lewat soket TCP sungguhan: kode autentikasinya berbeda dari Bearer desktop, tetapi hub dan
// pembersihan koneksi sama. `EventSource` peramban mengirim cookie sesi tanpa header Authorization.
test('soket nyata: cookie sesi web membuka aliran, dan putus klien dikenali', async () => {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => app.fetch(request, { ...env, peerAddress: '127.0.0.1' }),
  });
  const token = await signSessionToken(env, 'viewer@gmail.com', env.clock.now());
  const abort = new AbortController();
  const response = await fetch(`http://127.0.0.1:${server.port}/api/v1/notifications/stream`, {
    headers: { cookie: `qc_session=${token}` },
    signal: abort.signal,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain('event: ready');
  expect(activeStreamCount()).toBe(1);

  abort.abort();
  for (let i = 0; i < 30 && activeStreamCount() > 0; i++) await wait(100);
  expect(activeStreamCount()).toBe(0);
});
