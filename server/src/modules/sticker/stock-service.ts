import { runCas } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { DbStatement, Preparer } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import type {
  AdjustStockBatchInput,
  AdjustStockInput,
  OpnameInput,
  RecordStockBatchInput,
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
  entriesByClientIdsStatement,
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
  stickersStatusStatement,
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
  /** Kunci idempoten klien (entri batch); lihat `replayEntries`. */
  clientId?: string;
}

/** Alasan stiker tak dapat menerima stok masuk (`null` = boleh): digantikan, nonaktif, atau jenisnya nonaktif. */
function receivingProblem(sticker: { status: string; type_status: string }): string | null {
  if (sticker.status.trim() === 'deprecated') {
    return 'Stiker sudah digantikan versi baru; stok masuk tidak dapat dicatat';
  }
  if (sticker.status.trim() !== 'active') return 'Stiker nonaktif tidak dapat menerima stok masuk';
  if (sticker.type_status.trim() !== 'active') {
    return 'Jenis stiker nonaktif; stok masuk tidak dapat dicatat';
  }
  return null;
}

/** Pernyataan satu perubahan stok, dipisah per tahap agar batch banyak baris dapat menyusunnya dalam urutan kunci tetap. */
interface ChangeParts {
  /** Kunci baris stiker (`FOR UPDATE`), hanya untuk pengurangan. */
  lock: DbStatement | null;
  /** Penjaga stiker+jenis aktif (`LOCK IN SHARE MODE`), hanya untuk catatan masuk. */
  guard: DbStatement | null;
  /** Pembaruan stok (penjaga CAS pada pengurangan) lalu penulisan riwayat. */
  apply: DbStatement[];
  /** Penonaktifan otomatis stiker `deprecated` yang kosong, hanya setelah pengurangan. */
  inactivate: DbStatement | null;
  /** Pembacaan baris riwayat yang baru (segera setelah `apply`, sebelum penulisan riwayat berikutnya). */
  read: DbStatement;
}

/**
 * SATU definisi pernyataan perubahan stok (dipakai `applyChangeOnce` dan entri batch): pengurangan memakai penjaga CAS
 * di `UPDATE`, pengurangan mengunci baris stiker lebih dulu agar penonaktifan otomatis stiker `deprecated` tak
 * terlewat saat dua pengurangan di lokasi berbeda berjalan serentak, catatan masuk memakai penjaga stiker+jenis aktif.
 */
function changeStatements(
  db: Preparer,
  change: StockChange,
  now: string,
  actor: string,
): ChangeParts {
  const amount = Math.abs(change.delta);
  return {
    lock: change.delta < 0 ? lockStickerRowStmt(db, change.stickerId) : null,
    guard: change.requireActive ? stickerActiveGuardStmt(db, change.stickerId) : null,
    apply: [
      change.delta > 0
        ? addStockStmt(db, change.stickerId, change.locationId, amount, now)
        : subtractStockStmt(db, change.stickerId, change.locationId, amount, now),
      insertEntryStmt(db, {
        stickerId: change.stickerId,
        locationId: change.locationId,
        kind: change.kind,
        delta: change.delta,
        count: change.count,
        reason: change.reason,
        actor,
        ts: now,
        ...(change.clientId ? { clientId: change.clientId } : {}),
      }),
    ],
    inactivate:
      change.delta < 0 ? inactivateDeprecatedIfEmptyStmt(db, change.stickerId, now, actor) : null,
    read: lastEntryStatement(db),
  };
}

/** Urutan satu perubahan: kunci, penjaga, pembaruan+riwayat, penonaktifan otomatis, lalu pembacaan riwayat (terakhir). */
function flattenChange(parts: ChangeParts): DbStatement[] {
  const statements: DbStatement[] = [];
  if (parts.lock) statements.push(parts.lock);
  if (parts.guard) statements.push(parts.guard);
  statements.push(...parts.apply);
  if (parts.inactivate) statements.push(parts.inactivate);
  statements.push(parts.read);
  return statements;
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
  const notReceivable = change.requireActive ? receivingProblem(sticker) : null;
  if (notReceivable !== null) {
    throw appError('VALIDATION', notReceivable, { stickerId: notReceivable });
  }
  const current = Number((qtyResult?.results[0] as { qty: number | string } | undefined)?.qty ?? 0);
  const amount = Math.abs(change.delta);
  if (change.delta < 0 && current < amount) {
    throw appError('VALIDATION', NOT_ENOUGH_MESSAGE, { [change.amountField]: NOT_ENOUGH_MESSAGE });
  }
  const now = nowIso(env);
  const statements = flattenChange(changeStatements(env.DB, change, now, actor.email));
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

const REPLAY_CONFLICT_MESSAGE =
  'Entri stok tidak dapat dikirim ulang. Kiriman sebelumnya mungkin sudah tersimpan: periksa riwayat stok dulu. Bila belum, batalkan catat lalu tambahkan stiker itu lagi.';

/**
 * Kirim ulang entri stok batch ber-`clientId` (K1): bila SEMUA baris permintaan sudah tersimpan oleh pelaku yang sama
 * dengan isi yang sama (stiker, lokasi, jenis catatan, selisih butir, alasan), kembalikan entri-entrinya (urut
 * masukan) tanpa menulis apa pun. `null` = tidak satu pun ada (tulis seperti biasa). Sebagian ada, milik pelaku lain,
 * atau isi berbeda = `CONFLICT` generik (tanpa email, id, atau isi entri tersimpan; keputusan pemilik 2026-11-21). Balapan dua kiriman serentak: yang kalah gagal di indeks unik `sticker_stock_entries_client_id`
 * (batch dibatalkan), `runCas` mengulang, dan pemeriksaan ini menemukan baris pemenang.
 */
async function replayEntries(
  env: Env,
  changes: readonly StockChange[],
  actor: ActorRef,
): Promise<StockEntryDto[] | null> {
  const clientIds = changes.flatMap((change) => (change.clientId ? [change.clientId] : []));
  if (clientIds.length === 0) return null;
  const result = await entriesByClientIdsStatement(env.DB, clientIds).all<
    StockEntryRow & { client_id: string }
  >();
  if (result.results.length === 0) return null;
  const found = new Map(result.results.map((row) => [row.client_id, row]));
  if (found.size !== changes.length) throw appError('CONFLICT', REPLAY_CONFLICT_MESSAGE);
  return changes.map((change) => {
    const row = change.clientId ? found.get(change.clientId) : undefined;
    if (
      !row ||
      row.actor !== actor.email ||
      row.sticker_id.trim() !== change.stickerId ||
      row.location_id.trim() !== change.locationId ||
      row.kind.trim() !== change.kind ||
      Number(row.delta) !== change.delta ||
      row.reason !== change.reason
    ) {
      throw appError('CONFLICT', REPLAY_CONFLICT_MESSAGE);
    }
    return toStockEntry(row);
  });
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Entri stok batch: SATU `batch()` untuk semua baris, di bawah `runCas`. Semua baris diperiksa SEBELUM menulis (stiker
 * tak dikenal atau terhapus = `NOT_FOUND`; satu baris yang melanggar = `VALIDATION` bermuatan "Baris N: ..." yang
 * menolak seluruh permintaan). Urutan kunci tetap agar dua batch serentak tak saling deadlock: baris stiker (urut id),
 * lalu penjaga aktif (urut id), lalu pembaruan stok urut (stiker, lokasi), lalu penonaktifan otomatis (urut id).
 * Penjaga CAS pada pengurangan tetap pagar atas balapan; hasil mengikuti urutan masukan.
 */
async function applyBatchOnce(
  env: Env,
  changes: readonly StockChange[],
  actor: ActorRef,
): Promise<StockEntryDto[]> {
  // Kirim ulang (K1): diperiksa SEBELUM validasi stok, sebab stok kini sudah berubah oleh kiriman pertama.
  const replay = await replayEntries(env, changes, actor);
  if (replay) return replay;
  const stickerIds = [...new Set(changes.map((change) => change.stickerId))];
  const [statusResult, qtyResult] = await env.DB.batch([
    stickersStatusStatement(env.DB, stickerIds),
    stockPairsStatement(env.DB, changes),
  ]);
  const statusOf = new Map<string, { status: string; type_status: string }>();
  for (const row of (statusResult?.results ?? []) as Array<{
    id: string;
    status: string;
    type_status: string;
  }>) {
    statusOf.set(row.id.trim(), row);
  }
  const stored = new Map<string, number>();
  for (const row of (qtyResult?.results ?? []) as Array<{
    sticker_id: string;
    location_id: string;
    qty: number | string;
  }>) {
    stored.set(pairOf(row.sticker_id.trim(), row.location_id.trim()), Number(row.qty) || 0);
  }
  for (const change of changes) {
    if (!statusOf.has(change.stickerId)) throw appError('NOT_FOUND', 'Stiker tidak ditemukan');
  }
  for (const [index, change] of changes.entries()) {
    const sticker = statusOf.get(change.stickerId);
    let problem: string | null = null;
    if (change.requireActive && sticker) problem = receivingProblem(sticker);
    if (
      problem === null &&
      change.delta < 0 &&
      (stored.get(pairOf(change.stickerId, change.locationId)) ?? 0) < Math.abs(change.delta)
    ) {
      problem = NOT_ENOUGH_MESSAGE;
    }
    if (problem !== null) {
      const message = `Baris ${index + 1}: ${problem}`;
      throw appError('VALIDATION', message, { rows: message });
    }
  }
  const now = nowIso(env);
  const parts = changes.map((change) => changeStatements(env.DB, change, now, actor.email));
  const locks = new Map<string, DbStatement>();
  const guards = new Map<string, DbStatement>();
  const inactivations = new Map<string, DbStatement>();
  for (const [index, part] of parts.entries()) {
    const stickerId = (changes[index] as StockChange).stickerId;
    if (part.lock && !locks.has(stickerId)) locks.set(stickerId, part.lock);
    if (part.guard && !guards.has(stickerId)) guards.set(stickerId, part.guard);
    if (part.inactivate && !inactivations.has(stickerId)) {
      inactivations.set(stickerId, part.inactivate);
    }
  }
  const statements: DbStatement[] = [];
  for (const group of [locks, guards]) {
    for (const stickerId of [...group.keys()].sort(byText)) {
      statements.push(group.get(stickerId) as DbStatement);
    }
  }
  const order = changes
    .map((_, index) => index)
    .sort((a, b) => {
      const left = changes[a] as StockChange;
      const right = changes[b] as StockChange;
      return byText(left.stickerId, right.stickerId) || byText(left.locationId, right.locationId);
    });
  const readSlot = new Map<number, number>();
  for (const index of order) {
    const part = parts[index] as ChangeParts;
    statements.push(...part.apply, part.read);
    readSlot.set(index, statements.length - 1);
  }
  for (const stickerId of [...inactivations.keys()].sort(byText)) {
    statements.push(inactivations.get(stickerId) as DbStatement);
  }
  const results = await env.DB.batch(statements);
  return changes.map((_, index) => {
    const row = results[readSlot.get(index) ?? -1]?.results[0] as StockEntryRow | undefined;
    if (!row) throw appError('INTERNAL', 'Riwayat stok gagal dicatat');
    return toStockEntry(row);
  });
}

/**
 * Catat stok masuk atau keluar untuk banyak stiker x lokasi sekaligus (atomik; lihat `applyBatchOnce`). Satu
 * `reason` disalin ke setiap entri. Izin lokasi SEMUA baris diperiksa router (`locationIds` dari validator).
 */
export async function recordStockBatch(
  env: Env,
  input: RecordStockBatchInput,
  actor: ActorRef,
): Promise<StockEntryDto[]> {
  const changes = input.rows.map((row): StockChange => {
    const count = row.count ?? null;
    const pieces = count === null ? (row.quantity ?? 0) : piecesOfCount(count);
    return {
      stickerId: row.stickerId,
      locationId: row.locationId,
      kind: input.kind,
      delta: input.kind === 'in' ? pieces : -pieces,
      count,
      reason: input.reason,
      requireActive: input.kind === 'in',
      amountField: 'quantity',
      ...(row.clientId ? { clientId: row.clientId } : {}),
    };
  });
  return runCas(() => applyBatchOnce(env, changes, actor), STALE_MESSAGE);
}

/** Koreksi stok banyak stiker x lokasi sekaligus (atomik, alasan wajib; diizinkan pada stiker nonaktif). */
export async function adjustStockBatch(
  env: Env,
  input: AdjustStockBatchInput,
  actor: ActorRef,
): Promise<StockEntryDto[]> {
  const changes = input.rows.map(
    (row): StockChange => ({
      stickerId: row.stickerId,
      locationId: row.locationId,
      kind: 'adjust',
      delta: row.delta,
      count: null,
      reason: input.reason,
      requireActive: false,
      amountField: 'delta',
      ...(row.clientId ? { clientId: row.clientId } : {}),
    }),
  );
  return runCas(() => applyBatchOnce(env, changes, actor), STALE_MESSAGE);
}
