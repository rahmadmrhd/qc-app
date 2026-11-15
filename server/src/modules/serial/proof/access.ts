import type { UserContext } from '@server/modules/access/context';
import { canActOnAllBus } from '@shared/business-units';
import { hasLevel } from '@shared/permissions';

/**
 * Boleh mencoba lagi atau membuang foto bukti (aturan tunggal untuk rute `serialProofs.retry`/`remove` DAN field
 * `canManage` pada DTO): pemegang `serial: edit` (izin rute, global) yang menyimpan foto itu, atau pemegang
 * `serial: manage` pada BU serialnya. Tanpa `serial: edit` saat ini rute menolak, jadi tombol tak boleh tampil.
 */
export function canManageProof(user: UserContext, createdBy: string, buId: string): boolean {
  if (!hasLevel(user.permissions.serial, 'edit')) return false;
  if (createdBy === user.email) return true;
  return buId !== '' && canActOnAllBus(user.businessUnits, 'serial', 'manage', [buId]);
}
