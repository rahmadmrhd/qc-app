import { useEffect, useState } from 'react';
import { hasUiBridge, startUiUpdateWatch, useUiUpdateReady } from '@/app/ui-update-store';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getBridge } from '@/lib/platform';

/**
 * Spanduk "Versi UI baru tersedia" di aplikasi desktop: bundel UI baru sudah diunduh dan diverifikasi
 * (pengumuman `bridge.ui.onUpdateReady`, ditampung `ui-update-store` sejak aplikasi start); tombol "Muat ulang"
 * menerapkannya lewat `bridge.ui.reload()` (proses utama menunda bila ada inject berjalan). Tidak menampilkan
 * apa pun di peramban atau pada jembatan tanpa `bridge.ui` (versi < 3).
 */
export function UiUpdateBanner() {
  const ready = useUiUpdateReady();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Pengaman bila `main.tsx` belum memulai pemantauan (idempoten).
  useEffect(() => {
    startUiUpdateWatch();
  }, []);

  const bridge = getBridge();
  if (!hasUiBridge(bridge) || !ready) return null;

  async function reload() {
    if (!hasUiBridge(bridge)) return;
    setBusy(true);
    setFailed(false);
    try {
      await bridge.ui.reload();
    } catch {
      setFailed(true);
    }
    // Berhasil = jendela dimuat ulang; bila ditunda (inject berjalan) tombol aktif lagi agar dapat diulang.
    setBusy(false);
  }

  return (
    <Alert
      color="info"
      role="status"
      data-app-banner=""
      className="flex flex-wrap items-center gap-2 rounded-none border-x-0 border-t-0 px-4"
    >
      <span>Versi UI baru tersedia.</span>
      {failed ? <span className="text-destructive-text">Muat ulang gagal. Coba lagi.</span> : null}
      <Button
        type="button"
        size="sm"
        className="ml-auto"
        disabled={busy}
        onClick={() => void reload()}
      >
        Muat ulang
      </Button>
    </Alert>
  );
}
