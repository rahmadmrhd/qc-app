import type { Level, ModuleKey } from '@shared/permissions';
import type { MeDto } from '@shared/rpc';
import type { LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import {
  ClipboardList,
  Contact,
  History,
  House,
  MapPin,
  Package,
  ShieldCheck,
  Tags,
  Users,
} from 'lucide-react';
import { canAnywhere } from '@/modules/auth/permissions';

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
