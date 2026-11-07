import { MARKDOWN_MAX_LENGTH } from '@shared/files';
import {
  DRIVE_REF_SCHEME,
  extractImageTargets,
  ITEM_LIMITS,
  isRefIdChar,
  normalizeKey,
  normalizeNewlines,
} from '@shared/items';
import type { SyncWireSticker } from '@shared/sync';
import { SYNC_LIMITS } from '@shared/sync';
import type { WireCheck } from './wire';
import {
  asSyncObject,
  readSyncBaseRev,
  readSyncBool,
  readSyncId,
  rejectUnknownSyncFields,
} from './wire';

/** Validasi bentuk entri item pada kabel sinkron (murni; tanpa database). */
export interface SyncItemInput {
  uid?: string;
  id?: string;
  merk?: string;
  tipe?: string;
  isCountryLock?: boolean;
  images?: string[];
  detail?: string;
  stickers?: SyncWireSticker[];
  accessories?: Array<{ name: string; qty: number }>;
  active?: boolean;
  baseRev?: number;
}

/** Nama field internal → nama field pada kabel, agar pesan galat sesuai kontrak. */
export const WIRE_FIELD_NAMES: Record<string, string> = {
  brand: 'merk',
  model: 'tipe',
  attachments: 'images',
};

function checkWireText(
  source: Record<string, unknown>,
  key: 'merk' | 'tipe',
  max: number,
  fields: Record<string, string>,
): string | undefined {
  if (source[key] === undefined) return undefined;
  const text = typeof source[key] === 'string' ? (source[key] as string).trim() : '';
  if (text === '') fields[key] = 'Wajib diisi';
  else if (text.length > max) fields[key] = `Maksimal ${max} karakter`;
  else if (normalizeKey(text) === '') fields[key] = 'Harus memuat huruf atau angka';
  else return text;
  return undefined;
}

/** "drive:<id>" utuh; hanya judul Markdown ("..." atau '...') boleh mengikuti id. */
function isWholeDriveTarget(target: string): boolean {
  if (!target.startsWith(DRIVE_REF_SCHEME)) return false;
  let end = DRIVE_REF_SCHEME.length;
  while (end < target.length && isRefIdChar(target.charAt(end))) end++;
  if (end === DRIVE_REF_SCHEME.length) return false;
  const rest = target.slice(end).trim();
  return rest === '' || rest.startsWith('"') || rest.startsWith("'");
}

/**
 * Markdown tanpa gambar `![alt](drive:<id>)` yang utuh. Sisa yang masih memuat "![" berarti ada gambar
 * dalam bentuk lain (gaya referensi, bersarang, tidak tertutup) yang tidak boleh lolos dari pemeriksaan tujuan.
 */
function withoutWireImages(detail: string): string {
  let out = '';
  let from = 0;
  while (from < detail.length) {
    const open = detail.indexOf('![', from);
    if (open < 0) break;
    out += detail.slice(from, open);
    let altEnd = open + 2;
    while (
      altEnd < detail.length &&
      detail.charAt(altEnd) !== ']' &&
      detail.charAt(altEnd) !== '[' &&
      detail.charAt(altEnd) !== '\n'
    ) {
      altEnd++;
    }
    if (detail.charAt(altEnd) === ']' && detail.charAt(altEnd + 1) === '(') {
      let end = altEnd + 2;
      while (end < detail.length && detail.charAt(end) !== ')' && detail.charAt(end) !== '\n')
        end++;
      if (detail.charAt(end) === ')' && isWholeDriveTarget(detail.slice(altEnd + 2, end).trim())) {
        from = end + 1;
        continue;
      }
    }
    out += '![';
    from = open + 2;
  }
  return out + detail.slice(from);
}

/** Id Drive dari target gambar `![alt](drive:<id>)` saja; "drive:" di teks atau tautan biasa tidak dihitung. */
export function driveImageIds(detail: string): string[] {
  const ids: string[] = [];
  for (const target of extractImageTargets(detail)) {
    let end = DRIVE_REF_SCHEME.length;
    while (end < target.length && isRefIdChar(target.charAt(end))) end++;
    const id = target.slice(DRIVE_REF_SCHEME.length, end);
    if (target.startsWith(DRIVE_REF_SCHEME) && id !== '' && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function checkWireDetail(value: unknown, fields: Record<string, string>): string | undefined {
  if (typeof value !== 'string') {
    fields.detail = 'Harus berupa teks';
    return undefined;
  }
  const detail = normalizeNewlines(value);
  if (detail.length > MARKDOWN_MAX_LENGTH) {
    fields.detail = `Maksimal ${MARKDOWN_MAX_LENGTH} karakter`;
    return undefined;
  }
  if (detail.includes('qcfile:')) {
    fields.detail = 'Rujukan qcfile: tidak diterima; pakai drive:<id>';
    return undefined;
  }
  for (const target of extractImageTargets(detail)) {
    if (!isWholeDriveTarget(target)) {
      fields.detail = 'Gambar di Markdown hanya boleh ![alt](drive:<id>)';
      return undefined;
    }
  }
  if (withoutWireImages(detail).includes('![')) {
    fields.detail = 'Gambar di Markdown hanya boleh ![alt](drive:<id>)';
    return undefined;
  }
  return detail;
}

function checkWireImages(value: unknown, fields: Record<string, string>): string[] | undefined {
  if (!Array.isArray(value) || value.length > ITEM_LIMITS.attachments) {
    fields.images = Array.isArray(value)
      ? `Maksimal ${ITEM_LIMITS.attachments} gambar`
      : 'Harus berupa daftar id Drive';
    return undefined;
  }
  const ids: string[] = [];
  for (const entry of value) {
    const id = typeof entry === 'string' ? entry.trim() : '';
    if (id === '' || id.length > 100) {
      fields.images = 'Harus berupa daftar id Drive';
      return undefined;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function checkWireStickers(
  value: unknown,
  fields: Record<string, string>,
): SyncWireSticker[] | undefined {
  if (!Array.isArray(value) || value.length > ITEM_LIMITS.stickers) {
    fields.stickers = Array.isArray(value)
      ? `Maksimal ${ITEM_LIMITS.stickers} stiker`
      : 'Harus berupa daftar stiker';
    return undefined;
  }
  const out: SyncWireSticker[] = [];
  for (let i = 0; i < value.length; i++) {
    const label = `Stiker ${i + 1}`;
    const entry = asSyncObject(value[i]);
    const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!entry || name === '' || name.length > ITEM_LIMITS.stickerName) {
      fields.stickers = `${label}: nama wajib 1–${ITEM_LIMITS.stickerName} karakter`;
      return undefined;
    }
    const note = entry.note === undefined || entry.note === null ? '' : entry.note;
    if (typeof note !== 'string' || note.trim().length > ITEM_LIMITS.stickerNote) {
      fields.stickers = `${label}: catatan maksimal ${ITEM_LIMITS.stickerNote} karakter`;
      return undefined;
    }
    const image =
      entry.image === undefined || entry.image === null || entry.image === '' ? null : entry.image;
    if (image !== null && (typeof image !== 'string' || image.trim().length > 100)) {
      fields.stickers = `${label}: gambar harus id Drive atau null`;
      return undefined;
    }
    out.push({ name, note: note.trim(), image: image === null ? null : (image as string).trim() });
  }
  return out;
}

function checkWireAccessories(
  value: unknown,
  fields: Record<string, string>,
): Array<{ name: string; qty: number }> | undefined {
  if (!Array.isArray(value) || value.length > ITEM_LIMITS.accessories) {
    fields.accessories = Array.isArray(value)
      ? `Maksimal ${ITEM_LIMITS.accessories} kelengkapan`
      : 'Harus berupa daftar kelengkapan';
    return undefined;
  }
  const out: Array<{ name: string; qty: number }> = [];
  for (let i = 0; i < value.length; i++) {
    const label = `Kelengkapan ${i + 1}`;
    const entry = asSyncObject(value[i]);
    const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!entry || name === '' || name.length > ITEM_LIMITS.accessoryName) {
      fields.accessories = `${label}: nama wajib 1–${ITEM_LIMITS.accessoryName} karakter`;
      return undefined;
    }
    const qty = entry.qty;
    if (
      typeof qty !== 'number' ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > ITEM_LIMITS.accessoryQty
    ) {
      fields.accessories = `${label}: jumlah harus bilangan bulat 1–${ITEM_LIMITS.accessoryQty}`;
      return undefined;
    }
    out.push({ name, qty });
  }
  return out;
}

const SYNC_ITEM_ENTRY_FIELDS = [
  'uid',
  'id',
  'merk',
  'tipe',
  'isCountryLock',
  'images',
  'detail',
  'stickers',
  'accessories',
  'active',
  'baseRev',
] as const;

export function checkSyncItem(raw: unknown): WireCheck<SyncItemInput> {
  const source = asSyncObject(raw);
  if (!source) return { ok: false, fields: { _: 'Entri harus berupa objek' } };
  const fields: Record<string, string> = {};
  const value: SyncItemInput = {};
  rejectUnknownSyncFields(source, SYNC_ITEM_ENTRY_FIELDS, fields);
  const uid = readSyncId(source, 'uid', fields);
  if (uid !== undefined) value.uid = uid;
  const id = readSyncId(source, 'id', fields);
  if (id !== undefined) value.id = id;
  const merk = checkWireText(source, 'merk', ITEM_LIMITS.brand, fields);
  if (merk !== undefined) value.merk = merk;
  const tipe = checkWireText(source, 'tipe', ITEM_LIMITS.model, fields);
  if (tipe !== undefined) value.tipe = tipe;
  const lock = readSyncBool(source, 'isCountryLock', fields);
  if (lock !== undefined) value.isCountryLock = lock;
  if (source.images !== undefined) {
    const images = checkWireImages(source.images, fields);
    if (images !== undefined) value.images = images;
  }
  if (source.detail !== undefined) {
    const detail = checkWireDetail(source.detail, fields);
    if (detail !== undefined) value.detail = detail;
  }
  if (source.stickers !== undefined) {
    const stickers = checkWireStickers(source.stickers, fields);
    if (stickers !== undefined) value.stickers = stickers;
  }
  if (source.accessories !== undefined) {
    const accessories = checkWireAccessories(source.accessories, fields);
    if (accessories !== undefined) value.accessories = accessories;
  }
  const active = readSyncBool(source, 'active', fields);
  if (active !== undefined) value.active = active;
  const baseRev = readSyncBaseRev(source, fields);
  if (baseRev !== undefined) value.baseRev = baseRev;
  // Sel Sheets maks. 50.000 karakter: tolak JSON besar sebelum menulis (sama dengan validator form web).
  for (const key of ['stickers', 'accessories', 'images'] as const) {
    const list = value[key];
    if (list !== undefined && JSON.stringify(list).length > ITEM_LIMITS.jsonCell) {
      fields[key] = 'Data terlalu besar';
    }
  }
  if (
    Object.keys(fields).length === 0 &&
    driveIdsOf(value).length > SYNC_LIMITS.driveRefsPerEntry
  ) {
    fields.detail = `Maksimal ${SYNC_LIMITS.driveRefsPerEntry} gambar berbeda per item`;
  }
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

/** Semua id Drive yang dirujuk entri: galeri, contoh stiker, dan gambar di Markdown. */
export function driveIdsOf(entry: SyncItemInput): string[] {
  const ids = [...(entry.images ?? [])];
  for (const sticker of entry.stickers ?? []) {
    if (sticker.image !== null) ids.push(sticker.image);
  }
  ids.push(...driveImageIds(entry.detail ?? ''));
  return [...new Set(ids)];
}
