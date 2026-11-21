import type { QcBridge } from '@countrylock/bridge-contract';
import { APP_BRIDGE_VERSION } from '@countrylock/bridge-contract';
import { isBelowMinClient } from '@shared/api-versions';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getServerMinClient, subscribeServerMinClient } from '@/lib/api/versions';
import { getBridge } from '@/lib/platform';
import { useOutdatedLevel } from '../pwa/client-outdated';

/** Jembatan desktop yang sudah punya kanal `app.*` (v10); `null` di peramban atau jembatan lama. */
export function getAppBridge(): QcBridge | null {
  const bridge = getBridge();
  return bridge !== null && bridge.version >= APP_BRIDGE_VERSION ? bridge : null;
}

/**
 * Perlu menahan aplikasi desktop di layar "Perlu pembaruan"? Hanya di desktop berjembatan v10 (kanal pembaruannya
 * ada) dan hanya bila server sudah menolak klien ini (426 `CLIENT_OUTDATED`, tingkat `outdated`) atau versi terpasang
 * di bawah `minClient` yang diumumkan server. Di peramban selalu `false`: peramban memuat ulang sendiri (PWA).
 * `installed` gagal dibaca = jalur `minClient` tidak menahan (data tak lengkap tak boleh mengunci pengguna).
 */
export function useDesktopBlock(): { blocked: boolean; installed: string | null } {
  const bridge = getAppBridge();
  const level = useOutdatedLevel();
  const minClient = useSyncExternalStore(subscribeServerMinClient, getServerMinClient, () => null);
  const [installed, setInstalled] = useState<string | null>(null);

  useEffect(() => {
    if (bridge === null) return;
    let cancelled = false;
    bridge.app
      .version()
      .then((version) => {
        if (!cancelled) setInstalled(version);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  if (bridge === null) return { blocked: false, installed: null };
  const blocked =
    level === 'outdated' || (installed !== null && isBelowMinClient(installed, minClient));
  return { blocked, installed };
}
