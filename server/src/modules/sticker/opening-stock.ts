import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { appError, isAppError } from '@server/core/errors';
import { liveWhere } from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import type { OpeningStockInput } from '@shared/contract';
import { hasLevel } from '@shared/permissions';
import { addStockStmt, insertEntryStmt } from './stock-repo';

/**
 * Stok awal stiker baru (keputusan pemilik 2026-11-25): entri masuk "Stok awal" yang ditulis di `batch()` yang sama
 * dengan pembuatan stiker. Dipakai bersama `stickers.save` dan `postels.save` (Postel dibuat dari form stiker) agar
 * pemeriksaan izin, idempotensi, dan bentuk entri tidak disalin.
 */

/** Alasan entri riwayat stok yang dibuat bersama stiker baru. */
export const OPENING_STOCK_REASON = 'Stok awal';
export const OPENING_STOCK_TAKEN_MESSAGE = 'Stok awal ini sudah tercatat';
export const NO_LOCATION_ACCESS_MESSAGE = 'Anda tidak memiliki akses ke lokasi ini';

/**
 * Rute penyimpan global (`sticker: edit`): izin stok per lokasi diperiksa di sini, bukan oleh router. Satu lokasi tanpa
 * hak = seluruh permintaan ditolak (tak ada yang tersimpan).
 */
export function assertOpeningStockAccess(
  actor: UserContext,
  openings: readonly OpeningStockInput[],
): void {
  for (const opening of openings) {
    if (!hasLevel(actor.locations[opening.locationId]?.stickerstock ?? 'none', 'edit')) {
      throw appError('FORBIDDEN', NO_LOCATION_ACCESS_MESSAGE, {
        openingStock: NO_LOCATION_ACCESS_MESSAGE,
      });
    }
  }
}

/** Ringkasan untuk audit: total jumlah stok awal (rincian per lokasi: `openingBreakdown`). */
export function openingTotal(openings: readonly OpeningStockInput[]): number {
  return openings.reduce((sum, opening) => sum + opening.quantity, 0);
}

interface LocationLabelRow {
  id: string;
  code: string;
  name: string;
}

/** Satu baris rincian: `<nama> (<kode>): <jumlah>`; lokasi yang tak ditemukan memakai id-nya. */
export function openingBreakdownText(
  openings: readonly OpeningStockInput[],
  labels: ReadonlyMap<string, string>,
): string {
  return openings
    .map((opening) => ({
      label: labels.get(opening.locationId) ?? opening.locationId,
      quantity: opening.quantity,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.quantity - b.quantity)
    .map((row) => `${row.label}: ${row.quantity}`)
    .join('; ');
}

/**
 * Rincian stok awal per lokasi untuk audit (satu kueri, tanpa N+1): hanya lokasi yang memang ditulis, urut menurut
 * nama lokasi agar stabil, memakai nama dan kode lokasi saat penulisan.
 */
export async function openingBreakdown(
  env: Env,
  openings: readonly OpeningStockInput[],
): Promise<string> {
  if (openings.length === 0) return '';
  const rows = await env.DB.prepare(
    `SELECT id, code, name FROM locations WHERE id IN (${openings.map(() => '?').join(',')}) AND ${liveWhere()}`,
  )
    .bind(...openings.map((opening) => opening.locationId))
    .all<LocationLabelRow>();
  const labels = new Map(
    rows.results.map((row) => [row.id.trim(), `${row.name} (${row.code})`] as const),
  );
  return openingBreakdownText(openings, labels);
}

interface ReplayRow {
  sticker_id: string;
  location_id: string;
  kind: string;
  delta: number | string;
  reason: string;
  actor: string;
  client_id: string;
}

/**
 * Kiriman ulang (idempoten): entri stok awal bercap `clientId` = id stiker yang sudah dibuat. Sah HANYA bila SEMUA baris
 * input punya entri tersimpan milik pelaku yang sama, bukan entri stok biasa (alasan "Stok awal", jenis masuk), dengan
 * lokasi dan jumlah sama, dan semuanya milik satu stiker; selain itu `CONFLICT` generik. Tak satu pun ada = `null`.
 */
export async function findOpeningStockReplay(
  env: Env,
  actor: UserContext,
  openings: readonly OpeningStockInput[],
): Promise<string | null> {
  if (openings.length === 0) return null;
  const rows = await env.DB.prepare(
    `SELECT sticker_id, location_id, kind, delta, reason, actor, client_id FROM sticker_stock_entries WHERE client_id IN (${openings.map(() => '?').join(',')})`,
  )
    .bind(...openings.map((opening) => opening.clientId))
    .all<ReplayRow>();
  const found = rows.results;
  if (found.length === 0) return null;
  const byClient = new Map(found.map((row) => [row.client_id.trim(), row] as const));
  const stickerIds = new Set<string>();
  for (const opening of openings) {
    const row = byClient.get(opening.clientId);
    const same =
      row !== undefined &&
      row.actor === actor.email &&
      row.reason === OPENING_STOCK_REASON &&
      row.kind === 'in' &&
      row.location_id.trim() === opening.locationId &&
      Number(row.delta) === opening.quantity;
    if (!same) throw appError('CONFLICT', OPENING_STOCK_TAKEN_MESSAGE);
    stickerIds.add(row.sticker_id.trim());
  }
  const [only] = [...stickerIds];
  if (stickerIds.size !== 1 || only === undefined) {
    throw appError('CONFLICT', OPENING_STOCK_TAKEN_MESSAGE);
  }
  return only;
}

/**
 * Galat tulis yang mungkin akibat balapan dua kiriman serentak ber-`clientId` sama: yang kalah gagal dengan `CONFLICT`
 * (indeks unik `client_id`, atau lebih dulu indeks nama stiker/nomor/item yang direbut kiriman pertama). Pemanggil lalu
 * menjalankan `findOpeningStockReplay` sekali lagi: pelaku sama = hasil replay, orang lain = `CONFLICT`, tak ada entri =
 * galat aslinya dilempar ulang.
 */
export function mayBeOpeningStockRace(
  error: unknown,
  openings: readonly OpeningStockInput[],
): boolean {
  return openings.length > 0 && isAppError(error) && error.code === 'CONFLICT';
}

/** Pernyataan `batch()`: per baris, tambah stok baris stiker x lokasi, lalu tulis entri riwayatnya. */
export function openingStockStmts(
  db: Preparer,
  stickerId: string,
  openings: readonly OpeningStockInput[],
  actorEmail: string,
  now: string,
): DbStatement[] {
  return openings.flatMap((opening) => [
    addStockStmt(db, stickerId, opening.locationId, opening.quantity, now),
    insertEntryStmt(db, {
      stickerId,
      locationId: opening.locationId,
      kind: 'in',
      delta: opening.quantity,
      count: null,
      reason: OPENING_STOCK_REASON,
      actor: actorEmail,
      ts: now,
      clientId: opening.clientId,
    }),
  ]);
}
