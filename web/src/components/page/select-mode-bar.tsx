import { Ellipsis } from 'lucide-react';
import { Children, Fragment, isValidElement, type ReactNode, useEffect, useRef } from 'react';
import { StickyActionBar } from '@/components/page/sticky-action-bar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Meratakan anak (termasuk Fragment) menjadi daftar elemen. */
export function flattenActions(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    if (isValidElement(child) && child.type === Fragment) {
      out.push(...flattenActions((child.props as { children?: ReactNode }).children));
    } else {
      out.push(child);
    }
  }
  return out;
}

/** Dialog, menu, atau daftar yang sedang terbuka menangani Escape sendiri: Escape tak boleh ikut keluar dari mode pilih. */
const OPEN_OVERLAY = '[role=dialog],[role=alertdialog],[role=menu],[role=listbox]';

/**
 * Bagian kiri bar mode pilih ponsel (dipakai `SelectModeBar` dan bar Serial Number): kotak centang tri-state "Pilih
 * semua" (semua terpilih = centang, sebagian = minus/indeterminate, kosong = kotak kosong) lalu "N dipilih".
 *
 * Klik saat semua terpilih = kosongkan (dan mode pilih berakhir otomatis); selain itu = pilih semua. Tidak ada tombol
 * "Batalkan pilihan": keluar lewat kosongkan, tombol/gestur kembali, atau Escape (papan ketik fisik). Fokus awal ke
 * kotak centang agar fokus tak jatuh ke body saat pemicu mode pilih (tombol "Pilih", tekan lama) hilang dari layar.
 */
export function SelectModeSummary({
  count,
  allSelected,
  onToggleAll,
  onExit,
  busy = false,
  checkboxLabel = 'Pilih semua',
}: {
  count: number;
  allSelected: boolean;
  /** Dipanggil saat kotak centang diklik: pilih semua, atau kosongkan bila sudah semua terpilih. */
  onToggleAll: () => void;
  /** Keluar dari mode pilih (Escape). */
  onExit: () => void;
  busy?: boolean;
  checkboxLabel?: string;
}) {
  const checkboxRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    checkboxRef.current?.focus({ preventScroll: true });
  }, []);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector(OPEN_OVERLAY)) return;
      exitRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  const checked = allSelected ? true : count > 0 ? 'indeterminate' : false;
  return (
    <>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Checkbox Radix adalah kontrolnya */}
      <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
        <Checkbox
          ref={checkboxRef}
          aria-label={checkboxLabel}
          checked={checked}
          disabled={busy}
          onCheckedChange={onToggleAll}
        />
      </label>
      <span role="status" className="min-w-0 truncate text-sm font-medium">
        {count > 0 ? `${count} dipilih` : 'Pilih item'}
      </span>
    </>
  );
}

/**
 * Bar mode pilih ponsel, SATU baris di tepi bawah layar: [kotak centang tri-state][N dipilih][jarak][aksi]. Aksi hanya
 * tampil bila ada butir terpilih. Sampai dua aksi tampil langsung; lebih dari dua = aksi pertama langsung dan sisanya
 * di menu "Aksi lainnya".
 */
export function SelectModeBar({
  count,
  allSelected,
  onToggleAll,
  onExit,
  busy = false,
  checkboxLabel,
  children,
}: {
  count: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onExit: () => void;
  busy?: boolean;
  checkboxLabel?: string;
  children?: ReactNode;
}) {
  const items = flattenActions(children);
  const overflow = items.length > 2;
  const direct = overflow ? items.slice(0, 1) : items;
  const rest = overflow ? items.slice(1) : [];
  return (
    <StickyActionBar label="Aksi massal" busy={busy}>
      <SelectModeSummary
        count={count}
        allSelected={allSelected}
        onToggleAll={onToggleAll}
        onExit={onExit}
        busy={busy}
        checkboxLabel={checkboxLabel}
      />
      {count > 0 && items.length > 0 ? (
        <fieldset
          disabled={busy}
          className="m-0 ml-auto flex min-w-0 items-center gap-2 border-0 p-0"
        >
          {direct}
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
              <PopoverContent
                align="end"
                className="flex w-auto min-w-56 flex-col items-stretch gap-2 p-2"
              >
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
