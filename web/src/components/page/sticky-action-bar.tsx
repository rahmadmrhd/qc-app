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
 * `placement="fixed"` (bawaan): `fixed inset-x-0 bottom-[var(--kb,0px)]` selebar layar, naik setinggi papan ketik layar
 * lewat `--kb` (iOS tak mengecilkan viewport tata letak; review I8), dan mengukur tingginya ke `--action-bar-h` di
 * `<html>`; `<main>` memakainya sebagai padding bawah, jadi isi terakhir halaman tak pernah tertutup. `placement="sticky"`
 * = bar di alur halaman yang menempel di bawah (dipakai bar aksi massal desktop). Dipakai `BulkBar`, `ViewPage` dan
 * `FormPage` di ponsel, serta halaman lain yang butuh aksi selalu terlihat.
 */
export function StickyActionBar({
  label,
  busy,
  className,
  placement = 'fixed',
  children,
}: {
  /** Nama aksesibel bar. */
  label: string;
  busy?: boolean;
  className?: string;
  placement?: 'fixed' | 'sticky';
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const fixed = placement === 'fixed';
  useEffect(() => {
    const node = ref.current;
    if (!fixed || !node) return;
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
  }, [fixed]);
  return (
    <section
      ref={ref}
      aria-label={label}
      aria-busy={busy || undefined}
      data-slot="sticky-action-bar"
      data-placement={placement}
      className={cn(
        'z-20 flex items-center gap-2 bg-background p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
        fixed
          ? 'fixed inset-x-0 bottom-[var(--kb,0px)] border-t shadow-lg'
          : 'sticky bottom-[var(--kb,0px)] border shadow-lg',
        className,
      )}
    >
      {children}
    </section>
  );
}
