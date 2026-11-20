import { cn } from 'cn';
import type { ReactNode } from 'react';

/**
 * Bar aksi yang menempel di tepi bawah layar (menghormati `env(safe-area-inset-bottom)`; z-index di bawah dialog).
 * Naik setinggi papan ketik layar lewat `--kb` (iOS tak mengecilkan viewport tata letak; review I8). Berada di alur halaman (paling akhir di kerangka), jadi isi terakhir tak pernah tertutup. Dipakai `BulkBar`,
 * `FormPage` di ponsel (Batal + Simpan), dan halaman lain yang butuh aksi selalu terlihat.
 */
export function StickyActionBar({
  label,
  busy,
  className,
  children,
}: {
  /** Nama aksesibel bar. */
  label: string;
  busy?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      aria-busy={busy || undefined}
      data-slot="sticky-action-bar"
      className={cn(
        'sticky bottom-[var(--kb,0px)] z-20 flex items-center gap-2 border bg-background p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg',
        className,
      )}
    >
      {children}
    </section>
  );
}
