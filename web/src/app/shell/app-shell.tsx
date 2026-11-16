import { Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useMe } from '@/modules/auth/use-me';
import { GuideBanner } from '@/modules/guide/components/guide-banner';
import { GuideGreeting } from '@/modules/guide/components/guide-greeting';
import { TourProvider } from '@/modules/guide/components/tour/tour-provider';
import { renderTourTip } from '@/modules/guide/components/tour/tour-tip';
import { ActiveLocationsProvider } from '@/modules/location/active-locations-context';
import { LocationPicker } from '@/modules/location/location-picker';
import { NotificationBell } from '@/modules/notification/notification-bell';
import { PushOnboarding } from '@/modules/push/components/push-onboarding';
import { ThemeToggle } from '@/modules/theme/theme-toggle';
import { usePrefetchOnIdle } from '../prefetch';
import { AppSidebar } from './app-sidebar';
import { OutboxChip } from './outbox-chip';
import { ServerStatusBanner } from './server-status-banner';
import { UiUpdateBanner } from './ui-update-banner';
import { UserMenu } from './user-menu';

/**
 * Cangkang aplikasi (sidebar + header). Dipakai rute `_app` (isi lewat `<Outlet />`) dan rute di luar `_app` yang
 * tetap boleh tampil tanpa login tetapi memakai cangkang bila sudah login (`/country-lock`): isinya lewat `children`.
 */
export function AppShell({ children }: { children?: ReactNode } = {}) {
  usePrefetchOnIdle(useMe());
  return (
    <TooltipProvider>
      <ActiveLocationsProvider>
        <SidebarProvider>
          {/* Di dalam SidebarProvider agar mesin tur dapat membuka sidebar ponsel; overlay-nya dimuat malas. */}
          <TourProvider renderTip={renderTourTip}>
            <AppSidebar />
            <SidebarInset className="min-w-0">
              <UiUpdateBanner />
              <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
                <SidebarTrigger data-tour="sidebar-trigger" />
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
              <main className="flex-1 p-4 md:p-6">{children ?? <Outlet />}</main>
            </SidebarInset>
          </TourProvider>
        </SidebarProvider>
      </ActiveLocationsProvider>
    </TooltipProvider>
  );
}
