import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  APP_CSP,
  buildAppCsp,
  createAppHandler,
  inlineScriptHashes,
  isAppUrl,
  resolveAppFile,
} from './app-protocol';

const ROOT = resolve(tmpdir(), 'qc-ui-root');

describe('resolveAppFile', () => {
  test('app://qc/assets/x.js dipetakan ke root/assets/x.js', () => {
    expect(resolveAppFile(ROOT, 'app://qc/assets/x.js')).toBe(resolve(ROOT, 'assets', 'x.js'));
    expect(resolveAppFile(ROOT, 'app://qc/assets/x.js?v=1#h')).toBe(
      resolve(ROOT, 'assets', 'x.js'),
    );
    expect(resolveAppFile(ROOT, 'app://qc/assets/a%20b.css')).toBe(
      resolve(ROOT, 'assets', 'a b.css'),
    );
  });

  test('traversal "../" dan jalur absolut menghasilkan null', () => {
    for (const bad of [
      'app://qc/..%2F..%2Fsecret.txt',
      'app://qc/%2e%2e%2f%2e%2e%2fsecret.txt',
      'app://qc/assets/..%2f..%2f..%2fsecret.txt',
      'app://qc/..%5C..%5Csecret.txt',
      'app://qc/assets%5C..%5Cx.js',
      'app://qc/C:/Windows/win.ini',
      'app://qc/C%3A/Windows/win.ini',
      'app://qc/a%00b.js',
      'app://qc/%E0%A4%A.js', // persen-encoding rusak
      'app://evil/assets/x.js',
      'file:///C:/Windows/win.ini',
      'https://qc/assets/x.js',
      'bukan url',
      '',
    ]) {
      expect(resolveAppFile(ROOT, bad), bad).toBeNull();
    }
  });

  test('dot-segment yang dinormalisasi URL tetap berada di bawah root', () => {
    // `new URL` membuang "/../" sebelum sampai ke kita; hasilnya tetap di dalam root.
    const result = resolveAppFile(ROOT, 'app://qc/assets/../../x.js');
    expect(result === null || result.startsWith(ROOT)).toBe(true);
  });

  test('rute SPA tanpa ekstensi memberi index.html', () => {
    const index = resolve(ROOT, 'index.html');
    expect(resolveAppFile(ROOT, 'app://qc/')).toBe(index);
    expect(resolveAppFile(ROOT, 'app://qc')).toBe(index);
    expect(resolveAppFile(ROOT, 'app://qc/country-lock')).toBe(index);
    expect(resolveAppFile(ROOT, 'app://qc/item/brands/12')).toBe(index);
  });
});

describe('CSP', () => {
  test('APP_CSP memuat default-src self dan tidak mengizinkan unsafe-eval', () => {
    expect(APP_CSP).toContain("default-src 'self'");
    expect(APP_CSP).not.toContain('unsafe-eval');
    expect(APP_CSP).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(APP_CSP).toContain("object-src 'none'");
    expect(APP_CSP).toContain("frame-ancestors 'none'");
  });

  test('hash skrip inline resmi masuk script-src; skrip bersumber (src) diabaikan', () => {
    const html =
      '<script>const tema = 1;</script><script type="module" src="/a.js"></script><script>  </script>';
    const hashes = inlineScriptHashes(html);
    expect(hashes).toHaveLength(1);
    const csp = buildAppCsp(hashes);
    expect(csp).toContain(`script-src 'self' 'sha256-${hashes[0]}'`);
    expect(csp).not.toContain('unsafe-eval');
  });
});

describe('isAppUrl', () => {
  test('hanya app://qc yang boleh jadi tujuan navigasi', () => {
    expect(isAppUrl('app://qc/country-lock')).toBe(true);
    expect(isAppUrl('app://qc')).toBe(true);
    for (const bad of [
      'https://example.com',
      'http://qc/',
      'file:///C:/x.html',
      'app://evil/x',
      'qc://country-lock',
      'javascript:alert(1)',
      'bukan url',
    ]) {
      expect(isAppUrl(bad), bad).toBe(false);
    }
  });
});

describe('createAppHandler', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qc-ui-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'x.js'), 'console.log(1)');
    writeFileSync(join(dir, 'index.html'), '<html><script>window.a=1</script></html>');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('menyajikan berkas dengan tipe konten dan header keamanan', async () => {
    const res = await createAppHandler(dir)(new Request('app://qc/assets/x.js'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('console.log(1)');
  });

  test('rute SPA memberi index.html dengan CSP berisi hash skrip inline; berkas hilang 404; traversal 403', async () => {
    const handler = createAppHandler(dir);
    const spa = await handler(new Request('app://qc/country-lock'));
    expect(spa.status).toBe(200);
    expect(spa.headers.get('content-type')).toContain('text/html');
    expect(spa.headers.get('content-security-policy')).toContain("'sha256-");
    expect((await handler(new Request('app://qc/assets/tidak-ada.js'))).status).toBe(404);
    expect((await handler(new Request('app://qc/..%2F..%2Fx.js'))).status).toBe(403);
    expect((await handler(new Request('app://lain/assets/x.js'))).status).toBe(403);
  });
});

describe('API lewat proxy', () => {
  test('CSP: connect-src hanya self (renderer hanya memanggil app://qc/api sesama origin)', () => {
    const connect = APP_CSP.split('; ').find((d) => d.startsWith('connect-src'));
    expect(connect).toBe("connect-src 'self'");
    expect(APP_CSP).not.toMatch(/https?:/);
  });

  test('jalur /api/ dan /auth/ diserahkan ke proxy, bukan ke penyaji berkas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qc-ui-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<html></html>');
      const calls: string[] = [];
      const handler = createAppHandler(dir, async (request) => {
        calls.push(request.url);
        return new Response('dari-proxy', { status: 200 });
      });
      expect(await (await handler(new Request('app://qc/api/v1/me'))).text()).toBe('dari-proxy');
      expect(await (await handler(new Request('app://qc/auth/logout'))).text()).toBe('dari-proxy');
      expect(calls).toEqual(['app://qc/api/v1/me', 'app://qc/auth/logout']);
      // rute UI tetap dilayani berkas
      expect(
        (await handler(new Request('app://qc/country-lock'))).headers.get('content-type'),
      ).toContain('text/html');
      expect(calls).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tanpa proxy, /api/ dan /auth/ = 404 (bukan index.html)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'qc-ui-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<html></html>');
      const handler = createAppHandler(dir);
      expect((await handler(new Request('app://qc/api/v1/me'))).status).toBe(404);
      expect((await handler(new Request('app://qc/auth/login'))).status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('akar UI dinamis', () => {
  test('akar berupa fungsi dievaluasi tiap permintaan (bundel aktif dapat berganti)', async () => {
    const a = mkdtempSync(join(tmpdir(), 'qc-ui-a-'));
    const b = mkdtempSync(join(tmpdir(), 'qc-ui-b-'));
    try {
      writeFileSync(join(a, 'index.html'), 'A');
      writeFileSync(join(b, 'index.html'), 'B');
      let active = a;
      const handler = createAppHandler(() => active);
      expect(await (await handler(new Request('app://qc/country-lock'))).text()).toBe('A');
      active = b;
      expect(await (await handler(new Request('app://qc/country-lock'))).text()).toBe('B');
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

describe('gambar katalog Tipe offline (/catalog-files/<id>)', () => {
  const png = Buffer.from([137, 80, 78, 71]);
  const read = (id: string) => (id === 'g1' ? { data: png, mime: 'image/png' } : null);

  test('menyajikan gambar dari cache dengan tipe dan header keamanan', async () => {
    const res = await createAppHandler(ROOT, undefined, { read })(
      new Request('app://qc/catalog-files/g1'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
  });

  test('id tak dikenal, tak sah (traversal, titik, kosong), atau tanpa sumber katalog = 404 tanpa menyentuh UI', async () => {
    const handler = createAppHandler(ROOT, undefined, { read });
    for (const path of [
      '/catalog-files/tidak-ada',
      '/catalog-files/..%2F..%2Fx',
      '/catalog-files/a.png',
      '/catalog-files/',
      '/catalog-files/g1/extra',
    ]) {
      expect((await handler(new Request(`app://qc${path}`))).status, path).toBe(404);
    }
    expect((await createAppHandler(ROOT)(new Request('app://qc/catalog-files/g1'))).status).toBe(
      404,
    );
  });

  test('origin lain tidak dilayani sebagai gambar katalog', async () => {
    const res = await createAppHandler(ROOT, undefined, { read })(
      new Request('app://lain/catalog-files/g1'),
    );
    expect(res.status).toBe(403);
  });
});
