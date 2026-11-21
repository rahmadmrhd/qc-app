import { describe, expect, test } from 'bun:test';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicKeyFingerprint, verifyUiManifest } from '../countrylock/src/ui-manifest';
import { createFakeBridge } from '../server/test-support/fake-bridge';
import { removeTempDirSync } from '../server/test-support/safe-rm';
import {
  installerName,
  manifestFileName,
  parseReleaseManifest,
  signatureFileName,
} from '../shared/desktop-release';
import {
  buildReleaseManifest,
  type PreparedRelease,
  pruneInstallers,
  publishRelease,
  signRelease,
  withdrawRelease,
} from './desktop-release';

const FOLDER = 'folder-rilis-1234';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'qc-rel-'));
}

function writeInstallers(
  dir: string,
  version: string,
  bodies = { x64: 'ISI-X64', arm64: 'ISI-ARM' },
) {
  writeFileSync(join(dir, installerName(version, 'x64')), bodies.x64);
  writeFileSync(join(dir, installerName(version, 'arm64')), bodies.arm64);
}

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

const sha512b64 = (text: string) => createHash('sha512').update(text).digest('base64');

describe('buildReleaseManifest', () => {
  test('memuat ukuran dan sha512 base64 kedua installer, kanonik, dan lolos parseReleaseManifest', async () => {
    const dir = tempDir();
    try {
      writeInstallers(dir, '1.2.3');
      const json = await buildReleaseManifest({
        version: '1.2.3',
        dir,
        changelog: 'Perbaikan kecil.',
        publishedAt: '2026-11-18T01:02:03.000Z',
      });
      const manifest = parseReleaseManifest(json);
      expect(manifest).not.toBeNull();
      expect(manifest?.version).toBe('1.2.3');
      expect(manifest?.changelog).toBe('Perbaikan kecil.');
      const x64 = manifest?.files.find((f) => f.arch === 'x64');
      expect(x64).toEqual({
        name: 'QC-App-Setup-1.2.3-x64.exe',
        arch: 'x64',
        size: 'ISI-X64'.length,
        sha512: sha512b64('ISI-X64'),
      });
      expect(manifest?.files.find((f) => f.arch === 'arm64')?.sha512).toBe(sha512b64('ISI-ARM'));
    } finally {
      removeTempDirSync(dir);
    }
  });

  test('installer salah satu arsitektur hilang: gagal dengan pesan yang menyebut nama berkas', async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, installerName('1.2.3', 'x64')), 'x');
      await expect(
        buildReleaseManifest({
          version: '1.2.3',
          dir,
          changelog: '',
          publishedAt: '2026-11-18T00:00:00.000Z',
        }),
      ).rejects.toThrow('QC-App-Setup-1.2.3-arm64.exe');
    } finally {
      removeTempDirSync(dir);
    }
  });

  test('berkas kosong atau versi bukan X.Y.Z ditolak', async () => {
    const dir = tempDir();
    try {
      writeInstallers(dir, '1.2.3', { x64: '', arm64: 'a' });
      await expect(
        buildReleaseManifest({
          version: '1.2.3',
          dir,
          changelog: '',
          publishedAt: '2026-11-18T00:00:00.000Z',
        }),
      ).rejects.toThrow();
      await expect(
        buildReleaseManifest({
          version: '1.2',
          dir,
          changelog: '',
          publishedAt: '2026-11-18T00:00:00.000Z',
        }),
      ).rejects.toThrow();
    } finally {
      removeTempDirSync(dir);
    }
  });
});

describe('signRelease', () => {
  test('tanda tangan lolos verifikasi dengan kunci publik pasangannya', () => {
    const keys = keyPair();
    const dir = tempDir();
    try {
      const file = join(dir, 'x.release-signing-key.pem');
      writeFileSync(file, keys.privatePem);
      const signature = signRelease('{"a":1}', file, keys.publicPem);
      expect(verifyUiManifest('{"a":1}', signature, keys.publicPem)).toBe(true);
    } finally {
      removeTempDirSync(dir);
    }
  });

  test('kunci privat yang tak cocok dengan kunci publik tertanam ditolak (tanpa mencetak kunci)', () => {
    const signer = keyPair();
    const other = keyPair();
    const dir = tempDir();
    try {
      const file = join(dir, 'x.release-signing-key.pem');
      writeFileSync(file, signer.privatePem);
      let message = '';
      try {
        signRelease('{"a":1}', file, other.publicPem);
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain('tidak cocok');
      expect(message).toContain(publicKeyFingerprint(other.publicPem));
      expect(message).not.toContain('PRIVATE');
    } finally {
      removeTempDirSync(dir);
    }
  });

  test('berkas kunci tak terbaca: galat generik', () => {
    expect(() => signRelease('{}', join(tempDir(), 'tidak-ada.pem'), keyPair().publicPem)).toThrow(
      'tidak terbaca',
    );
  });
});

async function prepared(
  version: string,
  bodies?: { x64: string; arm64: string },
): Promise<{
  release: PreparedRelease;
  cleanup: () => void;
}> {
  const dir = tempDir();
  writeInstallers(dir, version, bodies);
  const manifestJson = await buildReleaseManifest({
    version,
    dir,
    changelog: 'catatan',
    publishedAt: '2026-11-18T00:00:00.000Z',
  });
  return {
    release: { version, dir, manifestJson, signature: 'SIGNATURE-BASE64URL' },
    cleanup: () => removeTempDirSync(dir),
  };
}

const namesIn = (bridge: ReturnType<typeof createFakeBridge>) =>
  [...bridge.state.files.values()]
    .filter((f) => !f.trashed)
    .map((f) => f.name)
    .sort();

describe('publishRelease', () => {
  test('mengunggah installer, manifest, lalu tanda tangan TERAKHIR (tanda tangan = versi terlihat)', async () => {
    const bridge = createFakeBridge();
    const { release, cleanup } = await prepared('1.0.0');
    try {
      await publishRelease(bridge, FOLDER, release);
      const uploads = bridge.calls.filter((c) => c.action === 'uploadFile').map((c) => c.args[1]);
      expect(uploads.at(-1)).toBe(signatureFileName('1.0.0'));
      expect(uploads.at(-2)).toBe(manifestFileName('1.0.0'));
      expect(namesIn(bridge)).toEqual(
        [
          installerName('1.0.0', 'arm64'),
          installerName('1.0.0', 'x64'),
          manifestFileName('1.0.0'),
          signatureFileName('1.0.0'),
        ].sort(),
      );
    } finally {
      cleanup();
    }
  });

  test('menghapus tanda tangan lama SEBELUM mengunggah apa pun (versi tak terlihat selama unggah)', async () => {
    const bridge = createFakeBridge();
    const { release, cleanup } = await prepared('1.0.0');
    try {
      await publishRelease(bridge, FOLDER, release);
      bridge.calls.length = 0;
      await publishRelease(bridge, FOLDER, release);
      const firstDelete = bridge.calls.findIndex((c) => c.action === 'deleteFile');
      const firstUpload = bridge.calls.findIndex((c) => c.action === 'uploadFile');
      expect(firstDelete).toBeGreaterThanOrEqual(0);
      expect(firstDelete).toBeLessThan(firstUpload);
    } finally {
      cleanup();
    }
  });

  test('idempoten: unggahan ulang dengan isi sama tidak menduplikasi installer', async () => {
    const bridge = createFakeBridge();
    const { release, cleanup } = await prepared('1.0.0');
    try {
      await publishRelease(bridge, FOLDER, release);
      await publishRelease(bridge, FOLDER, release);
      const names = namesIn(bridge);
      expect(names.filter((n) => n.endsWith('.exe'))).toHaveLength(2);
      expect(new Set(names).size).toBe(names.length);
      // Installer yang sudah cocok tidak diunggah ulang.
      const exeUploads = bridge.calls.filter(
        (c) => c.action === 'uploadFile' && String(c.args[1]).endsWith('.exe'),
      );
      expect(exeUploads).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  test('installer sisa unggahan gagal (isi beda) diganti, bukan dibiarkan ganda', async () => {
    const bridge = createFakeBridge();
    const first = await prepared('1.0.0', { x64: 'LAMA-X64', arm64: 'LAMA-ARM' });
    const second = await prepared('1.0.0', { x64: 'BARU-X64', arm64: 'BARU-ARM' });
    try {
      await publishRelease(bridge, FOLDER, first.release);
      await publishRelease(bridge, FOLDER, second.release);
      const exes = [...bridge.state.files.values()].filter((f) => f.name.endsWith('.exe'));
      expect(exes).toHaveLength(2);
      const bodies = exes.map((f) => Buffer.from(f.base64, 'base64').toString());
      expect(bodies.sort()).toEqual(['BARU-ARM', 'BARU-X64']);
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });

  test('MD5 dari Drive tak cocok: berkas cacat dibuang dan penerbitan gagal TANPA tanda tangan', async () => {
    const bridge = createFakeBridge();
    const { release, cleanup } = await prepared('1.0.0');
    const original = bridge.uploadFile.bind(bridge);
    bridge.uploadFile = async (folderId, name, mime, source, options) => {
      const result = await original(folderId, name, mime, source, options);
      return name.endsWith('x64.exe') ? { ...result, md5Checksum: 'f'.repeat(32) } : result;
    };
    try {
      await expect(publishRelease(bridge, FOLDER, release)).rejects.toThrow('MD5');
      expect(namesIn(bridge)).not.toContain(signatureFileName('1.0.0'));
      expect(namesIn(bridge)).not.toContain(installerName('1.0.0', 'x64'));
    } finally {
      cleanup();
    }
  });

  test('kegagalan di tengah tak pernah meninggalkan tanda tangan (rilis tak terlihat)', async () => {
    const bridge = createFakeBridge();
    const { release, cleanup } = await prepared('1.0.0');
    try {
      let count = 0;
      const original = bridge.uploadFile.bind(bridge);
      bridge.uploadFile = async (...args) => {
        count += 1;
        if (count === 2) throw new Error('jaringan putus');
        return original(...args);
      };
      await expect(publishRelease(bridge, FOLDER, release)).rejects.toThrow('jaringan putus');
      expect(namesIn(bridge)).not.toContain(signatureFileName('1.0.0'));
    } finally {
      cleanup();
    }
  });
});

describe('withdrawRelease', () => {
  test('menghapus hanya tanda tangan versi itu; berkas lain dan versi lain utuh', async () => {
    const bridge = createFakeBridge();
    const a = await prepared('1.0.0');
    const b = await prepared('1.1.0');
    try {
      await publishRelease(bridge, FOLDER, a.release);
      await publishRelease(bridge, FOLDER, b.release);
      await withdrawRelease(bridge, FOLDER, '1.1.0');
      const names = namesIn(bridge);
      expect(names).not.toContain(signatureFileName('1.1.0'));
      expect(names).toContain(signatureFileName('1.0.0'));
      expect(names).toContain(manifestFileName('1.1.0'));
      expect(names).toContain(installerName('1.1.0', 'x64'));
    } finally {
      a.cleanup();
      b.cleanup();
    }
  });

  test('versi yang tak pernah diterbitkan: tidak melempar', async () => {
    await expect(withdrawRelease(createFakeBridge(), FOLDER, '9.9.9')).resolves.toBeUndefined();
  });
});

describe('pruneInstallers', () => {
  async function seed(bridge: ReturnType<typeof createFakeBridge>, versions: string[]) {
    for (const version of versions) {
      const { release, cleanup } = await prepared(version);
      await publishRelease(bridge, FOLDER, release);
      cleanup();
    }
  }

  test('menyimpan N versi terbaru (urutan numerik, 1.10.0 > 1.9.0) dan membuang selebihnya beserta manifest/tanda tangannya', async () => {
    const bridge = createFakeBridge();
    await seed(bridge, ['1.9.0', '1.10.0', '1.2.0', '1.3.0']);
    await pruneInstallers(bridge, FOLDER, 2);
    const names = namesIn(bridge);
    expect(names).toContain(installerName('1.10.0', 'x64'));
    expect(names).toContain(installerName('1.9.0', 'arm64'));
    expect(names).toContain(signatureFileName('1.10.0'));
    expect(names).not.toContain(installerName('1.3.0', 'x64'));
    expect(names).not.toContain(manifestFileName('1.2.0'));
    expect(names).not.toContain(signatureFileName('1.2.0'));
  });

  test('berkas yang bukan nama rilis tidak disentuh; di bawah batas tak ada yang dihapus', async () => {
    const bridge = createFakeBridge();
    await seed(bridge, ['1.0.0', '1.1.0']);
    await bridge.uploadFile(
      FOLDER,
      'catatan-pemilik.txt',
      'text/plain',
      new TextEncoder().encode('x'),
    );
    await pruneInstallers(bridge, FOLDER, 10);
    expect(namesIn(bridge)).toHaveLength(9);
    await pruneInstallers(bridge, FOLDER, 1);
    expect(namesIn(bridge)).toContain('catatan-pemilik.txt');
    expect(namesIn(bridge)).not.toContain(installerName('1.0.0', 'x64'));
  });

  test('versi yang ditarik (tanpa .sig) tidak dihitung ke dalam yang dipertahankan: versi terlihat tak ikut terhapus', async () => {
    const bridge = createFakeBridge();
    await seed(bridge, ['1.0.0', '1.1.0', '1.2.0', '1.3.0']);
    await withdrawRelease(bridge, FOLDER, '1.2.0');
    await withdrawRelease(bridge, FOLDER, '1.3.0');
    await pruneInstallers(bridge, FOLDER, 2);
    const names = namesIn(bridge);
    expect(names).toContain(signatureFileName('1.0.0'));
    expect(names).toContain(signatureFileName('1.1.0'));
    expect(names).toContain(installerName('1.0.0', 'x64'));
    expect(names).toContain(manifestFileName('1.3.0')); // ditarik tetapi di atas batas: dapat diterbitkan ulang
  });

  test('versi yang baru diterbitkan (protect) tak pernah dihapus walau di bawah batas (pemulihan versi lama)', async () => {
    const bridge = createFakeBridge();
    await seed(bridge, ['1.0.0', '1.5.0', '1.6.0']);
    await pruneInstallers(bridge, FOLDER, 2, '1.0.0');
    const names = namesIn(bridge);
    expect(names).toContain(installerName('1.0.0', 'x64'));
    expect(names).toContain(signatureFileName('1.0.0'));
    await pruneInstallers(bridge, FOLDER, 2);
    expect(namesIn(bridge)).not.toContain(installerName('1.0.0', 'x64'));
  });

  test('batas < 1 ditolak (tak pernah menghapus semuanya)', async () => {
    await expect(pruneInstallers(createFakeBridge(), FOLDER, 0)).rejects.toThrow();
  });
});
