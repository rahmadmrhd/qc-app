// Jendela utama: terisolasi penuh (contextIsolation + sandbox, tanpa Node di renderer) dan terkunci
// ke `app://qc`: navigasi ke origin lain dan jendela baru ditolak.

import { BrowserWindow, session } from 'electron';
import { APP_ORIGIN, isAppUrl } from './app-protocol';

export interface WindowOptions {
  preloadPath: string;
  /** Rute awal, mis. `/country-lock`. */
  route: string;
  /** `false` untuk smoke tanpa antarmuka. */
  show?: boolean;
}

export function createMainWindow(opts: WindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: opts.show ?? true,
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });

  const contents = win.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const blockForeign = (event: { preventDefault(): void }, url: string): void => {
    if (!isAppUrl(url)) event.preventDefault();
  };
  contents.on('will-navigate', (event, url) => blockForeign(event, url));
  contents.on('will-redirect', (event, url) => blockForeign(event, url));
  contents.on('will-attach-webview', (event) => event.preventDefault());

  void win.loadURL(`${APP_ORIGIN}${opts.route}`);
  return win;
}

/** Tolak semua permintaan izin perangkat (kamera, lokasi, dll.); aplikasi tak membutuhkannya. */
export function lockDownSession(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
}
