import { createFileRoute, Link } from '@tanstack/react-router';
import { AppShell } from '@/app/shell/app-shell';
import { UiUpdateBanner } from '@/app/shell/ui-update-banner';
import { ApiError } from '@/lib/api/api-error';
import { getBridge } from '@/lib/platform';
import { meQueryOptions } from '@/modules/auth/queries';
import { clearSession, isAuthenticated } from '@/modules/auth/session';
import { CatalogSyncButton } from '@/modules/countrylock/components/catalog-sync-button';
import { CountryLockPage } from '@/modules/countrylock/components/country-lock-page';
import { OpenInDesktop } from '@/modules/countrylock/components/open-in-desktop';
import { ThemeToggle } from '@/modules/theme/theme-toggle';

// Di luar `_app`: tanpa penjaga sesi (Country Lock tidak memerlukan login atau server, dan harus tetap terbuka saat
// server mati). Bila sudah login dan data pengguna tersedia (termasuk dari salinan tersimpan), halaman tampil di
// dalam AppShell supaya sidebar tetap ada dan berpindah halaman tidak perlu "Kembali ke aplikasi" (keputusan pemilik
// 2026-11-16). Gagal memuat data pengguna (server tak terjangkau tanpa salinan) = pembungkus ringan di bawah.
const ME_WAIT_MS = 5000;

export const Route = createFileRoute('/country-lock')({
  beforeLoad: async ({ context }) => {
    if (!isAuthenticated()) return { withShell: false };
    try {
      // Dibatasi waktu: tanpa salinan tersimpan dan server menggantung, halaman tak boleh menunggu tanpa batas.
      await Promise.race([
        context.queryClient.ensureQueryData(meQueryOptions()),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Data pengguna tak kunjung termuat')), ME_WAIT_MS),
        ),
      ]);
      return { withShell: true };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') {
        clearSession();
        context.queryClient.clear();
      }
      return { withShell: false };
    }
  },
  component: CountryLockRoute,
});

function CountryLockRoute() {
  const { withShell } = Route.useRouteContext();
  // Di aplikasi desktop (jembatan ada) tampil halaman Country Lock; di peramban hanya ajakan membuka desktop.
  const bridge = getBridge();
  const content = bridge ? <CountryLockPage bridge={bridge} /> : <OpenInDesktop />;

  if (withShell) {
    return (
      <AppShell>
        <div className="flex justify-center">{content}</div>
      </AppShell>
    );
  }
  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <UiUpdateBanner />
      <header className="flex items-center justify-between gap-2 border-b bg-background px-4 py-2">
        <span className="font-semibold">Country Lock</span>
        <div className="flex items-center gap-2">
          <CatalogSyncButton bridge={bridge} />
          {/* Sudah login tetapi tanpa cangkang (data pengguna belum termuat): kembali ke aplikasi; belum login: masuk. */}
          {isAuthenticated() ? (
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
              Kembali ke aplikasi
            </Link>
          ) : (
            <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
              Masuk
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center p-4">{content}</main>
    </div>
  );
}
