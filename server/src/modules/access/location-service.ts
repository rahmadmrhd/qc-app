import { writeAudit } from '@server/core/audit';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import { newId } from '@server/core/id';
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
import type {
  GetLocationInput,
  ListLocationsInput,
  LocationDto,
  SaveLocationInput,
  SetLocationStatusInput,
} from '@shared/contract';
import { hasLevel } from '@shared/permissions';
import type { UserContext } from './context';
import type { AccessTables, LocationRecord } from './repo';
import {
  batchWrite,
  createAccessTablesCache,
  deletedInfoOf,
  insertLocationStmt,
  isLiveRecord,
  loadAccessTables,
  updateLocationStmt,
} from './repo';

function toLocationDto(location: LocationRecord): LocationDto {
  const deleted = deletedInfoOf(location);
  return {
    id: location.id,
    code: location.code,
    name: location.name,
    status: location.status,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
    updatedBy: location.updatedBy,
    ...(deleted ? { deleted } : {}),
  };
}

function locationSnapshot(location: LocationRecord): Record<string, unknown> {
  return { code: location.code, name: location.name, status: location.status };
}

const LOCATION_CONFLICTS = {
  locations_code_unique: { field: 'code', message: 'Kode lokasi sudah dipakai' },
  locations_name_unique: { field: 'name', message: 'Nama lokasi sudah dipakai' },
};

const CODE_TAKEN = 'Kode lokasi sudah dipakai';
const NAME_TAKEN = 'Nama lokasi sudah dipakai';
const LOCATION_NOT_FOUND = 'Lokasi tidak ditemukan';
const LOCATION_STALE = 'Lokasi diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

const LOCATION_SPEC: LifecycleSpec<LocationRecord, LocationDto> = {
  table: 'locations',
  audit: 'location',
  noun: 'lokasi',
  auditTarget: (location) => location.code,
  snapshot: locationSnapshot,
  toDto: toLocationDto,
};

function canSeeDeleted(actor: UserContext | undefined): boolean {
  return actor !== undefined && hasLevel(actor.permissions.access, 'manage');
}

function assertCanListDeleted(filter: ListStatusFilter | undefined, actor?: UserContext): void {
  if (filter === 'deleted' && !canSeeDeleted(actor)) {
    throw appError('FORBIDDEN', 'Anda tidak berhak melihat data terhapus');
  }
}

/** Daftar lokasi: bawaan hidup (aktif + nonaktif); `deleted` hanya bagi `access: manage`. */
export async function listLocationDtos(
  env: Env,
  input?: ListLocationsInput | null,
  actor?: UserContext,
): Promise<LocationDto[]> {
  const filter = input?.status;
  assertCanListDeleted(filter, actor);
  const { locations } = await loadAccessTables(env);
  return locations
    .filter((location) => (filter === 'deleted' ? !isLiveRecord(location) : isLiveRecord(location)))
    .filter((location) => filter !== 'active' || location.status === 'active')
    .filter((location) => filter !== 'inactive' || location.status === 'inactive')
    .map(toLocationDto)
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Satu lokasi menurut id. Terhapus hanya bagi `access: manage`; selain itu `NOT_FOUND`. */
export async function getLocationDto(
  env: Env,
  input: GetLocationInput,
  actor: UserContext,
): Promise<LocationDto> {
  const { locations } = await loadAccessTables(env);
  const location = locations.find((record) => record.id === input.id);
  if (!location || (!isLiveRecord(location) && !canSeeDeleted(actor))) {
    throw appError('NOT_FOUND', LOCATION_NOT_FOUND);
  }
  return toLocationDto(location);
}

export async function saveLocation(
  env: Env,
  input: SaveLocationInput,
  actor: UserContext,
): Promise<LocationDto> {
  const { locations } = await loadAccessTables(env);
  // Keunikan antar lokasi HIDUP (lokasi terhapus tak menahan kode/namanya; pulihkan memeriksa ulang).
  const others = locations.filter((location) => isLiveRecord(location) && location.id !== input.id);
  if (others.some((location) => location.code === input.code)) {
    throw appError('CONFLICT', CODE_TAKEN, { code: CODE_TAKEN });
  }
  const nameKey = input.name.toLowerCase();
  if (others.some((location) => location.name.toLowerCase() === nameKey)) {
    throw appError('CONFLICT', NAME_TAKEN, { name: NAME_TAKEN });
  }
  const now = nowIso(env);

  if (input.id) {
    const existing = locations.find((location) => location.id === input.id);
    if (!existing || !isLiveRecord(existing)) throw appError('NOT_FOUND', LOCATION_NOT_FOUND);
    if (existing.code !== input.code) {
      throw appError('VALIDATION', 'Kode tidak dapat diubah', {
        code: 'Kode tidak dapat diubah',
      });
    }
    const updated: LocationRecord = {
      ...existing,
      name: input.name,
      updatedAt: now,
      updatedBy: actor.email,
    };
    await batchWrite(
      env.DB,
      [
        updateLocationStmt(env.DB, updated),
        writeAudit(env.DB, {
          ts: now,
          actor: actor.email,
          action: 'location.update',
          target: updated.code,
          targetId: updated.id,
          before: locationSnapshot(existing),
          after: locationSnapshot(updated),
        }),
      ],
      LOCATION_CONFLICTS,
    );
    return toLocationDto(updated);
  }

  const created: LocationRecord = {
    id: newId(),
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
      insertLocationStmt(env.DB, created),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'location.create',
        target: created.code,
        targetId: created.id,
        before: null,
        after: locationSnapshot(created),
      }),
    ],
    LOCATION_CONFLICTS,
  );
  return toLocationDto(created);
}

function findLocation(tables: AccessTables, id: string): LocationRecord {
  const location = tables.locations.find((record) => record.id === id);
  if (!location) throw appError('NOT_FOUND', LOCATION_NOT_FOUND);
  return location;
}

function locationPlanners(env: Env, actor: UserContext) {
  const cache = createAccessTablesCache(env);
  const options = { conflicts: LOCATION_CONFLICTS, stale: LOCATION_STALE, prepare: cache.reset };
  /** Dua lokasi terhapus berkode/bernama sama dipulihkan sekaligus: bentrok antar record satu permintaan. */
  const restoreOptions = {
    ...options,
    verify: (restored: LocationDto[]) => {
      const codes = new Set<string>();
      const names = new Set<string>();
      for (const location of restored) {
        if (codes.has(location.code)) throw appError('CONFLICT', CODE_TAKEN, { code: CODE_TAKEN });
        if (names.has(location.name.toLowerCase())) {
          throw appError('CONFLICT', NAME_TAKEN, { name: NAME_TAKEN });
        }
        codes.add(location.code);
        names.add(location.name.toLowerCase());
      }
    },
  };
  return {
    options,
    restoreOptions,
    status:
      (status: 'active' | 'inactive') =>
      async (id: string): Promise<PlanOutcome<LocationDto>> => {
        const location = findLocation(await cache.get(), id);
        if (!isLiveRecord(location)) throw appError('NOT_FOUND', LOCATION_NOT_FOUND);
        return planStatusChange(env, LOCATION_SPEC, location, status, actor);
      },
    remove: async (id: string): Promise<PlanOutcome<RemoveResult>> =>
      planSoftDelete(env, LOCATION_SPEC, findLocation(await cache.get(), id), actor),
    restore: async (id: string): Promise<PlanOutcome<LocationDto>> => {
      const tables = await cache.get();
      const location = findLocation(tables, id);
      if (!isLiveRecord(location)) {
        const nameKey = location.name.toLowerCase();
        for (const other of tables.locations) {
          if (!isLiveRecord(other) || other.id === location.id) continue;
          if (other.code === location.code) {
            throw appError('CONFLICT', CODE_TAKEN, { code: CODE_TAKEN });
          }
          if (other.name.toLowerCase() === nameKey) {
            throw appError('CONFLICT', NAME_TAKEN, { name: NAME_TAKEN });
          }
        }
      }
      return planRestore(env, LOCATION_SPEC, location, actor);
    },
  };
}

/** Ubah status satu lokasi: perencana yang sama dengan batch (tunggal = batch berisi satu id). */
export function setLocationStatus(
  env: Env,
  input: SetLocationStatusInput,
  actor: UserContext,
): Promise<LocationDto> {
  const planners = locationPlanners(env, actor);
  return runSingleRecord(env, input.id, planners.status(input.status), planners.options);
}

export function setLocationStatusBatch(
  env: Env,
  input: StatusBatchInput,
  actor: UserContext,
): Promise<BatchResult<LocationDto>> {
  const planners = locationPlanners(env, actor);
  return runRecordBatch(env, input.ids, planners.status(input.status), planners.options);
}

export function removeLocation(
  env: Env,
  input: GetLocationInput,
  actor: UserContext,
): Promise<RemoveResult> {
  const planners = locationPlanners(env, actor);
  return runSingleRecord(env, input.id, planners.remove, planners.options);
}

export async function removeLocationBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<RemoveBatchResult> {
  const planners = locationPlanners(env, actor);
  const { items } = await runRecordBatch(env, input.ids, planners.remove, planners.options);
  return { ids: items.map((item) => item.id) };
}

export function restoreLocation(
  env: Env,
  input: GetLocationInput,
  actor: UserContext,
): Promise<LocationDto> {
  const planners = locationPlanners(env, actor);
  return runSingleRecord(env, input.id, planners.restore, planners.restoreOptions);
}

export function restoreLocationBatch(
  env: Env,
  input: IdBatchInput,
  actor: UserContext,
): Promise<BatchResult<LocationDto>> {
  const planners = locationPlanners(env, actor);
  return runRecordBatch(env, input.ids, planners.restore, planners.restoreOptions);
}
