import type { Level, ModuleKey } from '@shared/permissions';
import { hasLevel } from '@shared/permissions';
import type { MeDto } from '@shared/rpc';
import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { meQueryOptions } from './queries';

/** Hanya untuk UX — penegakan sebenarnya ada di router GAS. */
export function can(me: MeDto | null | undefined, module: ModuleKey, level: Level): boolean {
  return me ? hasLevel(me.permissions[module], level) : false;
}

export async function requirePermission(
  queryClient: QueryClient,
  module: ModuleKey,
  level: Level,
): Promise<void> {
  const me = await queryClient.ensureQueryData(meQueryOptions());
  if (!can(me, module, level)) throw redirect({ to: '/forbidden' });
}
