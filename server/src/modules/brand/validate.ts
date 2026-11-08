import { readObject } from '@server/core/validate';
import type { SaveBrandInput, SetBrandStatusInput } from '@shared/contract';
import { ITEM_LIMITS, normalizeKey } from '@shared/items';

const BRAND_STATUS_VALUES = ['active', 'inactive'] as const;

export function validateSaveBrand(raw: unknown): SaveBrandInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id');
  const name = reader.str('name', { required: true, max: ITEM_LIMITS.brand });
  if (name !== '' && normalizeKey(name) === '') {
    reader.fail('name', 'Nama merk harus memuat huruf atau angka');
  }
  reader.done();
  return id ? { id, name } : { name };
}

export function validateSetBrandStatus(raw: unknown): SetBrandStatusInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const status = reader.oneOf('status', BRAND_STATUS_VALUES);
  reader.done();
  return { id, status };
}
