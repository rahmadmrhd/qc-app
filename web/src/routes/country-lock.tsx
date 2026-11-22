import { createFileRoute, Link } from '@tanstack/react-router';
import { AppShell } from '@/app/shell/app-shell';
import { UiUpdateBanner } from '@/app/shell/ui-update-banner';
import { PageContent } from '@/components/page/page-container';
import { ApiError } from '@/lib/api/api-error';
import { getBridge } from '@/lib/platform';
import { canRecordSerials } from '@/modules/auth/permissions';
import { meQueryOptions } from '@/modules/auth/queries';
import { clearSession, isAuthenticated } from '@/modules/auth/session';
import { CountryLockPage } from '@/modules/countrylock/components/country-lock-page';
import { OpenInDesktop } from '@/modules/countrylock/components/open-in-desktop';
import { ThemeToggle } from '@/modules/theme/theme-toggle';

// Di luar `_app`: tanpa penjaga sesi (Country Lock tidak memerlukan login atau server, dan harus tetap terbuka saat
// server mati). Bila sudah login dan data pengguna tersedia (termasuk dari salinan tersimpan), halaman tampil di
// dalam AppShell supaya sidebar tetap ada dan berpindah halaman tidak perlu "Kembali ke aplikasi" (keputusan pemilik
// 2026-11-16). Gagal memuat data pengguna (server tak terjangkau tanpa salinan) = pembungkus ringan di bawah.
const ME_WAIT_MS = 5000;

export const Route = createFileRoute('/country-lock')({
  staticData: { pageWidth: 'default' },
  beforeLoad: async ({ context }) => {
    if (!isAuthenticated()) return { withShell: false, canRecord: false };
    try {
      // Dibatasi waktu: tanpa salinan tersimpan dan server menggantung, halaman tak boleh menunggu tanpa batas.
      const me = await Promise.race([
        context.queryClient.ensureQueryData(meQueryOptions()),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Data pengguna tak kunjung termuat')), ME_WAIT_MS),
        ),
      ]);
      // Mencatat Serial Number di halaman ini butuh cangkang (data pengguna termuat) dan izin `serial: edit`.
      return { withShell: true, canRecord: canRecordSerials(me) };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') {
        clearSession();
        context.queryClient.clear();
      }
      return { withShell: false, canRecord: false };
    }
  },
  component: CountryLockRoute,
});

function CountryLockRoute() {
  const { withShell, canRecord } = Route.useRouteContext();
  // Di aplikasi desktop (jembatan ada) tampil halaman Country Lock; di peramban hanya ajakan membuka desktop.
  const bridge = getBridge();
  const content = bridge ? (
    <CountryLockPage bridge={bridge} canRecord={canRecord} />
  ) : (
    <OpenInDesktop />
  );

  if (withShell) {
    return (
      <AppShell>
        {/* AppShell memberi lebar penuh; batas lebar konten (`pageWidth: 'default'`) dipasang di sini. */}
        <PageContent>
          <div className="flex justify-center">{content}</div>
        </PageContent>
      </AppShell>
    );
  }
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <UiUpdateBanner />
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background px-4">
        <span className="font-semibold">Country Lock</span>
        <div className="flex items-center gap-2">
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
      <main className="flex flex-1 items-start justify-center p-4">
        <div className="w-full max-w-7xl">{content}</div>
      </main>
    </div>
  );
}
