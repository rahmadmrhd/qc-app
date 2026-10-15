import { customerKey, HANDOVER_LIMITS } from '@shared/handover';
import type { HandoverDto, SaveHandoverInput } from '@shared/rpc';
import { z } from 'zod';

export const HANDOVER_FIELD_KEYS = ['locationId', 'customerName', 'note', 'lines'] as const;
export type HandoverFieldErrors = Partial<Record<(typeof HANDOVER_FIELD_KEYS)[number], string>>;

const lineSchema = z.object({
  itemId: z.string().min(1),
  /** Hanya untuk tampilan; tidak dikirim ke server. */
  label: z.string(),
  qty: z
    .number()
    .int('Qty harus bilangan bulat')
    .min(1, 'Minimal 1')
    .max(HANDOVER_LIMITS.qtyMax, `Maksimal ${HANDOVER_LIMITS.qtyMax}`),
});

export const handoverFormSchema = z.object({
  locationId: z.string().min(1, 'Pilih lokasi'),
  customerName: z
    .string()
    .trim()
    .max(HANDOVER_LIMITS.customerName, `Maksimal ${HANDOVER_LIMITS.customerName} karakter`)
    .refine(
      (value) => value === '' || customerKey(value) !== '',
      'Nama customer harus memuat huruf atau angka',
    ),
  note: z.string().trim().max(HANDOVER_LIMITS.note, `Maksimal ${HANDOVER_LIMITS.note} karakter`),
  lines: z
    .array(lineSchema)
    .min(1, 'Minimal satu baris')
    .max(HANDOVER_LIMITS.lines, `Maksimal ${HANDOVER_LIMITS.lines} baris`)
    .refine(
      (lines) => new Set(lines.map((line) => line.itemId)).size === lines.length,
      'Tipe yang sama muncul dua kali',
    ),
});

export type HandoverFormInput = z.input<typeof handoverFormSchema>;
export type HandoverFormOutput = z.output<typeof handoverFormSchema>;

export function toHandoverFormDefaults(handover?: HandoverDto, locationId = ''): HandoverFormInput {
  if (!handover) return { locationId, customerName: '', note: '', lines: [] };
  return {
    locationId: handover.locationId,
    customerName: handover.customerName,
    note: handover.note,
    lines: handover.lines.map((line) => ({
      itemId: line.itemId,
      label: line.itemLabel,
      qty: line.qty,
    })),
  };
}

export function toSaveHandoverInput(values: HandoverFormOutput, id?: string): SaveHandoverInput {
  const input: SaveHandoverInput = {
    locationId: values.locationId,
    customerName: values.customerName,
    note: values.note,
    lines: values.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
  };
  return id ? { id, ...input } : input;
}
