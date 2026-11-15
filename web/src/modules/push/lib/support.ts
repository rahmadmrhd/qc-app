import { isIosBrowser } from '@/app/pwa/install';

export type DevicePermission = 'granted' | 'denied' | 'default' | 'unsupported';
export type PushPlatform = 'ios' | 'android' | 'desktop';

/**
 * Peramban ini dapat menerima push: butuh service worker, `PushManager`, dan Notification API. Tidak ada saat dev
 * (service worker dimatikan), di Safari iOS yang belum dipasang ke layar utama, dan di peramban lawas.
 */
export function pushSupported(win: Window = window): boolean {
  return 'serviceWorker' in win.navigator && 'PushManager' in win && 'Notification' in win;
}

/** Izin notifikasi peramban saat ini, atau `unsupported` bila push tidak dapat dipakai. */
export function devicePermission(win: Window = window): DevicePermission {
  if (!pushSupported(win)) return 'unsupported';
  return (win as Window & typeof globalThis).Notification.permission;
}

/**
 * Push dapat dipakai di perangkat ini: konfigurasi server sudah termuat dan `enabled` (VAPID terisi) DAN peramban
 * mendukungnya. Satu definisi untuk `PushOnboarding` (`active`) dan panduan perangkat (I3, keputusan pemilik
 * 2026-11-14); konfigurasi yang belum termuat berarti tidak tersedia.
 */
export function pushAvailable(
  config: { enabled: boolean } | undefined,
  permission: DevicePermission,
): boolean {
  return config?.enabled === true && permission !== 'unsupported';
}

/** Langkah menyalakan kembali izin notifikasi yang sudah ditolak (peramban tidak mengizinkan meminta ulang). */
export function reenableSteps(platform: PushPlatform): string {
  if (platform === 'ios') {
    return 'Buka Pengaturan di iPhone, pilih Notifikasi, pilih QC App, lalu nyalakan Izinkan Notifikasi.';
  }
  if (platform === 'android') {
    return 'Tahan ikon aplikasi QC, pilih Info aplikasi, lalu Notifikasi, dan izinkan. Di peramban biasa, ketuk ikon gembok di bilah alamat lalu pilih Izin atau Notifikasi.';
  }
  return 'Klik ikon gembok di bilah alamat, pilih Pengaturan situs, ubah Notifikasi menjadi Izinkan, lalu muat ulang halaman.';
}

/** Platform untuk memilih langkah "nyalakan kembali notifikasi" yang tepat. */
export function platformOf(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator,
): PushPlatform {
  if (isIosBrowser(nav)) return 'ios';
  if (/Android/i.test(nav.userAgent)) return 'android';
  return 'desktop';
}
