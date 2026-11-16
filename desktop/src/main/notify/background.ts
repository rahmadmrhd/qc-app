// Lem Electron untuk notifikasi latar: ikon tray dan notifikasi OS. Logika (dedupe, aliran, validasi) ada di
// berkas lain yang murni dan teruji; berkas ini hanya memanggil API Electron.

import { app, Menu, Notification, Tray } from 'electron';
import type { ShownNotice } from './notifier';

export interface TrayController {
  /** Menampilkan ikon tray (idempoten). */
  show(): void;
  /** Membuang ikon tray (idempoten). */
  destroy(): void;
  /** Balon sekali pakai "tetap berjalan di tray" (Windows). */
  hint(title: string, content: string): void;
}

export function createTrayController(actions: {
  openWindow(): void;
  quit(): void;
}): TrayController {
  let tray: Tray | null = null;
  let creating = false;
  return {
    show() {
      if (tray || creating) return;
      creating = true;
      // Ikon = ikon berkas aplikasi (terpasang: ikon QC App; pengembangan: ikon Electron).
      void app
        .getFileIcon(process.execPath, { size: 'small' })
        .then((icon) => {
          if (!creating || tray) return;
          tray = new Tray(icon);
          tray.setToolTip('QC App');
          tray.setContextMenu(
            Menu.buildFromTemplate([
              { label: 'Buka QC App', click: () => actions.openWindow() },
              { type: 'separator' },
              { label: 'Keluar', click: () => actions.quit() },
            ]),
          );
          tray.on('click', () => actions.openWindow());
        })
        .catch(() => {
          // Tanpa ikon tray aplikasi tetap berjalan; membuka ulang aplikasi memunculkan jendela yang tersembunyi.
        })
        .finally(() => {
          creating = false;
        });
    },
    destroy() {
      creating = false;
      tray?.destroy();
      tray = null;
    },
    hint(title, content) {
      if (process.platform === 'win32') tray?.displayBalloon({ title, content });
    },
  };
}

/** Notifikasi yang sedang tampil harus dirujuk agar tidak dibuang pengumpul sampah sebelum diklik. */
const alive = new Set<Notification>();

export function showOsNotification(notice: ShownNotice): void {
  const notification = new Notification({ title: notice.title, body: notice.body });
  alive.add(notification);
  const release = (): void => {
    alive.delete(notification);
  };
  notification.once('click', () => {
    release();
    notice.onClick();
  });
  notification.once('close', release);
  notification.once('failed', release);
  notification.show();
}

export function notificationsSupported(): boolean {
  return Notification.isSupported();
}
