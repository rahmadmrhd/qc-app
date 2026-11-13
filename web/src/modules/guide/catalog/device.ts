import { getInstallState } from '@/app/pwa/install';
import { getPushRegistration } from '@/modules/push/lib/subscribe';
import { devicePermission } from '@/modules/push/lib/support';
import type { GuideEntry } from '../lib/types';

/**
 * Panduan yang status "perlu ditawarkan"-nya diturunkan dari keadaan perangkat (spek 4.3, `diturunkan`): tanpa
 * penanda tersimpan. Klip peragaan (di luar aplikasi) menyusul bersama skema adegan tooltip (Task 7); sampai
 * itu, langkahnya cukup berupa teks yang menyorot menu profil.
 */
export const PERANGKAT_PWA: GuideEntry = {
  id: 'perangkat-pwa',
  kind: 'dasar',
  status: 'diturunkan',
  version: 1,
  title: 'Pasang aplikasi di perangkat',
  steps: [
    {
      target: 'user-menu',
      text: 'Buka menu profil ini, lalu pilih "Pasang aplikasi" biar QC App muncul di layar utama dan terbuka seperti aplikasi biasa.',
      advance: 'next',
    },
  ],
};

export const PERANGKAT_PUSH: GuideEntry = {
  id: 'perangkat-push',
  kind: 'dasar',
  status: 'diturunkan',
  version: 1,
  title: 'Aktifkan notifikasi push',
  steps: [
    {
      target: 'user-menu',
      text: 'Buka menu profil ini, lalu pilih "Notifikasi push" dan izinkan, biar kabar penting masuk walau aplikasi sedang tertutup.',
      advance: 'next',
    },
  ],
};

export const DEVICE_GUIDES: readonly GuideEntry[] = [PERANGKAT_PWA, PERANGKAT_PUSH];

/**
 * Apakah perangkat ini sudah punya langganan push. Satu-satunya sumbernya asinkron (`pushManager`), jadi
 * pemanggil memuatnya sekali lalu meneruskan hasilnya ke `deriveDeviceGuides`. Hanya membaca; `false` bila
 * service worker tidak ada (dev, peramban lawas).
 */
export async function readPushSubscribed(win: Window = window): Promise<boolean> {
  const registration = await getPushRegistration(win);
  if (!registration) return false;
  try {
    return (await registration.pushManager.getSubscription()) != null;
  } catch {
    return false;
  }
}

/**
 * Peta id panduan `diturunkan` -> perlu ditawarkan sekarang (masukan `derived` untuk `offeredGuides`). Hanya
 * membaca keadaan perangkat.
 * - `perangkat-pwa`: aplikasi belum berjalan terpasang DAN perangkat dapat memasangnya (ajakan peramban atau
 *   iOS manual; kedua kondisi itu sudah dihitung `getInstallState`).
 * - `perangkat-push`: izin notifikasi peramban bukan `granted`, atau perangkat belum berlangganan. Langganan
 *   belum diketahui (`pushSubscribed` kosong) berarti hanya izin yang menentukan: izin `granted` dianggap beres
 *   (`PushOnboarding` berlangganan diam-diam bila izin sudah ada), supaya tidak menawarkan keliru.
 */
export function deriveDeviceGuides(
  options: { pushSubscribed?: boolean } = {},
): Map<string, boolean> {
  const installable = getInstallState() !== 'unavailable';
  const granted = devicePermission() === 'granted';
  const pushNeeded = !granted || options.pushSubscribed === false;
  return new Map([
    [PERANGKAT_PWA.id, installable],
    [PERANGKAT_PUSH.id, pushNeeded],
  ]);
}
