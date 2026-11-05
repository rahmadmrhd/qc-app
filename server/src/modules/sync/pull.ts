import { appError } from '@server/core/errors';
import { SYNC_LIMITS } from '@shared/sync';
import { asSyncObject } from './wire';

/**
 * Batas halaman pull dengan detail KHUSUS Worker (gerbang CPU 8 ms, keputusan pemilik 2026-10-25).
 * Aplikasi Apps Script lama tetap memakai SYNC_LIMITS.pullMaxWithDetail (200) dan tidak diubah.
 */
export const WORKER_PULL_MAX_WITH_DETAIL = 50;

export interface SyncPullInput {
  sinceRev: number;
  limit: number;
  include: string[];
}

/** `includable`: field berat yang boleh diminta lewat `include` (mis. ['detail', 'stickers', 'accessories']). */
export function validateSyncPull(raw: unknown, includable: readonly string[]): SyncPullInput {
  const source = raw === null || raw === undefined ? {} : asSyncObject(raw);
  if (!source)
    throw appError('VALIDATION', 'Input harus berupa objek', { _: 'Input harus berupa objek' });
  const fields: Record<string, string> = {};
  const sinceRaw = source.sinceRev === undefined ? 0 : source.sinceRev;
  if (typeof sinceRaw !== 'number' || !Number.isInteger(sinceRaw) || sinceRaw < 0) {
    fields.sinceRev = 'Harus bilangan bulat ≥ 0';
  }
  const limitRaw = source.limit === undefined ? SYNC_LIMITS.pullDefault : source.limit;
  if (
    typeof limitRaw !== 'number' ||
    !Number.isInteger(limitRaw) ||
    limitRaw < 1 ||
    limitRaw > SYNC_LIMITS.pullMax
  ) {
    fields.limit = `Harus bilangan bulat 1–${SYNC_LIMITS.pullMax}`;
  }
  const includeRaw = source.include === undefined ? [] : source.include;
  if (
    !Array.isArray(includeRaw) ||
    !includeRaw.every((entry) => typeof entry === 'string' && includable.includes(entry))
  ) {
    fields.include =
      includable.length === 0
        ? 'Tidak ada field yang dapat diminta'
        : `Subset dari: ${includable.join(', ')}`;
  }
  if (Object.keys(fields).length > 0) throw appError('VALIDATION', 'Input tidak valid', fields);
  const include = [...new Set(includeRaw as string[])];
  const limit = Math.min(
    limitRaw as number,
    include.includes('detail') ? WORKER_PULL_MAX_WITH_DETAIL : SYNC_LIMITS.pullMax,
  );
  return { sinceRev: sinceRaw as number, limit, include };
}

/** Halaman baris dengan `syncRev` > sinceRev, urut naik; kursor = rev terakhir halaman (atau sinceRev bila kosong). */
export function paginateByRev<T extends { syncRev: number }>(
  records: readonly T[],
  sinceRev: number,
  limit: number,
): { page: T[]; nextRev: number; hasMore: boolean } {
  const newer = records
    .filter((record) => record.syncRev > sinceRev)
    .sort((a, b) => a.syncRev - b.syncRev);
  const page = newer.slice(0, limit);
  return { page, nextRev: page.at(-1)?.syncRev ?? sinceRev, hasMore: newer.length > limit };
}
