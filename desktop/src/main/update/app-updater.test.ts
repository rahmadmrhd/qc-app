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
    const options = h.showMessageBox.mock.calls[0]?.[0] as { detail: string } | undefined;
    const detail = options?.detail ?? '';
    expect(detail).not.toBe('');
    expect(detail.length).toBeLessThan(700);
    const empty = harness([1], available('1.1.0', null));
    await empty.api.checkNow();
    expect(empty.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('"Nanti": tak mengunduh, lalu ditawarkan lagi pada cek berikutnya (spek 5.5, keputusan pemilik 2026-11-18)', async () => {
    const h = harness([1, 1]);
    await h.api.checkNow();
    expect(h.showMessageBox).toHaveBeenCalledTimes(1);
    expect(h.updater.downloadUpdate).not.toHaveBeenCalled();
    await h.api.checkNow();
    expect(h.showMessageBox).toHaveBeenCalledTimes(2);
    expect(h.updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('versi yang sudah terunduh tidak ditanyakan atau diunduh lagi pada cek berikutnya', async () => {
    const h = harness([0, 1]);
    await h.api.checkNow();
    expect(h.updater.downloadUpdate).toHaveBeenCalledTimes(1);
    await h.api.checkNow();
    expect(h.showMessageBox).toHaveBeenCalledTimes(2); // pilihan awal + tawaran restart, tanpa tawaran baru
    expect(h.updater.downloadUpdate).toHaveBeenCalledTimes(1);
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

  it('unduhan yang gagal dicoba lagi (ditawarkan lagi) pada cek berikutnya', async () => {
    const h = harness([0, 0, 0]);
    h.updater.downloadUpdate.mockRejectedValueOnce(new Error('terputus'));
    await h.api.checkNow();
    expect(h.updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
    await h.api.checkNow();
    expect(h.updater.downloadUpdate).toHaveBeenCalledTimes(2);
    expect(h.updater.quitAndInstall).toHaveBeenCalledWith(true, true);
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

describe('updateNow (layar penahan, tanpa dialog)', () => {
  it('tanpa pembaruan: up-to-date, tanpa dialog dan tanpa quitAndInstall', async () => {
    const h = harness([], none());
    const result = await h.api.updateNow();
    expect(result.status).toBe('up-to-date');
    expect(result.message).not.toBe('');
    expect(h.showMessageBox).not.toHaveBeenCalled();
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('ada pembaruan: unduh, lalu quitAndInstall(true, true) setelah unduhan, tanpa dialog sama sekali', async () => {
    const h = harness([], available('1.1.0'));
    const order: string[] = [];
    h.updater.downloadUpdate.mockImplementation(async () => {
      order.push('download');
      return [];
    });
    h.updater.quitAndInstall.mockImplementation(() => order.push('install'));
    const result = await h.api.updateNow();
    expect(result.status).toBe('restarting');
    expect(order).toEqual(['download', 'install']);
    expect(h.updater.quitAndInstall).toHaveBeenCalledWith(true, true);
    expect(h.updater.autoInstallOnAppQuit).toBe(true);
    expect(h.showMessageBox).not.toHaveBeenCalled();
  });

  it('inject berjalan: busy tanpa memeriksa pembaruan', async () => {
    const h = harness([], available('1.1.0'));
    h.busy.value = true;
    const result = await h.api.updateNow();
    expect(result.status).toBe('busy');
    expect(h.updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('checkForUpdates melempar: failed dan pesan tak memuat isi galat mentah', async () => {
    const h = harness([], available('1.1.0'));
    h.updater.checkForUpdates.mockRejectedValue(new Error('rahasia-xyz'));
    const result = await h.api.updateNow();
    expect(result.status).toBe('failed');
    expect(result.message).not.toContain('rahasia-xyz');
    expect(h.logs.join(' | ')).toContain('rahasia-xyz');
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('downloadUpdate melempar: failed dan quitAndInstall tak dipanggil', async () => {
    const h = harness([], available('1.1.0'));
    h.updater.downloadUpdate.mockRejectedValue(new Error('rahasia-xyz'));
    const result = await h.api.updateNow();
    expect(result.status).toBe('failed');
    expect(result.message).not.toContain('rahasia-xyz');
    expect(h.updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('log galat dipotong 200 karakter seperti checkNow', async () => {
    const h = harness([], available('1.1.0'));
    h.updater.checkForUpdates.mockRejectedValue(new Error('x'.repeat(500)));
    await h.api.updateNow();
    expect(h.logs[0]?.length ?? 0).toBeLessThan(300);
  });

  it('saat checkNow sedang berjalan: busy; panggilan kedua saat updateNow berjalan juga busy', async () => {
    const h = harness([], available('1.1.0'));
    let release: (value: unknown) => void = () => undefined;
    h.updater.checkForUpdates.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );
    const first = h.api.checkNow();
    const second = await h.api.updateNow();
    expect(second.status).toBe('busy');
    release(none());
    await first;
    // updateNow yang sedang menunggu juga menahan panggilan berikutnya.
    h.updater.checkForUpdates.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );
    const running = h.api.updateNow();
    const again = await h.api.updateNow();
    expect(again.status).toBe('busy');
    release(none());
    await running;
  });
});
