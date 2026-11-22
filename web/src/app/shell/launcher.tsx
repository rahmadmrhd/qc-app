import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { launcherTiles } from '@/app/nav-search';
import { NAV_GROUPS, visibleNavGroups } from '@/app/navigation';
import { Input } from '@/components/ui/input';
import { useIsMobile } from '@/hooks/use-mobile';
import { isDesktop } from '@/lib/platform';
import { useMe } from '@/modules/auth/use-me';
import { openInDesktop } from '@/modules/countrylock/lib/handoff';
import { useActiveLocations } from '@/modules/location/active-locations-context';

/**
 * Beranda ponsel sebagai peluncur (butir 41): kolom cari menu + ubin ikon modul yang boleh dibuka (sumber sama dengan
 * sidebar: `visibleNavGroups`, sudah disaring izin). Tanpa "terbaru", favorit, atau riwayat apa pun (keputusan pemilik).
 * Memilih ubin = maju ke modul (push), jadi back kembali ke peluncur.
 */
export function Launcher() {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const [query, setQuery] = useState('');
  const phone = useIsMobile();
  // Butir `hideOnPhone` tak ikut di ponsel peramban; di aplikasi desktop (jendela sempit) tetap tampil.
  const groups = visibleNavGroups(NAV_GROUPS, me, selectedIds, isDesktop(), phone);
  const tiles = launcherTiles(groups, query);
  return (
    <div className="space-y-4" data-slot="launcher">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari menu…"
          aria-label="Cari menu"
          className="pl-9"
        />
      </div>
      {tiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">Tidak ada menu yang cocok.</p>
      ) : (
        <ul className="grid grid-cols-3 gap-3">
          {tiles.map(({ item, parent }) => (
            <li key={item.to as string}>
              <Link
                to={item.to}
                onClick={
                  item.opensDesktopApp && !isDesktop()
                    ? () => {
                        // Sama dengan sidebar: serah-terima ke aplikasi desktop; gagal tak mengganggu (halaman tujuan menjelaskan).
                        void openInDesktop().catch(() => undefined);
                      }
                    : undefined
                }
                className="flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-xl border bg-card p-2 text-center text-sm active:bg-muted"
              >
                <item.icon aria-hidden className="size-6 text-primary-text" />
                <span className="line-clamp-2 font-medium leading-tight">{item.label}</span>
                {parent ? (
                  <span className="line-clamp-1 text-[11px] text-muted-foreground">{parent}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
