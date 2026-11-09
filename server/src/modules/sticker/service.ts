import { writeAudit } from '@server/core/audit';
import type { ActorRef } from '@server/core/context';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { batchWrite, mapDuplicateError } from '@server/modules/access/repo';
import type {
  SaveStickerTypeInput,
  SetStickerTypeStatusInput,
  StickerTypeDto,
} from '@shared/contract';
import type { StickerTypeRecord } from './repo';
import {
  insertStickerTypeStmt,
  listStickerTypeRecords,
  lockStickerType,
  setStickerTypeStatusStmt,
  updateStickerTypeStmt,
} from './repo';

const NAME_TAKEN_MESSAGE = 'Nama jenis sudah dipakai';
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
