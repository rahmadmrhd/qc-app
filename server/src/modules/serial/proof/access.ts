import type { UserContext } from '@server/modules/access/context';
import { canActOnAllBus } from '@shared/business-units';

/**
 * Boleh mencoba lagi atau membuang foto bukti (aturan tunggal untuk rute `serialProofs.retry`/`remove` DAN field
 * `canManage` pada DTO): pelaku yang menyimpan foto, atau pemegang `serial: manage` pada BU serialnya.
 */
export function canManageProof(user: UserContext, createdBy: string, buId: string): boolean {
  if (createdBy === user.email) return true;
  return buId !== '' && canActOnAllBus(user.businessUnits, 'serial', 'manage', [buId]);
}
