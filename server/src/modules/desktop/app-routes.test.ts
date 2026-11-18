import { beforeEach, describe, expect, test } from 'bun:test';
import { app } from '@server/app';
import { bytesToBase64 } from '@server/core/bytes';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  type DesktopReleaseManifest,
  installerName,
  manifestFileName,
  signatureFileName,
} from '@shared/desktop-release';

const FOLDER = 'RELEASESFOLDER01';
const SIG = 'c'.repeat(86);
const SHA = `${'A'.repeat(86)}==`;
const B64 = (text: string) => bytesToBase64(new TextEncoder().encode(text));
const INSTALLER_BYTES = 'BYTE-INSTALLER-1234567890';

let env: TestEnv;
let manifest: DesktopReleaseManifest;
const served = (overrides: Record<string, unknown> = {}) => ({
  ...env,
  DESKTOP_RELEASES_FOLDER_ID: FOLDER,
  clientIp: '203.0.113.9',
  ...overrides,
});

beforeEach(async () => {
  env = await createTestEnv();
  manifest = {
    schema: 1,
    version: '1.2.0',
    publishedAt: '2026-11-18T10:00:00.000Z',
    files: (['x64', 'arm64'] as const).map((arch) => ({
      name: installerName('1.2.0', arch),
      arch,
      size: INSTALLER_BYTES.length,
      sha512: SHA,
    })),
    changelog: 'Catatan untuk pengguna',
  };
  for (const file of manifest.files) {
    await env.BRIDGE.createFile(
      FOLDER,
      file.name,
      'application/octet-stream',
      B64(INSTALLER_BYTES),
    );
  }
  await env.BRIDGE.createFile(
    FOLDER,
    manifestFileName('1.2.0'),
    'application/json',
    B64(JSON.stringify(manifest)),
  );
  await env.BRIDGE.createFile(FOLDER, signatureFileName('1.2.0'), 'text/plain', B64(SIG));
});

const MANIFEST_URL = (query = '?arch=x64') => `https://qc.test/api/desktop/app-manifest${query}`;
const FILE_URL = (version: string, name: string) =>
  `https://qc.test/api/desktop/app-file/${version}/${name}`;

describe('GET /api/desktop/app-manifest', () => {
  test('200 tanpa sesi: { manifest, signature }, ETag, no-cache', async () => {
    const response = await app.request(MANIFEST_URL(), {}, served());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    const body = (await response.json()) as { manifest: DesktopReleaseManifest; signature: string };
    expect(body.manifest).toEqual(manifest);
    expect(body.signature).toBe(SIG);
  });

  test('304 pada If-None-Match yang sama', async () => {
    const first = await app.request(MANIFEST_URL(), {}, served());
    const etag = first.headers.get('etag') ?? '';
    const second = await app.request(
      MANIFEST_URL(),
      { headers: { 'if-none-match': etag } },
      served(),
    );
    expect(second.status).toBe(304);
  });

  test('404 seragam: arch tak dikenal/tanpa arch, folder tak dikonfigurasi, folder kosong', async () => {
    for (const [url, extra] of [
      [MANIFEST_URL('?arch=ia32'), {}],
      [MANIFEST_URL(''), {}],
      [MANIFEST_URL('?arch=x64&arch=arm64x'), {}],
      [MANIFEST_URL(), { DESKTOP_RELEASES_FOLDER_ID: '' }],
      [MANIFEST_URL(), { DESKTOP_RELEASES_FOLDER_ID: 'FOLDERKOSONG0001' }],
    ] as const) {
      const response = await app.request(url, {}, served(extra));
      expect(response.status, url).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
    }
  });

  test('galat Drive dijawab 404 generik tanpa membocorkan penyebab', async () => {
    env.BRIDGE.failNext('listFolder', new Error('drive-rahasia-xyz'));
    const response = await app.request(MANIFEST_URL(), {}, served());
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('rahasia');
  });
});

describe('GET /api/desktop/app-file/<versi>/<nama>', () => {
  test('menyajikan byte installer persis, octet-stream, no-transform, panjang benar', async () => {
    const name = installerName('1.2.0', 'x64');
    const response = await app.request(FILE_URL('1.2.0', name), {}, served());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('cache-control')).toContain('no-transform');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-length')).toBe(String(INSTALLER_BYTES.length));
    expect(await response.text()).toBe(INSTALLER_BYTES);
  });

  test('nama jahat atau tak tercantum = 404 seragam', async () => {
    const good = installerName('1.2.0', 'x64');
    for (const [version, name] of [
      ['1.2.0', '..%2Frelease-1.2.0.json'],
      ['1.2.0', '..%5Cx.exe'],
      ['1.2.0', '%E0%A4%A'],
      ['1.2.0', 'release-1.2.0.json'],
      ['1.2.0', 'release-1.2.0.sig'],
      ['1.2.0', 'QC-App-Setup-1.2.0-ia32.exe'],
      ['1.2.1', installerName('1.2.1', 'x64')],
      ['1.2', good],
      ['..', good],
    ] as const) {
      const response = await app.request(FILE_URL(version, name), {}, served());
      expect(response.status, `${version}/${name}`).toBe(404);
    }
    expect(
      (await app.request('https://qc.test/api/desktop/app-file/1.2.0', {}, served())).status,
    ).toBe(404);
    expect(
      (await app.request(`https://qc.test/api/desktop/app-file/1.2.0/${good}/lebih`, {}, served()))
        .status,
    ).toBe(404);
  });

  test('versi tanpa .sig (ditarik) tidak dapat diunduh', async () => {
    const sig = [...env.BRIDGE.state.files.entries()].find(
      ([, f]) => f.name === signatureFileName('1.2.0'),
    );
    await env.BRIDGE.trashFile(sig?.[0] ?? '');
    const response = await app.request(
      FILE_URL('1.2.0', installerName('1.2.0', 'x64')),
      {},
      served(),
    );
    expect(response.status).toBe(404);
  });

  test('folder tak dikonfigurasi = 404', async () => {
    const response = await app.request(
      FILE_URL('1.2.0', installerName('1.2.0', 'x64')),
      {},
      served({ DESKTOP_RELEASES_FOLDER_ID: '' }),
    );
    expect(response.status).toBe(404);
  });

  test('pembatas laju per IP: lewat batas = 429 problem+json; IP lain tak terpengaruh', async () => {
    const url = FILE_URL('1.2.0', installerName('1.2.0', 'x64'));
    for (let i = 0; i < 60; i++) {
      expect((await app.request(url, {}, served())).status, `permintaan ${i + 1}`).toBe(200);
    }
    const blocked = await app.request(url, {}, served());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('content-type')).toContain('application/problem+json');
    expect((await app.request(url, {}, served({ clientIp: '198.51.100.7' }))).status).toBe(200);
  });
});
