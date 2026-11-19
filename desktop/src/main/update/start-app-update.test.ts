import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QcUpdateProvider } from './app-update-provider';
import type { AppUpdaterLike } from './app-updater';
import { startAppUpdate } from './start-app-update';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

function fakeUpdater() {
  const calls: string[] = [];
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    disableDifferentialDownload: false,
    logger: null as unknown,
    updateConfigPath: null as string | null,
    setFeedURL: vi.fn((options: unknown) => {
      calls.push('setFeedURL');
      return options;
    }),
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
  };
  return { updater: updater as typeof updater & AppUpdaterLike, calls };
}

describe('startAppUpdate', () => {
  it('menulis app-update.yml sendiri, memakai provider kustom, dan memulai pengendali', async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'qc-upd-'));
    dirs.push(dir);
    const { updater } = fakeUpdater();
    const logs: string[] = [];
    const handle = await startAppUpdate({
      loadUpdater: async () => updater,
      configDir: dir,
      serverUrl: 'https://qc.example.test',
      publicKeyPem: 'PEM',
      installedVersion: '1.0.0',
      arch: 'x64',
      fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      isBusy: () => false,
      log: (message) => logs.push(message),
    });
    // Konfigurasi updater: berkas buatan kita (updaterCacheDirName wajib ada agar unduhan tak gagal ENOENT).
    const yml = readFileSync(join(dir, 'app-update.yml'), 'utf8');
    expect(yml).toContain('provider: custom');
    expect(yml).toContain('updaterCacheDirName: qc-app-updater');
    expect(updater.updateConfigPath).toBe(join(dir, 'app-update.yml'));
    // Provider kustom kita dengan origin server QC.
    expect(updater.setFeedURL).toHaveBeenCalledTimes(1);
    const options = updater.setFeedURL.mock.calls[0]?.[0] as {
      provider: string;
      updateProvider: unknown;
      serverUrl: string;
      arch: string;
      installedVersion: string;
    };
    expect(options.provider).toBe('custom');
    expect(options.updateProvider).toBe(QcUpdateProvider);
    expect(options.serverUrl).toBe('https://qc.example.test');
    expect(options.arch).toBe('x64');
    expect(options.installedVersion).toBe('1.0.0');
    // Pengendali dimulai: tanpa unduh otomatis.
    expect(updater.autoDownload).toBe(false);
    expect(updater.disableDifferentialDownload).toBe(true);
    handle.stop();
  });

  it('log updater diarahkan ke log kita (tanpa console bawaan)', async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'qc-upd-'));
    dirs.push(dir);
    const { updater } = fakeUpdater();
    const logs: string[] = [];
    const handle = await startAppUpdate({
      loadUpdater: async () => updater,
      configDir: dir,
      serverUrl: 'https://qc.example.test',
      publicKeyPem: 'PEM',
      installedVersion: '1.0.0',
      arch: 'arm64',
      fetchImpl: fetch,
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      isBusy: () => false,
      log: (message) => logs.push(message),
    });
    const logger = updater.logger as {
      info(m: unknown): void;
      warn(m: unknown): void;
      error(m: unknown): void;
    };
    logger.warn('peringatan');
    logger.error('galat');
    expect(logs.join('\n')).toContain('peringatan');
    expect(logs.join('\n')).toContain('galat');
    handle.stop();
  });
});
