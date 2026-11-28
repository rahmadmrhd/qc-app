import { appError } from '@server/core/errors';
import { readObject } from '@server/core/validate';
import type {
  ListWarehouseHandoverCandidatesInput,
  SetWarehouseOrderLinksInput,
  WarehouseHandoverContextInput,
} from '@shared/contract';
import { WAREHOUSE_LIMITS } from '@shared/serial-warehouse';

/**
 * Kursor kandidat task: `<peringkat status>~<created_at>~<id>` (buram bagi klien; peringkat 0 = Baru, 1 = Sedang
 * dikerjakan, 2 = Selesai). Kursor format lama `<created_at>~<id>` ditolak (`VALIDATION`).
 */
export function parseCandidateCursor(
  cursor: string,
): { rank: number; createdAt: string; id: string } | null {
  const match = /^([012])~([^~]+)~([^~]+)$/.exec(cursor);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { rank: Number(match[1]), createdAt: match[2], id: match[3] };
}

/** Pemilih task: filter opsional, `limit` 1..`candidatesMax`, `cursor` buram. */
export function validateWarehouseHandoverCandidates(
  raw: unknown,
): ListWarehouseHandoverCandidatesInput {
  const reader = readObject(raw ?? {});
  const customerId = reader.str('customerId', { max: 100 });
  const customerName = reader.str('customerName', { max: 255 });
  const query = reader.str('query', { max: 100 });
  const locationId = reader.str('locationId', { max: 100 });
  const orderId = reader.str('orderId', { max: 100 });
  const itemId = reader.str('itemId', { max: 100 });
  const cursor = reader.str('cursor', { max: 200 });
  if (cursor !== '' && parseCandidateCursor(cursor) === null) {
    reader.fail('cursor', 'Kursor tidak valid');
  }
  const includeFinished = reader.raw('includeFinished');
  if (
    includeFinished !== undefined &&
    includeFinished !== null &&
    typeof includeFinished !== 'boolean'
  ) {
    reader.fail('includeFinished', 'Harus berupa ya/tidak');
  }
  const limit = reader.raw('limit');
  if (
    limit !== undefined &&
    limit !== null &&
    (typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > WAREHOUSE_LIMITS.candidatesMax)
  ) {
    reader.fail('limit', `Batas halaman harus 1-${WAREHOUSE_LIMITS.candidatesMax}`);
  }
  reader.done();
  return {
    ...(customerId !== '' ? { customerId } : {}),
    ...(customerName !== '' ? { customerName } : {}),
    ...(query !== '' ? { query } : {}),
    ...(includeFinished === true ? { includeFinished: true } : {}),
    ...(locationId !== '' ? { locationId } : {}),
    ...(orderId !== '' ? { orderId } : {}),
    ...(itemId !== '' ? { itemId } : {}),
    ...(cursor !== '' ? { cursor } : {}),
    ...(typeof limit === 'number' ? { limit } : {}),
  };
}

export function validateWarehouseHandoverContext(raw: unknown): WarehouseHandoverContextInput {
  const reader = readObject(raw);
  const handoverId = reader.str('handoverId', { required: true, max: 100 });
  reader.done();
  return { handoverId };
}

/** Tautan SO-task: daftar utuh (boleh kosong), maks. `handoverLinksMax` id unik. `expectedUpdatedAt` wajib (If-Match). */
export function validateWarehouseSetLinks(raw: unknown): SetWarehouseOrderLinksInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const expectedUpdatedAt = reader.str('expectedUpdatedAt', { required: true, max: 30 });
  const ids = reader.raw('handoverIds');
  let handoverIds: string[] = [];
  if (
    !Array.isArray(ids) ||
    !ids.every((entry) => typeof entry === 'string' && entry.trim() !== '' && entry.length <= 100)
  ) {
    reader.fail('handoverIds', 'Harus berupa daftar id task');
  } else if (ids.length > WAREHOUSE_LIMITS.handoverLinksMax) {
    reader.fail('handoverIds', `Maksimal ${WAREHOUSE_LIMITS.handoverLinksMax} task`);
  } else {
    handoverIds = (ids as string[]).map((entry) => entry.trim());
    if (new Set(handoverIds).size !== handoverIds.length) {
      reader.fail('handoverIds', 'Tidak boleh ada task ganda');
    }
  }
  reader.done();
  if (expectedUpdatedAt === '') throw appError('VALIDATION', 'Versi catatan wajib diisi');
  return { id, expectedUpdatedAt, handoverIds };
}
