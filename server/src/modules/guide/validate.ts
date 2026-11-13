import { readObject } from '@server/core/validate';
import type { MarkGuideInput, ResetGuideInput } from '@shared/contract';
import { GUIDE_IDS, GUIDE_VERSIONS, type GuideId } from '@shared/guides';

function isGuideId(value: string): value is GuideId {
  return (GUIDE_IDS as readonly string[]).includes(value);
}

export function validateMarkGuide(raw: unknown): MarkGuideInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const version = reader.raw('version');
  const known = id === '' || isGuideId(id);
  if (!known) reader.fail('id', 'Panduan tidak dikenal');
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    reader.fail('version', 'Versi harus bilangan bulat positif');
  } else if (isGuideId(id) && version > GUIDE_VERSIONS[id]) {
    reader.fail('version', 'Versi melebihi versi panduan');
  }
  reader.done();
  return { id, version: version as number };
}

export function validateResetGuide(raw: unknown): ResetGuideInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  if (id !== '' && !isGuideId(id)) reader.fail('id', 'Panduan tidak dikenal');
  reader.done();
  return { id };
}
