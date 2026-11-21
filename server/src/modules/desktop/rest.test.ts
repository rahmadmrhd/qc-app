import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { app } from '@server/app';
import { bytesToBase64 } from '@server/core/bytes';
import { seedUser } from '@server-test/access-fixtures';
import { jsonOf, restClient } from '@server-test/rest-client';
import { createTestEnv, type TestEnv } from '@server-test/test-env';
import {
  type DesktopReleaseManifest,
  installerName,
  manifestFileName,
  signatureFileName,
} from '@shared/desktop-release';

setDefaultTimeout(60_000);

const FOLDER = 'RELEASESFOLDER01';
const SIG = 'c'.repeat(86);
const SHA = `${'A'.repeat(86)}==`;
const B64 = (text: string) => bytesToBase64(new TextEncoder().encode(text));

let env: TestEnv;

function restWith(overrides: Record<string, unknown> = {}) {
  return restClient({ ...env, DESKTOP_RELEASES_FOLDER_ID: FOLDER, ...overrides } as TestEnv, app);
}

async function seedRelease(version: string, options: { signed?: boolean } = {}) {
  const manifest: DesktopReleaseManifest = {
    schema: 1,
    version,
    publishedAt: '2026-11-18T10:00:00.000Z',
    files: (['x64', 'arm64'] as const).map((arch) => ({
      name: installerName(version, arch),
      arch,
      size: 5,
      sha512: SHA,
    })),
    changelog: `Catatan ${version}`,
  };
  for (const file of manifest.files) {
    await env.BRIDGE.createFile(FOLDER, file.name, 'application/octet-stream', B64('12345'));
  }
  await env.BRIDGE.createFile(
    FOLDER,
    manifestFileName(version),
    'application/json',
    B64(JSON.stringify(manifest)),
  );
  if (options.signed !== false) {
    await env.BRIDGE.createFile(FOLDER, signatureFileName(version), 'text/plain', B64(SIG));
  }
}

beforeEach(async () => {
  env = await createTestEnv();
  // Pengguna tanpa izin modul apa pun: rute ini hanya butuh sesi aktif.
  await seedUser(env, { id: 'u-minim', email: 'minim@gmail.com' });
});

describe('desktop.releases', () => {
  test('tanpa sesi = 401', async () => {
    const response = await restWith().get('/desktop/releases', { email: null });
    expect(response.status).toBe(401);
  });

  test('folder rilis belum dikonfigurasi = enabled false dan daftar kosong', async () => {
    const response = await restWith({ DESKTOP_RELEASES_FOLDER_ID: '' }).get('/desktop/releases');
    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toEqual({ enabled: false, releases: [] });
  });

  test('dua versi sah: enabled, urut menurun, tiap berkas ber-url publik', async () => {
    await seedRelease('1.2.0');
    await seedRelease('1.10.0');
    const response = await restWith().get('/desktop/releases');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      enabled: boolean;
      releases: { version: string; files: { arch: string; url: string; sha512: string }[] }[];
    };
    expect(body.enabled).toBe(true);
    expect(body.releases.map((release) => release.version)).toEqual(['1.10.0', '1.2.0']);
    const first = body.releases[0]?.files[0];
    expect(first?.arch).toBe('x64');
    expect(first?.url).toBe('/api/desktop/app-file/1.10.0/QC-App-Setup-1.10.0-x64.exe');
    expect(first?.sha512).toMatch(/^[0-9a-f]{128}$/);
  });

  test('versi yang ditarik (.sig dihapus) tidak muncul', async () => {
    await seedRelease('1.0.0');
    await seedRelease('1.1.0', { signed: false });
    const body = (await (await restWith().get('/desktop/releases')).json()) as {
      releases: { version: string }[];
    };
    expect(body.releases.map((release) => release.version)).toEqual(['1.0.0']);
  });

  test('galat Drive tidak bocor: 200 dengan daftar kosong', async () => {
    await seedRelease('1.0.0');
    env.BRIDGE.failNext('listFolder', new Error('drive-rahasia-xyz'));
    const response = await restWith().get('/desktop/releases');
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('drive-rahasia-xyz');
    expect(JSON.parse(text)).toEqual({ enabled: true, releases: [] });
  });

  test('pengguna tanpa izin modul apa pun tetap 200', async () => {
    await seedRelease('1.0.0');
    const response = await restWith().get('/desktop/releases', { email: 'minim@gmail.com' });
    expect(response.status).toBe(200);
  });
});
