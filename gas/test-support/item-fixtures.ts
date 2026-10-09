import type { NewItemRecord } from '@gas/modules/item/repo';
import { itemKey } from '@shared/items';

const SEED_TIME = '2026-01-01T00:00:00.000Z';

export function item(
  overrides: Partial<NewItemRecord> & Pick<NewItemRecord, 'id' | 'brand' | 'model'>,
): NewItemRecord {
  return {
    externalId: '',
    key: itemKey(overrides.brand, overrides.model),
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
    ...overrides,
  };
}
