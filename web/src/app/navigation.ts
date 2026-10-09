import type { Level, ModuleKey } from '@shared/permissions';
import type { MeDto } from '@shared/rpc';
import type { LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { History, House, MapPin, ShieldCheck, Users } from 'lucide-react';
import { canAnywhere } from '@/modules/auth/permissions';

export interface NavItem {
  label: string;
  to: LinkProps['to'];
  icon: LucideIcon;
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
