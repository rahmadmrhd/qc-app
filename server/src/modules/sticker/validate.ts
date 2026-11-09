import type { ObjectReader } from '@server/core/validate';
import { readObject } from '@server/core/validate';
import { validateLocationIds } from '@server/modules/handover/validate';
import type {
  AdjustStockInput,
  ListStickerStockInput,
  RecordStockInput,
  SaveStickerInput,
  SaveStickerTypeInput,
  SetStickerStatusInput,
  SetStickerTypeStatusInput,
  StockHistoryInput,
} from '@shared/contract';
import type { StockCount } from '@shared/stickers';
import { piecesOfCount, STICKER_LIMITS, STICKER_RULES } from '@shared/stickers';
import { parseStockCursor } from './stock-repo';

const STATUS_VALUES = ['active', 'inactive'] as const;

export function validateSaveStickerType(raw: unknown): SaveStickerTypeInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id');
  const name = reader.str('name', { required: true, max: STICKER_LIMITS.nameMax });
  const rule = reader.oneOf('rule', STICKER_RULES);
  reader.done();
  return id ? { id, name, rule } : { name, rule };
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
  const typeId = reader.str('typeId', { required: true, max: 100 });
  const name = reader.str('name', { required: true, max: STICKER_LIMITS.nameMax });
  const alias = reader.str('alias', { max: STICKER_LIMITS.aliasMax });
  const fileId = readFileId(reader.raw('fileId'), reader);
  const minQty = readMinQty(reader.raw('minQty'), reader);
  const businessUnitIds = readBuIds(reader.raw('businessUnitIds'), reader);
  reader.done();
  const base = { typeId, name, alias, fileId, minQty, businessUnitIds };
  return id ? { id, ...base } : base;
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

/** Hitungan lembar: bentuk, batas baris, dan total butir (> 0 dan <= qtyMax) diperiksa di sini. */
function readCount(value: unknown, reader: ObjectReader): StockCount | undefined {
  const fail = (message: string): undefined => {
    reader.fail('count', message);
    return undefined;
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('Hitungan tidak valid');
  }
  const source = value as { rows?: unknown; loose?: unknown };
  if (!Array.isArray(source.rows) || source.rows.length > STICKER_LIMITS.countRows) {
    return fail(`Maksimal ${STICKER_LIMITS.countRows} baris lembar`);
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
      return fail('Jumlah lembar dan isi per lembar harus bilangan bulat tidak negatif');
    }
    rows.push({ sheets: entry.sheets, perSheet: entry.perSheet });
  }
  if (!isCountPart(source.loose)) return fail('Butir lepas harus bilangan bulat tidak negatif');
  const count: StockCount = { rows, loose: source.loose };
  const pieces = piecesOfCount(count);
  if (pieces < 1 || pieces > STICKER_LIMITS.qtyMax) {
    return fail(`Jumlah butir harus 1 sampai ${STICKER_LIMITS.qtyMax}`);
  }
  return count;
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
