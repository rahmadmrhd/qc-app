import type { BuPermissionMap } from '@shared/business-units';
import type { MeDto } from '@shared/contract';
import type { Level, PermissionMap } from '@shared/permissions';

const NONE: PermissionMap = {
  access: 'none',
  item: 'none',
  qrcode: 'none',
  handover: 'none',
  qc: 'none',
  stock: 'none',
  sticker: 'none',
  stickerstock: 'none',
} as PermissionMap;

/**
 * `MeDto` untuk tes halaman: satu BU aktif ("bu-a", RTL) tempat pengguna memegang `itemLevel` pada modul `item`.
 * `permissions` menimpa izin global modul lain (mis. `{ sticker: 'view' }`).
 */
export function makeMe({
  itemLevel = 'manage',
  permissions = {},
  businessUnits,
}: {
  itemLevel?: Level;
  permissions?: Partial<PermissionMap>;
  businessUnits?: MeDto['businessUnits'];
} = {}): MeDto {
  const buPermissions: BuPermissionMap = {
    item: itemLevel,
    serial: 'none',
    serialservice: 'none',
    serialwh: 'none',
  };
  return {
    email: 'a@x.com',
    name: 'A',
    isSuperAdmin: false,
    canManageSerialSettings: false,
    sharedAccount: false,
    permissions: { ...NONE, item: itemLevel, ...permissions },
    locations: [],
    businessUnits: businessUnits ?? [
      { id: 'bu-a', code: 'RTL', name: 'Retail', status: 'active', permissions: buPermissions },
    ],
  } as MeDto;
}
