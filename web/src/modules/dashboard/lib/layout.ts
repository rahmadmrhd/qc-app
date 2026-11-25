import type { WidgetMeta } from '@shared/dashboard';

/**
 * Kelompokkan widget (urutan tetap) menjadi baris kisi: widget BERURUTAN dengan `meta.row` yang sama satu baris.
 * Jenis berbeda tak pernah satu baris karena `row` ditetapkan per jenis di `shared/dashboard.ts` (number card satu
 * baris, grafik satu baris, daftar satu baris; satu-satunya pasangan sengaja adalah Hasil penutupan + Laporan terbuka
 * terlama). Widget yang tak boleh dilihat dibuang SEBELUM dikelompokkan, jadi tak ada celah.
 */
export function rowsOf(widgets: readonly WidgetMeta[]): WidgetMeta[][] {
  const rows: WidgetMeta[][] = [];
  for (const meta of widgets) {
    const last = rows[rows.length - 1];
    if (last && last[0]?.row === meta.row) last.push(meta);
    else rows.push([meta]);
  }
  return rows;
}

/**
 * Kelas kolom kartu di kisi 12 kolom (kelas harus literal agar Tailwind membuatnya). Ponsel: kisi 2 kolom, number
 * card satu kolom (yang ganjil dan terakhir selebar dua kolom) dan lainnya selebar dua kolom. >= 768 px: number
 * card menurut `span`; kartu lain selebar 12 kolom, atau berdampingan sesuai `span` di layar lebar (xl).
 */
const CELL: Record<string, string> = {
  'number-3': 'col-span-1 max-md:[&:last-child:nth-child(odd)]:col-span-2 md:col-span-3',
  'number-4': 'col-span-1 max-md:[&:last-child:nth-child(odd)]:col-span-2 md:col-span-4',
  'number-6': 'col-span-1 max-md:[&:last-child:nth-child(odd)]:col-span-2 md:col-span-6',
  'wide-4': 'col-span-2 md:col-span-6 xl:col-span-4',
  'wide-5': 'col-span-2 md:col-span-12 xl:col-span-5',
  'wide-6': 'col-span-2 md:col-span-6',
  'wide-7': 'col-span-2 md:col-span-12 xl:col-span-7',
  'wide-12': 'col-span-2 md:col-span-12',
};

export function cellClass(meta: WidgetMeta): string {
  const kind = meta.visual === 'number' ? 'number' : 'wide';
  return CELL[`${kind}-${meta.span}`] ?? 'col-span-2 md:col-span-12';
}

/** Kelas kisi satu baris. */
export const ROW_CLASS = 'grid grid-cols-2 gap-3 md:grid-cols-12';
