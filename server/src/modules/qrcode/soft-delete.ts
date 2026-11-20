import { writeAudit } from '@server/core/audit';
import { CAS_FAIL_SQL } from '@server/core/cas';
import type { Db, DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, isAppError } from '@server/core/errors';
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
import type { QrDesignDto, QrDesignRefInput, QrPresetDto } from '@shared/contract';
import { QR_LIMITS } from '@shared/qrcode';
import { listAttachedItems, maxVersionOf, versionUnchangedGuardStmt } from './items';
import {
  findQrDesign,
  findQrPreset,
  listQrPresets,
  type QrDesignRecord,
  type QrPresetRecord,
} from './repo';
import {
  assertManualBookNameFree,
  assertManualBookStickerNameFree,
  deletedPresetIds,
  designViews,
  PRESET_CONFLICTS,
  QR_STALE_MESSAGE,
  qrDesignSnapshot,
  qrDocumentMap,
  qrPresetSnapshot,
  toQrDesignDto,
  toQrPresetDto,
} from './service';

// Hapus lunak dan pulihkan Desain QR (Manual Book) dan Preset QR (fase 4b; rancangan soft delete §4.3, putusan 13, T2, T4,
// T5): perencana per record yang dipakai rute tunggal dan batch (`core/record-batch.ts`). Berkas Drive (PDF ekspor, PNG,
// PDF sumber) TIDAK dibuang dan berbaginya TIDAK dicabut; `items.manual_book_design_id` TIDAK diubah; stiker Manual Book
// milik konfigurasi menjadi `deprecated` (stok > 0) atau `inactive`, dan dipulihkan menjadi `inactive`.

const NOT_FOUND = 'Konfigurasi tidak ditemukan';
const PRESET_NOT_FOUND = 'Konfigurasi default tidak ditemukan';
const PRESET_BU_TAKEN = 'BU ini sudah punya konfigurasi default';
const PRESET_NAME_TAKEN = 'Nama sudah dipakai konfigurasi default lain';
const MANUAL_BOOK_NAME_TAKEN = 'Nama Manual Book sudah dipakai konfigurasi lain';

/** Waktu tulis versi baru yang SELALU lebih besar dari `previous` (penjaga `updated_at` tak terkecoh jam yang sama). */
function nextStamp(env: Env, previous: string): string {
  const now = nowIso(env);
  return previous === '' || now > previous ? now : new Date(Date.parse(previous) + 1).toISOString();
}

/** Stiker (id) semua versi Manual Book sebuah konfigurasi: dibaca menurut id konfigurasi yang dikunci pemanggil. */
const STICKERS_OF_DESIGN =
  'SELECT mv.sticker_id FROM manual_book_versions mv WHERE mv.design_id = ?';

/**
 * Stiker Manual Book sebuah konfigurasi yang dihapus: yang `active` menjadi `inactive` bila total stok semua lokasi <= 0
 * (stok dapat negatif akibat serial), selain itu `deprecated` (tak menerima stok masuk, tak dihitung menipis). Dihitung
 * SQL di dalam batch SESUDAH kunci baris konfigurasi, jadi versi yang baru lahir lewat komit ekspor serentak ikut
 * terhitung. Urutan kunci sama dengan penulis stok dan komit ekspor: baris konfigurasi, baris stiker, lalu baris stok.
 */
function retireManualBookStickerStmts(
  db: Db,
  designId: string,
  now: string,
  actor: string,
): DbStatement[] {
  return [
    db
      .prepare(
        `SELECT s.id FROM stickers s WHERE ${liveWhere('s')} AND s.id IN (${STICKERS_OF_DESIGN}) ORDER BY s.id FOR UPDATE`,
      )
      .bind(designId),
    db
      .prepare(
        `SELECT 1 AS locked FROM sticker_stock WHERE sticker_id IN (${STICKERS_OF_DESIGN}) LOCK IN SHARE MODE`,
      )
      .bind(designId),
    db
      .prepare(
        `UPDATE stickers SET status = CASE WHEN (SELECT COALESCE(SUM(qty), 0) FROM sticker_stock WHERE sticker_id = stickers.id) <= 0 THEN 'inactive' ELSE 'deprecated' END, updated_at = ?, updated_by = ? WHERE status = 'active' AND id IN (${STICKERS_OF_DESIGN})`,
      )
      .bind(now, actor, designId),
  ];
}

/**
 * Stiker versi TERBARU konfigurasi yang `deprecated` (karena penghapusan) kembali `inactive` (putusan 13): dapat
 * diaktifkan lagi lewat katalog, tetapi Pulihkan sendiri tidak mengaktifkan apa pun. Versi lama tak disentuh.
 */
function restoreManualBookStickerStmt(
  db: Db,
  designId: string,
  now: string,
  actor: string,
): DbStatement {
  return db
    .prepare(
      "UPDATE stickers SET status = 'inactive', updated_at = ?, updated_by = ? WHERE status = 'deprecated' AND id = (SELECT mv.sticker_id FROM manual_book_versions mv WHERE mv.design_id = ? ORDER BY mv.version DESC LIMIT 1)",
    )
    .bind(now, actor, designId);
}

/** Data bersama satu permintaan (dimuat sekali, malas): dasar DTO dan snapshot audit semua record dalam batch. */
export type QrPlanContext = () => Promise<{
  documents: Awaited<ReturnType<typeof qrDocumentMap>>;
  items: Awaited<ReturnType<typeof listAttachedItems>>;
  views: Awaited<ReturnType<typeof designViews>>;
  deletedPresets: ReadonlySet<string>;
}>;

export function qrPlanContext(env: Env, user: UserContext): QrPlanContext {
  let loaded: ReturnType<QrPlanContext> | undefined;
  return () => {
    loaded ??= (async () => {
      const [documents, items, views, deletedPresets] = await Promise.all([
        qrDocumentMap(env),
        listAttachedItems(env.DB),
        designViews(env, user),
        deletedPresetIds(env),
      ]);
      return { documents, items, views, deletedPresets };
    })();
    return loaded;
  };
}

async function loadDesignForAction(env: Env, id: string): Promise<QrDesignRecord> {
  const design = await findQrDesign(env, id);
  if (!design) throw appError('NOT_FOUND', NOT_FOUND);
  return design;
}

async function loadPresetForAction(env: Env, id: string): Promise<QrPresetRecord> {
  const preset = await findQrPreset(env, id);
  if (!preset) throw appError('NOT_FOUND', PRESET_NOT_FOUND);
  return preset;
}

/** Perencana hapus lunak konfigurasi: tanpa syarat status; sudah terhapus = `unchanged` (tanpa audit, `deleted_at` utuh). */
export async function planQrDesignRemove(
  env: Env,
  design: QrDesignRecord,
  actor: UserContext,
  context: QrPlanContext,
): Promise<PlanOutcome<RemoveResult>> {
  if (design.deletedAt !== '') return { unchanged: { id: design.id } };
  const now = nowIso(env);
  const { documents, items } = await context();
  const version = await maxVersionOf(env.DB, design.id);
  const before = qrDesignSnapshot(
    design,
    documents,
    (items.get(design.id) ?? []).map((item) => item.id),
  );
  return {
    dto: { id: design.id },
    stmts: [
      // Kunci baris konfigurasi (FOR UPDATE) lebih dulu: komit ekspor memegang kunci yang sama.
      versionGuardStmt(env.DB, 'qr_designs', design.id, design.updatedAt, 'live'),
      // Komit ekspor tidak menaikkan `updated_at`: versi yang lahir sejak dibaca membatalkan batch (rencana ulang).
      versionUnchangedGuardStmt(env.DB, design.id, version),
      ...retireManualBookStickerStmts(env.DB, design.id, now, actor.email),
      softDeleteStmt(env.DB, 'qr_designs', design.id, actor.email, now),
      stampStmt(env.DB, 'qr_designs', design.id, nextStamp(env, design.updatedAt), actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'qrcode.delete',
        target: design.title,
        targetId: design.id,
        before,
        after: { ...before, deleted: true },
      }),
    ],
  };
}

/** Penjaga keunikan nama saat pulihkan: pesan sama dengan simpan, tetapi `CONFLICT` (bentrok dengan record hidup). */
async function assertRestorableName(env: Env, design: QrDesignRecord): Promise<void> {
  if (design.name === '') return;
  try {
    await assertManualBookNameFree(env, design.name, design.id);
    await assertManualBookStickerNameFree(env, design.name, design.id);
  } catch (error) {
    if (isAppError(error) && error.code === 'VALIDATION') {
      throw appError('CONFLICT', MANUAL_BOOK_NAME_TAKEN, { name: MANUAL_BOOK_NAME_TAKEN });
    }
    throw error;
  }
}

/**
 * Perencana pulihkan konfigurasi: belum terhapus = `unchanged`. Nama yang kini dipakai konfigurasi hidup lain ditolak
 * (`CONFLICT` pada `name`; penjaga SQL di batch menjaga balapan). Item yang masih menunjuk konfigurasi ini otomatis
 * terhubung kembali, item yang sudah dipasang ke konfigurasi lain tidak ikut (kolom penunjuk tak pernah diubah hapus).
 */
export async function planQrDesignRestore(
  env: Env,
  design: QrDesignRecord,
  actor: UserContext,
  context: QrPlanContext,
): Promise<PlanOutcome<QrDesignDto>> {
  const { documents, views, deletedPresets } = await context();
  const view = views.get(design.id);
  if (design.deletedAt === '') {
    return {
      unchanged: toQrDesignDto(design, documents, view, deletedPresets.has(design.presetId)),
    };
  }
  await assertRestorableName(env, design);
  const now = nowIso(env);
  const stamp = nextStamp(env, design.updatedAt);
  const restored: QrDesignRecord = {
    ...design,
    updatedAt: stamp,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
  const before = qrDesignSnapshot(
    design,
    documents,
    (views.get(design.id)?.items ?? []).map((item) => item.id),
  );
  const nameGuard =
    design.name === ''
      ? []
      : [
          env.DB.prepare(
            `SELECT CASE WHEN EXISTS (SELECT 1 FROM qr_designs WHERE ${liveWhere()} AND id <> ? AND name <> '' AND LOWER(name) = LOWER(?)) THEN ${CAS_FAIL_SQL} ELSE 1 END AS guard_ok`,
          ).bind(design.id, design.name),
        ];
  return {
    // Stiker terbaru yang `deprecated` karena penghapusan tampil `inactive` pada DTO hasil.
    dto: toQrDesignDto(
      restored,
      documents,
      view && view.stickerStatus === 'deprecated' ? { ...view, stickerStatus: 'inactive' } : view,
      deletedPresets.has(design.presetId),
    ),
    stmts: [
      versionGuardStmt(env.DB, 'qr_designs', design.id, design.updatedAt, 'deleted'),
      ...nameGuard,
      restoreStmt(env.DB, 'qr_designs', design.id),
      stampStmt(env.DB, 'qr_designs', design.id, stamp, actor.email),
      restoreManualBookStickerStmt(env.DB, design.id, now, actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'qrcode.restore',
        target: design.title,
        targetId: design.id,
        before: { ...before, deleted: true },
        after: qrDesignSnapshot(
          restored,
          documents,
          (views.get(design.id)?.items ?? []).map((item) => item.id),
        ),
      }),
    ],
  };
}

/** Pulihkan serentak: dua konfigurasi terhapus bernama sama (tanpa beda huruf besar) tak boleh hidup bersamaan. */
function verifyDistinctNames(changed: readonly QrDesignDto[]): void {
  const seen = new Set<string>();
  for (const design of changed) {
    if (design.name === '') continue;
    const key = design.name.toLowerCase();
    if (seen.has(key)) {
      throw appError('CONFLICT', MANUAL_BOOK_NAME_TAKEN, { name: MANUAL_BOOK_NAME_TAKEN });
    }
    seen.add(key);
  }
}

const QR_BATCH = { conflicts: {}, stale: QR_STALE_MESSAGE };

const removeDesignPlanner =
  (env: Env, actor: UserContext, context: QrPlanContext) =>
  async (id: string): Promise<PlanOutcome<RemoveResult>> =>
    planQrDesignRemove(env, await loadDesignForAction(env, id), actor, context);

const restoreDesignPlanner =
  (env: Env, actor: UserContext, context: QrPlanContext) =>
  async (id: string): Promise<PlanOutcome<QrDesignDto>> =>
    planQrDesignRestore(env, await loadDesignForAction(env, id), actor, context);

export function removeQrDesign(
  env: Env,
  input: QrDesignRefInput,
  actor: UserContext,
): Promise<QrDesignRefInput> {
  return runSingleRecord(
    env,
    input.id,
    removeDesignPlanner(env, actor, qrPlanContext(env, actor)),
    QR_BATCH,
  );
}

export async function removeQrDesignBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<RemoveBatchResult> {
  const { items } = await runRecordBatch(
    env,
    input.ids,
    removeDesignPlanner(env, actor, qrPlanContext(env, actor)),
    QR_BATCH,
  );
  return { ids: items.map((item) => item.id) };
}

export function restoreQrDesign(
  env: Env,
  input: QrDesignRefInput,
  actor: UserContext,
): Promise<QrDesignDto> {
  return runSingleRecord(
    env,
    input.id,
    restoreDesignPlanner(env, actor, qrPlanContext(env, actor)),
    QR_BATCH,
  );
}

export function restoreQrDesignBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<BatchResult<QrDesignDto>> {
  return runRecordBatch(
    env,
    input.ids,
    restoreDesignPlanner(env, actor, qrPlanContext(env, actor)),
    { ...QR_BATCH, verify: verifyDistinctNames },
  );
}

// --- Preset QR ---

/** Perencana hapus lunak preset: tanpa syarat status; sudah terhapus = `unchanged`. */
export function planQrPresetRemove(
  env: Env,
  preset: QrPresetRecord,
  actor: UserContext,
): PlanOutcome<RemoveResult> {
  if (preset.deletedAt !== '') return { unchanged: { id: preset.id } };
  const now = nowIso(env);
  const before: Record<string, unknown> = qrPresetSnapshot(preset);
  return {
    dto: { id: preset.id },
    stmts: [
      versionGuardStmt(env.DB, 'qr_presets', preset.id, preset.updatedAt, 'live'),
      softDeleteStmt(env.DB, 'qr_presets', preset.id, actor.email, now),
      stampStmt(env.DB, 'qr_presets', preset.id, nextStamp(env, preset.updatedAt), actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'qrcode.preset_delete',
        target: preset.name,
        targetId: preset.id,
        before,
        after: { ...before, deleted: true },
      }),
    ],
  };
}

/**
 * Perencana pulihkan preset: belum terhapus = `unchanged`. BU yang kini sudah punya preset hidup, nama yang kini dipakai
 * preset hidup lain, atau batas jumlah preset terlampaui = `CONFLICT` (indeks `_live` tetap menjadi pagar balapan).
 * BU nonaktif tidak menghalangi (sama seperti mengubah preset yang BU-nya kemudian nonaktif).
 */
export async function planQrPresetRestore(
  env: Env,
  preset: QrPresetRecord,
  actor: UserContext,
): Promise<PlanOutcome<QrPresetDto>> {
  if (preset.deletedAt === '') return { unchanged: toQrPresetDto(preset) };
  const live = await listQrPresets(env, 'live');
  if (preset.buId !== '' && live.some((row) => row.buId === preset.buId)) {
    throw appError('CONFLICT', PRESET_BU_TAKEN, { buId: PRESET_BU_TAKEN });
  }
  if (live.some((row) => row.name.toLowerCase() === preset.name.toLowerCase())) {
    throw appError('CONFLICT', PRESET_NAME_TAKEN, { name: PRESET_NAME_TAKEN });
  }
  if (live.length >= QR_LIMITS.presets) {
    throw appError('CONFLICT', `Konfigurasi default maksimal ${QR_LIMITS.presets}`);
  }
  const now = nowIso(env);
  const stamp = nextStamp(env, preset.updatedAt);
  const restored: QrPresetRecord = {
    ...preset,
    updatedAt: stamp,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
  const before: Record<string, unknown> = qrPresetSnapshot(preset);
  return {
    dto: toQrPresetDto(restored),
    stmts: [
      versionGuardStmt(env.DB, 'qr_presets', preset.id, preset.updatedAt, 'deleted'),
      restoreStmt(env.DB, 'qr_presets', preset.id),
      stampStmt(env.DB, 'qr_presets', preset.id, stamp, actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'qrcode.preset_restore',
        target: preset.name,
        targetId: preset.id,
        before: { ...before, deleted: true },
        after: qrPresetSnapshot(restored),
      }),
    ],
  };
}

/** Pulihkan serentak: BU dan nama kembar antar preset yang dipulihkan, serta batas jumlah preset hidup. */
function makePresetVerifier(liveCount: number) {
  return (changed: readonly QrPresetDto[]): void => {
    if (liveCount + changed.length > QR_LIMITS.presets) {
      throw appError('CONFLICT', `Konfigurasi default maksimal ${QR_LIMITS.presets}`);
    }
    const buIds = new Set<string>();
    const names = new Set<string>();
    for (const preset of changed) {
      if (preset.buId !== '') {
        if (buIds.has(preset.buId)) {
          throw appError('CONFLICT', PRESET_BU_TAKEN, { buId: PRESET_BU_TAKEN });
        }
        buIds.add(preset.buId);
      }
      const key = preset.name.toLowerCase();
      if (names.has(key)) {
        throw appError('CONFLICT', PRESET_NAME_TAKEN, { name: PRESET_NAME_TAKEN });
      }
      names.add(key);
    }
  };
}

const PRESET_BATCH = { conflicts: PRESET_CONFLICTS, stale: QR_STALE_MESSAGE };

const removePresetPlanner =
  (env: Env, actor: UserContext) =>
  async (id: string): Promise<PlanOutcome<RemoveResult>> =>
    planQrPresetRemove(env, await loadPresetForAction(env, id), actor);

const restorePresetPlanner =
  (env: Env, actor: UserContext) =>
  async (id: string): Promise<PlanOutcome<QrPresetDto>> =>
    planQrPresetRestore(env, await loadPresetForAction(env, id), actor);

export function removeQrPreset(
  env: Env,
  input: QrDesignRefInput,
  actor: UserContext,
): Promise<QrDesignRefInput> {
  return runSingleRecord(env, input.id, removePresetPlanner(env, actor), PRESET_BATCH);
}

export async function removeQrPresetBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<RemoveBatchResult> {
  const { items } = await runRecordBatch(
    env,
    input.ids,
    removePresetPlanner(env, actor),
    PRESET_BATCH,
  );
  return { ids: items.map((item) => item.id) };
}

export function restoreQrPreset(
  env: Env,
  input: QrDesignRefInput,
  actor: UserContext,
): Promise<QrPresetDto> {
  return runSingleRecord(env, input.id, restorePresetPlanner(env, actor), PRESET_BATCH);
}

export async function restoreQrPresetBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<BatchResult<QrPresetDto>> {
  const liveCount = (await listQrPresets(env, 'live')).length;
  return runRecordBatch(env, input.ids, restorePresetPlanner(env, actor), {
    ...PRESET_BATCH,
    verify: makePresetVerifier(liveCount),
  });
}
