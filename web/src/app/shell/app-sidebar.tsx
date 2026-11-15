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
import { isDesktop } from '@/lib/platform';
import { useMe } from '@/modules/auth/use-me';
import { hasPendingGuide } from '@/modules/guide/lib/guide-for-route';
import { useOfferedGuides } from '@/modules/guide/lib/use-offered-guides';
import { useActiveLocations } from '@/modules/location/active-locations-context';

export function AppSidebar() {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const matchRoute = useMatchRoute();
  const { offers } = useOfferedGuides();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="truncate px-2 py-1 text-lg font-semibold group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:text-center">
          <span className="group-data-[collapsible=icon]:hidden">QC App</span>
          <span className="hidden group-data-[collapsible=icon]:inline">QC</span>
        </div>
      </SidebarHeader>
      <SidebarContent data-tour="sidebar-menu">
        {visibleNavGroups(NAV_GROUPS, me, selectedIds, isDesktop()).map((group) => (
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
                        {hasPendingGuide(offers, item.to as string) && (
                          <span
                            role="img"
                            aria-label="Ada panduan"
                            className="ml-auto size-2 shrink-0 rounded-full bg-primary group-data-[collapsible=icon]:hidden"
                          />
                        )}
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
