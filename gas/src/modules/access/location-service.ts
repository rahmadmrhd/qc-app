import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import type { LocationDto, SaveLocationInput, SetLocationStatusInput } from '@shared/rpc';
import type { UserContext } from './context';
import { invalidateAccessCache_ } from './context';
import type { LocationRecord, NewLocationRecord } from './repo';
import { appendAudit_, insertLocation_, listLocations_, updateLocation_ } from './repo';
import { nowIso_ } from './service';

function toLocationDto_(location: NewLocationRecord): LocationDto {
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

function locationSnapshot_(location: NewLocationRecord): Record<string, unknown> {
  return { code: location.code, name: location.name, status: location.status };
}

export function listLocationDtos_(): LocationDto[] {
  return listLocations_()
    .map(toLocationDto_)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function saveLocation_(input: SaveLocationInput, actor: UserContext): LocationDto {
  return platform_().withLock(() => {
    const locations = listLocations_();
    const others = locations.filter((location) => location.id !== input.id);
    if (others.some((location) => location.code === input.code)) {
      throw appError_('CONFLICT', 'Kode lokasi sudah dipakai', {
        code: 'Kode lokasi sudah dipakai',
      });
    }
    const nameKey = input.name.toLowerCase();
    if (others.some((location) => location.name.toLowerCase() === nameKey)) {
      throw appError_('CONFLICT', 'Nama lokasi sudah dipakai', {
        name: 'Nama lokasi sudah dipakai',
      });
    }
    const now = nowIso_();

    if (input.id) {
      const existing = locations.find((location) => location.id === input.id);
      if (!existing) throw appError_('NOT_FOUND', 'Lokasi tidak ditemukan');
      if (existing.code !== input.code) {
        throw appError_('VALIDATION', 'Kode tidak dapat diubah', {
          code: 'Kode tidak dapat diubah',
        });
      }
      const updated: LocationRecord = {
        ...existing,
        name: input.name,
        updatedAt: now,
        updatedBy: actor.email,
      };
      updateLocation_(updated);
      invalidateAccessCache_();
      appendAudit_({
        ts: now,
        actor: actor.email,
        action: 'location.update',
        target: updated.code,
        before: locationSnapshot_(existing),
        after: locationSnapshot_(updated),
      });
      return toLocationDto_(updated);
    }

    const created: NewLocationRecord = {
      id: platform_().uuid(),
      code: input.code,
      name: input.name,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      updatedBy: actor.email,
    };
    insertLocation_(created);
    invalidateAccessCache_();
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: 'location.create',
      target: created.code,
      before: null,
      after: locationSnapshot_(created),
    });
    return toLocationDto_(created);
  });
}

export function setLocationStatus_(input: SetLocationStatusInput, actor: UserContext): LocationDto {
  return platform_().withLock(() => {
    const existing = listLocations_().find((location) => location.id === input.id);
    if (!existing) throw appError_('NOT_FOUND', 'Lokasi tidak ditemukan');
    if (existing.status === input.status) return toLocationDto_(existing);
    const now = nowIso_();
    const updated: LocationRecord = {
      ...existing,
      status: input.status,
      updatedAt: now,
      updatedBy: actor.email,
    };
    updateLocation_(updated);
    invalidateAccessCache_();
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: input.status === 'active' ? 'location.activate' : 'location.deactivate',
      target: existing.code,
      before: locationSnapshot_(existing),
      after: locationSnapshot_(updated),
    });
    return toLocationDto_(updated);
  });
}
