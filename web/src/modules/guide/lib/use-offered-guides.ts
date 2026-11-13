import { useEffect, useMemo, useState } from 'react';
import { useInstall } from '@/app/pwa/install';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { GUIDE_CATALOG } from '../catalog';
import { deriveDeviceGuides, readPushSubscribed } from '../catalog/device';
import { type GuideOffer, offeredGuides } from './offer';
import { useGuideStore } from './use-guide-store';

/**
 * Menyatukan penyimpanan status (`GuideStore`, menurut jenis akun) dan keadaan perangkat (panduan `diturunkan`)
 * menjadi satu daftar penawaran (spek 4.3). Kosong selama `!ready`: lebih baik diam daripada menampilkan "semua
 * belum selesai" kepada yang sebenarnya sudah.
 */
export function useOfferedGuides(): { ready: boolean; offers: GuideOffer[] } {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const { ready, done } = useGuideStore();
  const install = useInstall();
  // Langganan push hanya bisa dibaca asinkron; belum diketahui (undefined) = hanya izin yang menentukan.
  const [pushSubscribed, setPushSubscribed] = useState<boolean | undefined>(undefined);
  // Naik tiap jendela kembali fokus: izin notifikasi/langganan dapat berubah lewat pengaturan peramban.
  const [focusTick, setFocusTick] = useState(0);

  useEffect(() => {
    const onFocus = () => setFocusTick((tick) => tick + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `focusTick` hanya pemicu baca ulang
  useEffect(() => {
    let cancelled = false;
    readPushSubscribed()
      .then((value) => {
        if (!cancelled) setPushSubscribed(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [focusTick]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `install.state` dan `focusTick` memicu baca ulang keadaan perangkat
  const derived = useMemo(
    () => deriveDeviceGuides({ pushSubscribed }),
    [pushSubscribed, install.state, focusTick],
  );

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
