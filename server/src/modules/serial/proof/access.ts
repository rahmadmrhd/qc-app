import type { UserContext } from '@server/modules/access/context';
import { canActOnAllBus } from '@shared/business-units';
import { hasLevel } from '@shared/permissions';
import { canWriteBu } from '../access';

/**
 * Boleh mencoba lagi atau membuang foto bukti (aturan tunggal untuk rute `serialProofs.retry`/`remove` DAN field
 * `canManage` pada DTO): pemegang `serial: edit` (izin rute, global) yang menyimpan foto itu DAN masih berhak menulis
 * (`serial: edit`) di BU serial SAAT INI, atau pemegang `serial: manage` pada BU serialnya. Serial yang dipindah BU
 * (cek ulang lintas BU) tetap terbaca BU lama, tetapi pelaku di BU lama tak boleh lagi mengubah fotonya.
 * Tanpa `serial: edit` saat ini rute menolak, jadi tombol tak boleh tampil.
 */
export function canManageProof(user: UserContext, createdBy: string, buId: string): boolean {
  if (!hasLevel(user.permissions.serial, 'edit')) return false;
  if (createdBy === user.email && buId !== '' && canWriteBu(user, buId)) return true;
  return buId !== '' && canActOnAllBus(user.businessUnits, 'serial', 'manage', [buId]);
}
