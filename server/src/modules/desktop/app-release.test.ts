import { beforeEach, describe, expect, test } from 'bun:test';
import { bytesToBase64 } from '@server/core/bytes';
import { createFakeBridge, type FakeBridge } from '@server-test/fake-bridge';
import {
  type DesktopReleaseManifest,
  installerName,
  manifestFileName,
  type ReleaseArch,
  signatureFileName,
} from '@shared/desktop-release';
import { createReleaseReader } from './app-release';

const FOLDER = 'RELEASESFOLDER01';
const SIG = 'c'.repeat(86);
const SHA = `${'A'.repeat(86)}==`;
const B64 = (text: string) => bytesToBase64(new TextEncoder().encode(text));

let bridge: FakeBridge;
let now: number;
beforeEach(() => {
  bridge = createFakeBridge();
  now = 1_000_000;
});

const reader = (ttlMs = 5 * 60 * 1000) =>
  createReleaseReader({ client: bridge, folderId: FOLDER, now: () => now, ttlMs });

interface SeedOptions {
  archs?: ReleaseArch[];
  signed?: boolean;
  json?: string;
  installers?: boolean;
}

/** Menaruh satu rilis di folder palsu: installer 5 byte per arch, `.json` kanonik, `.sig` (opsional). */
async function seed(version: string, options: SeedOptions = {}): Promise<DesktopReleaseManifest> {
  const archs = options.archs ?? ['x64', 'arm64'];
  const manifest: DesktopReleaseManifest = {
    schema: 1,
    version,
    publishedAt: '2026-11-18T10:00:00.000Z',
    files: archs.map((arch) => ({
      name: installerName(version, arch),
      arch,
      size: 5,
      sha512: SHA,
    })),
    changelog: `Catatan ${version}`,
  };
  if (options.installers !== false) {
    for (const file of manifest.files) {
      await bridge.createFile(FOLDER, file.name, 'application/octet-stream', B64('12345'));
    }
  }
  await bridge.createFile(
    FOLDER,
    manifestFileName(version),
    'application/json',
    B64(options.json ?? JSON.stringify(manifest)),
  );
  if (options.signed !== false) {
    await bridge.createFile(FOLDER, signatureFileName(version), 'text/plain', B64(SIG));
  }
  return manifest;
}

describe('createReleaseReader.latest', () => {
  test('memilih versi tertinggi secara numerik (1.10.0 mengalahkan 1.9.0)', async () => {
    await seed('1.9.0');
    await seed('1.10.0');
    const served = await reader().latest('x64');
    expect(served?.version).toBe('1.10.0');
    expect(served?.signature).toBe(SIG);
    expect(served?.manifest).toMatchObject({ version: '1.10.0' });
    expect([...(served?.files.keys() ?? [])]).toContain('QC-App-Setup-1.10.0-x64.exe');
  });

  test('versi tanpa .sig tidak terlihat: jatuh ke versi di bawahnya', async () => {
    await seed('1.1.0');
    await seed('1.2.0', { signed: false });
    expect((await reader().latest('x64'))?.version).toBe('1.1.0');
  });

  test('.sig tanpa .json = versi tak terlihat (bukan galat)', async () => {
    await seed('1.1.0');
    await bridge.createFile(FOLDER, signatureFileName('1.2.0'), 'text/plain', B64(SIG));
    expect((await reader().latest('x64'))?.version).toBe('1.1.0');
  });

  test('manifest tidak kanonik atau .sig bukan 86 karakter base64url diabaikan', async () => {
    await seed('1.1.0');
    const manifest = await seed('1.2.0', { signed: false });
    await bridge.createFile(FOLDER, signatureFileName('1.2.0'), 'text/plain', B64('pendek'));
    expect((await reader().latest('x64'))?.version).toBe('1.1.0');
    await seed('1.3.0', { json: JSON.stringify(manifest, null, 2) });
    expect((await reader().latest('x64'))?.version).toBe('1.1.0');
  });

  test('installer yang tercantum tetapi tak ada (atau ukurannya beda) = versi diabaikan', async () => {
    await seed('1.1.0');
    await seed('1.2.0', { installers: false });
    expect((await reader().latest('x64'))?.version).toBe('1.1.0');
  });

  test('versi tertinggi tanpa berkas untuk arch itu: jatuh ke versi yang punya', async () => {
    await seed('1.1.0');
    await seed('1.2.0', { archs: ['x64'] });
    expect((await reader().latest('arm64'))?.version).toBe('1.1.0');
    expect((await reader().latest('x64'))?.version).toBe('1.2.0');
  });

  test('folder kosong atau tanpa rilis sah = null', async () => {
    expect(await reader().latest('x64')).toBeNull();
    await bridge.createFile(FOLDER, 'catatan.txt', 'text/plain', B64('x'));
    expect(await reader().latest('x64')).toBeNull();
  });

  test('galat baca Drive sesaat tidak dimemo: percobaan berikutnya langsung melihat versi terbaru', async () => {
    await seed('1.1.0');
    await seed('1.2.0');
    const r = reader();
    bridge.failNext('readFile', new Error('drive sesaat'));
    await expect(r.latest('x64')).rejects.toThrow();
    expect((await r.latest('x64'))?.version).toBe('1.2.0');
  });

  test('galat listing Drive dimemo singkat (30 dtk): tidak menggempur Drive, lalu pulih', async () => {
    await seed('1.2.0');
    const r = reader();
    bridge.failNext('listFolder', new Error('drive mati'));
    await expect(r.latest('x64')).rejects.toThrow();
    const listsBefore = bridge.calls.filter((c) => c.action === 'listFolder').length;
    await expect(r.latest('x64')).rejects.toThrow();
    expect(bridge.calls.filter((c) => c.action === 'listFolder').length).toBe(listsBefore);
    now += 31_000;
    expect((await r.latest('x64'))?.version).toBe('1.2.0');
  });

  test('hasil dimemo sampai ttl; sesudahnya folder dibaca ulang', async () => {
    await seed('1.1.0');
    const r = reader(1000);
    await r.latest('x64');
    const lists = () => bridge.calls.filter((c) => c.action === 'listFolder').length;
    const before = lists();
    await r.latest('x64');
    expect(lists()).toBe(before);
    now += 1001;
    await seed('1.2.0');
    expect((await r.latest('x64'))?.version).toBe('1.2.0');
    expect(lists()).toBeGreaterThan(before);
  });
});

describe('createReleaseReader.file', () => {
  test('hanya nama yang tercantum di manifest versi yang terlihat', async () => {
    await seed('1.1.0');
    await seed('1.2.0', { signed: false });
    const r = reader();
    expect(await r.file('1.1.0', 'QC-App-Setup-1.1.0-x64.exe')).toMatchObject({ size: 5 });
    expect(await r.file('1.2.0', 'QC-App-Setup-1.2.0-x64.exe')).toBeNull(); // belum terlihat
    expect(await r.file('1.1.0', 'QC-App-Setup-1.1.0-ia32.exe')).toBeNull();
    expect(await r.file('1.1.0', 'release-1.1.0.json')).toBeNull(); // bukan installer
    expect(await r.file('1.1.0', '../x')).toBeNull();
    expect(await r.file('bukan-versi', 'QC-App-Setup-1.1.0-x64.exe')).toBeNull();
  });
});

describe('createReleaseReader.list', () => {
  test('mendaftar semua versi yang terlihat, menurun secara numerik', async () => {
    await seed('1.0.0');
    await seed('1.2.0');
    await seed('1.10.0');
    const versions = (await reader().list()).map((release) => release.version);
    expect(versions).toEqual(['1.10.0', '1.2.0', '1.0.0']);
  });

  test('versi tak terlihat atau rusak dilewati tanpa menggagalkan versi lain', async () => {
    await seed('1.0.0');
    await seed('1.1.0', { signed: false }); // tanpa .sig = ditarik
    await seed('1.3.0', { installers: false }); // installer yang tercantum tak ada
    await seed('1.4.0', { json: '{bukan json' }); // manifest rusak
    const versions = (await reader().list()).map((release) => release.version);
    expect(versions).toEqual(['1.0.0']);
  });

  test('folder kosong = daftar kosong', async () => {
    expect(await reader().list()).toEqual([]);
  });

  test('galat listing Drive dilempar, tidak ditelan', async () => {
    await seed('1.0.0');
    bridge.failNext('listFolder', new Error('drive mati'));
    await expect(reader().list()).rejects.toThrow();
  });

  test('panggilan kedua dalam masa memo tidak membaca ulang berkas', async () => {
    await seed('1.0.0');
    await seed('1.1.0');
    const r = reader();
    await r.list();
    const reads = () => bridge.calls.filter((c) => c.action === 'readFile').length;
    const before = reads();
    expect((await r.list()).length).toBe(2);
    expect(reads()).toBe(before);
  });
});
