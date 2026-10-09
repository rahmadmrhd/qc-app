import type { RowData, TableSchema } from '@gas/core/db';
import { insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import type { ItemAccessoryDto, ItemStatus, ItemStickerDto } from '@shared/rpc';

export const ITEMS_TABLE: TableSchema = {
  sheetName: 'items',
  columns: [
    'id',
    'external_id',
    'brand_id',
    'model',
    'key',
    'is_country_lock',
    'aliases',
    'stickers',
    'accessories',
    'attachments',
    'detail_md',
    'status',
    'sync_rev',
    'created_at',
    'updated_at',
    'updated_by',
  ],
};

export interface ItemRecord {
  rowNumber: number;
  id: string;
  externalId: string;
  brandId: string;
  model: string;
  key: string;
  isCountryLock: boolean;
  aliases: string[];
  stickers: ItemStickerDto[];
  accessories: ItemAccessoryDto[];
  attachments: string[];
  detail: string;
  status: ItemStatus;
  syncRev: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}
export type NewItemRecord = Omit<ItemRecord, 'rowNumber'>;

function parseItemJson_(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readItemStrings_(text: string): string[] {
  const value = parseItemJson_(text);
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function parseItemStickers_(text: string): ItemStickerDto[] {
  const value = parseItemJson_(text);
  if (!Array.isArray(value)) return [];
  const result: ItemStickerDto[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { name, note, fileId } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') continue;
    result.push({
      name: name.trim(),
      note: typeof note === 'string' ? note.trim() : '',
      fileId: typeof fileId === 'string' && fileId.trim() !== '' ? fileId.trim() : null,
    });
  }
  return result;
}

function parseItemAccessories_(text: string): ItemAccessoryDto[] {
  const value = parseItemJson_(text);
  if (!Array.isArray(value)) return [];
  const result: ItemAccessoryDto[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { name, qty } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') continue;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1) continue;
    result.push({ name: name.trim(), qty });
  }
  return result;
}

function toItemRecord_(rowNumber: number, data: RowData): ItemRecord {
  return {
    rowNumber,
    id: (data.id ?? '').trim(),
    externalId: (data.external_id ?? '').trim(),
    brandId: (data.brand_id ?? '').trim(),
    model: (data.model ?? '').trim(),
    key: (data.key ?? '').trim(),
    isCountryLock: (data.is_country_lock ?? '').trim() === 'true',
    aliases: readItemStrings_(data.aliases ?? ''),
    stickers: parseItemStickers_(data.stickers ?? ''),
    accessories: parseItemAccessories_(data.accessories ?? ''),
    attachments: readItemStrings_(data.attachments ?? ''),
    detail: data.detail_md ?? '',
    status: (data.status ?? '').trim() === 'inactive' ? 'inactive' : 'active',
    syncRev: Number(data.sync_rev) || 0,
    createdAt: data.created_at ?? '',
    updatedAt: data.updated_at ?? '',
    updatedBy: data.updated_by ?? '',
  };
}

function fromItemRecord_(item: NewItemRecord): RowData {
  return {
    id: item.id,
    external_id: item.externalId,
    brand_id: item.brandId,
    model: item.model,
    key: item.key,
    is_country_lock: item.isCountryLock ? 'true' : 'false',
    aliases: JSON.stringify(item.aliases),
    stickers: JSON.stringify(item.stickers),
    accessories: JSON.stringify(item.accessories),
    attachments: JSON.stringify(item.attachments),
    detail_md: item.detail,
    status: item.status,
    sync_rev: String(item.syncRev),
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    updated_by: item.updatedBy,
  };
}

export function listItems_(): ItemRecord[] {
  return readTable_(ITEMS_TABLE)
    .rows.map(({ rowNumber, data }) => toItemRecord_(rowNumber, data))
    .filter((item) => item.id !== '' && item.key !== '');
}

export function insertItem_(item: NewItemRecord): void {
  insertRow_(ITEMS_TABLE, fromItemRecord_(item));
}

export function updateItem_(item: ItemRecord): void {
  updateRow_(ITEMS_TABLE, item.rowNumber, fromItemRecord_(item));
}
