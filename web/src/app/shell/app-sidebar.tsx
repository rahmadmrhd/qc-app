import { Link, useMatchRoute } from '@tanstack/react-router';
import type { NavItem } from '@/app/navigation';
import { isNavItemActive, NAV_GROUPS, visibleNavGroups } from '@/app/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useMe } from '@/modules/auth/use-me';
import { useActiveLocations } from '@/modules/location/active-locations-context';

export function AppSidebar() {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const matchRoute = useMatchRoute();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="truncate px-2 py-1 text-lg font-semibold group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:text-center">
          <span className="group-data-[collapsible=icon]:hidden">QC App</span>
          <span className="hidden group-data-[collapsible=icon]:inline">QC</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {visibleNavGroups(NAV_GROUPS, me, selectedIds).map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.label}
                      isActive={isNavItemActive(item, (to, fuzzy) =>
                        Boolean(matchRoute({ to: to as NavItem['to'], fuzzy })),
                      )}
                    >
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
