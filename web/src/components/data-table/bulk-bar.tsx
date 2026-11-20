import { Ellipsis } from 'lucide-react';
import { Children, Fragment, isValidElement, type ReactNode, useContext, useEffect } from 'react';
import { ActionButton } from '@/components/action-button';
import { BulkActiveContext } from '@/components/page/bulk-active';
import { StickyActionBar } from '@/components/page/sticky-action-bar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useIsDesktop } from '@/hooks/use-is-desktop';

/** Aksi utama yang ditampilkan langsung di ponsel; sisanya masuk menu "⋯". */
const MOBILE_PRIMARY = 2;

/** Meratakan anak (termasuk Fragment) menjadi daftar elemen. */
function flatten(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    if (isValidElement(child) && child.type === Fragment) {
      out.push(...flatten((child.props as { children?: ReactNode }).children));
    } else {
      out.push(child);
    }
  }
  return out;
}

/**
 * Bar aksi massal yang menempel di bawah layar (`StickyActionBar`); tak dirender bila belum ada baris terpilih. `busy`
 * (dari `useBulkAction`) menonaktifkan semua tombol di dalamnya selama aksi berjalan, agar klik ganda tak mengirim
 * dua kali. Di < 768 px hanya dua aksi pertama yang tampil dan sisanya masuk menu "⋯"; keluar dari mode pilih lewat ✕
 * di header daftar.
 */
export function BulkBar({
  count,
  onClear,
  busy = false,
  children,
}: {
  count: number;
  onClear: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const desktop = useIsDesktop();
  const bulkActive = useContext(BulkActiveContext);
  const active = count > 0;
  useEffect(() => {
    if (!active) return;
    bulkActive?.(true);
    return () => bulkActive?.(false);
  }, [active, bulkActive]);
  if (!active) return null;

  if (!desktop) {
    const items = flatten(children);
    const primary = items.slice(0, MOBILE_PRIMARY);
    const rest = items.slice(MOBILE_PRIMARY);
    return (
      <StickyActionBar label="Aksi massal" busy={busy} className="rounded-t-lg">
        <span className="shrink-0 px-1 text-sm font-medium">{count} dipilih</span>
        <fieldset
          disabled={busy}
          className="m-0 flex min-w-0 flex-1 items-center gap-2 border-0 p-0"
        >
          {primary}
          {rest.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="icon" aria-label="Aksi lainnya">
                  <Ellipsis aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="flex w-auto flex-col items-stretch gap-2 p-2">
                {rest}
              </PopoverContent>
            </Popover>
          ) : null}
        </fieldset>
      </StickyActionBar>
    );
  }

  return (
    <StickyActionBar label="Aksi massal" busy={busy} className="mt-3 flex-wrap rounded-lg">
      <span className="px-2 text-sm font-medium">{count} dipilih</span>
      <fieldset
        disabled={busy}
        className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
      >
        {children}
      </fieldset>
      <div className="ml-auto">
        <ActionButton action="cancel" label="Batalkan pilihan" disabled={busy} onClick={onClear} />
      </div>
    </StickyActionBar>
  );
}
