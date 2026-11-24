import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
import type { UserContext } from '@server/modules/access/context';
import type { LocationBrief } from '@server/modules/access/location-brief';
import { listBusinessUnitBriefs, listLocationBriefs } from '@server/modules/access/repo';
import { canManageSerialSettings } from '@server/modules/serial/alert';
import type { LocationPermissionMap } from '@shared/assignments';
import type { BuPermissionMap } from '@shared/business-units';
import type { BusinessUnitOptionDto, MeDto } from '@shared/contract';

/** Lokasi aktif yang dapat diakses user, diurutkan menurut kode. */
function locationsOf(user: UserContext, briefs: readonly LocationBrief[]): MeDto['locations'] {
  return briefs
    .filter((location) => location.active && user.locations[location.id] !== undefined)
    .map((location) => ({
      id: location.id,
      code: location.code,
      name: location.name,
      permissions: user.locations[location.id] as LocationPermissionMap,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * BU yang user punya level apa pun atasnya (peta `businessUnits` konteks sudah hanya memuat BU berhak). BU terhapus
 * (soft delete) TETAP ada (hak tetap berlaku, web memakai daftar ini sebagai sumber hak) dan ditandai `deleted`;
 * pemakai sebagai pilihan/filter menyaringnya.
 */
function businessUnitsOf(
  user: UserContext,
  briefs: readonly BusinessUnitOptionDto[],
): MeDto['businessUnits'] {
  return briefs
    .filter((bu) => user.businessUnits[bu.id] !== undefined)
    .map((bu) => ({
      ...bu,
      permissions: user.businessUnits[bu.id] as BuPermissionMap,
      deleted: user.deletedBuIds.includes(bu.id),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Rute `auth.me` (REST `GET /api/v1/me`; rute HTTP `/auth/*` ada di `routes.ts`). */
export function authApiRoutes(): Pick<RouteTable, 'auth.me'> {
  return {
    'auth.me': {
      validate: expectNull,
      handler: async (_input, ctx) => ({
        email: ctx.user.email,
        name: ctx.user.name,
        isSuperAdmin: ctx.user.isSuperAdmin,
        canManageSerialSettings: await canManageSerialSettings(ctx.env, ctx.user),
        permissions: ctx.user.permissions,
        locations: locationsOf(ctx.user, await listLocationBriefs(ctx.env)),
        businessUnits: businessUnitsOf(ctx.user, await listBusinessUnitBriefs(ctx.env)),
        deletedBusinessUnitIds: [...ctx.user.deletedBuIds].sort(),
        sharedAccount: ctx.user.sharedAccount,
      }),
    },
  };
}
