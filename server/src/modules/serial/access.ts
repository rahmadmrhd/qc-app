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

/**
 * Hak Hapus/Pulihkan serial (keputusan pemilik soft delete 12): `serial: manage` pada SEMUA BU dalam riwayat BU serial
 * itu (BU saat ini ikut), bukan hanya BU saat ini. BU terhapus diabaikan dari syarat selama masih ada BU hidup di riwayat
 * (keputusan 9, diterapkan serupa `canActOnItem`). `involvedBuIds` = hasil `involvedBuIds()` (riwayat + BU saat ini).
 */
export function canManageSerial(user: UserContext, involvedBuIds: readonly string[]): boolean {
  return canActOnAllBus(user.businessUnits, 'serial', 'manage', involvedBuIds, user.deletedBuIds);
}

/**
 * Penyaring SQL serial yang boleh DIPULIHKAN pemanggil (alias tabel `serials` = `alias`): cermin SQL `canManageSerial`
 * (daftar "Terhapus" memakainya; tes kesepakatan `soft-delete.test.ts` menjaganya sama). Himpunan BU terlibat = baris
 * `serial_business_units` serial itu ditambah `bu_id` saat ini (menoleransi baris penghubung yang belum terisi). Tanpa
 * BU ber-`manage` sama sekali tak ada serial yang lolos (`1 = 0`).
 */
export function restorableSerialsSql(
  user: UserContext,
  alias = 's',
): { sql: string; binds: string[] } {
  const managed = buIdsWithLevel(user.businessUnits, 'serial', 'manage');
  if (managed.length === 0) return { sql: '1 = 0', binds: [] };
  const deleted = [...user.deletedBuIds];
  const marks = (ids: readonly string[]) => ids.map(() => '?').join(',');
  const hist = (condition: string) =>
    `EXISTS (SELECT 1 FROM serial_business_units r WHERE r.serial_id = ${alias}.id AND ${condition})`;
  const binds: string[] = [];
  // Kondisi atas satu BU (`col`): hidup = bukan BU terhapus; tak dikelola = di luar BU ber-`manage`.
  const live = (col: string): string => {
    if (deleted.length === 0) return '1 = 1';
    binds.push(...deleted);
    return `${col} NOT IN (${marks(deleted)})`;
  };
  const notManaged = (col: string): string => {
    binds.push(...managed);
    return `${col} NOT IN (${marks(managed)})`;
  };
  // (tak ada BU hidup tanpa manage) AND (ada BU hidup ATAU tak ada BU tanpa manage); BU saat ini = `${alias}.bu_id`.
  const liveViolation = `(${hist(`${live('r.bu_id')} AND ${notManaged('r.bu_id')}`)} OR (${live(`${alias}.bu_id`)} AND ${notManaged(`${alias}.bu_id`)}))`;
  const liveAny = `(${hist(live('r.bu_id'))} OR ${live(`${alias}.bu_id`)})`;
  const anyViolation = `(${hist(notManaged('r.bu_id'))} OR ${notManaged(`${alias}.bu_id`)})`;
  return {
    sql: `(NOT ${liveViolation} AND (${liveAny} OR NOT ${anyViolation}))`,
    binds,
  };
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
