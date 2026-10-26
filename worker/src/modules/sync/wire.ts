import { SYNC_LIMITS } from '@shared/sync';
import { appError } from '@worker/core/errors';

export type WireCheck<T> = { ok: true; value: T } | { ok: false; fields: Record<string, string> };

export function asSyncObject(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** id MySQL: teks ≤ 100 atau bilangan bulat ≥ 0 (dijadikan teks); kosong/null = tidak ada. */
export function readSyncId(
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
export function readSyncBool(
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

export function readSyncBaseRev(
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

/**
 * Maksimum item per panggilan `sync.items.push` di Worker (anggaran CPU edge; keputusan pemilik 2026-10-26),
 * dengan atau tanpa `detail`. Aplikasi Apps Script lama tetap 50/25 (`SYNC_LIMITS`). Push merk tidak berubah.
 */
export const WORKER_ITEM_PUSH_MAX = 5;

/** Validasi tingkat permintaan push; kesalahan per entri ditangani per entri (hasil `invalid`). */
export function validateSyncPush(
  raw: unknown,
  key: 'items' | 'brands',
  detailLimited: boolean,
): SyncPushEnvelope {
  const source = asSyncObject(raw);
  if (!source)
    throw appError('VALIDATION', 'Input harus berupa objek', { _: 'Input harus berupa objek' });
  const label = key === 'items' ? 'item' : 'merk';
  if (source.overwrite !== undefined && typeof source.overwrite !== 'boolean') {
    throw appError('VALIDATION', 'Input tidak valid', { overwrite: 'Harus true atau false' });
  }
  const entries = source[key];
  if (!Array.isArray(entries)) {
    throw appError('VALIDATION', 'Input tidak valid', { [key]: 'Harus berupa daftar' });
  }
  if (entries.length === 0) {
    throw appError('VALIDATION', 'Input tidak valid', { [key]: `Minimal 1 ${label}` });
  }
  const withDetail =
    detailLimited && entries.some((entry) => typeof asSyncObject(entry)?.detail === 'string');
  const max =
    key === 'items'
      ? WORKER_ITEM_PUSH_MAX
      : withDetail
        ? SYNC_LIMITS.pushMaxWithDetail
        : SYNC_LIMITS.pushMax;
  if (entries.length > max) {
    throw appError('VALIDATION', 'Input tidak valid', { [key]: `Maksimal ${max} ${label}` });
  }
  return { overwrite: source.overwrite === true, entries };
}

/** Menandai setiap field entri yang bukan bagian kontrak: salah ketik tidak boleh hilang diam-diam. */
export function rejectUnknownSyncFields(
  source: Record<string, unknown>,
  allowed: readonly string[],
  fields: Record<string, string>,
): void {
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) fields[key] = 'Field tidak dikenal';
  }
}
