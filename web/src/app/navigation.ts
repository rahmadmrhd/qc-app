import type { Level, ModuleKey } from '@shared/permissions';
import type { MeDto } from '@shared/rpc';
import type { LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { History, House, ShieldCheck, Users } from 'lucide-react';
import { can } from '@/modules/auth/permissions';

export interface NavItem {
  label: string;
  to: LinkProps['to'];
  icon: LucideIcon;
  permission?: { module: ModuleKey; level: Level };
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
        label: 'Log Audit',
        to: '/access/audit',
        icon: History,
        permission: { module: 'access', level: 'view' },
      },
    ],
  },
];

export function visibleNavGroups(groups: readonly NavGroup[], me: MeDto): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => !item.permission || can(me, item.permission.module, item.permission.level),
      ),
    }))
    .filter((group) => group.items.length > 0);
}
