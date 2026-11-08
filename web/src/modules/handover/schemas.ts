import type {
  HandoverDto,
  HandoverSaveBase,
  SaveHandoverBatchInput,
  SaveHandoverInput,
} from '@shared/contract';
import { customerKey, HANDOVER_LIMITS } from '@shared/handover';
import { extractChecklist } from '@shared/handover-checklist';
import { z } from 'zod';

export const HANDOVER_FIELD_KEYS = ['locationId', 'customerName', 'note'] as const;
export type HandoverFieldErrors = Partial<Record<(typeof HANDOVER_FIELD_KEYS)[number], string>>;

const customerNameSchema = z
  .string()
  .trim()
  .max(HANDOVER_LIMITS.customerName, `Maksimal ${HANDOVER_LIMITS.customerName} karakter`)
  .refine(
    (value) => value === '' || customerKey(value) !== '',
    'Nama customer harus memuat huruf atau angka',
  );

/** Catatan wajib terisi (bukan hanya spasi), maks. 5.000 karakter dan 300 butir checklist. */
const noteSchema = z
  .string()
  .trim()
  .min(1, 'Catatan wajib diisi')
  .max(HANDOVER_LIMITS.note, `Maksimal ${HANDOVER_LIMITS.note} karakter`)
  .refine(
    (value) => extractChecklist(value).length <= HANDOVER_LIMITS.checklistItems,
    `Maksimal ${HANDOVER_LIMITS.checklistItems} butir checklist per catatan`,
  );

export const handoverFormSchema = z.object({
  locationId: z.string().min(1, 'Pilih lokasi'),
  customerName: customerNameSchema,
  note: noteSchema,
});

export type HandoverFormInput = z.input<typeof handoverFormSchema>;
export type HandoverFormOutput = z.output<typeof handoverFormSchema>;

/** Satu kartu pada form bulk (aturan catatan sama dengan form satu task). */
export const batchTaskSchema = z.object({
  customerName: customerNameSchema,
  note: noteSchema,
});

export const handoverBatchSchema = z.object({
  locationId: z.string().min(1, 'Pilih lokasi'),
  tasks: z
    .array(batchTaskSchema)
    .min(1, 'Minimal satu task')
    .max(HANDOVER_LIMITS.batch, `Maksimal ${HANDOVER_LIMITS.batch} task`),
});

export type HandoverBatchFormOutput = z.output<typeof handoverBatchSchema>;

export function toHandoverFormDefaults(handover?: HandoverDto, locationId = ''): HandoverFormInput {
  if (!handover) return { locationId, customerName: '', note: '' };
  return {
    locationId: handover.locationId,
    customerName: handover.customerName,
    note: handover.note,
  };
}

export function toSaveHandoverInput(
  values: HandoverFormOutput,
  id?: string,
  expectedUpdatedAt?: string,
  base?: HandoverSaveBase,
): SaveHandoverInput {
  const input: SaveHandoverInput = {
    locationId: values.locationId,
    customerName: values.customerName,
    note: values.note,
  };
  return id
    ? {
        id,
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        ...(base ? { base } : {}),
        ...input,
      }
    : input;
}

export function toSaveHandoverBatchInput(values: HandoverBatchFormOutput): SaveHandoverBatchInput {
  return {
    locationId: values.locationId,
    tasks: values.tasks.map((task) => ({ customerName: task.customerName, note: task.note })),
  };
}
