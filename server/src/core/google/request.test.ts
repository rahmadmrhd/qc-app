import { describe, expect, test } from 'bun:test';
import { createGoogleHttp } from './request';

const tokens = { getAccessToken: async () => 'token-uji', invalidate: () => {} };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function httpWith(onFetch: (init: RequestInit | undefined) => void) {
  return createGoogleHttp({
    tokens: tokens as never,
    fetch: (async (_url: unknown, init?: RequestInit) => {
      onFetch(init);
      return new Response('isi', { status: 200 });
    }) as typeof fetch,
    sleep: async () => {},
  });
}

describe('batas waktu permintaan Google', () => {
  test('bawaan: batas waktu mencakup seluruh badan (sinyal habis setelah timeoutMs)', async () => {
    let signal: AbortSignal | undefined;
    const http = httpWith((init) => {
      signal = init?.signal ?? undefined;
    });
    await http.request({
      op: 'uji',
      method: 'GET',
      url: 'https://x.test/',
      idempotent: true,
      timeoutMs: 30,
    });
    await wait(80);
    expect(signal?.aborted).toBe(true);
  });

  test('streamBody: batas hanya sampai header; badan tidak terpotong sesudahnya', async () => {
    let signal: AbortSignal | undefined;
    const http = httpWith((init) => {
      signal = init?.signal ?? undefined;
    });
    const response = await http.request({
      op: 'uji',
      method: 'GET',
      url: 'https://x.test/',
      idempotent: true,
      timeoutMs: 30,
      streamBody: true,
    });
    await wait(80);
    expect(signal?.aborted).toBe(false);
    expect(await response.text()).toBe('isi');
  });

  test('streamBody: header yang tak kunjung datang tetap dibatalkan oleh batas waktu', async () => {
    const http = createGoogleHttp({
      tokens: tokens as never,
      fetch: ((_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        })) as typeof fetch,
      sleep: async () => {},
    });
    await expect(
      http.request({
        op: 'uji',
        method: 'POST',
        url: 'https://x.test/',
        idempotent: false,
        timeoutMs: 30,
        streamBody: true,
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
