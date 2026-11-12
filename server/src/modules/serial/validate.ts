import { readObject } from '@server/core/validate';
import type { ListSerialItemOptionsInput, SerialStickerOptionsInput } from '@shared/contract';

export const SERIAL_ITEM_OPTIONS_DEFAULT_LIMIT = 20;
export const SERIAL_ITEM_OPTIONS_MAX_LIMIT = 50;

/** Opsi item untuk pencatat: input boleh kosong; `cursor` buram (kunci item terakhir). */
export function validateListSerialItemOptions(raw: unknown): ListSerialItemOptionsInput {
  const reader = readObject(raw ?? {});
  const cursor = reader.raw('cursor');
  if (cursor !== undefined && cursor !== null && (typeof cursor !== 'string' || cursor === '')) {
    reader.fail('cursor', 'Kursor tidak valid');
  }
  const limit = reader.raw('limit');
  if (
    limit !== undefined &&
    limit !== null &&
    (typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > SERIAL_ITEM_OPTIONS_MAX_LIMIT)
  ) {
    reader.fail('limit', `Batas halaman harus 1-${SERIAL_ITEM_OPTIONS_MAX_LIMIT}`);
  }
  const query = reader.str('query', { max: 100 });
  reader.done();
  return {
    ...(typeof limit === 'number' ? { limit } : {}),
    ...(typeof cursor === 'string' ? { cursor } : {}),
    ...(query !== '' ? { query } : {}),
  };
}

export function validateSerialStickerOptions(raw: unknown): SerialStickerOptionsInput {
  const reader = readObject(raw);
  const itemId = reader.str('itemId', { required: true, max: 100 });
  const buId = reader.str('buId', { required: true, max: 100 });
  reader.done();
  return { itemId, buId };
}
