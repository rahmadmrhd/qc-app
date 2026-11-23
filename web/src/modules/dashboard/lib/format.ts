const NUMBER_FORMAT = new Intl.NumberFormat('id-ID');

/** Angka dengan pemisah ribuan Indonesia (`1.234.567`). */
export function formatNumber(n: number): string {
  return NUMBER_FORMAT.format(n);
}

export interface DeltaText {
  text: string;
  tone: 'success' | 'danger' | 'muted';
}

/**
 * Perbandingan dengan periode sebelumnya yang sama panjang. Tanpa pembanding atau pembanding 0 = `null` (persen dari
 * nol tak bermakna). Selalu berupa kata (naik/turun/tetap), bukan warna saja.
 */
export function formatDelta(value: number, previous: number | undefined): DeltaText | null {
  if (previous === undefined || previous === 0) return null;
  if (value === previous) return { text: 'tetap dari periode lalu', tone: 'muted' };
  const percent = Math.max(1, Math.round((Math.abs(value - previous) / Math.abs(previous)) * 100));
  return value > previous
    ? { text: `naik ${percent}% dari periode lalu`, tone: 'success' }
    : { text: `turun ${percent}% dari periode lalu`, tone: 'danger' };
}
