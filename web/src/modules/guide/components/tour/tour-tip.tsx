import { lazy, type ReactNode, Suspense } from 'react';
import { getDemoScenes } from '../../lib/demo-types';

// Pemutar demo dimuat malas: tidak ikut potongan utama, hanya diunduh saat langkah ber-`tip` pertama tampil.
const DemoPlayer = lazy(() =>
  import('../demo-player').then((module) => ({ default: module.DemoPlayer })),
);

/**
 * `renderTip` untuk `TourProvider`: adegan demo milik entri `tip` (didaftarkan lewat `registerDemoScenes`) di dalam
 * kartu langkah tur. `tipId` yang belum terdaftar atau tanpa adegan tidak merender apa pun (langkah tetap jalan).
 */
export function renderTourTip(tipId: string): ReactNode {
  const scenes = getDemoScenes(tipId);
  if (!scenes || scenes.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <DemoPlayer scenes={scenes} />
    </Suspense>
  );
}
