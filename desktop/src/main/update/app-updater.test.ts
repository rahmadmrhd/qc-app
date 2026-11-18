import { describe, expect, it, vi } from 'vitest';
import {
  type AppUpdaterLike,
  CHECK_INTERVAL_MS,
  createAppUpdater,
  START_DELAY_MS,
  shouldRunAppUpdater,
} from './app-updater';

describe('shouldRunAppUpdater', () => {
  const base = {
    isPackaged: true,
    smoke: false,
    smokeUi: false,
    serverUrl: 'https://qc.example.test',
    publicKeyPem: 'PEM',
  };
  it('aktif hanya bila dikemas, bukan smoke, serverUrl sah, dan kunci publik ada', () => {
    expect(shouldRunAppUpdater(base)).toBe(true);
    expect(shouldRunAppUpdater({ ...base, isPackaged: false })).toBe(false);
    expect(shouldRunAppUpdater({ ...base, smoke: true })).toBe(false);
    expect(shouldRunAppUpdater({ ...base, smokeUi: true })).toBe(false);
    expect(shouldRunAppUpdater({ ...base, publicKeyPem: null })).toBe(false);
    expect(shouldRunAppUpdater({ ...base, serverUrl: 'http://qc.example.test' })).toBe(false);
    expect(shouldRunAppUpdater({ ...base, serverUrl: 'bukan url' })).toBe(false);
  });
  it('http localhost (pengembangan) sah', () => {
    expect(shouldRunAppUpdater({ ...base, serverUrl: 'http://localhost:8788' })).toBe(true);
  });
});

interface Harness {
  updater: AppUpdaterLike & {
    checkForUpdates: ReturnType<typeof vi.fn>;
    downloadUpdate: ReturnType<typeof vi.fn>;
    quitAndInstall: ReturnType<typeof vi.fn>;
  };
  showMessageBox: ReturnType<typeof vi.fn>;
  logs: string[];
  timers: Array<{ id: number; fn: () => void; ms: number; cleared: boolean }>;
  busy: { value: boolean };
  api: ReturnType<typeof createAppUpdater>;
  runTimer: (index?: number) => Promise<void>;
}

const available = (version: string, notes: string | null = 'Perbaikan kecil.') => ({
  isUpdateAvailable: true,
  updateInfo: { version, releaseNotes: notes },
});
const none = () => ({ isUpdateAvailable: false, updateInfo: { version: '1.0.0' } });

function harness(answers: number[], checkResult: unknown = available('1.1.0')): Harness {
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    disableDifferentialDownload: false,
    checkForUpdates: vi.fn(async () => checkResult),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
  } as Harness['updater'];
  const queue = [...answers];
  const showMessageBox = vi.fn(async () => ({ response: queue.shift() ?? 1 }));
  const logs: string[] = [];
  const timers: Harness['timers'] = [];
  const busy = { value: false };
  const api = createAppUpdater({
    updater,
    dialog: { showMessageBox },
    isBusy: () => busy.value,
    log: (message) => logs.push(message),
    setTimer: (fn, ms) => {
      const entry = { id: timers.length, fn, ms, cleared: false };
      timers.push(entry);
      return entry.id;
    },
    clearTimer: (handle) => {
      const entry = timers[handle as number];
      if (entry) entry.cleared = true;
    },
  });
  return {
    updater,
    showMessageBox,
    logs,
    timers,
    busy,
    api,
    runTimer: async (index = timers.length - 1) => {
      timers[index]?.fn();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

const lastTimer = (h: Harness) => h.timers.filter((t) => !t.cleared).at(-1);

describe('createAppUpdater', () => {
  it('start: mematikan unduh otomatis dan diff, menunda cek pertama, lalu mengulang tiap 6 jam', async () => {
    const h = harness([1], none());
    h.api.start();
    expect(h.updater.autoDownload).toBe(false);
    expect(h.updater.disableDifferentialDownload).toBe(true);
    expect(h.updater.checkForUpdates).not.toHaveBeenCalled();
    expect(lastTimer(h)?.ms).toBe(START_DELAY_MS);
    await h.runTimer();
    expect(h.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(lastTimer(h)?.ms).toBe(CHECK_INTERVAL_MS);
    expect(CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('pembaruan sah menampilkan dialog berisi versi dan catatan; tanpa pembaruan tidak ada dialog', async () => {
    const h = harness([1], available('1.1.0', 'Catatan penting.'));
    await h.api.checkNow();
    expect(h.showMessageBox).toHaveBeenCalledTimes(1);
    const options = h.showMessageBox.mock.calls[0]?.[0] as {
      message: string;
      detail: string;
      buttons: string[];
    };
    expect(options.message).toContain('1.1.0');
    expect(options.detail).toContain('Catatan penting.');
    expect(options.buttons).toEqual(['Perbarui sekarang', 'Nanti']);
    const quiet = harness([], none());
    await quiet.api.checkNow();
    expect(quiet.showMessageBox).not.toHaveBeenCalled();
  });

  it('catatan panjang dipotong; catatan kosong tetap menampilkan dialog', async () => {
    const h = harness([1], available('1.1.0', 'x'.repeat(5000)));
    await h.api.checkNow();
    const detail = (h.showMessageBox.mock.calls[0]?.[0] as { detail: string }).detail;
    expect(detail.length).toBeLessThan(700);
    const empty = harness([1], available('1.1.0', null));
    await empty.api.checkNow();
    expect(empty.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('"Nanti": tak mengunduh dan tak bertanya lagi untuk versi yang sama pada sesi itu', async () => {
    const h = harness([1, 1]);
    await h.api.checkNow();
    await h.api.checkNow();
    expect(h.showMessageBox).toHaveBeenCalledTimes(1);
    expect(h.updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('versi yang lebih baru lagi ditawarkan walau versi sebelumnya ditunda', async () => {
    const h = harness([1, 1], available('1.1.0'));
    await h.api.checkNow();
    h.updater.checkForUpdates.mockResolvedValue(available('1.2.0'));
    await h.api.checkNow();
    expect(h.showMessageBox).toHaveBeenCalledTimes(2);
  });

  it('"Perbarui sekarang": mengunduh lalu menawarkan restart; "Mulai ulang" memanggil quitAndInstall', async () => {
    const h = harness([0, 0]);
    await h.api.checkNow();
    expect(h.updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(h.showMessageBox).toHaveBeenCalledTimes(2);
    expect(h.updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(h.updater.autoInstallOnAppQuit).toBe(true);
  });

  it('"Saat keluar" setelah unduh: tidak restart, tetap dipasang saat keluar', async () => {
    const h = harness([0, 1]);
    await h.api.checkNow();
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
    expect(h.updater.autoInstallOnAppQuit).toBe(true);
  });

  it('inject berjalan: tawaran restart ditunda (dicoba lagi), tak pernah quitAndInstall saat sibuk', async () => {
    const h = harness([0, 0]);
    // Inject dimulai SETELAH pengguna memilih "Perbarui sekarang" (selagi dialog pertama terbuka/unduhan berjalan).
    h.showMessageBox.mockImplementationOnce(async () => {
      h.busy.value = true;
      return { response: 0 };
    });
    await h.api.checkNow();
    expect(h.showMessageBox).toHaveBeenCalledTimes(1); // hanya dialog pertama
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
    expect(h.updater.autoInstallOnAppQuit).toBe(true);
    h.busy.value = false;
    await h.runTimer();
    expect(h.showMessageBox).toHaveBeenCalledTimes(2);
    expect(h.updater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('cek saat inject berjalan dilewati; galat dicatat tanpa melempar', async () => {
    const h = harness([1]);
    h.busy.value = true;
    await h.api.checkNow();
    expect(h.updater.checkForUpdates).not.toHaveBeenCalled();
    h.busy.value = false;
    h.updater.checkForUpdates.mockRejectedValue(new Error('jaringan putus'));
    await expect(h.api.checkNow()).resolves.toBeUndefined();
    expect(h.logs.length).toBeGreaterThan(0);
    expect(h.logs.join(' ')).not.toMatch(/github|rahmad|qc-app/i);
  });

  it('galat unduh dicatat dan tidak menjatuhkan aplikasi', async () => {
    const h = harness([0]);
    h.updater.downloadUpdate.mockRejectedValue(new Error('terputus'));
    await expect(h.api.checkNow()).resolves.toBeUndefined();
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('checkNow bersamaan hanya satu yang berjalan', async () => {
    const h = harness([1]);
    await Promise.all([h.api.checkNow(), h.api.checkNow()]);
    expect(h.updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('stop membatalkan pewaktu', () => {
    const h = harness([]);
    h.api.start();
    h.api.stop();
    expect(h.timers.every((t) => t.cleared)).toBe(true);
  });
});
