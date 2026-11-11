import { isValidEmail, normalizeEmail } from '@server/core/email';
import type { ObjectReader } from '@server/core/validate';
import { readObject } from '@server/core/validate';
import { validateLocationIds } from '@server/modules/handover/validate';
import type {
  AdjustStockInput,
  ListStickerStockInput,
  OpnameInput,
  OpnameRowInput,
  RecordStockInput,
  SaveStickerInput,
  SaveStickerSettingsInput,
  SaveStickerTypeInput,
  SetStickerStatusInput,
  SetStickerTypeStatusInput,
  StockHistoryInput,
} from '@shared/contract';
import type { StockCount } from '@shared/stickers';
import { piecesOfCount, STICKER_LIMITS, USER_STICKER_RULES } from '@shared/stickers';
import { parseStockCursor } from './stock-repo';

const STATUS_VALUES = ['active', 'inactive'] as const;

/** `expectedUpdatedAt` (dari header If-Match): wajib saat mengubah (ada `id`), diabaikan saat membuat. */
function readExpectedUpdatedAt(reader: ObjectReader, id: string | undefined): string {
  const value = reader.optionalId('expectedUpdatedAt');
  if (id !== undefined && value === undefined) {
    reader.fail('expectedUpdatedAt', 'Versi wajib diisi saat mengubah');
  }
  return value ?? '';
}

export function validateSaveStickerType(raw: unknown): SaveStickerTypeInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id');
  const expectedUpdatedAt = readExpectedUpdatedAt(reader, id);
  const name = reader.str('name', { required: true, max: STICKER_LIMITS.nameMax });
  const rule = reader.oneOf('rule', USER_STICKER_RULES);
  reader.done();
  return id ? { id, expectedUpdatedAt, name, rule } : { name, rule };
}

/** Batas wajar jumlah BU per stiker (menjaga ukuran kueri; sama dengan BU bawaan merk). */
const STICKER_BU_MAX = 50;

function readFileId(value: unknown, reader: ObjectReader): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > 100) {
    reader.fail('fileId', 'Gambar tidak valid');
    return null;
  }
  return value.trim();
}

function readMinQty(value: unknown, reader: ObjectReader): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > STICKER_LIMITS.qtyMax
  ) {
    reader.fail('minQty', `Batas minimum harus bilangan bulat 0 sampai ${STICKER_LIMITS.qtyMax}`);
    return 0;
  }
  return value;
}

/** Daftar id BU: dirapikan, kembar dibuang; boleh kosong (aturan jenis diperiksa servis). */
function readBuIds(value: unknown, reader: ObjectReader): string[] {
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
  if (result.length > STICKER_BU_MAX) {
    reader.fail('businessUnitIds', `Maksimal ${STICKER_BU_MAX} BU`);
  }
  return result;
}

export function validateSaveSticker(raw: unknown): SaveStickerInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id');
  const expectedUpdatedAt = readExpectedUpdatedAt(reader, id);
  const typeId = reader.str('typeId', { required: true, max: 100 });
  const name = reader.str('name', { required: true, max: STICKER_LIMITS.nameMax });
  const alias = reader.str('alias', { max: STICKER_LIMITS.aliasMax });
  const fileId = readFileId(reader.raw('fileId'), reader);
  const minQty = readMinQty(reader.raw('minQty'), reader);
  const businessUnitIds = readBuIds(reader.raw('businessUnitIds'), reader);
  reader.done();
  const base = { typeId, name, alias, fileId, minQty, businessUnitIds };
  return id ? { id, expectedUpdatedAt, ...base } : base;
}

export function validateSetStickerStatus(raw: unknown): SetStickerStatusInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const status = reader.oneOf('status', STATUS_VALUES);
  reader.done();
  return { id, status };
}

export function validateSetStickerTypeStatus(raw: unknown): SetStickerTypeStatusInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const status = reader.oneOf('status', STATUS_VALUES);
  reader.done();
  return { id, status };
}

// ---------------------------------------------------------------------------------------------------------------
// Stok
// ---------------------------------------------------------------------------------------------------------------

export function validateListStickerStock(raw: unknown): ListStickerStockInput {
  return { locationIds: validateLocationIds(raw) };
}

const STOCK_PAGE_DEFAULT_LIMIT = 50;
const STOCK_PAGE_MAX_LIMIT = 200;

export function validateStockHistory(raw: unknown): StockHistoryInput {
  const locationIds = validateLocationIds(raw);
  const reader = readObject(raw);
  const stickerId = reader.optionalId('stickerId');
  const cursor = reader.raw('cursor');
  if (
    cursor !== undefined &&
    cursor !== null &&
    (typeof cursor !== 'string' || parseStockCursor(cursor) === null)
  ) {
    reader.fail('cursor', 'Kursor tidak valid');
  }
  const limit = reader.raw('limit') ?? STOCK_PAGE_DEFAULT_LIMIT;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > STOCK_PAGE_MAX_LIMIT
  ) {
    reader.fail('limit', `Batas halaman harus 1-${STOCK_PAGE_MAX_LIMIT}`);
  }
  reader.done();
  return {
    locationIds,
    limit: limit as number,
    ...(stickerId === undefined ? {} : { stickerId }),
    ...(typeof cursor === 'string' ? { cursor } : {}),
  };
}

/** Bilangan bulat 0..qtyMax (bukan NaN/pecahan/teks). */
function isCountPart(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= STICKER_LIMITS.qtyMax
  );
}

/**
 * Hitungan lembar: bentuk, batas baris, dan total butir (`minPieces`..qtyMax) diperiksa di sini. Mengembalikan
 * hitungan atau pesan galat.
 */
function parseCount(value: unknown, minPieces: number): StockCount | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'Hitungan tidak valid';
  }
  const source = value as { rows?: unknown; loose?: unknown };
  if (!Array.isArray(source.rows) || source.rows.length > STICKER_LIMITS.countRows) {
    return `Maksimal ${STICKER_LIMITS.countRows} baris lembar`;
  }
  const rows: StockCount['rows'] = [];
  for (const row of source.rows as unknown[]) {
    const entry = row as { sheets?: unknown; perSheet?: unknown } | null;
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !isCountPart(entry.sheets) ||
      !isCountPart(entry.perSheet)
    ) {
      return 'Jumlah lembar dan isi per lembar harus bilangan bulat tidak negatif';
    }
    rows.push({ sheets: entry.sheets, perSheet: entry.perSheet });
  }
  if (!isCountPart(source.loose)) return 'Butir lepas harus bilangan bulat tidak negatif';
  const count: StockCount = { rows, loose: source.loose };
  const pieces = piecesOfCount(count);
  if (pieces < minPieces || pieces > STICKER_LIMITS.qtyMax) {
    return `Jumlah butir harus ${minPieces} sampai ${STICKER_LIMITS.qtyMax}`;
  }
  return count;
}

/** Hitungan catatan stok masuk/keluar: minimal 1 butir; galat dilaporkan di field `count`. */
function readCount(value: unknown, reader: ObjectReader): StockCount | undefined {
  const parsed = parseCount(value, 1);
  if (typeof parsed === 'string') {
    reader.fail('count', parsed);
    return undefined;
  }
  return parsed;
}

const RECORD_KINDS = ['in', 'out'] as const;

export function validateRecordStock(raw: unknown): RecordStockInput {
  const reader = readObject(raw);
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const stickerId = reader.str('stickerId', { required: true, max: 100 });
  const kind = reader.oneOf('kind', RECORD_KINDS);
  const reason = reader.str('reason', { max: STICKER_LIMITS.reasonMax });
  if (kind === 'out' && reason === '') {
    reader.fail('reason', 'Alasan wajib diisi');
  }
  const quantityRaw = reader.raw('quantity');
  const countRaw = reader.raw('count');
  const hasQuantity = quantityRaw !== undefined && quantityRaw !== null;
  const hasCount = countRaw !== undefined && countRaw !== null;
  let quantity: number | undefined;
  let count: StockCount | undefined;
  if (hasQuantity === hasCount) {
    reader.fail('quantity', 'Isi tepat satu: jumlah butir atau hitungan lembar');
  } else if (hasQuantity) {
    if (
      typeof quantityRaw !== 'number' ||
      !Number.isInteger(quantityRaw) ||
      quantityRaw < 1 ||
      quantityRaw > STICKER_LIMITS.qtyMax
    ) {
      reader.fail('quantity', `Jumlah harus bilangan bulat 1 sampai ${STICKER_LIMITS.qtyMax}`);
    } else {
      quantity = quantityRaw;
    }
  } else {
    count = readCount(countRaw, reader);
  }
  reader.done();
  return {
    locationId,
    stickerId,
    kind,
    reason,
    ...(quantity === undefined ? {} : { quantity }),
    ...(count === undefined ? {} : { count }),
  };
}

export function validateAdjustStock(raw: unknown): AdjustStockInput {
  const reader = readObject(raw);
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const stickerId = reader.str('stickerId', { required: true, max: 100 });
  const reason = reader.str('reason', { required: true, max: STICKER_LIMITS.reasonMax });
  const delta = reader.raw('delta');
  if (
    typeof delta !== 'number' ||
    !Number.isInteger(delta) ||
    delta === 0 ||
    Math.abs(delta) > STICKER_LIMITS.qtyMax
  ) {
    reader.fail(
      'delta',
      `Perubahan harus bilangan bulat bukan 0, maksimal ${STICKER_LIMITS.qtyMax}`,
    );
  }
  reader.done();
  return { locationId, stickerId, delta: delta as number, reason };
}

/** Kunci pasangan stiker x lokasi. */
const pairKey = (stickerId: string, locationId: string): string =>
  JSON.stringify([stickerId, locationId]);

/**
 * Stok opname: 1..`opnameRows` baris, pasangan stiker x lokasi unik; hitungan boleh 0 butir (stok dinolkan).
 * `locationIds` diturunkan dari SEMUA baris (isian klien diabaikan) agar router memeriksa setiap lokasi.
 */
export function validateOpname(raw: unknown): OpnameInput {
  const reader = readObject(raw);
  const value = reader.raw('rows');
  const rows: OpnameRowInput[] = [];
  if (!Array.isArray(value) || value.length < 1 || value.length > STICKER_LIMITS.opnameRows) {
    reader.fail('rows', `Isi 1 sampai ${STICKER_LIMITS.opnameRows} baris`);
  } else {
    const seen = new Set<string>();
    for (const [index, entry] of (value as unknown[]).entries()) {
      const label = `Baris ${index + 1}`;
      const source = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
        string,
        unknown
      >;
      const stickerId = typeof source.stickerId === 'string' ? source.stickerId.trim() : '';
      const locationId = typeof source.locationId === 'string' ? source.locationId.trim() : '';
      const expected = source.expectedQty;
      if (
        stickerId === '' ||
        stickerId.length > 100 ||
        locationId === '' ||
        locationId.length > 100
      ) {
        reader.fail('rows', `${label}: stiker dan lokasi wajib diisi`);
        break;
      }
      if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0) {
        reader.fail('rows', `${label}: stok yang dihitung harus bilangan bulat tidak negatif`);
        break;
      }
      const count = parseCount(source.count, 0);
      if (typeof count === 'string') {
        reader.fail('rows', `${label}: ${count}`);
        break;
      }
      const key = pairKey(stickerId, locationId);
      if (seen.has(key)) {
        reader.fail('rows', `${label}: pasangan stiker dan lokasi kembar`);
        break;
      }
      seen.add(key);
      rows.push({ stickerId, locationId, expectedQty: expected, count });
    }
  }
  reader.done();
  return { rows, locationIds: [...new Set(rows.map((row) => row.locationId))] };
}

/** Batas wajar jumlah baris minimum bawaan per simpan (jenis stiker jarang melebihi puluhan). */
const SETTINGS_DEFAULTS_MAX = 200;

function readAlertSettings(
  value: unknown,
  reader: ObjectReader,
): SaveStickerSettingsInput['alert'] {
  const fallback = { enabled: false, recipients: [] as string[], digestHour: 8 };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    reader.fail('alert', 'Pengaturan email harus berupa objek');
    return fallback;
  }
  const source = value as Record<string, unknown>;
  if (typeof source.enabled !== 'boolean') reader.fail('enabled', 'Sakelar harus true atau false');
  const hour = source.digestHour;
  if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    reader.fail('digestHour', 'Jam harus bilangan bulat 0 sampai 23');
  }
  const recipients: string[] = [];
  if (!Array.isArray(source.recipients)) {
    reader.fail('recipients', 'Penerima harus berupa daftar email');
  } else if (source.recipients.length > STICKER_LIMITS.alertRecipientsMax) {
    reader.fail('recipients', `Maksimal ${STICKER_LIMITS.alertRecipientsMax} penerima`);
  } else {
    const seen = new Set<string>();
    for (const item of source.recipients) {
      const email = typeof item === 'string' ? normalizeEmail(item) : '';
      if (!isValidEmail(email)) {
        reader.fail('recipients', 'Ada alamat email yang tidak valid');
        break;
      }
      if (seen.has(email)) {
        reader.fail('recipients', `Email ganda: ${email}`);
        break;
      }
      seen.add(email);
      recipients.push(email);
    }
  }
  return {
    enabled: source.enabled === true,
    recipients,
    digestHour: typeof hour === 'number' ? hour : 8,
  };
}

function readDefaults(value: unknown, reader: ObjectReader): SaveStickerSettingsInput['defaults'] {
  if (!Array.isArray(value) || value.length > SETTINGS_DEFAULTS_MAX) {
    reader.fail('defaults', 'Minimum bawaan harus berupa daftar (maks. 200 baris)');
    return [];
  }
  const rows: SaveStickerSettingsInput['defaults'] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const row = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const typeId = typeof row.typeId === 'string' ? row.typeId.trim() : '';
    const qty = row.defaultMinQty;
    if (typeId === '' || typeId.length > 100 || seen.has(typeId)) {
      reader.fail('defaults', 'Jenis stiker tidak valid atau ganda');
      return [];
    }
    if (
      typeof qty !== 'number' ||
      !Number.isInteger(qty) ||
      qty < 0 ||
      qty > STICKER_LIMITS.qtyMax
    ) {
      reader.fail(
        'defaults',
        `Minimum bawaan harus bilangan bulat 0 sampai ${STICKER_LIMITS.qtyMax}`,
      );
      return [];
    }
    seen.add(typeId);
    rows.push({ typeId, defaultMinQty: qty });
  }
  return rows;
}

/** `expectedUpdatedAt` boleh kosong/tak ada (penyimpanan pertama; tanpa If-Match). */
export function validateSaveStickerSettings(raw: unknown): SaveStickerSettingsInput {
  const reader = readObject(raw);
  const expectedUpdatedAt = reader.optionalId('expectedUpdatedAt') ?? '';
  const alert = readAlertSettings(reader.raw('alert'), reader);
  const defaults = readDefaults(reader.raw('defaults'), reader);
  reader.done();
  return { expectedUpdatedAt, alert, defaults };
}
