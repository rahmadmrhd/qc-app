// Jendela utama: terisolasi penuh (contextIsolation + sandbox, tanpa Node di renderer) dan terkunci
// ke `app://qc`: navigasi ke origin lain dan jendela baru ditolak.

import { BrowserWindow, session } from 'electron';
import { APP_ORIGIN, isAppUrl } from './app-protocol';
import { allowPermissionCheck, allowPermissionRequest } from './permissions';
import { shouldBlockReloadKey } from './ui/reload-gate';

export interface WindowOptions {
  preloadPath: string;
  /** Rute awal, mis. `/country-lock`. */
  route: string;
  /** `false` untuk smoke tanpa antarmuka. */
  show?: boolean;
  /** Pintasan muat ulang (F5, Ctrl+R) diblokir selama ini mengembalikan true (inject berjalan). */
  blockReload?: () => boolean;
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
  // Memuat ulang di tengah inject membuang hasilnya (serial tak tercatat, risiko inject ulang).
  contents.on('before-input-event', (event, input) => {
    if (shouldBlockReloadKey(input, opts.blockReload?.() ?? false)) event.preventDefault();
  });

  void win.loadURL(`${APP_ORIGIN}${opts.route}`);
  return win;
}

/**
 * Tolak semua izin perangkat (lokasi, mikrofon, notifikasi web, dll.) KECUALI kamera untuk halaman `app://qc`: pemindai
 * serial dan foto bukti Catat Serial Number memakainya (`permissions.ts`).
 */
export function lockDownSession(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const media = details as { mediaTypes?: readonly string[] };
    callback(
      allowPermissionRequest(permission, {
        requestingUrl: details.requestingUrl,
        isMainFrame: details.isMainFrame,
        mediaTypes: media.mediaTypes,
      }),
    );
  });
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin, details) =>
      allowPermissionCheck(permission, requestingOrigin, {
        mediaType: (details as { mediaType?: string }).mediaType,
      }),
  );
}
