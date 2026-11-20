import type { ReactNode } from 'react';
import { ActionButton } from '@/components/action-button';

/** Bar aksi massal yang menempel di bawah layar; tak dirender bila belum ada baris terpilih. */
export function BulkBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section
      aria-label="Aksi massal"
      className="sticky bottom-0 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2 shadow-lg"
    >
      <span className="px-2 text-sm font-medium">{count} dipilih</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <div className="ml-auto">
        <ActionButton action="cancel" label="Batalkan pilihan" onClick={onClear} />
      </div>
    </section>
  );
}
