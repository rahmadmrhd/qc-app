import type { DeltaGood } from '@shared/dashboard';

const NUMBER_FORMAT = new Intl.NumberFormat('id-ID');

/** Angka dengan pemisah ribuan Indonesia (`1.234.567`). */
export function formatNumber(n: number): string {
  return NUMBER_FORMAT.format(n);
}

export interface DeltaText {
  text: string;
  /** Arah nyata perubahan (menentukan panah dan kata), terlepas dari baik atau buruk. */
  direction: 'up' | 'down' | 'flat';
  /** Warna menurut baik/buruk: searah `good` = success, berlawanan = danger, tetap = muted. */
  tone: 'success' | 'danger' | 'muted';
}

/**
 * Perbandingan dengan periode sebelumnya yang sama panjang. Tanpa pembanding = `null`. Pembanding 0 tetap tampil tanpa
 * persen (persen dari nol tak bermakna): "naik dari periode lalu (0)", sama dengan surel laporan. Selalu berupa kata (naik/turun/tetap), bukan warna saja. `good` = arah yang baik untuk widget itu
 * (bawaan naik); mis. laporan rusak yang naik berwarna merah walau katanya "naik".
 */
export function formatDelta(
  value: number,
  previous: number | undefined,
  good: DeltaGood = 'up',
): DeltaText | null {
  if (previous === undefined) return null;
  if (value === previous) {
    return { text: 'tetap dari periode lalu', direction: 'flat', tone: 'muted' };
  }
  if (previous === 0) {
    const direction = value > 0 ? 'up' : 'down';
    return {
      text: `${direction === 'up' ? 'naik' : 'turun'} dari periode lalu (0)`,
      direction,
      tone: direction === good ? 'success' : 'danger',
    };
  }
  const percent = Math.max(1, Math.round((Math.abs(value - previous) / Math.abs(previous)) * 100));
  const direction = value > previous ? 'up' : 'down';
  const tone = direction === good ? 'success' : 'danger';
  return {
    text: `${direction === 'up' ? 'naik' : 'turun'} ${percent}% dari periode lalu`,
    direction,
    tone,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** `2026-11-23` menjadi `23 Nov 2026` (tanggal tak sah dikembalikan apa adanya). */
export function formatDayLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : day;
}

/** Rentang tanggal untuk chip: `25 Okt 2026 – 23 Nov 2026`. */
export function formatRangeLabel(range: { from: string; to: string }): string {
  return `${formatDayLabel(range.from)} – ${formatDayLabel(range.to)}`;
}

/** Waktu ISO UTC sebagai teks WIB ringkas (`24 Nov 2026 14.30`); nilai tak sah dikembalikan apa adanya. */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  });
}
