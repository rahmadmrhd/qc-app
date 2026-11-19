import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApiProxy, isProxyRoute } from './api-proxy';
import { createTokenStore, type TokenStore } from './auth/token-store';
import { DEFAULT_SERVER_URL, type Settings } from './settings';

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

let server: Server;
let port: number;
let seen: Seen[] = [];
/** Perilaku server palsu per jalur; diatur tiap tes. */
let respond: (seen: Seen, res: import('node:http').ServerResponse) => void;

const TOKEN = 'TOKEN-DESKTOP-RAHASIA';

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const entry: Seen = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      seen.push(entry);
      respond(entry, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let tokens: TokenStore;
let unauthenticated: number;
beforeEach(() => {
  seen = [];
  unauthenticated = 0;
  respond = (_s, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  };
  tokens = createTokenStore('tidak-dipakai.json', null, () => 1);
  tokens.set({ token: TOKEN, email: 'a@b.co', expiresAt: 9_999_999_999_999 });
});

const settings = (): Settings => ({ packageDir: null, serverUrl: `http://127.0.0.1:${port}` });
const proxy = (over: Partial<Parameters<typeof createApiProxy>[0]> = {}) =>
  createApiProxy({
    settings,
    tokens,
    onUnauthenticated: () => {
      unauthenticated += 1;
    },
    ...over,
  });
const req = (path: string, init?: RequestInit) => new Request(`app://qc${path}`, init);

describe('jalur', () => {
  test('hanya /api/v1/*, /api/ping, /auth/logout yang diizinkan; selain itu 403 problem+json tanpa menghubungi server', async () => {
    const handler = proxy();
    for (const path of [
      '/api/openapi.json',
      '/api/v1', // tanpa garis miring penutup bukan awalan /api/v<n>/
      '/api/v2', // idem untuk versi lain
      '/api/v1x/me',
      '/api/vx/me',
      '/api/v/me',
      '/api/desktop/catalog', // rute desktop tidak lewat proksi API
      '/api/desktop/app-manifest',
      '/api/pingx',
      '/api/rpc',
      '/auth/login',
      '/auth/desktop/token',
      '/auth/dev-login',
      '/auth/me',
      '/sync',
    ]) {
      const res = await handler(req(path));
      expect(res.status, path).toBe(403);
      expect(res.headers.get('content-type')).toContain('application/problem+json');
      expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN');
    }
    expect(seen).toEqual([]);
  });

  test('semua versi /api/v<n>/ diizinkan (v2 ikut diteruskan ke server)', async () => {
    const handler = proxy();
    for (const path of ['/api/v1/me', '/api/v2/qrcodes/abc', '/api/v12/items']) {
      const res = await handler(req(path));
      expect(res.status, path).toBe(200);
    }
    expect(seen.map((s) => s.url)).toEqual(['/api/v1/me', '/api/v2/qrcodes/abc', '/api/v12/items']);
  });

  test('".." dan "//" dan "\\" ditolak, juga yang dikodekan', async () => {
    const handler = proxy();
    for (const path of [
      '/api/v1/..%2F..%2Fauth%2Flogin',
      '/api/v1/%2e%2e/x',
      '/api/v1/a%2f..%2fb',
      '/api/v1//items',
      '/api/v1/a%2F%2Fb',
      '/api/v1/a%5Cb',
      '/api/v1/a%00b',
      '/api/v1/%E0%A4%A',
    ]) {
      expect((await handler(req(path))).status, path).toBe(403);
    }
    expect(seen).toEqual([]);
  });

  test('asal bukan app://qc ditolak; metode aneh ditolak', async () => {
    const handler = proxy();
    expect((await handler(new Request('app://lain/api/ping'))).status).toBe(403);
    expect((await handler(new Request('https://qc/api/ping'))).status).toBe(403);
    expect((await handler(req('/api/ping', { method: 'OPTIONS' }))).status).toBe(405);
    expect(seen).toEqual([]);
  });

  test('isProxyRoute: awalan /api dan /auth', () => {
    expect(isProxyRoute('/api/v1/me')).toBe(true);
    expect(isProxyRoute('/api')).toBe(true);
    expect(isProxyRoute('/auth/login')).toBe(true);
    expect(isProxyRoute('/country-lock')).toBe(false);
    expect(isProxyRoute('/apiary')).toBe(false);
    expect(isProxyRoute('/authors')).toBe(false);
  });
});

describe('header', () => {
  test('Cookie, Authorization, Origin, Referer, Host dari renderer dibuang; Bearer ditambahkan; header sah diteruskan', async () => {
    const res = await proxy()(
      req('/api/v1/items?q=a b', {
        method: 'PUT',
        headers: {
          Cookie: 'qc_session=curian',
          Authorization: 'Bearer palsu-dari-renderer',
          Origin: 'https://jahat.example',
          Referer: 'https://jahat.example/x',
          'Content-Type': 'application/json',
          'If-Match': '"v3"',
          'X-Requested-With': 'qc',
          'X-Aneh': 'tidak diteruskan',
        },
        body: '{"a":1}',
      }),
    );
    expect(res.status).toBe(200);
    const s = seen[0];
    expect(s?.method).toBe('PUT');
    expect(s?.url).toBe('/api/v1/items?q=a%20b');
    expect(s?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(s?.headers.cookie).toBeUndefined();
    expect(s?.headers.origin).toBeUndefined();
    expect(s?.headers.referer).toBeUndefined();
    expect(s?.headers['x-aneh']).toBeUndefined();
    expect(s?.headers.host).toBe(`127.0.0.1:${port}`);
    expect(s?.headers['content-type']).toBe('application/json');
    expect(s?.headers['if-match']).toBe('"v3"');
    expect(s?.headers['x-requested-with']).toBe('qc');
    expect(s?.body.toString()).toBe('{"a":1}');
  });

  test('tanpa token tersimpan tidak ada header Authorization (Authorization renderer tetap dibuang)', async () => {
    tokens.clear();
    await proxy()(req('/api/ping', { headers: { Authorization: 'Bearer palsu' } }));
    expect(seen[0]?.headers.authorization).toBeUndefined();
  });

  test('M1: semua respons proxy (sukses, galat server, dan yang dibuat proxy) membawa CSP terkunci dan nosniff', async () => {
    const expectHardened = (res: Response) => {
      expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    };
    // Server menjawab HTML dan mencoba menimpa kebijakan: yang dipakai tetap milik proxy.
    respond = (_s, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Security-Policy': 'default-src *',
        'X-Content-Type-Options': 'sniff',
      });
      res.end('<script>window.qcBridge</script>');
    };
    expectHardened(await proxy()(req('/api/v1/html')));
    respond = (_s, res) => {
      res.writeHead(500);
      res.end('x');
    };
    expectHardened(await proxy()(req('/api/v1/gagal')));
    expectHardened(await proxy()(req('/api/jahat')));
    expectHardened(await proxy()(req('/api/v1/x', { method: 'OPTIONS' })));
    expectHardened(
      await proxy()(req('/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'qc' } })),
    );
    // Server mati.
    expectHardened(
      await proxy({ settings: () => ({ packageDir: null, serverUrl: 'http://127.0.0.1:1' }) })(
        req('/api/v1/me'),
      ),
    );
  });

  test('Set-Cookie dari server tidak diteruskan ke renderer', async () => {
    respond = (_s, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': ['qc_session=x; HttpOnly', 'lain=y'],
        'X-Request-Id': 'abc',
      });
      res.end('{}');
    };
    const res = await proxy()(req('/api/v1/me'));
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('x-request-id')).toBe('abc');
  });
});

describe('perilaku', () => {
  test('401 dari server menghapus token dan memanggil onUnauthenticated; status dan badan diteruskan', async () => {
    respond = (_s, res) => {
      res.writeHead(401, { 'Content-Type': 'application/problem+json' });
      res.end('{"code":"UNAUTHENTICATED"}');
    };
    const res = await proxy()(req('/api/v1/me'));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"code":"UNAUTHENTICATED"}');
    expect(tokens.get()).toBeNull();
    expect(unauthenticated).toBe(1);
  });

  test('M2: 401 untuk permintaan berbekal token lama TIDAK menghapus token baru hasil login ulang', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    respond = (_s, res) => {
      // Server menahan jawaban sampai pengguna keluar lalu masuk lagi.
      void gate.then(() => {
        res.writeHead(401, { 'Content-Type': 'application/problem+json' });
        res.end('{"code":"UNAUTHENTICATED"}');
      });
    };
    const pending = proxy()(req('/api/v1/me'));
    await vi.waitFor(() => expect(seen.length).toBe(1));
    tokens.set({ token: 'TOKEN-BARU', email: 'a@b.co', expiresAt: 9_999_999_999_999 });
    release();
    expect((await pending).status).toBe(401);
    expect(tokens.get()?.token).toBe('TOKEN-BARU');
    expect(unauthenticated).toBe(0);
  });

  test('M2: 401 setelah pengguna keluar (token sudah kosong) tidak memanggil onUnauthenticated lagi', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    respond = (_s, res) => {
      void gate.then(() => {
        res.writeHead(401);
        res.end();
      });
    };
    const pending = proxy()(req('/api/v1/me'));
    await vi.waitFor(() => expect(seen.length).toBe(1));
    tokens.clear();
    release();
    expect((await pending).status).toBe(401);
    expect(unauthenticated).toBe(0);
  });

  test('401 tanpa token tersimpan diteruskan tanpa memanggil onUnauthenticated (tanpa banjir peristiwa)', async () => {
    tokens.clear();
    respond = (_s, res) => {
      res.writeHead(401);
      res.end();
    };
    expect((await proxy()(req('/api/v1/me'))).status).toBe(401);
    expect(unauthenticated).toBe(0);
  });

  test('/auth/logout menghapus token dan menjawab {ok:true} tanpa memanggil server', async () => {
    const res = await proxy()(
      req('/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'qc' } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(tokens.get()).toBeNull();
    expect(unauthenticated).toBe(1);
    expect(seen).toEqual([]);
  });

  test('server mati = 503 problem+json UNAVAILABLE, bukan crash, tanpa membocorkan alamat/token', async () => {
    const res = await proxy({
      settings: () => ({ packageDir: null, serverUrl: 'http://127.0.0.1:1' }),
    })(req('/api/v1/me'));
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const text = await res.text();
    expect(JSON.parse(text).code).toBe('UNAVAILABLE');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('127.0.0.1');
  });

  test('redirect tidak diikuti (3xx diteruskan apa adanya)', async () => {
    respond = (_s, res) => {
      res.writeHead(302, { Location: '/auth/login' });
      res.end();
    };
    const res = await proxy()(req('/api/v1/me'));
    expect(res.status).toBe(302);
    expect(seen).toHaveLength(1); // /auth/login tidak diminta
  });

  test('unggah multipart 5 MB utuh dan unduhan biner utuh', async () => {
    const upload = new Uint8Array(5 * 1024 * 1024);
    for (let i = 0; i < upload.length; i += 1) upload[i] = i % 251;
    const download = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 7) % 256);
    respond = (s, res) => {
      if (s.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            bytes: s.body.length,
            same: Buffer.compare(s.body, Buffer.from(upload)) === 0,
          }),
        );
      } else {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(Buffer.from(download));
      }
    };
    const handler = proxy();
    const up = await handler(
      req('/api/v1/files', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'X-Requested-With': 'qc' },
        body: upload,
      }),
    );
    expect(await up.json()).toEqual({ bytes: upload.length, same: true });
    const down = await handler(req('/api/v1/files/1'));
    const got = new Uint8Array(await down.arrayBuffer());
    expect(got.length).toBe(download.length);
    expect(Buffer.compare(Buffer.from(got), Buffer.from(download))).toBe(0);
  });

  test('alamat server diambil dari pengaturan (bawaan production) dan header respons terkodekan dibersihkan', async () => {
    expect(DEFAULT_SERVER_URL).toBe('https://qc.rhd.my.id');
    let target = '';
    const res = await createApiProxy({
      settings: () => ({ packageDir: null, serverUrl: DEFAULT_SERVER_URL }),
      tokens,
      onUnauthenticated: () => undefined,
      fetchImpl: (async (input: string | URL | Request) => {
        target = String(input);
        return new Response('x', {
          status: 200,
          headers: { 'Content-Encoding': 'gzip', 'Content-Length': '999' },
        });
      }) as typeof fetch,
    })(req('/api/ping'));
    expect(target).toBe('https://qc.rhd.my.id/api/ping');
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('content-length')).toBeNull();
  });
});
