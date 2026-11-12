import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app } from '@server/app';
import { createTestEnv, type TestEnv } from '@server-test/test-env';

let env: TestEnv;
let dist: string;

const MANIFEST = {
  uiVersion: 'a'.repeat(64),
  minBridge: 2,
  files: [{ path: 'index.html', sha256: 'b'.repeat(64), size: 10 }],
  createdAt: 1_700_000_000_000,
};
const MANIFEST_JSON = JSON.stringify(MANIFEST);
const SIGNATURE = 'c'.repeat(86);

const URL_MANIFEST = 'https://qc.test/api/desktop/ui-manifest';
const withDist = (staticDir: string | undefined) => ({ ...env, staticDir });

beforeEach(async () => {
  env = await createTestEnv();
  dist = mkdtempSync(path.join(tmpdir(), 'qc-desktop-route-'));
});

afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

/** mtime tetap (detik bulat): perbandingan memo berdasar mtime tak bergantung presisi sistem berkas. */
const T0 = new Date('2026-01-01T00:00:00.000Z');
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

function publish(): void {
  const manifestPath = path.join(dist, 'ui-manifest.json');
  const sigPath = path.join(dist, 'ui-manifest.sig');
  writeFileSync(manifestPath, MANIFEST_JSON);
  writeFileSync(sigPath, SIGNATURE);
  utimesSync(manifestPath, T0, T0);
  utimesSync(sigPath, T0, T0);
}

describe('GET /api/desktop/ui-manifest', () => {
  test('404 problem+json tanpa .sig (manifest belum ditandatangani)', async () => {
    writeFileSync(path.join(dist, 'ui-manifest.json'), MANIFEST_JSON);
    const response = await app.request(URL_MANIFEST, {}, withDist(dist));
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(((await response.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  test('404 tanpa manifest, folder tak ada, atau staticDir tak diatur', async () => {
    for (const staticDir of [dist, path.join(dist, 'tidak-ada'), undefined]) {
      const response = await app.request(URL_MANIFEST, {}, withDist(staticDir));
      expect(response.status).toBe(404);
    }
  });

  test('200 tanpa sesi: manifest + signature, ETag, Cache-Control no-cache', async () => {
    publish();
    const response = await app.request(URL_MANIFEST, {}, withDist(dist));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    const body = (await response.json()) as { manifest: unknown; signature: string };
    expect(body.manifest).toEqual(MANIFEST);
    expect(body.signature).toBe(SIGNATURE);
    // bentuk kanonik: desktop memverifikasi JSON.stringify(manifest) = byte berkas yang ditandatangani
    expect(JSON.stringify(body.manifest)).toBe(MANIFEST_JSON);
  });

  test('304 pada If-None-Match yang cocok; ETag berubah bila manifest atau tanda tangan berubah', async () => {
    publish();
    const first = await app.request(URL_MANIFEST, {}, withDist(dist));
    const etag = first.headers.get('etag') as string;
    const cached = await app.request(
      URL_MANIFEST,
      { headers: { 'if-none-match': etag } },
      withDist(dist),
    );
    expect(cached.status).toBe(304);
    expect(cached.headers.get('etag')).toBe(etag);
    expect(await cached.text()).toBe('');
    const stale = await app.request(
      URL_MANIFEST,
      { headers: { 'if-none-match': '"lain"' } },
      withDist(dist),
    );
    expect(stale.status).toBe(200);
    writeFileSync(path.join(dist, 'ui-manifest.sig'), 'd'.repeat(86));
    utimesSync(path.join(dist, 'ui-manifest.sig'), later(5), later(5));
    const changed = await app.request(
      URL_MANIFEST,
      { headers: { 'if-none-match': etag } },
      withDist(dist),
    );
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
  });

  test('tidak butuh login atau header CSRF, dan cookie/Bearer tak berpengaruh', async () => {
    publish();
    const variants: Record<string, string>[] = [
      {},
      { cookie: 'qc_session=sampah' },
      { authorization: 'Bearer sampah' },
    ];
    for (const headers of variants) {
      const response = await app.request(URL_MANIFEST, { headers }, withDist(dist));
      expect(response.status).toBe(200);
    }
  });

  test('tidak membocorkan galat internal: manifest rusak, bukan JSON objek, atau .sig terlalu besar', async () => {
    const cases: [string, string][] = [
      ['{rusak', SIGNATURE],
      ['null', SIGNATURE],
      ['[]', SIGNATURE],
      [MANIFEST_JSON, 'x'.repeat(5000)],
      [MANIFEST_JSON, ''],
      [MANIFEST_JSON, 'tanda tangan dengan spasi'],
    ];
    for (const [manifest, signature] of cases) {
      writeFileSync(path.join(dist, 'ui-manifest.json'), manifest);
      writeFileSync(path.join(dist, 'ui-manifest.sig'), signature);
      const response = await app.request(URL_MANIFEST, {}, withDist(dist));
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).not.toContain(dist);
      expect(text).not.toContain('SyntaxError');
      expect(text).not.toContain('ENOENT');
    }
    // folder sebagai berkas (EISDIR) tidak menjadi 500 dan tak menampilkan jalur
    rmSync(path.join(dist, 'ui-manifest.json'));
    mkdirSync(path.join(dist, 'ui-manifest.json'));
    writeFileSync(path.join(dist, 'ui-manifest.sig'), SIGNATURE);
    const response = await app.request(URL_MANIFEST, {}, withDist(dist));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(dist);
  });

  test('memo per proses berdasar mtime+size: dipakai selama sama, diperbarui bila berkas berubah', async () => {
    publish();
    const manifestPath = path.join(dist, 'ui-manifest.json');
    const sigPath = path.join(dist, 'ui-manifest.sig');
    const first = await app.request(URL_MANIFEST, {}, withDist(dist));
    const firstBody = (await first.json()) as { manifest: { uiVersion: string } };
    expect(firstBody.manifest.uiVersion).toBe('a'.repeat(64));

    // isi berbeda tetapi ukuran dan mtime sama: memo dipakai (bukti tak membaca ulang)
    const other = MANIFEST_JSON.replace('a'.repeat(64), 'e'.repeat(64));
    expect(other.length).toBe(MANIFEST_JSON.length);
    writeFileSync(manifestPath, other);
    utimesSync(manifestPath, T0, T0);
    const memo = await app.request(URL_MANIFEST, {}, withDist(dist));
    expect(((await memo.json()) as { manifest: { uiVersion: string } }).manifest.uiVersion).toBe(
      'a'.repeat(64),
    );

    // mtime berubah: memo basi diperbarui
    utimesSync(manifestPath, later(5), later(5));
    const fresh = await app.request(URL_MANIFEST, {}, withDist(dist));
    expect(((await fresh.json()) as { manifest: { uiVersion: string } }).manifest.uiVersion).toBe(
      'e'.repeat(64),
    );

    // tanda tangan berubah (ukuran sama, mtime berbeda): ikut diperbarui
    writeFileSync(sigPath, 'd'.repeat(86));
    utimesSync(sigPath, later(5), later(5));
    const resigned = await app.request(URL_MANIFEST, {}, withDist(dist));
    expect(((await resigned.json()) as { signature: string }).signature).toBe('d'.repeat(86));

    // berkas dihapus: 404 (memo tak menyajikan manifest yang sudah hilang)
    rmSync(sigPath);
    expect((await app.request(URL_MANIFEST, {}, withDist(dist))).status).toBe(404);
  });

  test('manifest di atas 2 MB ditolak (404) tanpa menyajikan isinya', async () => {
    const huge = JSON.stringify({ ...MANIFEST, pad: 'x'.repeat(2 * 1024 * 1024 + 10) });
    writeFileSync(path.join(dist, 'ui-manifest.json'), huge);
    writeFileSync(path.join(dist, 'ui-manifest.sig'), SIGNATURE);
    const response = await app.request(URL_MANIFEST, {}, withDist(dist));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('xxxx');
  });

  test('awalan /api lain tak membelokkan rute; jalur turunan dan metode tulis tidak dikenal', async () => {
    publish();
    const unknown = await app.request('https://qc.test/api/desktop/lain', {}, withDist(dist));
    expect(unknown.status).toBe(404);
    const write = await app.request(
      URL_MANIFEST,
      { method: 'POST', headers: { 'X-Requested-With': 'qc' } },
      withDist(dist),
    );
    expect(write.status).toBe(404);
    const noCsrf = await app.request(URL_MANIFEST, { method: 'POST' }, withDist(dist));
    expect(noCsrf.status).toBe(403);
    // rute REST biasa tak terpengaruh
    const rest = await app.request('https://qc.test/api/v1/me', {}, withDist(dist));
    expect(rest.status).toBe(401);
  });
});
