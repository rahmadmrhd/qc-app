import { writeAudit } from '@server/core/audit';
import { runCas } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { DbStatement } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import type { AppError } from '@server/core/errors';
import { appError, staleError } from '@server/core/errors';
import { batchWrite, mapDuplicateError } from '@server/modules/access/repo';
import type { BrandBuBrief } from '@server/modules/brand/repo';
import { activeBuGuardStmt, listBuBriefs } from '@server/modules/brand/repo';
import { planAttachFiles } from '@server/modules/files/service';
import type {
  SaveStickerInput,
  SaveStickerTypeInput,
  SetStickerStatusInput,
  SetStickerTypeStatusInput,
  StickerDto,
  StickerTypeDto,
} from '@shared/contract';
import { isLowStock } from '@shared/stickers';
import type { StickerRecord, StickerTypeRecord } from './repo';
import {
  insertStickerStmt,
  insertStickerTypeStmt,
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

const NAME_TAKEN_MESSAGE = 'Nama jenis sudah dipakai';
const TYPE_STALE_MESSAGE =
  'Jenis stiker diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';
const RULE_LOCKED_MESSAGE = 'Aturan jenis tidak dapat diubah karena sudah ada stiker';

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
    stickerCount: type.stickerCount,
    updatedAt: type.updatedAt,
  };
}

export function stickerTypeSnapshot(type: StickerTypeRecord): Record<string, unknown> {
  return { name: type.name, rule: type.rule, status: type.status };
}

export async function listStickerTypes(env: Env): Promise<StickerTypeDto[]> {
  return (await listStickerTypeRecords(env.DB))
    .map(toStickerTypeDto)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function createStickerType(
  env: Env,
  input: SaveStickerTypeInput,
  actor: ActorRef,
): Promise<StickerTypeDto> {
  const now = nowIso(env);
  const created: StickerTypeRecord = {
    id: crypto.randomUUID(),
    name: input.name,
    rule: input.rule,
    status: 'active',
    stickerCount: 0,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
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
  actor: ActorRef,
): Promise<StickerTypeDto> {
  return env.DB.transaction(async (tx) => {
    const existing = await lockStickerType(tx, id);
    if (!existing) throw appError('NOT_FOUND', 'Jenis stiker tidak ditemukan');
    // Versi yang dilihat penyimpan harus masih terkini; baris terkunci (`FOR UPDATE`) sehingga pembacaan ini pasti.
    if (input.expectedUpdatedAt !== existing.updatedAt) throw staleError(TYPE_STALE_MESSAGE);
    if (existing.name === input.name && existing.rule === input.rule) {
      return toStickerTypeDto(existing);
    }
    if (existing.rule !== input.rule && existing.stickerCount > 0) {
      throw appError('VALIDATION', RULE_LOCKED_MESSAGE, { rule: RULE_LOCKED_MESSAGE });
    }
    const now = nowIso(env);
    const updated: StickerTypeRecord = {
      ...existing,
      name: input.name,
      rule: input.rule,
      updatedAt: now,
      updatedBy: actor.email,
    };
    await updateStickerTypeStmt(tx, updated).run();
    await writeAudit(tx, {
      ts: now,
      actor: actor.email,
      action: 'stickerType.update',
      target: updated.name,
      before: stickerTypeSnapshot(existing),
      after: stickerTypeSnapshot(updated),
    }).run();
    return toStickerTypeDto(updated);
  });
}

export async function saveStickerType(
  env: Env,
  input: SaveStickerTypeInput,
  actor: ActorRef,
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

const STICKER_NAME_TAKEN_MESSAGE = 'Nama stiker sudah dipakai pada jenis ini';
const STICKER_STALE_MESSAGE =
  'Stiker diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';
const INACTIVE_BU_MESSAGE = 'BU tidak dikenal atau tidak aktif';

const STICKER_CONFLICTS = {
  stickers_type_name_unique: { field: 'name', message: STICKER_NAME_TAKEN_MESSAGE },
};

function toStickerDto(
  sticker: StickerRecord,
  typeName: string,
  businessUnitIds: readonly string[],
  total: number,
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
    updatedAt: sticker.updatedAt,
  };
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

/** Daftar stiker: SATU `batch()` (stiker, jenis, BU, dan total stok per stiker lewat satu kueri agregat). */
export async function listStickers(env: Env): Promise<StickerDto[]> {
  const [stickerResult, typeResult, buResult, totalResult] = await env.DB.batch([
    stickersStatement(env.DB),
    stickerTypesStatement(env.DB),
    stickerBusinessUnitsStatement(env.DB),
    stockTotalsStatement(env.DB),
  ]);
  const typeNames = new Map(
    stickerTypesFromResult(typeResult ?? { results: [] }).map((type) => [type.id, type.name]),
  );
  const bus = stickerBusinessUnitsFromResult(buResult ?? { results: [] });
  const totals = stockTotalsFromResult(totalResult ?? { results: [] });
  return stickersFromResult(stickerResult ?? { results: [] })
    .map((sticker) =>
      toStickerDto(
        sticker,
        typeNames.get(sticker.typeId) ?? '',
        bus.get(sticker.id) ?? [],
        totals.get(sticker.id) ?? 0,
      ),
    )
    .sort((a, b) => a.typeName.localeCompare(b.typeName) || a.name.localeCompare(b.name));
}

/** Rujukan berkas tak sah dilaporkan di field `fileId` (pesan dari `planAttachFiles`). */
async function planStickerFile(
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
  actor: ActorRef,
): Promise<StickerDto> {
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

  const requested = input.businessUnitIds;
  if (type.rule === 'none' && requested.length > 0) {
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
  const id = existing?.id ?? crypto.randomUUID();
  const attach = fileId === '' ? [] : await planStickerFile(env, fileId, id, actor);

  if (
    existing &&
    existing.name === input.name &&
    existing.alias === input.alias &&
    existing.fileId === fileId &&
    existing.minQty === input.minQty &&
    sameSet(currentBuIds, requested)
  ) {
    return toStickerDto(existing, type.name, currentBuIds, total);
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
      minQty: input.minQty,
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
          before: stickerSnapshot(existing, type.name, codesOf(currentBuIds, bus)),
          after: stickerSnapshot(updated, type.name, nextBuCodes),
        }),
      ],
      STICKER_CONFLICTS,
    );
    return toStickerDto(updated, type.name, sortedBuIds, total);
  }

  const created: StickerRecord = {
    id,
    typeId: type.id,
    name: input.name,
    alias: input.alias,
    fileId,
    minQty: input.minQty,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
  };
  await batchWrite(
    env.DB,
    [
      ...guards,
      ...attach,
      insertStickerStmt(env.DB, created),
      ...syncStickerBusinessUnitsStmts(env.DB, id, requested, true),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'sticker.create',
        target: created.name,
        before: null,
        after: stickerSnapshot(created, type.name, nextBuCodes),
      }),
    ],
    STICKER_CONFLICTS,
  );
  return toStickerDto(created, type.name, sortedBuIds, 0);
}

export async function saveSticker(
  env: Env,
  input: SaveStickerInput,
  actor: ActorRef,
): Promise<StickerDto> {
  return runCas(() => saveStickerOnce(env, input, actor), STICKER_STALE_MESSAGE);
}

async function setStickerStatusOnce(
  env: Env,
  input: SetStickerStatusInput,
  actor: ActorRef,
): Promise<StickerDto> {
  const sticker = stickersFromResult(
    (await env.DB.batch([stickerByIdStatement(env.DB, input.id)]))[0] ?? { results: [] },
  )[0];
  if (!sticker) throw appError('NOT_FOUND', 'Stiker tidak ditemukan');
  const related = await env.DB.batch([
    stickerTypeByIdStatement(env.DB, sticker.typeId),
    stickerBusinessUnitsOfStatement(env.DB, sticker.id),
    stockTotalOfStatement(env.DB, sticker.id),
  ]);
  const allBus = await listBuBriefs(env.DB);
  const type = stickerTypesFromResult(related[0] ?? { results: [] })[0];
  const buIds = stickerBusinessUnitsFromResult(related[1] ?? { results: [] }).get(sticker.id) ?? [];
  const total = stockTotalsFromResult(related[2] ?? { results: [] }).get(sticker.id) ?? 0;
  const typeName = type?.name ?? '';
  if (sticker.status === input.status) return toStickerDto(sticker, typeName, buIds, total);
  const now = nowIso(env);
  const updated: StickerRecord = {
    ...sticker,
    status: input.status,
    updatedAt: now,
    updatedBy: actor.email,
  };
  await env.DB.batch([
    setStickerStatusStmt(env.DB, updated, sticker.updatedAt),
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: 'sticker.status',
      target: updated.name,
      before: stickerSnapshot(sticker, typeName, codesOf(buIds, allBus)),
      after: stickerSnapshot(updated, typeName, codesOf(buIds, allBus)),
    }),
  ]);
  return toStickerDto(updated, typeName, buIds, total);
}

export async function setStickerStatus(
  env: Env,
  input: SetStickerStatusInput,
  actor: ActorRef,
): Promise<StickerDto> {
  return runCas(() => setStickerStatusOnce(env, input, actor), STICKER_STALE_MESSAGE);
}

export async function setStickerTypeStatus(
  env: Env,
  input: SetStickerTypeStatusInput,
  actor: ActorRef,
): Promise<StickerTypeDto> {
  return env.DB.transaction(async (tx) => {
    const existing = await lockStickerType(tx, input.id);
    if (!existing) throw appError('NOT_FOUND', 'Jenis stiker tidak ditemukan');
    if (existing.status === input.status) return toStickerTypeDto(existing);
    const now = nowIso(env);
    const updated: StickerTypeRecord = {
      ...existing,
      status: input.status,
      updatedAt: now,
      updatedBy: actor.email,
    };
    await setStickerTypeStatusStmt(tx, updated).run();
    await writeAudit(tx, {
      ts: now,
      actor: actor.email,
      action: 'stickerType.status',
      target: updated.name,
      before: { status: existing.status },
      after: { status: updated.status },
    }).run();
    return toStickerTypeDto(updated);
  });
}
