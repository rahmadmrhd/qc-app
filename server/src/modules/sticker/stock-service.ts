import { runCas } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import type {
  AdjustStockInput,
  OpnameInput,
  RecordStockInput,
  StickerStockDto,
  StockEntryDto,
  StockHistoryInput,
  StockHistoryPageDto,
} from '@shared/contract';
import type { StockCount, StockEntryKind } from '@shared/stickers';
import { isLowStock, piecesOfCount } from '@shared/stickers';
import { stockTotalsFromResult, stockTotalsStatement, toStickerStatus } from './repo';
import type { StockEntryRow } from './stock-repo';
import {
  addStockStmt,
  encodeStockCursor,
  historyStatement,
  inactivateDeprecatedIfEmptyStmt,
  insertEntryStmt,
  insertStockRowStmt,
  lastEntryStatement,
  lockStickerRowStmt,
  opnameSetStmt,
  parseStockCursor,
  stickerActiveGuardStmt,
  stickerStatusStatement,
  stickersExistStatement,
  stickersWithTypeStatement,
  stockPairsStatement,
  stockQtyStatement,
  stockRowsStatement,
  subtractStockStmt,
  toStockEntry,
} from './stock-repo';

const STALE_MESSAGE = 'Stok diubah orang lain; muat ulang halaman lalu ulangi';
const NOT_ENOUGH_MESSAGE = 'Stok tidak cukup';

interface StockChange {
  stickerId: string;
  locationId: string;
  kind: StockEntryKind;
  /** Bertanda: > 0 menambah, < 0 mengurangi. */
  delta: number;
  count: StockCount | null;
  reason: string;
  /** Catatan masuk hanya untuk stiker aktif (keluar dan koreksi boleh pada stiker nonaktif). */
  requireActive: boolean;
  /** Field untuk pesan galat stok tidak cukup. */
  amountField: 'quantity' | 'delta';
}

/**
 * Satu perubahan stok: SATU `batch()` (transaksi) berisi penjaga, pembaruan stok, riwayat (dengan `qty_after` dari
 * stok sesudah pembaruan), dan pembacaan baris riwayat yang baru. Pengurangan memakai penjaga CAS di `UPDATE` (stok
 * tak cukup membatalkan seluruh batch); penjaga yang gagal membuat `runCas` memuat ulang dan menjawab dengan
 * keadaan terbaru (`VALIDATION`).
 */
async function applyChangeOnce(
  env: Env,
  change: StockChange,
  actor: ActorRef,
): Promise<StockEntryDto> {
  const [statusResult, qtyResult] = await env.DB.batch([
    stickerStatusStatement(env.DB, change.stickerId),
    stockQtyStatement(env.DB, change.stickerId, change.locationId),
  ]);
  const sticker = (statusResult?.results[0] ?? null) as {
    status: string;
    type_status: string;
  } | null;
  if (!sticker) throw appError('NOT_FOUND', 'Stiker tidak ditemukan');
  if (change.requireActive && sticker.status.trim() === 'deprecated') {
    const message = 'Stiker sudah digantikan versi baru; stok masuk tidak dapat dicatat';
    throw appError('VALIDATION', message, { stickerId: message });
  }
  if (change.requireActive && sticker.status.trim() !== 'active') {
    const message = 'Stiker nonaktif tidak dapat menerima stok masuk';
    throw appError('VALIDATION', message, { stickerId: message });
  }
  if (change.requireActive && sticker.type_status.trim() !== 'active') {
    const message = 'Jenis stiker nonaktif; stok masuk tidak dapat dicatat';
    throw appError('VALIDATION', message, { stickerId: message });
  }
  const current = Number((qtyResult?.results[0] as { qty: number | string } | undefined)?.qty ?? 0);
  const amount = Math.abs(change.delta);
  if (change.delta < 0 && current < amount) {
    throw appError('VALIDATION', NOT_ENOUGH_MESSAGE, { [change.amountField]: NOT_ENOUGH_MESSAGE });
  }
  const now = nowIso(env);
  const statements: DbStatement[] = [];
  // Pengurangan: kunci baris stiker lebih dulu agar penonaktifan otomatis stiker `deprecated` tidak terlewat
  // saat dua pengurangan di lokasi berbeda berjalan serentak.
  if (change.delta < 0) statements.push(lockStickerRowStmt(env.DB, change.stickerId));
  if (change.requireActive) statements.push(stickerActiveGuardStmt(env.DB, change.stickerId));
  statements.push(
    change.delta > 0
      ? addStockStmt(env.DB, change.stickerId, change.locationId, amount, now)
      : subtractStockStmt(env.DB, change.stickerId, change.locationId, amount, now),
    insertEntryStmt(env.DB, {
      stickerId: change.stickerId,
      locationId: change.locationId,
      kind: change.kind,
      delta: change.delta,
      count: change.count,
      reason: change.reason,
      actor: actor.email,
      ts: now,
    }),
  );
  if (change.delta < 0) {
    statements.push(inactivateDeprecatedIfEmptyStmt(env.DB, change.stickerId, now, actor.email));
  }
  statements.push(lastEntryStatement(env.DB));
  const results = await env.DB.batch(statements);
  const row = results[results.length - 1]?.results[0] as StockEntryRow | undefined;
  if (!row) throw appError('INTERNAL', 'Riwayat stok gagal dicatat');
  return toStockEntry(row);
}

function applyChange(env: Env, change: StockChange, actor: ActorRef): Promise<StockEntryDto> {
  return runCas(() => applyChangeOnce(env, change, actor), STALE_MESSAGE);
}

/** Catat stok masuk atau keluar (jumlah langsung atau hitungan lembar). Izin lokasi diperiksa router. */
export async function recordStock(
  env: Env,
  input: RecordStockInput,
  actor: ActorRef,
): Promise<StockEntryDto> {
  const count = input.count ?? null;
  const pieces = count === null ? (input.quantity ?? 0) : piecesOfCount(count);
  return applyChange(
    env,
    {
      stickerId: input.stickerId,
      locationId: input.locationId,
      kind: input.kind,
      delta: input.kind === 'in' ? pieces : -pieces,
      count,
      reason: input.reason,
      requireActive: input.kind === 'in',
      amountField: 'quantity',
    },
    actor,
  );
}

/** Koreksi stok (bertanda, alasan wajib); diizinkan pada stiker nonaktif. */
export async function adjustStock(
  env: Env,
  input: AdjustStockInput,
  actor: ActorRef,
): Promise<StockEntryDto> {
  return applyChange(
    env,
    {
      stickerId: input.stickerId,
      locationId: input.locationId,
      kind: 'adjust',
      delta: input.delta,
      count: null,
      reason: input.reason,
      requireActive: false,
      amountField: 'delta',
    },
    actor,
  );
}

/**
 * Daftar stok untuk lokasi yang diminta: stiker aktif (walau tanpa baris stok) atau yang stoknya > 0 di lokasi itu.
 * SATU `batch()`: stiker+jenis, stok pada lokasi diminta, dan total SEMUA lokasi per stiker (satu kueri agregat) untuk
 * `low`. `total` dan `byLocation` hanya memuat lokasi yang diminta.
 */
export async function listStickerStock(
  env: Env,
  locationIds: readonly string[],
): Promise<StickerStockDto[]> {
  const [stickerResult, stockResult, totalResult] = await env.DB.batch([
    stickersWithTypeStatement(env.DB),
    stockRowsStatement(env.DB, locationIds),
    stockTotalsStatement(env.DB),
  ]);
  const allTotals = stockTotalsFromResult(totalResult ?? { results: [] });
  const qtyByKey = new Map<string, number>();
  const totalHere = new Map<string, number>();
  for (const row of (stockResult?.results ?? []) as Array<{
    sticker_id: string;
    location_id: string;
    qty: number | string;
  }>) {
    const stickerId = row.sticker_id.trim();
    const qty = Number(row.qty) || 0;
    qtyByKey.set(`${stickerId}\u0000${row.location_id.trim()}`, qty);
    totalHere.set(stickerId, (totalHere.get(stickerId) ?? 0) + qty);
  }
  const rows: StickerStockDto[] = [];
  for (const row of (stickerResult?.results ?? []) as Array<{
    id: string;
    name: string;
    alias: string;
    min_qty: number | string;
    status: string;
    type_name: string;
    type_status: string;
  }>) {
    const id = row.id.trim();
    const status = toStickerStatus(row.status);
    const total = totalHere.get(id) ?? 0;
    if (status !== 'active' && total <= 0) continue;
    const minQty = Number(row.min_qty) || 0;
    rows.push({
      stickerId: id,
      name: row.alias.trim() !== '' ? row.alias.trim() : row.name.trim(),
      typeName: row.type_name.trim(),
      typeStatus: row.type_status.trim() === 'inactive' ? 'inactive' : 'active',
      status,
      minQty,
      low: isLowStock({ status, minQty, total: allTotals.get(id) ?? 0 }),
      total,
      byLocation: locationIds.map((locationId) => ({
        locationId,
        qty: qtyByKey.get(`${id}\u0000${locationId}`) ?? 0,
      })),
    });
  }
  return rows.sort((a, b) => a.typeName.localeCompare(b.typeName) || a.name.localeCompare(b.name));
}

/** Riwayat stok terbaru dahulu pada lokasi yang diminta (berkursor `(ts, id)`), opsional per stiker. */
export async function stockHistory(
  env: Env,
  input: StockHistoryInput,
  locationIds: readonly string[],
): Promise<StockHistoryPageDto> {
  const limit = input.limit ?? 50;
  const cursor =
    input.cursor === undefined ? undefined : (parseStockCursor(input.cursor) ?? undefined);
  const result = await historyStatement(env.DB, {
    locationIds,
    ...(input.stickerId === undefined ? {} : { stickerId: input.stickerId }),
    ...(cursor === undefined ? {} : { cursor }),
    limit,
  }).all<StockEntryRow>();
  const page = result.results.slice(0, limit);
  const last = page[page.length - 1];
  return {
    entries: page.map(toStockEntry),
    nextCursor: result.results.length > limit && last ? encodeStockCursor(last) : null,
  };
}

const OPNAME_STALE_MESSAGE = 'Stok berubah sejak dihitung; hitung ulang';

/** Satu pasangan stiker x lokasi; dipakai sebagai kunci peta. */
const pairOf = (stickerId: string, locationId: string): string =>
  JSON.stringify([stickerId, locationId]);

async function opnameOnce(env: Env, input: OpnameInput, actor: ActorRef): Promise<StockEntryDto[]> {
  const { rows } = input;
  const [stickerResult, stockResult] = await env.DB.batch([
    stickersExistStatement(env.DB, [...new Set(rows.map((row) => row.stickerId))]),
    stockPairsStatement(env.DB, rows),
  ]);
  const known = new Set(
    ((stickerResult?.results ?? []) as Array<{ id: string }>).map((row) => row.id.trim()),
  );
  const stored = new Map<string, number>();
  for (const row of (stockResult?.results ?? []) as Array<{
    sticker_id: string;
    location_id: string;
    qty: number | string;
  }>) {
    stored.set(pairOf(row.sticker_id.trim(), row.location_id.trim()), Number(row.qty) || 0);
  }
  for (const row of rows) {
    if (!known.has(row.stickerId)) throw appError('NOT_FOUND', 'Stiker tidak ditemukan');
  }
  const plan = rows.map((row) => {
    const current = stored.get(pairOf(row.stickerId, row.locationId)) ?? null;
    return { row, current, pieces: piecesOfCount(row.count) };
  });
  // Satu baris usang (termasuk yang tanpa selisih) menolak seluruh permintaan sebelum menulis apa pun.
  for (const item of plan) {
    if ((item.current ?? 0) !== item.row.expectedQty) throw staleError(OPNAME_STALE_MESSAGE);
  }
  const changed = plan.filter((item) => item.pieces !== item.row.expectedQty);
  if (changed.length === 0) return [];
  // Urutan tulis tetap (stiker, lokasi) agar opname serentak mengunci baris dalam urutan yang sama.
  const ordered = [...changed].sort((a, b) =>
    pairOf(a.row.stickerId, a.row.locationId).localeCompare(
      pairOf(b.row.stickerId, b.row.locationId),
    ),
  );
  const now = nowIso(env);
  const statements: DbStatement[] = [];
  const readSlot = new Map<(typeof changed)[number], number>();
  // Kunci baris stiker lebih dulu (urut id), lalu baris stok: lihat `lockStickerRowStmt`.
  const stickerIds = [...new Set(ordered.map((item) => item.row.stickerId))].sort();
  for (const stickerId of stickerIds) statements.push(lockStickerRowStmt(env.DB, stickerId));
  for (const item of ordered) {
    const { row } = item;
    statements.push(
      item.current === null
        ? insertStockRowStmt(env.DB, row.stickerId, row.locationId, item.pieces, now)
        : opnameSetStmt(env.DB, row.stickerId, row.locationId, row.expectedQty, item.pieces, now),
      insertEntryStmt(env.DB, {
        stickerId: row.stickerId,
        locationId: row.locationId,
        kind: 'opname',
        delta: item.pieces - row.expectedQty,
        count: row.count,
        reason: '',
        actor: actor.email,
        ts: now,
      }),
      lastEntryStatement(env.DB),
    );
    readSlot.set(item, statements.length - 1);
  }
  // Penonaktifan otomatis stiker `deprecated` yang total stoknya menjadi 0 (sesudah semua pembaruan stok).
  for (const stickerId of stickerIds) {
    statements.push(inactivateDeprecatedIfEmptyStmt(env.DB, stickerId, now, actor.email));
  }
  const results = await env.DB.batch(statements);
  return changed.map((item) => {
    const entry = results[readSlot.get(item) ?? -1]?.results[0] as StockEntryRow | undefined;
    if (!entry) throw appError('INTERNAL', 'Riwayat stok gagal dicatat');
    return toStockEntry(entry);
  });
}

/**
 * Stok opname atomik: satu `batch()` untuk semua baris (penjaga CAS `qty = expectedQty` per baris, riwayat
 * `opname` dengan `count` dan selisih). Baris tanpa selisih tidak menulis riwayat. Satu baris usang membatalkan
 * seluruhnya (`staleError`). Stiker nonaktif boleh. Izin lokasi semua baris diperiksa router (`locationIds`).
 */
export async function opnameStock(
  env: Env,
  input: OpnameInput,
  actor: ActorRef,
): Promise<StockEntryDto[]> {
  return runCas(() => opnameOnce(env, input, actor), OPNAME_STALE_MESSAGE);
}
