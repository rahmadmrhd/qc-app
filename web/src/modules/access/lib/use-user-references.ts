import { useSuspenseQuery } from '@tanstack/react-query';
import { businessUnitLinkAccess, locationLinkAccess, roleLinkAccess } from '@/lib/link-access';
import type { UserFormReferenceProps } from '@/modules/access/components/user-form-dialog';
import { can } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import {
  businessUnitsQueryOptions,
  locationsQueryOptions,
  rolesQueryOptions,
  useSaveBusinessUnit,
  useSaveLocation,
  useSaveRole,
} from '../queries';
import { type AssignmentLabels, makeAssignmentLabels, useDeletedNames } from './assignment-labels';

export interface UserReferences {
  /** Prop referensi untuk `UserFormDialog`/`UserForm`: pilihan, tautan Buka, dan baris "Tambah ...". */
  formProps: UserFormReferenceProps;
  /** Nama role/lokasi/BU pada penugasan (tabel, kartu, View); yang terhapus ditandai. */
  labels: AssignmentLabels;
  canOpenLocation: boolean;
  canOpenBusinessUnit: boolean;
  canOpenRole: boolean;
}

/**
 * Data rujukan penugasan pengguna (role, lokasi, BU hidup + nama yang terhapus bagi pemegang `access: manage`) beserta
 * tautan Buka dan aksi Tambah menurut hak pemakai (keputusan pemilik 18). Daftar hidup harus sudah dimuat loader rute.
 */
export function useUserReferences(): UserReferences {
  const me = useMe();
  const { data: roles } = useSuspenseQuery(rolesQueryOptions());
  const { data: locations } = useSuspenseQuery(locationsQueryOptions());
  const { data: businessUnits } = useSuspenseQuery(businessUnitsQueryOptions());
  const deletedNames = useDeletedNames(can(me, 'access', 'manage'));
  const saveLocation = useSaveLocation();
  const saveRole = useSaveRole();
  const saveBusinessUnit = useSaveBusinessUnit();
  const locationAccess = locationLinkAccess(me);
  const roleAccess = roleLinkAccess(me);
  const businessUnitAccess = businessUnitLinkAccess(me);
  return {
    formProps: {
      roles,
      locations,
      businessUnits,
      deletedNames,
      openBusinessUnitHref: businessUnitAccess.openBusinessUnitHref,
      openLocationHref: locationAccess.openLocationHref,
      openRoleHref: roleAccess.openRoleHref,
      onCreateLocation: locationAccess.canCreateLocation
        ? (input) => saveLocation.mutateAsync(input)
        : undefined,
      onCreateRole: roleAccess.canCreateRole ? (input) => saveRole.mutateAsync(input) : undefined,
      onCreateBusinessUnit: businessUnitAccess.canCreateBusinessUnit
        ? (input) => saveBusinessUnit.mutateAsync(input)
        : undefined,
    },
    labels: makeAssignmentLabels({ roles, locations, businessUnits, deleted: deletedNames }),
    canOpenLocation: locationAccess.openLocationHref !== undefined,
    canOpenBusinessUnit: businessUnitAccess.openBusinessUnitHref !== undefined,
    canOpenRole: roleAccess.openRoleHref !== undefined,
  };
}
