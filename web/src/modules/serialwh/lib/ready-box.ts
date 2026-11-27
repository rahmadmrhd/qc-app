import type { WarehouseItemOptionDto } from '@shared/contract';
import { assignBoxes } from '@shared/serial-warehouse';

/**
 * Opsi Item Gudang dengan pcs per kardus. `boxSize` belum ada di `WarehouseItemOptionDto` kontrak: dibaca bila server
 * mengirimnya, selain itu isian "Isi per kardus" kosong dan diisi pengguna.
 */
export type WarehouseItemWithBox = WarehouseItemOptionDto & { boxSize?: number };

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
