import type { ObjectReader } from '@gas/core/validate';
import { readObject_ } from '@gas/core/validate';
import { MARKDOWN_MAX_LENGTH } from '@shared/files';
import { ITEM_LIMITS, normalizeKey, normalizeNewlines } from '@shared/items';
import type {
  GetItemInput,
  ItemAccessoryDto,
  ItemStickerDto,
  SaveItemInput,
  SetItemStatusInput,
} from '@shared/rpc';

const ITEM_STATUS_VALUES = ['active', 'inactive'] as const;

function isItemRecord_(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readItemAliases_(value: unknown, reader: ObjectReader): string[] {
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

function readItemStickers_(value: unknown, reader: ObjectReader): ItemStickerDto[] {
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
    if (!isItemRecord_(entry)) {
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

function readItemAccessories_(value: unknown, reader: ObjectReader): ItemAccessoryDto[] {
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
    if (!isItemRecord_(entry)) {
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

function readItemAttachments_(value: unknown, reader: ObjectReader): string[] {
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

function readItemDetail_(value: unknown, reader: ObjectReader): string {
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

function checkItemJsonSize_(
  field: string,
  value: unknown[],
  label: string,
  reader: ObjectReader,
): void {
  if (JSON.stringify(value).length > ITEM_LIMITS.jsonCell) {
    reader.fail(field, `Data ${label} terlalu besar`);
  }
}

export function validateSaveItem_(raw: unknown): SaveItemInput {
  const reader = readObject_(raw);
  const id = reader.optionalId('id');
  const brand = reader.str('brand', { required: true, max: ITEM_LIMITS.brand });
  const model = reader.str('model', { required: true, max: ITEM_LIMITS.model });
  const lock = reader.raw('isCountryLock');
  if (typeof lock !== 'boolean') reader.fail('isCountryLock', 'Harus true atau false');
  const aliases = readItemAliases_(reader.raw('aliases'), reader);
  const stickers = readItemStickers_(reader.raw('stickers'), reader);
  const accessories = readItemAccessories_(reader.raw('accessories'), reader);
  const attachments = readItemAttachments_(reader.raw('attachments'), reader);
  const detail = readItemDetail_(reader.raw('detail'), reader);
  checkItemJsonSize_('aliases', aliases, 'nama lain', reader);
  checkItemJsonSize_('stickers', stickers, 'stiker', reader);
  checkItemJsonSize_('accessories', accessories, 'kelengkapan', reader);
  checkItemJsonSize_('attachments', attachments, 'gambar', reader);
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
  return id ? { id, ...input } : input;
}

export function validateGetItem_(raw: unknown): GetItemInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

export function validateSetItemStatus_(raw: unknown): SetItemStatusInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const status = reader.oneOf('status', ITEM_STATUS_VALUES);
  reader.done();
  return { id, status };
}
