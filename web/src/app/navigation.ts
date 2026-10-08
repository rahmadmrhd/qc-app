import type { Level, ModuleKey } from '@shared/permissions';
import type { MeDto } from '@shared/rpc';
import type { LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { House } from 'lucide-react';
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
