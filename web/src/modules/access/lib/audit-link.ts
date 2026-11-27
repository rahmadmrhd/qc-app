import type { AuditEntryDto, MeDto } from '@shared/contract';
import type { LinkProps } from '@tanstack/react-router';
import { canAnywhere, canReadWarehouse } from '@/modules/auth/permissions';

export interface AuditLink {
  to: LinkProps['to'];
  params: Record<string, string>;
}

/**
 * Tujuan tautan sebuah entri Log Audit ke entitasnya (keputusan pemilik 2026-11-20, redesain butir 20). Izinnya
 * MENCERMINKAN `beforeLoad` rute tujuan, supaya tautan tak pernah membawa pengguna ke halaman "Dilarang":
 * - item, merk, customer: `item: view`; postel: `sticker: view`; pengguna/role/lokasi/BU: `access: view`;
 * - catatan SO Keluar Gudang: `serialwh: view` pada minimal satu BU;
 * - serial: `serial` atau `serialservice: view`; serah terima: `handover: view` atau `qc: edit` (di salah satu lokasi);
 * - desain QR: `qrcode: edit`; preset QR: `qrcode: manage` (keduanya hanya punya halaman ubah, tak ada View).
 * Stiker dan jenis stiker tak punya halaman lihat, dan entri tanpa `targetRef` (lama, atau aksi tanpa entitas) tak
 * punya tautan: keduanya `undefined`, jadi target tampil sebagai teks biasa.
 */
export function auditTargetLink(
  entry: Pick<AuditEntryDto, 'targetRef'>,
  me: MeDto | null | undefined,
): AuditLink | undefined {
  const ref = entry.targetRef;
  if (!ref) return undefined;
  const { id } = ref;
  switch (ref.kind) {
    case 'item':
      return canAnywhere(me, 'item', 'view')
        ? { to: '/item/$itemId', params: { itemId: id } }
        : undefined;
    case 'brand':
      return canAnywhere(me, 'item', 'view')
        ? { to: '/item/brands/$brandId', params: { brandId: id } }
        : undefined;
    case 'customer':
      return canAnywhere(me, 'item', 'view')
        ? { to: '/customer/$customerId', params: { customerId: id } }
        : undefined;
    case 'postel':
      return canAnywhere(me, 'sticker', 'view')
        ? { to: '/postel/$postelId', params: { postelId: id } }
        : undefined;
    case 'user':
      return canAnywhere(me, 'access', 'view')
        ? { to: '/access/users/$userId', params: { userId: id } }
        : undefined;
    case 'role':
      return canAnywhere(me, 'access', 'view')
        ? { to: '/access/roles/$roleId', params: { roleId: id } }
        : undefined;
    case 'location':
      return canAnywhere(me, 'access', 'view')
        ? { to: '/access/locations/$locationId', params: { locationId: id } }
        : undefined;
    case 'businessUnit':
      return canAnywhere(me, 'access', 'view')
        ? { to: '/access/business-units/$businessUnitId', params: { businessUnitId: id } }
        : undefined;
    case 'serial':
      return canAnywhere(me, 'serial', 'view') || canAnywhere(me, 'serialservice', 'view')
        ? { to: '/serial/$serialId', params: { serialId: id } }
        : undefined;
    case 'warehouseOrder':
      return canReadWarehouse(me)
        ? { to: '/serial/gudang/riwayat/$orderId', params: { orderId: id } }
        : undefined;
    case 'warehouseReady':
      return canReadWarehouse(me)
        ? { to: '/serial/gudang/riwayat/ready/$readyId', params: { readyId: id } }
        : undefined;
    case 'handover':
      return canAnywhere(me, 'handover', 'view') || canAnywhere(me, 'qc', 'edit')
        ? { to: '/handover/$handoverId', params: { handoverId: id } }
        : undefined;
    case 'qrDesign':
      return canAnywhere(me, 'qrcode', 'edit')
        ? { to: '/qrcode/$designId/edit', params: { designId: id } }
        : undefined;
    case 'qrPreset':
      return canAnywhere(me, 'qrcode', 'manage')
        ? { to: '/qrcode/default/$presetId/edit', params: { presetId: id } }
        : undefined;
    default:
      // `sticker`, `stickerType`: tak punya halaman lihat.
      return undefined;
  }
}
