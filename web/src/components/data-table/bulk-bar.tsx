import { Ellipsis } from 'lucide-react';
import {
  Children,
  Fragment,
  isValidElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { ActionButton } from '@/components/action-button';
import { BulkActiveContext } from '@/components/page/bulk-active';
import { useSelectMode } from '@/components/page/select-mode';
import { StickyActionBar } from '@/components/page/sticky-action-bar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
 * Bar aksi massal; tak dirender bila belum ada baris terpilih (ponsel: juga bila belum dalam mode pilih). `busy` (dari
 * `useBulkAction`) menonaktifkan semua tombol di dalamnya selama aksi berjalan, agar klik ganda tak mengirim dua kali.
 *
 * Desktop (>= 768 px): bar di ATAS tabel (`ListPage` menaruhnya di bawah bar judul, sebelum header tabel dan ikut
 * terukur dalam `--headroom-offset`) dengan urutan Batalkan pilihan, jumlah dipilih, spacer, lalu tombol aksi.
 * Ponsel: SATU bar `fixed` di bawah layar (mode pilih tidak punya bar atas): baris pertama Batalkan pilihan, "N dipilih",
 * dan Pilih semua; baris kedua dua aksi pertama + menu "⋯" bila ada butir terpilih.
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
  const mode = useSelectMode();
  const active = count > 0;
  useEffect(() => {
    if (!active) return;
    bulkActive?.(true);
    return () => bulkActive?.(false);
  }, [active, bulkActive]);

  if (!desktop) {
    if (!active && !mode) return null;
    return (
      <PhoneBar count={count} onClear={onClear} busy={busy}>
        {children}
      </PhoneBar>
    );
  }
  if (!active) return null;

  return (
    <section
      aria-label="Aksi massal"
      aria-busy={busy || undefined}
      data-slot="bulk-bar"
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2"
    >
      <ActionButton action="cancel" label="Batalkan pilihan" disabled={busy} onClick={onClear} />
      <span role="status" className="px-1 text-sm font-medium">
        {count} dipilih
      </span>
      <div className="ml-auto" />
      <fieldset
        disabled={busy}
        className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
      >
        {children}
      </fieldset>
    </section>
  );
}

function PhoneBar({
  count,
  onClear,
  busy,
  children,
}: {
  count: number;
  onClear: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const mode = useSelectMode();
  // Pemicu mode pilih ("Pilih" di menu, tombol, tekan lama) hilang dari layar: fokus pindah ke tombol batal (M7).
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus({ preventScroll: true });
  }, []);
  const items = flatten(children);
  const primary = items.slice(0, MOBILE_PRIMARY);
  const rest = items.slice(MOBILE_PRIMARY);
  return (
    <StickyActionBar
      label="Aksi massal"
      busy={busy}
      className="flex-col items-stretch rounded-t-lg"
    >
      <div className="flex items-center gap-2">
        <Button
          ref={cancelRef}
          type="button"
          variant="ghost"
          color="primary"
          size="sm"
          disabled={busy}
          onClick={mode ? mode.exit : onClear}
        >
          Batalkan pilihan
        </Button>
        <span role="status" className="flex-1 px-1 text-sm font-medium">
          {count} dipilih
        </span>
        {mode ? (
          // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox Radix adalah kontrolnya
          <label className="flex min-h-11 items-center gap-2 pr-1 text-sm">
            <Checkbox
              aria-label="Pilih semua"
              checked={mode.allSelected}
              disabled={busy}
              onCheckedChange={mode.toggleAll}
            />
            <span aria-hidden>Pilih semua</span>
          </label>
        ) : null}
      </div>
      {count > 0 ? (
        <fieldset disabled={busy} className="m-0 flex min-w-0 items-center gap-2 border-0 p-0">
          {primary}
          {rest.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  color="primary"
                  size="icon"
                  aria-label="Aksi lainnya"
                >
                  <Ellipsis aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="flex w-auto flex-col items-stretch gap-2 p-2">
                {/* Portal: di luar fieldset induk, jadi dinonaktifkan sendiri selama aksi berjalan (review M1). */}
                <fieldset
                  disabled={busy}
                  className="m-0 flex flex-col items-stretch gap-2 border-0 p-0"
                >
                  {rest}
                </fieldset>
              </PopoverContent>
            </Popover>
          ) : null}
        </fieldset>
      ) : null}
    </StickyActionBar>
  );
}
