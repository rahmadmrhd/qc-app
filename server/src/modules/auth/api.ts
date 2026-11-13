import type { RouteTable } from '@server/core/router';
import { expectNull } from '@server/core/validate';
import type { UserContext } from '@server/modules/access/context';
import type { LocationBrief } from '@server/modules/access/location-brief';
import { listBusinessUnitBriefs, listLocationBriefs } from '@server/modules/access/repo';
import { canManageSerialSettings } from '@server/modules/serial/alert';
import type { LocationPermissionMap } from '@shared/assignments';
import type { BuPermissionMap } from '@shared/business-units';
import type { BusinessUnitOptionDto, MeDto } from '@shared/contract';

/**
 * Daftar lokasi `auth.me` per konteks akses: konteks dan daftar lokasi hidup di cache isolate (dibuang bersama),
 * jadi selama keduanya objek yang sama hasilnya tidak berubah dan tidak perlu disaring/diurutkan ulang tiap
 * permintaan (`GET /api/v1/me` dipanggil di setiap pemuatan halaman). Identitas `briefs` dicek agar
 * hasil lama tidak dipakai bila daftar lokasi dimuat ulang.
 */
const meLocations = new WeakMap<
  UserContext,
  { briefs: readonly LocationBrief[]; locations: MeDto['locations'] }
>();

function locationsOf(user: UserContext, briefs: readonly LocationBrief[]): MeDto['locations'] {
  const memo = meLocations.get(user);
  if (memo && memo.briefs === briefs) return memo.locations;
  const locations = briefs
    .filter((location) => location.active && user.locations[location.id] !== undefined)
    .map((location) => ({
      id: location.id,
      code: location.code,
      name: location.name,
      permissions: user.locations[location.id] as LocationPermissionMap,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  meLocations.set(user, { briefs, locations });
  return locations;
}

/** BU yang user punya level apa pun atasnya (peta `businessUnits` konteks sudah hanya memuat BU berhak). */
function businessUnitsOf(
  user: UserContext,
  briefs: readonly BusinessUnitOptionDto[],
): MeDto['businessUnits'] {
  return briefs
    .filter((bu) => user.businessUnits[bu.id] !== undefined)
    .map((bu) => ({ ...bu, permissions: user.businessUnits[bu.id] as BuPermissionMap }))
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
      }),
    },
  };
}
