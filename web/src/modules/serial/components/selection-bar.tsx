import { useEffect, useRef } from 'react';
import { useSelectMode } from '@/components/page/select-mode';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

export interface SelectionBarProps {
  count: number;
  onEdit(): void;
  onRemove(): void;
  onClear(): void;
}

/**
 * Bar aksi untuk baris yang dicentang: "n dipilih", Edit (ubah massal), Hapus, Batalkan pilihan. Muncul hanya bila ada
 * baris terpilih. Di ponsel menempel di bawah layar (`fixed`, jarak aman bilah gestur) sehingga TIDAK memakan tinggi di
 * alur halaman; ruang agar konten terbawah tidak tertutup disediakan pembungkus halaman (`SELECTION_BAR_SPACE_CLASS`).
 * Di layar lebar ikut alur halaman dengan tombol di KIRI (dekat kotak centang tabel) dan teks "n dipilih" sesudahnya.
 * `narrow:m-0`: pembungkus halaman memakai `space-y-*` yang memberi margin-bawah pada anak non-terakhir, dan margin itu
 * mengangkat bar `fixed bottom-0` dari tepi layar (celah di bawah bar).
 * "Pilih semua" di layar lebar tetap dari kotak centang header tabel; di ponsel (mode pilih kartu draft, lewat
 * `SelectModeProvider`) bar ini SATU-SATUNYA bar mode pilih: tampil juga saat belum ada butir terpilih dan memuat
 * Batalkan pilihan, "N dipilih", dan Pilih semua.
 */
/** Padding bawah pembungkus halaman selama bar aksi tampil di ponsel (setinggi bar dua baris + jarak aman). */
export const SELECTION_BAR_SPACE_CLASS = 'narrow:pb-[calc(7rem+env(safe-area-inset-bottom))]';

export function SelectionBar({ count, onEdit, onRemove, onClear }: SelectionBarProps) {
  const mode = useSelectMode();
  const inMode = mode !== null;
  // Pemicu mode pilih (tombol "Pilih", tekan lama) hilang dari layar: fokus pindah ke tombol batal (M7).
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (inMode) cancelRef.current?.focus({ preventScroll: true });
  }, [inMode]);
  if (count === 0 && !mode) return null;
  return (
    <section
      aria-label="Aksi baris terpilih"
      data-tour="serial-bulk"
      className="fixed inset-x-0 bottom-0 z-40 narrow:m-0 flex flex-wrap items-center gap-2 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.08)] wide:static wide:z-auto wide:rounded-lg wide:border wide:bg-muted/30 wide:p-3 wide:shadow-none"
    >
      {count > 0 ? (
        <>
          <Button type="button" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button type="button" variant="soft" color="destructive" size="sm" onClick={onRemove}>
            Hapus
          </Button>
        </>
      ) : null}
      <Button
        ref={cancelRef}
        type="button"
        variant="ghost"
        color="primary"
        size="sm"
        onClick={mode ? mode.exit : onClear}
      >
        Batalkan pilihan
      </Button>
      {/* Sesudah tombol di DOM (urutan baca = urutan visual di layar lebar); di ponsel tampil paling depan. */}
      <p role="status" className="text-sm font-medium narrow:order-first narrow:mr-auto wide:ml-2">
        {count} dipilih
      </p>
      {mode ? (
        // biome-ignore lint/a11y/noLabelWithoutControl: Checkbox Radix adalah kontrolnya
        <label className="order-first flex min-h-11 items-center gap-2 text-sm">
          <Checkbox
            aria-label="Pilih semua"
            checked={mode.allSelected}
            onCheckedChange={mode.toggleAll}
          />
          <span aria-hidden>Pilih semua</span>
        </label>
      ) : null}
    </section>
  );
}
