import { request } from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { type Loopback, startLoopback } from './loopback';

const CODE = 'eyJ0eXAiOiJkY29kZSJ9.abc-DEF_123';
const STATE = 'state-uji-1234';

let active: Loopback | null = null;
afterEach(() => {
  active?.close();
  active = null;
});

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** `http.request` (bukan fetch) agar header Host dapat diatur. */
function get(port: number, path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<Reply>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function open(onCallback: (code: string, state: string) => Promise<boolean>) {
  const calls: { code: string; state: string }[] = [];
  const lb = await startLoopback({
    timeoutMs: 60_000,
    onCallback: async (code, state) => {
      calls.push({ code, state });
      return onCallback(code, state);
    },
  });
  active = lb;
  return { lb, calls };
}

describe('startLoopback', () => {
  test('callback sah: meneruskan code/state, menampilkan halaman berhasil dengan header ketat', async () => {
    const { lb, calls } = await open(async () => true);
    const reply = await get(lb.port, `/callback?code=${CODE}&state=${STATE}`);
    expect(calls).toEqual([{ code: CODE, state: STATE }]);
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('Login berhasil');
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['referrer-policy']).toBe('no-referrer');
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(String(reply.headers['content-security-policy'])).toMatch(/default-src 'none'.*nonce-/);
    expect(reply.body).not.toContain(CODE);
  });

  test('penukaran gagal: halaman gagal (kode tak dicetak)', async () => {
    const { lb } = await open(async () => false);
    const reply = await get(lb.port, `/callback?code=${CODE}&state=${STATE}`);
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('Login gagal');
    expect(reply.body).not.toContain(CODE);
  });

  test('bentuk lain ditolak 404 tanpa memanggil penangan: jalur, metode, kunci tambahan/ganda, nilai tak sah', async () => {
    const { lb, calls } = await open(async () => true);
    const paths = [
      '/',
      '/callback/x',
      '/Callback',
      `/auth/callback?code=${CODE}&state=${STATE}`,
      `/callback?code=${CODE}`,
      `/callback?state=${STATE}`,
      `/callback?code=${CODE}&state=${STATE}&extra=1`,
      `/callback?code=${CODE}&code=${CODE}&state=${STATE}`,
      `/callback?code=${CODE}&state=pendek`,
      '/callback?code=%00&state=state-uji-1234',
      `/callback?code=${'a'.repeat(1025)}&state=${STATE}`,
    ];
    for (const path of paths) {
      const reply = await get(lb.port, path);
      expect(reply.status, path).toBe(404);
    }
    const post = await get(lb.port, `/callback?code=${CODE}&state=${STATE}`, {}, 'POST');
    expect(post.status).toBe(404);
    expect(calls).toEqual([]);
  });

  test('Host selain 127.0.0.1:<port> ditolak (DNS rebinding)', async () => {
    const { lb, calls } = await open(async () => true);
    for (const host of [
      'evil.example',
      `localhost:${lb.port}`,
      `127.0.0.1:${lb.port + 1}`,
      '127.0.0.1',
    ]) {
      const reply = await get(lb.port, `/callback?code=${CODE}&state=${STATE}`, { Host: host });
      expect(reply.status, host).toBe(404);
    }
    expect(calls).toEqual([]);
  });

  test('close() menutup port; timeout menutup sendiri', async () => {
    const { lb } = await open(async () => true);
    lb.close();
    await expect(get(lb.port, '/')).rejects.toThrow();

    const short = await startLoopback({ timeoutMs: 50, onCallback: async () => true });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await expect(get(short.port, '/')).rejects.toThrow();
  });

  test('penangan melempar: 500 tanpa membocorkan isi', async () => {
    const { lb } = await open(async () => {
      throw new Error('rahasia internal');
    });
    const reply = await get(lb.port, `/callback?code=${CODE}&state=${STATE}`);
    expect(reply.status).toBe(500);
    expect(reply.body).not.toContain('rahasia');
  });
});
