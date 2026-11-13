import type { MeDto } from '@shared/contract';
import type { Level, ModuleKey } from '@shared/permissions';
import type { LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import {
  Boxes,
  Building2,
  ClipboardList,
  Contact,
  FileBadge,
  History,
  House,
  Images,
  ListChecks,
  MapPin,
  Package,
  QrCode,
  ScanBarcode,
  Settings,
  Settings2,
  Shapes,
  ShieldCheck,
  Sticker,
  Tags,
  Users,
} from 'lucide-react';
import { canAnywhere, canManageSerialSettings } from '@/modules/auth/permissions';

export interface NavPermission {
  module: ModuleKey;
  level: Level;
  /** `scope: 'location'` = tampil bila izin cukup di minimal satu lokasi aktif terpilih. */
  scope?: 'location';
}

export interface NavItem {
  label: string;
  to: LinkProps['to'];
  icon: LucideIcon;
  /** Rute di bawah `to` yang punya menu sendiri: item ini tidak ikut aktif di sana. */
  excludes?: LinkProps['to'][];
  /** Satu izin, atau **daftar** (salah satu cukup). */
  permission?: NavPermission | readonly NavPermission[];
  /** Syarat tambahan di atas `permission` (keduanya harus terpenuhi), untuk aturan yang tak muat di satu izin. */
  visible?: (me: MeDto) => boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  { label: 'Umum', items: [{ label: 'Beranda', to: '/', icon: House }] },
  {
    label: 'Data',
    items: [
      {
        label: 'Data Item',
        to: '/item',
        icon: Package,
        excludes: ['/item/brands'],
        permission: { module: 'item', level: 'view' },
      },
      {
        label: 'Merk',
        to: '/item/brands',
        icon: Tags,
        permission: { module: 'item', level: 'view' },
      },
      {
        label: 'Customer',
        to: '/customer',
        icon: Contact,
        permission: { module: 'item', level: 'view' },
      },
    ],
  },
  {
    label: 'Manual Book',
    items: [
      {
        label: 'QR Code',
        to: '/qrcode',
        icon: QrCode,
        permission: { module: 'qrcode', level: 'view' },
      },
    ],
  },
  {
    label: 'Postel',
    items: [
      {
        label: 'Daftar Postel',
        to: '/postel',
        icon: FileBadge,
        permission: { module: 'sticker', level: 'view' },
      },
    ],
  },
  {
    label: 'Operasional',
    items: [
      {
        label: 'Serah Terima',
        to: '/handover',
        icon: ClipboardList,
        permission: [
          { module: 'handover', level: 'view', scope: 'location' },
          { module: 'qc', level: 'edit', scope: 'location' },
        ],
      },
    ],
  },
  {
    label: 'Serial Number',
    items: [
      {
        label: 'Daftar Serial Number',
        to: '/serial',
        icon: ListChecks,
        excludes: ['/serial/new', '/serial/settings'],
        permission: [
          { module: 'serial', level: 'view' },
          { module: 'serialservice', level: 'view' },
        ],
      },
      {
        label: 'Catat Serial Number',
        to: '/serial/new',
        icon: ScanBarcode,
        permission: { module: 'serial', level: 'edit' },
      },
      {
        label: 'Pengaturan',
        to: '/serial/settings',
        icon: Settings,
        permission: { module: 'serial', level: 'manage' },
        visible: canManageSerialSettings,
      },
    ],
  },
  {
    label: 'Stiker',
    items: [
      {
        label: 'Stiker',
        to: '/sticker',
        icon: Sticker,
        excludes: ['/sticker/types', '/sticker/stock', '/sticker/library', '/sticker/settings'],
        permission: { module: 'sticker', level: 'view' },
      },
      {
        label: 'Jenis Stiker',
        to: '/sticker/types',
        icon: Shapes,
        permission: { module: 'sticker', level: 'view' },
      },
      {
        label: 'Stok Stiker',
        to: '/sticker/stock',
        icon: Boxes,
        permission: { module: 'stickerstock', level: 'view', scope: 'location' },
      },
      {
        label: 'Pustaka Gambar',
        to: '/sticker/library',
        icon: Images,
        permission: [
          { module: 'item', level: 'view' },
          { module: 'sticker', level: 'view' },
        ],
      },
      {
        label: 'Konfigurasi Stiker',
        to: '/sticker/settings',
        icon: Settings2,
        permission: { module: 'sticker', level: 'manage' },
      },
    ],
  },
  {
    label: 'Pengaturan Akses',
    items: [
      {
        label: 'Users',
        to: '/access/users',
        icon: Users,
        permission: { module: 'access', level: 'view' },
      },
      {
        label: 'Roles',
        to: '/access/roles',
        icon: ShieldCheck,
        permission: { module: 'access', level: 'view' },
      },
      {
        label: 'Lokasi',
        to: '/access/locations',
        icon: MapPin,
        permission: { module: 'access', level: 'view' },
      },
      {
        label: 'Business Unit',
        to: '/access/business-units',
        icon: Building2,
        permission: { module: 'access', level: 'view' },
      },
      {
        label: 'Log Audit',
        to: '/access/audit',
        icon: History,
        permission: { module: 'access', level: 'view' },
      },
    ],
  },
];

/** Aktif bila rute cocok (fuzzy kecuali beranda) dan bukan rute yang dikecualikan. */
export function isNavItemActive(
  item: NavItem,
  matches: (to: string, fuzzy: boolean) => boolean,
): boolean {
  if (!matches(item.to as string, item.to !== '/')) return false;
  return !(item.excludes ?? []).some((to) => matches(to as string, true));
}

export function visibleNavGroups(
  groups: readonly NavGroup[],
  me: MeDto,
  activeLocationIds?: readonly string[],
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.visible && !item.visible(me)) return false;
        if (!item.permission) return true;
        const alternatives: readonly NavPermission[] = Array.isArray(item.permission)
          ? item.permission
          : [item.permission as NavPermission];
        return alternatives.some((permission) =>
          canAnywhere(
            me,
            permission.module,
            permission.level,
            permission.scope === 'location' ? activeLocationIds : undefined,
          ),
        );
      }),
    }))
    .filter((group) => group.items.length > 0);
}
