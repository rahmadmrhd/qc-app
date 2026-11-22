import { useSelectMode } from '@/components/page/select-mode';
import { SelectModeSummary } from '@/components/page/select-mode-bar';
import { Button } from '@/components/ui/button';

export interface SelectionBarProps {
  count: number;
  onEdit(): void;
  onRemove(): void;
  onClear(): void;
}

/**
 * Bar aksi untuk baris yang dicentang. Muncul hanya bila ada baris terpilih (atau, di ponsel, selama mode pilih kartu
 * draft). Tidak memakan tinggi di alur halaman: ruang agar konten terbawah tidak tertutup disediakan pembungkus
 * halaman (`SELECTION_BAR_SPACE_CLASS`).
 *
 * Mode pilih kartu draft di ponsel (lewat `SelectModeProvider`): SATU baris `fixed` di bawah layar, yaitu kotak
 * centang tri-state "Pilih semua", "N dipilih", jarak, lalu Edit (ubah massal) dan Hapus; tampil juga saat belum ada
 * butir terpilih (aksi baru tampil setelah memilih). Tanpa tombol "Batalkan pilihan": keluar lewat kosongkan kotak
 * centang, tombol/gestur kembali, atau Escape (`SelectModeSummary`).
 *
 * Tabel draft (layar lebar, tanpa mode pilih): ikut alur halaman dengan tombol di KIRI (dekat kotak centang tabel),
 * lalu Batalkan pilihan dan teks "n dipilih"; "Pilih semua" dari kotak centang header tabel. `narrow:m-0`: pembungkus
 * halaman memakai `space-y-*` yang memberi margin-bawah pada anak non-terakhir, dan margin itu mengangkat bar `fixed
 * bottom-0` dari tepi layar (celah di bawah bar).
 */
/** Padding bawah pembungkus halaman selama bar aksi tampil di ponsel (setinggi bar SATU baris + jarak aman). */
export const SELECTION_BAR_SPACE_CLASS = 'narrow:pb-[calc(5rem+env(safe-area-inset-bottom))]';

export function SelectionBar({ count, onEdit, onRemove, onClear }: SelectionBarProps) {
  const mode = useSelectMode();
  if (count === 0 && !mode) return null;
  if (mode) {
    return (
      <section
        aria-label="Aksi baris terpilih"
        data-tour="serial-bulk"
        className="fixed inset-x-0 bottom-0 z-40 narrow:m-0 flex items-center gap-2 border-t bg-background px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.08)]"
      >
        <SelectModeSummary
          count={count}
          allSelected={mode.allSelected}
          onToggleAll={mode.toggleAll}
          onExit={mode.exit}
        />
        {count > 0 ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button type="button" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button type="button" variant="soft" color="destructive" size="sm" onClick={onRemove}>
              Hapus
            </Button>
          </div>
        ) : null}
      </section>
    );
  }
  return (
    <section
      aria-label="Aksi baris terpilih"
      data-tour="serial-bulk"
      className="fixed inset-x-0 bottom-0 z-40 narrow:m-0 flex flex-wrap items-center gap-2 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.08)] wide:static wide:z-auto wide:rounded-lg wide:border wide:bg-muted/30 wide:p-3 wide:shadow-none"
    >
      <Button type="button" size="sm" onClick={onEdit}>
        Edit
      </Button>
      <Button type="button" variant="soft" color="destructive" size="sm" onClick={onRemove}>
        Hapus
      </Button>
      <Button type="button" variant="ghost" color="primary" size="sm" onClick={onClear}>
        Batalkan pilihan
      </Button>
      {/* Sesudah tombol di DOM (urutan baca = urutan visual di layar lebar); di ponsel tampil paling depan. */}
      <p role="status" className="text-sm font-medium narrow:order-first narrow:mr-auto wide:ml-2">
        {count} dipilih
      </p>
    </section>
  );
}
