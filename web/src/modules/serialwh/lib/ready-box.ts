import { assignBoxes } from '@shared/serial-warehouse';
import { CUSTODY_LABEL, STATUS_LABEL } from '@/modules/serial/lib/labels';

/** Bilangan bulat positif dari isian teks, atau `null` bila kosong, bukan bilangan bulat, atau <= 0. */
export function parsePositiveInt(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Ringkasan perkiraan pembagian kardus, mis. "Kardus 12-14: 2 penuh, 1 ecer (5 unit)"; `null` bila tak ada isi. */
export function boxPlanSummary(input: {
  startNumber: number;
  size: number;
  count: number;
}): string | null {
  const plan = assignBoxes(input);
  const [first] = plan;
  const last = plan[plan.length - 1];
  if (!first || !last) return null;
  const full = plan.filter((box) => box.take === input.size).length;
  const loose = plan.filter((box) => box.take < input.size);
  const parts: string[] = [];
  if (full > 0) parts.push(`${full} penuh`);
  if (loose.length > 0) {
    const units = loose.reduce((sum, box) => sum + box.take, 0);
    parts.push(`${loose.length} ecer (${units} unit)`);
  }
  const range = first.number === last.number ? `${first.number}` : `${first.number}-${last.number}`;
  return `Kardus ${range}: ${parts.join(', ')}`;
}

/** Memotong daftar ke `max` baris; `truncated` = ada yang terbuang. */
export function capRows<T>(rows: readonly T[], max: number): { rows: T[]; truncated: boolean } {
  return rows.length > max
    ? { rows: rows.slice(0, max), truncated: true }
    : { rows: [...rows], truncated: false };
}

/** Tanda serial yang tak dapat dikeluarkan karena bukan `good` di `qc` (label status/posisi serial); `''` bila boleh. */
export function readyProblemLabel(status: string, custody: string): string {
  if (status !== 'good') return (STATUS_LABEL as Record<string, string>)[status] ?? status;
  if (custody !== 'qc') return (CUSTODY_LABEL as Record<string, string>)[custody] ?? custody;
  return '';
}
