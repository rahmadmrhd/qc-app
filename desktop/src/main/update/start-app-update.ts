// Merangkai pembaruan otomatis di proses utama (spek desktop 5.5, rencana bagian 4): menyiapkan konfigurasi updater,
// provider kustom ke server QC, dan pengendali berkala. Dipisah dari `index.ts` agar dapat diuji dengan updater palsu.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReleaseArch } from '@shared/desktop-release';
import { createUpdateProviderOptions } from './app-update-provider';
import {
  type AppUpdater,
  type AppUpdaterDeps,
  type AppUpdaterLike,
  createAppUpdater,
} from './app-updater';

/** Nama folder cache unduhan updater di bawah cache aplikasi (dibaca `electron-updater` dari berkas konfigurasi). */
const CACHE_DIR_NAME = 'qc-app-updater';

/** Subset `autoUpdater` yang disentuh perakitan ini, di atas yang dipakai pengendali. */
export interface ConfigurableUpdater extends AppUpdaterLike {
  logger: unknown;
  updateConfigPath: string | null;
  setFeedURL(options: unknown): void;
}

export interface StartAppUpdateDeps {
  /** Memuat `autoUpdater` electron-updater (impor dinamis di produksi; palsu di tes). */
  loadUpdater: () => Promise<ConfigurableUpdater>;
  /** Folder untuk `app-update.yml` buatan kita (mis. `<userData>/updater`). */
  configDir: string;
  serverUrl: string;
  publicKeyPem: string;
  installedVersion: string;
  arch: ReleaseArch;
  fetchImpl: typeof fetch;
  dialog: AppUpdaterDeps['dialog'];
  isBusy: () => boolean;
  log: (message: string) => void;
}

export async function startAppUpdate(deps: StartAppUpdateDeps): Promise<AppUpdater> {
  const updater = await deps.loadUpdater();
  // `electron-updater` membaca `updaterCacheDirName` dari app-update.yml saat mengunduh dan gagal bila berkasnya tak
  // ada. Build kita `publish: null` (tak ada berkas bawaan builder), jadi kita menulisnya sendiri dan mengarahkan updater
  // lewat setter publik `updateConfigPath` (dijaga tes kontrak `updater-contract.test.ts`).
  mkdirSync(deps.configDir, { recursive: true });
  const configPath = join(deps.configDir, 'app-update.yml');
  writeFileSync(configPath, `provider: custom\nupdaterCacheDirName: ${CACHE_DIR_NAME}\n`);
  updater.updateConfigPath = configPath;
  updater.logger = {
    info: (message: unknown) => deps.log(String(message)),
    warn: (message: unknown) => deps.log(String(message)),
    error: (message: unknown) => deps.log(String(message)),
  };
  updater.setFeedURL(
    createUpdateProviderOptions({
      serverUrl: deps.serverUrl,
      publicKeyPem: deps.publicKeyPem,
      installedVersion: deps.installedVersion,
      arch: deps.arch,
      fetchImpl: deps.fetchImpl,
      log: deps.log,
    }),
  );
  const controller = createAppUpdater({
    updater,
    dialog: deps.dialog,
    isBusy: deps.isBusy,
    log: deps.log,
    setTimer: (fn, ms) => {
      const handle = setTimeout(fn, ms);
      handle.unref();
      return handle;
    },
    clearTimer: (handle) => clearTimeout(handle as NodeJS.Timeout),
  });
  controller.start();
  return controller;
}
