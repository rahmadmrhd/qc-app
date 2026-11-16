import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serveStatic } from './static';

// Pelayanan berkas PWA (FR-P10, FR-P8): `sw.js` dan manifest harus selalu divalidasi ulang, aset berhash boleh
// di-cache lama, dan rute server tidak pernah dijawab `index.html`.
let dir = '';

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'qc-static-'));
  mkdirSync(path.join(dir, 'icons'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>QC</title>');
  writeFileSync(path.join(dir, 'sw.js'), 'self.addEventListener("message", () => {});');
  writeFileSync(path.join(dir, 'manifest.webmanifest'), '{"name":"QC App"}');
  writeFileSync(path.join(dir, 'workbox-abc.js'), 'export {};');
  writeFileSync(path.join(dir, 'icons', 'icon-192.png'), Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(path.join(dir, 'assets', 'a-abc123.js'), 'export {};');
  writeFileSync(
    path.join(dir, 'assets', 'zxing_reader-abc123.wasm'),
    Uint8Array.from([0, 0x61, 0x73, 0x6d]),
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function serve(pathname: string, method = 'GET'): Response {
  const response = serveStatic(dir, method, pathname);
  if (response === null) throw new Error(`serveStatic mengembalikan null untuk ${pathname}`);
  return response;
}

test('berkas .wasm cadangan pemindai kamera: application/wasm (kompilasi streaming) dan cache panjang', () => {
  const response = serve('/assets/zxing_reader-abc123.wasm');
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/wasm');
  expect(response.headers.get('cache-control')).toContain('immutable');
});

describe('berkas PWA', () => {
  test('/sw.js: 200, no-cache, tipe JavaScript', async () => {
    const response = serve('/sw.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('content-type') ?? '').toContain('javascript');
    expect(await response.text()).toContain('addEventListener');
  });

  test('HEAD /sw.js: 200 dan no-cache', () => {
    const response = serve('/sw.js', 'HEAD');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
  });

  test('/manifest.webmanifest: no-cache dan tipe application/manifest+json', async () => {
    const response = serve('/manifest.webmanifest');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(
      (response.headers.get('content-type') ?? '').startsWith('application/manifest+json'),
    ).toBe(true);
    expect(await response.json()).toEqual({ name: 'QC App' });
  });

  test('/workbox-*.js dan ikon (tak berhash di /assets) dijawab no-cache', () => {
    expect(serve('/workbox-abc.js').headers.get('cache-control')).toBe('no-cache');
    expect(serve('/icons/icon-192.png').headers.get('cache-control')).toBe('no-cache');
  });

  test('aset berhash di /assets/ boleh di-cache lama (immutable)', () => {
    expect(serve('/assets/a-abc123.js').headers.get('cache-control')).toContain('immutable');
  });

  test('/sw.js yang tidak ada dijawab 404, bukan index.html', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'qc-static-empty-'));
    try {
      writeFileSync(path.join(empty, 'index.html'), '<!doctype html>');
      const response = serveStatic(empty, 'GET', '/sw.js');
      expect(response?.status).toBe(404);
      expect(await response?.text()).not.toContain('<!doctype html>');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('jalur dinamis dan rute klien', () => {
  test('/auth/callback, /api/ping, dan /sync tidak dilayani sebagai berkas statis (null)', () => {
    expect(serveStatic(dir, 'GET', '/auth/callback')).toBeNull();
    expect(serveStatic(dir, 'GET', '/api/ping')).toBeNull();
    expect(serveStatic(dir, 'GET', '/sync')).toBeNull();
  });

  test('/laporan/<token> (token bertitik) dijawab index.html; berkas tak ada lain tetap 404', async () => {
    const response = serve('/laporan/v1.c1.1799999999.sig_abc-123');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>QC</title>');
    expect(serve('/assets/x.js').status).toBe(404);
    expect(serve('/foo/bar.png').status).toBe(404);
    expect(serve('/laporanx/a.b').status).toBe(404);
  });

  test('rute klien (/handover) dijawab index.html dengan no-cache', async () => {
    const response = serve('/handover');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.text()).toContain('<title>QC</title>');
  });
});
