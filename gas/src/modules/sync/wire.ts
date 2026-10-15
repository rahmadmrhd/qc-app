import { appError_ } from '@gas/core/errors';
import { SYNC_LIMITS } from '@shared/sync';

export type WireCheck<T> = { ok: true; value: T } | { ok: false; fields: Record<string, string> };

export function asSyncObject_(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** id MySQL: teks ≤ 100 atau bilangan bulat ≥ 0 (dijadikan teks); kosong/null = tidak ada. */
export function readSyncId_(
  source: Record<string, unknown>,
  key: string,
  fields: Record<string, string>,
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && value.trim() !== '' && value.trim().length <= 100)
    return value.trim();
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value);
  fields[key] = 'ID tidak valid';
  return undefined;
}

/** boolean; teks "true"/"false" diterima (Desktop dapat mengirim teks). */
export function readSyncBool_(
  source: Record<string, unknown>,
  key: string,
  fields: Record<string, string>,
): boolean | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  fields[key] = 'Harus true atau false';
  return undefined;
}

export function readSyncBaseRev_(
  source: Record<string, unknown>,
  fields: Record<string, string>,
): number | undefined {
  const value = source.baseRev;
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  fields.baseRev = 'Harus bilangan bulat ≥ 0';
  return undefined;
}

export interface SyncPushEnvelope {
  overwrite: boolean;
  entries: unknown[];
}

/** Validasi tingkat permintaan push; kesalahan per entri ditangani per entri (hasil `invalid`). */
export function validateSyncPush_(
  raw: unknown,
  key: 'items' | 'brands',
  detailLimited: boolean,
): SyncPushEnvelope {
  const source = asSyncObject_(raw);
  if (!source)
    throw appError_('VALIDATION', 'Input harus berupa objek', { _: 'Input harus berupa objek' });
  const label = key === 'items' ? 'item' : 'merk';
  if (source.overwrite !== undefined && typeof source.overwrite !== 'boolean') {
    throw appError_('VALIDATION', 'Input tidak valid', { overwrite: 'Harus true atau false' });
  }
  const entries = source[key];
  if (!Array.isArray(entries)) {
    throw appError_('VALIDATION', 'Input tidak valid', { [key]: 'Harus berupa daftar' });
  }
  if (entries.length === 0) {
    throw appError_('VALIDATION', 'Input tidak valid', { [key]: `Minimal 1 ${label}` });
  }
  const withDetail =
    detailLimited && entries.some((entry) => typeof asSyncObject_(entry)?.detail === 'string');
  const max = withDetail ? SYNC_LIMITS.pushMaxWithDetail : SYNC_LIMITS.pushMax;
  if (entries.length > max) {
    throw appError_('VALIDATION', 'Input tidak valid', { [key]: `Maksimal ${max} ${label}` });
  }
  return { overwrite: source.overwrite === true, entries };
}
