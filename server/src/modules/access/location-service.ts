import { writeAudit } from '@server/core/audit';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { LocationDto, SaveLocationInput, SetLocationStatusInput } from '@shared/rpc';
import type { UserContext } from './context';
import type { LocationRecord } from './repo';
import { batchWrite, insertLocationStmt, loadAccessTables, updateLocationStmt } from './repo';

function toLocationDto(location: LocationRecord): LocationDto {
  return {
    id: location.id,
    code: location.code,
    name: location.name,
    status: location.status,
    createdAt: location.createdAt,
    updatedAt: location.updatedAt,
    updatedBy: location.updatedBy,
  };
}

function locationSnapshot(location: LocationRecord): Record<string, unknown> {
  return { code: location.code, name: location.name, status: location.status };
}

const LOCATION_CONFLICTS = {
  'locations.code': { field: 'code', message: 'Kode lokasi sudah dipakai' },
  locations_name_unique: { field: 'name', message: 'Nama lokasi sudah dipakai' },
};

export async function listLocationDtos(env: Env): Promise<LocationDto[]> {
  const { locations } = await loadAccessTables(env);
  return locations.map(toLocationDto).sort((a, b) => a.code.localeCompare(b.code));
}

export async function saveLocation(
  env: Env,
  input: SaveLocationInput,
  actor: UserContext,
): Promise<LocationDto> {
  const { locations } = await loadAccessTables(env);
  const others = locations.filter((location) => location.id !== input.id);
  if (others.some((location) => location.code === input.code)) {
    throw appError('CONFLICT', 'Kode lokasi sudah dipakai', {
      code: 'Kode lokasi sudah dipakai',
    });
  }
  const nameKey = input.name.toLowerCase();
  if (others.some((location) => location.name.toLowerCase() === nameKey)) {
    throw appError('CONFLICT', 'Nama lokasi sudah dipakai', {
      name: 'Nama lokasi sudah dipakai',
    });
  }
  const now = nowIso(env);

  if (input.id) {
    const existing = locations.find((location) => location.id === input.id);
    if (!existing) throw appError('NOT_FOUND', 'Lokasi tidak ditemukan');
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
          before: locationSnapshot(existing),
          after: locationSnapshot(updated),
        }),
      ],
      LOCATION_CONFLICTS,
    );
    return toLocationDto(updated);
  }

  const created: LocationRecord = {
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
      insertLocationStmt(env.DB, created),
      writeAudit(env.DB, {
        ts: now,
        actor: actor.email,
        action: 'location.create',
        target: created.code,
        before: null,
        after: locationSnapshot(created),
      }),
    ],
    LOCATION_CONFLICTS,
  );
  return toLocationDto(created);
}

export async function setLocationStatus(
  env: Env,
  input: SetLocationStatusInput,
  actor: UserContext,
): Promise<LocationDto> {
  const { locations } = await loadAccessTables(env);
  const existing = locations.find((location) => location.id === input.id);
  if (!existing) throw appError('NOT_FOUND', 'Lokasi tidak ditemukan');
  if (existing.status === input.status) return toLocationDto(existing);
  const now = nowIso(env);
  const updated: LocationRecord = {
    ...existing,
    status: input.status,
    updatedAt: now,
    updatedBy: actor.email,
  };
  await env.DB.batch([
    updateLocationStmt(env.DB, updated),
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'location.activate' : 'location.deactivate',
      target: existing.code,
      before: locationSnapshot(existing),
      after: locationSnapshot(updated),
    }),
  ]);
  return toLocationDto(updated);
}
