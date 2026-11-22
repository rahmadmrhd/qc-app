import { writeAudit } from '@server/core/audit';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { type PlanOutcome, runRecordBatch, runSingleRecord } from '@server/core/record-batch';
import {
  liveWhere,
  restoreStmt,
  softDeleteStmt,
  stampStmt,
  versionGuardStmt,
} from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import type { BatchResult, IdBatchInput, RemoveBatchResult, RemoveResult } from '@shared/batch';
import type { GetSerialInput, SerialDto } from '@shared/contract';
import { canManageSerial } from './access';
import { involvedBuIds } from './bu-history';
import { loadCases } from './case-repo';
import { loadBuHistory, loadSerialRowAny, loadSerialStickers, type SerialRow } from './repo';
import { nextStamp, STALE_MESSAGE, toDto } from './service';

// Hapus lunak dan pulihkan Serial Number (fase 4d; rancangan soft delete §4.3, keputusan pemilik 5 dan 12, T2, T8):
// perencana per record yang dipakai rute tunggal dan batch (`core/record-batch.ts`). Hapus TIDAK menyentuh stok stiker
// (yang sudah dipotong tidak dikembalikan), laporan rusak, kejadian, foto, maupun riwayat BU: semuanya ikut tak
// tampil lewat induknya. Tanpa syarat status. Hak: `serial: manage` pada SEMUA BU dalam riwayat BU serial (BU saat ini
// ikut), selain itu `NOT_FOUND` seragam (keberadaan serial tak terungkap). Kejadian `serial_events` TIDAK ditulis.

const NOT_FOUND = 'Serial Number tidak ditemukan';
const RESTORE_CLASH = 'Serial Number ini sudah dicatat ulang';

/** Peta konflik pulihkan: indeks unik serial (lama dan `_live`; nama dasar sama) = serial yang sama sudah hidup. */
const RESTORE_CONFLICTS = {
  serials_serial: { message: RESTORE_CLASH, field: 'serial' },
  serials_bu_serial: { message: RESTORE_CLASH, field: 'serial' },
};

interface LoadedSerial {
  row: SerialRow;
}

/**
 * Pemuat perencana: serial menurut id (hidup atau terhapus) dengan pemeriksaan hak. Tak ada, atau pemanggil tak
 * memegang `serial: manage` pada semua BU riwayat = `NOT_FOUND` seragam (BU yang boleh dibaca saja tak cukup).
 */
async function loadSerialForAction(
  env: Env,
  actor: UserContext,
  id: string,
): Promise<LoadedSerial> {
  const row = await loadSerialRowAny(env.DB, id);
  if (!row) throw appError('NOT_FOUND', NOT_FOUND);
  if (!canManageSerial(actor, await involvedBuIds(env.DB, row.id.trim()))) {
    throw appError('NOT_FOUND', NOT_FOUND);
  }
  return { row };
}

/** Ringkasan audit: identitas serial tanpa catatan bebas dan tanpa stok. */
function auditSnapshot(row: SerialRow, deleted = false): Record<string, unknown> {
  return {
    serial: row.serial,
    item: `${row.brand_name ?? ''} ${(row.model ?? '').trim()}`.trim(),
    bu: row.bu_code.trim(),
    status: row.status.trim(),
    custody: row.custody.trim(),
    ...(deleted ? { deleted: true } : {}),
  };
}

async function dtoOf(env: Env, row: SerialRow): Promise<SerialDto> {
  const id = row.id.trim();
  const [stickers, cases, buHistory] = await Promise.all([
    loadSerialStickers(env.DB, id),
    loadCases(env.DB, id),
    loadBuHistory(env.DB, id),
  ]);
  return toDto(row, stickers, cases, buHistory);
}

/**
 * Perencana hapus lunak: tanpa syarat status; sudah terhapus = `unchanged` (tanpa audit, `deleted_at` asli utuh).
 * Penjaga versi mengunci baris dan membatalkan batch bila serial berubah sejak dibaca (mis. aksi yang menyela); stempel
 * `updated_at` selalu maju (`nextStamp`) agar penulis serentak dari versi lama gagal CAS-nya.
 */
export function planSerialRemove(
  env: Env,
  loaded: LoadedSerial,
  actor: UserContext,
): PlanOutcome<RemoveResult> {
  const { row } = loaded;
  const id = row.id.trim();
  if (row.deleted_at !== '') return { unchanged: { id } };
  const now = nowIso(env);
  return {
    dto: { id },
    stmts: [
      versionGuardStmt(env.DB, 'serials', id, row.updated_at, 'live'),
      softDeleteStmt(env.DB, 'serials', id, actor.email, now),
      stampStmt(env.DB, 'serials', id, nextStamp(now, row.updated_at), actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'serial.delete',
        target: row.serial,
        targetId: id,
        before: auditSnapshot(row),
        after: auditSnapshot(row, true),
      }),
    ],
  };
}

/**
 * Perencana pulihkan: belum terhapus = `unchanged`. Serial yang SAMA sudah hidup di record lain (dicatat ulang sesudah
 * dihapus) = `CONFLICT` "Serial Number ini sudah dicatat ulang" (pemeriksaan aplikasi, bukan hanya indeks `_live`).
 * Status alur serial tidak diubah.
 */
export async function planSerialRestore(
  env: Env,
  loaded: LoadedSerial,
  actor: UserContext,
): Promise<PlanOutcome<SerialDto>> {
  const { row } = loaded;
  const id = row.id.trim();
  if (row.deleted_at === '') return { unchanged: await dtoOf(env, row) };
  const clash = await env.DB.prepare(
    `SELECT 1 AS present FROM serials WHERE ${liveWhere()} AND serial = ? AND id <> ? LIMIT 1`,
  )
    .bind(row.serial, id)
    .first<{ present: number }>();
  if (clash) throw appError('CONFLICT', RESTORE_CLASH, { serial: RESTORE_CLASH });
  const now = nowIso(env);
  const stamp = nextStamp(now, row.updated_at);
  const restored: SerialRow = {
    ...row,
    updated_at: stamp,
    updated_by: actor.email,
    deleted_at: '',
    deleted_by: '',
  };
  return {
    dto: await dtoOf(env, restored),
    stmts: [
      versionGuardStmt(env.DB, 'serials', id, row.updated_at, 'deleted'),
      restoreStmt(env.DB, 'serials', id),
      stampStmt(env.DB, 'serials', id, stamp, actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'serial.restore',
        target: row.serial,
        targetId: id,
        before: auditSnapshot(row, true),
        after: auditSnapshot(row),
      }),
    ],
  };
}

/** Pulihkan serentak: dua serial terhapus bernomor sama tak boleh hidup bersamaan. */
function verifyDistinctSerials(changed: readonly SerialDto[]): void {
  const seen = new Set<string>();
  for (const dto of changed) {
    if (seen.has(dto.serial)) {
      throw appError('CONFLICT', RESTORE_CLASH, { serial: RESTORE_CLASH });
    }
    seen.add(dto.serial);
  }
}

const SERIAL_BATCH = { conflicts: RESTORE_CONFLICTS, stale: STALE_MESSAGE };
const RESTORE_BATCH = { ...SERIAL_BATCH, verify: verifyDistinctSerials };

const removePlanner =
  (env: Env, actor: UserContext) =>
  async (id: string): Promise<PlanOutcome<RemoveResult>> =>
    planSerialRemove(env, await loadSerialForAction(env, actor, id), actor);

const restorePlanner =
  (env: Env, actor: UserContext) =>
  async (id: string): Promise<PlanOutcome<SerialDto>> =>
    planSerialRestore(env, await loadSerialForAction(env, actor, id), actor);

export function removeSerial(
  env: Env,
  input: GetSerialInput,
  actor: UserContext,
): Promise<RemoveResult> {
  return runSingleRecord(env, input.id, removePlanner(env, actor), SERIAL_BATCH);
}

export async function removeSerialBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<RemoveBatchResult> {
  const { items } = await runRecordBatch(env, input.ids, removePlanner(env, actor), SERIAL_BATCH);
  return { ids: items.map((item) => item.id) };
}

export function restoreSerial(
  env: Env,
  input: GetSerialInput,
  actor: UserContext,
): Promise<SerialDto> {
  return runSingleRecord(env, input.id, restorePlanner(env, actor), RESTORE_BATCH);
}

export function restoreSerialBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<BatchResult<SerialDto>> {
  return runRecordBatch(env, input.ids, restorePlanner(env, actor), RESTORE_BATCH);
}
