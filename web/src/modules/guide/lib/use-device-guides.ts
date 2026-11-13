import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useInstall } from '@/app/pwa/install';
import { pushConfigQueryOptions } from '@/modules/push/queries';
import { deriveDeviceGuides, deviceGuideRelevance, readPushSubscribed } from '../catalog/device';

/**
 * Keadaan perangkat untuk panduan `diturunkan`, dari SATU sumber (`catalog/device.ts`):
 * - `derived`: perlu ditawarkan sekarang (kartu, banner, titik sidebar).
 * - `relevant`: relevan bagi perangkat ini (menu Panduan menyembunyikan yang tak relevan, M12).
 * Konfigurasi push memakai query `push.config` yang sama dengan `PushOnboarding` (satu cache, tanpa permintaan
 * ganda); selama belum termuat, push dianggap tidak tersedia.
 */
export function useDeviceGuides(): {
  derived: Map<string, boolean>;
  relevant: Map<string, boolean>;
} {
  const install = useInstall();
  const { data: pushConfig } = useQuery(pushConfigQueryOptions());
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
    () => deriveDeviceGuides({ pushSubscribed, pushConfig }),
    [pushSubscribed, pushConfig, install.state, focusTick],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `install.state` dan `focusTick` memicu baca ulang keadaan perangkat
  const relevant = useMemo(
    () => deviceGuideRelevance({ pushConfig }),
    [pushConfig, install.state, focusTick],
  );

  return { derived, relevant };
}
