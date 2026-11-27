import { writeAudit } from '@server/core/audit';
import { runCas } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import type { AppError } from '@server/core/errors';
import { appError, staleError } from '@server/core/errors';
import { newId } from '@server/core/id';
import { type PlanOutcome, runRecordBatch, runSingleRecord } from '@server/core/record-batch';
import {
  liveWhere,
  restoreStmt,
  softDeleteStmt,
  stampStmt,
  versionGuardStmt,
} from '@server/core/soft-delete';
import type { UserContext } from '@server/modules/access/context';
import { batchWrite, mapDuplicateError } from '@server/modules/access/repo';
import type { BrandBuBrief } from '@server/modules/brand/repo';
import { activeBuGuardStmt, listBuBriefs } from '@server/modules/brand/repo';
import { planAttachFiles } from '@server/modules/files/service';
import type {
  BatchResult,
  IdBatchInput,
  RemoveBatchResult,
  RemoveResult,
  StatusBatchInput,
} from '@shared/batch';
import type {
  GetStickerInput,
  GetStickerTypeInput,
  ListStickersInput,
  ListStickerTypesInput,
  OpeningStockInput,
  SaveStickerInput,
  SaveStickerTypeInput,
  SetStickerStatusInput,
  SetStickerTypeStatusInput,
  StickerDto,
  StickerTypeDto,
} from '@shared/contract';
import { hasLevel } from '@shared/permissions';
import { isLowStock } from '@shared/stickers';
import {
  assertOpeningStockAccess,
  findOpeningStockReplay,
  mayBeOpeningStockRace,
  OPENING_STOCK_REASON,
  OPENING_STOCK_TAKEN_MESSAGE,
  openingBreakdown,
  openingStockStmts,
  openingTotal,
} from './opening-stock';
import type { StickerRecord, StickerTypeRecord } from './repo';
import {
  insertStickerStmt,
  insertStickerTypeStmt,
  isLatestManualBookVersion,
  latestManualBookStickerIdsFromResult,
  latestManualBookStickerIdsStatement,
  latestManualBookVersionGuardStmt,
  listStickerTypeRecords,
  lockStickerType,
  setStickerStatusStmt,
  setStickerTypeStatusStmt,
  stickerBusinessUnitsFromResult,
  stickerBusinessUnitsOfStatement,
  stickerBusinessUnitsStatement,
  stickerByIdStatement,
  stickersFromResult,
  stickersStatement,
  stickerTypeByIdStatement,
  stickerTypeGuardStmt,
  stickerTypesFromResult,
  stickerTypesStatement,
  stockTotalOfStatement,
  stockTotalsFromResult,
  stockTotalsStatement,
  syncStickerBusinessUnitsStmts,
  updateStickerStmt,
  updateStickerTypeStmt,
} from './repo';
import {
  type StickerSourceLinks,
  stickerSourceLinksFromResult,
  stickerSourceLinksOfStatement,
  stickerSourceLinksStatement,
} from './source-links';

const NAME_TAKEN_MESSAGE = 'Nama jenis sudah dipakai';
const TYPE_STALE_MESSAGE =
  'Jenis stiker diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';
const TYPE_DELETED_MESSAGE = 'Jenis stiker sudah dihapus; pulihkan dulu sebelum mengubahnya';
const RULE_LOCKED_MESSAGE = 'Aturan jenis tidak dapat diubah karena sudah ada stiker';
const DEPRECATED_ACTIVATE_MESSAGE =
  'Stiker ini sudah digantikan versi baru dan tidak dapat diaktifkan kembali';
const NOT_LATEST_MESSAGE = 'Hanya versi terbaru Manual Book yang dapat diaktifkan';
const SYSTEM_TYPE_MESSAGE = 'Jenis sistem dikelola aplikasi dan tidak dapat diubah';
const SYSTEM_STICKER_MESSAGE =
  'Stiker jenis sistem dibuat otomatis; hanya minimum stok, alias, dan status yang dapat diubah';
const MANUAL_BOOK_GONE_MESSAGE =
  'Konfigurasi Manual Book stiker ini sudah dihapus; pulihkan konfigurasinya lebih dulu';
const POSTEL_GONE_MESSAGE =
  'Catatan Postel stiker ini sudah dihapus; stiker tidak dapat diaktifkan kembali';
const POSTEL_STICKER_MESSAGE =
  'Stiker Postel dibuat otomatis; hanya minimum stok, alias, gambar, dan status yang dapat diubah';

/** Peta bentrok indeks unik -> pesan generik (tanpa nilai lain). */
const TYPE_CONFLICTS = {
  sticker_types_name_unique: { field: 'name', message: NAME_TAKEN_MESSAGE },
};

function toStickerTypeDto(type: StickerTypeRecord): StickerTypeDto {
  return {
    id: type.id,
    name: type.name,
    rule: type.rule,
    status: type.status,
    systemKind: type.systemKind,
    defaultMinQty: type.defaultMinQty,
    stickerCount: type.liveStickerCount,
    updatedAt: type.updatedAt,
    ...(type.deletedAt === ''
      ? {}
      : { deleted: { deletedAt: type.deletedAt, deletedBy: type.deletedBy } }),
  };
}

export function stickerTypeSnapshot(type: StickerTypeRecord): Record<string, unknown> {
  return {
    name: type.name,
    rule: type.rule,
    status: type.status,
    defaultMinQty: type.defaultMinQty,
  };
}

/** Hanya `sticker: manage` yang melihat record terhapus (daftar `status=deleted` dan detailnya). */
function canSeeDeleted(user: UserContext | undefined): boolean {
  return user !== undefined && hasLevel(user.permissions.sticker, 'manage');
}

/**
 * Daftar jenis. Bawaan = jenis hidup (aktif + nonaktif); `active`/`inactive` menyaring lagi (`all` = bawaan);
 * `deleted` = hanya jenis terhapus, hanya bagi `sticker: manage` (selain itu `FORBIDDEN`).
 */
export async function listStickerTypes(
  env: Env,
  input: ListStickerTypesInput | null = null,
  user?: UserContext,
): Promise<StickerTypeDto[]> {
  const filter = input?.status;
  if (filter === 'deleted' && !canSeeDeleted(user)) {
    throw appError('FORBIDDEN', 'Anda tidak berhak melihat jenis stiker terhapus');
  }
  return (await listStickerTypeRecords(env.DB, filter === 'deleted' ? 'deleted' : 'live'))
    .filter((type) => filter !== 'active' || type.status === 'active')
    .filter((type) => filter !== 'inactive' || type.status === 'inactive')
    .map(toStickerTypeDto)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Satu jenis menurut id. Jenis terhapus hanya bagi `sticker: manage`; selain itu `NOT_FOUND` (seperti tak dikenal). */
export async function getStickerTypeDto(
  env: Env,
  input: GetStickerTypeInput,
  user: UserContext,
): Promise<StickerTypeDto> {
  return toStickerTypeDto(await readableStickerType(env, input.id, user));
}

/** Jenis menurut id bagi pembaca: terhapus hanya untuk `sticker: manage`, selain itu (dan id tak dikenal) `NOT_FOUND`. */
async function readableStickerType(
  env: Env,
  id: string,
  user: UserContext,
): Promise<StickerTypeRecord> {
  const found = await loadStickerTypeAny(env, id);
  if (!found || (found.deletedAt !== '' && !canSeeDeleted(user))) {
    throw appError('NOT_FOUND', TYPE_NOT_FOUND);
  }
  return found;
}

/** Gerbang baca untuk `activity.list`: aturan yang sama dengan `stickerTypes.get`. */
export async function assertStickerTypeReadable(
  env: Env,
  id: string,
  user: UserContext,
): Promise<void> {
  await readableStickerType(env, id, user);
}

const TYPE_NOT_FOUND = 'Jenis stiker tidak ditemukan';

/** Jenis (hidup atau terhapus) menurut id; `undefined` bila id tak dikenal. */
async function loadStickerTypeAny(env: Env, id: string): Promise<StickerTypeRecord | undefined> {
  const result = await env.DB.batch([stickerTypeByIdStatement(env.DB, id)]);
  return stickerTypesFromResult(result[0] ?? { results: [] })[0];
}

const DEFAULT_MIN_FORBIDDEN_MESSAGE =
  'Minimum stok bawaan hanya dapat diubah oleh pengguna dengan izin Kelola pada Stiker';

/** Mengubah minimum stok bawaan jenis butuh `sticker: manage` (sama dengan Konfigurasi Stiker; satu kolom data). */
function assertMayChangeDefaultMin(user: UserContext): void {
  if (!hasLevel(user.permissions.sticker, 'manage')) {
    throw appError('FORBIDDEN', DEFAULT_MIN_FORBIDDEN_MESSAGE, {
      defaultMinQty: DEFAULT_MIN_FORBIDDEN_MESSAGE,
    });
  }
}

/** Aturan `group` hanya milik jenis sistem; jenis buatan pengguna memilih `bu` atau `none`. */
function assertUserRule(rule: SaveStickerTypeInput['rule']): void {
  if (rule === 'group') {
    const message = 'Aturan tidak dikenal';
    throw appError('VALIDATION', message, { rule: message });
  }
}

async function createStickerType(
  env: Env,
  input: SaveStickerTypeInput,
  actor: UserContext,
): Promise<StickerTypeDto> {
  assertUserRule(input.rule);
  const defaultMinQty = input.defaultMinQty ?? 0;
  if (defaultMinQty !== 0) assertMayChangeDefaultMin(actor);
  const now = nowIso(env);
  const created: StickerTypeRecord = {
    id: newId(),
    name: input.name,
    rule: input.rule,
    status: 'active',
    systemKind: '',
    defaultMinQty,
    stickerCount: 0,
    liveStickerCount: 0,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
  await batchWrite(
    env.DB,
    [
      insertStickerTypeStmt(env.DB, created),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'stickerType.create',
        target: created.name,
        targetId: created.id,
        before: null,
        after: stickerTypeSnapshot(created),
      }),
    ],
    TYPE_CONFLICTS,
  );
  return toStickerTypeDto(created);
}

/**
 * Ubah nama/aturan dalam SATU transaksi dengan kunci baris jenis (`FOR UPDATE`): penyisipan stiker mengambil kunci
 * bersama baris jenis yang sama, jadi pemeriksaan "sudah ada stiker" tidak dapat disela stiker baru.
 */
async function updateStickerType(
  env: Env,
  id: string,
  input: SaveStickerTypeInput,
  actor: UserContext,
): Promise<StickerTypeDto> {
  return env.DB.transaction(async (tx) => {
    const existing = await lockStickerType(tx, id);
    if (!existing) throw appError('NOT_FOUND', TYPE_NOT_FOUND);
    if (existing.deletedAt !== '') throw appError('CONFLICT', TYPE_DELETED_MESSAGE);
    // Versi yang dilihat penyimpan harus masih terkini; baris terkunci (`FOR UPDATE`) sehingga pembacaan ini pasti.
    if (input.expectedUpdatedAt !== existing.updatedAt) throw staleError(TYPE_STALE_MESSAGE);
    // Jenis sistem (Manual Book, Postel) dikelola aplikasi: nama dan aturannya terkunci; hanya minimum bawaan yang boleh
    // diubah (keputusan pemilik 2026-11-25; tetap butuh `sticker: manage`).
    if (
      existing.systemKind !== '' &&
      (input.name !== existing.name || input.rule !== existing.rule)
    ) {
      throw appError('VALIDATION', SYSTEM_TYPE_MESSAGE, { name: SYSTEM_TYPE_MESSAGE });
    }
    if (existing.systemKind === '') assertUserRule(input.rule);
    const defaultMinQty = input.defaultMinQty ?? existing.defaultMinQty;
    if (defaultMinQty !== existing.defaultMinQty) assertMayChangeDefaultMin(actor);
    if (
      existing.name === input.name &&
      existing.rule === input.rule &&
      defaultMinQty === existing.defaultMinQty
    ) {
      return toStickerTypeDto(existing);
    }
    // Hanya stiker HIDUP yang mengunci aturan (keputusan pemilik 2026-11-21; soft delete §9): stiker terhapus tak menahan.
    if (existing.rule !== input.rule && existing.liveStickerCount > 0) {
      throw appError('VALIDATION', RULE_LOCKED_MESSAGE, { rule: RULE_LOCKED_MESSAGE });
    }
    const now = nowIso(env);
    const updated: StickerTypeRecord = {
      ...existing,
      name: input.name,
      rule: input.rule,
      defaultMinQty,
      updatedAt: now,
      updatedBy: actor.email,
    };
    await updateStickerTypeStmt(tx, updated).run();
    await writeAudit(tx, {
      ts: now,
      actor: actor.email,
      action: 'stickerType.update',
      target: updated.name,
      targetId: updated.id,
      before: stickerTypeSnapshot(existing),
      after: stickerTypeSnapshot(updated),
    }).run();
    return toStickerTypeDto(updated);
  });
}

export async function saveStickerType(
  env: Env,
  input: SaveStickerTypeInput,
  actor: UserContext,
): Promise<StickerTypeDto> {
  try {
    return input.id
      ? await updateStickerType(env, input.id, input, actor)
      : await createStickerType(env, input, actor);
  } catch (error) {
    throw mapDuplicateError(error, TYPE_CONFLICTS);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Stiker
// ---------------------------------------------------------------------------------------------------------------

const STICKER_DELETED_MESSAGE = 'Stiker sudah dihapus; pulihkan dulu sebelum mengubahnya';
const STICKER_NAME_TAKEN_MESSAGE = 'Nama stiker sudah dipakai pada jenis ini';
const STICKER_STALE_MESSAGE =
  'Stiker diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';
const INACTIVE_BU_MESSAGE = 'BU tidak dikenal atau tidak aktif';

const STICKER_CONFLICTS = {
  stickers_type_name_unique: { field: 'name', message: STICKER_NAME_TAKEN_MESSAGE },
  sticker_stock_entries_client_id: { field: 'openingStock', message: OPENING_STOCK_TAKEN_MESSAGE },
};

export { OPENING_STOCK_REASON };

function toStickerDto(
  sticker: StickerRecord,
  typeName: string,
  businessUnitIds: readonly string[],
  total: number,
  latestManualBookVersion: boolean,
  typeDeleted = false,
  sources: StickerSourceLinks = {},
): StickerDto {
  return {
    id: sticker.id,
    typeId: sticker.typeId,
    typeName,
    name: sticker.name,
    alias: sticker.alias,
    fileId: sticker.fileId === '' ? null : sticker.fileId,
    minQty: sticker.minQty,
    status: sticker.status,
    businessUnitIds: [...businessUnitIds],
    low: isLowStock({ status: sticker.status, minQty: sticker.minQty, total }),
    latestManualBookVersion,
    updatedAt: sticker.updatedAt,
    ...(sticker.deletedAt === ''
      ? {}
      : { deleted: { deletedAt: sticker.deletedAt, deletedBy: sticker.deletedBy } }),
    ...(typeDeleted ? { typeDeleted: true } : {}),
    ...(sources.postelId ? { postelId: sources.postelId } : {}),
    ...(sources.manualBookDesignId ? { manualBookDesignId: sources.manualBookDesignId } : {}),
  };
}

/** Penanda versi terbaru satu stiker: hanya jenis sistem Manual Book yang dapat berstatus ini (satu kueri). */
async function latestFlagOf(
  env: Env,
  stickerId: string,
  type: StickerTypeRecord | undefined,
): Promise<boolean> {
  return (
    type !== undefined &&
    type.systemKind === 'manual_book' &&
    (await isLatestManualBookVersion(env.DB, stickerId))
  );
}

/** Kode BU terurut untuk audit (id tak dikenal jatuh ke id-nya). */
function codesOf(ids: readonly string[], bus: readonly BrandBuBrief[]): string[] {
  const code = new Map(bus.map((bu) => [bu.id, bu.code] as const));
  return ids.map((id) => code.get(id) ?? id).sort((a, b) => a.localeCompare(b));
}

export function stickerSnapshot(
  sticker: StickerRecord,
  typeName: string,
  businessUnits: readonly string[],
): Record<string, unknown> {
  return {
    type: typeName,
    name: sticker.name,
    alias: sticker.alias,
    fileId: sticker.fileId === '' ? null : sticker.fileId,
    minQty: sticker.minQty,
    status: sticker.status,
    businessUnits: [...businessUnits],
  };
}

/**
 * Daftar stiker: SATU `batch()` (stiker, jenis, BU, dan total stok per stiker lewat satu kueri agregat). Bawaan =
 * stiker hidup (aktif, nonaktif, digantikan), termasuk yang jenisnya terhapus (`typeDeleted`). `active` = status aktif;
 * `inactive` = bukan aktif (nonaktif atau digantikan, sama dengan syarat Hapus); `all` = bawaan; `deleted` = hanya
 * stiker terhapus, hanya bagi `sticker: manage` (selain itu `FORBIDDEN`).
 */
export async function listStickers(
  env: Env,
  input: ListStickersInput | null = null,
  user?: UserContext,
): Promise<StickerDto[]> {
  const filter = input?.status;
  if (filter === 'deleted' && !canSeeDeleted(user)) {
    throw appError('FORBIDDEN', 'Anda tidak berhak melihat stiker terhapus');
  }
  const [stickerResult, typeResult, buResult, totalResult, latestResult, sourceResult] =
    await env.DB.batch([
      stickersStatement(env.DB, filter === 'deleted' ? 'deleted' : 'live'),
      stickerTypesStatement(env.DB),
      stickerBusinessUnitsStatement(env.DB),
      stockTotalsStatement(env.DB),
      latestManualBookStickerIdsStatement(env.DB),
      stickerSourceLinksStatement(env.DB),
    ]);
  const types = new Map(
    stickerTypesFromResult(typeResult ?? { results: [] }).map((type) => [type.id, type]),
  );
  const bus = stickerBusinessUnitsFromResult(buResult ?? { results: [] });
  const totals = stockTotalsFromResult(totalResult ?? { results: [] });
  const latest = latestManualBookStickerIdsFromResult(latestResult ?? { results: [] });
  const sources = stickerSourceLinksFromResult(sourceResult ?? { results: [] });
  return stickersFromResult(stickerResult ?? { results: [] })
    .filter((sticker) => filter !== 'active' || sticker.status === 'active')
    .filter((sticker) => filter !== 'inactive' || sticker.status !== 'active')
    .map((sticker) => {
      const type = types.get(sticker.typeId);
      return toStickerDto(
        sticker,
        type?.name ?? '',
        bus.get(sticker.id) ?? [],
        totals.get(sticker.id) ?? 0,
        latest.has(sticker.id),
        type !== undefined && type.deletedAt !== '',
        sources.get(sticker.id),
      );
    })
    .sort((a, b) => a.typeName.localeCompare(b.typeName) || a.name.localeCompare(b.name));
}

/** Rujukan berkas tak sah dilaporkan di field `fileId` (pesan dari `planAttachFiles`). */
export async function planStickerFile(
  env: Env,
  fileId: string,
  stickerId: string,
  actor: ActorRef,
): Promise<DbStatement[]> {
  try {
    return await planAttachFiles(env, [fileId], 'sticker', stickerId, undefined, actor.email);
  } catch (error) {
    const known = error as AppError;
    if (known.name === 'AppError' && (known.code === 'VALIDATION' || known.code === 'CONFLICT')) {
      const message =
        known.code === 'VALIDATION' ? 'Gambar tidak dikenal; unggah ulang' : known.message;
      throw appError(known.code, message, { fileId: message });
    }
    throw error;
  }
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * Menulis stiker (baru atau ubah). Semua pemeriksaan dijalankan di sini; hasilnya SATU `batch()` dengan penjaga:
 * baris jenis dikunci bersama (aturan sama dan, untuk stiker baru, jenis masih aktif), BU yang ditambah masih aktif,
 * dan CAS `updated_at` pada baris stiker. Penjaga yang gagal membatalkan batch dan `runCas` memuat ulang lalu
 * mengulang, sehingga pemeriksaan di bawah menjawab dengan keadaan terbaru.
 */
async function saveStickerOnce(
  env: Env,
  input: SaveStickerInput,
  actor: UserContext,
): Promise<StickerDto> {
  const opening = input.id ? undefined : input.openingStocks;
  if (opening) {
    assertOpeningStockAccess(actor, opening);
    // Kiriman ulang (idempoten): entri stok awal milik pelaku yang sama = kembalikan stiker yang sudah dibuat.
    const replayed = await replayOpeningSticker(env, actor, opening);
    if (replayed) return replayed;
  }
  const reads: DbStatement[] = [stickerTypeByIdStatement(env.DB, input.typeId)];
  if (input.id) {
    reads.push(
      stickerByIdStatement(env.DB, input.id),
      stickerBusinessUnitsOfStatement(env.DB, input.id),
      stockTotalOfStatement(env.DB, input.id),
    );
  }
  const results = await env.DB.batch(reads);
  const type = stickerTypesFromResult(results[0] ?? { results: [] })[0];
  const existing = input.id ? stickersFromResult(results[1] ?? { results: [] })[0] : undefined;
  if (input.id && !existing) throw appError('NOT_FOUND', 'Stiker tidak ditemukan');
  if (existing && existing.deletedAt !== '') throw appError('CONFLICT', STICKER_DELETED_MESSAGE);
  // Versi yang dilihat penyimpan harus masih terkini (lost update); CAS `updated_at` di batch menjaga sisanya.
  if (existing && input.expectedUpdatedAt !== existing.updatedAt) {
    throw staleError(STICKER_STALE_MESSAGE);
  }
  if (existing && existing.typeId !== input.typeId) {
    const message = 'Jenis stiker tidak dapat diubah';
    throw appError('VALIDATION', message, { typeId: message });
  }
  if (!type) {
    const message = 'Jenis stiker tidak dikenal';
    throw appError('VALIDATION', message, { typeId: message });
  }
  // Stiker jenis sistem lahir dari ekspor (bukan form katalog) dan hanya minimum stok dan alias yang dapat diubah.
  if (type.systemKind !== '') {
    const lockedMessage =
      type.systemKind === 'postel' ? POSTEL_STICKER_MESSAGE : SYSTEM_STICKER_MESSAGE;
    if (!existing) throw appError('VALIDATION', lockedMessage, { typeId: lockedMessage });
    if (input.name !== existing.name) {
      throw appError('VALIDATION', lockedMessage, { name: lockedMessage });
    }
    // Gambar stiker Manual Book mengikuti ekspor; gambar stiker Postel boleh diganti (spek 4b).
    if (type.systemKind === 'manual_book' && (input.fileId ?? '') !== existing.fileId) {
      throw appError('VALIDATION', SYSTEM_STICKER_MESSAGE, { fileId: SYSTEM_STICKER_MESSAGE });
    }
  }
  if (!existing && type.deletedAt !== '') {
    const message = 'Jenis stiker sudah dihapus';
    throw appError('VALIDATION', message, { typeId: message });
  }
  if (!existing && type.status !== 'active') {
    const message = 'Jenis stiker dinonaktifkan; aktifkan dulu di halaman Jenis';
    throw appError('VALIDATION', message, { typeId: message });
  }
  const currentBuIds = existing
    ? (stickerBusinessUnitsFromResult(results[2] ?? { results: [] }).get(existing.id) ?? [])
    : [];
  const total = existing
    ? (stockTotalsFromResult(results[3] ?? { results: [] }).get(existing.id) ?? 0)
    : 0;

  const latest = existing ? await latestFlagOf(env, existing.id, type) : false;

  const requested = input.businessUnitIds;
  if ((type.rule === 'none' || type.rule === 'group') && requested.length > 0) {
    const message = 'Jenis ini tidak memakai BU';
    throw appError('VALIDATION', message, { businessUnitIds: message });
  }
  if (type.rule === 'bu' && requested.length === 0) {
    const message = 'Pilih minimal satu BU';
    throw appError('VALIDATION', message, { businessUnitIds: message });
  }
  const bus = await listBuBriefs(env.DB);
  const known = new Map(bus.map((bu) => [bu.id, bu] as const));
  const added = requested.filter((id) => !currentBuIds.includes(id));
  for (const id of added) {
    if (known.get(id)?.status !== 'active') {
      throw appError('VALIDATION', INACTIVE_BU_MESSAGE, { businessUnitIds: INACTIVE_BU_MESSAGE });
    }
  }

  const fileId = input.fileId ?? '';
  const id = existing?.id ?? newId();
  const attach = fileId === '' ? [] : await planStickerFile(env, fileId, id, actor);

  if (
    existing &&
    existing.name === input.name &&
    existing.alias === input.alias &&
    existing.fileId === fileId &&
    existing.minQty === (input.minQty ?? existing.minQty) &&
    sameSet(currentBuIds, requested)
  ) {
    return toStickerDto(existing, type.name, currentBuIds, total, latest, type.deletedAt !== '');
  }

  const now = nowIso(env);
  const guards: DbStatement[] = [stickerTypeGuardStmt(env.DB, type.id, type.rule, !existing)];
  if (added.length > 0) guards.push(activeBuGuardStmt(env.DB, added));
  const sortedBuIds = [...requested].sort(
    (a, b) =>
      (known.get(a)?.code ?? a).localeCompare(known.get(b)?.code ?? b) || a.localeCompare(b),
  );
  const nextBuCodes = codesOf(requested, bus);

  if (existing) {
    const updated: StickerRecord = {
      ...existing,
      name: input.name,
      alias: input.alias,
      fileId,
      minQty: input.minQty ?? existing.minQty,
      updatedAt: now,
      updatedBy: actor.email,
    };
    await batchWrite(
      env.DB,
      [
        ...guards,
        ...attach,
        updateStickerStmt(env.DB, updated, existing.updatedAt),
        ...syncStickerBusinessUnitsStmts(env.DB, id, requested, false),
        writeAudit(env.DB, {
          ts: now,
          actor: actor.email,
          action: 'sticker.update',
          target: updated.name,
          targetId: updated.id,
          before: stickerSnapshot(existing, type.name, codesOf(currentBuIds, bus)),
          after: stickerSnapshot(updated, type.name, nextBuCodes),
        }),
      ],
      STICKER_CONFLICTS,
    );
    return toStickerDto(updated, type.name, sortedBuIds, total, latest, type.deletedAt !== '');
  }

  const created: StickerRecord = {
    id,
    typeId: type.id,
    name: input.name,
    alias: input.alias,
    fileId,
    // Tak dikirim = minimum bawaan jenisnya (keputusan pemilik 2026-11-25).
    minQty: input.minQty ?? type.defaultMinQty,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
  const openingDetail = opening ? await openingBreakdown(env, opening) : '';
  try {
    await batchWrite(
      env.DB,
      [
        ...guards,
        ...attach,
        insertStickerStmt(env.DB, created),
        ...syncStickerBusinessUnitsStmts(env.DB, id, requested, true),
        // Stok awal: entri masuk "Stok awal" di batch yang sama (atomik dengan pembuatan stiker).
        ...(opening ? openingStockStmts(env.DB, id, opening, actor.email, now) : []),
        writeAudit(env.DB, {
          ts: now,
          actor: actor.email,
          action: 'sticker.create',
          target: created.name,
          targetId: created.id,
          before: null,
          after: {
            ...stickerSnapshot(created, type.name, nextBuCodes),
            ...(opening
              ? {
                  openingStock: openingTotal(opening),
                  openingStocks: openingDetail,
                }
              : {}),
          },
        }),
      ],
      STICKER_CONFLICTS,
    );
  } catch (error) {
    // Dua kiriman serentak ber-`clientId` sama: yang kalah mengulang pencarian replay (pelaku sama = hasil yang sama).
    if (opening && mayBeOpeningStockRace(error, opening)) {
      const replayed = await replayOpeningSticker(env, actor, opening);
      if (replayed) return replayed;
    }
    throw error;
  }
  return toStickerDto(created, type.name, sortedBuIds, opening ? openingTotal(opening) : 0, false);
}

/**
 * Replay stok awal untuk `stickers.save`: stiker yang dibuat kiriman pertama. Stiker terhapus atau berjenis sistem
 * (mis. stiker Postel yang lahir dari `postels.save`) dijawab `CONFLICT` generik, bukan DTO-nya.
 */
async function replayOpeningSticker(
  env: Env,
  actor: UserContext,
  opening: readonly OpeningStockInput[],
): Promise<StickerDto | null> {
  const replayId = await findOpeningStockReplay(env, actor, opening);
  if (replayId === null) return null;
  const loaded = await loadStickerAny(env, replayId);
  if (
    !loaded ||
    loaded.sticker.deletedAt !== '' ||
    loaded.type === undefined ||
    loaded.type.systemKind !== ''
  ) {
    throw appError('CONFLICT', OPENING_STOCK_TAKEN_MESSAGE);
  }
  return dtoOfLoaded(loaded);
}

export async function saveSticker(
  env: Env,
  input: SaveStickerInput,
  actor: UserContext,
): Promise<StickerDto> {
  return runCas(() => saveStickerOnce(env, input, actor), STICKER_STALE_MESSAGE);
}

// ---------------------------------------------------------------------------------------------------------------
// Status, hapus, dan pulihkan: perencana per record (pola `core/record-batch.ts`; contoh `item/service.ts`)
// ---------------------------------------------------------------------------------------------------------------

const STICKER_BATCH = { conflicts: STICKER_CONFLICTS, stale: STICKER_STALE_MESSAGE };
const TYPE_BATCH = { conflicts: TYPE_CONFLICTS, stale: TYPE_STALE_MESSAGE };
const STICKER_NOT_FOUND = 'Stiker tidak ditemukan';

const STICKER_NOT_INACTIVE_MESSAGE = 'Nonaktifkan stiker dulu sebelum dihapus';
const TYPE_NOT_INACTIVE_MESSAGE = 'Nonaktifkan jenis stiker dulu sebelum dihapus';
const SYSTEM_STICKER_REMOVE_MESSAGE =
  'Stiker Manual Book dan Postel mengikuti konfigurasinya, jadi tidak bisa dihapus di sini';
const SYSTEM_STICKER_RESTORE_MESSAGE =
  'Stiker Manual Book dan Postel mengikuti konfigurasinya, jadi tidak bisa dipulihkan di sini';
const SYSTEM_TYPE_STATUS_MESSAGE = 'Jenis stiker sistem tidak bisa diubah statusnya atau dihapus';
const STICKER_RESTORE_COLLISION_MESSAGE =
  'Stiker tidak dapat dipulihkan: namanya kini dipakai stiker lain pada jenis ini';
const TYPE_RESTORE_COLLISION_MESSAGE =
  'Jenis stiker tidak dapat dipulihkan: namanya kini dipakai jenis lain';

/** Stiker (hidup atau terhapus) yang sudah dimuat untuk satu aksi, lengkap dengan bahan DTO-nya. */
export interface LoadedSticker {
  sticker: StickerRecord;
  type: StickerTypeRecord | undefined;
  buIds: string[];
  total: number;
  latest: boolean;
  sources: StickerSourceLinks;
}

/** Stiker menurut id beserta jenis, BU, total stok, dan penanda versi terbaru; `null` bila id tak dikenal. */
async function loadStickerAny(env: Env, id: string): Promise<LoadedSticker | null> {
  const first = await env.DB.batch([stickerByIdStatement(env.DB, id)]);
  const sticker = stickersFromResult(first[0] ?? { results: [] })[0];
  if (!sticker) return null;
  const related = await env.DB.batch([
    stickerTypeByIdStatement(env.DB, sticker.typeId),
    stickerBusinessUnitsOfStatement(env.DB, sticker.id),
    stockTotalOfStatement(env.DB, sticker.id),
    stickerSourceLinksOfStatement(env.DB, sticker.id),
  ]);
  const type = stickerTypesFromResult(related[0] ?? { results: [] })[0];
  return {
    sticker,
    type,
    buIds: stickerBusinessUnitsFromResult(related[1] ?? { results: [] }).get(sticker.id) ?? [],
    total: stockTotalsFromResult(related[2] ?? { results: [] }).get(sticker.id) ?? 0,
    latest: await latestFlagOf(env, sticker.id, type),
    sources: stickerSourceLinksFromResult(related[3] ?? { results: [] }).get(sticker.id) ?? {},
  };
}

/** Pemuat perencana: harus ada (`NOT_FOUND`); `live` menolak stiker terhapus (`NOT_FOUND`), `any` menerima keduanya. */
async function loadStickerForAction(
  env: Env,
  id: string,
  state: 'live' | 'any',
): Promise<LoadedSticker> {
  const found = await loadStickerAny(env, id);
  if (!found || (state === 'live' && found.sticker.deletedAt !== '')) {
    throw appError('NOT_FOUND', STICKER_NOT_FOUND);
  }
  return found;
}

function dtoOfLoaded(loaded: LoadedSticker, record: StickerRecord = loaded.sticker): StickerDto {
  return toStickerDto(
    record,
    loaded.type?.name ?? '',
    loaded.buIds,
    loaded.total,
    loaded.latest,
    loaded.type !== undefined && loaded.type.deletedAt !== '',
    loaded.sources,
  );
}

/** Satu stiker menurut id. Stiker terhapus hanya bagi `sticker: manage`; selain itu `NOT_FOUND`. */
export async function getStickerDto(
  env: Env,
  input: GetStickerInput,
  user: UserContext,
): Promise<StickerDto> {
  return dtoOfLoaded(await readableSticker(env, input.id, user));
}

/** Stiker menurut id bagi pembaca: terhapus hanya untuk `sticker: manage`, selain itu (dan id tak dikenal) `NOT_FOUND`. */
async function readableSticker(env: Env, id: string, user: UserContext): Promise<LoadedSticker> {
  const found = await loadStickerAny(env, id);
  if (!found || (found.sticker.deletedAt !== '' && !canSeeDeleted(user))) {
    throw appError('NOT_FOUND', STICKER_NOT_FOUND);
  }
  return found;
}

/** Gerbang baca untuk `activity.list`: aturan yang sama dengan `stickers.get`. */
export async function assertStickerReadable(
  env: Env,
  id: string,
  user: UserContext,
): Promise<void> {
  await readableSticker(env, id, user);
}

/** Kode BU terurut untuk audit; BU dibaca sekali per permintaan batch (kode BU praktis tak berubah di tengahnya). */
const busOf = (env: Env) => {
  let cached: Promise<BrandBuBrief[]> | undefined;
  return () => {
    cached ??= listBuBriefs(env.DB);
    return cached;
  };
};

/**
 * Perencana ubah status (stiker HIDUP). Status sama = `unchanged`. Aturan yang ada dipertahankan: `deprecated` tak dapat
 * diaktifkan kembali, stiker Postel hanya bila catatannya masih ada (hidup), stiker Manual Book hanya bila masih versi
 * terbaru (dijaga lagi di batch, SESUDAH `UPDATE`: lihat komentar penjaga). Penjaga versi menggagalkan batch bila
 * stiker berubah (atau terhapus) sejak dibaca.
 */
export async function planStickerStatus(
  env: Env,
  loaded: LoadedSticker,
  status: 'active' | 'inactive',
  actor: ActorRef,
  allBus: () => Promise<BrandBuBrief[]> = busOf(env),
): Promise<PlanOutcome<StickerDto>> {
  const { sticker, type, buIds, latest } = loaded;
  if (sticker.status === status) return { unchanged: dtoOfLoaded(loaded) };
  // Stiker yang sudah digantikan versi baru (`deprecated`) hanya dapat menjadi nonaktif, tidak diaktifkan kembali.
  if (sticker.status === 'deprecated' && status === 'active') {
    throw appError('VALIDATION', DEPRECATED_ACTIVATE_MESSAGE, {
      status: DEPRECATED_ACTIVATE_MESSAGE,
    });
  }
  // Stiker Postel milik catatan yang sudah dihapus tak berguna lagi: tidak dapat diaktifkan kembali.
  if (status === 'active' && type !== undefined && type.systemKind === 'postel') {
    const tied = await env.DB.prepare(
      `SELECT 1 AS tied FROM postels WHERE sticker_id = ? AND ${liveWhere()} LIMIT 1`,
    )
      .bind(sticker.id)
      .first<{ tied: number }>();
    if (!tied) {
      throw appError('VALIDATION', POSTEL_GONE_MESSAGE, { status: POSTEL_GONE_MESSAGE });
    }
  }
  // Stiker Manual Book milik konfigurasi yang dihapus lunak tidak dapat diaktifkan kembali selama konfigurasinya di
  // Terhapus (memulihkan konfigurasi mengembalikan stiker versi terbarunya menjadi `inactive`).
  if (status === 'active' && type !== undefined && type.systemKind === 'manual_book') {
    const state = await env.DB.prepare(
      `SELECT EXISTS (SELECT 1 FROM manual_book_versions mv WHERE mv.sticker_id = ?) AND NOT EXISTS (SELECT 1 FROM manual_book_versions mv JOIN qr_designs d ON d.id = mv.design_id AND ${liveWhere('d')} WHERE mv.sticker_id = ?) AS gone`,
    )
      .bind(sticker.id, sticker.id)
      .first<{ gone: number | string }>();
    if (Number(state?.gone) === 1) {
      throw appError('VALIDATION', MANUAL_BOOK_GONE_MESSAGE, { status: MANUAL_BOOK_GONE_MESSAGE });
    }
  }
  // Stiker Manual Book hanya boleh diaktifkan bila masih versi terbaru konfigurasinya.
  const guardLatest =
    status === 'active' && type !== undefined && type.systemKind === 'manual_book';
  if (guardLatest && !latest) {
    throw appError('VALIDATION', NOT_LATEST_MESSAGE, { status: NOT_LATEST_MESSAGE });
  }
  const now = nowIso(env);
  const updated: StickerRecord = { ...sticker, status, updatedAt: now, updatedBy: actor.email };
  const typeName = type?.name ?? '';
  const bus = await allBus();
  return {
    dto: dtoOfLoaded(loaded, updated),
    stmts: [
      versionGuardStmt(env.DB, 'stickers', sticker.id, sticker.updatedAt, 'live'),
      setStickerStatusStmt(env.DB, updated, sticker.updatedAt),
      // Penjaga versi terbaru SESUDAH `UPDATE`: UPDATE menunggu kunci baris stiker (komit ekspor mengunci baris versi
      // terbaru lebih dulu), dan pembacaan konsisten pertama di transaksi ini baru terjadi sesudah kunci didapat,
      // sehingga penjaga melihat versi yang baru saja dikomit ekspor serentak. Penjaga di depan akan membaca snapshot
      // lama dan meloloskan dua stiker `active` sekaligus. `latest` di atas hanya pemeriksaan awal (pesan yang jelas).
      ...(guardLatest ? [latestManualBookVersionGuardStmt(env.DB, sticker.id)] : []),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'sticker.status',
        target: updated.name,
        targetId: updated.id,
        before: stickerSnapshot(sticker, typeName, codesOf(buIds, bus)),
        after: stickerSnapshot(updated, typeName, codesOf(buIds, bus)),
      }),
    ],
  };
}

/**
 * Perencana hapus lunak: hanya stiker bukan Aktif (`inactive` atau `deprecated`); stiker jenis sistem (Manual Book,
 * Postel) mengikuti konfigurasinya dan ditolak di sini. Sudah terhapus = `unchanged` (tanpa audit; `deleted_at` asli
 * utuh). Stok dan tautan BU dibiarkan (ikut kembali saat dipulihkan); penempatan di item tetap sebagai rujukan tersimpan.
 */
export async function planStickerRemove(
  env: Env,
  loaded: LoadedSticker,
  actor: ActorRef,
  allBus: () => Promise<BrandBuBrief[]> = busOf(env),
): Promise<PlanOutcome<RemoveResult>> {
  const { sticker, type, buIds } = loaded;
  if (sticker.deletedAt !== '') return { unchanged: { id: sticker.id } };
  if (type !== undefined && type.systemKind !== '') {
    throw appError('VALIDATION', SYSTEM_STICKER_REMOVE_MESSAGE);
  }
  if (sticker.status === 'active') throw appError('CONFLICT', STICKER_NOT_INACTIVE_MESSAGE);
  const now = nowIso(env);
  const typeName = type?.name ?? '';
  const bus = await allBus();
  const before = stickerSnapshot(sticker, typeName, codesOf(buIds, bus));
  return {
    dto: { id: sticker.id },
    stmts: [
      versionGuardStmt(env.DB, 'stickers', sticker.id, sticker.updatedAt, 'live'),
      softDeleteStmt(env.DB, 'stickers', sticker.id, actor.email, now),
      stampStmt(env.DB, 'stickers', sticker.id, now, actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'sticker.delete',
        target: sticker.name,
        targetId: sticker.id,
        before,
        after: { ...before, deleted: true },
      }),
    ],
  };
}

/**
 * Perencana pulihkan: kembali `inactive`; belum terhapus = `unchanged`. Stiker jenis sistem dipulihkan lewat induknya
 * (konfigurasi QR atau catatan Postel), bukan di sini. Nama yang kini dipakai stiker HIDUP lain pada jenis yang sama
 * ditolak generik (`CONFLICT`); indeks unik `_live` tetap pagar bila ada balapan. Jenis yang terhapus tidak
 * menghalangi (stiker kembali dan tetap bertanda jenis terhapus).
 */
export async function planStickerRestore(
  env: Env,
  loaded: LoadedSticker,
  actor: ActorRef,
  allBus: () => Promise<BrandBuBrief[]> = busOf(env),
): Promise<PlanOutcome<StickerDto>> {
  const { sticker, type, buIds } = loaded;
  if (sticker.deletedAt === '') return { unchanged: dtoOfLoaded(loaded) };
  if (type !== undefined && type.systemKind !== '') {
    throw appError('VALIDATION', SYSTEM_STICKER_RESTORE_MESSAGE);
  }
  const clash = await env.DB.prepare(
    `SELECT 1 AS hit FROM stickers WHERE type_id = ? AND LOWER(name) = LOWER(?) AND id <> ? AND ${liveWhere()} LIMIT 1`,
  )
    .bind(sticker.typeId, sticker.name, sticker.id)
    .first();
  if (clash) throw appError('CONFLICT', STICKER_RESTORE_COLLISION_MESSAGE);
  const now = nowIso(env);
  const restored: StickerRecord = {
    ...sticker,
    status: 'inactive',
    updatedAt: now,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
  const typeName = type?.name ?? '';
  const bus = await allBus();
  return {
    dto: dtoOfLoaded(loaded, restored),
    stmts: [
      versionGuardStmt(env.DB, 'stickers', sticker.id, sticker.updatedAt, 'deleted'),
      restoreStmt(env.DB, 'stickers', sticker.id),
      env.DB.prepare("UPDATE stickers SET status = 'inactive' WHERE id = ?").bind(sticker.id),
      stampStmt(env.DB, 'stickers', sticker.id, now, actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'sticker.restore',
        target: sticker.name,
        targetId: sticker.id,
        before: {
          ...stickerSnapshot(sticker, typeName, codesOf(buIds, bus)),
          deleted: true,
        },
        after: stickerSnapshot(restored, typeName, codesOf(buIds, bus)),
      }),
    ],
  };
}

/**
 * Pemeriksaan silang pulihkan batch: tiap perencana hanya mencocokkan nama dengan stiker HIDUP di basis data, jadi dua
 * stiker terhapus berjenis dan bernama sama (dihapus pada waktu berbeda) yang dipulihkan SEKALIGUS lolos masing-masing.
 */
function verifyRestoredStickerNames(changed: StickerDto[]): void {
  const owner = new Set<string>();
  for (const dto of changed) {
    const key = JSON.stringify([dto.typeId, dto.name.toLowerCase()]);
    if (owner.has(key)) throw appError('CONFLICT', STICKER_RESTORE_COLLISION_MESSAGE);
    owner.add(key);
  }
}

const stickerStatusPlanner = (env: Env, status: 'active' | 'inactive', actor: ActorRef) => {
  const allBus = busOf(env);
  return async (id: string): Promise<PlanOutcome<StickerDto>> =>
    planStickerStatus(env, await loadStickerForAction(env, id, 'live'), status, actor, allBus);
};

const stickerRemovePlanner = (env: Env, actor: ActorRef) => {
  const allBus = busOf(env);
  return async (id: string): Promise<PlanOutcome<RemoveResult>> =>
    planStickerRemove(env, await loadStickerForAction(env, id, 'any'), actor, allBus);
};

const stickerRestorePlanner = (env: Env, actor: ActorRef) => {
  const allBus = busOf(env);
  return async (id: string): Promise<PlanOutcome<StickerDto>> =>
    planStickerRestore(env, await loadStickerForAction(env, id, 'any'), actor, allBus);
};

const RESTORE_STICKER_BATCH = { ...STICKER_BATCH, verify: verifyRestoredStickerNames };

/** Ubah status satu stiker (rute tunggal = batch berisi satu id). */
export function setStickerStatus(
  env: Env,
  input: SetStickerStatusInput,
  actor: ActorRef,
): Promise<StickerDto> {
  return runSingleRecord(
    env,
    input.id,
    stickerStatusPlanner(env, input.status, actor),
    STICKER_BATCH,
  );
}

/** Ubah status banyak stiker, atomik: satu gagal = tidak ada yang berubah. */
export function setStickerStatusBatch(
  env: Env,
  input: StatusBatchInput,
  actor: ActorRef,
): Promise<BatchResult<StickerDto>> {
  return runRecordBatch(
    env,
    input.ids,
    stickerStatusPlanner(env, input.status, actor),
    STICKER_BATCH,
  );
}

export function removeSticker(
  env: Env,
  input: GetStickerInput,
  actor: ActorRef,
): Promise<RemoveResult> {
  return runSingleRecord(env, input.id, stickerRemovePlanner(env, actor), STICKER_BATCH);
}

export async function removeStickerBatch(
  env: Env,
  input: IdBatchInput,
  actor: ActorRef,
): Promise<RemoveBatchResult> {
  const { items } = await runRecordBatch(
    env,
    input.ids,
    stickerRemovePlanner(env, actor),
    STICKER_BATCH,
  );
  return { ids: items.map((item) => item.id) };
}

export function restoreSticker(
  env: Env,
  input: GetStickerInput,
  actor: ActorRef,
): Promise<StickerDto> {
  return runSingleRecord(env, input.id, stickerRestorePlanner(env, actor), RESTORE_STICKER_BATCH);
}

export function restoreStickerBatch(
  env: Env,
  input: IdBatchInput,
  actor: ActorRef,
): Promise<BatchResult<StickerDto>> {
  return runRecordBatch(env, input.ids, stickerRestorePlanner(env, actor), RESTORE_STICKER_BATCH);
}

// --- Jenis ---------------------------------------------------------------------------------------------------------

/** Jenis menurut id yang harus ada (`NOT_FOUND`); `live` menolak jenis terhapus, `any` menerima keduanya. */
async function loadStickerTypeForAction(
  env: Env,
  id: string,
  state: 'live' | 'any',
): Promise<StickerTypeRecord> {
  const found = await loadStickerTypeAny(env, id);
  if (!found || (state === 'live' && found.deletedAt !== '')) {
    throw appError('NOT_FOUND', TYPE_NOT_FOUND);
  }
  return found;
}

/**
 * Perencana ubah status jenis (jenis HIDUP). Jenis sistem selalu aktif dan tak dapat diubah statusnya (ditolak juga
 * untuk status yang sama, satu aturan tanpa cabang). Status sama = `unchanged`. Penjaga versi (`FOR UPDATE`) juga
 * menahan penyisipan stiker serentak yang mengambil kunci bersama baris jenis.
 */
export function planStickerTypeStatus(
  env: Env,
  type: StickerTypeRecord,
  status: 'active' | 'inactive',
  actor: ActorRef,
): PlanOutcome<StickerTypeDto> {
  if (type.systemKind !== '') {
    throw appError('VALIDATION', SYSTEM_TYPE_STATUS_MESSAGE);
  }
  if (type.status === status) return { unchanged: toStickerTypeDto(type) };
  const now = nowIso(env);
  const updated: StickerTypeRecord = { ...type, status, updatedAt: now, updatedBy: actor.email };
  return {
    dto: toStickerTypeDto(updated),
    stmts: [
      versionGuardStmt(env.DB, 'sticker_types', type.id, type.updatedAt, 'live'),
      setStickerTypeStatusStmt(env.DB, updated),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'stickerType.status',
        target: updated.name,
        targetId: updated.id,
        before: { status: type.status },
        after: { status: updated.status },
      }),
    ],
  };
}

/**
 * Perencana hapus lunak jenis: hanya jenis Nonaktif dan bukan jenis sistem; sudah terhapus = `unchanged`. Stiker pada
 * jenis ini tetap ada (tampil dengan `typeDeleted`).
 */
export function planStickerTypeRemove(
  env: Env,
  type: StickerTypeRecord,
  actor: ActorRef,
): PlanOutcome<RemoveResult> {
  if (type.deletedAt !== '') return { unchanged: { id: type.id } };
  if (type.systemKind !== '') throw appError('VALIDATION', SYSTEM_TYPE_STATUS_MESSAGE);
  if (type.status !== 'inactive') throw appError('CONFLICT', TYPE_NOT_INACTIVE_MESSAGE);
  const now = nowIso(env);
  return {
    dto: { id: type.id },
    stmts: [
      versionGuardStmt(env.DB, 'sticker_types', type.id, type.updatedAt, 'live'),
      softDeleteStmt(env.DB, 'sticker_types', type.id, actor.email, now),
      stampStmt(env.DB, 'sticker_types', type.id, now, actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'stickerType.delete',
        target: type.name,
        targetId: type.id,
        before: stickerTypeSnapshot(type),
        after: { ...stickerTypeSnapshot(type), deleted: true },
      }),
    ],
  };
}

/**
 * Perencana pulihkan jenis: kembali Nonaktif; belum terhapus = `unchanged`. Nama yang kini dipakai jenis HIDUP lain
 * ditolak generik (`CONFLICT`); indeks unik `_live` tetap pagar bila ada balapan.
 */
export async function planStickerTypeRestore(
  env: Env,
  type: StickerTypeRecord,
  actor: ActorRef,
): Promise<PlanOutcome<StickerTypeDto>> {
  if (type.deletedAt === '') return { unchanged: toStickerTypeDto(type) };
  const clash = await env.DB.prepare(
    `SELECT 1 AS hit FROM sticker_types WHERE LOWER(name) = LOWER(?) AND id <> ? AND ${liveWhere()} LIMIT 1`,
  )
    .bind(type.name, type.id)
    .first();
  if (clash) throw appError('CONFLICT', TYPE_RESTORE_COLLISION_MESSAGE);
  const now = nowIso(env);
  const restored: StickerTypeRecord = {
    ...type,
    status: 'inactive',
    updatedAt: now,
    updatedBy: actor.email,
    deletedAt: '',
    deletedBy: '',
  };
  return {
    dto: toStickerTypeDto(restored),
    stmts: [
      versionGuardStmt(env.DB, 'sticker_types', type.id, type.updatedAt, 'deleted'),
      restoreStmt(env.DB, 'sticker_types', type.id),
      env.DB.prepare("UPDATE sticker_types SET status = 'inactive' WHERE id = ?").bind(type.id),
      stampStmt(env.DB, 'sticker_types', type.id, now, actor.email),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'stickerType.restore',
        target: type.name,
        targetId: type.id,
        before: { ...stickerTypeSnapshot(type), deleted: true },
        after: stickerTypeSnapshot(restored),
      }),
    ],
  };
}

/** Pemeriksaan silang pulihkan batch: dua jenis terhapus bernama sama yang dipulihkan SEKALIGUS bentrok. */
function verifyRestoredTypeNames(changed: StickerTypeDto[]): void {
  const owner = new Set<string>();
  for (const dto of changed) {
    const key = dto.name.toLowerCase();
    if (owner.has(key)) throw appError('CONFLICT', TYPE_RESTORE_COLLISION_MESSAGE);
    owner.add(key);
  }
}

const typeStatusPlanner =
  (env: Env, status: 'active' | 'inactive', actor: ActorRef) =>
  async (id: string): Promise<PlanOutcome<StickerTypeDto>> =>
    planStickerTypeStatus(env, await loadStickerTypeForAction(env, id, 'live'), status, actor);

const typeRemovePlanner =
  (env: Env, actor: ActorRef) =>
  async (id: string): Promise<PlanOutcome<RemoveResult>> =>
    planStickerTypeRemove(env, await loadStickerTypeForAction(env, id, 'any'), actor);

const typeRestorePlanner =
  (env: Env, actor: ActorRef) =>
  async (id: string): Promise<PlanOutcome<StickerTypeDto>> =>
    planStickerTypeRestore(env, await loadStickerTypeForAction(env, id, 'any'), actor);

const RESTORE_TYPE_BATCH = { ...TYPE_BATCH, verify: verifyRestoredTypeNames };

/** Ubah status satu jenis (rute tunggal = batch berisi satu id). */
export function setStickerTypeStatus(
  env: Env,
  input: SetStickerTypeStatusInput,
  actor: ActorRef,
): Promise<StickerTypeDto> {
  return runSingleRecord(env, input.id, typeStatusPlanner(env, input.status, actor), TYPE_BATCH);
}

export function setStickerTypeStatusBatch(
  env: Env,
  input: StatusBatchInput,
  actor: ActorRef,
): Promise<BatchResult<StickerTypeDto>> {
  return runRecordBatch(env, input.ids, typeStatusPlanner(env, input.status, actor), TYPE_BATCH);
}

export function removeStickerType(
  env: Env,
  input: GetStickerTypeInput,
  actor: ActorRef,
): Promise<RemoveResult> {
  return runSingleRecord(env, input.id, typeRemovePlanner(env, actor), TYPE_BATCH);
}

export async function removeStickerTypeBatch(
  env: Env,
  input: IdBatchInput,
  actor: ActorRef,
): Promise<RemoveBatchResult> {
  const { items } = await runRecordBatch(env, input.ids, typeRemovePlanner(env, actor), TYPE_BATCH);
  return { ids: items.map((item) => item.id) };
}

export function restoreStickerType(
  env: Env,
  input: GetStickerTypeInput,
  actor: ActorRef,
): Promise<StickerTypeDto> {
  return runSingleRecord(env, input.id, typeRestorePlanner(env, actor), RESTORE_TYPE_BATCH);
}

export function restoreStickerTypeBatch(
  env: Env,
  input: IdBatchInput,
  actor: ActorRef,
): Promise<BatchResult<StickerTypeDto>> {
  return runRecordBatch(env, input.ids, typeRestorePlanner(env, actor), RESTORE_TYPE_BATCH);
}
