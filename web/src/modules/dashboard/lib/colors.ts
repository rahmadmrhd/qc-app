import type { PartsData } from '@shared/dashboard';

/**
 * Warna seri grafik: palet `--chart-1..8` di `styles.css` (keputusan pemilik 2026-11-25: grafik TIDAK PERNAH memakai
 * warna netral, termasuk irisan "Lainnya"). Tiap token >= 3:1 terhadap latar kartu pada mode terang dan gelap dan
 * berwarna (dijaga `styles.contrast.test.ts`). Urutan dipilih agar irisan bersebelahan berbeda jelas.
 */
export const CHART_SERIES_TOKENS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const;

/** Warna irisan "Lainnya": token terakhir palet (tetap berwarna, berbeda dari tujuh irisan di depannya). */
export const OTHER_SERIES_COLOR = 'var(--chart-8)';

/** Kunci irisan hasil penggabungan `limitSlices`. */
export const OTHER_SLICE_KEY = 'other';

/** Warna seri ke-`index` (mulai 0); melewati jumlah token = berputar kembali (tak pernah netral). */
export function seriesColor(index: number): string {
  return CHART_SERIES_TOKENS[index % CHART_SERIES_TOKENS.length] ?? OTHER_SERIES_COLOR;
}

/** Warna irisan: irisan "Lainnya" memakai token terakhir, selain itu menurut urutan. */
export function sliceColor(key: string, index: number): string {
  return key === OTHER_SLICE_KEY ? OTHER_SERIES_COLOR : seriesColor(index);
}

/**
 * Batasi irisan sampai `max`: lebih banyak dari `max` = `max - 1` irisan terbesar ditambah satu irisan "Lainnya"
 * berisi jumlah sisanya. Tidak lebih dari `max` = apa adanya (urutan asli).
 */
export function limitSlices(
  slices: PartsData['slices'],
  max = CHART_SERIES_TOKENS.length,
): PartsData['slices'] {
  if (slices.length <= max) return slices;
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const kept = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce((total, slice) => total + slice.value, 0);
  return [...kept, { key: OTHER_SLICE_KEY, label: 'Lainnya', value: rest }];
}
