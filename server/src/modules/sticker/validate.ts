import type { ObjectReader } from '@server/core/validate';
import { readObject } from '@server/core/validate';
import type {
  SaveStickerInput,
  SaveStickerTypeInput,
  SetStickerStatusInput,
  SetStickerTypeStatusInput,
} from '@shared/contract';
import { STICKER_LIMITS, STICKER_RULES } from '@shared/stickers';

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
