// Menjaga asumsi yang dipakai pembaruan otomatis (spek desktop 4.2/5.5, rencana Task 1): `electron-updater` menyediakan
// kelas `Provider` yang dapat diturunkan dan `setFeedURL({ provider: 'custom', updateProvider })`, jadi sumber unduhan
// dan verifikasi tanda tangan sepenuhnya milik kita. Tes ini gagal bila versi paket diganti dan kontraknya berubah.
import { AppUpdater, NsisUpdater, Provider } from 'electron-updater';
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider';
import { describe, expect, it } from 'vitest';

describe('kontrak electron-updater untuk provider kustom', () => {
  it('Provider dapat diturunkan dengan getLatestVersion dan resolveFiles', () => {
    class Fake extends Provider<{
      version: string;
      files: never[];
      path: string;
      sha512: string;
      releaseDate: string;
    }> {
      async getLatestVersion() {
        return { version: '1.0.0', files: [], path: '', sha512: '', releaseDate: '' };
      }
      resolveFiles() {
        return [];
      }
    }
    expect(typeof Provider).toBe('function');
    expect(Fake.prototype.getLatestVersion).toBeTypeOf('function');
    expect(Fake.prototype.resolveFiles).toBeTypeOf('function');
  });

  it('pembaruan NSIS mendukung setFeedURL, unduh manual, dan pasang-ulang', () => {
    for (const name of ['setFeedURL', 'checkForUpdates', 'downloadUpdate', 'quitAndInstall']) {
      expect(NsisUpdater.prototype[name as keyof NsisUpdater], name).toBeTypeOf('function');
    }
    expect(AppUpdater).toBeTypeOf('function');
  });
});

describe('pabrik provider kustom (kode sumber electron-updater 6.8.11)', () => {
  it('createClient menjalankan konstruktor updateProvider dengan (opsi, updater, runtime) tanpa berkas app-update.yml', async () => {
    const { createClient } = await import('electron-updater/out/providerFactory');
    const seen: unknown[] = [];
    class Fake extends Provider<{
      version: string;
      files: never[];
      path: string;
      sha512: string;
      releaseDate: string;
    }> {
      constructor(options: unknown, updater: unknown, runtime: ProviderRuntimeOptions) {
        super(runtime);
        seen.push(options, updater);
      }
      async getLatestVersion() {
        return { version: '1.0.0', files: [], path: '', sha512: '', releaseDate: '' };
      }
      resolveFiles() {
        return [];
      }
    }
    const updater = { marker: 'updater' };
    const options = { provider: 'custom', updateProvider: Fake, serverUrl: 'https://qc.example' };
    const runtime = { isUseMultipleRangeRequest: false, platform: 'win32', executor: {} };
    const client = createClient(options as never, updater as never, runtime as never);
    expect(client).toBeInstanceOf(Fake);
    expect(seen[0]).toBe(options);
    expect(seen[1]).toBe(updater);
  });

  it('opsi custom tanpa updateProvider ditolak', async () => {
    const { createClient } = await import('electron-updater/out/providerFactory');
    expect(() => createClient({ provider: 'custom' } as never, {} as never, {} as never)).toThrow(
      /Custom provider not specified/,
    );
  });
});
