import { writeAudit } from '@server/core/audit';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { resolveBuAccess } from '@shared/business-units';
import type {
  BusinessUnitDto,
  BusinessUnitOptionDto,
  SaveBusinessUnitInput,
  SetBusinessUnitStatusInput,
} from '@shared/contract';
import type { PartialPermissionMap } from '@shared/permissions';
import type { UserContext } from './context';
import type { BusinessUnitRecord, RoleRecord, UserRecord } from './repo';
import {
  batchWrite,
  countItemsByBu,
  insertBusinessUnitStmt,
  listBusinessUnitBriefs,
  loadAccessTables,
  renameBusinessUnitStmt,
  setBusinessUnitStatusStmt,
} from './repo';

/**
 * User AKTIF yang saat ini berhak atas BU ini: penugasan "Semua BU" atau eksplisit ke BU ini dengan role yang memberi
 * level modul ber-BU (`item`) selain `none`. Angka ini dipakai untuk peringatan saat BU dinonaktifkan (spek 5.3).
 */
function userCountOf(
  buId: string,
  users: readonly UserRecord[],
  rolePermissions: ReadonlyMap<string, PartialPermissionMap>,
): number {
  return users.filter(
    (user) =>
      user.status === 'active' &&
      resolveBuAccess(user.buAssignments, rolePermissions, [buId])[buId] !== undefined,
  ).length;
}

function rolePermissionMap(roles: readonly RoleRecord[]): Map<string, PartialPermissionMap> {
  return new Map(roles.map((role) => [role.id, role.permissions]));
}

function toBusinessUnitDto(
  bu: BusinessUnitRecord,
  users: readonly UserRecord[],
  roles: readonly RoleRecord[],
  itemCounts: ReadonlyMap<string, number>,
): BusinessUnitDto {
  return {
    id: bu.id,
    code: bu.code,
    name: bu.name,
    status: bu.status,
    itemCount: itemCounts.get(bu.id) ?? 0,
    userCount: userCountOf(bu.id, users, rolePermissionMap(roles)),
    createdAt: bu.createdAt,
    updatedAt: bu.updatedAt,
    updatedBy: bu.updatedBy,
  };
}

function businessUnitSnapshot(bu: BusinessUnitRecord): Record<string, unknown> {
  return { code: bu.code, name: bu.name, status: bu.status };
}

const BUSINESS_UNIT_CONFLICTS = {
  business_units_code_unique: { field: 'code', message: 'Kode BU sudah dipakai' },
  business_units_name_unique: { field: 'name', message: 'Nama BU sudah dipakai' },
};

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);

export async function listBusinessUnitDtos(env: Env): Promise<BusinessUnitDto[]> {
  const [{ users, roles, businessUnits }, itemCounts] = await Promise.all([
    loadAccessTables(env),
    countItemsByBu(env),
  ]);
  return businessUnits.map((bu) => toBusinessUnitDto(bu, users, roles, itemCounts)).sort(byCode);
}

/** Daftar BU ringkas (semua status) untuk pemilih; tanpa hitungan. */
export async function listBusinessUnitOptions(env: Env): Promise<BusinessUnitOptionDto[]> {
  return (await listBusinessUnitBriefs(env)).sort(byCode);
}

async function dtoAfterWrite(env: Env, bu: BusinessUnitRecord): Promise<BusinessUnitDto> {
  const [{ users, roles }, itemCounts] = await Promise.all([
    loadAccessTables(env),
    countItemsByBu(env),
  ]);
  return toBusinessUnitDto(bu, users, roles, itemCounts);
}

export async function saveBusinessUnit(
  env: Env,
  input: SaveBusinessUnitInput,
  actor: UserContext,
): Promise<BusinessUnitDto> {
  const { businessUnits } = await loadAccessTables(env);
  const others = businessUnits.filter((bu) => bu.id !== input.id);
  if (others.some((bu) => bu.code === input.code)) {
    throw appError('CONFLICT', 'Kode BU sudah dipakai', { code: 'Kode BU sudah dipakai' });
  }
  const nameKey = input.name.toLowerCase();
  if (others.some((bu) => bu.name.toLowerCase() === nameKey)) {
    throw appError('CONFLICT', 'Nama BU sudah dipakai', { name: 'Nama BU sudah dipakai' });
  }
  const now = nowIso(env);

  if (input.id) {
    const existing = businessUnits.find((bu) => bu.id === input.id);
    if (!existing) throw appError('NOT_FOUND', 'BU tidak ditemukan');
    if (existing.code !== input.code) {
      throw appError('VALIDATION', 'Kode tidak dapat diubah', {
        code: 'Kode tidak dapat diubah',
      });
    }
    const updated: BusinessUnitRecord = {
      ...existing,
      name: input.name,
      updatedAt: now,
      updatedBy: actor.email,
    };
    await batchWrite(
      env.DB,
      [
        renameBusinessUnitStmt(env.DB, updated),
        writeAudit(env.DB, {
          ts: now,
          actor: actor.email,
          action: 'businessunit.update',
          target: updated.code,
          before: businessUnitSnapshot(existing),
          after: businessUnitSnapshot(updated),
        }),
      ],
      BUSINESS_UNIT_CONFLICTS,
    );
    return dtoAfterWrite(env, updated);
  }

  const created: BusinessUnitRecord = {
    id: crypto.randomUUID(),
    code: input.code,
    name: input.name,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    updatedBy: actor.email,
  };
  await batchWrite(
    env.DB,
    [
      insertBusinessUnitStmt(env.DB, created),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'businessunit.create',
        target: created.code,
        before: null,
        after: businessUnitSnapshot(created),
      }),
    ],
    BUSINESS_UNIT_CONFLICTS,
  );
  return dtoAfterWrite(env, created);
}

/** Menonaktifkan BU yang masih dipakai TIDAK ditolak (spek 5.3); peringatan jumlah item/user ada di UI. */
export async function setBusinessUnitStatus(
  env: Env,
  input: SetBusinessUnitStatusInput,
  actor: UserContext,
): Promise<BusinessUnitDto> {
  const { businessUnits } = await loadAccessTables(env);
  const existing = businessUnits.find((bu) => bu.id === input.id);
  if (!existing) throw appError('NOT_FOUND', 'BU tidak ditemukan');
  if (existing.status === input.status) return dtoAfterWrite(env, existing);
  const now = nowIso(env);
  const updated: BusinessUnitRecord = {
    ...existing,
    status: input.status,
    updatedAt: now,
    updatedBy: actor.email,
  };
  await env.DB.batch([
    setBusinessUnitStatusStmt(env.DB, updated),
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'businessunit.activate' : 'businessunit.deactivate',
      target: existing.code,
      before: businessUnitSnapshot(existing),
      after: businessUnitSnapshot(updated),
    }),
  ]);
  return dtoAfterWrite(env, updated);
}
