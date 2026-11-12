// Entri proses utama QC App Desktop.
//   --smoke     : laporan runtime (Node, ssh2, node:sqlite) tanpa jendela (dipakai verify-pack).
//   --smoke-ui  : memuat app://qc/country-lock di jendela tersembunyi, mencetak
//                 {"bridgeVersion":N} dari window.qcBridge, lalu keluar. Memakai userData sementara
//                 agar tidak menyentuh data/instans pengguna.
//   (biasa)     : instans tunggal; qc://country-lock mengarahkan jendela yang sudah ada.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INJECT_PROGRESS_EVENT } from '@countrylock/bridge-channels';
import { app, type BrowserWindow, dialog, ipcMain, net, protocol, safeStorage } from 'electron';
import { createApiProxy } from './api-proxy';
import { APP_SCHEME, createAppHandler, isAppUrl } from './app-protocol';
import { createTokenStore } from './auth/token-store';
import { readDeviceInfo, readRouterInfo } from './device/info';
import { pingOnce } from './device/ping';
import { registerIpc } from './ipc';
import { loadLocalPackage } from './package/local-folder';
import { parseQcUrl } from './qc-url';
import { createSettingsStore } from './settings';
import { collectSmokeReport } from './smoke';
import { fetchHostKey } from './ssh/host-key';
import { runInjectDetailed } from './ssh/inject-session';
import { openPendingStore } from './store/pending-store';
import { createMainWindow, lockDownSession } from './window';

const smoke = process.argv.includes('--smoke');
const smokeUi = process.argv.includes('--smoke-ui');
const PRELOAD_PATH = fileURLToPath(new URL('../preload/index.cjs', import.meta.url));
const SMOKE_UI_TIMEOUT_MS = 45_000;

// Harus dipanggil sebelum `app` ready.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function uiRoot(): string {
  // Terkemas: UI dasar di samping asar. Pengembangan: hasil `bun run build:web`.
  return app.isPackaged
    ? join(process.resourcesPath, 'ui-baseline')
    : resolve(app.getAppPath(), '..', 'server', 'dist');
}

function routeFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const parsed = arg.startsWith('qc://') ? parseQcUrl(arg) : null;
    if (parsed) return parsed.route;
  }
  return null;
}

if (smoke) {
  collectSmokeReport()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report)}\n`, () => app.exit(0));
    })
    .catch((error: unknown) => {
      process.stderr.write(`smoke gagal: ${String(error)}\n`, () => app.exit(1));
    });
} else if (smokeUi) {
  void runSmokeUi();
} else {
  runApp();
}

async function runSmokeUi(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'qc-smoke-ui-'));
  app.setPath('userData', dataDir);
  const finish = (code: number): void => {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Pembersihan best-effort.
    }
    app.exit(code);
  };
  const timer = setTimeout(() => {
    process.stderr.write('smoke-ui gagal: waktu habis\n', () => finish(1));
  }, SMOKE_UI_TIMEOUT_MS);
  try {
    await app.whenReady();
    protocol.handle(APP_SCHEME, createAppHandler(uiRoot()));
    lockDownSession();
    const win = createMainWindow({
      preloadPath: PRELOAD_PATH,
      route: '/country-lock',
      show: false,
    });
    await new Promise<void>((resolveLoad, rejectLoad) => {
      win.webContents.once('did-finish-load', () => resolveLoad());
      win.webContents.once('did-fail-load', (_e, _code, description) =>
        rejectLoad(new Error(`gagal memuat UI: ${description}`)),
      );
    });
    const version = (await win.webContents.executeJavaScript(
      'window.qcBridge?.version',
    )) as unknown;
    clearTimeout(timer);
    process.stdout.write(`${JSON.stringify({ bridgeVersion: version ?? null })}\n`, () =>
      finish(typeof version === 'number' ? 0 : 1),
    );
  } catch (error) {
    clearTimeout(timer);
    process.stderr.write(`smoke-ui gagal: ${String(error)}\n`, () => finish(1));
  }
}

function runApp(): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let mainWindow: BrowserWindow | null = null;
  const initialRoute = routeFromArgv(process.argv) ?? '/country-lock';

  app.on('second-instance', (_event, argv) => {
    const route = routeFromArgv(argv);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (route) void mainWindow.loadURL(`app://qc${route}`);
    }
  });

  app.whenReady().then(() => {
    lockDownSession();
    // `qc://` didaftarkan hanya pada aplikasi terkemas (tanpa menulis registri saat pengembangan).
    if (app.isPackaged) app.setAsDefaultProtocolClient('qc');

    const userData = app.getPath('userData');
    const settings = createSettingsStore(join(userData, 'settings.json'));
    // Token Bearer: terenkripsi safeStorage bila tersedia; bila tidak, hanya di memori.
    const tokens = createTokenStore(
      join(userData, 'auth.json'),
      safeStorage.isEncryptionAvailable()
        ? {
            encrypt: (plain) => safeStorage.encryptString(plain),
            decrypt: (data) => safeStorage.decryptString(data),
          }
        : null,
    );
    // /api dan /auth diteruskan proses utama ke server (net.fetch); token tak pernah ke renderer.
    const proxy = createApiProxy({
      settings: () => settings.get(),
      tokens,
      fetchImpl: net.fetch as typeof fetch,
      onUnauthenticated: () => undefined,
    });
    protocol.handle(APP_SCHEME, createAppHandler(uiRoot(), proxy));
    let pending: ReturnType<typeof openPendingStore>;
    try {
      pending = openPendingStore(join(userData, 'pending.db'));
    } catch (error) {
      // Berkas pending rusak: beri tahu pengguna, jangan hapus berkasnya.
      dialog.showErrorBox('QC App', error instanceof Error ? error.message : String(error));
      app.exit(1);
      return;
    }

    registerIpc({
      ipcMain,
      settings,
      loadPackage: loadLocalPackage,
      chooseDirectory: async () => {
        const options = { properties: ['openDirectory' as const] };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        return result.canceled ? null : (result.filePaths[0] ?? null);
      },
      ping: pingOnce,
      readDeviceInfo,
      readRouterInfo,
      fetchHostKey,
      runInject: runInjectDetailed,
      pending,
      emitProgress: (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(INJECT_PROGRESS_EVENT, event);
        }
      },
      isTrustedSender: (event) => isAppUrl(event.senderFrame?.url ?? ''),
    });

    mainWindow = createMainWindow({ preloadPath: PRELOAD_PATH, route: initialRoute });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    app.on('will-quit', () => pending.close());
  });

  app.on('window-all-closed', () => app.quit());
}
