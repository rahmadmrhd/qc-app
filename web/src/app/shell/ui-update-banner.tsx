import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { getBridge } from '@/lib/platform';

/**
 * Spanduk "Versi UI baru tersedia" di aplikasi desktop: bundel UI baru sudah diunduh dan diverifikasi
 * (`bridge.ui.onUpdateReady`); tombol "Muat ulang" menerapkannya lewat `bridge.ui.reload()` (proses utama
 * menunda bila sedang ada inject berjalan). Tidak menampilkan apa pun di peramban.
 */
export function UiUpdateBanner() {
  const bridge = getBridge();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    return bridge.ui.onUpdateReady(() => setReady(true));
  }, [bridge]);

  if (!bridge || !ready) return null;

  async function reload() {
    if (!bridge) return;
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
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-b bg-muted px-4 py-2 text-sm"
    >
      <RefreshCw className="size-4 shrink-0" aria-hidden="true" />
      <span>Versi UI baru tersedia.</span>
      {failed ? <span className="text-destructive">Muat ulang gagal. Coba lagi.</span> : null}
      <Button
        type="button"
        size="sm"
        className="ml-auto"
        disabled={busy}
        onClick={() => void reload()}
      >
        Muat ulang
      </Button>
    </div>
  );
}
