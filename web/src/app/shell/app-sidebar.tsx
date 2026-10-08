import { Link, useMatchRoute } from '@tanstack/react-router';
import { NAV_GROUPS, visibleNavGroups } from '@/app/navigation';
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

export function AppSidebar() {
  const me = useMe();
  const matchRoute = useMatchRoute();
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="px-2 py-1 text-lg font-semibold">QC App</div>
      </SidebarHeader>
      <SidebarContent>
        {visibleNavGroups(NAV_GROUPS, me).map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      asChild
                      isActive={Boolean(matchRoute({ to: item.to, fuzzy: item.to !== '/' }))}
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
