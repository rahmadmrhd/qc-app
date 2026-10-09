import type { NewBrandRecord } from '@gas/modules/brand/repo';
import type { NewItemRecord } from '@gas/modules/item/repo';
import { itemKey, normalizeKey } from '@shared/items';

const SEED_TIME = '2026-01-01T00:00:00.000Z';

const BRAND_NAMES = new Map<string, string>();

/** Nama merk yang dipakai fixture `item()` untuk id tertentu (agar tes bisa membuat record merknya). */
export function brandNameOf(id: string): string {
  return BRAND_NAMES.get(id) ?? id;
}

/** Id merk deterministik dari nama, agar fixture item dan fixture merk selalu cocok. */
export function brandIdOf(name: string): string {
  return `brand-${normalizeKey(name).split(' ').join('-')}`;
}

export function brand(name: string, overrides: Partial<NewBrandRecord> = {}): NewBrandRecord {
  return {
    id: brandIdOf(name),
    externalId: '',
    name,
    key: normalizeKey(name),
    status: 'active',
    syncRev: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...overrides,
  };
}

/** `brand` adalah NAMA merk (dipakai untuk kunci dan id merk); record item hanya menyimpan `brandId`. */
export function item(
  overrides: Partial<NewItemRecord> & Pick<NewItemRecord, 'id' | 'model'> & { brand: string },
): NewItemRecord {
  const { brand: brandName, ...rest } = overrides;
  BRAND_NAMES.set(brandIdOf(brandName), brandName);
  return {
    externalId: '',
    brandId: brandIdOf(brandName),
    key: itemKey(brandName, overrides.model),
    isCountryLock: false,
    aliases: [],
    stickers: [],
    accessories: [],
    attachments: [],
    detail: '',
    status: 'active',
    syncRev: 0,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
    updatedBy: 'seed',
    ...rest,
  };
}
