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
 * Di layar lebar ikut alur halaman.
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
      className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center gap-2 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.08)] md:static md:z-auto md:rounded-lg md:border md:bg-muted/30 md:p-3 md:shadow-none"
    >
      <p role="status" className="mr-auto text-sm font-medium">
        {count} dipilih
      </p>
      <Button type="button" size="sm" onClick={onEdit}>
        Edit
      </Button>
      <Button type="button" variant="destructive" size="sm" onClick={onRemove}>
        Hapus
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        Batalkan pilihan
      </Button>
    </section>
  );
}
