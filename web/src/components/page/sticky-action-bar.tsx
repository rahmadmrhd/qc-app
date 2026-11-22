import { cn } from 'cn';
import { type ReactNode, useEffect, useRef } from 'react';

/** Tinggi tiap bar `fixed` yang sedang terpasang; `--action-bar-h` di `<html>` = yang tertinggi (padding bawah `main`). */
const heights = new Map<symbol, number>();

function publishHeight() {
  const max = Math.max(0, ...heights.values());
  document.documentElement.style.setProperty('--action-bar-h', `${max}px`);
}

/**
 * Bar aksi di tepi bawah layar ponsel (menghormati `env(safe-area-inset-bottom)`; z-index di bawah dialog).
 * `fixed inset-x-0 bottom-[var(--kb,0px)]` selebar layar, naik setinggi papan ketik layar
 * lewat `--kb` (iOS tak mengecilkan viewport tata letak; review I8), dan mengukur tingginya ke `--action-bar-h` di
 * `<html>`; `<main>` memakai tinggi itu sebagai padding bawah, jadi isi terakhir halaman tak pernah tertutup. Hanya untuk
 * ponsel: dipakai `BulkBar`, `ViewPage` dan `FormPage` di ponsel, serta halaman lain yang butuh aksi selalu terlihat.
 *
 * `placement="inline"` untuk bar DI DALAM dialog (penggulir dialog; dialog bertransform sehingga `fixed` akan menempel di
 * dasar kotak dialog dan menutupi isi terakhir): bar `sticky -bottom-4` di alur isi (offset -1rem mengimbangi padding penggulir `p-4`, seperti `DialogFooter`:
 * area sticky terinset sebesar padding itu, jadi `bottom-0` menyisakan 16 px isi di bawah bar), selebar penggulir (`-mx-4 -mb-4`), tidak ikut `--action-bar-h` (yang hanya milik `<main>`) dan tidak memakai `--kb`
 * (dialog layar penuh sudah mengecil mengikuti papan ketik lewat `--vvh`).
 */
export function StickyActionBar({
  label,
  busy,
  className,
  placement = 'viewport',
  children,
}: {
  /** Nama aksesibel bar. */
  label: string;
  busy?: boolean;
  className?: string;
  placement?: 'viewport' | 'inline';
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || placement === 'inline') return;
    const key = Symbol('action-bar');
    const measure = () => {
      heights.set(key, node.offsetHeight);
      publishHeight();
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      heights.delete(key);
      publishHeight();
    };
  }, [placement]);
  return (
    <section
      ref={ref}
      aria-label={label}
      aria-busy={busy || undefined}
      data-slot="sticky-action-bar"
      className={cn(
        'z-20 flex items-center gap-2 border-t bg-background p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg',
        placement === 'inline'
          ? 'sticky -bottom-4 -mx-4 -mb-4'
          : 'fixed inset-x-0 bottom-[var(--kb,0px)]',
        className,
      )}
    >
      {children}
    </section>
  );
}
