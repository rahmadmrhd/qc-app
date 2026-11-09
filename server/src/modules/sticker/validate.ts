import { readObject } from '@server/core/validate';
import type { SaveStickerTypeInput, SetStickerTypeStatusInput } from '@shared/contract';
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

export function validateSetStickerTypeStatus(raw: unknown): SetStickerTypeStatusInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const status = reader.oneOf('status', STATUS_VALUES);
  reader.done();
  return { id, status };
}
