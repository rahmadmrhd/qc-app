import { Link, useMatchRoute, useRouterState } from '@tanstack/react-router';
import { ChevronRight, Search } from 'lucide-react';
import { useState } from 'react';
import { filterNavGroups } from '@/app/nav-search';
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
import { Input } from '@/components/ui/input';
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
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { isSidebarOverlayViewport } from '@/lib/layout';
import { isDesktop } from '@/lib/platform';
import { useMe } from '@/modules/auth/use-me';
import { openInDesktop } from '@/modules/countrylock/lib/handoff';
import { hasPendingGuide } from '@/modules/guide/lib/guide-for-route';
import { useOfferedGuides } from '@/modules/guide/lib/use-offered-guides';
import { useActiveLocations } from '@/modules/location/active-locations-context';

/** Penanda akordeon ponsel: pengguna menutup semua induk (induk aktif tak boleh membuka diri lagi). */
const CLOSED_ALL = '__none__';

const GUIDE_DOT_CLASS =
  'ml-auto size-2 shrink-0 rounded-full bg-primary group-data-[collapsible=icon]:hidden';

/** Butir aktif di popover mode ikon: samakan dengan butir aktif sidebar terbuka (latar aksen + tebal). */
const POPOVER_ACTIVE_CLASS = 'data-[active]:bg-accent data-[active]:font-medium';

export function AppSidebar() {
  const me = useMe();
  const { selectedIds } = useActiveLocations();
  const matchRoute = useMatchRoute();
  const { offers } = useOfferedGuides();
  const { state, isMobile, setOpen } = useSidebar();
  // Induk yang dibuka pengguna (selain induk aktif): sementara, tidak disimpan, dan dikosongkan setiap rute berubah
  // (spek B11). Ponsel: akordeon.
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const [picked, setPicked] = useState<{ path: string; ids: string[] }>({
    path: pathname,
    ids: [],
  });
  const expanded = picked.path === pathname ? picked.ids : [];
  const iconMode = state === 'collapsed' && !isMobile;
  const stack = useStackNavigation();
  const [query, setQuery] = useState('');
  const searching = isMobile && query.trim() !== '';

  const isActive = (item: NavItem) =>
    isNavItemActive(item, (to, fuzzy) => Boolean(matchRoute({ to: to as NavItem['to'], fuzzy })));

  function toggleParent(id: string, open: boolean) {
    setPicked((current) => {
      const ids = current.path === pathname ? current.ids : [];
      // Ponsel: akordeon (satu induk terbuka pada satu waktu).
      const next = open
        ? isMobile
          ? [id]
          : [...ids.filter((v) => v !== id), id]
        : isMobile
          ? [CLOSED_ALL]
          : ids.filter((v) => v !== id);
      return { path: pathname, ids: next };
    });
  }

  function itemLink(item: NavItem, className?: string) {
    return (
      <Link
        to={item.to}
        className={className}
        data-active={isActive(item) || undefined}
        onClick={(event) => {
          if (item.opensDesktopApp && !isDesktop()) {
            // Gagal (server mati, izin dicabut) tak mengganggu: halaman tujuan menampilkan
            // tombol dan alasannya.
            void openInDesktop().catch(() => undefined);
          }
          // Ponsel (butir 41c): ganti modul lewat menu = replace (bukan push), dan panel menutup sendiri lewat
          // pelepasan entri overlay. Klik dengan tombol pengubah dibiarkan (buka di tab baru).
          if (
            isMobile &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            event.button === 0
          ) {
            event.preventDefault();
            setQuery('');
            stack.replace({ to: item.to });
          } else if (isSidebarOverlayViewport()) {
            // Rentang overlay (768-959 px): sidebar yang melayang menutup sendiri setelah memilih butir.
            setOpen(false);
          }
        }}
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
                  {itemLink(child, POPOVER_ACTIVE_CLASS)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      );
    }

    // Hanya induk yang memuat rute aktif yang terbuka sendiri; induk lain yang diketuk terbuka sementara.
    // Ponsel (akordeon ketat): setelah pengguna memilih, hanya induk pilihannya yang terbuka; sebelumnya induk aktif.
    const open =
      searching ||
      (isMobile
        ? expanded.length > 0
          ? expanded.includes(parent.id)
          : containsActive
        : containsActive || expanded.includes(parent.id));
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
        {isMobile ? (
          <div className="relative px-2 pt-1" data-slot="menu-search">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari menu…"
              aria-label="Cari menu"
              className="pl-8"
            />
          </div>
        ) : null}
        {filterNavGroups(
          visibleNavGroups(NAV_GROUPS, me, selectedIds, isDesktop(), isMobile),
          isMobile ? query : '',
        ).map((group) => (
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
        {searching &&
        filterNavGroups(visibleNavGroups(NAV_GROUPS, me, selectedIds, isDesktop(), isMobile), query)
          .length === 0 ? (
          <p className="px-4 py-2 text-sm text-muted-foreground">Tidak ada menu yang cocok.</p>
        ) : null}
      </SidebarContent>
    </Sidebar>
  );
}
