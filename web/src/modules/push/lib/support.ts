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

/** Platform untuk memilih langkah "nyalakan kembali notifikasi" yang tepat. */
export function platformOf(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator,
): PushPlatform {
  if (isIosBrowser(nav)) return 'ios';
  if (/Android/i.test(nav.userAgent)) return 'android';
  return 'desktop';
}
