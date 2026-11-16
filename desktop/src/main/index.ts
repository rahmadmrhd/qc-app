// Entri proses utama QC App Desktop.
//   --smoke     : laporan runtime (Node, ssh2, node:sqlite) tanpa jendela (dipakai verify-pack).
//   --smoke-ui  : memuat app://qc/country-lock di jendela tersembunyi, mencetak
//                 {"bridgeVersion":N} dari window.qcBridge, lalu keluar. Memakai userData sementara
//                 agar tidak menyentuh data/instans pengguna.
//   (biasa)     : instans tunggal; qc://country-lock mengarahkan jendela yang sudah ada.

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTH_CHANGE_EVENT,
  BRIDGE_VERSION,
  INJECT_PROGRESS_EVENT,
  UI_UPDATE_READY_EVENT,
} from '@countrylock/bridge-channels';
import {
  app,
  type BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  shell,
} from 'electron';
import { createApiProxy } from './api-proxy';
import { APP_ORIGIN, APP_SCHEME, createAppHandler, isAppUrl } from './app-protocol';
import { createHandoffFlow, type HandoffFlow, type HandoffInput } from './auth/handoff-flow';
import { createLoginFlow, LOGIN_MAX_AGE_MS, type LoginFlow } from './auth/login-flow';
import { closeLoginWindow, openLoginWindow } from './auth/login-window';
import { LOGIN_SUCCESS_TITLE, startLoopback } from './auth/loopback';
import { createTokenStore } from './auth/token-store';
import { readDeviceInfo, readRouterInfo } from './device/info';
import { pingOnce } from './device/ping';
import { registerIpc } from './ipc';
import {
  createTrayController,
  notificationsSupported,
  showOsNotification,
} from './notify/background';
import { forwardNotificationsChanged } from './notify/forward';
import { createNotificationStream } from './notify/notification-stream';
import { createNotifier } from './notify/notifier';
import { loadLocalPackage } from './package/local-folder';
import { devProtocolRegistration } from './protocol-registration';
import { parseQcUrl } from './qc-url';
import { createSettingsStore } from './settings';
import { collectSmokeReport } from './smoke';
import { fetchHostKey } from './ssh/host-key';
import { runInjectDetailed } from './ssh/inject-session';
import { openPendingStore } from './store/pending-store';
import { UI_PUBLIC_KEY_PEM } from './ui/public-key';
import { createReloadGate, type ReloadGate } from './ui/reload-gate';
import { createRenderProbe, RENDER_PROBE_TIMEOUT_MS } from './ui/render-probe';
import { createUiBundleManager } from './ui/ui-bundle';
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
    if (parsed?.route) return parsed.route;
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

/** URL `qc://auth?...` pada argumen proses (cold start atau second-instance). */
function authUrlsFromArgv(argv: readonly string[]): string[] {
  return argv.filter((arg) => arg.startsWith('qc://') && parseQcUrl(arg)?.auth !== undefined);
}

/** Serah-terima dari peramban: `qc://country-lock?handoff=...` pada argumen proses (cold start atau second-instance). */
function handoffsFromArgv(argv: readonly string[]): HandoffInput[] {
  const found: HandoffInput[] = [];
  for (const arg of argv) {
    const handoff = arg.startsWith('qc://') ? parseQcUrl(arg)?.handoff : undefined;
    if (handoff) found.push(handoff);
  }
  return found;
}

/** ProgId peramban bawaan Windows untuk https (registri `UserChoice`); `null` bila tak terbaca. */
function readDefaultProgId(): Promise<string | null> {
  return new Promise((resolveProgId) => {
    execFile(
      'reg.exe',
      [
        'query',
        String.raw`HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice`,
        '/v',
        'ProgId',
      ],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        const match = error ? null : /ProgId\s+REG_SZ\s+(\S+)/i.exec(stdout);
        resolveProgId(match?.[1] ?? null);
      },
    );
  });
}

/** Menjalankan program (tanpa shell) dan menunggu selesai; menolak bila gagal atau lewat batas waktu. */
function runProgram(file: string, args: string[]): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    execFile(file, args, { windowsHide: true, timeout: 15_000 }, (error) =>
      error ? rejectRun(error) : resolveRun(),
    );
  });
}

/** Meluncurkan proses terlepas tanpa shell (URL sebagai satu argumen); menolak bila gagal diluncurkan. */
function launchDetached(exe: string, args: string[]): Promise<void> {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', shell: false });
    child.once('error', rejectLaunch);
    child.once('spawn', () => {
      child.unref();
      resolveLaunch();
    });
  });
}

/** Peramban sistem hanya dibuka untuk https atau http localhost/127.0.0.1 (pengembangan). */
function isOpenableLoginUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return true;
    return (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

/** Masa tenang setelah inject berakhir sebelum halaman tertunda dimuat (pending.add renderer). */
const RELOAD_SETTLE_MS = 1500;
const RENDER_PROBE_INTERVAL_MS = 500;
/** Akar web (`<div id="app">` di web/index.html) berisi anak = React sudah mount. */
const ROOT_FILLED_SCRIPT = "(document.getElementById('app')?.childElementCount ?? 0) > 0";

function runApp(): void {
  // Identitas aplikasi untuk notifikasi Windows (harus sama dengan `appId` electron-builder agar toast tampil
  // dengan nama/ikon QC App dan kliknya sampai ke proses ini).
  app.setAppUserModelId('id.my.rhd.qc-app');
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let mainWindow: BrowserWindow | null = null;
  let loginFlow: LoginFlow | null = null;
  let reloadGate: ReloadGate | null = null;
  const initialRoute = routeFromArgv(process.argv) ?? '/country-lock';
  // Callback yang tiba sebelum aplikasi siap ditahan; alur login hanya menerima yang cocok dengan
  // login yang sedang berjalan, jadi URL asing/ulang diabaikan olehnya.
  const earlyAuthUrls: string[] = authUrlsFromArgv(process.argv);
  const dispatchAuthUrl = (url: string): void => {
    if (loginFlow) void loginFlow.handleCallback(url);
    else earlyAuthUrls.push(url);
  };
  // Serah-terima dari peramban yang tiba sebelum aplikasi siap ditahan, seperti `earlyAuthUrls`.
  let handoffFlow: HandoffFlow | null = null;
  const earlyHandoffs: HandoffInput[] = handoffsFromArgv(process.argv);
  const dispatchHandoff = (input: HandoffInput): void => {
    if (handoffFlow) void handoffFlow.handle(input);
    else earlyHandoffs.push(input);
  };
  const focusWindow = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Jendela bisa tersembunyi di tray (ditutup saat masuk): `show()` memunculkannya lagi.
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  };
  // Keluar sungguhan (menu tray, `app.quit()`, mematikan Windows): menutup jendela tak lagi disembunyikan ke tray.
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('second-instance', (_event, argv) => {
    const handoffs = handoffsFromArgv(argv);
    // Tautan serah-terima memuat halamannya sendiri setelah selesai (`openCountryLock`); jangan memuat dua kali.
    const route = handoffs.length > 0 ? null : routeFromArgv(argv);
    for (const url of authUrlsFromArgv(argv)) dispatchAuthUrl(url);
    for (const handoff of handoffs) dispatchHandoff(handoff);
    focusWindow();
    if (route && mainWindow && !mainWindow.isDestroyed()) {
      // Ditunda bila inject berjalan: memuat halaman baru membuang hasil inject dari renderer.
      const url = `app://qc${route}`;
      if (reloadGate) reloadGate.load(url);
      else void mainWindow.loadURL(url);
    }
  });

  // macOS mengirim tautan protokol lewat open-url (di Windows lewat argumen proses).
  app.on('open-url', (event, url) => {
    event.preventDefault();
    const parsed = parseQcUrl(url);
    if (parsed?.auth) dispatchAuthUrl(url);
    if (parsed?.handoff) dispatchHandoff(parsed.handoff);
    focusWindow();
  });

  app.whenReady().then(() => {
    lockDownSession();
    // `qc://` didaftarkan pada aplikasi terkemas; saat pengembangan registri TIDAK ditulis kecuali diminta lewat
    // `QC_DEV_REGISTER_PROTOCOL=1` (tanpa pendaftaran, login Google desktop menggantung di peramban).
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient('qc');
    } else {
      const dev = devProtocolRegistration(
        process.env,
        process.execPath,
        process.argv[1],
        app.getPath('userData'),
      );
      if (dev) app.setAsDefaultProtocolClient('qc', dev.execPath, dev.args);
    }

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
    const emitAuth = (status: unknown): void => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(AUTH_CHANGE_EVENT, status);
      }
      syncBackground();
    };
    // Login lewat peramban sistem (PKCE); hanya satu login berjalan.
    const flow = createLoginFlow({
      settings: () => settings.get(),
      tokens,
      // Popup mode aplikasi Chrome/Edge bila peramban bawaan salah satunya; selain itu peramban biasa.
      openExternal: async (url) => {
        if (!isOpenableLoginUrl(url)) throw new Error('Alamat login tidak diizinkan');
        await openLoginWindow(url, {
          platform: process.platform,
          env: process.env,
          readDefaultProgId,
          exists: existsSync,
          launch: launchDetached,
          openExternal: (target) => shell.openExternal(target),
        });
      },
      startLoopback: (onCallback) =>
        startLoopback({
          onCallback,
          timeoutMs: LOGIN_MAX_AGE_MS,
          // Jeda singkat agar pengguna sempat melihat "Login berhasil", lalu tutup popup (window.close() dari
          // halaman diabaikan peramban pada jendela berriwayat >1 halaman).
          onShown: (ok) => {
            if (!ok) return;
            setTimeout(() => {
              void closeLoginWindow(LOGIN_SUCCESS_TITLE, {
                platform: process.platform,
                env: process.env,
                run: runProgram,
              });
            }, 900);
          },
        }),
      fetchImpl: net.fetch as typeof fetch,
      onChange: emitAuth,
    });
    loginFlow = flow;
    // /api dan /auth diteruskan proses utama ke server (net.fetch); token tak pernah ke renderer.
    const proxy = createApiProxy({
      settings: () => settings.get(),
      tokens,
      fetchImpl: net.fetch as typeof fetch,
      onUnauthenticated: () => emitAuth(flow.status()),
    });
    // UI: bundel terunduh yang aktif bila ada, selain itu UI dasar terkemas. Bundel baru baru
    // diterapkan pada peluncuran berikutnya atau `ui.reload()`, tidak pernah di tengah inject.
    let ipcHandle: { isInjecting(): boolean } | null = null;
    const bundles = createUiBundleManager({
      dir: join(userData, 'ui'),
      baselineDir: uiRoot(),
      serverUrl: () => settings.get().serverUrl,
      publicKeyPem: UI_PUBLIC_KEY_PEM,
      bridgeVersion: BRIDGE_VERSION,
      isBusy: () => ipcHandle?.isInjecting() ?? false,
      fetchImpl: net.fetch as typeof fetch,
    });
    protocol.handle(
      APP_SCHEME,
      createAppHandler(() => bundles.activeRoot(), proxy),
    );
    let pending: ReturnType<typeof openPendingStore>;
    try {
      pending = openPendingStore(join(userData, 'pending.db'));
    } catch (error) {
      // Berkas pending rusak: beri tahu pengguna, jangan hapus berkasnya.
      dialog.showErrorBox('QC App', error instanceof Error ? error.message : String(error));
      app.exit(1);
      return;
    }

    reloadGate = createReloadGate({
      isInjecting: () => ipcHandle?.isInjecting() ?? false,
      load: (url) => {
        if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(url);
      },
      settleMs: RELOAD_SETTLE_MS,
    });
    const gate = reloadGate;
    // Serah-terima akun dari peramban (Country Lock di web): dialog konfirmasi bila akunnya berbeda dari yang sedang
    // masuk, ditolak selama inject berjalan. Halaman dimuat ulang lewat `gate` setelah selesai (juga membersihkan
    // cache akun sebelumnya di renderer: pemilik berbeda = boot baru).
    handoffFlow = createHandoffFlow({
      settings: () => settings.get(),
      tokens,
      fetchImpl: net.fetch as typeof fetch,
      confirmSwitch: async (current, next) => {
        focusWindow();
        const options = {
          type: 'question' as const,
          title: 'Ganti akun?',
          message: `Peramban masuk sebagai ${next}, sedangkan aplikasi desktop sedang masuk sebagai ${current}.`,
          detail:
            'Lanjut berarti aplikasi desktop berpindah ke akun peramban. Tetap berarti Country Lock dibuka dengan akun saat ini.',
          buttons: [`Lanjut sebagai ${next}`, `Tetap dengan ${current}`],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        };
        const result =
          mainWindow && !mainWindow.isDestroyed()
            ? await dialog.showMessageBox(mainWindow, options)
            : await dialog.showMessageBox(options);
        return result.response === 0 ? 'switch' : 'keep';
      },
      showError: (message) => {
        focusWindow();
        void dialog.showMessageBox({ type: 'warning', title: 'QC App', message, buttons: ['OK'] });
      },
      isBusy: () => ipcHandle?.isInjecting() ?? false,
      onChange: (status) => emitAuth(status),
      openCountryLock: () => gate.load(`${APP_ORIGIN}/country-lock`),
    });

    ipcHandle = registerIpc({
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
      auth: { status: () => flow.status(), start: () => flow.start(), logout: () => flow.logout() },
      emitProgress: (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(INJECT_PROGRESS_EVENT, event);
        }
      },
      ui: {
        reload: async () => {
          // Tidak berbuat apa-apa saat inject berjalan: memuat ulang akan memutus tampilan sesi.
          if (ipcHandle?.isInjecting()) return;
          bundles.applyReady();
          mainWindow?.webContents.reloadIgnoringCache();
        },
      },
      onInjectIdle: () => gate.notifyIdle(),
      isTrustedSender: (event) => isAppUrl(event.senderFrame?.url ?? ''),
    });

    mainWindow = createMainWindow({
      preloadPath: PRELOAD_PATH,
      route: initialRoute,
      blockReload: () => gate.isReloadBlocked(),
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    // Notifikasi latar (Web Push tidak tersedia di Electron; keputusan pemilik 2026-11-16): selama masuk, aliran
    // SSE dari server menjadi notifikasi OS dan menutup jendela hanya menyembunyikannya ke tray.
    const tray = createTrayController({
      openWindow: focusWindow,
      quit: () => app.quit(),
    });
    const notifier = createNotifier({
      supported: notificationsSupported,
      // Jendela terlihat, tidak terminimalkan, dan fokus: lonceng sudah berubah seketika, popup OS dilewati.
      isWindowFocused: () =>
        mainWindow !== null &&
        !mainWindow.isDestroyed() &&
        mainWindow.isVisible() &&
        !mainWindow.isMinimized() &&
        mainWindow.isFocused(),
      show: showOsNotification,
      focusWindow,
      openPath: (path) => gate.load(`${APP_ORIGIN}${path}`),
    });
    const stream = createNotificationStream({
      serverUrl: () => settings.get().serverUrl,
      token: () => tokens.get()?.token ?? null,
      fetchImpl: net.fetch as typeof fetch,
      onNotice: (notice) => {
        notifier.handle(notice);
        // Lonceng di header ikut berubah seketika (sinyal tanpa muatan; renderer memuat ulang lewat API).
        forwardNotificationsChanged(mainWindow);
      },
      onSignedOut: () => emitAuth(flow.status()),
      onUnauthorized: (used) => {
        // Hanya bila MASIH token yang dipakai (401 terlambat dari token lama tak boleh mengeluarkan login baru).
        if (tokens.get()?.token === used) {
          tokens.clear();
          emitAuth(flow.status());
        }
      },
    });
    function syncBackground(): void {
      if (quitting) return;
      if (tokens.get()) {
        stream.start();
        tray.show();
      } else {
        stream.stop();
        tray.destroy();
        // Jendela yang tersembunyi di tray tak boleh tertinggal tanpa ikon: tampilkan agar layar login terlihat.
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) focusWindow();
      }
    }
    let trayHinted = false;
    mainWindow.on('close', (event) => {
      if (quitting || !tokens.get()) return;
      event.preventDefault();
      mainWindow?.hide();
      if (!trayHinted) {
        trayHinted = true;
        tray.hint(
          'QC App tetap berjalan',
          'Notifikasi tetap diterima. Klik ikon ini untuk membuka kembali.',
        );
      }
    });
    mainWindow.on('session-end', () => {
      quitting = true;
    });
    app.on('will-quit', () => {
      stream.stop();
      tray.destroy();
      flow.dispose();
      pending.close();
    });
    syncBackground();

    // Pemulihan UI: muat berhasil mereset hitungan; dua kegagalan berturut-turut kembali ke bundel
    // sebelumnya lalu ke UI dasar (dan memuat ulang).
    const contents = mainWindow.webContents;
    const announceReady = (): void => {
      const uiVersion = bundles.readyVersion();
      if (uiVersion && !contents.isDestroyed()) {
        contents.send(UI_UPDATE_READY_EVENT, { uiVersion });
      }
    };
    // `did-finish-load` hanya berarti index.html terkirim. UI dianggap sehat bila akar web (#app)
    // terisi dalam batas waktu; bundel yang rusak secara logika (layar kosong) tak pernah mengisinya,
    // lalu `markLoadFailed()` menjalankan rantai pemulihan (dua kali gagal -> previous -> dasar).
    const recover = (): void => {
      if (bundles.markLoadFailed() !== 'none') gate.load(`${APP_ORIGIN}${initialRoute}`);
    };
    const probe = createRenderProbe({
      check: async () =>
        !contents.isDestroyed() && (await contents.executeJavaScript(ROOT_FILLED_SCRIPT)) === true,
      onOk: () => {
        bundles.markLoadOk();
        announceReady();
      },
      onFailed: () => {
        if (!contents.isDestroyed()) recover();
      },
      intervalMs: RENDER_PROBE_INTERVAL_MS,
      timeoutMs: RENDER_PROBE_TIMEOUT_MS,
    });
    contents.on('did-start-loading', () => probe.cancel());
    contents.on('did-finish-load', () => {
      if (isAppUrl(contents.getURL())) probe.start();
    });
    mainWindow.on('closed', () => probe.cancel());
    contents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      // -3 = navigasi dibatalkan (bukan kegagalan muat).
      if (!isMainFrame || errorCode === -3) return;
      recover();
    });

    // Pemeriksaan pembaruan UI: saat dibuka, saat jendela fokus (jarak >= 10 menit), dan tiap jam.
    let lastCheck = 0;
    const runCheck = async (minGapMs: number): Promise<void> => {
      if (Date.now() - lastCheck < minGapMs) return;
      lastCheck = Date.now();
      try {
        const result = await bundles.checkForUpdate();
        if (result.status === 'ready') announceReady();
      } catch {
        // Pemeriksaan tak boleh menjatuhkan aplikasi.
      }
    };
    void runCheck(0);
    mainWindow.on('focus', () => void runCheck(10 * 60 * 1000));
    setInterval(() => void runCheck(0), 60 * 60 * 1000).unref();
    for (const url of earlyAuthUrls.splice(0)) void flow.handleCallback(url);
    for (const handoff of earlyHandoffs.splice(0)) void handoffFlow.handle(handoff);
  });

  app.on('window-all-closed', () => app.quit());
}
