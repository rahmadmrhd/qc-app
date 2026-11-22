import { writeAudit } from '@server/core/audit';
import { CAS_FAIL_SQL } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { type PlanOutcome, runSingleRecord } from '@server/core/record-batch';
import { restoreStmt, softDeleteStmt } from '@server/core/soft-delete';
import type { RemoveResult } from '@shared/batch';
import type { HandoverDto, HandoverRefInput } from '@shared/contract';
import { findHandoverWithComments, type LoadedHandover } from './repo';
import { handoverSnapshot, locationNameMap, STALE_MESSAGE, toHandoverDto } from './service';

// Hapus lunak dan pulihkan task Serah Terima (fase 4d; rancangan soft delete §4.3, keputusan pemilik 2 dan 12, T2, T8,
// spek §8 butir 6): perencana per record yang dipakai `runSingleRecord`. Klien TIDAK mengirim penjaga versi: perencana
// membaca task lalu menjaga `version`-nya sendiri di `batch()` (penulis lain yang menyela = muat ulang dan rencanakan
// ulang, bukan galat basi ke pengguna). Hapus membuang antrean notifikasi centang task itu dalam batch yang sama; nomor
// `ST-…` tidak pernah dipakai ulang (penghitung dan pencarian maksimum menghitung task terhapus juga). Tanpa syarat
// status (Selesai dan Dibatalkan pun boleh dihapus). Komentar dan centang ikut tak tampil lewat induknya.

const NOT_FOUND = 'Task tidak ditemukan';

/** Waktu tulis yang SELALU lebih besar dari `previous` (jam yang sama = +1 ms; `updated_at` dipakai sebagai etag). */
function nextStamp(now: string, previous: string): string {
  return now > previous ? now : new Date(Date.parse(previous) + 1).toISOString();
}

/**
 * Task menurut id (hidup atau terhapus) beserta komentarnya. Tak ada, atau lokasinya bukan `locationId` yang sudah
 * diizinkan router (`handover: manage`) = `NOT_FOUND` seragam.
 */
async function loadForAction(env: Env, ref: HandoverRefInput): Promise<LoadedHandover> {
  const found = await findHandoverWithComments(env, ref.id, undefined, true);
  if (!found || found.loaded.record.locationId !== ref.locationId) {
    throw appError('NOT_FOUND', NOT_FOUND);
  }
  return found.loaded;
}

/**
 * Penjaga `version` untuk `batch()`: mengunci baris (`FOR UPDATE`) lalu membatalkan seluruh batch (`CAS_FAIL_SQL`) bila
 * `version` bukan yang dibaca perencana atau keadaan hapusnya sudah berubah. Dua literal (hidup / terhapus) agar
 * penyaring keadaan terlihat tes penjaga soft delete.
 */
function versionGuard(env: Env, id: string, version: number, state: 'live' | 'deleted') {
  return state === 'live'
    ? env.DB.prepare(
        `SELECT CASE WHEN version = ? AND deleted_at = '' THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM handovers WHERE id = ? FOR UPDATE`,
      ).bind(version, id)
    : env.DB.prepare(
        `SELECT CASE WHEN version = ? AND deleted_at <> '' THEN 1 ELSE ${CAS_FAIL_SQL} END AS guard_ok FROM handovers WHERE id = ? FOR UPDATE`,
      ).bind(version, id);
}

/** Menaikkan `version` (agar penulis dari versi lama gagal CAS-nya) dan `updated_at`/`updated_by` setelah hapus/pulihkan. */
function bumpStmt(env: Env, id: string, stamp: string, actor: string) {
  return env.DB.prepare(
    'UPDATE handovers SET version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?',
  ).bind(stamp, actor, id);
}

/**
 * Perencana hapus lunak: tanpa syarat status; sudah terhapus = `unchanged` (tanpa audit, `deleted_at` asli utuh).
 * Antrean notifikasi centang task itu (`notification_pending` dan itemnya) dibuang dalam batch yang sama.
 */
export async function planHandoverRemove(
  env: Env,
  loaded: LoadedHandover,
  actor: ActorRef,
): Promise<PlanOutcome<RemoveResult>> {
  const { record } = loaded;
  if (record.deletedAt) return { unchanged: { id: record.id } };
  const now = nowIso(env);
  const stamp = nextStamp(now, record.updatedAt);
  const names = await locationNameMap(env);
  return {
    dto: { id: record.id },
    stmts: [
      versionGuard(env, record.id, record.version, 'live'),
      softDeleteStmt(env.DB, 'handovers', record.id, actor.email, now),
      bumpStmt(env, record.id, stamp, actor.email),
      env.DB.prepare('DELETE FROM notification_pending WHERE handover_id = ?').bind(record.id),
      env.DB.prepare('DELETE FROM notification_pending_items WHERE handover_id = ?').bind(
        record.id,
      ),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'handover.delete',
        target: record.number,
        targetId: record.id,
        before: handoverSnapshot(record, loaded.customerName, names),
        after: { ...handoverSnapshot(record, loaded.customerName, names), deleted: true },
      }),
    ],
  };
}

/** Perencana pulihkan: belum terhapus = `unchanged`. Task kembali ke kolom statusnya (status turunan tak berubah). */
export async function planHandoverRestore(
  env: Env,
  loaded: LoadedHandover,
  actor: ActorRef,
): Promise<PlanOutcome<HandoverDto>> {
  const { record } = loaded;
  const comments = loaded.comments ?? [];
  if (!record.deletedAt) {
    return { unchanged: toHandoverDto(record, loaded.customerName, comments) };
  }
  const now = nowIso(env);
  const stamp = nextStamp(now, record.updatedAt);
  const names = await locationNameMap(env);
  const restored = {
    ...record,
    updatedAt: stamp,
    updatedBy: actor.email,
    version: record.version + 1,
    deletedAt: '',
    deletedBy: '',
  };
  return {
    dto: toHandoverDto(restored, loaded.customerName, comments),
    stmts: [
      versionGuard(env, record.id, record.version, 'deleted'),
      restoreStmt(env.DB, 'handovers', record.id),
      bumpStmt(env, record.id, stamp, actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'handover.restore',
        target: record.number,
        targetId: record.id,
        before: { ...handoverSnapshot(record, loaded.customerName, names), deleted: true },
        after: handoverSnapshot(restored, loaded.customerName, names),
      }),
    ],
  };
}

const OPTIONS = { conflicts: {}, stale: STALE_MESSAGE };

export function removeHandover(
  env: Env,
  input: HandoverRefInput,
  actor: ActorRef,
): Promise<RemoveResult> {
  return runSingleRecord(
    env,
    input.id,
    async () => planHandoverRemove(env, await loadForAction(env, input), actor),
    OPTIONS,
  );
}

export function restoreHandover(
  env: Env,
  input: HandoverRefInput,
  actor: ActorRef,
): Promise<HandoverDto> {
  return runSingleRecord(
    env,
    input.id,
    async () => planHandoverRestore(env, await loadForAction(env, input), actor),
    OPTIONS,
  );
}
