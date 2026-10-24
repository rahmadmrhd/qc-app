import { MARKDOWN_MAX_LENGTH } from '@shared/files';
import { ITEM_LIMITS, normalizeKey, normalizeNewlines } from '@shared/items';
import type {
  GetItemInput,
  ItemAccessoryDto,
  ItemStatus,
  ItemStickerDto,
  ListItemsPageInput,
  SaveItemInput,
  SetItemStatusInput,
} from '@shared/rpc';
import type { ObjectReader } from '@worker/core/validate';
import { readObject } from '@worker/core/validate';

const ITEM_STATUS_VALUES = ['active', 'inactive'] as const;

function isItemRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readItemAliases(value: unknown, reader: ObjectReader): string[] {
  if (!Array.isArray(value)) {
    reader.fail('aliases', 'Harus berupa daftar teks');
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      reader.fail('aliases', 'Harus berupa daftar teks');
      return [];
    }
    const alias = entry.trim();
    if (alias === '') continue;
    if (alias.length > ITEM_LIMITS.alias) {
      reader.fail('aliases', `Maksimal ${ITEM_LIMITS.alias} karakter per nama lain`);
      continue;
    }
    const key = normalizeKey(alias);
    if (key === '') {
      reader.fail('aliases', 'Nama lain harus memuat huruf atau angka');
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
  }
  if (result.length > ITEM_LIMITS.aliases) {
    reader.fail('aliases', `Maksimal ${ITEM_LIMITS.aliases} nama lain`);
  }
  return result;
}

function readItemStickers(value: unknown, reader: ObjectReader): ItemStickerDto[] {
  if (!Array.isArray(value)) {
    reader.fail('stickers', 'Harus berupa daftar stiker');
    return [];
  }
  if (value.length > ITEM_LIMITS.stickers) {
    reader.fail('stickers', `Maksimal ${ITEM_LIMITS.stickers} stiker`);
    return [];
  }
  const result: ItemStickerDto[] = [];
  value.forEach((entry, index) => {
    const label = `Stiker ${index + 1}`;
    if (!isItemRecord(entry)) {
      reader.fail('stickers', `${label}: tidak valid`);
      return;
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (name === '') {
      reader.fail('stickers', `${label}: nama wajib diisi`);
      return;
    }
    if (name.length > ITEM_LIMITS.stickerName) {
      reader.fail('stickers', `${label}: nama maksimal ${ITEM_LIMITS.stickerName} karakter`);
      return;
    }
    if (entry.note !== undefined && typeof entry.note !== 'string') {
      reader.fail('stickers', `${label}: catatan harus berupa teks`);
      return;
    }
    const note = typeof entry.note === 'string' ? entry.note.trim() : '';
    if (note.length > ITEM_LIMITS.stickerNote) {
      reader.fail('stickers', `${label}: catatan maksimal ${ITEM_LIMITS.stickerNote} karakter`);
      return;
    }
    const rawFile = entry.fileId;
    if (rawFile !== undefined && rawFile !== null && typeof rawFile !== 'string') {
      reader.fail('stickers', `${label}: berkas tidak valid`);
      return;
    }
    const fileId = typeof rawFile === 'string' && rawFile.trim() !== '' ? rawFile.trim() : null;
    if (fileId !== null && fileId.length > 100) {
      reader.fail('stickers', `${label}: berkas tidak valid`);
      return;
    }
    result.push({ name, note, fileId });
  });
  return result;
}

function readItemAccessories(value: unknown, reader: ObjectReader): ItemAccessoryDto[] {
  if (!Array.isArray(value)) {
    reader.fail('accessories', 'Harus berupa daftar kelengkapan');
    return [];
  }
  if (value.length > ITEM_LIMITS.accessories) {
    reader.fail('accessories', `Maksimal ${ITEM_LIMITS.accessories} kelengkapan`);
    return [];
  }
  const result: ItemAccessoryDto[] = [];
  value.forEach((entry, index) => {
    const label = `Kelengkapan ${index + 1}`;
    if (!isItemRecord(entry)) {
      reader.fail('accessories', `${label}: tidak valid`);
      return;
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (name === '') {
      reader.fail('accessories', `${label}: nama wajib diisi`);
      return;
    }
    if (name.length > ITEM_LIMITS.accessoryName) {
      reader.fail('accessories', `${label}: nama maksimal ${ITEM_LIMITS.accessoryName} karakter`);
      return;
    }
    const qty = entry.qty;
    if (
      typeof qty !== 'number' ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > ITEM_LIMITS.accessoryQty
    ) {
      reader.fail(
        'accessories',
        `${label}: jumlah harus bilangan bulat 1–${ITEM_LIMITS.accessoryQty}`,
      );
      return;
    }
    result.push({ name, qty });
  });
  return result;
}

function readItemAttachments(value: unknown, reader: ObjectReader): string[] {
  if (!Array.isArray(value)) {
    reader.fail('attachments', 'Harus berupa daftar berkas');
    return [];
  }
  const result: string[] = [];
  for (const entry of value) {
    const id = typeof entry === 'string' ? entry.trim() : '';
    if (id === '' || id.length > 100) {
      reader.fail('attachments', 'Harus berupa daftar berkas');
      return [];
    }
    if (!result.includes(id)) result.push(id);
  }
  if (result.length > ITEM_LIMITS.attachments) {
    reader.fail('attachments', `Maksimal ${ITEM_LIMITS.attachments} gambar`);
  }
  return result;
}

function readItemDetail(value: unknown, reader: ObjectReader): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    reader.fail('detail', 'Harus berupa teks');
    return '';
  }
  const detail = normalizeNewlines(value);
  if (detail.length > MARKDOWN_MAX_LENGTH) {
    reader.fail('detail', `Maksimal ${MARKDOWN_MAX_LENGTH} karakter`);
  }
  return detail;
}

function checkItemJsonSize(
  field: string,
  value: unknown[],
  label: string,
  reader: ObjectReader,
): void {
  if (JSON.stringify(value).length > ITEM_LIMITS.jsonCell) {
    reader.fail(field, `Data ${label} terlalu besar`);
  }
}

/** Pembaca yang hanya menyimpan galat PERTAMA per field (`reader.fail` biasa menimpa galat sebelumnya). */
function firstErrorReader(reader: ObjectReader): ObjectReader {
  const reported = new Set<string>();
  return {
    ...reader,
    fail(key, message) {
      if (reported.has(key)) return;
      reported.add(key);
      reader.fail(key, message);
    },
  };
}

export function validateSaveItem(raw: unknown): SaveItemInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id');
  const expectedUpdatedAt = reader.optionalId('expectedUpdatedAt');
  const brand = reader.str('brand', { required: true, max: ITEM_LIMITS.brand });
  if (brand !== '' && normalizeKey(brand) === '') {
    reader.fail('brand', 'Merk harus memuat huruf atau angka');
  }
  const model = reader.str('model', { required: true, max: ITEM_LIMITS.model });
  if (model !== '' && normalizeKey(model) === '') {
    reader.fail('model', 'Tipe harus memuat huruf atau angka');
  }
  const lock = reader.raw('isCountryLock');
  if (typeof lock !== 'boolean') reader.fail('isCountryLock', 'Harus true atau false');
  const lists = firstErrorReader(reader);
  const aliases = readItemAliases(reader.raw('aliases'), lists);
  const stickers = readItemStickers(reader.raw('stickers'), lists);
  const accessories = readItemAccessories(reader.raw('accessories'), lists);
  const attachments = readItemAttachments(reader.raw('attachments'), lists);
  const detail = readItemDetail(reader.raw('detail'), lists);
  checkItemJsonSize('aliases', aliases, 'nama lain', reader);
  checkItemJsonSize('stickers', stickers, 'stiker', reader);
  checkItemJsonSize('accessories', accessories, 'kelengkapan', reader);
  checkItemJsonSize('attachments', attachments, 'gambar', reader);
  reader.done();
  const input = {
    brand,
    model,
    isCountryLock: lock === true,
    aliases,
    stickers,
    accessories,
    attachments,
    detail,
  };
  return id ? { id, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}), ...input } : input;
}

export function validateGetItem(raw: unknown): GetItemInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

export function validateSetItemStatus(raw: unknown): SetItemStatusInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const status = reader.oneOf('status', ITEM_STATUS_VALUES);
  reader.done();
  return { id, status };
}

export const ITEM_PAGE_DEFAULT_LIMIT = 20;
export const ITEM_PAGE_MAX_LIMIT = 50;

/** Daftar item berhalaman: input boleh kosong; `cursor` buram (kunci item terakhir), `query` memakai kunci ternormalisasi. */
export function validateListItems(raw: unknown): ListItemsPageInput {
  const reader = readObject(raw ?? {});
  const cursor = reader.raw('cursor');
  if (cursor !== undefined && cursor !== null && (typeof cursor !== 'string' || cursor === '')) {
    reader.fail('cursor', 'Kursor tidak valid');
  }
  const limit = reader.raw('limit') ?? ITEM_PAGE_DEFAULT_LIMIT;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > ITEM_PAGE_MAX_LIMIT
  ) {
    reader.fail('limit', `Batas halaman harus 1-${ITEM_PAGE_MAX_LIMIT}`);
  }
  const query = reader.str('query', { max: 100 });
  const statusRaw = reader.raw('status');
  let status: ItemStatus | undefined;
  if (statusRaw !== undefined && statusRaw !== null && statusRaw !== '') {
    status = reader.oneOf('status', ITEM_STATUS_VALUES);
  }
  reader.done();
  return {
    limit: limit as number,
    ...(typeof cursor === 'string' ? { cursor } : {}),
    ...(query !== '' ? { query } : {}),
    ...(status ? { status } : {}),
  };
}
