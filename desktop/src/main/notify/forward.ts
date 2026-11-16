// Meneruskan "ada notifikasi baru" dari aliran SSE proses utama ke renderer, supaya lonceng di header berubah
// seketika seperti notifikasi Windows-nya (konsisten dengan lonceng di peramban). Sinyal TANPA muatan: renderer
// memuat ulang lonceng lewat API (izin dan isi tetap dari jalur baca), jadi tak ada data notifikasi yang melintasi
// jembatan. Logika murni dengan jendela yang disuntik agar teruji tanpa Electron.

import { NOTIFICATIONS_CHANGE_EVENT } from '@countrylock/bridge-channels';

/** Bagian `BrowserWindow` yang dipakai. */
export interface ForwardTarget {
  isDestroyed(): boolean;
  webContents: { send(channel: string): void };
}

/** Mengirim sinyal ke jendela utama bila masih ada; tak pernah melempar (tak boleh memutus aliran). */
export function forwardNotificationsChanged(window: ForwardTarget | null): void {
  if (window === null || window.isDestroyed()) return;
  try {
    window.webContents.send(NOTIFICATIONS_CHANGE_EVENT);
  } catch {
    // Renderer sedang dimuat ulang/dibongkar: sinyal berikutnya atau polling 10 dtk yang menyusul.
  }
}
