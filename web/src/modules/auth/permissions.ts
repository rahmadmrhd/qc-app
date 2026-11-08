import type { LocatedModule } from '@shared/assignments';
import { isLocatedModule } from '@shared/assignments';
import type {
  BusinessUnitAccessDto,
  BusinessUnitRefDto,
  LocationAccessDto,
  MeDto,
} from '@shared/contract';
import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { meQueryOptions } from './queries';

/**
 * Izin GLOBAL (penugasan "Semua lokasi"); benar untuk modul `access`.
 * Untuk modul berlokasi pakai `canAt`, `locationsWith`, atau `canAnywhere`.
 * Hanya untuk UX — penegakan sebenarnya ada di router server.
 */
export function can(me: MeDto | null | undefined, module: ModuleKey, level: Level): boolean {
  return me ? hasLevel(me.permissions[module], level) : false;
}

export function canAt(
  me: MeDto | null | undefined,
  module: LocatedModule,
  level: Level,
  locationId: string,
): boolean {
  const location = me?.locations.find((item) => item.id === locationId);
  return location ? hasLevel(location.permissions[module], level) : false;
}

/** Lokasi (opsional dibatasi ke `among`) tempat user punya minimal `level` pada modul berlokasi. */
export function locationsWith(
  me: MeDto | null | undefined,
  module: LocatedModule,
  level: Level,
  among?: readonly string[],
): LocationAccessDto[] {
  if (!me) return [];
  return me.locations.filter(
    (item) => (!among || among.includes(item.id)) && hasLevel(item.permissions[module], level),
  );
}

export function canAnywhere(
  me: MeDto | null | undefined,
  module: ModuleKey,
  level: Level,
  among?: readonly string[],
): boolean {
  if (!me) return false;
  return isLocatedModule(module)
    ? locationsWith(me, module, level, among).length > 0
    : can(me, module, level);
}

export async function requirePermission(
  queryClient: QueryClient,
  module: ModuleKey,
  level: Level,
): Promise<void> {
  const me = await queryClient.ensureQueryData(meQueryOptions());
  if (!canAnywhere(me, module, level)) throw redirect({ to: '/forbidden' });
}

/** Lolos bila SALAH SATU alternatif terpenuhi di minimal satu lokasi (modul berlokasi) atau global. */
export async function requireAnyPermission(
  queryClient: QueryClient,
  alternatives: ReadonlyArray<{ module: ModuleKey; level: Level }>,
): Promise<void> {
  const me = await queryClient.ensureQueryData(meQueryOptions());
  if (!alternatives.some((item) => canAnywhere(me, item.module, item.level))) {
    throw redirect({ to: '/forbidden' });
  }
}

/**
 * `MeDto.businessUnits` bisa `undefined` pada `me` yang dipulihkan dari localStorage oleh `app/query-persist.ts`
 * (bundel lama menyimpan bentuk lama) sebelum dimuat ulang: semua helper BU menganggapnya kosong.
 */
function itemBusinessUnits(me: MeDto | null | undefined): readonly BusinessUnitAccessDto[] {
  return me?.businessUnits ?? [];
}

/** Id BU (aktif maupun nonaktif) tempat user punya minimal `level` pada modul `item`. */
export function buIdsWithLevelFor(me: MeDto | null | undefined, level: Level): string[] {
  return itemBusinessUnits(me)
    .filter((bu) => hasLevel(bu.permissions.item, level))
    .map((bu) => bu.id);
}

function hasLevelOnAllBus(
  me: MeDto | null | undefined,
  item: { businessUnits?: readonly BusinessUnitRefDto[] },
  level: Level,
): boolean {
  const attached = item.businessUnits ?? [];
  if (attached.length === 0) return false;
  const allowed = new Set(buIdsWithLevelFor(me, level));
  return attached.every((bu) => allowed.has(bu.id));
}

/** Ubah item: `edit` pada SEMUA BU item (keputusan 13). Item tanpa BU tidak dapat diubah. */
export function canEditItem(
  me: MeDto | null | undefined,
  item: { businessUnits?: readonly BusinessUnitRefDto[] },
): boolean {
  return hasLevelOnAllBus(me, item, 'edit');
}

/** Nonaktifkan/aktifkan item: `manage` pada SEMUA BU item. */
export function canManageItem(
  me: MeDto | null | undefined,
  item: { businessUnits?: readonly BusinessUnitRefDto[] },
): boolean {
  return hasLevelOnAllBus(me, item, 'manage');
}

/** Buat item: ada minimal satu BU aktif ber-`edit`. */
export function canCreateItem(me: MeDto | null | undefined): boolean {
  return itemBusinessUnits(me).some(
    (bu) => bu.status === 'active' && hasLevel(bu.permissions.item, 'edit'),
  );
}
