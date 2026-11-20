import { writeAudit } from '@server/core/audit';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { type PlanOutcome, runRecordBatch, runSingleRecord } from '@server/core/record-batch';
import {
  liveWhere,
  restoreWithChildren,
  softDeleteWithChildren,
  stampStmt,
  versionGuardStmt,
} from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import type { BatchResult, IdBatchInput, RemoveBatchResult, RemoveResult } from '@shared/batch';
import type { GetPostelInput, PostelDto, RemovePostelInput } from '@shared/contract';
import { normalizeKey } from '@shared/items';
import { loadAttachmentDtos } from './attachments';
import { postelSnapshot, postelTarget } from './audit';
import { findPostelRecord, type PostelNumberRecord, type PostelRecord } from './repo';
import {
  nextUpdatedAt,
  POSTEL_CONFLICTS,
  POSTEL_STALE_MESSAGE,
  type PostelRead,
  readPostels,
  toPostelDto,
} from './service';
import { restorePostelStickerStmts, retirePostelStickerStmts } from './stickers';

// Hapus lunak dan pulihkan Postel (fase 4b; rancangan soft delete §4.3, putusan 13, 15a, T2, T5): perencana per record
// yang dipakai rute tunggal dan batch (`core/record-batch.ts`). Hapus TIDAK melepas item (`items.postel_id` utuh),
// TIDAK menghapus nomor (ikut terhapus bersama induknya lewat `softDeleteWithChildren`) dan TIDAK membuang lampiran
// maupun berkas Drive-nya; stiker catatan menjadi `deprecated` (stok > 0) atau `inactive`, dan dipulihkan menjadi
// `inactive`. Hak: `sticker: edit` (putusan 15a), tanpa syarat status.

const NOT_FOUND = 'Postel tidak ditemukan';
const NUMBER_TAKEN = 'Nomor sertifikat sudah dipakai';

/** Anak yang ikut terhapus/pulih bersama catatan: nomor sertifikat (keunikan `postel_numbers_key_live` ikut induk). */
const CHILDREN = [{ table: 'postel_numbers', fk: 'postel_id' }] as const;

/** Data bersama satu permintaan (dimuat sekali, malas): nomor, item, dan visibilitas semua catatan yang diminta. */
export type PostelPlanContext = () => Promise<PostelRead>;

/**
 * Konteks baca untuk id yang diminta. Nomor dibaca menurut id catatan tanpa menyaring `deleted_at` (nomor catatan hidup
 * selalu hidup, nomor catatan terhapus ikut terhapus bersama induknya), jadi satu pembacaan cukup untuk campuran
 * catatan hidup dan terhapus.
 */
export function postelPlanContext(
  env: Env,
  user: UserContext,
  ids: readonly string[],
): PostelPlanContext {
  let loaded: Promise<PostelRead> | undefined;
  return () => {
    loaded ??= readPostels(env, user, [], ids, true, true);
    return loaded;
  };
}

async function loadPostelForAction(env: Env, id: string): Promise<PostelRecord> {
  const record = await findPostelRecord(env.DB, id);
  if (!record) throw appError('NOT_FOUND', NOT_FOUND);
  return record;
}

function liveItemCount(read: PostelRead, record: PostelRecord): number {
  return (read.items.get(record.id) ?? []).filter((item) => !item.deleted).length;
}

/** Nomor catatan yang dipulihkan tak boleh dipakai nomor HIDUP catatan lain (kunci `postel_numbers_key_live`). */
async function assertNumbersFree(env: Env, numbers: readonly PostelNumberRecord[]): Promise<void> {
  const keys = numbers.map((entry) => entry.numberKey).filter((key) => key !== '');
  if (keys.length === 0) return;
  const row = await env.DB.prepare(
    `SELECT number_key FROM postel_numbers WHERE ${liveWhere()} AND number_key IN (${keys.map(() => '?').join(',')}) LIMIT 1`,
  )
    .bind(...keys)
    .first<{ number_key: string }>();
  if (row) throw appError('CONFLICT', NUMBER_TAKEN, { number: NUMBER_TAKEN });
}

/** Perencana hapus lunak: tanpa syarat status; sudah terhapus = `unchanged` (tanpa audit, `deleted_at` asli utuh). */
export async function planPostelRemove(
  env: Env,
  record: PostelRecord,
  actor: UserContext,
  context: PostelPlanContext,
): Promise<PlanOutcome<RemoveResult>> {
  if (record.deletedAt !== '') return { unchanged: { id: record.id } };
  const read = await context();
  const now = nowIso(env);
  const before = postelSnapshot(
    record,
    read.numbers.get(record.id) ?? [],
    liveItemCount(read, record),
    record.attachments.length,
  );
  return {
    dto: { id: record.id },
    stmts: [
      // Kunci baris catatan (FOR UPDATE) lebih dulu: penyimpan serentak menunggu lalu mendapati versi sudah berubah.
      versionGuardStmt(env.DB, 'postels', record.id, record.updatedAt, 'live'),
      ...retirePostelStickerStmts(env.DB, record.stickerId, now, actor.email),
      ...softDeleteWithChildren(env.DB, 'postels', CHILDREN, record.id, actor.email, now),
      stampStmt(env.DB, 'postels', record.id, nextUpdatedAt(env, record.updatedAt), actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'postel.delete',
        target: postelTarget(record.id),
        before,
        after: { ...before, deleted: true },
      }),
    ],
  };
}

/**
 * Perencana pulihkan: belum terhapus = `unchanged`. Nomor yang kini dipakai catatan hidup lain ditolak (`CONFLICT`
 * generik pada `number`; indeks `postel_numbers_key_live` menjadi pagar balapan). Item yang masih menunjuk catatan ini
 * otomatis tersambung kembali, yang sudah dipasang ke catatan lain tidak ikut (penunjuk tak pernah diubah hapus).
 * Stiker catatan yang `deprecated` karena penghapusan kembali `inactive`.
 */
export async function planPostelRestore(
  env: Env,
  record: PostelRecord,
  actor: UserContext,
  context: PostelPlanContext,
): Promise<PlanOutcome<PostelDto>> {
  const read = await context();
  const attachments = await loadAttachmentDtos(env, record.attachments);
  if (record.deletedAt === '') return { unchanged: toPostelDto(record, read, attachments) };
  const numbers = read.numbers.get(record.id) ?? [];
  await assertNumbersFree(env, numbers);
  const now = nowIso(env);
  const stamp = nextUpdatedAt(env, record.updatedAt);
  const restored: PostelRecord = {
    ...record,
    updatedAt: stamp,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
  const snapshot = postelSnapshot(
    record,
    numbers,
    liveItemCount(read, record),
    record.attachments.length,
  );
  return {
    dto: toPostelDto(restored, read, attachments),
    stmts: [
      versionGuardStmt(env.DB, 'postels', record.id, record.updatedAt, 'deleted'),
      ...restoreWithChildren(env.DB, 'postels', CHILDREN, record.id),
      stampStmt(env.DB, 'postels', record.id, stamp, actor.email),
      ...restorePostelStickerStmts(env.DB, record.stickerId, now, actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'postel.restore',
        target: postelTarget(record.id),
        before: { ...snapshot, deleted: true },
        after: snapshot,
      }),
    ],
  };
}

/** Pulihkan serentak: dua catatan terhapus yang berbagi nomor tak boleh hidup bersamaan. */
function verifyDistinctNumbers(changed: readonly PostelDto[]): void {
  const seen = new Set<string>();
  for (const postel of changed) {
    for (const number of postel.numbers) {
      const key = normalizeKey(number.number);
      if (key === '') continue;
      if (seen.has(key)) throw appError('CONFLICT', NUMBER_TAKEN, { number: NUMBER_TAKEN });
      seen.add(key);
    }
  }
}

const POSTEL_BATCH = { conflicts: POSTEL_CONFLICTS, stale: POSTEL_STALE_MESSAGE };

const removePlanner =
  (env: Env, actor: UserContext, context: PostelPlanContext) =>
  async (id: string): Promise<PlanOutcome<RemoveResult>> =>
    planPostelRemove(env, await loadPostelForAction(env, id), actor, context);

const restorePlanner =
  (env: Env, actor: UserContext, context: PostelPlanContext) =>
  async (id: string): Promise<PlanOutcome<PostelDto>> =>
    planPostelRestore(env, await loadPostelForAction(env, id), actor, context);

export async function removePostel(
  env: Env,
  input: RemovePostelInput,
  actor: UserContext,
): Promise<null> {
  await runSingleRecord(
    env,
    input.id,
    removePlanner(env, actor, postelPlanContext(env, actor, [input.id])),
    POSTEL_BATCH,
  );
  return null;
}

export async function removePostelBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<RemoveBatchResult> {
  const { items } = await runRecordBatch(
    env,
    input.ids,
    removePlanner(env, actor, postelPlanContext(env, actor, input.ids)),
    POSTEL_BATCH,
  );
  return { ids: items.map((item) => item.id) };
}

export function restorePostel(
  env: Env,
  input: GetPostelInput,
  actor: UserContext,
): Promise<PostelDto> {
  return runSingleRecord(
    env,
    input.id,
    restorePlanner(env, actor, postelPlanContext(env, actor, [input.id])),
    { ...POSTEL_BATCH, verify: verifyDistinctNumbers },
  );
}

export function restorePostelBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<BatchResult<PostelDto>> {
  return runRecordBatch(
    env,
    input.ids,
    restorePlanner(env, actor, postelPlanContext(env, actor, input.ids)),
    { ...POSTEL_BATCH, verify: verifyDistinctNumbers },
  );
}
