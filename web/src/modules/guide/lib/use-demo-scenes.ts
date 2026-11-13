import { useEffect, useState } from 'react';
import { type DemoScene, getDemoScenes, loadDemoScenes } from './demo-types';

/**
 * Adegan demo entri `tip`: `override` bila diberikan, selain itu yang terdaftar/dimuat malas (spek 3: konten dimuat
 * malas). Memuat HANYA saat `enabled` (mis. tooltip dibuka). `undefined` selama belum termuat atau bila tak ada.
 */
export function useDemoScenes(
  tipId: string,
  options: { scenes?: readonly DemoScene[]; enabled?: boolean } = {},
): readonly DemoScene[] | undefined {
  const { scenes: override, enabled = true } = options;
  const [loaded, setLoaded] = useState<readonly DemoScene[] | undefined>(() =>
    getDemoScenes(tipId),
  );
  useEffect(() => {
    if (override || !enabled) return;
    let cancelled = false;
    void loadDemoScenes(tipId).then((scenes) => {
      if (!cancelled) setLoaded(scenes);
    });
    return () => {
      cancelled = true;
    };
  }, [tipId, override, enabled]);
  return override ?? loaded;
}
