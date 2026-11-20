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
import { LocationPicker } from '@/modules/location/location-picker';
import { NotificationBell } from '@/modules/notification/notification-bell';
import { PushOnboarding } from '@/modules/push/components/push-onboarding';
import { ThemeToggle } from '@/modules/theme/theme-toggle';
import { usePrefetchOnIdle } from '../prefetch';
import { pageWidthOf } from '../route-meta';
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
  // Ponsel: header hanya memuat tombol (trigger, lokasi, lonceng, tema, akun) agar muat di 360 px; breadcrumb pindah
  // ke baris sendiri di atas isi halaman (tombol kembali + judul tingkat terakhir).
  const phone = useIsMobile();
  const pageWidth = pageWidthOf(useMatches());
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
              <SidebarInset className="min-w-0">
                <UiUpdateBanner />
                <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
                  <SidebarTrigger data-tour="sidebar-trigger" />
                  {phone ? null : <AppBreadcrumb />}
                  <div className="ml-auto flex items-center gap-1">
                    <LocationPicker />
                    <OutboxChip />
                    <NotificationBell />
                    <ThemeToggle />
                    <UserMenu />
                  </div>
                </header>
                <ServerStatusBanner />
                <PushOnboarding />
                <GuideGreeting />
                <GuideBanner />
                <main className="flex-1 p-[var(--main-pad)] [--main-pad:1rem] md:[--main-pad:1.5rem]">
                  {phone ? (
                    <div className="-mt-2 mb-2" data-slot="phone-breadcrumb">
                      <AppBreadcrumb />
                    </div>
                  ) : null}
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
