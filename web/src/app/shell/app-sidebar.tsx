import { Link, useMatchRoute } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { NavItem, NavParent } from '@/app/navigation';
import { isNavItemActive, isNavParent, NAV_GROUPS, visibleNavGroups } from '@/app/navigation';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { isDesktop } from '@/lib/platform';
import { useMe } from '@/modules/auth/use-me';
import { openInDesktop } from '@/modules/countrylock/lib/handoff';
import { hasPendingGuide } from '@/modules/guide/lib/guide-for-route';
import { useOfferedGuides } from '@/modules/guide/lib/use-offered-guides';
import { useActiveLocations } from '@/modules/location/active-locations-context';
import { readSidebarState, writeSidebarState } from './sidebar-state';

const GUIDE_DOT_CLASS =
  'ml-auto size-2 shrink-0 rounded-full bg-primary group-data-[collapsible=icon]:hidden';

export function AppSidebar() {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const matchRoute = useMatchRoute();
  const { offers } = useOfferedGuides();
  const { state, isMobile } = useSidebar();
  const [expanded, setExpanded] = useState<string[]>(() => readSidebarState().expanded);
  const iconMode = state === 'collapsed' && !isMobile;

  const isActive = (item: NavItem) =>
    isNavItemActive(item, (to, fuzzy) => Boolean(matchRoute({ to: to as NavItem['to'], fuzzy })));

  function toggleParent(id: string, open: boolean) {
    setExpanded((current) => {
      const next = open
        ? [...current.filter((v) => v !== id), id]
        : current.filter((v) => v !== id);
      writeSidebarState({ ...readSidebarState(), expanded: next });
      return next;
    });
  }

  function itemLink(item: NavItem) {
    return (
      <Link
        to={item.to}
        data-active={isActive(item) || undefined}
        onClick={
          item.opensDesktopApp && !isDesktop()
            ? () => {
                // Gagal (server mati, izin dicabut) tak mengganggu: halaman tujuan menampilkan
                // tombol dan alasannya.
                void openInDesktop().catch(() => undefined);
              }
            : undefined
        }
      >
        <item.icon />
        <span>{item.label}</span>
        {hasPendingGuide(offers, item.to as string) && (
          <span role="img" aria-label="Ada panduan" className={GUIDE_DOT_CLASS} />
        )}
      </Link>
    );
  }

  function renderParent(parent: NavParent) {
    const containsActive = parent.children.some(isActive);
    const parentHasGuide = parent.children.some((child) =>
      hasPendingGuide(offers, child.to as string),
    );
    const parentButtonContent = (
      <>
        <parent.icon />
        <span>{parent.label}</span>
        {parentHasGuide && !iconMode && (
          <span
            role="img"
            aria-label="Ada panduan"
            className="ml-auto size-2 shrink-0 rounded-full bg-primary"
          />
        )}
        <ChevronRight
          aria-hidden
          className={`${parentHasGuide ? '' : 'ml-auto '}transition-transform group-data-[collapsible=icon]:hidden group-data-[state=open]/collapsible:rotate-90`}
        />
      </>
    );

    if (iconMode) {
      return (
        <SidebarMenuItem key={parent.id}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton isActive={containsActive}>{parentButtonContent}</SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="min-w-44">
              <DropdownMenuLabel>{parent.label}</DropdownMenuLabel>
              {parent.children.map((child) => (
                <DropdownMenuItem key={child.to as string} asChild>
                  {itemLink(child)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      );
    }

    // Induk yang memuat rute aktif selalu terbuka; keadaan pilihan pengguna tetap tersimpan terpisah.
    const open = containsActive || expanded.includes(parent.id);
    return (
      <Collapsible
        key={parent.id}
        asChild
        open={open}
        onOpenChange={(next) => toggleParent(parent.id, next)}
        className="group/collapsible"
      >
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton isActive={containsActive && !open}>
              {parentButtonContent}
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {parent.children.map((child) => (
                <SidebarMenuSubItem key={child.to as string}>
                  <SidebarMenuSubButton asChild isActive={isActive(child)}>
                    {itemLink(child)}
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    );
  }

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
          <SidebarGroup key={group.label ?? 'tanpa-judul'}>
            {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((entry) =>
                  isNavParent(entry) ? (
                    renderParent(entry)
                  ) : (
                    <SidebarMenuItem key={entry.to as string}>
                      <SidebarMenuButton asChild tooltip={entry.label} isActive={isActive(entry)}>
                        {itemLink(entry)}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
