import { formatBuLabel } from '@shared/business-units';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { businessUnitsQueryOptions, locationsQueryOptions, rolesQueryOptions } from '../queries';

/** Nama record yang sudah dihapus (soft delete), hanya diketahui pemegang `access: manage` (daftar Terhapus). */
export interface DeletedNames {
  roles: ReadonlyMap<string, string>;
  locations: ReadonlyMap<string, string>;
  businessUnits: ReadonlyMap<string, string>;
}

export interface NamedRef {
  name: string;
  /** True bila record sudah dihapus: tampil bertanda "Terhapus" dan tidak ditawarkan di pilihan. */
  deleted: boolean;
}

/** Pencari nama role/lokasi/BU pada penugasan pengguna; id yang tak ada di daftar hidup dianggap terhapus. */
export interface AssignmentLabels {
  role(id: string): NamedRef;
  location(id: string): NamedRef;
  businessUnit(id: string): NamedRef;
}

export const EMPTY_DELETED_NAMES: DeletedNames = {
  roles: new Map(),
  locations: new Map(),
  businessUnits: new Map(),
};

function resolver(
  live: readonly { id: string; name: string }[],
  deletedNames: ReadonlyMap<string, string>,
  fallback: string,
) {
  const liveById = new Map(live.map((entry) => [entry.id, entry.name]));
  return (id: string): NamedRef => {
    const name = liveById.get(id);
    if (name !== undefined) return { name, deleted: false };
    // Record tak pernah dihapus permanen: id di luar daftar hidup = sudah dihapus (nama dikenal hanya bagi pemegang manage).
    return { name: deletedNames.get(id) ?? fallback, deleted: true };
  };
}

export function makeAssignmentLabels(input: {
  roles: readonly { id: string; name: string }[];
  locations: readonly { id: string; name: string }[];
  businessUnits: readonly { id: string; name: string; code?: string }[];
  deleted?: DeletedNames | undefined;
}): AssignmentLabels {
  const deleted = input.deleted ?? EMPTY_DELETED_NAMES;
  return {
    role: resolver(input.roles, deleted.roles, 'Role'),
    location: resolver(input.locations, deleted.locations, 'Lokasi'),
    businessUnit: resolver(
      input.businessUnits.map((bu) => ({ id: bu.id, name: formatBuLabel(bu) })),
      deleted.businessUnits,
      'BU',
    ),
  };
}

/**
 * Nama role/lokasi/BU terhapus untuk menandai rujukan tersimpan pada penugasan. Daftar Terhapus hanya boleh dibaca
 * `access: manage` (server menolak yang lain), jadi pemakai tanpa hak mendapat nama umum ("Lokasi", "BU", "Role").
 */
export function useDeletedNames(canManage: boolean): DeletedNames {
  const roles = useQuery({ ...rolesQueryOptions('deleted'), enabled: canManage });
  const locations = useQuery({ ...locationsQueryOptions('deleted'), enabled: canManage });
  const businessUnits = useQuery({ ...businessUnitsQueryOptions('deleted'), enabled: canManage });
  return useMemo(
    () => ({
      roles: new Map((roles.data ?? []).map((entry) => [entry.id, entry.name])),
      locations: new Map((locations.data ?? []).map((entry) => [entry.id, entry.name])),
      businessUnits: new Map(
        (businessUnits.data ?? []).map((entry) => [entry.id, formatBuLabel(entry)]),
      ),
    }),
    [roles.data, locations.data, businessUnits.data],
  );
}
