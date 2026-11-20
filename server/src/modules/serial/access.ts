import type { Preparer } from '@server/core/db';
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

/**
 * Serial terbaca bila BU SAAT INI atau salah satu BU di riwayatnya (`serial_business_units`) ada di BU yang boleh
 * dibaca pengguna (spek serial unik se-sistem §5.3). Hanya BACA: menulis dan menindak tetap menurut BU saat ini. Satu
 * kueri kecil, dan hanya bila BU saat ini sendiri di luar hak.
 */
export async function canReadSerial(
  db: Preparer,
  user: UserContext,
  serialId: string,
  currentBuId: string,
): Promise<boolean> {
  const readable = readableBuIds(user);
  if (readable.includes(currentBuId)) return true;
  if (readable.length === 0) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM serial_business_units WHERE serial_id = ? AND bu_id IN (${readable.map(() => '?').join(', ')}) LIMIT 1`,
    )
    .bind(serialId, ...readable)
    .first<{ ok: number }>();
  return row !== null;
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
