import { writeAudit } from '@server/core/audit';
import type { ActorRef } from '@server/core/context';
import { DbError, type DbTx } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import { newId } from '@server/core/id';
import { readObject } from '@server/core/validate';
import { mapDuplicateError } from '@server/modules/access/repo';
import type {
  ClFirmwareDto,
  ClFirmwareOptionDto,
  ListClFirmwareOptionsInput,
  RemoveClFirmwareInput,
  SaveClFirmwareInput,
} from '@shared/contract';
import { CL_PATH_MAX, FIRMWARE_CODE_MAX } from '@shared/countrylock-bundle';
import {
  CL_CONFLICTS,
  type ClFirmwareRecord,
  countItemsUsingFirmware,
  firmwareRows,
  firmwareUseCounts,
  getFileByPath,
  getFirmwareById,
} from './repo';

const BRANDS = ['mikrotik', 'ubiquiti'] as const;
const LABEL_MAX = 120;
const MAX_ID_LENGTH = 100;
const SORT_MAX = 1_000_000_000;
const STALE_MESSAGE = 'Firmware sudah diubah orang lain. Muat ulang lalu coba lagi.';
const NOT_FOUND_MESSAGE = 'Firmware tidak ditemukan';
const IN_USE_MESSAGE = 'Firmware masih dipakai item';

// --- Validasi ----------------------------------------------------------------------------------------------------

function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function validateListFirmwareOptions(raw: unknown): ListClFirmwareOptionsInput {
  const reader = readObject(raw);
  const brand = reader.oneOf('brand', BRANDS);
  reader.done();
  return { brand };
}

export function validateRemoveClFirmware(raw: unknown): RemoveClFirmwareInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: MAX_ID_LENGTH });
  reader.done();
  return { id };
}

export function validateSaveClFirmware(raw: unknown): SaveClFirmwareInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id');
  const brand = reader.oneOf('brand', BRANDS);
  const code = reader.str('code', { required: true, max: FIRMWARE_CODE_MAX });
  if (code !== '' && hasControlChars(code)) reader.fail('code', 'Kode firmware tidak valid');
  const label = reader.str('label', { required: true, max: LABEL_MAX });
  if (label !== '' && hasControlChars(label)) reader.fail('label', 'Label firmware tidak valid');
  const rawScript = reader.raw('scriptPath');
  let scriptPath: string | null = null;
  if (rawScript !== null && rawScript !== undefined) {
    if (
      typeof rawScript !== 'string' ||
      rawScript.trim() === '' ||
      rawScript.length > CL_PATH_MAX
    ) {
      reader.fail('scriptPath', 'Jalur skrip tidak valid');
    } else {
      scriptPath = rawScript;
    }
  }
  const rawParallel = reader.raw('parallel');
  if (typeof rawParallel !== 'boolean') reader.fail('parallel', 'Harus berupa ya/tidak');
  const rawSort = reader.raw('sort');
  let sort = 0;
  if (typeof rawSort !== 'number' || !Number.isInteger(rawSort) || Math.abs(rawSort) > SORT_MAX) {
    reader.fail('sort', 'Urutan harus bilangan bulat');
  } else {
    sort = rawSort;
  }
  const expectedUpdatedAt = reader.str('expectedUpdatedAt', { max: 40 });
  reader.done();
  return {
    ...(id === undefined ? {} : { id }),
    brand,
    code,
    label,
    scriptPath,
    parallel: rawParallel as boolean,
    sort,
    ...(expectedUpdatedAt === '' ? {} : { expectedUpdatedAt }),
  };
}

// --- Pembacaan ---------------------------------------------------------------------------------------------------

function toDto(record: ClFirmwareRecord, inUseCount: number): ClFirmwareDto {
  return {
    id: record.id,
    brand: record.brand,
    code: record.code,
    label: record.label,
    scriptPath: record.scriptPath,
    parallel: record.parallel,
    sort: record.sort,
    inUseCount,
    updatedAt: record.updatedAt,
  };
}

export async function listClFirmwares(env: Env): Promise<ClFirmwareDto[]> {
  const [rows, counts] = await Promise.all([firmwareRows(env.DB), firmwareUseCounts(env.DB)]);
  return rows.map((row) => toDto(row, counts.get(`${row.brand}:${row.code}`) ?? 0));
}

/** Pilihan firmware untuk form Item: hanya yang hidup pada merk itu, urut tampil (`sort`, lalu kode). */
export async function listFirmwareOptions(
  env: Env,
  input: ListClFirmwareOptionsInput,
): Promise<ClFirmwareOptionDto[]> {
  return (await firmwareRows(env.DB))
    .filter((row) => row.brand === input.brand)
    .map((row) => ({ code: row.code, label: row.label }));
}

// --- Penulisan ---------------------------------------------------------------------------------------------------

/** Kolom firmware untuk snapshot audit. */
function snapshotOf(record: ClFirmwareRecord) {
  return {
    brand: record.brand,
    code: record.code,
    label: record.label,
    scriptPath: record.scriptPath,
    parallel: record.parallel,
    sort: record.sort,
  };
}

/** Penulisan di dalam transaksi: galat duplikat indeks `cl_firmwares_code_live` dipetakan ke `CONFLICT`. */
async function writeFirmware<T>(env: Env, run: (tx: DbTx) => Promise<T>): Promise<T> {
  try {
    return await env.DB.transaction(run);
  } catch (error) {
    if (error instanceof DbError) throw mapDuplicateError(error, CL_CONFLICTS);
    throw error;
  }
}

/**
 * Menyimpan firmware (baru bila tanpa `id`). Kode unik per merk di antara firmware hidup (`CONFLICT`); `scriptPath`
 * harus berkas HIDUP berperan `script`; mengganti kode atau merk firmware yang dipakai item = `CONFLICT`. Pembaruan
 * mengunci baris firmware (`FOR UPDATE`) sebelum menghitung item pemakai, sehingga `items.save` yang serentak (yang
 * dijaga `firmwareKeyGuardStmt`) tak dapat menyelip di antara hitungan dan penulisan.
 */
export async function saveClFirmware(
  env: Env,
  input: SaveClFirmwareInput,
  actor: ActorRef,
): Promise<ClFirmwareDto> {
  return writeFirmware(env, async (tx) => {
    if (input.scriptPath !== null) {
      const script = await getFileByPath(tx, input.scriptPath);
      if (script === null || script.path !== input.scriptPath || script.role !== 'script') {
        const message = 'Berkas skrip tidak ditemukan di draf';
        throw appError('VALIDATION', message, { scriptPath: message });
      }
    }
    const now = nowIso(env);
    if (input.id === undefined) {
      const id = newId();
      await tx
        .prepare(
          "INSERT INTO cl_firmwares (id, brand, code, label, script_path, parallel, sort, removed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)",
        )
        .bind(
          id,
          input.brand,
          input.code,
          input.label,
          input.scriptPath,
          input.parallel ? 1 : 0,
          input.sort,
          now,
          now,
        )
        .run();
      const created = await getFirmwareById(tx, id);
      if (created === null) throw appError('INTERNAL', 'Firmware gagal dibuat');
      await writeAudit(tx, {
        ts: now,
        actor: actor.email,
        action: 'countrylock.firmware_save',
        target: `${created.brand}/${created.code}`,
        targetId: id,
        before: null,
        after: snapshotOf(created),
      }).run();
      return toDto(created, 0);
    }

    // Kunci baris lebih dulu; pembacaan berikutnya (hitungan item) melihat keadaan setelah kunci diperoleh.
    const locked = await tx
      .prepare('SELECT id FROM cl_firmwares WHERE id = ? FOR UPDATE')
      .bind(input.id)
      .first();
    const existing = locked === null ? null : await getFirmwareById(tx, input.id);
    if (existing === null || existing.removedAt !== '') {
      throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
    }
    if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== existing.updatedAt) {
      throw staleError(STALE_MESSAGE);
    }
    const inUse = await countItemsUsingFirmware(tx, existing.brand, existing.code);
    if ((input.code !== existing.code || input.brand !== existing.brand) && inUse > 0) {
      const message = 'Kode dan merk firmware tidak dapat diubah selama dipakai item';
      throw appError('CONFLICT', message, { code: message });
    }
    await tx
      .prepare(
        'UPDATE cl_firmwares SET brand = ?, code = ?, label = ?, script_path = ?, parallel = ?, sort = ?, updated_at = ? WHERE id = ?',
      )
      .bind(
        input.brand,
        input.code,
        input.label,
        input.scriptPath,
        input.parallel ? 1 : 0,
        input.sort,
        now,
        existing.id,
      )
      .run();
    const updated = await getFirmwareById(tx, existing.id);
    if (updated === null) throw appError('INTERNAL', 'Firmware gagal diubah');
    await writeAudit(tx, {
      ts: now,
      actor: actor.email,
      action: 'countrylock.firmware_save',
      target: `${updated.brand}/${updated.code}`,
      targetId: updated.id,
      before: snapshotOf(existing),
      after: snapshotOf(updated),
    }).run();
    return toDto(updated, inUse);
  });
}

/**
 * Menghapus firmware (ditandai `removed_at`; kodenya dapat dipakai lagi). Ditolak `CONFLICT` bila masih dipakai item
 * hidup. Baris firmware dikunci (`FOR UPDATE`) SEBELUM item dihitung: `items.save` yang menyetel firmware ini menahan
 * kunci yang sama sampai commit, jadi tepat satu pemenang (item tersimpan, atau firmware terhapus dan penyimpanan item
 * ditolak `VALIDATION`).
 */
export async function removeClFirmware(
  env: Env,
  input: RemoveClFirmwareInput,
  actor: ActorRef,
): Promise<null> {
  await writeFirmware(env, async (tx) => {
    const locked = await tx
      .prepare('SELECT id FROM cl_firmwares WHERE id = ? FOR UPDATE')
      .bind(input.id)
      .first();
    const existing = locked === null ? null : await getFirmwareById(tx, input.id);
    if (existing === null || existing.removedAt !== '') {
      throw appError('NOT_FOUND', NOT_FOUND_MESSAGE);
    }
    if ((await countItemsUsingFirmware(tx, existing.brand, existing.code)) > 0) {
      throw appError('CONFLICT', IN_USE_MESSAGE);
    }
    const now = nowIso(env);
    await tx
      .prepare(
        "UPDATE cl_firmwares SET removed_at = ?, updated_at = ? WHERE id = ? AND removed_at = ''",
      )
      .bind(now, now, existing.id)
      .run();
    await writeAudit(tx, {
      ts: now,
      actor: actor.email,
      action: 'countrylock.firmware_remove',
      target: `${existing.brand}/${existing.code}`,
      targetId: existing.id,
      before: snapshotOf(existing),
      after: null,
    }).run();
  });
  return null;
}
