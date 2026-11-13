import { useMemo } from 'react';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { GUIDE_CATALOG } from '../catalog';
import { type GuideOffer, offeredGuides } from './offer';
import { useDeviceGuides } from './use-device-guides';
import { useGuideStore } from './use-guide-store';

/**
 * Menyatukan penyimpanan status (`GuideStore`, menurut jenis akun) dan keadaan perangkat (panduan `diturunkan`,
 * `useDeviceGuides`) menjadi satu daftar penawaran (spek 4.3). Kosong selama `!ready`: lebih baik diam daripada
 * menampilkan "semua belum selesai" kepada yang sebenarnya sudah.
 */
export function useOfferedGuides(): { ready: boolean; offers: GuideOffer[] } {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const { ready, done } = useGuideStore();
  const { derived } = useDeviceGuides();

  const offers = useMemo(
    () =>
      ready
        ? offeredGuides({
            me,
            catalog: GUIDE_CATALOG,
            done,
            derived,
            activeLocationIds: selectedIds,
          })
        : [],
    [ready, me, done, derived, selectedIds],
  );

  return { ready, offers };
}
