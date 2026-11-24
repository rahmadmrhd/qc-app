import type { PartsData } from '@shared/dashboard';

/**
 * Warna seri grafik: token semantik yang SUDAH ada di `styles.css` (tidak ada token baru), memakai nada teks/garis
 * (`-text`) yang lolos kontras AA di atas latar kartu pada mode terang dan gelap (dijaga `styles.contrast.test.ts`).
 * Primary memakai `--foreground` (aturan nada primary di sistem desain). Urutan dipilih agar irisan bersebelahan
 * berbeda jelas.
 */
export const CHART_SERIES_TOKENS = [
  'var(--foreground)',
  'var(--info-text)',
  'var(--success-text)',
  'var(--warning-text)',
  'var(--destructive-text)',
  'var(--secondary-text)',
] as const;

/** Warna netral untuk irisan "Lainnya" dan seri di luar enam token. */
export const OTHER_SERIES_COLOR = 'var(--muted-foreground)';

/** Kunci irisan hasil penggabungan `limitSlices`. */
export const OTHER_SLICE_KEY = 'other';

/** Warna seri ke-`index` (mulai 0); indeks >= jumlah token = warna "Lainnya". */
export function seriesColor(index: number): string {
  return CHART_SERIES_TOKENS[index] ?? OTHER_SERIES_COLOR;
}

/** Warna irisan: irisan "Lainnya" selalu netral, selain itu menurut urutan. */
export function sliceColor(key: string, index: number): string {
  return key === OTHER_SLICE_KEY ? OTHER_SERIES_COLOR : seriesColor(index);
}

/**
 * Batasi irisan sampai `max`: lebih banyak dari `max` = `max - 1` irisan terbesar ditambah satu irisan "Lainnya"
 * berisi jumlah sisanya. Tidak lebih dari `max` = apa adanya (urutan asli).
 */
export function limitSlices(slices: PartsData['slices'], max = 6): PartsData['slices'] {
  if (slices.length <= max) return slices;
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const kept = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce((total, slice) => total + slice.value, 0);
  return [...kept, { key: OTHER_SLICE_KEY, label: 'Lainnya', value: rest }];
}
