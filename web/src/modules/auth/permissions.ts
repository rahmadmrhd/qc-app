import type { LocatedModule } from '@shared/assignments';
import { isLocatedModule } from '@shared/assignments';
import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import type { LocationAccessDto, MeDto } from '@shared/rpc';
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { meQueryOptions } from './queries';

/**
 * Izin GLOBAL (penugasan "Semua lokasi"); benar untuk modul `access`.
 * Untuk modul berlokasi pakai `canAt`, `locationsWith`, atau `canAnywhere`.
 * Hanya untuk UX — penegakan sebenarnya ada di router GAS.
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
