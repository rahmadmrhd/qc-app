import { HANDOVER_LIMITS } from '@shared/handover';
import { z } from 'zod';

/** Form ubah customer: satu field Nama (customer baru dibuat otomatis lewat Serah Terima). */
export const customerFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Wajib diisi')
    .max(HANDOVER_LIMITS.customerName, `Maksimal ${HANDOVER_LIMITS.customerName} karakter`),
});
export type CustomerFormInput = z.input<typeof customerFormSchema>;
export type CustomerFormOutput = z.output<typeof customerFormSchema>;

export function toCustomerFormDefaults(customer: { name: string } | undefined): CustomerFormInput {
  return { name: customer?.name ?? '' };
}
