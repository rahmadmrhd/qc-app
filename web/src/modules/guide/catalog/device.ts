import type { PushConfigDto } from '@shared/contract';
import { getInstallState } from '@/app/pwa/install';
import { getPushRegistration } from '@/modules/push/lib/subscribe';
import { devicePermission, pushAvailable } from '@/modules/push/lib/support';
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
      target: 'user-menu-install',
      buka: 'user-menu',
      text: 'Ini dia "Pasang aplikasi". Di Android atau komputer, kalau diklik muncul kotak konfirmasi dari peramban, tinggal setujui. Di iPhone atau iPad, muncul petunjuk: ketuk tombol Bagikan di Safari, lalu pilih "Tambah ke Layar Utama". Setelah terpasang, QC App muncul di layar utama dan terbuka seperti aplikasi biasa.',
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
      target: 'user-menu-push',
      buka: 'user-menu',
      text: 'Klik "Notifikasi push" untuk membuka pengaturannya: ada saklar untuk menyalakan atau mematikan push di akunmu, plus status izin peramban di perangkat ini. Kalau peramban minta izin, pilih Izinkan. Kalau sudah telanjur diblokir, dialognya menunjukkan cara menyalakannya lagi. Dengan push aktif, kabar penting masuk walau aplikasi sedang tertutup.',
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
  options: { pushSubscribed?: boolean; pushConfig?: PushConfigInput } = {},
): Map<string, boolean> {
  const relevant = deviceGuideRelevance({ pushConfig: options.pushConfig });
  const granted = devicePermission() === 'granted';
  const pushNeeded = !granted || options.pushSubscribed === false;
  return new Map([
    [PERANGKAT_PWA.id, relevant.get(PERANGKAT_PWA.id) === true],
    [PERANGKAT_PUSH.id, relevant.get(PERANGKAT_PUSH.id) === true && pushNeeded],
  ]);
}

type PushConfigInput = Pick<PushConfigDto, 'enabled' | 'userEnabled'>;

/**
 * Peta id panduan `diturunkan` -> relevan bagi perangkat ini (terlepas sudah beres atau belum). Satu-satunya
 * sumber untuk kartu, banner, dan menu Panduan (M12, keputusan pemilik 2026-11-14): panduan yang tak relevan
 * tidak ditawarkan dan tidak muncul di menu.
 * - `perangkat-pwa`: perangkat dapat memasang aplikasi (`getInstallState` bukan `unavailable`).
 * - `perangkat-push` (I3): push tersedia (`pushAvailable`: konfigurasi termuat dan `enabled`, peramban
 *   mendukung) DAN pengguna tidak mematikannya (`userEnabled !== false`). Konfigurasi belum termuat = tak relevan.
 */
export function deviceGuideRelevance(
  options: { pushConfig?: PushConfigInput } = {},
): Map<string, boolean> {
  const { pushConfig } = options;
  const pushRelevant =
    pushAvailable(pushConfig, devicePermission()) && pushConfig?.userEnabled !== false;
  return new Map([
    [PERANGKAT_PWA.id, getInstallState() !== 'unavailable'],
    [PERANGKAT_PUSH.id, pushRelevant],
  ]);
}
