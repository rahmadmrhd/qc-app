import { writeAudit } from '@server/core/audit';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { type PlanOutcome, runRecordBatch, runSingleRecord } from '@server/core/record-batch';
import {
  type LifecycleSpec,
  planRestore,
  planSoftDelete,
  planStatusChange,
} from '@server/core/record-lifecycle';
import type {
  BatchResult,
  IdBatchInput,
  ListStatusFilter,
  RemoveBatchResult,
  RemoveResult,
  StatusBatchInput,
} from '@shared/batch';
import { resolveBuAccess } from '@shared/business-units';
import type {
  BusinessUnitDto,
  BusinessUnitOptionDto,
  GetBusinessUnitInput,
  ListBusinessUnitsInput,
  SaveBusinessUnitInput,
  SetBusinessUnitStatusInput,
} from '@shared/contract';
import type { PartialPermissionMap } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import type { UserContext } from './context';
import type { AccessTables, BusinessUnitRecord, RoleRecord, UserRecord } from './repo';
import {
  batchWrite,
  countItemsByBu,
  deletedInfoOf,
  insertBusinessUnitStmt,
  isLiveRecord,
  listBusinessUnitBriefs,
  loadAccessTables,
  renameBusinessUnitStmt,
} from './repo';

/**
 * User AKTIF dan HIDUP yang saat ini berhak atas BU ini: penugasan "Semua BU" atau eksplisit ke BU ini dengan role
 * HIDUP yang memberi level modul ber-BU (`item`) selain `none`. Angka ini dipakai untuk peringatan saat BU
 * dinonaktifkan/dihapus (spek 5.3, soft delete §5 butir 2): pengguna dan role terhapus tak dihitung.
 */
function userCountOf(
  buId: string,
  users: readonly UserRecord[],
  rolePermissions: ReadonlyMap<string, PartialPermissionMap>,
): number {
  return users.filter(
    (user) =>
      isLiveRecord(user) &&
      user.status === 'active' &&
      resolveBuAccess(user.buAssignments, rolePermissions, [buId])[buId] !== undefined,
  ).length;
}

function rolePermissionMap(roles: readonly RoleRecord[]): Map<string, PartialPermissionMap> {
  return new Map(roles.filter(isLiveRecord).map((role) => [role.id, role.permissions]));
}

function toBusinessUnitDto(
  bu: BusinessUnitRecord,
  users: readonly UserRecord[],
  roles: readonly RoleRecord[],
  itemCounts: ReadonlyMap<string, number>,
): BusinessUnitDto {
  const deleted = deletedInfoOf(bu);
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
    ...(deleted ? { deleted: true, deletedInfo: deleted } : {}),
  };
}

function businessUnitSnapshot(bu: BusinessUnitRecord): Record<string, unknown> {
  return { code: bu.code, name: bu.name, status: bu.status };
}

const BUSINESS_UNIT_CONFLICTS = {
  business_units_code_unique: { field: 'code', message: 'Kode BU sudah dipakai' },
  business_units_name_unique: { field: 'name', message: 'Nama BU sudah dipakai' },
};

const CODE_TAKEN = 'Kode BU sudah dipakai';
const NAME_TAKEN = 'Nama BU sudah dipakai';
const BU_NOT_FOUND = 'BU tidak ditemukan';
const BU_STALE = 'BU diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);

function canSeeDeleted(actor: UserContext | undefined): boolean {
  return actor !== undefined && hasLevel(actor.permissions.access, 'manage');
}

function assertCanListDeleted(filter: ListStatusFilter | undefined, actor?: UserContext): void {
  if (filter === 'deleted' && !canSeeDeleted(actor)) {
    throw appError('FORBIDDEN', 'Anda tidak berhak melihat data terhapus');
  }
}

/** Daftar BU: bawaan hidup (aktif + nonaktif); `deleted` hanya bagi `access: manage`. */
export async function listBusinessUnitDtos(
  env: Env,
  input?: ListBusinessUnitsInput | null,
  actor?: UserContext,
): Promise<BusinessUnitDto[]> {
  const filter = input?.status;
  assertCanListDeleted(filter, actor);
  const [{ users, roles, businessUnits }, itemCounts] = await Promise.all([
    loadAccessTables(env),
    countItemsByBu(env),
  ]);
  return businessUnits
    .filter((bu) => (filter === 'deleted' ? !isLiveRecord(bu) : isLiveRecord(bu)))
    .filter((bu) => filter !== 'active' || bu.status === 'active')
    .filter((bu) => filter !== 'inactive' || bu.status === 'inactive')
    .map((bu) => toBusinessUnitDto(bu, users, roles, itemCounts))
    .sort(byCode);
}

/** Satu BU menurut id. Terhapus hanya bagi `access: manage`; selain itu `NOT_FOUND`. */
export async function getBusinessUnitDto(
  env: Env,
  input: GetBusinessUnitInput,
  actor: UserContext,
): Promise<BusinessUnitDto> {
  const [{ users, roles, businessUnits }, itemCounts] = await Promise.all([
    loadAccessTables(env),
    countItemsByBu(env),
  ]);
  const bu = businessUnits.find((record) => record.id === input.id);
  if (!bu || (!isLiveRecord(bu) && !canSeeDeleted(actor)))
    throw appError('NOT_FOUND', BU_NOT_FOUND);
  return toBusinessUnitDto(bu, users, roles, itemCounts);
}

/**
 * Daftar BU ringkas (semua status) untuk pemilih; tanpa hitungan. BU TERHAPUS ikut, bertanda `deleted: true`, agar
 * rujukan tersimpan tetap dapat menampilkan namanya; pemakai sebagai pilihan/filter menyaringnya.
 */
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
  // Keunikan antar BU HIDUP (BU terhapus tak menahan kode/namanya; pulihkan memeriksa ulang).
  const others = businessUnits.filter((bu) => isLiveRecord(bu) && bu.id !== input.id);
  if (others.some((bu) => bu.code === input.code)) {
    throw appError('CONFLICT', CODE_TAKEN, { code: CODE_TAKEN });
  }
  const nameKey = input.name.toLowerCase();
  if (others.some((bu) => bu.name.toLowerCase() === nameKey)) {
    throw appError('CONFLICT', NAME_TAKEN, { name: NAME_TAKEN });
  }
  const now = nowIso(env);

  if (input.id) {
    const existing = businessUnits.find((bu) => bu.id === input.id);
    if (!existing || !isLiveRecord(existing)) throw appError('NOT_FOUND', BU_NOT_FOUND);
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
          targetId: updated.id,
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
    deletedAt: '',
    deletedBy: '',
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
        targetId: created.id,
        before: null,
        after: businessUnitSnapshot(created),
      }),
    ],
    BUSINESS_UNIT_CONFLICTS,
  );
  return dtoAfterWrite(env, created);
}

/** Tabel akses + hitungan item per BU, dimuat sekali per percobaan `runRecordBatch` (bukan sekali per id). */
interface BuLoad {
  tables: AccessTables;
  itemCounts: Map<string, number>;
}

function buSpec(load: BuLoad): LifecycleSpec<BusinessUnitRecord, BusinessUnitDto> {
  return {
    table: 'business_units',
    audit: 'businessunit',
    noun: 'BU',
    auditTarget: (bu) => bu.code,
    snapshot: businessUnitSnapshot,
    toDto: (bu) => toBusinessUnitDto(bu, load.tables.users, load.tables.roles, load.itemCounts),
  };
}

function businessUnitPlanners(env: Env, actor: UserContext) {
  let loaded: Promise<BuLoad> | null = null;
  const get = (): Promise<BuLoad> => {
    loaded ??= Promise.all([loadAccessTables(env), countItemsByBu(env)]).then(
      ([tables, itemCounts]) => ({ tables, itemCounts }),
    );
    return loaded;
  };
  const options = {
    conflicts: BUSINESS_UNIT_CONFLICTS,
    stale: BU_STALE,
    prepare: () => {
      loaded = null;
    },
  };
  /** Dua BU terhapus berkode/bernama sama dipulihkan sekaligus: bentrok antar record satu permintaan. */
  const restoreOptions = {
    ...options,
    verify: (restored: BusinessUnitDto[]) => {
      const codes = new Set<string>();
      const names = new Set<string>();
      for (const bu of restored) {
        if (codes.has(bu.code)) throw appError('CONFLICT', CODE_TAKEN, { code: CODE_TAKEN });
        if (names.has(bu.name.toLowerCase())) {
          throw appError('CONFLICT', NAME_TAKEN, { name: NAME_TAKEN });
        }
        codes.add(bu.code);
        names.add(bu.name.toLowerCase());
      }
    },
  };
  const find = (load: BuLoad, id: string): BusinessUnitRecord => {
    const bu = load.tables.businessUnits.find((record) => record.id === id);
    if (!bu) throw appError('NOT_FOUND', BU_NOT_FOUND);
    return bu;
  };
  return {
    options,
    restoreOptions,
    /** Menonaktifkan BU yang masih dipakai TIDAK ditolak (spek 5.3); peringatan jumlah item/user ada di UI. */
    status:
      (status: 'active' | 'inactive') =>
      async (id: string): Promise<PlanOutcome<BusinessUnitDto>> => {
        const load = await get();
        const bu = find(load, id);
        if (!isLiveRecord(bu)) throw appError('NOT_FOUND', BU_NOT_FOUND);
        return planStatusChange(env, buSpec(load), bu, status, actor);
      },
    remove: async (id: string): Promise<PlanOutcome<RemoveResult>> => {
      const load = await get();
      return planSoftDelete(env, buSpec(load), find(load, id), actor);
    },
    restore: async (id: string): Promise<PlanOutcome<BusinessUnitDto>> => {
      const load = await get();
      const bu = find(load, id);
      if (!isLiveRecord(bu)) {
        const nameKey = bu.name.toLowerCase();
        for (const other of load.tables.businessUnits) {
          if (!isLiveRecord(other) || other.id === bu.id) continue;
          if (other.code === bu.code) throw appError('CONFLICT', CODE_TAKEN, { code: CODE_TAKEN });
          if (other.name.toLowerCase() === nameKey) {
            throw appError('CONFLICT', NAME_TAKEN, { name: NAME_TAKEN });
          }
        }
      }
      return planRestore(env, buSpec(load), bu, actor);
    },
  };
}

/** Ubah status satu BU: perencana yang sama dengan batch (tunggal = batch berisi satu id). */
export function setBusinessUnitStatus(
  env: Env,
  input: SetBusinessUnitStatusInput,
  actor: UserContext,
): Promise<BusinessUnitDto> {
  const planners = businessUnitPlanners(env, actor);
  return runSingleRecord(env, input.id, planners.status(input.status), planners.options);
}

export function setBusinessUnitStatusBatch(
  env: Env,
  input: StatusBatchInput,
  actor: UserContext,
): Promise<BatchResult<BusinessUnitDto>> {
  const planners = businessUnitPlanners(env, actor);
  return runRecordBatch(env, input.ids, planners.status(input.status), planners.options);
}

export function removeBusinessUnit(
  env: Env,
  input: GetBusinessUnitInput,
  actor: UserContext,
): Promise<RemoveResult> {
  const planners = businessUnitPlanners(env, actor);
  return runSingleRecord(env, input.id, planners.remove, planners.options);
}

export async function removeBusinessUnitBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<RemoveBatchResult> {
  const planners = businessUnitPlanners(env, actor);
  const { items } = await runRecordBatch(env, input.ids, planners.remove, planners.options);
  return { ids: items.map((item) => item.id) };
}

export function restoreBusinessUnit(
  env: Env,
  input: GetBusinessUnitInput,
  actor: UserContext,
): Promise<BusinessUnitDto> {
  const planners = businessUnitPlanners(env, actor);
  return runSingleRecord(env, input.id, planners.restore, planners.restoreOptions);
}

export function restoreBusinessUnitBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<BatchResult<BusinessUnitDto>> {
  const planners = businessUnitPlanners(env, actor);
  return runRecordBatch(env, input.ids, planners.restore, planners.restoreOptions);
}
