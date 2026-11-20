import { Button } from '@/components/ui/button';
import { isDesktop } from '@/lib/platform';
import { useOutdatedLevel } from './client-outdated';
import { usePwaUpdate } from './update';

/**
 * Spanduk "perlu diperbarui" untuk versi API yang dipakai klien ini sudah ditandai deprecated server (fase 3 versi API):
 * hanya peringatan dan tombol Muat ulang, tidak memuat ulang sendiri. Tingkat `outdated` (426) ditangani spanduk
 * pembaruan biasa. Di aplikasi desktop tidak tampil: pembaruan desktop punya jalurnya sendiri (layar penahan).
 */
export function ApiDeprecatedBanner() {
  const level = useOutdatedLevel();
  const { reload } = usePwaUpdate();
  if (level !== 'deprecated' || isDesktop()) return null;
  return (
    <div
      role="status"
      data-testid="api-deprecated-banner"
      className="flex flex-wrap items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="min-w-0 flex-1">Aplikasi ini perlu diperbarui biar tetap bisa dipakai.</p>
      <Button size="sm" variant="outline" onClick={reload}>
        Muat ulang
      </Button>
    </div>
  );
}
