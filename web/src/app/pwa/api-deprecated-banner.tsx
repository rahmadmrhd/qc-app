import { Alert } from '@/components/ui/alert';
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
    <Alert
      color="warning"
      role="status"
      data-app-banner=""
      data-testid="api-deprecated-banner"
      className="flex flex-wrap items-center gap-2 rounded-none border-x-0 border-t-0 px-4"
    >
      <p className="min-w-0 flex-1">Aplikasi ini perlu diperbarui biar tetap bisa dipakai.</p>
      <Button size="sm" variant="outline" color="primary" onClick={reload}>
        Muat ulang
      </Button>
    </Alert>
  );
}
