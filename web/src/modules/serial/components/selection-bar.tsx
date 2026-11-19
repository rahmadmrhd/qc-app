import { Button } from '@/components/ui/button';

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
 * `max-md:m-0`: pembungkus halaman memakai `space-y-*` yang memberi margin-bawah pada anak non-terakhir, dan margin itu
 * mengangkat bar `fixed bottom-0` dari tepi layar (celah di bawah bar).
 * "Pilih semua" tetap dari kotak centang header tabel/daftar.
 */
/** Padding bawah pembungkus halaman selama bar aksi tampil di ponsel (setinggi bar dua baris + jarak aman). */
export const SELECTION_BAR_SPACE_CLASS = 'max-md:pb-[calc(7rem+env(safe-area-inset-bottom))]';

export function SelectionBar({ count, onEdit, onRemove, onClear }: SelectionBarProps) {
  if (count === 0) return null;
  return (
    <section
      aria-label="Aksi baris terpilih"
      data-tour="serial-bulk"
      className="fixed inset-x-0 bottom-0 z-40 max-md:m-0 flex flex-wrap items-center gap-2 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.08)] md:static md:z-auto md:rounded-lg md:border md:bg-muted/30 md:p-3 md:shadow-none"
    >
      <Button type="button" size="sm" onClick={onEdit}>
        Edit
      </Button>
      <Button type="button" variant="destructive" size="sm" onClick={onRemove}>
        Hapus
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        Batalkan pilihan
      </Button>
      {/* Sesudah tombol di DOM (urutan baca = urutan visual di layar lebar); di ponsel tampil paling depan. */}
      <p role="status" className="text-sm font-medium max-md:order-first max-md:mr-auto md:ml-2">
        {count} dipilih
      </p>
    </section>
  );
}
