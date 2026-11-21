import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { RowSelection } from './use-row-selection';

/**
 * Header daftar saat mode pilih di ponsel: ✕ (keluar mode = kosongkan pilihan), "N dipilih", dan "Pilih semua".
 * Menempel di bawah bar headroom agar tetap terlihat saat menggulir.
 */
export function SelectionBar({
  selection,
  ids,
  onExit,
}: {
  selection: RowSelection;
  ids: readonly string[];
  /** Keluar dari mode pilih (bawaan: kosongkan pilihan). Mode yang dimulai lewat tombol "Pilih" perlu ini. */
  onExit?: () => void;
}) {
  const allSelected = ids.length > 0 && ids.every((id) => selection.selected.has(id));
  // Pemicu mode pilih ("Pilih" di menu, tombol, tekan lama) hilang dari layar: fokus pindah ke bar ini, bukan ke body (M7).
  const exitRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    exitRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      data-slot="selection-bar"
      className="sticky top-[var(--headroom-offset,3.5rem)] z-10 flex items-center gap-2 rounded-lg border bg-background px-1 py-0.5"
    >
      <Button
        ref={exitRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Keluar dari mode pilih"
        onClick={onExit ?? selection.clear}
      >
        <X aria-hidden />
      </Button>
      <span role="status" className="flex-1 text-sm font-medium">
        {selection.count} dipilih
      </span>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: Checkbox Radix adalah kontrolnya */}
      <label className="flex min-h-11 items-center gap-2 pr-3 text-sm">
        <Checkbox
          aria-label="Pilih semua"
          checked={allSelected}
          onCheckedChange={() => selection.setAll(ids, !allSelected)}
        />
        <span aria-hidden>Pilih semua</span>
      </label>
    </div>
  );
}

const HINT_KEY = 'qc.hint.long-press';

/** Petunjuk dianggap sudah dipelajari setelah tekan lama pertama berhasil (sekali per perangkat). */
export function markLongPressHintSeen(): void {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    // penyimpanan tak tersedia: petunjuk tetap muncul
  }
}

function hintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Jalan masuk mode pilih TANPA gestur (pengguna keyboard dan pembaca layar; review I6): tombol "Pilih" di atas daftar
 * kartu, berdampingan dengan petunjuk tekan lama.
 */
export function StartSelectButton({
  label,
  onStart,
  tour,
}: {
  label: string;
  onStart: () => void;
  /** `data-tour` untuk panduan interaktif. */
  tour?: string;
}) {
  return (
    <div className="flex justify-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={label}
        data-tour={tour}
        onClick={onStart}
      >
        Pilih
      </Button>
    </div>
  );
}

/** Petunjuk sekali per perangkat: "Tahan kartu untuk memilih beberapa" (bisa ditutup). */
export function LongPressHint() {
  const [dismissed, setDismissed] = useState(hintDismissed);
  if (dismissed) return null;
  return (
    <div
      role="note"
      className="flex items-center gap-2 rounded-lg bg-info-text/10 py-0.5 pl-3 text-sm text-info-text"
    >
      <span className="flex-1">Tahan kartu untuk memilih beberapa</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Tutup petunjuk"
        onClick={() => {
          try {
            localStorage.setItem(HINT_KEY, '1');
          } catch {
            // penyimpanan tak tersedia: petunjuk muncul lagi di kunjungan berikutnya
          }
          setDismissed(true);
        }}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
