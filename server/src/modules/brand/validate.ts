import type { ObjectReader } from '@server/core/validate';
import { readObject } from '@server/core/validate';
import type {
  GetBrandInput,
  ListBrandsInput,
  SaveBrandInput,
  SetBrandStatusInput,
} from '@shared/contract';
import { ITEM_LIMITS, normalizeKey } from '@shared/items';

const BRAND_STATUS_VALUES = ['active', 'inactive'] as const;

export function validateSaveBrand(raw: unknown): SaveBrandInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id');
  const name = reader.str('name', { required: true, max: ITEM_LIMITS.brand });
  if (name !== '' && normalizeKey(name) === '') {
    reader.fail('name', 'Nama merk harus memuat huruf atau angka');
  }
  const businessUnitIds = readDefaultBuIds(reader.raw('businessUnitIds'), reader);
  reader.done();
  return id ? { id, name, businessUnitIds } : { name, businessUnitIds };
}

/** Batas wajar jumlah BU bawaan per merk (menjaga ukuran kueri). */
const BRAND_BU_MAX = 50;

/** BU bawaan: daftar id (boleh kosong); id dirapikan, kembar dibuang. */
function readDefaultBuIds(value: unknown, reader: ObjectReader): string[] {
  if (!Array.isArray(value)) {
    reader.fail('businessUnitIds', 'Harus berupa daftar BU');
    return [];
  }
  const result: string[] = [];
  for (const entry of value) {
    const id = typeof entry === 'string' ? entry.trim() : '';
    if (id === '' || id.length > 100) {
      reader.fail('businessUnitIds', 'BU tidak valid');
      return [];
    }
    if (!result.includes(id)) result.push(id);
  }
  if (result.length > BRAND_BU_MAX) reader.fail('businessUnitIds', `Maksimal ${BRAND_BU_MAX} BU`);
  return result;
}

export function validateSetBrandStatus(raw: unknown): SetBrandStatusInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const status = reader.oneOf('status', BRAND_STATUS_VALUES);
  reader.done();
  return { id, status };
}

/** `id` saja (get, remove, restore). */
export function validateGetBrand(raw: unknown): GetBrandInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

const BRAND_LIST_STATUS_VALUES = ['active', 'inactive', 'deleted', 'all'] as const;

/** Daftar merk: input boleh kosong; `status` opsional (`deleted` hanya bagi `item: manage`, dicek di service). */
export function validateListBrands(raw: unknown): ListBrandsInput | null {
  if (raw === null || raw === undefined) return null;
  const reader = readObject(raw);
  const value = reader.raw('status');
  if (value === undefined || value === null || value === '') {
    reader.done();
    return {};
  }
  const status = reader.oneOf('status', BRAND_LIST_STATUS_VALUES);
  reader.done();
  return { status };
}
