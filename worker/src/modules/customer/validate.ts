import { customerKey, HANDOVER_LIMITS } from '@shared/handover';
import type { RenameCustomerInput, SetCustomerStatusInput } from '@shared/rpc';
import { readObject } from '@worker/core/validate';

const CUSTOMER_STATUS_VALUES = ['active', 'inactive'] as const;

/** Nama customer dari field `key` pada objek mentah (dipakai form task dan ganti nama). */
export function validateCustomerName(raw: unknown, key: string): string {
  const reader = readObject(raw);
  const name = reader.str(key, { required: true, max: HANDOVER_LIMITS.customerName });
  if (name !== '' && customerKey(name) === '') {
    reader.fail(key, 'Nama customer harus memuat huruf atau angka');
  }
  reader.done();
  return name;
}

export function validateRenameCustomer(raw: unknown): RenameCustomerInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const name = reader.str('name', { required: true, max: HANDOVER_LIMITS.customerName });
  if (name !== '' && customerKey(name) === '') {
    reader.fail('name', 'Nama customer harus memuat huruf atau angka');
  }
  reader.done();
  return { id, name };
}

export function validateSetCustomerStatus(raw: unknown): SetCustomerStatusInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const status = reader.oneOf('status', CUSTOMER_STATUS_VALUES);
  reader.done();
  return { id, status };
}
