/** Batas task serah terima (PRD FH2). */
export const HANDOVER_LIMITS = {
  note: 500,
  customerName: 100,
  qtyMax: 100_000,
  lines: 100,
} as const;

export type HandoverStoredStatus = 'open' | 'cancelled';
export type HandoverStatus = 'new' | 'in_progress' | 'done' | 'cancelled';

export interface ProgressLine {
  qty: number;
  doneQty: number;
}

/** Baru/Dikerjakan/Selesai diturunkan dari baris; Dibatalkan disimpan. Dipakai server dan klien. */
export function deriveHandoverStatus(
  stored: HandoverStoredStatus,
  lines: readonly ProgressLine[],
): HandoverStatus {
  if (stored === 'cancelled') return 'cancelled';
  if (lines.length > 0 && lines.every((line) => line.doneQty >= line.qty)) return 'done';
  if (lines.some((line) => line.doneQty > 0)) return 'in_progress';
  return 'new';
}

export function progressTotals(lines: readonly ProgressLine[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const line of lines) {
    done += Math.min(line.doneQty, line.qty);
    total += line.qty;
  }
  return { done, total };
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Tanggal `YYYYMMDD` menurut WIB (UTC+7), zona proyek (`appsscript.json`). */
export function dateKeyOf(epochMs: number): string {
  const date = new Date(epochMs + WIB_OFFSET_MS);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function handoverNumber(dateKey: string, sequence: number): string {
  return `ST-${dateKey}-${String(sequence).padStart(3, '0')}`;
}

/** Urutan berikutnya untuk hari itu: maksimum urutan yang ada + 1 (nomor rusak diabaikan). */
export function nextHandoverSequence(numbers: readonly string[], dateKey: string): number {
  const prefix = `ST-${dateKey}-`;
  let max = 0;
  for (const number of numbers) {
    if (!number.startsWith(prefix)) continue;
    const tail = number.slice(prefix.length);
    if (tail === '' || [...tail].some((ch) => ch < '0' || ch > '9')) continue;
    max = Math.max(max, Number(tail));
  }
  return max + 1;
}
