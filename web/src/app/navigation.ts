import type { Level, ModuleKey } from '@shared/permissions';
import type { MeDto } from '@shared/rpc';
import type { LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { History, House, MapPin, Package, ShieldCheck, Tags, Users } from 'lucide-react';
import { canAnywhere } from '@/modules/auth/permissions';

export interface NavItem {
  label: string;
  to: LinkProps['to'];
  icon: LucideIcon;
  /** Rute di bawah `to` yang punya menu sendiri: item ini tidak ikut aktif di sana. */
  excludes?: LinkProps['to'][];
  /** `scope: 'location'` = tampil bila izin cukup di minimal satu lokasi aktif terpilih. */
  permission?: { module: ModuleKey; level: Level; scope?: 'location' };
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
      items: group.items.filter(
        (item) =>
          !item.permission ||
          canAnywhere(
            me,
            item.permission.module,
            item.permission.level,
            item.permission.scope === 'location' ? activeLocationIds : undefined,
          ),
      ),
    }))
    .filter((group) => group.items.length > 0);
}
