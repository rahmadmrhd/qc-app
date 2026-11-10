import type { ObjectReader } from '@server/core/validate';
import { readObject } from '@server/core/validate';
import type {
  GetItemInput,
  ItemAccessoryDto,
  ItemStatus,
  ItemStickerMarkDto,
  ItemStickerPhotoInput,
  ListItemsPageInput,
  SaveItemInput,
  SetItemStatusInput,
} from '@shared/contract';
import { MARKDOWN_MAX_LENGTH } from '@shared/files';
import { ITEM_LIMITS, normalizeKey, normalizeNewlines } from '@shared/items';
import { INSTRUCTION_LIMITS, type StickerMarkTarget } from '@shared/stickers';

const ITEM_STATUS_VALUES = ['active', 'inactive'] as const;
const INSTRUCTION_FILTER_VALUES = ['none'] as const;
const STICKER_MODE_VALUES = ['has', 'missing'] as const;
const MANUAL_BOOK_FILTER_VALUES = ['has', 'missing'] as const;

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

/** Id rujukan (gambar pustaka, stiker, jenis, BU): teks tak kosong setelah trim, maks. 100 karakter. */
const REF_ID_MAX = 100;

function readMarkTarget(value: unknown): StickerMarkTarget | 'both' | null {
  if (!isItemRecord(value)) return null;
  const { kind, stickerId, typeId } = value;
  const refId = (raw: unknown): string | null =>
    typeof raw === 'string' && raw.trim() !== '' && raw.trim().length <= REF_ID_MAX
      ? raw.trim()
      : null;
  if (kind === 'sticker' || kind === 'type') {
    const own = refId(kind === 'sticker' ? stickerId : typeId);
    if (own === null) return null;
    const other = kind === 'sticker' ? typeId : stickerId;
    if (other !== undefined && other !== null && other !== '') return 'both';
    return kind === 'sticker' ? { kind, stickerId: own } : { kind, typeId: own };
  }
  return null;
}

function readPhotoMarks(
  value: unknown,
  photoLabel: string,
  reader: ObjectReader,
): ItemStickerMarkDto[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    reader.fail('stickerPhotos', `${photoLabel}: penanda harus berupa daftar`);
    return null;
  }
  if (value.length > INSTRUCTION_LIMITS.marks) {
    reader.fail('stickerPhotos', `${photoLabel}: maksimal ${INSTRUCTION_LIMITS.marks} penanda`);
    return null;
  }
  const marks: ItemStickerMarkDto[] = [];
  for (const [index, entry] of value.entries()) {
    const label = `${photoLabel}, penanda ${index + 1}`;
    if (!isItemRecord(entry)) {
      reader.fail('stickerPhotos', `${label}: tidak valid`);
      return null;
    }
    const coord = (raw: unknown): raw is number =>
      typeof raw === 'number' &&
      Number.isInteger(raw) &&
      raw >= 0 &&
      raw <= INSTRUCTION_LIMITS.coordMax;
    if (!coord(entry.x) || !coord(entry.y)) {
      reader.fail(
        'stickerPhotos',
        `${label}: posisi harus bilangan bulat 0–${INSTRUCTION_LIMITS.coordMax}`,
      );
      return null;
    }
    const target = readMarkTarget(entry.target);
    if (target === 'both') {
      reader.fail('stickerPhotos', `${label}: pilih stiker atau jenis, bukan keduanya`);
      return null;
    }
    if (target === null) {
      reader.fail('stickerPhotos', `${label}: sasaran tidak valid`);
      return null;
    }
    if (entry.note !== undefined && typeof entry.note !== 'string') {
      reader.fail('stickerPhotos', `${label}: catatan harus berupa teks`);
      return null;
    }
    const note = typeof entry.note === 'string' ? entry.note.trim() : '';
    if (note.length > INSTRUCTION_LIMITS.markNote) {
      reader.fail(
        'stickerPhotos',
        `${label}: catatan maksimal ${INSTRUCTION_LIMITS.markNote} karakter`,
      );
      return null;
    }
    marks.push({ x: entry.x, y: entry.y, target, note });
  }
  return marks;
}

/**
 * Instruksi stiker item (tahap 3b-2): daftar foto pustaka dengan catatan, label BU (kosong -> `null`), dan penanda
 * berurutan. Hanya bentuk dan batas di sini; keberadaan foto/stiker/jenis dan keanggotaan BU diperiksa
 * `assertInstructionRefs` (service) terhadap basis data. Pesan menyebut nomor foto/penanda (mulai 1).
 */
function readStickerPhotos(value: unknown, reader: ObjectReader): ItemStickerPhotoInput[] {
  if (!Array.isArray(value)) {
    reader.fail('stickerPhotos', 'Harus berupa daftar foto');
    return [];
  }
  if (value.length > INSTRUCTION_LIMITS.photos) {
    reader.fail('stickerPhotos', `Maksimal ${INSTRUCTION_LIMITS.photos} foto`);
    return [];
  }
  const seen = new Set<string>();
  const result: ItemStickerPhotoInput[] = [];
  for (const [index, entry] of value.entries()) {
    const label = `Foto ${index + 1}`;
    if (!isItemRecord(entry)) {
      reader.fail('stickerPhotos', `${label}: tidak valid`);
      return [];
    }
    const guideId = typeof entry.guideId === 'string' ? entry.guideId.trim() : '';
    if (guideId === '') {
      reader.fail('stickerPhotos', `${label}: gambar wajib dipilih`);
      return [];
    }
    if (guideId.length > REF_ID_MAX) {
      reader.fail('stickerPhotos', `${label}: gambar tidak valid`);
      return [];
    }
    if (seen.has(guideId)) {
      reader.fail('stickerPhotos', `${label}: gambar sudah dipakai di foto lain`);
      return [];
    }
    seen.add(guideId);
    if (entry.caption !== undefined && typeof entry.caption !== 'string') {
      reader.fail('stickerPhotos', `${label}: catatan harus berupa teks`);
      return [];
    }
    const caption = typeof entry.caption === 'string' ? entry.caption.trim() : '';
    if (caption.length > INSTRUCTION_LIMITS.caption) {
      reader.fail(
        'stickerPhotos',
        `${label}: catatan maksimal ${INSTRUCTION_LIMITS.caption} karakter`,
      );
      return [];
    }
    const rawBu = entry.buId;
    if (rawBu !== undefined && rawBu !== null && typeof rawBu !== 'string') {
      reader.fail('stickerPhotos', `${label}: label BU tidak valid`);
      return [];
    }
    const buId = typeof rawBu === 'string' && rawBu.trim() !== '' ? rawBu.trim() : null;
    if (buId !== null && buId.length > REF_ID_MAX) {
      reader.fail('stickerPhotos', `${label}: label BU tidak valid`);
      return [];
    }
    const marks = readPhotoMarks(entry.marks, label, reader);
    if (marks === null) return [];
    result.push({ guideId, caption, buId, marks });
  }
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

/** Id BU: daftar teks tak kosong, tanpa kembar (dirapikan), minimal satu. */
function readBusinessUnitIds(value: unknown, reader: ObjectReader): string[] {
  if (!Array.isArray(value)) {
    reader.fail('businessUnitIds', 'Pilih minimal satu BU');
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
  if (result.length === 0) reader.fail('businessUnitIds', 'Pilih minimal satu BU');
  if (result.length > ITEM_BU_MAX) reader.fail('businessUnitIds', `Maksimal ${ITEM_BU_MAX} BU`);
  return result;
}

/** Batas wajar jumlah BU per item (jauh di atas data nyata; menjaga ukuran kueri). */
const ITEM_BU_MAX = 50;

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
  const brandId = reader.str('brandId', { required: true, max: 100 });
  const model = reader.str('model', { required: true, max: ITEM_LIMITS.model });
  if (model !== '' && normalizeKey(model) === '') {
    reader.fail('model', 'Tipe harus memuat huruf atau angka');
  }
  const lock = reader.raw('isCountryLock');
  if (typeof lock !== 'boolean') reader.fail('isCountryLock', 'Harus true atau false');
  const lists = firstErrorReader(reader);
  const aliases = readItemAliases(reader.raw('aliases'), lists);
  const stickerPhotos = readStickerPhotos(reader.raw('stickerPhotos'), lists);
  const accessories = readItemAccessories(reader.raw('accessories'), lists);
  const attachments = readItemAttachments(reader.raw('attachments'), lists);
  const detail = readItemDetail(reader.raw('detail'), lists);
  const businessUnitIds = readBusinessUnitIds(reader.raw('businessUnitIds'), lists);
  checkItemJsonSize('aliases', aliases, 'nama lain', reader);
  checkItemJsonSize('accessories', accessories, 'kelengkapan', reader);
  checkItemJsonSize('attachments', attachments, 'gambar', reader);
  reader.done();
  const input = {
    brandId,
    model,
    isCountryLock: lock === true,
    aliases,
    stickerPhotos,
    accessories,
    attachments,
    detail,
    businessUnitIds,
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
  const hasValue = (raw: unknown): boolean => raw !== undefined && raw !== null && raw !== '';
  let instruction: 'none' | undefined;
  if (hasValue(reader.raw('instruction'))) {
    instruction = reader.oneOf('instruction', INSTRUCTION_FILTER_VALUES);
  }
  const stickerId = reader.str('stickerId', { max: 100 });
  const typeId = reader.str('typeId', { max: 100 });
  if (stickerId !== '' && typeId !== '') {
    reader.fail('typeId', 'Pilih stiker atau jenis, bukan keduanya');
  }
  let stickerMode: 'has' | 'missing' | undefined;
  if (hasValue(reader.raw('stickerMode'))) {
    stickerMode = reader.oneOf('stickerMode', STICKER_MODE_VALUES);
    if (stickerId === '' && typeId === '') {
      reader.fail('stickerMode', 'Mode hanya berlaku bersama stiker atau jenis');
    }
  }
  let manualBook: 'has' | 'missing' | undefined;
  if (hasValue(reader.raw('manualBook'))) {
    manualBook = reader.oneOf('manualBook', MANUAL_BOOK_FILTER_VALUES);
  }
  reader.done();
  return {
    limit: limit as number,
    ...(typeof cursor === 'string' ? { cursor } : {}),
    ...(query !== '' ? { query } : {}),
    ...(status ? { status } : {}),
    ...(instruction ? { instruction } : {}),
    ...(stickerId !== '' ? { stickerId } : {}),
    ...(typeId !== '' ? { typeId } : {}),
    ...(stickerId !== '' || typeId !== '' ? { stickerMode: stickerMode ?? 'has' } : {}),
    ...(manualBook ? { manualBook } : {}),
  };
}
