import type { GuideOffer } from './offer';

/** `pathname` sama dengan `prefix` atau berada di bawahnya (`/handover` cocok `/handover/new`, bukan `/handovers-lain`). */
function underPrefix(prefix: string, pathname: string): boolean {
  if (prefix === '/') return pathname === '/';
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Panduan yang bannernya boleh muncul di rute ini: awalan `entry.halaman` cocok dengan `pathname`. Bila lebih dari
 * satu cocok, hanya yang pertama menurut urutan `offers` (= urutan katalog); satu banner pada satu waktu. Panduan
 * tanpa `halaman` (mis. `dasar-layout`) tidak pernah cocok.
 */
export function guideForRoute(offers: readonly GuideOffer[], pathname: string): GuideOffer | null {
  return (
    offers.find(
      ({ entry }) => entry.halaman !== undefined && underPrefix(entry.halaman, pathname),
    ) ?? null
  );
}

/**
 * Item sidebar bertujuan `itemTo` punya panduan belum selesai: ada penawaran yang `halaman`-nya SAMA dengan tujuan
 * item itu. Sengaja persis (bukan awalan) agar `/item` tidak ikut menandai `/item/brands` yang punya menu sendiri.
 */
export function hasPendingGuide(offers: readonly GuideOffer[], itemTo: string): boolean {
  return offers.some(({ entry }) => entry.halaman === itemTo);
}
