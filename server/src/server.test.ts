import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import { announcedApis } from '@shared/api-versions';
import { removeTempDirSync } from '../test-support/safe-rm';
import { type Config, loadConfig } from './config';
import { signSessionToken } from './core/session';
import { MAX_REQUEST_BODY_BYTES } from './http/body';
import { bunServeOptions, createServer, type QcServer } from './server';

const HTML = '<!doctype html><html><body><div id="root">QC-SPA</div></body></html>';
const LOOPBACK = '127.0.0.1';

let root: string;
let staticDir: string;
let env: TestEnv;
let server: QcServer;

function configFor(extra: Record<string, string> = {}): Config {
  return loadConfig({
    DATABASE_URL: 'mysql://tidak-dipakai:x@127.0.0.1:1/tidak_ada',
    SESSION_SECRET: 'test-session-secret',
    OAUTH_CLIENT_ID: 'test-client-id',
    OAUTH_CLIENT_SECRET: 'test-client-secret',
    ADMIN_EMAIL: 'admin@gmail.com',
    STATIC_DIR: staticDir,
    ...extra,
  });
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'qc-server-test-'));
  staticDir = join(root, 'dist');
  mkdirSync(join(staticDir, 'assets'), { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), HTML);
  writeFileSync(join(staticDir, 'assets', 'app-abc123.js'), 'console.log("app")');
  writeFileSync(join(root, 'rahasia.txt'), 'di luar direktori statis');
});

afterAll(() => {
  removeTempDirSync(root);
});

beforeEach(async () => {
  env = await createTestEnv();
  server = createServer(configFor(), { db: env.DB, background: false, env: { NOW: env.NOW } });
});

const get = (path: string, peer = LOOPBACK) =>
  server.fetch(new Request(`http://localhost${path}`), peer);

describe('createServer: API', () => {
  test('GET /api/ping menjawab ok', async () => {
    const response = await get('/api/ping');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      build: expect.any(String),
      // Peta versi API per kelompok (kebijakan versi API 2026-11-20): klien memilih id berversi darinya.
      apis: announcedApis(),
    });
  });

  test('GET /api/v1/me tanpa sesi -> 401 problem+json UNAUTHENTICATED', async () => {
    const response = await get('/api/v1/me');
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  });

  test('GET /api/boot sudah dihapus -> 404', async () => {
    expect((await get('/api/boot')).status).toBe(404);
  });

  test('rute server yang tidak dikenal = 404 JSON, bukan index.html', async () => {
    for (const path of ['/api/tidak-ada', '/auth/tidak-ada', '/sync/x', '/sync']) {
      const response = await get(path);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('QC-SPA');
    }
    const json = await get('/api/tidak-ada');
    expect(await json.json()).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    // modul sinkron dihapus (2026-11-08): /api/v1/sync/* kini rute REST tak dikenal biasa
    expect((await get('/api/v1/sync/x')).status).toBe(404);
    // jalur REST dan kabel lama /sync: problem+json
    for (const path of ['/sync', '/sync/x']) {
      const rest = await get(path);
      expect(rest.headers.get('content-type')).toContain('application/problem+json');
      expect(await rest.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
  });
});

describe('createServer: berkas statis dan fallback SPA', () => {
  test('rute klien (/rute-klien, /handover/board) dijawab index.html tanpa cache', async () => {
    for (const path of ['/', '/rute-klien', '/handover/board/abc']) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('QC-SPA');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(response.headers.get('content-type')).toContain('text/html');
    }
  });

  test('aset berhash dilayani dengan Cache-Control panjang dan immutable', async () => {
    const response = await get('/assets/app-abc123.js');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('console.log("app")');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-type')).toContain('javascript');
  });

  test('berkas berekstensi yang tidak ada = 404 (bukan index.html)', async () => {
    const response = await get('/assets/hilang-1.js');
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('QC-SPA');
  });

  test('path traversal tidak keluar dari direktori statis', async () => {
    for (const path of [
      '/..%2frahasia.txt',
      '/%2e%2e/rahasia.txt',
      '/assets/..%2f..%2frahasia.txt',
    ]) {
      const response = await get(path);
      expect(await response.text()).not.toContain('di luar direktori statis');
    }
    expect((await get('/%00')).status).toBe(400);
  });

  test('POST ke jalur statis tidak dilayani (404)', async () => {
    const response = await server.fetch(
      new Request('http://localhost/rute-klien', { method: 'POST' }),
      LOOPBACK,
    );
    expect(response.status).toBe(404);
  });
});

describe('createServer: batas ukuran badan (M3)', () => {
  /** Badan chunked tanpa content-length; `pulled` = jumlah potongan yang benar-benar ditarik pembaca. */
  function chunkedBody(chunks: number, chunkBytes: number) {
    const state = { pulled: 0 };
    const chunk = new Uint8Array(chunkBytes).fill(32);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (state.pulled >= chunks) return controller.close();
        state.pulled++;
        controller.enqueue(chunk);
      },
    });
    return { stream, state };
  }

  test('Bun.serve memakai MAX_REQUEST_BODY_BYTES: badan > batas = 413 tanpa menjalankan aplikasi, di bawahnya lolos', async () => {
    let reached = 0;
    const counting: QcServer = {
      ...server,
      fetch: (request, peer) => {
        reached++;
        return server.fetch(request, peer);
      },
    };
    const bun = Bun.serve(bunServeOptions(counting, { host: '127.0.0.1', port: 0 }));
    try {
      const url = `http://127.0.0.1:${bun.port}/api/v1/brands`;
      const send = (bytes: number) =>
        fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-requested-with': 'qc' },
          body: new Uint8Array(bytes).fill(32),
        });
      // Bun menolak di lapisan HTTP: 413, atau koneksi diputus bila klien masih mengirim (keduanya = ditolak).
      const outcome = await send(MAX_REQUEST_BODY_BYTES + 1024).then(
        (response) => response.status,
        () => 'reset',
      );
      expect([413, 'reset']).toContain(outcome);
      expect(reached).toBe(0); // aplikasi tidak pernah dijalankan
      const ok = await send(1024); // spasi saja = bukan JSON: sampai ke aplikasi, ditolak di sana
      expect(ok.status).not.toBe(413);
      expect(reached).toBe(1);
    } finally {
      await bun.stop(true);
    }
  }, 60_000);

  test('REST JSON: badan chunked terlalu besar ditolak 413 VALIDATION, tidak dimuat penuh', async () => {
    const { stream, state } = chunkedBody(40, 1024 * 1024);
    // sesi sah: sejak I2 sesi diperiksa SEBELUM badan dibaca (tanpa sesi = 401 tanpa membaca apa pun)
    const cookie = `qc_session=${await signSessionToken(server.env, 'admin@gmail.com', env.clock.now())}`;
    const response = await server.fetch(
      new Request('http://localhost/api/v1/brands', {
        method: 'POST',
        headers: { 'x-requested-with': 'qc', cookie },
        body: stream,
        duplex: 'half',
      }),
      LOOPBACK,
    );
    expect(response.status).toBe(413);
    expect(((await response.json()) as { code: string }).code).toBe('VALIDATION');
    expect(state.pulled).toBeLessThan(25);
  }, 60_000);
});

describe('createServer: siklus hidup', () => {
  test('stop() tidak menutup Db yang disuntik dan boleh dipanggil berulang', async () => {
    await server.stop();
    await server.stop();
    expect((await env.DB.prepare('SELECT 1 AS n').first<{ n: number }>())?.n).toBe(1);
  });

  test('env disusun dari konfigurasi dan menerima timpaan tes', () => {
    expect(server.env).toMatchObject({
      SESSION_SECRET: 'test-session-secret',
      ADMIN_EMAIL: 'admin@gmail.com',
    });
    expect(server.env.NOW).toBe(env.NOW);
    expect(server.env.DB).toBe(env.DB);
  });
});
