// Pengendali pembaruan otomatis aplikasi (spek desktop 5.5, rencana bagian 4). Murni terhadap Electron: semua dependensi
// (updater, dialog, pewaktu, status inject) disuntik agar dapat diuji tanpa Electron.
//
// Aturan: cek tertunda saat mulai lalu tiap 6 jam; unduhan TIDAK otomatis (pengguna memilih dulu; "Nanti" dan unduhan gagal
// ditawarkan lagi pada cek berikutnya, versi yang sudah terunduh tidak); pembaruan hanya naik
// (provider yang menjamin); tidak pernah mengecek, meminta restart, atau memasang saat inject Country Lock berjalan (tawaran
// restart ditunda dan dicoba lagi; pemasangan saat keluar tetap berlaku). Dialog bawaan OS, tanpa kanal jembatan baru.
import { normalizeServerUrl } from '../settings';

export const START_DELAY_MS = 90 * 1000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const BUSY_RETRY_MS = 30 * 1000;
const NOTES_MAX_CHARS = 600;

/** Subset `autoUpdater` (electron-updater) yang dipakai; fake di tes. */
export interface AppUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  disableDifferentialDownload: boolean;
  checkForUpdates(): Promise<{
    isUpdateAvailable: boolean;
    updateInfo: { version: string; releaseNotes?: unknown };
  } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface MessageBoxOptions {
  type: 'info';
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: boolean;
}

export interface AppUpdaterDeps {
  updater: AppUpdaterLike;
  dialog: { showMessageBox(options: MessageBoxOptions): Promise<{ response: number }> };
  /** Inject Country Lock berjalan? Selama true tak ada cek, restart, atau pemasangan. */
  isBusy: () => boolean;
  log: (message: string) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface AppUpdater {
  start(): void;
  checkNow(): Promise<void>;
  stop(): void;
}

export function shouldRunAppUpdater(input: {
  isPackaged: boolean;
  smoke: boolean;
  smokeUi: boolean;
  serverUrl: string;
  publicKeyPem: string | null;
}): boolean {
  return (
    input.isPackaged &&
    !input.smoke &&
    !input.smokeUi &&
    input.publicKeyPem !== null &&
    normalizeServerUrl(input.serverUrl) !== null
  );
}

function notesOf(raw: unknown): string {
  if (typeof raw !== 'string') return 'Berisi perbaikan dan peningkatan.';
  const text = raw.trim();
  if (text === '') return 'Berisi perbaikan dan peningkatan.';
  return text.length > NOTES_MAX_CHARS ? `${text.slice(0, NOTES_MAX_CHARS)}…` : text;
}

export function createAppUpdater(deps: AppUpdaterDeps): AppUpdater {
  const { updater, dialog, isBusy, log, setTimer, clearTimer } = deps;
  let running = false;
  let nextCheck: unknown = null;
  let retry: unknown = null;
  /**
   * Versi yang sudah terunduh pada sesi ini: tak ditanyakan atau diunduh lagi (terpasang saat keluar). "Nanti" dan unduhan
   * yang gagal TIDAK dicatat di sini, jadi ditawarkan lagi pada cek berikutnya (spek 5.5; keputusan pemilik 2026-11-18).
   */
  const downloaded = new Set<string>();

  function scheduleCheck(ms: number): void {
    if (nextCheck !== null) clearTimer(nextCheck);
    nextCheck = setTimer(() => {
      void checkNow().finally(() => scheduleCheck(CHECK_INTERVAL_MS));
    }, ms);
  }

  async function offerRestart(version: string): Promise<void> {
    if (isBusy()) {
      // Jangan mengganggu inject yang berjalan; tetap terpasang saat aplikasi ditutup (`autoInstallOnAppQuit`).
      retry = setTimer(() => void offerRestart(version), BUSY_RETRY_MS);
      return;
    }
    const answer = await dialog.showMessageBox({
      type: 'info',
      title: 'Pembaruan siap dipasang',
      message: `QC App ${version} sudah diunduh.`,
      detail:
        'Mulai ulang sekarang buat memasangnya, atau nanti otomatis terpasang saat aplikasi ditutup.',
      buttons: ['Mulai ulang sekarang', 'Nanti saat keluar'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (answer.response === 0) {
      if (isBusy()) {
        retry = setTimer(() => void offerRestart(version), BUSY_RETRY_MS);
        return;
      }
      // Senyap dan jalankan ulang setelah terpasang.
      updater.quitAndInstall(true, true);
    }
  }

  async function checkNow(): Promise<void> {
    if (running || isBusy()) return;
    running = true;
    try {
      const result = await updater.checkForUpdates();
      if (!result?.isUpdateAvailable) return;
      const version = result.updateInfo.version;
      if (downloaded.has(version)) return;
      const answer = await dialog.showMessageBox({
        type: 'info',
        title: 'Pembaruan QC App',
        message: `QC App versi ${version} tersedia.`,
        detail: notesOf(result.updateInfo.releaseNotes),
        buttons: ['Perbarui sekarang', 'Nanti'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (answer.response !== 0) return;
      await updater.downloadUpdate();
      downloaded.add(version);
      updater.autoInstallOnAppQuit = true;
      await offerRestart(version);
    } catch (error) {
      log(`Pembaruan aplikasi gagal: ${String(error).slice(0, 200)}`);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = true;
      // Tanpa berkas blockmap di sumber kita: unduhan penuh saja (diff akan gagal diam-diam lalu jatuh ke penuh).
      updater.disableDifferentialDownload = true;
      scheduleCheck(START_DELAY_MS);
    },
    checkNow,
    stop() {
      if (nextCheck !== null) clearTimer(nextCheck);
      if (retry !== null) clearTimer(retry);
      nextCheck = null;
      retry = null;
    },
  };
}
