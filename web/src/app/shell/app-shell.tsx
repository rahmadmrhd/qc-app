import { Outlet, useMatches } from '@tanstack/react-router';
import { type ReactNode, useCallback, useState } from 'react';
import { PageContainer } from '@/components/page/page-container';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFocusIntoView, useVisualViewport } from '@/hooks/use-visual-viewport';
import { useMe } from '@/modules/auth/use-me';
import { GuideBanner } from '@/modules/guide/components/guide-banner';
import { GuideGreeting } from '@/modules/guide/components/guide-greeting';
import { TourProvider } from '@/modules/guide/components/tour/tour-provider';
import { renderTourTip } from '@/modules/guide/components/tour/tour-tip';
import { ItemCreateHost } from '@/modules/item/components/item-create-host';
import { ActiveLocationsProvider } from '@/modules/location/active-locations-context';
import { LocationLine } from '@/modules/location/components/location-line';
import { LocationReconfirm } from '@/modules/location/components/location-reconfirm';
import { LocationPicker } from '@/modules/location/location-picker';
import { NotificationBell } from '@/modules/notification/notification-bell';
import { PushOnboarding } from '@/modules/push/components/push-onboarding';
import { ThemeToggle } from '@/modules/theme/theme-toggle';
import { usePrefetchOnIdle } from '../prefetch';
import { locationAwareOf, pageWidthOf } from '../route-meta';
import { AppBreadcrumb } from './app-breadcrumb';
import { AppSidebar } from './app-sidebar';
import { OutboxChip } from './outbox-chip';
import { ServerStatusBanner } from './server-status-banner';
import { readSidebarState, writeSidebarState } from './sidebar-state';
import { UiUpdateBanner } from './ui-update-banner';
import { UserMenu } from './user-menu';

/**
 * Cangkang aplikasi (sidebar + header). Dipakai rute `_app` (isi lewat `<Outlet />`) dan rute di luar `_app` yang
 * tetap boleh tampil tanpa login tetapi memakai cangkang bila sudah login (`/country-lock`): isinya lewat `children`.
 */
export function AppShell({ children }: { children?: ReactNode } = {}) {
  usePrefetchOnIdle(useMe());
  // Papan ketik layar ponsel: variabel --vvh/--vv-top/--kb dan gulir field fokus ke area terlihat.
  useVisualViewport();
  useFocusIntoView();
  // Ponsel (butir 41): header = ☰ + judul tingkat terakhir + tombol kanan (lokasi, lonceng, akun); tanpa tombol kembali.
  const phone = useIsMobile();
  const matches = useMatches();
  const pageWidth = pageWidthOf(matches);
  const locationAware = locationAwareOf(matches);
  // Terkendali (bukan defaultOpen): terbuka/terlipat diingat di localStorage lewat `qc.sidebar`.
  const [sidebarOpen, setSidebarOpen] = useState(() => readSidebarState().open);
  const onSidebarOpenChange = useCallback((open: boolean) => {
    setSidebarOpen(open);
    writeSidebarState({ ...readSidebarState(), open });
  }, []);
  return (
    <TooltipProvider>
      <ItemCreateHost>
        <ActiveLocationsProvider>
          <SidebarProvider open={sidebarOpen} onOpenChange={onSidebarOpenChange}>
            {/* Di dalam SidebarProvider agar mesin tur dapat membuka sidebar ponsel; overlay-nya dimuat malas. */}
            <TourProvider renderTip={renderTourTip}>
              <AppSidebar />
              <LocationReconfirm />
              <SidebarInset className="min-w-0">
                <UiUpdateBanner />
                <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
                  <SidebarTrigger data-tour="sidebar-trigger" />
                  {/* Ponsel: judul tingkat terakhir di sebelah ☰ (tanpa tombol kembali: back = tombol sistem). */}
                  {phone ? (
                    <div className="flex min-w-0 flex-1 flex-col justify-center">
                      <AppBreadcrumb />
                      {/* Baris kedua hanya di halaman berlokasi (butir 42c). */}
                      {locationAware ? <LocationLine /> : null}
                    </div>
                  ) : (
                    <AppBreadcrumb />
                  )}
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    {/* Ponsel (butir 42): lokasi, antrean, dan tema pindah ke baris kedua/lembar avatar. */}
                    {phone ? null : <LocationPicker />}
                    {phone ? null : <OutboxChip />}
                    <NotificationBell />
                    {phone ? null : <ThemeToggle />}
                    <UserMenu />
                  </div>
                </header>
                <ServerStatusBanner />
                <PushOnboarding />
                <GuideGreeting />
                <GuideBanner />
                <main className="flex-1 p-[var(--main-pad)] [--main-pad:1rem] md:[--main-pad:1.5rem]">
                  <PageContainer width={pageWidth}>{children ?? <Outlet />}</PageContainer>
                </main>
              </SidebarInset>
            </TourProvider>
          </SidebarProvider>
        </ActiveLocationsProvider>
      </ItemCreateHost>
    </TooltipProvider>
  );
}
