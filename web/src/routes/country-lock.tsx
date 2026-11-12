import { createFileRoute, Link } from '@tanstack/react-router';
import { OpenInDesktop } from '@/modules/countrylock/components/open-in-desktop';
import { ThemeToggle } from '@/modules/theme/theme-toggle';

// Di luar `_app`: tanpa penjaga sesi dan tanpa AppShell (Country Lock tidak memerlukan login atau
// server). Pembungkusnya ringan; menyatukannya ke AppShell adalah pekerjaan tahap berikutnya.
export const Route = createFileRoute('/country-lock')({
  component: CountryLockRoute,
});

function CountryLockRoute() {
  return (
    <div className="flex min-h-svh flex-col bg-muted/40">
      <header className="flex items-center justify-between gap-2 border-b bg-background px-4 py-2">
        <span className="font-semibold">Country Lock</span>
        <div className="flex items-center gap-2">
          <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Masuk
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center p-4">
        <OpenInDesktop />
      </main>
    </div>
  );
}
