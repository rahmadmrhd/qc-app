import { appError_ } from '@gas/core/errors';
import { readObject_ } from '@gas/core/validate';
import type { GetHandoverInput, ListHandoversInput } from '@shared/rpc';

const MAX_LOCATION_IDS = 50;

/** `locationIds` (≥ 1, ≤ 50, teks tak kosong) — router sudah memeriksa izinnya; di sini bentuknya. */
export function validateLocationIds_(raw: unknown): string[] {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const value = source.locationIds;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_LOCATION_IDS ||
    !value.every((id) => typeof id === 'string' && id.trim() !== '')
  ) {
    throw appError_('VALIDATION', 'Lokasi wajib diisi', { locationIds: 'Lokasi wajib diisi' });
  }
  return [...new Set((value as string[]).map((id) => id.trim()))];
}

export function validateListHandovers_(raw: unknown): ListHandoversInput {
  return { locationIds: validateLocationIds_(raw) };
}

export function validateGetHandover_(raw: unknown): GetHandoverInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id, locationIds: validateLocationIds_(raw) };
}
