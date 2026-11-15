import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { buIdsWithLevel, canActOnAllBus } from '@shared/business-units';
import type { ActorModules } from '@shared/serial-flow';

/** BU yang boleh dibaca: level `view` pada `serial` ATAU `serialservice` (penangan servis perlu membaca). */
export function readableBuIds(user: UserContext): string[] {
  const ids = new Set([
    ...buIdsWithLevel(user.businessUnits, 'serial', 'view'),
    ...buIdsWithLevel(user.businessUnits, 'serialservice', 'view'),
  ]);
  return [...ids];
}

/** BU yang boleh ditulis (mencatat, mengubah): level `edit` pada `serial`. */
export function writableBuIds(user: UserContext): string[] {
  return buIdsWithLevel(user.businessUnits, 'serial', 'edit');
}

/** Serial di BU di luar hak = `NOT_FOUND` (bukan `FORBIDDEN`), agar keberadaannya tidak bocor. */
export function assertSerialVisible(user: UserContext, buId: string): void {
  if (!readableBuIds(user).includes(buId))
    throw appError('NOT_FOUND', 'Serial Number tidak ditemukan');
}

export function canWriteBu(user: UserContext, buId: string): boolean {
  return canActOnAllBus(user.businessUnits, 'serial', 'edit', [buId]);
}

/**
 * Modul yang dipegang user pada level `edit` di SATU BU serial (bahan `resolveAction`): `serial` untuk aksi tim QC,
 * `serialservice` untuk aksi tim servis. Pemegang kedua modul memenuhi baris mana pun yang modulnya ia punya.
 */
export function modulesOn(user: UserContext, buId: string): ActorModules {
  return {
    serial: canActOnAllBus(user.businessUnits, 'serial', 'edit', [buId]),
    serialservice: canActOnAllBus(user.businessUnits, 'serialservice', 'edit', [buId]),
  };
}
