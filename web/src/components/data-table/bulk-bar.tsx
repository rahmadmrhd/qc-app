import type { ReactNode } from 'react';
import { ActionButton } from '@/components/action-button';

/**
 * Bar aksi massal yang menempel di bawah layar; tak dirender bila belum ada baris terpilih. `busy` (dari
 * `useBulkAction`) menonaktifkan semua tombol di dalamnya selama aksi berjalan, agar klik ganda tak mengirim dua kali.
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
  if (count === 0) return null;
  return (
    <section
      aria-label="Aksi massal"
      aria-busy={busy || undefined}
      className="sticky bottom-0 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg max-md:rounded-b-none"
    >
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
    </section>
  );
}
