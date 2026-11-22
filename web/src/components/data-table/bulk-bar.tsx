import { type ReactNode, useContext, useEffect } from 'react';
import { ActionButton } from '@/components/action-button';
import { BulkActiveContext } from '@/components/page/bulk-active';
import { useSelectMode } from '@/components/page/select-mode';
import { SelectModeBar } from '@/components/page/select-mode-bar';
import { useIsDesktop } from '@/hooks/use-is-desktop';

/**
 * Bar aksi massal; tak dirender bila belum ada baris terpilih (ponsel: juga bila belum dalam mode pilih). `busy` (dari
 * `useBulkAction`) menonaktifkan semua tombol di dalamnya selama aksi berjalan, agar klik ganda tak mengirim dua kali.
 *
 * Desktop (>= 768 px): bar di ATAS tabel (`ListPage` menaruhnya di bawah bar judul, sebelum header tabel dan ikut
 * terukur dalam `--headroom-offset`) dengan urutan Batalkan pilihan, jumlah dipilih, spacer, lalu tombol aksi.
 * Ponsel: SATU baris `fixed` di bawah layar (mode pilih tidak punya bar atas): kotak centang tri-state (semua,
 * sebagian, kosong), "N dipilih", lalu aksi; lebih dari dua aksi = aksi pertama langsung + menu "⋯". Tanpa tombol
 * "Batalkan pilihan": keluar lewat kosongkan kotak centang, tombol/gestur kembali, atau Escape (`SelectModeBar`).
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
  // Tanpa penampung mode pilih (BulkBar di luar `ListPage`) hanya jumlah terpilih yang diketahui: kotak centang
  // menampilkan "sebagian" dan mengklik-nya mengosongkan pilihan.
  return (
    <SelectModeBar
      count={count}
      allSelected={mode ? mode.allSelected : false}
      onToggleAll={mode ? mode.toggleAll : onClear}
      onExit={mode ? mode.exit : onClear}
      busy={busy}
      checkboxLabel={mode ? 'Pilih semua' : 'Kosongkan pilihan'}
    >
      {children}
    </SelectModeBar>
  );
}
