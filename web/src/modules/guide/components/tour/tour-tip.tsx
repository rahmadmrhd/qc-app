import { lazy, type ReactNode, Suspense } from 'react';
import { useDemoScenes } from '../../lib/use-demo-scenes';
import { SilentBoundary } from './silent-boundary';

// Pemutar demo dimuat malas: tidak ikut potongan utama, hanya diunduh saat langkah ber-`tip` pertama tampil.
const DemoPlayer = lazy(() =>
  import('../demo-player').then((module) => ({ default: module.DemoPlayer })),
);

/** Adegan entri `tip` yang dimuat malas (pemuat terdaftar) lalu diputar; kosong selama belum termuat/tak ada demo. */
function TourTipDemo({ tipId }: { tipId: string }) {
  const scenes = useDemoScenes(tipId);
  if (!scenes || scenes.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <DemoPlayer scenes={scenes} />
    </Suspense>
  );
}

/**
 * `renderTip` untuk `TourProvider`: adegan demo milik entri `tip` di dalam kartu langkah tur. Adegan boleh belum
 * pernah dimuat (didaftarkan lewat `registerDemoLoader`): dimuat saat langkah tampil. `tipId` tanpa demo, atau
 * pemuatan/pemutar gagal, tidak merender apa pun (langkah tetap jalan, aplikasi tidak jatuh).
 */
export function renderTourTip(tipId: string): ReactNode {
  return (
    <SilentBoundary>
      <TourTipDemo tipId={tipId} />
    </SilentBoundary>
  );
}
